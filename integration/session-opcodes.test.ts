// #122 菜单来源：会话查询返回「本人允许的操作码清单」。
// 等价性：对每个种子人员和名册里的每个码，「会话清单有这个码」当且仅当
// 「对本人任职机构授权能通过」。监督对改变主状态的码给反例。
// 清单经 HTTP 会话查询取得；授权经 AccessControlService 判定。断言打在克隆库上。
import type { AddressInfo } from 'node:net';

import { PrismaAuditTrail } from '@natural-enforcement/audit';
import { OPCODES, opcodeRequirements } from '@natural-enforcement/shield';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  AccessControlService,
  isAccessDenied,
  newUlid,
} from '../backend/identity/src/index.ts';
import { PrismaIdentityStore } from '../backend/identity/src/persistence/prisma-identity-store.ts';
import { createApplication } from '../backend/server/src/persistence.module.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const T0 = Date.parse('2026-10-17T03:00:00.000Z');
const SEED_PASSWORD = 'Seed-pass-52';
const NEW_PASSWORD = 'Menu-opcode-73!';

/**
 * 管理台菜单所需的码（frontend/src/shell/menu.ts）。期望独立写出。
 * 「机构」菜单按维护码出现（#123）：org.tree.read 也给内勤（业务侧选承办机构），不作为管理台菜单码。
 */
const ADMIN_MENU_OPCODES = [
  'org.unit.register',
  'org.unit.rename',
  'personnel.profile.read',
  'personnel.locked.read',
  'audit.admin.read',
] as const;

let cloned: ClonedDatabase;
let access: AccessControlService;
let baseUrl = '';
let closeApp: () => Promise<void> = async () => {};

interface SeededPerson {
  id: string;
  code: string;
  mobilePhone: string;
}

function sessionCookie(response: Response): string {
  const found = response.headers.getSetCookie().find((item) => item.startsWith('__Host-sid='));
  const pair = found?.split(';')[0];
  if (!pair) throw new Error('缺少会话 Cookie');
  return pair;
}

const cookies = new Map<string, string>();

/** 首次登录改密后留下会话；之后复用同一会话。 */
async function cookieOf(person: SeededPerson): Promise<string> {
  const known = cookies.get(person.code);
  if (known) return known;
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mobilePhone: person.mobilePhone, password: SEED_PASSWORD, rememberMe: false }),
  });
  expect(login.status).toBe(200);
  expect(await login.json()).toEqual({ result: 'password-change-required' });
  const cookie = sessionCookie(login);
  const gated = await (await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie } })).json() as {
    opcodes: string[];
  };
  // 强制改密期间其余接口一律 403，清单为空。
  expect(gated.opcodes).toEqual([]);
  const changed = await fetch(`${baseUrl}/api/auth/password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ currentPassword: SEED_PASSWORD, newPassword: NEW_PASSWORD }),
  });
  expect(changed.status).toBe(200);
  cookies.set(person.code, cookie);
  return cookie;
}

async function sessionOpcodes(person: SeededPerson): Promise<string[]> {
  const response = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: await cookieOf(person) } });
  expect(response.status).toBe(200);
  const body = await response.json() as { result: string; opcodes: string[] };
  expect(body.result).toBe('authenticated');
  return body.opcodes;
}

async function seededPeople(): Promise<SeededPerson[]> {
  const rows = await cloned.prisma.personnel.findMany({
    where: { deactivatedAt: null, mobilePhone: { not: null }, passwordHash: { not: null } },
    orderBy: { code: 'asc' },
  });
  return rows.map((row) => ({ id: row.id, code: row.code, mobilePhone: row.mobilePhone as string }));
}

async function ownOrgUnitId(personnelId: string): Promise<string> {
  const assignment = await cloned.prisma.personnelAssignment.findFirstOrThrow({
    where: { personnelId, endedAt: null },
  });
  return assignment.orgUnitId;
}

async function authorizes(personnelId: string, opcode: string, orgUnitId: string): Promise<boolean> {
  try {
    await access.authorize({ personnelId, authenticated: true }, opcode, orgUnitId);
    return true;
  } catch (error) {
    if (!isAccessDenied(error)) throw error;
    return false;
  }
}

async function personByCode(code: string): Promise<SeededPerson> {
  const found = (await seededPeople()).find((person) => person.code === code);
  if (!found) throw new Error(`缺少种子人员 ${code}`);
  return found;
}

beforeAll(async () => {
  cloned = await openClonedDatabase();
  access = new AccessControlService(new PrismaIdentityStore(cloned.prisma), new PrismaAuditTrail(cloned.prisma));
  const app = await createApplication(cloned.connectionString, { now: () => new Date(T0) });
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeApp = () => app.close();
}, 60_000);

afterAll(async () => {
  await closeApp();
  await cloned?.close();
});

describe('#122 会话查询返回本人允许的操作码清单', () => {
  it('未登录的会话查询不带清单', async () => {
    const response = await fetch(`${baseUrl}/api/auth/session`);
    expect(await response.json()).toEqual({ result: 'anonymous' });
  });

  it('等价性：每个种子人员 × 名册每个码，清单有这个码当且仅当对本人任职机构授权能通过', async () => {
    const people = await seededPeople();
    expect(people.length).toBeGreaterThanOrEqual(10);
    for (const person of people) {
      const listed = await sessionOpcodes(person);
      expect(listed.every((code) => OPCODES.includes(code))).toBe(true);
      const orgUnitId = await ownOrgUnitId(person.id);
      for (const opcode of OPCODES) {
        const passed = await authorizes(person.id, opcode, orgUnitId);
        expect({ code: person.code, opcode, listed: listed.includes(opcode) })
          .toEqual({ code: person.code, opcode, listed: passed });
      }
    }
  });

  it('兼任监督与经办的人员，清单是两个角色清单的并集', async () => {
    const both = await sessionOpcodes(await personByCode('P-BOTH-A'));
    const supervisor = await sessionOpcodes(await personByCode('P-SUPER-B'));
    const handler = await sessionOpcodes(await personByCode('P-CLERK-A'));
    expect([...both].sort()).toEqual([...new Set([...supervisor, ...handler])].sort());
  });

  it('没有管理权的人员清单里没有任何管理台菜单所需的码；系统管理有', async () => {
    for (const code of ['P-CLERK-A', 'P-INTAKE-HQ', 'P-LEGAL-ST', 'P-REVIEW-A', 'P-APPROVE-HQ']) {
      const listed = await sessionOpcodes(await personByCode(code));
      expect({ code, admin: listed.filter((item) => (ADMIN_MENU_OPCODES as readonly string[]).includes(item)) })
        .toEqual({ code, admin: [] });
    }
    expect(await sessionOpcodes(await personByCode('P-SUP-A'))).toContain('personnel.locked.read');
  });

  it('机构树读码（#123）：内勤和系统管理有，其余种子角色没有；维护码只有系统管理有', async () => {
    const intake = await sessionOpcodes(await personByCode('P-INTAKE-HQ'));
    expect(intake).toContain('org.tree.read');
    expect(intake).not.toContain('org.unit.register');
    expect(intake).not.toContain('org.unit.rename');
    for (const code of ['P-SUP-A', 'P-ADMIN-HQ']) {
      const listed = await sessionOpcodes(await personByCode(code));
      expect({ code, listed: ['org.tree.read', 'org.unit.register', 'org.unit.rename'].filter((item) => listed.includes(item)) })
        .toEqual({ code, listed: ['org.tree.read', 'org.unit.register', 'org.unit.rename'] });
    }
    for (const code of ['P-CLERK-A', 'P-LEGAL-ST', 'P-REVIEW-A', 'P-APPROVE-HQ', 'P-SUPER-B']) {
      expect({ code, read: (await sessionOpcodes(await personByCode(code))).includes('org.tree.read') })
        .toEqual({ code, read: false });
    }
  });

  it('监督反例：给监督角色补改变主状态的允许行，清单仍不含该码、授权仍拒绝；兼任经办时由经办贡献', async () => {
    const primary = OPCODES.filter((code) => opcodeRequirements(code)?.changesPrimaryState);
    expect(primary).toContain('case.open');
    const role = await cloned.prisma.role.findFirstOrThrow({ where: { name: '监督', deactivatedAt: null } });
    for (const code of primary) {
      const permission = await cloned.prisma.permission.findFirstOrThrow({ where: { code, deactivatedAt: null } });
      await cloned.prisma.rolePermission.create({
        data: { id: newUlid(), roleId: role.id, permissionId: permission.id },
      });
    }
    const supervisor = await personByCode('P-SUPER-B');
    const listed = await sessionOpcodes(supervisor);
    const orgUnitId = await ownOrgUnitId(supervisor.id);
    for (const code of primary) {
      expect({ code, listed: listed.includes(code) }).toEqual({ code, listed: false });
      expect({ code, passed: await authorizes(supervisor.id, code, orgUnitId) }).toEqual({ code, passed: false });
    }
    const both = await personByCode('P-BOTH-A');
    expect(await sessionOpcodes(both)).toContain('case.open');
    expect(await authorizes(both.id, 'case.open', await ownOrgUnitId(both.id))).toBe(true);
  });

  it('角色调整在下一次会话查询时反映到清单', async () => {
    const handler = await personByCode('P-CLERK-A');
    expect(await sessionOpcodes(handler)).not.toContain('personnel.locked.read');
    const role = await cloned.prisma.role.findFirstOrThrow({ where: { name: '系统管理', deactivatedAt: null } });
    const grant = await cloned.prisma.personnelRole.create({
      data: { id: newUlid(), personnelId: handler.id, roleId: role.id },
    });
    expect(await sessionOpcodes(handler)).toContain('personnel.locked.read');
    await cloned.prisma.personnelRole.update({ where: { id: grant.id }, data: { deactivatedAt: new Date(T0) } });
    expect(await sessionOpcodes(handler)).not.toContain('personnel.locked.read');
  });
});
