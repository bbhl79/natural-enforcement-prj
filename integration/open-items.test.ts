// #219 OpenItems 真实计数与派机构／停用共用机构行锁。
// 本文件不注入 openItemsCounter——用默认真实实现。现有 org-deactivate.test.ts 仍用 stub 测接缝形状。
import type { AddressInfo } from 'node:net';

import { hash, type HashOptions } from 'argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prismaAuditTrailFactory, type AuditTrailFactory } from '@natural-enforcement/audit';

import { createApplication } from '../backend/server/src/persistence.module.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const T0 = Date.parse('2026-10-26T02:30:00.000Z');
const PINNED: HashOptions = { type: 2, memoryCost: 19 * 1024, timeCost: 2, parallelism: 1 };
const PASSWORD = 'Open-items-219!';
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const PHONES = {
  root: '13800021901',
  adminA: '13800021902',
  intakeA: '13800021903',
} as const;

function newUlid(): string {
  let time = BigInt(Date.now());
  let id = '';
  for (let i = 0; i < 10; i += 1) {
    id = CROCKFORD[Number(time % 32n)] + id;
    time /= 32n;
  }
  for (const byte of crypto.getRandomValues(new Uint8Array(16))) id += CROCKFORD[byte % 32];
  return id;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const barrier = { action: null as string | null, entered: deferred(), release: deferred() };
function armBarrier(action: string): void {
  barrier.action = action;
  barrier.entered = deferred();
  barrier.release = deferred();
}
const barrierFactory: AuditTrailFactory = {
  forClient(client) {
    const real = prismaAuditTrailFactory.forClient(client);
    return {
      async append(entry) {
        await real.append(entry);
        if (
          barrier.action &&
          entry.action === barrier.action &&
          !('outcome' in entry && entry.outcome === 'failed')
        ) {
          barrier.action = null;
          barrier.entered.resolve();
          await barrier.release.promise;
        }
      },
    };
  },
};

type Overrides = NonNullable<Parameters<typeof createApplication>[3]>;

let cloned: ClonedDatabase;
let baseUrl = '';
let barrierUrl = '';
const closers: Array<() => Promise<void>> = [];
let passwordHash = '';
const org = { hq: '', deptA: '', deptB: '' };
const people = { root: '', adminA: '', intakeA: '' };

type AuditRecord = {
  id: string;
  action: string;
  outcome: string;
  reason: string | null;
  actor_id: string | null;
  org_unit_id: string | null;
  opcode: string | null;
  resource_type: string | null;
  resource_id: string | null;
};

async function audits(): Promise<AuditRecord[]> {
  return cloned.prisma.$queryRaw<AuditRecord[]>`
    SELECT id, action, outcome, reason, actor_id, org_unit_id, opcode, resource_type, resource_id
    FROM audit_trail ORDER BY created_at, id
  `;
}

function added(before: AuditRecord[], after: AuditRecord[]): AuditRecord[] {
  const known = new Set(before.map((row) => row.id));
  return after.filter((row) => !known.has(row.id));
}

async function businessRows(): Promise<string[]> {
  const units = await cloned.prisma.orgUnit.findMany({ orderBy: { id: 'asc' } });
  const names = await cloned.prisma.orgUnitNameVersion.findMany({ orderBy: { id: 'asc' } });
  const assignments = await cloned.prisma.personnelAssignment.findMany({ orderBy: { id: 'asc' } });
  return [...units, ...names, ...assignments].map((row) => JSON.stringify(row));
}

let unitSeq = 0;
async function addUnit(level: 'district' | 'station', parentId: string): Promise<string> {
  unitSeq += 1;
  const id = newUlid();
  const name = `未办结测${level === 'district' ? '区' : '所'}${unitSeq}`;
  await cloned.prisma.orgUnit.create({
    data: { id, code: `ORG-219-${unitSeq}`, name, level, parentId, deactivatedAt: null },
  });
  await cloned.prisma.orgUnitNameVersion.create({
    data: { id: newUlid(), orgUnitId: id, name, version: 1 },
  });
  return id;
}

async function roleId(name: string): Promise<string> {
  return (await cloned.prisma.role.findFirstOrThrow({ where: { name, deactivatedAt: null } })).id;
}

let personSeq = 0;
async function addPerson(input: {
  orgUnitId: string;
  role: string;
  phone: string;
}): Promise<string> {
  personSeq += 1;
  const id = newUlid();
  await cloned.prisma.personnel.create({
    data: {
      id,
      code: `P-219-${personSeq}`,
      name: `未办结测人员${personSeq}`,
      orgUnitId: input.orgUnitId,
      passwordHash,
      mobilePhone: input.phone,
      passwordChangedAt: new Date(T0 - 10 * DAY_MS),
      deactivatedAt: null,
    },
  });
  await cloned.prisma.personnelAssignment.create({
    data: { id: newUlid(), personnelId: id, orgUnitId: input.orgUnitId },
  });
  await cloned.prisma.personnelRole.create({
    data: { id: newUlid(), personnelId: id, roleId: await roleId(input.role) },
  });
  return id;
}

const cookies = new Map<string, string>();

async function signIn(phone: string, url = baseUrl): Promise<string> {
  const key = `${url} ${phone}`;
  const known = cookies.get(key);
  if (known) return known;
  const response = await fetch(`${url}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mobilePhone: phone, password: PASSWORD, rememberMe: false }),
  });
  expect(response.status).toBe(200);
  const pair = response.headers.getSetCookie().find((item) => item.startsWith('__Host-sid='))?.split(';')[0];
  if (!pair) throw new Error('缺少会话 Cookie');
  cookies.set(key, pair);
  return pair;
}

async function deactivate(
  phone: string,
  orgUnitId: string,
  url = baseUrl,
): Promise<Response> {
  return fetch(`${url}/api/admin/org-units/${orgUnitId}/deactivate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await signIn(phone, url) },
    body: '{}',
  });
}

async function deactivatedAtOf(id: string): Promise<Date | null> {
  return (await cloned.prisma.orgUnit.findUniqueOrThrow({ where: { id } })).deactivatedAt;
}

async function startApp(overrides: Overrides = {}): Promise<string> {
  const app = await createApplication(
    cloned.connectionString,
    { now: () => new Date(T0) },
    undefined,
    overrides,
  );
  await app.listen(0, '127.0.0.1');
  closers.push(() => app.close());
  return `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
}

async function settledWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let settled = false;
  void promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await new Promise((resolve) => setTimeout(resolve, ms));
  return settled;
}

async function sourceCode(): Promise<string> {
  return (
    (
      await cloned.prisma.$queryRaw<Array<{ code: string }>>`
      SELECT code FROM geo_dict_source_code ORDER BY code LIMIT 1
    `
    )[0]?.code ?? 'SW-1'
  );
}

/** 插入一条线索，可选当前有效分派。 */
async function seedClue(input: {
  enteredOrgId: string;
  status: string;
  assignmentOrgId?: string;
  registeredBy?: string;
}): Promise<string> {
  const id = newUlid();
  const code = `C219-${id.slice(-10)}`;
  const src = await sourceCode();
  const registeredBy = input.registeredBy ?? people.root;
  await cloned.prisma.$executeRaw`
    INSERT INTO clue (id, code, source_code, domain, received_at, narrative,
      registered_by, entered_org_id, idempotency_key, request_digest, session_id,
      status, registered_at)
    VALUES (${id}, ${code}, ${src}, 'land', NOW(), 'OpenItems #219',
      ${registeredBy}, ${input.enteredOrgId}, ${`ik-${newUlid()}`}, '{}', ${`sk-${newUlid()}`},
      ${input.status}, NOW())
  `;
  if (input.assignmentOrgId) {
    await cloned.prisma.$executeRaw`
      INSERT INTO clue_assignment
        (id, clue_id, org_unit_id, kind, designate, assigned_by, assigned_by_org_id, assigned_at)
      VALUES
        (${newUlid()}, ${id}, ${input.assignmentOrgId}, 'initial', false,
         ${registeredBy}, ${input.enteredOrgId}, NOW())
    `;
  }
  return id;
}

/** 插入一张已批准呈批和一条案件。线索已关闭且不分派，不计入线索未办结。 */
async function seedCase(handlingOrgId: string, status: string): Promise<string> {
  const clueId = await seedClue({ enteredOrgId: org.deptA, status: 'closed' });
  const approvalId = newUlid();
  const caseId = newUlid();
  await cloned.prisma.$executeRaw`
    INSERT INTO filing_approval (id, clue_id, drafter_id, status)
    VALUES (${approvalId}, ${clueId}, ${people.root}, 'approved')
  `;
  await cloned.prisma.$executeRaw`
    INSERT INTO case_record (
      id, handling_org_id, status, current_stage, stage_entry_seq,
      party_names, filing_approval_id, opened_by, opened_at
    ) VALUES (
      ${caseId}, ${handlingOrgId}, ${status}, 'E02', 1,
      ${['张三']}::text[], ${approvalId}, ${people.root}, NOW()
    )
  `;
  return caseId;
}

async function designateClue(clueId: string, toOrgId: string, by: string, byOrg: string): Promise<void> {
  const now = new Date();
  await cloned.prisma.$executeRaw`
    UPDATE clue_assignment SET ended_at = ${now}
    WHERE clue_id = ${clueId} AND ended_at IS NULL
  `;
  await cloned.prisma.$executeRaw`
    INSERT INTO clue_assignment
      (id, clue_id, org_unit_id, kind, designate, assigned_by, assigned_by_org_id, reason, assigned_at)
    VALUES
      (${newUlid()}, ${clueId}, ${toOrgId}, 'designate', true,
       ${by}, ${byOrg}, '改派测', ${now})
  `;
  await cloned.prisma.$executeRaw`
    UPDATE clue SET status = 'org_assigned' WHERE id = ${clueId}
  `;
}

async function assignOrgApi(
  clueId: string,
  orgUnitId: string,
  phone: string,
  expectedStatus: string,
  url = baseUrl,
  reason = '',
): Promise<Response> {
  return fetch(`${url}/api/clues/${clueId}/assign-org`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: await signIn(phone, url),
    },
    body: JSON.stringify({
      orgUnitId,
      expectedStatus,
      reason,
      designate: false,
    }),
  });
}

beforeAll(async () => {
  cloned = await openClonedDatabase();
  const byCode = async (code: string) =>
    (await cloned.prisma.orgUnit.findUniqueOrThrow({ where: { code } })).id;
  org.hq = await byCode('ORG-HQ');
  org.deptA = await byCode('ORG-DEPT-A');
  org.deptB = await byCode('ORG-DEPT-B');
  passwordHash = await hash(PASSWORD, PINNED);
  people.root = await addPerson({ orgUnitId: org.hq, role: '系统管理', phone: PHONES.root });
  people.adminA = await addPerson({ orgUnitId: org.deptA, role: '系统管理', phone: PHONES.adminA });
  people.intakeA = await addPerson({ orgUnitId: org.deptA, role: '内勤', phone: PHONES.intakeA });
  // 默认装配：不传 openItemsCounter，走真实实现。
  baseUrl = await startApp({});
  barrierUrl = await startApp({ auditTrailFactory: barrierFactory });
}, 60_000);

afterAll(async () => {
  barrier.release.resolve();
  for (const close of closers) await close();
  await cloned?.close();
});

describe('#219 真实 OpenItems 计数（默认装配）', () => {
  it('派机构后停用承办机构 → 409 org-has-open-items，clues≥1，失败留痕存在，机构未停用', async () => {
    const station = await addUnit('station', org.deptA);
    await seedClue({
      enteredOrgId: org.deptA,
      status: 'org_assigned',
      assignmentOrgId: station,
    });
    await signIn(PHONES.adminA);
    const rowsBefore = await businessRows();
    const before = await audits();
    const response = await deactivate(PHONES.adminA, station);
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toEqual({
      result: 'invalid-state',
      reason: 'org-has-open-items',
      openItems: { clues: 1, cases: 0 },
      message: '本机构还有 1 条未办结的线索或案件（线索 1 条、案件 0 条），全部办结后才能停用。',
    });
    expect(await businessRows()).toEqual(rowsBefore);
    expect(await deactivatedAtOf(station)).toBeNull();
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'org.unit.deactivated',
        outcome: 'failed',
        reason: 'org-has-open-items',
        actor_id: people.adminA,
        org_unit_id: station,
        opcode: 'org.unit.deactivate',
        resource_type: 'org-unit',
        resource_id: station,
      }),
    ]);
  });

  it('仅 closed／transferred_out 的线索不计，可停用', async () => {
    const station = await addUnit('station', org.deptA);
    await seedClue({
      enteredOrgId: org.deptA,
      status: 'closed',
      assignmentOrgId: station,
    });
    await seedClue({
      enteredOrgId: org.deptA,
      status: 'transferred_out',
      assignmentOrgId: station,
    });
    const response = await deactivate(PHONES.adminA, station);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      result: 'deactivated',
      orgUnit: { id: station, deactivatedAt: expect.any(String) },
    });
    expect(await deactivatedAtOf(station)).not.toBeNull();
  });

  it('指定管辖换机构后：原机构可停用，新机构停用被拒', async () => {
    const oldStation = await addUnit('station', org.deptA);
    const newStation = await addUnit('station', org.deptA);
    const clueId = await seedClue({
      enteredOrgId: org.deptA,
      status: 'org_assigned',
      assignmentOrgId: oldStation,
    });
    await designateClue(clueId, newStation, people.intakeA, org.deptA);

    const oldResp = await deactivate(PHONES.adminA, oldStation);
    expect(oldResp.status).toBe(200);
    expect(await deactivatedAtOf(oldStation)).not.toBeNull();

    const newResp = await deactivate(PHONES.adminA, newStation);
    expect(newResp.status).toBe(409);
    expect(await newResp.json()).toEqual({
      result: 'invalid-state',
      reason: 'org-has-open-items',
      openItems: { clues: 1, cases: 0 },
      message: expect.stringContaining('1 条'),
    });
    expect(await deactivatedAtOf(newStation)).toBeNull();
  });

  it('filed 状态线索仍计入，停用 409', async () => {
    const station = await addUnit('station', org.deptA);
    const clueId = await seedClue({
      enteredOrgId: org.deptA,
      status: 'org_assigned',
      assignmentOrgId: station,
    });
    await cloned.prisma.$executeRaw`UPDATE clue SET status = 'filed' WHERE id = ${clueId}`;
    const response = await deactivate(PHONES.adminA, station);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      result: 'invalid-state',
      reason: 'org-has-open-items',
      openItems: { clues: 1, cases: 0 },
      message: expect.stringContaining('线索 1 条'),
    });
    expect(await deactivatedAtOf(station)).toBeNull();
  });

  it('同级其它机构有未办结不计入本机构：本机构仍可停用（不递归）', async () => {
    const self = await addUnit('station', org.deptA);
    const peer = await addUnit('station', org.deptA);
    await seedClue({
      enteredOrgId: org.deptA,
      status: 'org_assigned',
      assignmentOrgId: peer,
    });
    const response = await deactivate(PHONES.adminA, self);
    expect(response.status).toBe(200);
    expect(await deactivatedAtOf(self)).not.toBeNull();
    expect((await deactivate(PHONES.adminA, peer)).status).toBe(409);
    expect(await deactivatedAtOf(peer)).toBeNull();
  });

  it('非终态案件阻止停用：办理中与调查已终止·待收尾各计 1，线索为 0', async () => {
    const progressing = await addUnit('station', org.deptA);
    const pending = await addUnit('station', org.deptA);
    await seedCase(progressing, 'in_progress');
    await seedCase(pending, 'terminated_pending');
    const progressingResp = await deactivate(PHONES.adminA, progressing);
    expect(progressingResp.status).toBe(409);
    expect(await progressingResp.json()).toEqual({
      result: 'invalid-state',
      reason: 'org-has-open-items',
      openItems: { clues: 0, cases: 1 },
      message: '本机构还有 1 条未办结的线索或案件（线索 0 条、案件 1 条），全部办结后才能停用。',
    });
    expect(await deactivatedAtOf(progressing)).toBeNull();
    const pendingResp = await deactivate(PHONES.adminA, pending);
    expect(pendingResp.status).toBe(409);
    expect((await pendingResp.json()).openItems).toEqual({ clues: 0, cases: 1 });
    expect(await deactivatedAtOf(pending)).toBeNull();
  });

  it('终态案件不计：已撤案、已结案、已定型同在时可以停用', async () => {
    const station = await addUnit('station', org.deptA);
    await seedCase(station, 'withdrawn');
    await seedCase(station, 'closed');
    await seedCase(station, 'finalized');
    const response = await deactivate(PHONES.adminA, station);
    expect(response.status).toBe(200);
    expect(await deactivatedAtOf(station)).not.toBeNull();
  });

  it('无未办结时可停用（对照）', async () => {
    const station = await addUnit('station', org.deptA);
    const response = await deactivate(PHONES.adminA, station);
    expect(response.status).toBe(200);
    expect(await deactivatedAtOf(station)).not.toBeNull();
  });
});

describe('#219 派机构与停用共用机构行锁', () => {
  it('分派持锁未提交时停用被挡住；提交后停用见未办结 409', async () => {
    const station = await addUnit('station', org.deptA);
    const clueId = await seedClue({
      enteredOrgId: org.deptA,
      status: 'in_pool',
      registeredBy: people.intakeA,
    });
    await signIn(PHONES.intakeA, barrierUrl);
    await signIn(PHONES.adminA);
    armBarrier('clue.org-assigned');
    const assigning = assignOrgApi(clueId, station, PHONES.intakeA, 'in_pool', barrierUrl);
    await barrier.entered.promise;
    const deactivating = deactivate(PHONES.adminA, station);
    expect(await settledWithin(deactivating, 400)).toBe(false);
    barrier.release.resolve();
    const [assigned, refused] = await Promise.all([assigning, deactivating]);
    expect(assigned.status).toBe(200);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({
      result: 'invalid-state',
      reason: 'org-has-open-items',
      openItems: { clues: 1, cases: 0 },
      message: expect.stringContaining('1 条'),
    });
    expect(await deactivatedAtOf(station)).toBeNull();
  });
});
