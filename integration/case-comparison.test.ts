// #271 新旧比对最小版：判定只追加、决定呈批缺判定阻断、批准时 409 比对过时、
// Q31 施行日当天警告、Q32 提示不阻断、调查报告呈批不设此校验。
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { CaseComparisonService } from '../backend/server/src/case-comparison.service.ts';
import { createApplication } from '../backend/server/src/persistence.module.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const T0 = Date.parse('2026-10-27T06:00:00.000Z');
const SEED_PASSWORD = 'Seed-pass-52';
const NEW_PASSWORD = 'Case-comparison-271!';
const INITIAL_PASSWORD = 'Compare-271!';

function square(offset: number): (readonly number[])[] {
  const west = 115 + offset;
  return [
    [west, 23],
    [west + 0.1, 23],
    [west + 0.1, 23.1],
    [west, 23.1],
    [west, 23],
  ];
}

function geojsonPolygon(ring: readonly (readonly number[])[]): string {
  return JSON.stringify({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: {} });
}

class RecordingStorage {
  async putVersion(fileKey: string): Promise<{ fileKey: string; versionId: string }> {
    return { fileKey, versionId: 'version-1' };
  }
  async readVersion(): Promise<Uint8Array> {
    return new Uint8Array(0);
  }
}

class RecordingQueue {
  async enqueue(): Promise<{ id: string }> {
    return { id: 'job-1' };
  }
  async waitForCompletion(): Promise<unknown> {
    return null;
  }
  async close(): Promise<void> {}
}

let cloned: ClonedDatabase;
let baseUrl = '';
let closeApp: () => Promise<void> = async () => {};
let comparison: CaseComparisonService;
const cookies = new Map<string, string>();
const passwords = new Map<string, string>();
let stationAId = '';
let handlerMainId = '';
let handlerAssistId = '';
let offset = 0;
let clockNow = T0;

const actor = { personnelId: '', authenticated: true };

function sessionCookie(response: Response): string {
  const found = response.headers.getSetCookie().find((item) => item.startsWith('__Host-sid='));
  const pair = found?.split(';')[0];
  if (!pair) throw new Error('缺少会话 Cookie');
  return pair;
}

async function cookieOf(code: string, password?: string): Promise<string> {
  const known = cookies.get(code);
  if (known) return known;
  const current = password ?? passwords.get(code) ?? SEED_PASSWORD;
  const person = await cloned.prisma.personnel.findFirst({ where: { code, deactivatedAt: null } });
  if (!person?.mobilePhone) throw new Error(`缺少人员 ${code}`);
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mobilePhone: person.mobilePhone, password: current, rememberMe: false }),
  });
  expect(login.status).toBe(200);
  const cookie = sessionCookie(login);
  if (current !== NEW_PASSWORD) {
    const changed = await fetch(`${baseUrl}/api/auth/password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ currentPassword: current, newPassword: NEW_PASSWORD }),
    });
    expect(changed.status).toBe(200);
    passwords.set(code, NEW_PASSWORD);
  }
  cookies.set(code, cookie);
  return cookie;
}

async function seedPerson(
  code: string,
  name: string,
  orgUnitId: string,
  roles: readonly string[],
  mobilePhone: string,
): Promise<string> {
  const response = await fetch(`${baseUrl}/api/admin/personnel`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf('P-ADMIN-HQ') },
    body: JSON.stringify({ code, name, orgUnitId, mobilePhone, initialPassword: INITIAL_PASSWORD, roles: [...roles] }),
  });
  expect([200, 201]).toContain(response.status);
  const person = await cloned.prisma.personnel.findFirstOrThrow({ where: { code } });
  await cloned.prisma.personnel.update({
    where: { id: person.id },
    data: {
      enforcementCertNo: `ENF-${code}`,
      enforcementCertExpiresOn: new Date('2030-12-31T00:00:00.000Z'),
      enforcementCertStatus: 'valid',
    },
  });
  await cookieOf(code, INITIAL_PASSWORD);
  return person.id;
}

async function register(polygonOffset: number): Promise<{ id: string }> {
  const form = new FormData();
  form.set('sourceCode', '16');
  form.set('domain', 'land');
  form.set(
    'values',
    JSON.stringify({
      'clue.received_at': '2026-10-27',
      'clue.narrative': '巡查发现一处硬化地面',
      'clue.finder': '巡查员',
      'clue.patrol_no': `XC-271-${polygonOffset}`,
    }),
  );
  form.set(
    'spatial-source',
    new Blob([geojsonPolygon(square(polygonOffset))], { type: 'application/geo+json' }),
    'area.geojson',
  );
  const response = await fetch(`${baseUrl}/api/clues`, {
    method: 'POST',
    headers: {
      cookie: await cookieOf('P-271-IN'),
      'idempotency-key': `compare-${polygonOffset}-${Math.random().toString(36).slice(2)}`,
    },
    body: form,
  });
  expect([200, 201]).toContain(response.status);
  return (await response.json()) as { id: string };
}

async function toHandlerAssigned(clueId: string): Promise<void> {
  const org = await fetch(`${baseUrl}/api/clues/${clueId}/assign-org`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf('P-271-IN') },
    body: JSON.stringify({ orgUnitId: stationAId, expectedStatus: 'in_pool', reason: '', designate: false }),
  });
  expect(org.status).toBe(200);
  const people = await fetch(`${baseUrl}/api/clues/${clueId}/assign-people`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf('P-271-ST') },
    body: JSON.stringify({ mainId: handlerMainId, assistIds: [handlerAssistId], expectedStatus: 'org_assigned' }),
  });
  expect(people.status).toBe(200);
}

async function postJson(path: string, code: string, body: unknown = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf(code) },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function fileCase(): Promise<string> {
  offset += 1;
  const registered = await register(offset);
  await toHandlerAssigned(registered.id);
  const drafted = await postJson(`/api/clues/${registered.id}/filing-approval`, 'P-271-H1', {
    content: { conclusion: 'file', partyNames: ['张三'] },
  });
  expect(drafted.status).toBe(200);
  const approvalId = String(drafted.body.approvalId);
  expect((await postJson(`/api/filing-approvals/${approvalId}/submit`, 'P-271-H1')).status).toBe(200);
  expect((await postJson(`/api/filing-approvals/${approvalId}/review`, 'P-271-RV', { opinion: '同意' })).status).toBe(200);
  const approved = await postJson(`/api/filing-approvals/${approvalId}/approve`, 'P-APPROVE-HQ', { opinion: '同意' });
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  return String(approved.body.caseId);
}

async function addViolation(caseId: string, description: string): Promise<string> {
  const created = await postJson(`/api/cases/${caseId}/violations`, 'P-271-H1', {
    behaviorDescription: description,
    parties: ['张三'],
    startedOn: '2026-10-01',
    endedOn: '2026-10-20',
    recognition: 'one-off',
  });
  expect(created.status, JSON.stringify(created.body)).toBe(200);
  return String(created.body.id);
}

function basis(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    clause: 'doc_019 第 21 条',
    version: 'doc_019@2021-09-01',
    effectiveFrom: '2021-09-01',
    expiresOn: null,
    ...overrides,
  };
}

function benchmark(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    clause: 'doc_025 附件 4',
    version: '粤自然资规字〔2022〕2号',
    validUntil: '2027-08-31',
    ...overrides,
  };
}

function judgment(violationRecordId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    violationRecordId,
    behaviorBases: [basis()],
    decisionBases: [basis()],
    behaviorBenchmarks: [benchmark()],
    decisionBenchmarks: [benchmark()],
    adoptedVersion: '决定时版本',
    reason: '行为时与决定时依据一致，差异为零',
    noticeRef: 'notice-271',
    zeroDifference: true,
    ...overrides,
  };
}

async function trails(action: string, resourceId: string): Promise<Array<{ outcome: string; reason: string | null; detail: string | null }>> {
  return cloned.prisma.$queryRaw<Array<{ outcome: string; reason: string | null; detail: string | null }>>`
    SELECT outcome, reason, detail
    FROM audit_trail
    WHERE action = ${action} AND resource_id = ${resourceId}
    ORDER BY created_at ASC, id ASC
  `;
}

async function runSuspension(caseId: string): Promise<Record<string, unknown>> {
  const drafted = await postJson(`/api/cases/${caseId}/procedures`, 'P-271-H1', { kind: 'suspend', extendTogether: false });
  expect(drafted.status, JSON.stringify(drafted.body)).toBe(200);
  const approvalId = String(drafted.body.approvalId);
  expect((await postJson(`/api/procedures/${approvalId}/submit`, 'P-271-H1')).status).toBe(200);
  expect((await postJson(`/api/procedures/${approvalId}/review`, 'P-271-RV', { opinion: '同意' })).status).toBe(200);
  const approved = await postJson(`/api/procedures/${approvalId}/approve`, 'P-APPROVE-HQ', { opinion: '同意' });
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  return approved.body;
}

beforeAll(async () => {
  cloned = await openClonedDatabase();
  const app = await createApplication(cloned.connectionString, { now: () => new Date(clockNow) }, undefined, {
    storagePort: new RecordingStorage() as never,
    queuePort: new RecordingQueue() as never,
    filingAdminReview: 'one-level',
  });
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeApp = () => app.close();
  comparison = app.get(CaseComparisonService);
  const orgOf = async (code: string) => {
    const org = await cloned.prisma.orgUnit.findUnique({ where: { code } });
    if (!org) throw new Error(`缺少种子机构 ${code}`);
    return org.id;
  };
  const deptAId = await orgOf('ORG-DEPT-A');
  stationAId = await orgOf('ORG-STATION-A');
  await seedPerson('P-271-IN', '甲区内勤', deptAId, ['内勤'], '13900027101');
  await seedPerson('P-271-ST', '甲所内勤', stationAId, ['内勤'], '13900027102');
  handlerMainId = await seedPerson('P-271-H1', '主办甲', stationAId, ['经办'], '13900027103');
  handlerAssistId = await seedPerson('P-271-H2', '协办乙', stationAId, ['经办'], '13900027104');
  await seedPerson('P-271-RV', '所内审核', stationAId, ['行政审核'], '13900027105');
  actor.personnelId = handlerMainId;
}, 180_000);

afterAll(async () => {
  await closeApp();
  await cloned.close();
});

beforeEach(() => {
  cookies.clear();
});

describe('#271 新旧比对最小版', () => {
  it('决定呈批缺判定阻断；差异为零也要人的判定；作废记录不要求判定', async () => {
    const caseId = await fileCase();
    const first = await addViolation(caseId, '硬化地面');
    const second = await addViolation(caseId, '堆放材料');

    const missing = await comparison.assertComparisonComplete(caseId, actor);
    expect(missing.status).toBe(409);
    expect(missing.body).toMatchObject({
      result: 'missing-judgment',
      message: '决定呈批缺少新旧比对判定',
    });
    expect([...(missing.body.missingViolationIds as string[])].sort()).toEqual([first, second].sort());

    const zeroWithoutReason = await comparison.recordJudgment(actor, caseId, judgment(first, { reason: '' }));
    expect(zeroWithoutReason.status).toBe(400);

    const recorded = await comparison.recordJudgment(actor, caseId, judgment(first));
    expect(recorded.status, JSON.stringify(recorded.body)).toBe(200);
    expect(recorded.body.zeroDifference).toBe(true);

    const stillMissing = await comparison.assertComparisonComplete(caseId, actor);
    expect(stillMissing.status).toBe(409);
    expect(stillMissing.body.missingViolationIds).toEqual([second]);

    expect((await comparison.recordJudgment(actor, caseId, judgment(second))).status).toBe(200);
    const complete = await comparison.assertComparisonComplete(caseId, actor);
    expect(complete.status).toBe(200);

    const rows = await cloned.prisma.caseComparisonJudgment.findMany({ where: { caseId }, orderBy: { createdAt: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.zeroDifference)).toEqual([true, true]);
    expect(rows.map((row) => row.noticeRef)).toEqual(['notice-271', 'notice-271']);
    expect(rows[0]?.behaviorBasesJson).toContain('doc_019 第 21 条');

    const read = await comparison.read(caseId);
    expect(read.status).toBe(200);
    expect((read.body.judgments as unknown[]).length).toBe(2);

    const voidedCase = await fileCase();
    const keep = await addViolation(voidedCase, '硬化地面');
    const drop = await addViolation(voidedCase, '堆放材料');
    const voided = await postJson(`/api/cases/${voidedCase}/violations/${drop}/void`, 'P-271-H1', { reason: '重复录入' });
    expect(voided.status).toBe(200);
    expect((await comparison.recordJudgment(actor, voidedCase, judgment(keep))).status).toBe(200);
    expect((await comparison.assertComparisonComplete(voidedCase, actor)).status).toBe(200);
  });

  it('判定只追加：再录一行取最新；库层触发器拒绝改删', async () => {
    const caseId = await fileCase();
    const violationId = await addViolation(caseId, '硬化地面');
    expect((await comparison.recordJudgment(actor, caseId, judgment(violationId))).status).toBe(200);
    clockNow = T0 + 60_000;
    expect(
      (
        await comparison.recordJudgment(
          actor,
          caseId,
          judgment(violationId, { decisionBases: [basis({ effectiveFrom: '2027-01-01' })] }),
        )
      ).status,
    ).toBe(200);
    const rows = await cloned.prisma.caseComparisonJudgment.findMany({ where: { caseId } });
    expect(rows).toHaveLength(2);

    const firstRowId = String(rows[0]?.id);
    await expect(
      cloned.prisma.$executeRaw`UPDATE case_comparison_judgment SET reason = '改写' WHERE id = ${firstRowId}`,
    ).rejects.toThrow();
    await expect(
      cloned.prisma.$executeRaw`DELETE FROM case_comparison_judgment WHERE id = ${firstRowId}`,
    ).rejects.toThrow();

    const stale = await comparison.assertComparisonFresh(caseId, new Date('2026-12-31T08:00:00.000Z'), actor);
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ message: '比对过时', outlet: '重新比对', approvedDay: '2026-12-31' });
  });

  it('无判定或决定时版本与批准当日不一致：409 比对过时并写失败留痕', async () => {
    const noJudgmentCase = await fileCase();
    await addViolation(noJudgmentCase, '硬化地面');
    const noJudgment = await comparison.assertComparisonFresh(noJudgmentCase, new Date('2026-12-31T08:00:00.000Z'), actor);
    expect(noJudgment.status).toBe(409);
    expect(noJudgment.body).toMatchObject({ reason: 'missing-judgment', message: '比对过时' });
    expect(await trails('case.comparison-refused', noJudgmentCase)).toEqual([
      expect.objectContaining({ outcome: 'failed', reason: 'missing-judgment' }),
    ]);

    const caseId = await fileCase();
    const violationId = await addViolation(caseId, '硬化地面');
    expect(
      (
        await comparison.recordJudgment(
          actor,
          caseId,
          judgment(violationId, {
            behaviorBases: [basis()],
            decisionBases: [basis({ effectiveFrom: '2027-01-01' })],
          }),
        )
      ).status,
    ).toBe(200);
    const stale = await comparison.assertComparisonFresh(caseId, new Date('2026-12-31T08:00:00.000Z'), actor);
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ reason: 'comparison-stale', message: '比对过时' });
    const failures = await trails('case.comparison-refused', caseId);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ outcome: 'failed', reason: 'comparison-stale' });
    expect(failures[0]?.detail).toContain('2026-12-31');

    const fresh = await comparison.assertComparisonFresh(caseId, new Date('2027-01-02T08:00:00.000Z'), actor);
    expect(fresh.status).toBe(200);
    expect(fresh.body).toMatchObject({ result: 'comparison-fresh', approvedDay: '2027-01-02' });
  });

  it('Q31：批准日等于施行日给警告，不以新／旧版判过时，配置不设默认', async () => {
    const caseId = await fileCase();
    const violationId = await addViolation(caseId, '硬化地面');
    expect(
      (
        await comparison.recordJudgment(
          actor,
          caseId,
          judgment(violationId, {
            behaviorBases: [
              basis({ clause: 'doc_021 第 76 条', version: 'doc_021@2027-01-01', effectiveFrom: '2027-01-01' }),
            ],
            decisionBases: [basis({ effectiveFrom: '2021-09-01', expiresOn: '2027-01-01' })],
          }),
        )
      ).status,
    ).toBe(200);
    const warning = await comparison.assertComparisonFresh(caseId, new Date('2027-01-01T02:00:00.000Z'), actor);
    expect(warning.status).toBe(200);
    expect(warning.body).toMatchObject({
      result: 'warnings',
      approvedDay: '2027-01-01',
      clauses: ['doc_021 第 76 条'],
      effectiveDay: { attribution: null },
    });
    expect(warning.body.warnings).toEqual([
      {
        level: 'warn',
        code: 'CMP-01',
        message: '施行日当天批准，适用哪一版请法制部门确认',
        citation: null,
        ruleKey: 'CMP-01',
      },
    ]);
    expect(await trails('case.comparison-refused', caseId)).toEqual([]);
  });

  it('Q32：裁量基准到期给提示，不阻断', async () => {
    const caseId = await fileCase();
    const violationId = await addViolation(caseId, '硬化地面');
    const recorded = await comparison.recordJudgment(
      actor,
      caseId,
      judgment(violationId, { decisionBenchmarks: [benchmark({ validUntil: '2026-10-01' })] }),
    );
    expect(recorded.status).toBe(200);
    expect(recorded.body.hints).toEqual([
      expect.objectContaining({ level: 'hint', code: 'CMP-02', ruleKey: 'CMP-02' }),
    ]);
    const fresh = await comparison.assertComparisonFresh(caseId, new Date('2026-12-31T08:00:00.000Z'), actor);
    expect(fresh.status).toBe(200);
    expect(fresh.body).toMatchObject({ result: 'comparison-fresh' });
    expect(fresh.body.hints).toEqual([expect.objectContaining({ code: 'CMP-02' })]);
  });

  it('调查报告呈批不因无比对记录而阻断', async () => {
    const caseId = await fileCase();
    await addViolation(caseId, '硬化地面');
    expect(await cloned.prisma.caseComparisonJudgment.count({ where: { caseId } })).toBe(0);
    const approved = await runSuspension(caseId);
    expect(approved.result).toBeDefined();
    expect(await cloned.prisma.caseComparisonJudgment.count({ where: { caseId } })).toBe(0);
  });
});