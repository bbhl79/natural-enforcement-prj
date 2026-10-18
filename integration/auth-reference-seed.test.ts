// #92：参照种子与开发夹具写入后，从库中读到结果。
// 预期允许行来自 GitHub issue #71 决议，不从种子源码推导。
// 断言打在克隆库上。结束时删除克隆库。开发库只被读取作为复制源。
import { execFile } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promisify } from 'node:util';
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../backend/prisma/generated/prisma/client.ts';

const execFileAsync = promisify(execFile);

const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function newUlid(): string {
  let time = BigInt(Date.now());
  let id = '';
  for (let i = 0; i < 10; i += 1) {
    id = CROCKFORD[Number(time % 32n)] + id;
    time /= 32n;
  }
  const random = crypto.getRandomValues(new Uint8Array(16));
  for (const byte of random) id += CROCKFORD[byte % 32];
  if (!ULID.test(id)) throw new Error('ULID 生成结果不符合形制');
  return id;
}

/** #71 决议表。键是角色名。值是该角色的操作码。 */
const EXPECTED_ALLOWANCES: Record<string, readonly string[]> = {
  内勤: [
    'org.tree.read',
    'clue.org.assign',
    'clue.handler.assign',
    'case.reassign.submit',
    'clue.read',
    'case.read',
    'doc.read',
  ],
  经办: [
    'clue.verify.start',
    'case.open',
    'doc.draft',
    'doc.submit',
    'case.reassign.submit',
    'legal.review.request',
    'clue.read',
    'case.read',
    'doc.read',
    'clue.export',
    'case.export',
    'doc.export',
  ],
  法制审核: [
    'legal.opinion.draft',
    'legal.opinion.submit',
    'clue.read',
    'case.read',
    'doc.read',
    'clue.export',
    'case.export',
    'doc.export',
  ],
  行政审核: [
    'legal.review.request',
    'doc.admin.review',
    'clue.read',
    'case.read',
    'doc.read',
    'clue.export',
    'case.export',
    'doc.export',
  ],
  行政审批: [
    'legal.review.request',
    'doc.approve',
    'clue.read',
    'case.read',
    'doc.read',
    'clue.export',
    'case.export',
    'doc.export',
  ],
  监督: [
    'clue.read',
    'case.read',
    'doc.read',
    'clue.export',
    'case.export',
    'doc.export',
    'audit.admin.read',
    'audit.admin.export',
  ],
  系统管理: [
    ...['template', 'rule', 'calendar', 'metric'].flatMap((object) =>
      ['submit', 'approve', 'void', 'withdraw', 'read'].map((action) => `cfg.${object}.${action}`),
    ),
    'org.tree.read',
    'org.unit.register',
    'org.unit.rename',
    'org.unit.deactivate',
    'personnel.profile.read',
    'personnel.profile.register',
    'personnel.cert.update',
    'personnel.profile.update',
    'personnel.profile.deactivate',
    'personnel.profile.restore',
    'personnel.sessions.end',
    'personnel.locked.read',
    'personnel.locked.release',
    'personnel.password.reset',
    'personnel.profile.export',
    'audit.admin.read',
    'audit.admin.export',
    'authz.binding.submit',
    'authz.binding.approve',
  ],
};

const FIXTURES = [
  { code: 'P-SUP-A', roles: ['系统管理'], mobilePhone: '13800001001' },
  { code: 'P-CLERK-A', roles: ['经办'], mobilePhone: '13800001002' },
  { code: 'P-CLERK-B', roles: ['经办'], mobilePhone: '13800001003' },
  // #126（M4）：当前任职在根机构的监督。
  { code: 'P-SUPER-HQ', roles: ['监督'], mobilePhone: '13800001011' },
] as const;

let prisma = undefined as unknown as PrismaClient;
let adminPrisma: PrismaClient | undefined;
let scratchDbName = '';
let deptAId = '';

function quoteIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`非法数据库标识：${name}`);
  }
  return `"${name}"`;
}

function sorted(codes: readonly string[]): string[] {
  return [...codes].sort();
}

async function loadAllowances(client: PrismaClient): Promise<Record<string, string[]>> {
  const rows = await client.rolePermission.findMany({
    where: {
      deactivatedAt: null,
      role: { deactivatedAt: null },
      permission: { deactivatedAt: null },
    },
    include: { role: true, permission: true },
  });
  const grouped: Record<string, string[]> = {};
  for (const row of rows) {
    const name = row.role.name;
    grouped[name] ??= [];
    grouped[name].push(row.permission.code);
  }
  for (const name of Object.keys(grouped)) {
    const codes = grouped[name];
    if (codes) codes.sort();
  }
  return grouped;
}

async function expectReferenceSeed(client: PrismaClient): Promise<void> {
  const roles = await client.role.findMany({ where: { deactivatedAt: null } });
  expect(roles.map((role) => role.name).sort()).toEqual(Object.keys(EXPECTED_ALLOWANCES).sort());
  for (const role of roles) expect(role.id).toMatch(ULID);

  const permissions = await client.permission.findMany({ where: { deactivatedAt: null } });
  const expectedOpcodes = sorted(
    [...new Set(Object.values(EXPECTED_ALLOWANCES).flat())],
  );
  expect(permissions.map((permission) => permission.code).sort()).toEqual(expectedOpcodes);
  for (const permission of permissions) expect(permission.id).toMatch(ULID);

  const actual = await loadAllowances(client);
  expect(Object.keys(actual).sort()).toEqual(Object.keys(EXPECTED_ALLOWANCES).sort());
  for (const [role, codes] of Object.entries(EXPECTED_ALLOWANCES)) {
    expect(actual[role]).toEqual(sorted(codes));
  }

  const bindingHolders = new Set<string>();
  for (const [role, codes] of Object.entries(actual)) {
    if (codes.includes('authz.binding.submit') || codes.includes('authz.binding.approve')) {
      bindingHolders.add(role);
    }
  }
  expect([...bindingHolders]).toEqual(['系统管理']);
  expect(actual['系统管理']).toEqual(
    expect.arrayContaining(['authz.binding.submit', 'authz.binding.approve']),
  );
}

beforeAll(async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL 未注入（须由 dev test integration harness 提供）');
  const source = new URL(databaseUrl);
  const sourceDb = decodeURIComponent(source.pathname.replace(/^\//, ''));
  scratchDbName = `auth92_${Date.now()}`;
  const adminUrl = new URL(databaseUrl);
  adminUrl.pathname = '/template1';
  adminPrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: adminUrl.toString() }) });
  let created = false;
  let lastError: unknown;
  for (let attempt = 0; attempt < 10 && !created; attempt += 1) {
    try {
      await adminPrisma.$executeRawUnsafe(
        `CREATE DATABASE ${quoteIdent(scratchDbName)} TEMPLATE ${quoteIdent(sourceDb)}`,
      );
      created = true;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  if (!created) throw lastError;
  const scratchUrl = new URL(databaseUrl);
  scratchUrl.pathname = `/${scratchDbName}`;
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: scratchUrl.toString() }) });
  deptAId = (await prisma.orgUnit.findUniqueOrThrow({ where: { code: 'ORG-DEPT-A' } })).id;
});

afterAll(async () => {
  await prisma?.$disconnect();
  if (adminPrisma && scratchDbName) {
    await adminPrisma.$executeRawUnsafe(
      `DROP DATABASE IF EXISTS ${quoteIdent(scratchDbName)} WITH (FORCE)`,
    );
    await adminPrisma.$disconnect();
  }
});

describe('参照种子可从库中读到', () => {
  it('七个角色、操作码名册与允许行已写入，改允许行只给系统管理', async () => {
    await expectReferenceSeed(prisma);
  });

  it('开发夹具人员带角色、手机号，上次改密时间为空', async () => {
    for (const fixture of FIXTURES) {
      const person = await prisma.personnel.findUniqueOrThrow({
        where: { code: fixture.code },
        include: { personnelRoles: { where: { deactivatedAt: null }, include: { role: true } } },
      });
      expect(person.personnelRoles.map((row) => row.role.name).sort()).toEqual([...fixture.roles].sort());
      expect(person.mobilePhone).toBe(fixture.mobilePhone);
      expect(person.passwordChangedAt).toBeNull();
      expect(person.passwordFailureCount).toBe(0);
      expect(person.passwordFailureWindowStartedAt).toBeNull();
      expect(person.lockedUntil).toBeNull();
    }
  });
});

describe('人员手机号有值时全库唯一', () => {
  it('空手机号可以有多条，已有手机号不能再写入', async () => {
    const first = newUlid();
    const second = newUlid();
    await prisma.personnel.create({
      data: { id: first, code: `e92-a-${first.slice(0, 8).toLowerCase()}`, name: '空号甲', orgUnitId: deptAId },
    });
    await prisma.personnel.create({
      data: { id: second, code: `e92-b-${second.slice(0, 8).toLowerCase()}`, name: '空号乙', orgUnitId: deptAId },
    });
    const duplicate = newUlid();
    await expect(
      prisma.personnel.create({
        data: {
          id: duplicate,
          code: `e92-c-${duplicate.slice(0, 8).toLowerCase()}`,
          name: '重复号',
          orgUnitId: deptAId,
          mobilePhone: '13800001001',
        },
      }),
    ).rejects.toThrow();
  });
});

describe('角色与权限记录只失效不删除', () => {
  it('四张表拒绝删除，只允许一次失效', async () => {
    const roleId = newUlid();
    const permissionId = newUlid();
    const allowId = newUlid();
    const bindingId = newUlid();
    const person = await prisma.personnel.findUniqueOrThrow({ where: { code: 'P-SUP-A' } });
    await prisma.role.create({ data: { id: roleId, name: `临时角色-${roleId.slice(0, 8)}` } });
    await prisma.permission.create({ data: { id: permissionId, code: `tmp.opcode.${permissionId.slice(0, 8).toLowerCase()}` } });
    await prisma.rolePermission.create({ data: { id: allowId, roleId, permissionId } });
    await prisma.personnelRole.create({ data: { id: bindingId, personnelId: person.id, roleId } });

    await expect(prisma.role.update({ where: { id: roleId }, data: { name: '改名' } })).rejects.toThrow(/拒绝 UPDATE/);
    await prisma.role.update({ where: { id: roleId }, data: { deactivatedAt: new Date() } });
    await expect(
      prisma.role.update({ where: { id: roleId }, data: { deactivatedAt: new Date() } }),
    ).rejects.toThrow(/拒绝 UPDATE/);
    await expect(prisma.$executeRaw`DELETE FROM "role" WHERE id = ${roleId}`).rejects.toThrow(/拒绝 DELETE/);

    await expect(
      prisma.permission.update({ where: { id: permissionId }, data: { code: 'tmp.renamed' } }),
    ).rejects.toThrow(/拒绝 UPDATE/);
    await prisma.permission.update({ where: { id: permissionId }, data: { deactivatedAt: new Date() } });
    await expect(prisma.$executeRaw`DELETE FROM permission WHERE id = ${permissionId}`).rejects.toThrow(/拒绝 DELETE/);

    await expect(
      prisma.rolePermission.update({ where: { id: allowId }, data: { roleId } }),
    ).rejects.toThrow(/拒绝 UPDATE/);
    await expect(prisma.$executeRaw`DELETE FROM role_permission WHERE id = ${allowId}`).rejects.toThrow(
      /拒绝 DELETE/,
    );
    await prisma.rolePermission.update({ where: { id: allowId }, data: { deactivatedAt: new Date() } });

    await expect(prisma.$executeRaw`DELETE FROM personnel_role WHERE id = ${bindingId}`).rejects.toThrow(
      /拒绝 DELETE/,
    );
    await prisma.personnelRole.update({ where: { id: bindingId }, data: { deactivatedAt: new Date() } });
  });
});

describe('留痕表拒绝更新和删除', () => {
  it('直接 UPDATE 或 DELETE 被触发器拒绝', async () => {
    const id = newUlid();
    await prisma.$executeRaw`
      INSERT INTO audit_trail (id, action, outcome, reason)
      VALUES (${id}, 'login.failed', 'failed', 'bad-credential')
    `;
    await expect(
      prisma.$executeRaw`UPDATE audit_trail SET action = 'login.succeeded' WHERE id = ${id}`,
    ).rejects.toThrow(/拒绝 UPDATE/);
    await expect(prisma.$executeRaw`DELETE FROM audit_trail WHERE id = ${id}`).rejects.toThrow(/拒绝 DELETE/);
    const stored = await prisma.$queryRaw<Array<{ action: string; outcome: string }>>`
      SELECT action, outcome FROM audit_trail WHERE id = ${id}
    `;
    expect(stored[0]?.action).toBe('login.failed');
    expect(stored[0]?.outcome).toBe('failed');
  });
});

describe('生产环境不写入夹具人员', () => {
  it('NODE_ENV=production 时参照种子仍在，人员与机构不在', async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl || !adminPrisma) throw new Error('DATABASE_URL 未注入');
    const prodDbName = `auth92_prod_${Date.now()}`;
    const prodUrl = new URL(databaseUrl);
    prodUrl.pathname = `/${prodDbName}`;
    const env = { ...process.env, DATABASE_URL: prodUrl.toString(), NODE_ENV: 'production' };
    const prismaDir = `${process.cwd()}/backend/prisma`;
    await adminPrisma.$executeRawUnsafe(`CREATE DATABASE ${quoteIdent(prodDbName)}`);
    let prodPrisma: PrismaClient | undefined;
    try {
      await execFileAsync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
        cwd: prismaDir,
        env,
        timeout: 120_000,
      });
      await execFileAsync(
        'node',
        [
          '--experimental-transform-types',
          '--disable-warning=ExperimentalWarning',
          '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
          'seed.mjs',
        ],
        { cwd: prismaDir, env, timeout: 120_000 },
      );
      prodPrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: prodUrl.toString() }) });
      await expectReferenceSeed(prodPrisma);
      expect(await prodPrisma.personnel.count()).toBe(0);
      expect(await prodPrisma.orgUnit.count()).toBe(0);
      expect(await prodPrisma.migrationProbe.count({ where: { note: 'seed-probe' } })).toBe(1);
    } finally {
      await prodPrisma?.$disconnect();
      await adminPrisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${quoteIdent(prodDbName)} WITH (FORCE)`);
    }
  }, 180_000);
});

describe('再次播种不恢复已撤销的授权', () => {
  it('允许行、操作码或人员—角色失效后再跑种子，仍保持失效且不新建替代行', async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl || !adminPrisma) throw new Error('DATABASE_URL 未注入');
    const dbName = `auth92_reseed_${Date.now()}`;
    const url = new URL(databaseUrl);
    url.pathname = `/${dbName}`;
    const env = { ...process.env, DATABASE_URL: url.toString() };
    const prismaDir = `${process.cwd()}/backend/prisma`;
    const seed = () =>
      execFileAsync(
        'node',
        [
          '--experimental-transform-types',
          '--disable-warning=ExperimentalWarning',
          '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
          'seed.mjs',
        ],
        { cwd: prismaDir, env, timeout: 120_000 },
      );
    await adminPrisma.$executeRawUnsafe(`CREATE DATABASE ${quoteIdent(dbName)}`);
    let client: PrismaClient | undefined;
    try {
      await execFileAsync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
        cwd: prismaDir,
        env,
        timeout: 120_000,
      });
      await seed();
      client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }) });
      const admin = await client.role.findFirstOrThrow({ where: { name: '系统管理' } });
      const unlock = await client.permission.findFirstOrThrow({ where: { code: 'personnel.locked.release' } });
      const reset = await client.permission.findFirstOrThrow({ where: { code: 'personnel.password.reset' } });
      const unlockAllow = await client.rolePermission.findFirstOrThrow({
        where: { roleId: admin.id, permissionId: unlock.id },
      });
      const person = await client.personnel.findUniqueOrThrow({ where: { code: 'P-SUP-A' } });
      const binding = await client.personnelRole.findFirstOrThrow({
        where: { personnelId: person.id, roleId: admin.id },
      });
      await client.rolePermission.update({ where: { id: unlockAllow.id }, data: { deactivatedAt: new Date() } });
      await client.permission.update({ where: { id: reset.id }, data: { deactivatedAt: new Date() } });
      await client.personnelRole.update({ where: { id: binding.id }, data: { deactivatedAt: new Date() } });

      await seed();

      expect(
        await client.rolePermission.count({
          where: { roleId: admin.id, permissionId: unlock.id, deactivatedAt: null },
        }),
      ).toBe(0);
      expect(await client.permission.count({ where: { code: 'personnel.password.reset', deactivatedAt: null } })).toBe(0);
      expect(await client.rolePermission.count({ where: { permissionId: reset.id, deactivatedAt: null } })).toBe(1);
      expect(
        await client.personnelRole.count({
          where: { personnelId: person.id, roleId: admin.id, deactivatedAt: null },
        }),
      ).toBe(0);
    } finally {
      await client?.$disconnect();
      await adminPrisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${quoteIdent(dbName)} WITH (FORCE)`);
    }
  }, 180_000);
});
