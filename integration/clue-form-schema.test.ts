// #210 字典种子与录入要件声明。
// 断言打在克隆库上：参照数据只追加、要件声明的封闭取值、form-schema 接口的叠加结果、
// 以及操作码名册的拒绝路径。
import { execFileSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';

import { PrismaAuditTrail } from '@natural-enforcement/audit';
import { OPCODES, opcodeRequirements } from '@natural-enforcement/shield';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CLUE_REQUIREMENT_DECLARATION_VERSION,
  PUBLIC_GROUPS,
  PUBLIC_LAYER_ITEMS,
  REQUIREMENT_CONSEQUENCES,
  REQUIREMENT_TIMINGS,
  SOURCE_GROUPS,
  SOURCE_LAYER_GROUPS,
  TYPE_GROUPS,
  TYPE_LAYER_ITEMS,
  blockingItems,
  buildFormSchemaItems,
} from '../backend/case/src/index.ts';
import { SOURCE_CODES, VIOLATION_TYPES } from '../backend/geo-dict/src/index.ts';
import { AccessControlService } from '../backend/identity/src/index.ts';
import { PrismaIdentityStore } from '../backend/identity/src/persistence/prisma-identity-store.ts';
import { createApplication } from '../backend/server/src/persistence.module.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const T0 = Date.parse('2026-10-17T03:00:00.000Z');
const SEED_PASSWORD = 'Seed-pass-52';
const NEW_PASSWORD = 'Form-schema-210!';

let cloned: ClonedDatabase;
let access: AccessControlService;
let baseUrl = '';
let closeApp: () => Promise<void> = async () => {};

const cookies = new Map<string, string>();

function sessionCookie(response: Response): string {
  const found = response.headers.getSetCookie().find((item) => item.startsWith('__Host-sid='));
  const pair = found?.split(';')[0];
  if (!pair) throw new Error('缺少会话 Cookie');
  return pair;
}

/** 首次登录后强制改密，留住会话供后续请求用。 */
async function cookieOf(code: string): Promise<string> {
  const known = cookies.get(code);
  if (known) return known;
  const people = await cloned.prisma.personnel.findMany({
    where: { code, deactivatedAt: null },
  });
  const person = people[0];
  if (!person) throw new Error(`缺少种子人员 ${code}`);
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mobilePhone: person.mobilePhone, password: SEED_PASSWORD, rememberMe: false }),
  });
  expect(login.status).toBe(200);
  const cookie = sessionCookie(login);
  const changed = await fetch(`${baseUrl}/api/auth/password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ currentPassword: SEED_PASSWORD, newPassword: NEW_PASSWORD }),
  });
  expect(changed.status).toBe(200);
  cookies.set(code, cookie);
  return cookie;
}

async function schemaOf(code: string, query: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${baseUrl}/api/clue/form-schema?${query}`, {
    headers: { cookie: await cookieOf(code) },
  });
  return { status: response.status, body: await response.json() };
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

describe('#210 参照数据种子（ADR 0016 只追加）', () => {
  it('五张表的数量与 #24、#203 定稿一致', async () => {
    const sourceCodes = await cloned.prisma.geoDictSourceCode.count();
    const selectable = await cloned.prisma.geoDictViolationType.count({ where: { selectable: true } });
    const categories = await cloned.prisma.geoDictViolationType.count({ where: { selectable: false } });
    const documents = await cloned.prisma.geoDictDocument.count();
    const basis = await cloned.prisma.geoDictViolationTypeBasis.count();
    const jurisdiction = await cloned.prisma.geoDictJurisdiction.count();
    expect({ sourceCodes, selectable, categories, documents, basis, jurisdiction }).toEqual({
      sourceCodes: 30,
      selectable: 94,
      categories: 19,
      documents: 80,
      basis: expect.any(Number),
      jurisdiction: 0,
    });
    expect(basis).toBeGreaterThan(0);
  });

  it('上级编码显式存：16、13 挂 1；18、19、20、801–803 挂 22', async () => {
    const parents = new Map(
      (await cloned.prisma.geoDictSourceCode.findMany()).map((row) => [row.code, row.parentCode]),
    );
    expect(parents.get('16')).toBe('1');
    expect(parents.get('13')).toBe('1');
    for (const code of ['18', '19', '20', '801', '802', '803', '2201', '2202', '2203']) {
      expect(parents.get(code), code).toBe('22');
    }
    for (const code of ['1', '5', '22', '3', '21']) {
      expect(parents.get(code), code).toBeNull();
    }
  });

  it('显示名不出现「名称待定」，且与 #24、#203 定稿逐字相等', async () => {
    const sourceCodes = await cloned.prisma.geoDictSourceCode.findMany();
    for (const row of sourceCodes) {
      expect(row.name, row.code).not.toContain('名称待定');
    }
    expect(sourceCodes.map((row) => [row.code, row.name]).sort())
      .toEqual(SOURCE_CODES.map((row) => [row.code, row.name]).sort());
    const types = await cloned.prisma.geoDictViolationType.findMany();
    for (const row of types) {
      expect(row.name, row.code).not.toContain('名称待定');
    }
    expect(types.map((row) => [row.code, row.name]).sort())
      .toEqual(VIOLATION_TYPES.map((row) => [row.code, row.name]).sort());
  });

  it('只追加：库里拒绝 UPDATE 与 DELETE', async () => {
    // 走原生 SQL：断言的是库层触发器（reject_row_mutation），不经过 ORM 委托。
    const row = await cloned.prisma.geoDictSourceCode.findFirstOrThrow();
    await expect(
      cloned.prisma.$executeRaw`UPDATE geo_dict_source_code SET name = '改了' WHERE id = ${row.id}`,
    ).rejects.toThrow(/拒绝 UPDATE/);
    await expect(
      cloned.prisma.$executeRaw`DELETE FROM geo_dict_source_code WHERE id = ${row.id}`,
    ).rejects.toThrow(/拒绝 DELETE/);
  });

  it('依据引用钉版本：引用的文件编号都在文件表内（ADR 0019 断言二）', async () => {
    const codes = new Set((await cloned.prisma.geoDictDocument.findMany()).map((row) => row.code));
    const basis = await cloned.prisma.geoDictViolationTypeBasis.findMany();
    for (const row of basis) {
      expect(codes.has(row.documentCode), row.documentCode).toBe(true);
    }
    // 处罚依据不得引用部门规范性文件、地方政府规范性文件、司法解释（ADR 0019 断言一）。
    const documents = new Map((await cloned.prisma.geoDictDocument.findMany()).map((row) => [row.code, row]));
    for (const row of basis.filter((item) => item.purpose === '处罚')) {
      const level = documents.get(row.documentCode)?.hierarchyLevel;
      expect(['部门规范性文件', '地方政府规范性文件', '司法解释'], row.documentCode).not.toContain(level);
    }
  });
});

describe('#210 录入要件声明（ADR 0018）', () => {
  it('三层规模与底稿一致：公共 8 项、来源 5 组 16 项、类型 1018 项', () => {
    expect(PUBLIC_LAYER_ITEMS).toHaveLength(8);
    expect(SOURCE_LAYER_GROUPS).toHaveLength(5);
    expect(SOURCE_LAYER_GROUPS.reduce((sum, group) => sum + group.items.length, 0)).toBe(16);
    expect(TYPE_LAYER_ITEMS).toHaveLength(1018);
  });

  it('呈现、必填时机、缺件后果都取封闭清单内的值', () => {
    for (const item of PUBLIC_LAYER_ITEMS) {
      expect((PUBLIC_GROUPS as readonly string[]), item.key).toContain(item.group);
      expect((REQUIREMENT_TIMINGS as readonly string[]), item.key).toContain(item.timing);
      expect((REQUIREMENT_CONSEQUENCES as readonly string[]), item.key).toContain(item.consequence);
    }
    for (const group of SOURCE_LAYER_GROUPS) {
      expect((SOURCE_GROUPS as readonly string[]), group.group).toContain(group.group);
      for (const item of group.items) {
        expect(item.group, item.key).toBe(group.group);
        expect((REQUIREMENT_TIMINGS as readonly string[]), item.key).toContain(item.timing);
        expect((REQUIREMENT_CONSEQUENCES as readonly string[]), item.key).toContain(item.consequence);
      }
    }
    for (const item of TYPE_LAYER_ITEMS) {
      expect((TYPE_GROUPS as readonly string[]), item.key).toContain(item.group);
      expect((REQUIREMENT_TIMINGS as readonly string[]), item.key).toContain(item.timing);
      expect((REQUIREMENT_CONSEQUENCES as readonly string[]), item.key).toContain(item.consequence);
    }
  });

  it('类型层要件键形如 type.<类型编码>.<字段>，类型编码在 #203 表内（ADR 0020）', () => {
    const typeCodes = new Set<string>(VIOLATION_TYPES.map((row) => row.code));
    for (const item of TYPE_LAYER_ITEMS) {
      const matched = /^type\.([a-z][a-z0-9_]*)\.([a-z0-9_]+)$/.exec(item.key);
      expect(matched, item.key).not.toBeNull();
      expect(typeCodes.has(matched![1]), item.key).toBe(true);
      expect(matched![1]).toMatch(/^(land|mineral|survey|planning)_/);
    }
  });

  it('要件键全局唯一', () => {
    const keys = [
      ...PUBLIC_LAYER_ITEMS.map((item) => item.key),
      ...SOURCE_LAYER_GROUPS.flatMap((group) => group.items.map((item) => item.key)),
      ...TYPE_LAYER_ITEMS.map((item) => item.key),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('类型层不阻断线索录入：叠加后的阻断集合只含公共层与来源层（ADR 0018 新增断言）', () => {
    const items = buildFormSchemaItems({
      sourceGroupCode: '3',
      typeCodes: ['land_occupy_without_approval'],
    });
    const blocking = blockingItems(items);
    expect(blocking.length).toBeGreaterThan(0);
    expect(blocking.every((item) => !item.key.startsWith('type.'))).toBe(true);
    const typeBlocking = items.filter(
      (item) => item.key.startsWith('type.') && item.consequence === '阻断',
    );
    expect(typeBlocking.length).toBeGreaterThan(0);
    expect(blockingItems(items.filter((item) => item.key.startsWith('type.')))).toEqual([]);
  });

  it('「附录外其他」类型只带公共层与来源层要件', () => {
    const items = buildFormSchemaItems({
      sourceGroupCode: '1',
      typeCodes: ['land_other'],
    });
    expect(items.some((item) => item.key.startsWith('type.'))).toBe(false);
  });

  it('生成物与底稿一致（重跑生成器不产生差异）', () => {
    const script = resolve(process.cwd(), 'tools/generate-clue-reference-data.mjs');
    expect(() => execFileSync(process.execPath, [script, '--check'], { stdio: 'pipe' })).not.toThrow();
  });
});

describe('#211 参照清单', () => {
  it('来源编码与可选违法类型各出一份，前端按它渲染规范选择控件', async () => {
    const response = await fetch(`${baseUrl}/api/clue/reference`, {
      headers: { cookie: await cookieOf('P-CLERK-A') },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      sources: { code: string; name: string; group: string }[];
      types: { code: string; name: string; domain: string }[];
    };
    expect(body.sources).toHaveLength(30);
    expect(body.types).toHaveLength(94);
    expect(body.sources.find((row) => row.code === '16')?.name).toBe('日常巡查');
    expect(body.types.every((row) => row.domain !== '')).toBe(true);
  });
});

describe('#210 form-schema 接口', () => {
  it('未登录取不到声明', async () => {
    const response = await fetch(`${baseUrl}/api/clue/form-schema?sourceCode=301&domain=land`);
    expect(response.status).toBe(401);
  });

  it('按来源、法域、类型返回叠加后的录入项与声明版本', async () => {
    const { status, body } = await schemaOf(
      'P-INTAKE-HQ',
      'sourceCode=301&domain=land&types=land_occupy_without_approval',
    );
    expect(status).toBe(200);
    const parsed = body as {
      result: string;
      declarationVersion: string;
      source: { code: string; name: string; group: string };
      domain: string;
      groups: { name: string; items: { key: string }[] }[];
      items: { key: string; group: string }[];
    };
    expect(parsed.result).toBe('listed');
    expect(parsed.declarationVersion).toBe(CLUE_REQUIREMENT_DECLARATION_VERSION);
    expect(parsed.source).toEqual({ code: '301', name: '举报', group: '群众举报' });
    expect(parsed.domain).toBe('land');
    // 公共 8 项 + 群众举报 4 项 + 类型层要件。
    const keys = parsed.items.map((item) => item.key);
    expect(keys).toContain('clue.source');
    expect(keys).toContain('clue.verifiable_basis');
    expect(keys).toContain('type.land_occupy_without_approval.actual_area');
    expect(keys).not.toContain('clue.assign_doc_no');
    expect(parsed.groups.map((group) => group.name)).toEqual(
      [...new Set(parsed.items.map((item) => item.group))],
    );
  });

  it('类型可选多个，类型层取并集；不带类型时只有公共层与来源层', async () => {
    const single = await schemaOf('P-INTAKE-HQ', 'sourceCode=16&domain=land');
    const multiple = await schemaOf(
      'P-INTAKE-HQ',
      'sourceCode=16&domain=land&types=land_occupy_without_approval,land_farmland_permanent',
    );
    expect(single.status).toBe(200);
    expect(multiple.status).toBe(200);
    const singleBody = single.body as { items: { key: string }[] };
    const multipleBody = multiple.body as { items: { key: string }[]; types: { code: string; name: string }[] };
    expect(singleBody.items.some((item) => item.key.startsWith('type.'))).toBe(false);
    expect(multipleBody.types).toHaveLength(2);
    expect(multipleBody.items.filter((item) => item.key.startsWith('type.')).length)
      .toBeGreaterThan(singleBody.items.length);
  });

  it('来源与法域可空：未选时只出公共层，只选来源时出来源补充', async () => {
    const empty = await schemaOf('P-INTAKE-HQ', '');
    expect(empty.status).toBe(200);
    const emptyBody = empty.body as {
      source: { code: string };
      domain: string;
      items: { key: string }[];
    };
    expect(emptyBody.source.code).toBe('');
    expect(emptyBody.domain).toBe('');
    expect(emptyBody.items.map((item) => item.key)).toEqual(PUBLIC_LAYER_ITEMS.map((item) => item.key));

    const sourceOnly = await schemaOf('P-INTAKE-HQ', 'sourceCode=301');
    expect(sourceOnly.status).toBe(200);
    const sourceKeys = (sourceOnly.body as { items: { key: string }[] }).items.map((item) => item.key);
    expect(sourceKeys).toContain('clue.verifiable_basis');
    expect(sourceKeys.some((key) => key.startsWith('type.'))).toBe(false);

    const domainOnly = await schemaOf('P-INTAKE-HQ', 'domain=land');
    expect(domainOnly.status).toBe(200);
    const domainKeys = (domainOnly.body as { items: { key: string }[] }).items.map((item) => item.key);
    expect(domainKeys).not.toContain('clue.verifiable_basis');
  });

  it('来源编码、法域、类型编码不合法一律 400', async () => {
    for (const query of [
      'sourceCode=9999&domain=land',
      'sourceCode=301&domain=space',
      'sourceCode=301&domain=land&types=land_not_a_type',
    ]) {
      const { status, body } = await schemaOf('P-INTAKE-HQ', query);
      expect({ query, status }, query).toEqual({ query, status: 400 });
      expect((body as { result: string }).result, query).toBe('non-compliant');
    }
  });
});

describe('#210 操作码名册与授权', () => {
  it('11 个新码进名册，且名册外的不在库里', () => {
    for (const code of [
      'clue.register',
      'clue.dispatch.decide',
      'clue.withdraw.undo',
      'clue.disposition.record',
      'clue.reminder.resolve',
      'clue.item.supplement',
      'clue.verify.retry',
      'clue.reference.read',
      'clue.geometry.update',
      'clue.designate.request',
      'clue.pool.reassign',
    ]) {
      expect(OPCODES, code).toContain(code);
      expect(opcodeRequirements(code), code).not.toBeNull();
    }
  });

  it('库里的权限行都对应名册内的操作码', async () => {
    const permissions = await cloned.prisma.permission.findMany();
    for (const row of permissions) {
      expect(OPCODES, row.code).toContain(row.code);
    }
  });

  it('新码按角色授了权：内勤与经办有登记，监督没有写权限', async () => {
    const granted = async (roleName: string, code: string): Promise<boolean> => {
      const role = await cloned.prisma.role.findFirstOrThrow({ where: { name: roleName } });
      const permission = await cloned.prisma.permission.findFirstOrThrow({ where: { code } });
      const row = await cloned.prisma.rolePermission.findFirst({
        where: { roleId: role.id, permissionId: permission.id, deactivatedAt: null },
      });
      return row != null;
    };
    expect(await granted('内勤', 'clue.register')).toBe(true);
    expect(await granted('经办', 'clue.register')).toBe(true);
    expect(await granted('内勤', 'clue.dispatch.decide')).toBe(true);
    expect(await granted('内勤', 'clue.designate.request')).toBe(true);
    expect(await granted('系统管理', 'clue.pool.reassign')).toBe(true);
    for (const code of ['clue.register', 'clue.dispatch.decide', 'clue.item.supplement', 'clue.reference.read']) {
      expect(await granted('监督', code), code).toBe(false);
    }
  });

  it('clue.verify.start 保留名册条目，但本期不授任何角色', async () => {
    expect(OPCODES).toContain('clue.verify.start');
    const permission = await cloned.prisma.permission.findFirstOrThrow({ where: { code: 'clue.verify.start' } });
    const active = await cloned.prisma.rolePermission.count({
      where: { permissionId: permission.id, deactivatedAt: null },
    });
    expect(active).toBe(0);
  });

  it('名册外的操作码被拒绝（授权判定给出 permission-denied）', async () => {
    const person = await cloned.prisma.personnel.findFirstOrThrow({ where: { code: 'P-SUP-A' } });
    const assignment = await cloned.prisma.personnelAssignment.findFirstOrThrow({
      where: { personnelId: person.id, endedAt: null },
    });
    await expect(
      access.authorize(
        { personnelId: person.id, authenticated: true },
        'clue.not.in.catalog',
        assignment.orgUnitId,
      ),
    ).rejects.toThrow(/permission-denied/);
  });
});
