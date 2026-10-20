// 登录编排与记住我进入的判定顺序（unit 层，内存替身，无库）。
// 只断言外部可观察结果：返回的状态码与结果码、留痕动作、会话与记住我替身里的行。
// 规格 #91「接缝三」：口令登录十个分支、记住我进入六个分支。
import 'reflect-metadata';
import { createHash } from 'node:crypto';

import type { AuditAppend, AuditTrailPort, AuthzDeniedEntry } from '@natural-enforcement/audit';
import type { CredentialService } from '@natural-enforcement/identity';
import { beforeEach, describe, expect, it } from 'vitest';

import { AuthService } from './auth.service.ts';
import type { FailureSnapshot, LoginAccount, LoginDirectory } from './login-directory.ts';
import type { NewRememberMe, RememberMeRow, RememberMeStore } from './remember-me-store.ts';
import type { NewSession, SessionRow, SessionStore } from './session-store.ts';
import { SourceGate } from './source-gate.ts';

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const T0 = Date.parse('2026-10-17T02:00:00.000Z');
const GOOD = 'Right-pass-91!';
const PHONE = '13800099001';
const IP = '203.0.113.91';

function sha(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

class MemoryDirectory implements LoginDirectory {
  readonly byPhone = new Map<string, string>();
  readonly accounts = new Map<string, LoginAccount>();
  async findByMobile(mobile: string) {
    const id = this.byPhone.get(mobile);
    return id ? { ...this.accounts.get(id)! } : null;
  }
  async findById(id: string) {
    const found = this.accounts.get(id);
    return found ? { ...found } : null;
  }
  async saveFailure(id: string, snapshot: FailureSnapshot) {
    const row = this.accounts.get(id)!;
    row.failureCount = snapshot.count;
    row.failureWindowStartedAt = snapshot.windowStartedAt;
    if (snapshot.lockedUntil) row.lockedUntil = snapshot.lockedUntil;
  }
  async clearFailure(id: string) {
    const row = this.accounts.get(id)!;
    row.failureCount = 0;
    row.failureWindowStartedAt = null;
  }
  async listLocked() { return []; }
  async isRootOrg() { return false; }
  async rootOrgId() { return null; }
}

class MemorySessions implements SessionStore {
  readonly rows: Array<SessionRow & { endReason: string | null }> = [];
  async insert(row: NewSession) { this.rows.push({ ...row, endedAt: null, endReason: null }); }
  async findBySecretHash(secretHash: string) { return this.rows.find((row) => row.secretHash === secretHash) ?? null; }
  async touch(id: string, lastSeenAt: Date) { this.rows.find((row) => row.id === id)!.lastSeenAt = lastSeenAt; }
  async end(id: string, endedAt: Date, reason: string) {
    const row = this.rows.find((item) => item.id === id)!;
    if (row.endedAt) return false;
    row.endedAt = endedAt;
    row.endReason = reason;
    return true;
  }
  async listActive(personnelId: string) {
    // 排序键与生产实现一致（#116）：认证时间升序，认证时间相同时按会话 id 升序。
    return this.rows
      .filter((row) => row.personnelId === personnelId && !row.endedAt)
      .sort(
        (a, b) =>
          a.authenticatedAt.getTime() - b.authenticatedAt.getTime() ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
  }
  async listOpen() { return this.rows.filter((row) => !row.endedAt); }
}

class MemoryRemember implements RememberMeStore {
  readonly rows: RememberMeRow[] = [];
  async insert(row: NewRememberMe) { this.rows.push({ ...row, endedAt: null, endReason: null }); }
  async findBySecretHash(secretHash: string) { return this.rows.find((row) => row.secretHash === secretHash) ?? null; }
  async findSuccessor(predecessorId: string) { return this.rows.find((row) => row.predecessorId === predecessorId) ?? null; }
  async end(id: string, endedAt: Date, reason: string) {
    const row = this.rows.find((item) => item.id === id)!;
    row.endedAt = endedAt;
    row.endReason = reason;
  }
  async endActiveOnChain(chainId: string, endedAt: Date, reason: string) {
    for (const row of this.rows) if (row.chainId === chainId && !row.endedAt) Object.assign(row, { endedAt, endReason: reason });
  }
  async endActiveForPersonnel(personnelId: string, endedAt: Date, reason: string) {
    for (const row of this.rows) if (row.personnelId === personnelId && !row.endedAt) Object.assign(row, { endedAt, endReason: reason });
  }
  async rotate(currentId: string, next: NewRememberMe, endedAt: Date) {
    if (this.rows.some((row) => row.predecessorId === currentId)) return 'lost-race' as const;
    await this.end(currentId, endedAt, 'rotated');
    await this.insert(next);
    return 'rotated' as const;
  }
}

type Entry = AuditAppend | AuthzDeniedEntry;

let clock: { millis: number };
let directory: MemoryDirectory;
let sessions: MemorySessions;
let remember: MemoryRemember;
let trail: Entry[];
let gate: SourceGate;
let capacity: number;
let authenticateCalls: number;

function service(): AuthService {
  const audit: AuditTrailPort = { append: async (entry) => { trail.push(entry); } };
  const credentials = {
    // 认证成功交回当前散列（#132）：改密拿它作条件更新的期望值。
    authenticate: async (_id: string, plain: string) => {
      authenticateCalls += 1;
      return plain === GOOD ? 'fake-current-hash' : null;
    },
    isReused: async () => false,
    changePassword: async () => true,
  } as unknown as CredentialService;
  return new AuthService(
    directory,
    sessions,
    remember,
    audit,
    credentials,
    { now: () => new Date(clock.millis) },
    capacity,
    gate,
  );
}

function addAccount(patch: Partial<LoginAccount> = {}): LoginAccount {
  const account: LoginAccount = {
    id: 'acct-1',
    code: 'P-UNIT-1',
    name: '单测人员',
    passwordChangedAt: new Date(T0 - 10 * DAY),
    deactivatedAt: null,
    failureCount: 0,
    failureWindowStartedAt: null,
    lockedUntil: null,
    orgUnitId: 'org-a',
    orgName: '甲区',
    roles: ['经办'],
    ...patch,
  };
  directory.accounts.set(account.id, account);
  directory.byPhone.set(PHONE, account.id);
  return account;
}

function login(password: string, rememberMe = false) {
  return service().login({ mobilePhone: PHONE, password, rememberMe, cookieHeader: undefined, sourceIp: IP });
}

function actions(): string[] {
  return trail.map((entry) => entry.action);
}

function fillOthers(count: number) {
  for (let i = 0; i < count; i += 1) {
    sessions.rows.push({
      id: `other-${i}`,
      personnelId: `other-${i}`,
      secretHash: `other-${i}`,
      rememberMeChainId: null,
      authenticatedAt: new Date(clock.millis),
      lastSeenAt: new Date(clock.millis),
      absoluteEndsAt: new Date(clock.millis + DAY),
      endedAt: null,
      endReason: null,
    });
  }
}

function blockSource() {
  for (let i = 0; i < 10; i += 1) gate.record(IP, new Date(clock.millis));
}

beforeEach(() => {
  clock = { millis: T0 };
  directory = new MemoryDirectory();
  sessions = new MemorySessions();
  remember = new MemoryRemember();
  trail = [];
  gate = new SourceGate();
  capacity = 7500;
  authenticateCalls = 0;
});

describe('口令登录判定顺序（十个分支）', () => {
  it('1 来源地址闸已生效：口令错误同形，写 login.source-limited，不查人员不验口令，不计账号失败', async () => {
    const account = addAccount();
    blockSource();
    const outcome = await login(GOOD);
    expect(outcome).toEqual({ status: 401, body: { result: 'invalid-credential' } });
    expect(actions()).toEqual(['login.source-limited']);
    expect(trail[0]).toMatchObject({ actorId: null, subjectPersonnelId: null });
    expect(authenticateCalls).toBe(0);
    expect(directory.accounts.get(account.id)!.failureCount).toBe(0);
  });

  it('2 对不上人员：写 login.failed（unknown-identifier），不调用认证器', async () => {
    const outcome = await login(GOOD);
    expect(outcome).toEqual({ status: 401, body: { result: 'invalid-credential' } });
    expect(trail).toEqual([expect.objectContaining({ action: 'login.failed', reason: 'unknown-identifier', actorId: null })]);
    expect(authenticateCalls).toBe(0);
  });

  it('3 已停用：写 login.deactivated，不验口令', async () => {
    addAccount({ deactivatedAt: new Date(T0 - DAY) });
    expect(await login(GOOD)).toEqual({ status: 401, body: { result: 'deactivated' } });
    expect(actions()).toEqual(['login.deactivated']);
    expect(authenticateCalls).toBe(0);
  });

  it('3′ 停用与锁定同时命中：停用优先', async () => {
    addAccount({ deactivatedAt: new Date(T0 - DAY), lockedUntil: new Date(T0 + 10 * MINUTE), failureCount: 5 });
    expect(await login(GOOD)).toEqual({ status: 401, body: { result: 'deactivated' } });
    expect(actions()).toEqual(['login.deactivated']);
  });

  it('4 锁定期内：写 login.locked-retry，不验口令，锁定到期时间不延长', async () => {
    const until = new Date(T0 + 10 * MINUTE);
    const account = addAccount({ lockedUntil: until, failureCount: 5, failureWindowStartedAt: new Date(T0 - 5 * MINUTE) });
    expect(await login(GOOD)).toEqual({ status: 401, body: { result: 'locked' } });
    expect(actions()).toEqual(['login.locked-retry']);
    expect(authenticateCalls).toBe(0);
    expect(directory.accounts.get(account.id)!.lockedUntil).toEqual(until);
  });

  it('5 口令错误使失败次数达到 5：写 login.locked，锁定 30 分钟', async () => {
    const account = addAccount({ failureCount: 4, failureWindowStartedAt: new Date(T0 - 5 * MINUTE) });
    expect(await login('wrong')).toEqual({ status: 401, body: { result: 'locked' } });
    expect(actions()).toEqual(['login.locked']);
    expect(directory.accounts.get(account.id)!.lockedUntil).toEqual(new Date(T0 + 30 * MINUTE));
  });

  it('6 口令错误未达 5 次：写 login.failed（bad-credential），计数加一', async () => {
    const account = addAccount({ failureCount: 1, failureWindowStartedAt: new Date(T0 - MINUTE) });
    expect(await login('wrong')).toEqual({ status: 401, body: { result: 'invalid-credential' } });
    expect(trail).toEqual([expect.objectContaining({ action: 'login.failed', reason: 'bad-credential', actorId: account.id })]);
    expect(directory.accounts.get(account.id)!.failureCount).toBe(2);
  });

  it('6′ 锁定到期后的下一次失败从 1 重新计数', async () => {
    const account = addAccount({
      failureCount: 5,
      failureWindowStartedAt: new Date(T0 - 31 * MINUTE),
      lockedUntil: new Date(T0 - MINUTE),
    });
    expect(await login('wrong')).toEqual({ status: 401, body: { result: 'invalid-credential' } });
    expect(directory.accounts.get(account.id)!.failureCount).toBe(1);
  });

  it('7 口令正确但全系统满员且本人不足 3 段：写 login.capacity-reached，不建会话，失败次数清零', async () => {
    const account = addAccount({ failureCount: 3, failureWindowStartedAt: new Date(T0 - MINUTE) });
    capacity = 2;
    fillOthers(2);
    expect(await login(GOOD)).toEqual({ status: 503, body: { result: 'capacity-reached' } });
    expect(actions()).toEqual(['login.capacity-reached']);
    expect(await sessions.listActive(account.id)).toHaveLength(0);
    expect(directory.accounts.get(account.id)!.failureCount).toBe(0);
  });

  it('8 上次改密时间为空：写 login.password-change-required，建立会话', async () => {
    const account = addAccount({ passwordChangedAt: null });
    const outcome = await login(GOOD);
    expect(outcome).toMatchObject({ status: 200, body: { result: 'password-change-required' } });
    expect(actions()).toEqual(['login.password-change-required']);
    expect(await sessions.listActive(account.id)).toHaveLength(1);
  });

  it('9 距上次改密超过 90 天：写 login.password-expired，建立会话；90 天整不算', async () => {
    const account = addAccount({ passwordChangedAt: new Date(T0 - 90 * DAY - 1) });
    expect(await login(GOOD)).toMatchObject({ status: 200, body: { result: 'password-expired' } });
    expect(actions()).toEqual(['login.password-expired']);
    expect(await sessions.listActive(account.id)).toHaveLength(1);

    trail.length = 0;
    directory.accounts.get(account.id)!.passwordChangedAt = new Date(T0 - 90 * DAY);
    expect(await login(GOOD)).toMatchObject({ status: 200, body: { result: 'established', daysRemaining: 0 } });
    expect(actions()).toEqual(['login.succeeded']);
  });

  it('10 其余情况：写 login.succeeded，建立会话，Cookie 由服务端签发', async () => {
    const account = addAccount();
    const outcome = await login(GOOD);
    expect(outcome.status).toBe(200);
    expect(outcome.body).toEqual({ result: 'established' });
    expect(outcome.setCookies?.[0]).toMatch(/^__Host-sid=[^;]+; HttpOnly; Secure; SameSite=Lax; Path=\/$/);
    expect(actions()).toEqual(['login.succeeded']);
    const [row] = await sessions.listActive(account.id);
    expect(row?.absoluteEndsAt).toEqual(new Date(T0 + 8 * 60 * MINUTE));
  });
});

/** 先口令登录勾选记住我，取出 __Host-rm，再结束会话，留下记住我供免输口令进入。 */
async function rememberedCookie(): Promise<{ cookie: string; row: RememberMeRow }> {
  const outcome = await login(GOOD, true);
  const header = outcome.setCookies?.find((item) => item.startsWith('__Host-rm='));
  if (!header) throw new Error('未发放记住我');
  const pair = header.split(';')[0]!;
  for (const row of sessions.rows) Object.assign(row, { endedAt: new Date(clock.millis), endReason: 'logout' });
  const row = await remember.findBySecretHash(sha(pair.slice('__Host-rm='.length)));
  if (!row) throw new Error('记住我未入库');
  trail.length = 0;
  return { cookie: pair, row };
}

function enter(cookie: string) {
  return service().openRequest(cookie, IP, false, true);
}

describe('记住我免输口令进入判定顺序（六个分支）', () => {
  it('1 来源地址闸已生效：写 login.source-limited，记住我保留不换发', async () => {
    addAccount();
    const { cookie, row } = await rememberedCookie();
    blockSource();
    const resolved = await enter(cookie);
    expect(resolved).toEqual({ active: null, setCookies: [] });
    expect(actions()).toEqual(['login.source-limited']);
    expect((await remember.findBySecretHash(row.secretHash))?.endedAt).toBeNull();
    expect(await remember.findSuccessor(row.id)).toBeNull();
  });

  it('2 已停用：写 login.deactivated，结束全部会话与全部记住我', async () => {
    const account = addAccount();
    const { cookie, row } = await rememberedCookie();
    directory.accounts.get(account.id)!.deactivatedAt = new Date(T0);
    const resolved = await enter(cookie);
    expect(resolved.active).toBeNull();
    expect(actions()).toEqual(['login.deactivated']);
    expect((await remember.findBySecretHash(row.secretHash))?.endReason).toBe('personnel-deactivated');
  });

  it('3 锁定期内：写 login.locked-retry，记住我保留不换发，锁定不延长', async () => {
    const account = addAccount();
    const { cookie, row } = await rememberedCookie();
    const until = new Date(T0 + 20 * MINUTE);
    directory.accounts.get(account.id)!.lockedUntil = until;
    const resolved = await enter(cookie);
    expect(resolved).toEqual({ active: null, setCookies: [] });
    expect(actions()).toEqual(['login.locked-retry']);
    expect(await remember.findSuccessor(row.id)).toBeNull();
    expect(directory.accounts.get(account.id)!.lockedUntil).toEqual(until);
  });

  it('4 全系统满员且本人不足 3 段：写 login.capacity-reached，记住我保留', async () => {
    addAccount();
    const { cookie, row } = await rememberedCookie();
    capacity = 1;
    fillOthers(1);
    const resolved = await enter(cookie);
    expect(resolved).toEqual({ active: null, setCookies: [] });
    expect(actions()).toEqual(['login.capacity-reached']);
    expect((await remember.findBySecretHash(row.secretHash))?.endedAt).toBeNull();
  });

  it('5 处于强制改密：建立会话并换发，写 login.password-change-required', async () => {
    const account = addAccount();
    const { cookie, row } = await rememberedCookie();
    directory.accounts.get(account.id)!.passwordChangedAt = null;
    const resolved = await enter(cookie);
    expect(resolved.active?.account.id).toBe(account.id);
    expect(actions()).toEqual(['login.password-change-required']);
    expect((await remember.findBySecretHash(row.secretHash))?.endReason).toBe('rotated');
  });

  it('6 其余情况：建立会话、换发秘密，写 login.succeeded，终点与 Cookie 过期时间不往后推', async () => {
    const account = addAccount();
    const { cookie, row } = await rememberedCookie();
    clock.millis = T0 + 60 * MINUTE;
    const resolved = await enter(cookie);
    expect(resolved.active?.account.id).toBe(account.id);
    expect(resolved.active?.row.absoluteEndsAt).toEqual(row.absoluteEndsAt);
    expect(actions()).toEqual(['login.succeeded']);
    const successor = await remember.findSuccessor(row.id);
    expect(successor?.absoluteEndsAt).toEqual(row.absoluteEndsAt);
    const rm = resolved.setCookies.find((item) => item.startsWith('__Host-rm='));
    expect(rm).toContain(`Expires=${row.absoluteEndsAt.toUTCString()}`);
  });

  it('记住我进入不计入账号失败次数和地址闸', async () => {
    const account = addAccount();
    const { cookie } = await rememberedCookie();
    for (let i = 0; i < 12; i += 1) {
      for (const session of sessions.rows) Object.assign(session, { endedAt: new Date(clock.millis), endReason: 'logout' });
      directory.accounts.get(account.id)!.lockedUntil = new Date(clock.millis + MINUTE);
      await enter(cookie);
    }
    expect(directory.accounts.get(account.id)!.failureCount).toBe(0);
    expect(gate.blocked(IP, new Date(clock.millis))).toBe(false);
  });
});

describe('会话结束的先后（#116）', () => {
  it('测试替身按 (认证时间, 会话 id) 排序：认证时间相同时按 id 升序', async () => {
    const account = addAccount();
    const row = {
      personnelId: account.id,
      secretHash: 'x',
      rememberMeChainId: null,
      lastSeenAt: new Date(T0),
      absoluteEndsAt: new Date(T0 + DAY),
      endedAt: null,
      endReason: null,
    };
    sessions.rows.push({ ...row, id: 'B', authenticatedAt: new Date(T0) });
    sessions.rows.push({ ...row, id: 'A', authenticatedAt: new Date(T0) });
    sessions.rows.push({ ...row, id: 'C', authenticatedAt: new Date(T0 - 1) });
    const listed = await sessions.listActive(account.id);
    expect(listed.map((item) => item.id)).toEqual(['C', 'A', 'B']);
  });

  it('同一毫秒内连续登录三次，第四次结束的是先建立的那一段（displaced）', async () => {
    addAccount();
    const created: string[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < 3; i += 1) {
      await login(GOOD);
      // 替身里的行按写入顺序排，故此处取的是建立先后，不依赖排序键。
      for (const row of sessions.rows) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        created.push(row.id);
      }
    }
    expect(created).toHaveLength(3);
    const rows = created.map((id) => sessions.rows.find((row) => row.id === id)!);
    // 三段的认证时间落在同一毫秒——正是排序键要定先后的情形。
    expect(new Set(rows.map((row) => row.authenticatedAt.getTime())).size).toBe(1);
    // 会话 id 由进程内单调生成器给出，同一毫秒内后建立的那段更大。
    expect(created[0] < created[1]).toBe(true);
    expect(created[1] < created[2]).toBe(true);

    await login(GOOD);
    const displaced = sessions.rows.find((row) => row.id === created[0])!;
    expect(displaced.endedAt).not.toBeNull();
    expect(displaced.endReason).toBe('displaced');
    expect(sessions.rows.find((row) => row.id === created[1])!.endedAt).toBeNull();
    expect(sessions.rows.find((row) => row.id === created[2])!.endedAt).toBeNull();
  });
});
