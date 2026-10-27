// #238 案件退回：R1–R10、接收人（含 N5 与法制审核归属）、追加式。
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { newUlid } from '../backend/identity/src/index.ts';
import { createApplication } from '../backend/server/src/persistence.module.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const T0 = Date.parse('2026-10-27T06:00:00.000Z');
const SEED_PASSWORD = 'Seed-pass-52';
const NEW_PASSWORD = 'Case-return-238!';
const INITIAL_PASSWORD = 'Return-238!!';

function square(polygonOffset: number): (readonly number[])[] {
  const west = 114 + polygonOffset;
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
const cookies = new Map<string, string>();
const passwords = new Map<string, string>();
let hqId = '';
let deptAId = '';
let deptBId = '';
let stationAId = '';
let handlerMainId = '';
let handlerAssistId = '';
let clerkId = '';
let legalHqId = '';
let legalDistId = '';
let legalStationId = '';
let reviewHqId = '';
let reviewAId = '';
let reviewBId = '';
let distMainId = '';
let distAssistId = '';
let n5MainId = '';
let n5AssistId = '';
let n5MoveMainId = '';
let n5MoveAssistId = '';
let offset = 0;

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
    body: JSON.stringify({
      code,
      name,
      orgUnitId,
      mobilePhone,
      initialPassword: INITIAL_PASSWORD,
      roles: [...roles],
    }),
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
  passwords.set(code, INITIAL_PASSWORD);
  return person.id;
}

async function register(polygonOffset: number, code: string): Promise<{ id: string; code: string }> {
  const form = new FormData();
  form.set('sourceCode', '16');
  form.set('domain', 'land');
  form.set(
    'values',
    JSON.stringify({
      'clue.received_at': '2026-10-27',
      'clue.narrative': '巡查发现一处硬化地面',
      'clue.finder': '巡查员',
      'clue.patrol_no': `XC-238-${polygonOffset}`,
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
      cookie: await cookieOf(code),
      'idempotency-key': `return-${polygonOffset}-${Math.random().toString(36).slice(2)}`,
    },
    body: form,
  });
  expect([200, 201]).toContain(response.status);
  return (await response.json()) as { id: string; code: string };
}

async function postJson(
  path: string,
  code: string,
  body: unknown = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf(code) },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function openCase(input: {
  readonly orgUnitId: string;
  /** 待分派池所属机构的内勤。首次派机构只能由这个人做。 */
  readonly poolCode: string;
  /** 承办机构内勤。派主办、协办只能由这个人做。 */
  readonly intakeCode: string;
  readonly mainId: string;
  readonly assistId: string;
  readonly drafter: string;
  readonly party: string;
}): Promise<{ caseId: string; clueId: string }> {
  offset += 1;
  const registered = await register(offset, input.poolCode);
  const org = await postJson(`/api/clues/${registered.id}/assign-org`, input.poolCode, {
    orgUnitId: input.orgUnitId,
    expectedStatus: 'in_pool',
    reason: '',
    designate: false,
  });
  expect(org.status, JSON.stringify(org.body)).toBe(200);
  const people = await postJson(`/api/clues/${registered.id}/assign-people`, input.intakeCode, {
    mainId: input.mainId,
    assistIds: [input.assistId],
    expectedStatus: 'org_assigned',
  });
  expect(people.status, JSON.stringify(people.body)).toBe(200);
  const drafted = await postJson(`/api/clues/${registered.id}/filing-approval`, input.drafter, {
    content: { conclusion: 'file', partyNames: [input.party] },
  });
  expect(drafted.status, JSON.stringify(drafted.body)).toBe(200);
  const approvalId = String(drafted.body.approvalId);
  expect((await postJson(`/api/filing-approvals/${approvalId}/submit`, input.drafter)).status).toBe(200);
  const approved = await postJson(`/api/filing-approvals/${approvalId}/approve`, 'P-APPROVE-HQ', { opinion: '同意' });
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  const caseRow = await cloned.prisma.caseRecord.findFirstOrThrow({ where: { filingApprovalId: approvalId } });
  return { caseId: caseRow.id, clueId: registered.id };
}

function stationCase(party: string) {
  return openCase({
    orgUnitId: stationAId,
    poolCode: 'P-INTAKE-A',
    intakeCode: 'P-INTAKE-ST',
    mainId: handlerMainId,
    assistId: handlerAssistId,
    drafter: 'P-HANDLER-F1',
    party,
  });
}

async function returnCase(
  caseId: string,
  body: Record<string, unknown>,
  code = 'P-APPROVE-HQ',
): Promise<{ status: number; body: Record<string, unknown> }> {
  return postJson(`/api/cases/${caseId}/returns`, code, {
    reasonCode: 'R9',
    note: '退回说明',
    targetKey: 'drafting:E02',
    receiverId: handlerMainId,
    ...body,
  });
}

async function trailOf(action: string, resourceId: string) {
  return cloned.prisma.$queryRaw<Array<{ outcome: string | null; reason: string | null; detail: string | null }>>`
    SELECT outcome, reason, detail
    FROM audit_trail
    WHERE action = ${action} AND resource_id = ${resourceId}
    ORDER BY created_at DESC, id DESC
  `;
}

beforeAll(async () => {
  cloned = await openClonedDatabase();
  const app = await createApplication(
    cloned.connectionString,
    { now: () => new Date(T0) },
    undefined,
    {
      storagePort: new RecordingStorage() as never,
      queuePort: new RecordingQueue() as never,
      filingAdminReview: 'skip',
    },
  );
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeApp = () => app.close();
  const orgOf = async (code: string) => {
    const org = await cloned.prisma.orgUnit.findUnique({ where: { code } });
    if (!org) throw new Error(`缺少种子机构 ${code}`);
    return org.id;
  };
  hqId = await orgOf('ORG-HQ');
  deptAId = await orgOf('ORG-DEPT-A');
  deptBId = await orgOf('ORG-DEPT-B');
  stationAId = await orgOf('ORG-STATION-A');
  await seedPerson('P-INTAKE-A', '甲区内勤', deptAId, ['内勤'], '13900006211');
  await seedPerson('P-INTAKE-ST', '甲所内勤', stationAId, ['内勤'], '13900006212');
  handlerMainId = await seedPerson('P-HANDLER-F1', '主办甲', stationAId, ['经办'], '13900006213');
  handlerAssistId = await seedPerson('P-HANDLER-F2', '协办乙', stationAId, ['经办'], '13900006214');
  clerkId = await seedPerson('P-CLERK-FA', '内勤丙', stationAId, ['内勤'], '13900006215');
  legalHqId = await seedPerson('P-LEGAL-HQ', '市局法制', hqId, ['法制审核'], '13900006201');
  legalDistId = await seedPerson('P-LEGAL-DIST', '甲区法制', deptAId, ['法制审核'], '13900006202');
  reviewHqId = await seedPerson('P-REVIEW-HQ', '市局审核', hqId, ['行政审核'], '13900006203');
  reviewBId = await seedPerson('P-REVIEW-B', '乙区审核', deptBId, ['行政审核'], '13900006204');
  distMainId = await seedPerson('P-DIST-H1', '区主办', deptAId, ['经办'], '13900006205');
  distAssistId = await seedPerson('P-DIST-H2', '区协办', deptAId, ['经办'], '13900006206');
  n5MainId = await seedPerson('P-N5-M1', '停用主办', stationAId, ['经办'], '13900006207');
  n5AssistId = await seedPerson('P-N5-A1', '停用协办', stationAId, ['经办'], '13900006208');
  n5MoveMainId = await seedPerson('P-N5-M2', '调离主办', stationAId, ['经办'], '13900006209');
  n5MoveAssistId = await seedPerson('P-N5-A2', '调离协办', stationAId, ['经办'], '13900006210');
  legalStationId = (await cloned.prisma.personnel.findFirstOrThrow({ where: { code: 'P-LEGAL-ST' } })).id;
  reviewAId = (await cloned.prisma.personnel.findFirstOrThrow({ where: { code: 'P-REVIEW-A' } })).id;
}, 120_000);

afterAll(async () => {
  await closeApp();
  await cloned.close();
});

beforeEach(() => {
  cookies.clear();
});

describe('#238 法制审核归属', () => {
  it('所承办：市局法审 409；同归属的区分局法审通过；行政审核仍看覆盖', async () => {
    const { caseId } = await stationCase('所案甲');
    const cityLegal = await returnCase(caseId, { receiverId: legalHqId });
    expect(cityLegal.status).toBe(409);
    expect(cityLegal.body.reason).toBe('receiver-not-allowed');
    const stationLegal = await returnCase(caseId, { receiverId: legalStationId });
    expect(stationLegal.status).toBe(409);
    expect(stationLegal.body.reason).toBe('receiver-not-allowed');
    const otherAdmin = await returnCase(caseId, { receiverId: reviewBId });
    expect(otherAdmin.status).toBe(409);
    expect(otherAdmin.body.reason).toBe('receiver-not-allowed');
    const row = await cloned.prisma.caseRecord.findUniqueOrThrow({ where: { id: caseId } });
    expect(row.currentStage).toBe('E02');
    expect(row.stageEntrySeq).toBe(1);
    const cityAdmin = await returnCase(caseId, { receiverId: reviewHqId, note: '市局审核覆盖所' });
    expect(cityAdmin.status).toBe(200);
    expect(cityAdmin.body.n5).toBe(false);
    const districtLegal = await returnCase(caseId, { receiverId: legalDistId, note: '区分局法审' });
    expect(districtLegal.status).toBe(200);
    expect(districtLegal.body.receiverId).toBe(legalDistId);
    const trails = await trailOf('case.returned', caseId);
    expect(trails.some((item) => item.outcome === 'failed' && item.reason === 'receiver-not-allowed')).toBe(true);
    expect(trails.every((item) => !String(item.detail ?? '').includes('区分局法审'))).toBe(true);
  });

  it('区承办：市局法审 409；本区分局法审通过；本区行政审核按覆盖通过', async () => {
    const { caseId } = await openCase({
      orgUnitId: deptAId,
      poolCode: 'P-INTAKE-A',
      intakeCode: 'P-INTAKE-A',
      mainId: distMainId,
      assistId: distAssistId,
      drafter: 'P-DIST-H1',
      party: '区案甲',
    });
    const cityLegal = await returnCase(caseId, { receiverId: legalHqId });
    expect(cityLegal.status).toBe(409);
    expect(cityLegal.body.reason).toBe('receiver-not-allowed');
    const districtLegal = await returnCase(caseId, { receiverId: legalDistId, note: '本区法审' });
    expect(districtLegal.status).toBe(200);
    const districtAdmin = await returnCase(caseId, { receiverId: reviewAId, note: '本区审核覆盖' });
    expect(districtAdmin.status).toBe(200);
    const row = await cloned.prisma.caseRecord.findUniqueOrThrow({ where: { id: caseId } });
    expect(row.handlingOrgId).toBe(deptAId);
    expect(row.currentStage).toBe('E02');
    expect(row.stageEntrySeq).toBe(1);
  });
});

describe('#238 案件退回验收', () => {
  async function addInstance(caseId: string, stage: string, entrySeq: number): Promise<string> {
    const id = newUlid();
    await cloned.prisma.caseStageInstance.create({
      data: {
        id,
        caseId,
        stage,
        entrySeq,
        status: 'drafting',
        enteredAt: new Date(T0),
        enteredBy: handlerMainId,
        transitionCode: 'T01',
      },
    });
    return id;
  }

  it('不填原因 400；目标不在集合内 409 且留失败痕', async () => {
    const { caseId } = await stationCase('原因甲');
    const missing = await returnCase(caseId, { reasonCode: '', note: '有说明' });
    expect(missing.status).toBe(400);
    expect(missing.body.reason).toBe('missing-return-reason');
    const wrong = await returnCase(caseId, { reasonCode: 'R2', targetKey: 'stage:E04', note: '错点' });
    expect(wrong.status).toBe(409);
    expect(wrong.body.reason).toBe('return-target-not-allowed');
    const trails = await trailOf('case.returned', caseId);
    expect(trails.some((item) => item.outcome === 'failed' && item.reason === 'return-target-not-allowed')).toBe(true);
    expect(await cloned.prisma.caseReturn.count({ where: { caseId } })).toBe(0);
  });

  it('R3 与 R7、R5 指向未启用环节都是 409，没有成功路径', async () => {
    const { caseId } = await stationCase('外部甲');
    const external = await returnCase(caseId, { reasonCode: 'R3', targetKey: 'stage:E02', note: '外部' });
    expect(external.status).toBe(409);
    expect(external.body.reason).toBe('external-return');
    const r7 = await returnCase(caseId, { reasonCode: 'R7', targetKey: 'stage:E05', note: '新法' });
    expect(r7.status).toBe(409);
    expect(r7.body.reason).toBe('transition-disabled');
    const r5 = await returnCase(caseId, {
      reasonCode: 'R5',
      targetKey: 'stage:E10',
      defectiveStage: 'E10',
      note: '送达',
    });
    expect(r5.status).toBe(409);
    expect(r5.body.reason).toBe('transition-disabled');
    const r10 = await returnCase(caseId, { reasonCode: 'R10', note: '', inheritedCode: 'R9' });
    expect(r10.status).toBe(409);
    expect(r10.body.reason).toBe('missing-return-note');
    const noPoint = await returnCase(caseId, { reasonCode: 'R10', note: '其他', inheritedCode: '' });
    expect(noPoint.status).toBe(409);
    expect(noPoint.body.reason).toBe('missing-return-target');
  });

  it('R1 审理前撤案、审理后不予处罚；R6 只给出移送出口', async () => {
    const before = await stationCase('出口甲');
    const r1 = await returnCase(before.caseId, {
      reasonCode: 'R1',
      targetKey: 'exit:withdraw-after-terminate',
      note: '无事实',
    });
    expect(r1.status).toBe(200);
    expect(r1.body.exit).toBe('withdraw-after-terminate');
    expect(r1.body.reflow).toBe(false);
    const beforeRow = await cloned.prisma.caseRecord.findUniqueOrThrow({ where: { id: before.caseId } });
    expect(beforeRow.currentStage).toBe('E02');
    expect(beforeRow.stageEntrySeq).toBe(1);

    const after = await stationCase('出口乙');
    await cloned.prisma.caseRecord.update({ where: { id: after.caseId }, data: { currentStage: 'E04' } });
    const later = await returnCase(after.caseId, {
      reasonCode: 'R1',
      targetKey: 'exit:no-penalty',
      note: '审理后无事实',
    });
    expect(later.status).toBe(200);
    expect(later.body.exit).toBe('no-penalty');
    const afterRow = await cloned.prisma.caseRecord.findUniqueOrThrow({ where: { id: after.caseId } });
    expect(afterRow.currentStage).toBe('E04');

    const transfer = await returnCase(after.caseId, {
      reasonCode: 'R6',
      targetKey: 'exit:transfer',
      note: '不管辖',
    });
    expect(transfer.status).toBe(200);
    expect(transfer.body.exit).toBe('transfer');
    expect(transfer.body.reflow).toBe(false);
  });

  it('R2 回调查：E02 次序号加 1，E04 及以后失效，材料不改，旧签字不能再用', async () => {
    const { caseId } = await stationCase('回流甲');
    const e02 = await cloned.prisma.caseStageInstance.findFirstOrThrow({ where: { caseId, stage: 'E02' } });
    const e03 = await addInstance(caseId, 'E03', 1);
    const e04 = await addInstance(caseId, 'E04', 1);
    const recordId = newUlid();
    const noticeId = newUlid();
    await cloned.prisma.caseMaterial.create({
      data: { id: recordId, caseId, kind: 'investigation-record', body: '调查记录原文' },
    });
    await cloned.prisma.caseMaterial.create({
      data: { id: noticeId, caseId, kind: 'notice', body: '告知书原文' },
    });
    const sigE04 = newUlid();
    const sigE02 = newUlid();
    await cloned.prisma.caseStageSignature.create({
      data: { id: sigE04, caseId, instanceId: e04, actorId: handlerMainId },
    });
    await cloned.prisma.caseStageSignature.create({
      data: { id: sigE02, caseId, instanceId: e02.id, actorId: handlerMainId },
    });
    await cloned.prisma.caseRecord.update({ where: { id: caseId }, data: { currentStage: 'E04' } });
    const beforeMaterials = await cloned.prisma.caseMaterial.findMany({
      where: { caseId },
      orderBy: { id: 'asc' },
    });
    const returned = await returnCase(caseId, {
      reasonCode: 'R2',
      targetKey: 'stage:E02',
      note: '补调查',
    });
    expect(returned.status).toBe(200);
    expect(returned.body.entrySeq).toBe(2);
    expect(returned.body.rehearingRequired).toBe(true);
    const row = await cloned.prisma.caseRecord.findUniqueOrThrow({ where: { id: caseId } });
    expect(row.currentStage).toBe('E02');
    expect(row.stageEntrySeq).toBe(2);
    const e02rows = await cloned.prisma.caseStageInstance.findMany({ where: { caseId, stage: 'E02' } });
    expect(e02rows.map((item) => item.entrySeq).sort()).toEqual([1, 2]);
    expect(e02rows.find((item) => item.id === e02.id)?.status).toBe('drafting');
    const invalid = new Set(
      (await cloned.prisma.caseStageInvalidation.findMany({ where: { caseId } })).map((item) => item.instanceId),
    );
    expect(invalid.has(e04)).toBe(true);
    expect(invalid.has(e03)).toBe(false);
    expect(invalid.has(e02.id)).toBe(false);
    const afterMaterials = await cloned.prisma.caseMaterial.findMany({ where: { caseId }, orderBy: { id: 'asc' } });
    expect(afterMaterials).toEqual(beforeMaterials);
    const blocked = await postJson(`/api/cases/${caseId}/signatures/${sigE04}/reuse`, 'P-APPROVE-HQ');
    expect(blocked.status).toBe(409);
    expect(blocked.body.reason).toBe('signature-invalidated');
    const reusable = await postJson(`/api/cases/${caseId}/signatures/${sigE02}/reuse`, 'P-APPROVE-HQ');
    expect(reusable.status).toBe(200);
  });

  it('R4 回流到 E04 加次序号但不失效下游；R5 回到有瑕疵的已启用环节', async () => {
    const { caseId } = await stationCase('审理甲');
    const e04 = await addInstance(caseId, 'E04', 1);
    await cloned.prisma.caseRecord.update({ where: { id: caseId }, data: { currentStage: 'E09' } });
    const r4 = await returnCase(caseId, { reasonCode: 'R4', targetKey: 'stage:E04', note: '定性' });
    expect(r4.status).toBe(200);
    expect(r4.body.entrySeq).toBe(2);
    expect(r4.body.noticeValidity).toBe('deferred');
    expect(await cloned.prisma.caseStageInvalidation.count({ where: { instanceId: e04 } })).toBe(0);
    const r5 = await returnCase(caseId, {
      reasonCode: 'R5',
      targetKey: 'stage:E04',
      defectiveStage: 'E04',
      note: '告知瑕疵',
    });
    expect(r5.status).toBe(200);
    expect(r5.body.entrySeq).toBe(3);
  });

  it('R8、R9、R10 继承 R9：次序号不变，不新增实例，不失效', async () => {
    const { caseId } = await stationCase('文号甲');
    const before = await cloned.prisma.caseStageInstance.count({ where: { caseId } });
    await cloned.prisma.caseRecord.update({ where: { id: caseId }, data: { currentStage: 'E09' } });
    const r8 = await returnCase(caseId, { reasonCode: 'R8', targetKey: 'drafting:E09', note: '金额' });
    expect(r8.status).toBe(200);
    expect(r8.body.reflow).toBe(false);
    expect(r8.body.entrySeq).toBe(1);
    const r9 = await returnCase(caseId, { reasonCode: 'R9', targetKey: 'drafting:E09', note: '文号' });
    expect(r9.status).toBe(200);
    const r10 = await returnCase(caseId, {
      reasonCode: 'R10',
      targetKey: 'drafting:E09',
      inheritedCode: 'R9',
      note: '其他文号',
    });
    expect(r10.status).toBe(200);
    expect(r10.body.target).toBe('drafting:E09');
    const row = await cloned.prisma.caseRecord.findUniqueOrThrow({ where: { id: caseId } });
    expect(row.currentStage).toBe('E09');
    expect(row.stageEntrySeq).toBe(1);
    expect(await cloned.prisma.caseStageInstance.count({ where: { caseId } })).toBe(before);
    expect(await cloned.prisma.caseStageInvalidation.count({ where: { caseId } })).toBe(0);
    const recorded = await cloned.prisma.caseReturn.findFirstOrThrow({
      where: { caseId, reasonCode: 'R8' },
    });
    expect(recorded.targetKey).toBe('drafting:E09');
    expect(recorded.reflow).toBe(false);
    expect(recorded.entrySeqAfter).toBeNull();
  });

  it('主办协办都在时不能退回内勤；都停用或都调离时可以，内勤不能改文书', async () => {
    const available = await stationCase('内勤甲');
    const denied = await returnCase(available.caseId, {
      reasonCode: 'R2',
      targetKey: 'stage:E02',
      receiverId: clerkId,
      note: '退内勤',
    });
    expect(denied.status).toBe(409);
    expect(denied.body.reason).toBe('receiver-not-allowed');

    const stopped = await openCase({
      orgUnitId: stationAId,
      poolCode: 'P-INTAKE-A',
      intakeCode: 'P-INTAKE-ST',
      mainId: n5MainId,
      assistId: n5AssistId,
      drafter: 'P-N5-M1',
      party: '停用案',
    });
    await cloned.prisma.personnel.update({ where: { id: n5MainId }, data: { deactivatedAt: new Date(T0) } });
    await cloned.prisma.personnel.update({ where: { id: n5AssistId }, data: { deactivatedAt: new Date(T0) } });
    const n5 = await returnCase(stopped.caseId, {
      reasonCode: 'R2',
      targetKey: 'stage:E02',
      receiverId: clerkId,
      note: '两人都停用',
    });
    expect(n5.status).toBe(200);
    expect(n5.body.n5).toBe(true);
    const edit = await postJson(`/api/cases/${stopped.caseId}/document-drafts`, 'P-CLERK-FA');
    expect(edit.status).toBe(403);
    const handlerDraft = await postJson(`/api/cases/${available.caseId}/document-drafts`, 'P-HANDLER-F1');
    expect(handlerDraft.status).toBe(409);
    expect(handlerDraft.body.reason).toBe('transition-disabled');

    const moved = await openCase({
      orgUnitId: stationAId,
      poolCode: 'P-INTAKE-A',
      intakeCode: 'P-INTAKE-ST',
      mainId: n5MoveMainId,
      assistId: n5MoveAssistId,
      drafter: 'P-N5-M2',
      party: '调离案',
    });
    for (const personnelId of [n5MoveMainId, n5MoveAssistId]) {
      const current = await cloned.prisma.personnelAssignment.findFirstOrThrow({
        where: { personnelId, endedAt: null },
      });
      await cloned.prisma.personnelAssignment.update({
        where: { id: current.id },
        data: { endedAt: new Date(T0) },
      });
      await cloned.prisma.personnelAssignment.create({
        data: { id: newUlid(), personnelId, orgUnitId: deptBId, startedAt: new Date(T0) },
      });
    }
    const transferred = await returnCase(moved.caseId, {
      reasonCode: 'R2',
      targetKey: 'stage:E02',
      receiverId: clerkId,
      note: '两人都调离',
    });
    expect(transferred.status).toBe(200);
    expect(transferred.body.n5).toBe(true);
    const trail = await trailOf('case.returned', moved.caseId);
    expect(trail.some((item) => item.outcome === 'succeeded' && String(item.detail).includes('"n5":true'))).toBe(true);
  });

  it('监督不能直接退回，返回 403', async () => {
    const { caseId } = await stationCase('监督甲');
    const returned = await returnCase(
      caseId,
      { reasonCode: 'R9', targetKey: 'drafting:E02', note: '监督退回' },
      'P-SUPER-B',
    );
    expect(returned.status).toBe(403);
    expect(await cloned.prisma.caseReturn.count({ where: { caseId } })).toBe(0);
  });

  it('审批意见和退回记录只追加', async () => {
    const { caseId } = await stationCase('追加甲');
    const returned = await returnCase(caseId, { note: '留底' });
    expect(returned.status).toBe(200);
    const opinion = await cloned.prisma.caseApprovalOpinion.findFirstOrThrow({ where: { caseId } });
    const row = await cloned.prisma.caseReturn.findFirstOrThrow({ where: { caseId } });
    await expect(
      cloned.prisma.$executeRaw`UPDATE case_approval_opinion SET note = '改' WHERE id = ${opinion.id}`,
    ).rejects.toThrow();
    await expect(
      cloned.prisma.$executeRaw`DELETE FROM case_approval_opinion WHERE id = ${opinion.id}`,
    ).rejects.toThrow();
    await expect(
      cloned.prisma.$executeRaw`UPDATE case_return SET target_key = 'drafting:E01' WHERE id = ${row.id}`,
    ).rejects.toThrow();
    await expect(cloned.prisma.$executeRaw`DELETE FROM case_return WHERE id = ${row.id}`).rejects.toThrow();
    expect(await cloned.prisma.caseApprovalOpinion.count({ where: { caseId } })).toBe(1);
    expect(await cloned.prisma.caseReturn.count({ where: { caseId } })).toBe(1);
  });
});
