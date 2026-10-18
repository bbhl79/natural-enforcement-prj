import { Inject, Injectable } from '@nestjs/common';
import { AUDIT_TRAIL_PORT, type AuditTrailPort, type PasswordChangedReason, type SessionEndReason } from '@natural-enforcement/audit';
import {
  CredentialService,
  newUlid,
  rejectedPasswordRules,
  type PasswordRuleCode,
} from '@natural-enforcement/identity';

import {
  CLOCK,
  daysUntilPasswordExpiry,
  EXPIRY_NOTICE_DAYS,
  passwordGate,
  type Clock,
  type PasswordGate,
} from './clock.ts';

import {
  emptyParties,
  LOGIN_DIRECTORY,
  partiesOf,
  type FailureSnapshot,
  type LoginAccount,
  type LoginDirectory,
} from './login-directory.ts';
import { REMEMBER_ME_STORE, type RememberMeRow, type RememberMeStore } from './remember-me-store.ts';
import {
  clearRememberCookie,
  clearSessionCookie,
  readCookie,
  REMEMBER_COOKIE,
  serializeRememberCookie,
  serializeSessionCookie,
  SESSION_COOKIE,
} from './session-cookie.ts';
import { SESSION_CAPACITY, SESSION_STORE, type SessionRow, type SessionStore } from './session-store.ts';
import { SourceGate } from './source-gate.ts';
import type { TxScope } from './unit-of-work.ts';

const IDLE_MS = 30 * 60 * 1000;
const ABSOLUTE_MS = 8 * 60 * 60 * 1000;
const MAX_SESSIONS_PER_PERSON = 3;
const REMEMBER_MS = 168 * 60 * 60 * 1000;
const GRACE_MS = 60 * 1000;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 30 * 60 * 1000;
const LOCK_AFTER = 5;

interface WebCrypto {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
  subtle: { digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer> };
}

function webcrypto(): WebCrypto {
  const found = (globalThis as { crypto?: WebCrypto }).crypto;
  if (!found?.subtle) throw new Error('当前运行时无 webcrypto');
  return found;
}

function utf8(value: string): Uint8Array {
  const Encoder = (globalThis as { TextEncoder?: new () => { encode(input: string): Uint8Array } }).TextEncoder;
  if (!Encoder) throw new Error('当前运行时无 TextEncoder');
  return new Encoder().encode(value);
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function base64url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = i + 1 < bytes.length ? (bytes[i + 1] ?? 0) : 0;
    const c = i + 2 < bytes.length ? (bytes[i + 2] ?? 0) : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += B64[(triple >> 18) & 63];
    out += B64[(triple >> 12) & 63];
    if (i + 1 < bytes.length) out += B64[(triple >> 6) & 63];
    if (i + 2 < bytes.length) out += B64[triple & 63];
  }
  return out;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await webcrypto().subtle.digest('SHA-256', utf8(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * 到期横幅的会话标记（#105 X1「同一会话关闭后不再出现」）：同一会话内不变，换会话（含记住我新建的会话）即变。
 * 由会话行标识单向派生，不是会话密钥，不能反推会话标识。
 */
async function noticeTagOf(sessionId: string): Promise<string> {
  return (await sha256Hex(`expiry-notice:${sessionId}`)).slice(0, 16);
}

function newSessionSecret(): string {
  const bytes = new Uint8Array(32);
  webcrypto().getRandomValues(bytes);
  return base64url(bytes);
}

export interface LoginInput {
  mobilePhone: string;
  password: string;
  rememberMe: boolean;
  cookieHeader: string | undefined;
  sourceIp: string | null;
}

export type LoginOutcome = {
  status: number;
  body:
    | { result: 'established'; daysRemaining?: number }
    | { result: 'invalid-credential' }
    | { result: 'locked' }
    | { result: 'deactivated' }
    | { result: PasswordGate }
    | { result: 'capacity-reached' };
  setCookies?: string[];
};

export type PasswordChangeOutcome = {
  status: number;
  body:
    | { result: 'established' }
    | { result: 'invalid-credential' }
    | { result: 'locked' }
    | { result: 'non-compliant'; rules: PasswordRuleCode[] }
    /** 并发改密（ADR 0015，#132）：期望散列已被换掉，本次不写库。 */
    | { result: 'concurrent-change' };
};

export type SessionView =
  | { result: 'anonymous' }
  | {
      result: 'authenticated' | PasswordGate;
      name: string;
      code: string;
      orgName: string | null;
      roles: string[];
      passwordChangeRequired: boolean;
      passwordChangeKind: PasswordGate | null;
      daysRemaining?: number;
      /** 到期横幅的会话标记，只在带 daysRemaining 时出现 */
      noticeTag?: string;
      /** 本人允许的操作码清单（#105 菜单来源）。强制改密期间为空。不含数据范围。 */
      opcodes: string[];
    };

type ActiveSession = { row: SessionRow; account: LoginAccount };

export interface AuthResolution {
  active: ActiveSession | null;
  setCookies: string[];
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(LOGIN_DIRECTORY) private readonly directory: LoginDirectory,
    @Inject(SESSION_STORE) private readonly sessions: SessionStore,
    @Inject(REMEMBER_ME_STORE) private readonly remember: RememberMeStore,
    @Inject(AUDIT_TRAIL_PORT) private readonly audit: AuditTrailPort,
    private readonly credentials: CredentialService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(SESSION_CAPACITY) private readonly sessionCapacity: number,
    private readonly sources: SourceGate,
  ) {}

  async login(input: LoginInput): Promise<LoginOutcome> {
    const invalid = { status: 401, body: { result: 'invalid-credential' as const } };
    const now = this.clock.now();
    if (this.sources.blocked(input.sourceIp, now)) {
      await this.audit.append({
        action: 'login.source-limited',
        ...emptyParties(input.sourceIp),
      });
      return invalid;
    }
    if (input.mobilePhone === '') {
      await this.audit.append({
        action: 'login.failed',
        reason: 'unknown-identifier',
        ...emptyParties(input.sourceIp),
      });
      this.sources.record(input.sourceIp, now);
      return invalid;
    }
    const account = await this.directory.findByMobile(input.mobilePhone);
    if (!account) {
      await this.audit.append({
        action: 'login.failed',
        reason: 'unknown-identifier',
        ...emptyParties(input.sourceIp),
      });
      this.sources.record(input.sourceIp, now);
      return invalid;
    }
    if (account.deactivatedAt != null) {
      await this.audit.append({
        action: 'login.deactivated',
        ...partiesOf(account, input.sourceIp),
      });
      return { status: 401, body: { result: 'deactivated' } };
    }
    if (this.inLock(account, now)) {
      await this.audit.append({
        action: 'login.locked-retry',
        ...partiesOf(account, input.sourceIp),
      });
      this.sources.record(input.sourceIp, now);
      return { status: 401, body: { result: 'locked' } };
    }
    const accepted = await this.credentials.authenticate(account.id, input.password);
    if (!accepted) {
      const snapshot = this.nextFailure(account, now);
      await this.directory.saveFailure(account.id, snapshot);
      if (snapshot.count >= LOCK_AFTER) {
        await this.audit.append({
          action: 'login.locked',
          ...partiesOf(account, input.sourceIp),
        });
        this.sources.record(input.sourceIp, now);
        return { status: 401, body: { result: 'locked' } };
      }
      await this.audit.append({
        action: 'login.failed',
        reason: 'bad-credential',
        ...partiesOf(account, input.sourceIp),
      });
      this.sources.record(input.sourceIp, now);
      return invalid;
    }
    await this.directory.clearFailure(account.id);
    const gate = passwordGate(account.passwordChangedAt, now);
    const opened = await this.openSession(
      input.cookieHeader,
      account,
      input.sourceIp,
      now,
      input.rememberMe,
    );
    if (opened === 'capacity') {
      await this.audit.append({
        action: 'login.capacity-reached',
        ...partiesOf(account, input.sourceIp),
      });
      return { status: 503, body: { result: 'capacity-reached' } };
    }
    const setCookies = opened;
    if (gate === 'password-change-required') {
      await this.audit.append({
        action: 'login.password-change-required',
        ...partiesOf(account, input.sourceIp),
      });
      return { status: 200, body: { result: gate }, setCookies };
    }
    if (gate === 'password-expired') {
      await this.audit.append({
        action: 'login.password-expired',
        ...partiesOf(account, input.sourceIp),
      });
      return { status: 200, body: { result: gate }, setCookies };
    }
    await this.audit.append({
      action: 'login.succeeded',
      ...partiesOf(account, input.sourceIp),
    });
    return {
      status: 200,
      body: this.establishedBody(account.passwordChangedAt, now),
      setCookies,
    };
  }

  /**
   * 会话查询看到的结果。没有有效会话时是未登录，不在这里写授权拒绝。
   * opcodes 由调用方按 AccessControlService.listPermittedOpcodes 算好传入。
   */
  async describe(active: ActiveSession | null, opcodes: readonly string[] = []): Promise<SessionView> {
    if (!active) return { result: 'anonymous' };
    const now = this.clock.now();
    const gate = passwordGate(active.account.passwordChangedAt, now);
    const notice = this.notice(active.account.passwordChangedAt, now);
    return {
      result: gate ?? 'authenticated',
      name: active.account.name,
      code: active.account.code,
      orgName: active.account.orgName,
      roles: active.account.roles,
      passwordChangeRequired: gate != null,
      passwordChangeKind: gate,
      ...notice,
      ...(notice.daysRemaining === undefined ? {} : { noticeTag: await noticeTagOf(active.row.id) }),
      opcodes: gate ? [] : [...opcodes],
    };
  }

  /** 一次请求只解析一次。无有效会话时，允许的路由才尝试记住我进入。 */
  async openRequest(
    cookieHeader: string | undefined,
    sourceIp: string | null,
    denyWhenMissing: boolean,
    rememberMeEntry: boolean,
  ): Promise<AuthResolution> {
    const active = await this.resolve(cookieHeader, sourceIp, false);
    if (active) return { active, setCookies: [] };
    if (rememberMeEntry) {
      const entered = await this.enterRememberMe(cookieHeader, sourceIp);
      if (!entered.active && denyWhenMissing) await this.deny(sourceIp);
      return entered;
    }
    if (denyWhenMissing) await this.deny(sourceIp);
    return { active: null, setCookies: [] };
  }

  passwordChangeState(account: LoginAccount): PasswordGate | null {
    return passwordGate(account.passwordChangedAt, this.clock.now());
  }

  async changePassword(input: {
    active: ActiveSession | null;
    sourceIp: string | null;
    currentPassword: string;
    newPassword: string;
  }): Promise<PasswordChangeOutcome> {
    const active = input.active;
    if (!active) return { status: 401, body: { result: 'invalid-credential' } };
    const now = this.clock.now();
    if (this.inLock(active.account, now)) {
      await this.audit.append({
        action: 'login.locked-retry',
        ...partiesOf(active.account, input.sourceIp),
      });
      return { status: 401, body: { result: 'locked' } };
    }
    const currentHash = await this.credentials.authenticate(active.account.id, input.currentPassword);
    if (!currentHash) {
      const snapshot = this.nextFailure(active.account, now);
      await this.directory.saveFailure(active.account.id, snapshot);
      if (snapshot.count >= LOCK_AFTER) {
        await this.audit.append({
          action: 'login.locked',
          ...partiesOf(active.account, input.sourceIp),
        });
        return { status: 401, body: { result: 'locked' } };
      }
      await this.audit.append({
        action: 'login.failed',
        reason: 'bad-credential',
        ...partiesOf(active.account, input.sourceIp),
      });
      return { status: 400, body: { result: 'invalid-credential' } };
    }
    await this.directory.clearFailure(active.account.id);
    const rules = rejectedPasswordRules({
      password: input.newPassword,
      personnelCode: active.account.code,
      currentPassword: input.currentPassword,
    });
    if (rules.length > 0) return { status: 400, body: { result: 'non-compliant', rules } };
    // 历史比对只在其余口令规则全部通过后做（ADR 0015）。本人命中历史只回 reused，
    // 不说明命中第几次，也不写留痕（#105 错误码表）。
    if (await this.credentials.isReused(active.account.id, input.newPassword, currentHash)) {
      return { status: 400, body: { result: 'non-compliant', rules: ['reused'] } };
    }
    const gate = passwordGate(active.account.passwordChangedAt, now);
    // 条件更新 + 追加历史同一事务（ADR 0015）：期望值是认证时读到的散列。
    const rotated = await this.credentials.changePassword(active.account.id, input.newPassword, now, currentHash);
    if (!rotated) {
      // 并发已换掉散列：本次不写库，回 409，拒绝留痕写 account.password-rejected（操作码为空，本人改密）。
      await this.audit.append({
        action: 'account.password-rejected',
        outcome: 'failed',
        reason: 'concurrent-change',
        ...partiesOf(active.account, input.sourceIp),
      });
      return { status: 409, body: { result: 'concurrent-change' } };
    }
    await this.audit.append({
      action: 'account.password-changed',
      reason: this.passwordChangedReason(gate),
      ...partiesOf(active.account, input.sourceIp),
    });
    if (gate) {
      await this.audit.append({
        action: 'login.succeeded',
        ...partiesOf(active.account, input.sourceIp),
      });
    }
    return { status: 200, body: { result: 'established' } };
  }

  /** 受保护接口。没有有效会话时写授权拒绝，原因是未认证。 */
  async requireSession(
    cookieHeader: string | undefined,
    sourceIp: string | null,
  ): Promise<ActiveSession | null> {
    return this.resolve(cookieHeader, sourceIp, true);
  }

  /** 系统管理结束某人员全部未结束的会话。独立 HTTP 入口不在本能力里。 */
  /**
   * 结束某人员全部未结束的会话，每段写一行 session.ended（admin-ended）。
   * 传入 tx 时读写与留痕都在该事务里（#119），与调用方的业务行同成同败。
   */
  async endPersonnelSessions(
    input: {
      personnelId: string;
      actorId: string;
      actorCode: string;
      sourceIp: string | null;
    },
    tx?: Pick<TxScope, 'directory' | 'sessions' | 'audit'>,
  ): Promise<void> {
    const directory = tx?.directory ?? this.directory;
    const store = tx?.sessions ?? this.sessions;
    const audit = tx?.audit ?? this.audit;
    const now = this.clock.now();
    const subject = await directory.findById(input.personnelId);
    const sessions = await store.listActive(input.personnelId);
    for (const session of sessions) {
      await store.end(session.id, now, 'admin-ended');
      await audit.append({
        action: 'session.ended',
        reason: 'admin-ended',
        actorId: input.actorId,
        actorCode: input.actorCode,
        subjectPersonnelId: input.personnelId,
        subjectCode: subject?.code ?? null,
        orgUnitId: subject?.orgUnitId ?? null,
        sourceIp: input.sourceIp,
      });
    }
  }

  /** 会话已经结束时，退出仍作废这台浏览器带来的记住我。 */
  async dropPresentedRememberMe(cookieHeader: string | undefined): Promise<void> {
    await this.voidPresentedRememberMe(cookieHeader, this.clock.now(), 'logout');
  }

  async logout(
    active: ActiveSession | null,
    cookieHeader: string | undefined,
    sourceIp: string | null,
  ): Promise<{ result: 'ended' }> {
    const now = this.clock.now();
    if (active) {
      await this.sessions.end(active.row.id, now, 'logout');
      await this.audit.append({
        action: 'session.ended',
        reason: 'logout',
        ...partiesOf(active.account, sourceIp),
      });
      if (active.row.rememberMeChainId) {
        await this.remember.endActiveOnChain(active.row.rememberMeChainId, now, 'logout');
      }
    }
    await this.voidPresentedRememberMe(cookieHeader, now, 'logout');
    return { result: 'ended' };
  }

  private inLock(account: LoginAccount, now: Date): boolean {
    return account.lockedUntil != null && now.getTime() < account.lockedUntil.getTime();
  }

  /** 15 分钟固定窗口。窗口起点是窗口内第一次失败。锁定到期后下一次从 1 计。 */
  private nextFailure(account: LoginAccount, now: Date): FailureSnapshot {
    const start = account.failureWindowStartedAt;
    const lockExpired = account.lockedUntil != null && now.getTime() >= account.lockedUntil.getTime();
    const windowOpen = start != null && now.getTime() - start.getTime() < FAILURE_WINDOW_MS;
    if (!windowOpen || lockExpired) {
      return { count: 1, windowStartedAt: now, lockedUntil: null };
    }
    const count = account.failureCount + 1;
    return {
      count,
      windowStartedAt: start,
      lockedUntil: count >= LOCK_AFTER ? new Date(now.getTime() + LOCK_MS) : null,
    };
  }

  private establishedBody(
    changedAt: Date | null,
    now: Date,
  ): { result: 'established'; daysRemaining?: number } {
    return { result: 'established', ...this.notice(changedAt, now) };
  }

  private notice(changedAt: Date | null, now: Date): { daysRemaining?: number } {
    if (!changedAt) return {};
    const days = daysUntilPasswordExpiry(changedAt, now);
    if (days > EXPIRY_NOTICE_DAYS) return {};
    return { daysRemaining: days };
  }

  private passwordChangedReason(gate: PasswordGate | null): PasswordChangedReason {
    if (gate === 'password-change-required') return 'first-login';
    if (gate === 'password-expired') return 'expired';
    return 'voluntary';
  }

  private async openSession(
    cookieHeader: string | undefined,
    account: LoginAccount,
    sourceIp: string | null,
    now: Date,
    rememberMe: boolean,
  ): Promise<string[] | 'capacity'> {
    await this.closePresentedSession(cookieHeader, account, sourceIp, now);
    await this.endOwnExpired(account, sourceIp, now);
    await this.displaceOldest(account, sourceIp, now);
    if ((await this.countOccupied(now)) >= this.sessionCapacity) return 'capacity';
    const secret = newSessionSecret();
    let absoluteEndsAt = new Date(now.getTime() + ABSOLUTE_MS);
    let rememberMeChainId: string | null = null;
    const cookies = [serializeSessionCookie(secret)];
    if (rememberMe) {
      const rmSecret = newSessionSecret();
      const rmId = newUlid(now.getTime());
      absoluteEndsAt = new Date(now.getTime() + REMEMBER_MS);
      rememberMeChainId = rmId;
      await this.voidPresentedRememberMe(cookieHeader, now, 'logout');
      await this.remember.insert({
        id: rmId,
        personnelId: account.id,
        chainId: rmId,
        secretHash: await sha256Hex(rmSecret),
        absoluteEndsAt,
        predecessorId: null,
        createdAt: now,
      });
      cookies.push(serializeRememberCookie(rmSecret, absoluteEndsAt));
    } else {
      const voided = await this.voidPresentedRememberMe(cookieHeader, now, 'login-without-remember');
      if (voided) cookies.push(clearRememberCookie());
    }
    await this.sessions.insert({
      id: newUlid(now.getTime()),
      personnelId: account.id,
      secretHash: await sha256Hex(secret),
      rememberMeChainId,
      authenticatedAt: now,
      lastSeenAt: now,
      absoluteEndsAt,
    });
    return cookies;
  }

  /** 没有有效会话时，用记住我免输口令进入。这是一次登录。 */
  private async enterRememberMe(
    cookieHeader: string | undefined,
    sourceIp: string | null,
  ): Promise<AuthResolution> {
    const none: AuthResolution = { active: null, setCookies: [] };
    const secret = readCookie(cookieHeader, REMEMBER_COOKIE);
    if (!secret) return none;
    const row = await this.remember.findBySecretHash(await sha256Hex(secret));
    if (!row) return none;
    if (row.endReason === 'rotated') return this.reuseRotated(row, sourceIp);
    const now = this.clock.now();
    if (row.endedAt) return { active: null, setCookies: [clearRememberCookie()] };
    if (now.getTime() >= row.absoluteEndsAt.getTime()) {
      await this.remember.end(row.id, now, 'absolute-timeout');
      return { active: null, setCookies: [clearRememberCookie()] };
    }
    const account = await this.directory.findById(row.personnelId);
    if (!account) return none;
    if (this.sources.blocked(sourceIp, now)) {
      await this.audit.append({
        action: 'login.source-limited',
        ...emptyParties(sourceIp),
      });
      return none;
    }
    if (account.deactivatedAt != null) {
      await this.audit.append({
        action: 'login.deactivated',
        ...partiesOf(account, sourceIp),
      });
      await this.endPersonnelAccess(account.id, now, 'personnel-deactivated', sourceIp);
      return { active: null, setCookies: [clearSessionCookie(), clearRememberCookie()] };
    }
    if (this.inLock(account, now)) {
      await this.audit.append({
        action: 'login.locked-retry',
        ...partiesOf(account, sourceIp),
      });
      return none;
    }
    const rmSecret = newSessionSecret();
    const rmId = newUlid(now.getTime());
    await this.endOwnExpired(account, sourceIp, now);
    await this.displaceOldest(account, sourceIp, now);
    if ((await this.countOccupied(now)) >= this.sessionCapacity) {
      await this.audit.append({
        action: 'login.capacity-reached',
        ...partiesOf(account, sourceIp),
      });
      return none;
    }
    const rotated = await this.remember.rotate(row.id, {
      id: rmId,
      personnelId: row.personnelId,
      chainId: row.chainId,
      secretHash: await sha256Hex(rmSecret),
      absoluteEndsAt: row.absoluteEndsAt,
      predecessorId: row.id,
      createdAt: now,
    }, now);
    if (rotated === 'lost-race') return none;
    const sid = newSessionSecret();
    const sessionId = newUlid(now.getTime());
    const sessionRow: SessionRow = {
      id: sessionId,
      personnelId: account.id,
      secretHash: await sha256Hex(sid),
      rememberMeChainId: row.chainId,
      authenticatedAt: now,
      lastSeenAt: now,
      absoluteEndsAt: row.absoluteEndsAt,
      endedAt: null,
    };
    await this.sessions.insert(sessionRow);
    const gate = passwordGate(account.passwordChangedAt, now);
    if (gate === 'password-change-required') {
      await this.audit.append({
        action: 'login.password-change-required',
        ...partiesOf(account, sourceIp),
      });
    } else if (gate === 'password-expired') {
      await this.audit.append({
        action: 'login.password-expired',
        ...partiesOf(account, sourceIp),
      });
    } else {
      await this.audit.append({
        action: 'login.succeeded',
        ...partiesOf(account, sourceIp),
      });
    }
    return {
      active: { row: sessionRow, account },
      setCookies: [serializeSessionCookie(sid), serializeRememberCookie(rmSecret, row.absoluteEndsAt)],
    };
  }

  private async reuseRotated(row: RememberMeRow, sourceIp: string | null): Promise<AuthResolution> {
    const successor = await this.remember.findSuccessor(row.id);
    const now = this.clock.now();
    const age = successor ? now.getTime() - successor.createdAt.getTime() : GRACE_MS;
    if (age < GRACE_MS) return { active: null, setCookies: [] };
    await this.endPersonnelAccess(row.personnelId, now, 'remember-me-reuse', sourceIp);
    return { active: null, setCookies: [clearSessionCookie(), clearRememberCookie()] };
  }

  private async endPersonnelAccess(
    personnelId: string,
    now: Date,
    reason: SessionEndReason,
    sourceIp: string | null,
  ): Promise<void> {
    const account = await this.directory.findById(personnelId);
    const sessions = await this.sessions.listActive(personnelId);
    for (const session of sessions) {
      await this.sessions.end(session.id, now, reason);
      await this.audit.append({
        action: 'session.ended',
        reason,
        actorId: null,
        actorCode: null,
        subjectPersonnelId: personnelId,
        subjectCode: account?.code ?? null,
        orgUnitId: account?.orgUnitId ?? null,
        sourceIp,
      });
    }
    await this.remember.endActiveForPersonnel(personnelId, now, reason);
  }

  private async resolve(
    cookieHeader: string | undefined,
    sourceIp: string | null,
    denyWhenMissing: boolean,
  ): Promise<ActiveSession | null> {
    const secret = readCookie(cookieHeader, SESSION_COOKIE);
    if (!secret) {
      if (denyWhenMissing) await this.deny(sourceIp);
      return null;
    }
    const row = await this.sessions.findBySecretHash(await sha256Hex(secret));
    if (!row || row.endedAt) {
      if (denyWhenMissing) await this.deny(sourceIp);
      return null;
    }
    const now = this.clock.now();
    const idle = now.getTime() - row.lastSeenAt.getTime() >= IDLE_MS;
    const absolute = now.getTime() >= row.absoluteEndsAt.getTime();
    if (idle || absolute) {
      const reason = idle ? 'idle-timeout' : 'absolute-timeout';
      await this.sessions.end(row.id, now, reason);
      const account = await this.directory.findById(row.personnelId);
      await this.audit.append({
        action: 'session.ended',
        reason,
        actorId: null,
        actorCode: null,
        subjectPersonnelId: row.personnelId,
        subjectCode: account?.code ?? null,
        orgUnitId: account?.orgUnitId ?? null,
        sourceIp,
      });
      return null;
    }
    if (now.getTime() > row.lastSeenAt.getTime()) {
      await this.sessions.touch(row.id, now);
    }
    const account = await this.directory.findById(row.personnelId);
    if (!account) {
      if (denyWhenMissing) await this.deny(sourceIp);
      return null;
    }
    if (account.deactivatedAt != null) {
      await this.endPersonnelAccess(account.id, now, 'personnel-deactivated', sourceIp);
      return null;
    }
    return { row, account };
  }

  /** 全系统名额只按时间排除已过期会话，不写他人的留痕。 */
  private async countOccupied(now: Date): Promise<number> {
    const open = await this.sessions.listOpen();
    return open.filter((row) => this.countsTowardCapacity(row, now)).length;
  }

  private countsTowardCapacity(row: SessionRow, now: Date): boolean {
    if (now.getTime() - row.lastSeenAt.getTime() >= IDLE_MS) return false;
    if (now.getTime() >= row.absoluteEndsAt.getTime()) return false;
    return true;
  }

  /** 统计本人名额前，结束本人已经超过空闲或绝对终点的会话。操作者空着。 */
  private async endOwnExpired(account: LoginAccount, sourceIp: string | null, now: Date): Promise<void> {
    const active = await this.sessions.listActive(account.id);
    for (const row of active) {
      if (this.countsTowardCapacity(row, now)) continue;
      const idle = now.getTime() - row.lastSeenAt.getTime() >= IDLE_MS;
      const reason = idle ? 'idle-timeout' : 'absolute-timeout';
      await this.sessions.end(row.id, now, reason);
      await this.audit.append({
        action: 'session.ended',
        reason,
        actorId: null,
        actorCode: null,
        subjectPersonnelId: account.id,
        subjectCode: account.code,
        orgUnitId: account.orgUnitId,
        sourceIp,
      });
    }
  }

  /** 本人已有 3 段时，结束最旧的一段，并作废那台设备的记住我。 */
  private async displaceOldest(account: LoginAccount, sourceIp: string | null, now: Date): Promise<void> {
    const active = await this.sessions.listActive(account.id);
    if (active.length < MAX_SESSIONS_PER_PERSON) return;
    const oldest = active[0];
    if (!oldest) return;
    await this.sessions.end(oldest.id, now, 'displaced');
    if (oldest.rememberMeChainId) {
      await this.remember.endActiveOnChain(oldest.rememberMeChainId, now, 'displaced');
    }
    await this.audit.append({
      action: 'session.ended',
      reason: 'displaced',
      ...partiesOf(account, sourceIp),
    });
  }

  /** 结束请求里这台浏览器仍有效的记住我。已结束的行不再写。 */
  private async voidPresentedRememberMe(
    cookieHeader: string | undefined,
    now: Date,
    reason: string,
  ): Promise<boolean> {
    const secret = readCookie(cookieHeader, REMEMBER_COOKIE);
    if (!secret) return false;
    const row = await this.remember.findBySecretHash(await sha256Hex(secret));
    if (!row || row.endedAt) return true;
    await this.remember.endActiveOnChain(row.chainId, now, reason);
    return true;
  }

  private async closePresentedSession(
    cookieHeader: string | undefined,
    actor: LoginAccount,
    sourceIp: string | null,
    now: Date,
  ): Promise<void> {
    const secret = readCookie(cookieHeader, SESSION_COOKIE);
    if (!secret) return;
    const row = await this.sessions.findBySecretHash(await sha256Hex(secret));
    if (!row || row.endedAt) return;
    if (row.personnelId !== actor.id) return;
    const idle = now.getTime() - row.lastSeenAt.getTime() >= IDLE_MS;
    const absolute = now.getTime() >= row.absoluteEndsAt.getTime();
    const reason = idle ? 'idle-timeout' : absolute ? 'absolute-timeout' : 'logout';
    await this.sessions.end(row.id, now, reason);
    const subject = row.personnelId === actor.id ? actor : await this.directory.findById(row.personnelId);
    await this.audit.append({
      action: 'session.ended',
      reason,
      actorId: reason === 'logout' ? actor.id : null,
      actorCode: reason === 'logout' ? actor.code : null,
      subjectPersonnelId: row.personnelId,
      subjectCode: subject?.code ?? null,
      orgUnitId: subject?.orgUnitId ?? null,
      sourceIp,
    });
  }

  private async deny(sourceIp: string | null): Promise<void> {
    await this.audit.append({
      action: 'authz.denied',
      reason: 'not-authenticated',
      ...emptyParties(sourceIp),
    });
  }
}
