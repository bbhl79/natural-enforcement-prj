// A6：七个角色的种子人员各自经 HTTP 登录，会话报告的角色与机构按职责分域，
// 管理台接口只对系统管理放行，其余角色按 permission-denied 拒绝并留痕。
// 断言打在 HTTP 状态码、响应体和留痕行上。断言打在克隆库上。
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../backend/server/src/persistence.module.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const T0 = Date.parse('2026-10-17T03:00:00.000Z');
const clock = { millis: T0 };
const SEED_PASSWORD = 'Seed-pass-52';
const NEW_PASSWORD = 'Split-role-91!';

/** 种子夹具（backend/prisma/seed.mjs）。期望独立写出，不从种子源码推导。 */
const SEEDED = [
  { code: 'P-INTAKE-HQ', phone: '13800001004', roles: ['内勤'], orgName: '自然执法总队' },
  { code: 'P-CLERK-A', phone: '13800001002', roles: ['经办'], orgName: '第一执法支队' },
  { code: 'P-LEGAL-ST', phone: '13800001005', roles: ['法制审核'], orgName: '甲区执法所' },
  { code: 'P-REVIEW-A', phone: '13800001006', roles: ['行政审核'], orgName: '第一执法支队' },
  { code: 'P-APPROVE-HQ', phone: '13800001007', roles: ['行政审批'], orgName: '自然执法总队' },
  { code: 'P-SUPER-B', phone: '13800001008', roles: ['监督'], orgName: '第二执法支队' },
  { code: 'P-SUP-A', phone: '13800001001', roles: ['系统管理'], orgName: '第一执法支队' },
] as const;

let cloned: ClonedDatabase;
let baseUrl = '';
let closeApp: () => Promise<void> = async () => {};

function sessionCookie(response: Response): string {
  const found = response.headers.getSetCookie().find((item) => item.startsWith('__Host-sid='));
  const pair = found?.split(';')[0];
  if (!pair) throw new Error('缺少会话 Cookie');
  return pair;
}

/** 留痕只经表名读取。留痕委托只许留痕设施包引用（ADR 0012）。 */
async function denialsOf(actorId: string): Promise<Array<{ reason: string | null; opcode: string | null; actor_code: string | null }>> {
  return cloned.prisma.$queryRaw`
    SELECT reason, opcode, actor_code FROM audit_trail
    WHERE action = 'authz.denied' AND actor_id = ${actorId}
    ORDER BY created_at, id
  `;
}

async function signIn(phone: string): Promise<string> {
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mobilePhone: phone, password: SEED_PASSWORD, rememberMe: false }),
  });
  expect(login.status).toBe(200);
  // 种子人员不豁免首登改密。
  expect(await login.json()).toEqual({ result: 'password-change-required' });
  const cookie = sessionCookie(login);
  const changed = await fetch(`${baseUrl}/api/auth/password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ currentPassword: SEED_PASSWORD, newPassword: NEW_PASSWORD }),
  });
  expect(changed.status).toBe(200);
  expect(await changed.json()).toEqual({ result: 'established' });
  return cookie;
}

beforeAll(async () => {
  cloned = await openClonedDatabase();
  const app = await createApplication(cloned.connectionString, { now: () => new Date(clock.millis) });
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeApp = () => app.close();
}, 60_000);

afterAll(async () => {
  await closeApp();
  await cloned?.close();
});

describe('A6：七个角色经 HTTP 登录并按职责分域', () => {
  it('每个角色的种子人员登录后，会话只报告本人角色和本人机构', async () => {
    const seen = new Set<string>();
    for (const fixture of SEEDED) {
      const cookie = await signIn(fixture.phone);
      const response = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie } });
      expect(response.status).toBe(200);
      const body = await response.json() as Record<string, unknown>;
      expect(body).toMatchObject({
        result: 'authenticated',
        code: fixture.code,
        orgName: fixture.orgName,
        passwordChangeRequired: false,
      });
      expect(body.roles).toEqual(fixture.roles);
      expect(JSON.stringify(body)).not.toContain(fixture.phone);
      for (const role of fixture.roles) seen.add(role);
    }
    expect([...seen].sort()).toEqual(
      ['内勤', '经办', '法制审核', '行政审核', '行政审批', '监督', '系统管理'].sort(),
    );
  });

  it('兼任监督与经办的人员，会话报告两个角色的并集', async () => {
    const cookie = await signIn('13800001009');
    const body = await (await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie } })).json() as {
      roles: string[];
      code: string;
    };
    expect(body.code).toBe('P-BOTH-A');
    expect([...body.roles].sort()).toEqual(['监督', '经办'].sort());
  });

  it('管理台接口只对系统管理放行，其余六个角色按 permission-denied 拒绝并写下操作码', async () => {
    for (const fixture of SEEDED) {
      const login = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mobilePhone: fixture.phone, password: NEW_PASSWORD, rememberMe: false }),
      });
      expect(login.status).toBe(200);
      const cookie = sessionCookie(login);
      const person = await cloned.prisma.personnel.findUniqueOrThrow({ where: { code: fixture.code } });
      const before = (await denialsOf(person.id)).length;
      const list = await fetch(`${baseUrl}/api/admin/locked-personnel`, { headers: { cookie } });
      if ((fixture.roles as readonly string[]).includes('系统管理')) {
        expect(list.status).toBe(200);
        expect(await list.json()).toHaveProperty('personnel');
        continue;
      }
      expect(list.status).toBe(403);
      expect(await list.json()).toEqual({ reason: 'permission-denied' });
      const denials = await denialsOf(person.id);
      expect(denials).toHaveLength(before + 1);
      expect(denials.at(-1)).toMatchObject({
        reason: 'permission-denied',
        opcode: 'personnel.locked.read',
        actor_code: fixture.code,
      });
    }
  });
});
