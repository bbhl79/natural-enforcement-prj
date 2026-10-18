// #131：生产引导命令（#105「生产引导命令（D5）」，ADR 0013 第 3 条）。
// 空库按生产顺序准备：迁移（prisma migrate deploy）→ 参照种子（NODE_ENV=production，不写开发夹具）→ 引导。
// 命令以子进程执行（与 server 镜像里同一入口），断言退出码、输出、库里的行和留痕行。
// 接缝①：留痕工厂在写完后抛错，断言整条引导回滚。接缝②：双连接加屏障，断言两个引导只有一次写入。
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prismaAuditTrailFactory, type AuditTrailFactory } from '@natural-enforcement/audit';

import { PrismaClient } from '../backend/prisma/generated/prisma/client.ts';
import { createApplication, openBootstrapRunner } from '../backend/server/src/persistence.module.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const PASSWORD = 'Boot-strap-27x!';
const NEW_PASSWORD = 'Fresh-start-83y!';
const PROFILE = {
  rootCode: 'ORG-GZ-131',
  rootName: '市局',
  adminCode: 'SJ0001',
  adminName: '首个管理',
  adminMobilePhone: '13800013101',
};
const ARGS = [
  '--root-code', PROFILE.rootCode,
  '--root-name', PROFILE.rootName,
  '--admin-code', PROFILE.adminCode,
  '--admin-name', PROFILE.adminName,
  '--admin-mobile', PROFILE.adminMobilePhone,
];

// vitest 在仓库根目录运行（dev test integration：cd /work 后执行）。
const repo = (path: string): string => resolve(process.cwd(), path);
const PRISMA_CLI = repo('node_modules/.bin/prisma');
const PRISMA_DIR = repo('backend/prisma');
const REGISTER = repo('backend/server/register.mjs');
const COMMAND = repo('backend/server/src/bootstrap-command.ts');

type Run = { code: number; stdout: string; stderr: string };

function run(file: string, args: readonly string[], env: Record<string, string>, cwd?: string): Promise<Run> {
  return new Promise((resolve) => {
    execFile(file, args, { env, cwd, timeout: 120_000 }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`非法数据库标识：${name}`);
  return `"${name}"`;
}

type EmptyDatabase = { url: string; prisma: PrismaClient; close: () => Promise<void> };

const adminUrl = (): URL => {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL 未注入（须由 dev test integration harness 提供）');
  const url = new URL(base);
  url.pathname = '/template1';
  return url;
};
let admin: PrismaClient;
let counter = 0;

/** 新建空库，按生产顺序跑迁移与参照种子（不写开发夹具）。 */
async function openEmptyDatabase(): Promise<EmptyDatabase> {
  counter += 1;
  const name = `bs_${Date.now()}_${counter}`;
  await admin.$executeRawUnsafe(`CREATE DATABASE ${quoteIdent(name)} TEMPLATE template0`);
  const url = new URL(process.env.DATABASE_URL as string);
  url.pathname = `/${name}`;
  const env = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '/tmp', DATABASE_URL: url.toString() };
  const migrated = await run(PRISMA_CLI, ['migrate', 'deploy'], env, PRISMA_DIR);
  if (migrated.code !== 0) throw new Error(`迁移失败：${migrated.stdout}${migrated.stderr}`);
  const seeded = await run(PRISMA_CLI, ['db', 'seed'], { ...env, NODE_ENV: 'production' }, PRISMA_DIR);
  if (seeded.code !== 0) throw new Error(`参照种子失败：${seeded.stdout}${seeded.stderr}`);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }) });
  return {
    url: url.toString(),
    prisma,
    close: async () => {
      await prisma.$disconnect();
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${quoteIdent(name)} WITH (FORCE)`);
    },
  };
}

let workDir: string;
let passwordFile: string;

function bootstrapEnv(url: string): Record<string, string> {
  return { PATH: process.env.PATH ?? '', DATABASE_URL: url, BOOTSTRAP_PASSWORD_FILE: passwordFile };
}

function runCommand(url: string, args: readonly string[] = ARGS): Promise<Run> {
  const env = bootstrapEnv(url);
  const argv = ['--import', REGISTER, COMMAND, ...args];
  // 命令行与环境变量里都没有口令（只有口令文件的路径）。
  expect(JSON.stringify(argv)).not.toContain(PASSWORD);
  expect(JSON.stringify(env)).not.toContain(PASSWORD);
  return run(process.execPath, argv, env);
}

type Counts = { orgUnits: number; personnel: number; assignments: number; roles: number; audits: number };

async function counts(prisma: PrismaClient): Promise<Counts> {
  return {
    orgUnits: await prisma.orgUnit.count(),
    personnel: await prisma.personnel.count(),
    assignments: await prisma.personnelAssignment.count(),
    roles: await prisma.personnelRole.count(),
    audits: (await prisma.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM audit_trail`)[0]?.n ?? -1,
  };
}

async function auditRows(prisma: PrismaClient): Promise<Array<Record<string, unknown>>> {
  return prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT row_to_json(a)::jsonb AS row FROM audit_trail a ORDER BY created_at, id`
    .then((rows) => rows.map((r) => r.row as Record<string, unknown>));
}

beforeAll(async () => {
  admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: adminUrl().toString() }) });
  workDir = await mkdtemp(join(tmpdir(), 'bootstrap-131-'));
  passwordFile = join(workDir, 'bootstrap-password');
  await writeFile(passwordFile, `${PASSWORD}\n`, { mode: 0o600 });
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
  await admin.$disconnect();
});

describe('引导命令：空库、重复执行、残缺被拒、首登强制改密', () => {
  let db: EmptyDatabase;
  let closeApp: () => Promise<void> = async () => {};
  let baseUrl = '';

  beforeAll(async () => {
    db = await openEmptyDatabase();
  });

  afterAll(async () => {
    await closeApp();
    await db.close();
  });

  it('迁移与参照种子之后是空库：没有机构和人员，只有角色与允许行', async () => {
    expect(await counts(db.prisma)).toEqual({ orgUnits: 0, personnel: 0, assignments: 0, roles: 0, audits: 0 });
    expect(await db.prisma.role.count({ where: { name: '系统管理', deactivatedAt: null } })).toBe(1);
  });

  it('空库：退出码 0，建根机构（层级市）和首个系统管理人员，写两行留痕，所属机构为根机构', async () => {
    const result = await runCommand(db.url);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('引导完成');
    expect(`${result.stdout}${result.stderr}`).not.toContain(PASSWORD);

    const root = await db.prisma.orgUnit.findUniqueOrThrow({ where: { code: PROFILE.rootCode } });
    expect(root).toMatchObject({ name: '市局', level: 'city', parentId: null, deactivatedAt: null });
    const person = await db.prisma.personnel.findUniqueOrThrow({ where: { code: PROFILE.adminCode } });
    expect(person).toMatchObject({
      name: PROFILE.adminName,
      orgUnitId: root.id,
      mobilePhone: PROFILE.adminMobilePhone,
      passwordChangedAt: null,
      deactivatedAt: null,
    });
    expect(person.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await db.prisma.orgUnitNameVersion.count({ where: { orgUnitId: root.id, version: 1 } })).toBe(1);
    expect(await db.prisma.personnelNameVersion.count({ where: { personnelId: person.id, version: 1 } })).toBe(1);
    expect(await db.prisma.personnelAssignment.count({ where: { personnelId: person.id, orgUnitId: root.id, endedAt: null } }))
      .toBe(1);
    const grants = await db.prisma.personnelRole.findMany({ where: { personnelId: person.id }, include: { role: true } });
    expect(grants.map((g) => [g.role.name, g.deactivatedAt])).toEqual([['系统管理', null]]);

    const rows = await auditRows(db.prisma);
    expect(rows.map((r) => [
      r.action, r.outcome, r.org_unit_id, r.actor_id, r.actor_code, r.subject_personnel_id, r.subject_code,
      r.opcode, r.resource_type, r.resource_id, r.reason, r.source_ip, r.previous_value, r.item_count,
    ])).toEqual([
      ['bootstrap.root-registered', 'succeeded', root.id, null, null, null, null, null, 'org-unit', root.id, null, null, null, null],
      ['bootstrap.admin-registered', 'succeeded', root.id, null, null, person.id, PROFILE.adminCode, null, 'personnel', person.id, null, null, null, null],
    ]);
    // 留痕里没有口令、口令散列、手机号。
    const text = JSON.stringify(rows);
    for (const literal of [PASSWORD, person.passwordHash as string, PROFILE.adminMobilePhone]) {
      expect(text).not.toContain(literal);
    }
  });

  it('重复执行：退出码 0，输出「已引导」，库里的行和留痕都不变', async () => {
    const before = await counts(db.prisma);
    const result = await runCommand(db.url);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('已引导');
    expect(await counts(db.prisma)).toEqual(before);
  });

  it('两键不全：非 0 退出，输出差异，不写', async () => {
    const before = await counts(db.prisma);
    const otherAdmin = ARGS.map((arg) => (arg === PROFILE.adminCode ? 'SJ0002' : arg));
    const missingAdmin = await runCommand(db.url, otherAdmin);
    expect(missingAdmin.code).not.toBe(0);
    expect(missingAdmin.stderr).toContain('工号 SJ0002 的人员不存在');
    const otherRoot = ARGS.map((arg) => (arg === PROFILE.rootCode ? 'ORG-OTHER' : arg));
    const missingRoot = await runCommand(db.url, otherRoot);
    expect(missingRoot.code).not.toBe(0);
    expect(missingRoot.stderr).toContain('根机构编码 ORG-OTHER 不存在');
    for (const result of [missingAdmin, missingRoot]) {
      expect(`${result.stdout}${result.stderr}`).not.toContain(PASSWORD);
    }
    expect(await counts(db.prisma)).toEqual(before);
  });

  it('首登强制改密：初始口令登录得到强制改密，改密后会话持有机构维护码，初始口令失效', async () => {
    const app = await createApplication(db.url);
    await app.listen(0, '127.0.0.1');
    closeApp = () => app.close();
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mobilePhone: PROFILE.adminMobilePhone, password: PASSWORD, rememberMe: false }),
    });
    expect(login.status).toBe(200);
    expect((await login.json()).result).toBe('password-change-required');
    const cookie = login.headers.getSetCookie().map((item) => item.split(';')[0]).join('; ');

    const changed = await fetch(`${baseUrl}/api/auth/password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD }),
    });
    expect(changed.status).toBe(200);
    expect((await changed.json()).result).toBe('established');

    const session = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie } });
    const body = await session.json() as { result: string; code: string; opcodes: string[] };
    expect(body.result).toBe('authenticated');
    expect(body.code).toBe(PROFILE.adminCode);
    expect(body.opcodes).toContain('org.unit.register');

    const again = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mobilePhone: PROFILE.adminMobilePhone, password: PASSWORD, rememberMe: false }),
    });
    expect(again.status).toBe(401);

    const text = JSON.stringify(await auditRows(db.prisma));
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain(NEW_PASSWORD);
  });
});

describe('引导命令：输入与口令文件', () => {
  let db: EmptyDatabase;

  beforeAll(async () => {
    db = await openEmptyDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  it('口令文件读不到、口令不合规、缺参数：非 0 退出，不回显口令，不写', async () => {
    const missingFile = await run(process.execPath, ['--import', REGISTER, COMMAND, ...ARGS], {
      ...bootstrapEnv(db.url),
      BOOTSTRAP_PASSWORD_FILE: join(workDir, 'no-such-file'),
    });
    expect(missingFile.code).not.toBe(0);
    expect(missingFile.stderr).toContain('读不到口令文件');

    const weakFile = join(workDir, 'weak-password');
    await writeFile(weakFile, 'SJ0001abc\n', { mode: 0o600 });
    const weak = await run(process.execPath, ['--import', REGISTER, COMMAND, ...ARGS], {
      ...bootstrapEnv(db.url),
      BOOTSTRAP_PASSWORD_FILE: weakFile,
    });
    expect(weak.code).not.toBe(0);
    expect(weak.stderr).toContain('password-too-short');
    expect(`${weak.stdout}${weak.stderr}`).not.toContain('SJ0001abc');

    const withPassword = await run(process.execPath, ['--import', REGISTER, COMMAND, ...ARGS, '--password', PASSWORD], bootstrapEnv(db.url));
    expect(withPassword.code).not.toBe(0);
    expect(`${withPassword.stdout}${withPassword.stderr}`).not.toContain(PASSWORD);

    expect(await counts(db.prisma)).toEqual({ orgUnits: 0, personnel: 0, assignments: 0, roles: 0, audits: 0 });
  });

  it('接缝①：留痕写完后抛错，整条引导回滚，机构、人员、留痕都不变', async () => {
    const failing: AuditTrailFactory = {
      forClient(client) {
        const real = prismaAuditTrailFactory.forClient(client);
        return {
          async append(entry) {
            await real.append(entry);
            if (entry.action === 'bootstrap.admin-registered') throw new Error('接缝①：业务写完后抛错');
          },
        };
      },
    };
    const runner = openBootstrapRunner(db.url, { auditTrailFactory: failing });
    try {
      const passwordHash = await runner.hashPassword(PASSWORD);
      await expect(runner.run({ ...PROFILE, passwordHash })).rejects.toThrow('接缝①');
    } finally {
      await runner.close();
    }
    expect(await counts(db.prisma)).toEqual({ orgUnits: 0, personnel: 0, assignments: 0, roles: 0, audits: 0 });
  });

  it('接缝②：双连接加屏障，后到的引导在咨询锁上等待，前一个提交后得到「已引导」，只写一次', async () => {
    const first = openBootstrapRunner(db.url);
    const second = openBootstrapRunner(db.url);
    try {
      const passwordHash = await first.hashPassword(PASSWORD);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      let signalLocked!: () => void;
      const locked = new Promise<void>((resolve) => { signalLocked = resolve; });
      const a = first.run({ ...PROFILE, passwordHash }, {
        afterLock: async () => {
          signalLocked();
          await gate;
        },
      });
      await locked;
      const b = second.run({ ...PROFILE, passwordHash });
      let waiting = 0;
      for (let attempt = 0; attempt < 40 && waiting === 0; attempt += 1) {
        const rows = await db.prisma.$queryRaw<Array<{ n: number }>>`
          SELECT count(*)::int AS n FROM pg_locks
          WHERE locktype = 'advisory' AND NOT granted
            AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`;
        waiting = rows[0]?.n ?? 0;
        if (waiting === 0) await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(waiting).toBe(1);
      expect(await db.prisma.orgUnit.count()).toBe(0);
      release();
      const results = await Promise.all([a, b]);
      expect(results.map((r) => r.result)).toEqual(['bootstrapped', 'already-bootstrapped']);
    } finally {
      await first.close();
      await second.close();
    }
    const after = await counts(db.prisma);
    expect(after).toEqual({ orgUnits: 1, personnel: 1, assignments: 1, roles: 1, audits: 2 });
  });
});

describe('引导命令：两个进程并发', () => {
  let db: EmptyDatabase;

  beforeAll(async () => {
    db = await openEmptyDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  it('两个命令进程同时执行：都退出 0，一个写入、一个「已引导」，只有一套根机构', async () => {
    const results = await Promise.all([runCommand(db.url), runCommand(db.url)]);
    expect(results.map((r) => r.code)).toEqual([0, 0]);
    const outputs = results.map((r) => r.stdout).sort();
    expect(outputs.filter((o) => o.includes('引导完成'))).toHaveLength(1);
    expect(outputs.filter((o) => o.includes('已引导'))).toHaveLength(1);
    expect(await counts(db.prisma)).toEqual({ orgUnits: 1, personnel: 1, assignments: 1, roles: 1, audits: 2 });
    expect(await db.prisma.orgUnit.count({ where: { parentId: null } })).toBe(1);
  });
});

describe('引导判定：库非空（开发夹具库）', () => {
  let cloned: ClonedDatabase;

  beforeAll(async () => {
    cloned = await openClonedDatabase();
  });

  afterAll(async () => {
    await cloned.close();
  });

  it('两键都不在但库非空、根机构编码不是根、两键都在：分别拒绝或已引导，一律不写', async () => {
    const before = await counts(cloned.prisma);
    const runner = openBootstrapRunner(cloned.connectionString);
    try {
      const passwordHash = await runner.hashPassword(PASSWORD);
      const fresh = await runner.run({ ...PROFILE, passwordHash });
      expect(fresh).toEqual({
        result: 'incomplete',
        differences: [
          { kind: 'root-missing', rootCode: PROFILE.rootCode },
          { kind: 'admin-missing', adminCode: PROFILE.adminCode },
          { kind: 'not-empty', orgUnits: before.orgUnits, personnel: before.personnel },
        ],
      });
      const notRoot = await runner.run({ ...PROFILE, rootCode: 'ORG-DEPT-A', adminCode: 'P-SUP-A', passwordHash });
      expect(notRoot).toEqual({ result: 'incomplete', differences: [{ kind: 'root-not-root', rootCode: 'ORG-DEPT-A' }] });
      const both = await runner.run({ ...PROFILE, rootCode: 'ORG-HQ', adminCode: 'P-ADMIN-HQ', passwordHash });
      expect(both.result).toBe('already-bootstrapped');
    } finally {
      await runner.close();
    }
    expect(await counts(cloned.prisma)).toEqual(before);
  });
});
