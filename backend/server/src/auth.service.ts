import { Inject, Injectable } from '@nestjs/common';
import { AUDIT_TRAIL_PORT, type AuditTrailPort, type PasswordChangedReason } from '@natural-enforcement/audit';
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
  type LoginAccount,
  type LoginDirectory,
} from './login-directory.ts';
import {
  readCookie,
  serializeSessionCookie,
  SESSION_COOKIE,
} from './session-cookie.ts';
import { SESSION_STORE, type SessionRow, type SessionStore } from './session-store.ts';

const IDLE_MS = 30 * 60 * 1000;
const ABSOLUTE_MS = 8 * 60 * 60 * 1000;

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
    | { result: PasswordGate };
  setCookie?: string;
};

export type PasswordChangeOutcome = {
  status: number;
  body:
    | { result: 'established' }
    | { result: 'invalid-credential' }
    | { result: 'non-compliant'; rules: PasswordRuleCode[] };
};

export type SessionView =
  | { result: 'anonymous' }
  | { result: PasswordGate }
  | {
      result: 'authenticated';
      name: string;
      code: string;
      orgName: string | null;
      roles: string[];
      daysRemaining?: number;
    };

type ActiveSession = { row: SessionRow; account: LoginAccount };

@Injectable()
export class AuthService {
  constructor(
    @Inject(LOGIN_DIRECTORY) private readonly directory: LoginDirectory,
    @Inject(SESSION_STORE) private readonly sessions: SessionStore,
    @Inject(AUDIT_TRAIL_PORT) private readonly audit: AuditTrailPort,
    private readonly credentials: CredentialService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async login(input: LoginInput): Promise<LoginOutcome> {
    // 本票不发放记住我。勾选随请求收下，不写记住我表，也不下发记住我 Cookie。
    void input.rememberMe;
    const invalid = { status: 401, body: { result: 'invalid-credential' as const } };
    if (input.mobilePhone === '') {
      await this.audit.append({
        action: 'login.failed',
        reason: 'unknown-identifier',
        ...emptyParties(input.sourceIp),
      });
      return invalid;
    }
    const account = await this.directory.findByMobile(input.mobilePhone);
    if (!account) {
      await this.audit.append({
        action: 'login.failed',
        reason: 'unknown-identifier',
        ...emptyParties(input.sourceIp),
      });
      return invalid;
    }
    const accepted = await this.credentials.authenticate(account.id, input.password);
    if (!accepted) {
      await this.audit.append({
        action: 'login.failed',
        reason: 'bad-credential',
        ...partiesOf(account, input.sourceIp),
      });
      return invalid;
    }
    const now = this.clock.now();
    const gate = passwordGate(account.passwordChangedAt, now);
    const setCookie = await this.openSession(input.cookieHeader, account, input.sourceIp, now);
    if (gate === 'password-change-required') {
      await this.audit.append({
        action: 'login.password-change-required',
        ...partiesOf(account, input.sourceIp),
      });
      return { status: 200, body: { result: gate }, setCookie };
    }
    if (gate === 'password-expired') {
      await this.audit.append({
        action: 'login.password-expired',
        ...partiesOf(account, input.sourceIp),
      });
      return { status: 200, body: { result: gate }, setCookie };
    }
    await this.audit.append({
      action: 'login.succeeded',
      ...partiesOf(account, input.sourceIp),
    });
    return {
      status: 200,
      body: this.establishedBody(account.passwordChangedAt, now),
      setCookie,
    };
  }

  /** 会话查询。没有有效会话时返回未登录，不写授权拒绝。 */
  async session(cookieHeader: string | undefined, sourceIp: string | null): Promise<SessionView> {
    const active = await this.resolve(cookieHeader, sourceIp, false);
    if (!active) return { result: 'anonymous' };
    const now = this.clock.now();
    const gate = passwordGate(active.account.passwordChangedAt, now);
    if (gate) return { result: gate };
    return {
      result: 'authenticated',
      name: active.account.name,
      code: active.account.code,
      orgName: active.account.orgName,
      roles: active.account.roles,
      ...this.notice(active.account.passwordChangedAt, now),
    };
  }

  /** 守卫读取会话。denyWhenMissing 为真且没有会话时写授权拒绝。 */
  loadActive(
    cookieHeader: string | undefined,
    sourceIp: string | null,
    denyWhenMissing: boolean,
  ): Promise<ActiveSession | null> {
    return this.resolve(cookieHeader, sourceIp, denyWhenMissing);
  }

  passwordChangeState(account: LoginAccount): PasswordGate | null {
    return passwordGate(account.passwordChangedAt, this.clock.now());
  }

  async changePassword(input: {
    cookieHeader: string | undefined;
    sourceIp: string | null;
    currentPassword: string;
    newPassword: string;
  }): Promise<PasswordChangeOutcome> {
    const active = await this.resolve(input.cookieHeader, input.sourceIp, false);
    if (!active) return { status: 401, body: { result: 'invalid-credential' } };
    const accepted = await this.credentials.authenticate(active.account.id, input.currentPassword);
    if (!accepted) {
      await this.audit.append({
        action: 'login.failed',
        reason: 'bad-credential',
        ...partiesOf(active.account, input.sourceIp),
      });
      return { status: 400, body: { result: 'invalid-credential' } };
    }
    const rules = rejectedPasswordRules({
      password: input.newPassword,
      personnelCode: active.account.code,
      currentPassword: input.currentPassword,
    });
    if (rules.length > 0) return { status: 400, body: { result: 'non-compliant', rules } };
    const now = this.clock.now();
    const gate = passwordGate(active.account.passwordChangedAt, now);
    await this.credentials.changePassword(active.account.id, input.newPassword, now);
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

  async logout(cookieHeader: string | undefined, sourceIp: string | null): Promise<{ result: 'ended' }> {
    const active = await this.resolve(cookieHeader, sourceIp, false);
    if (!active) return { result: 'ended' };
    const now = this.clock.now();
    await this.sessions.end(active.row.id, now, 'logout');
    await this.audit.append({
      action: 'session.ended',
      reason: 'logout',
      ...partiesOf(active.account, sourceIp),
    });
    return { result: 'ended' };
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
  ): Promise<string> {
    await this.closePresentedSession(cookieHeader, account, sourceIp, now);
    const secret = newSessionSecret();
    await this.sessions.insert({
      id: newUlid(now.getTime()),
      personnelId: account.id,
      secretHash: await sha256Hex(secret),
      authenticatedAt: now,
      lastSeenAt: now,
      absoluteEndsAt: new Date(now.getTime() + ABSOLUTE_MS),
    });
    return serializeSessionCookie(secret);
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
    return { row, account };
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
