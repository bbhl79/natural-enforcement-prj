// #243 定型（E13／T27）：材料完整性、缺件与回证经批准、送达 A/B、X12 与代次。
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApplication } from '../backend/server/src/persistence.module.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const T0 = Date.parse('2026-10-30T06:00:00.000Z');
const SEED_PASSWORD = 'Seed-pass-52';
const NEW_PASSWORD = 'Case-finalize-243!';
const INITIAL_PASSWORD = 'Finalize-243!';

function square(offset: number): (readonly number[])[] {
  const west = 114 + offset;
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

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function ulid(): string {
  let value = '0';
  for (let index = 0; index < 25; index += 1) {
    value += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return value;
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
let stationAId = '';
let deptAId = '';
let handlerMainId = '';
let handlerAssistId = '';
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
      'clue.received_at': '2026-10-30',
      'clue.narrative': '巡查发现一处硬化地面',
      'clue.finder': '巡查员',
      'clue.patrol_no': `XC-243-${polygonOffset}`,
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
      cookie: await cookieOf('P-243-IN'),
      'idempotency-key': `finalize-${polygonOffset}-${Math.random().toString(36).slice(2)}`,
    },
    body: form,
  });
  expect([200, 201]).toContain(response.status);
  return (await response.json()) as { id: string };
}

async function toHandlerAssigned(clueId: string): Promise<void> {
  const org = await fetch(`${baseUrl}/api/clues/${clueId}/assign-org`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf('P-243-IN') },
    body: JSON.stringify({ orgUnitId: stationAId, expectedStatus: 'in_pool', reason: '', designate: false }),
  });
  expect(org.status).toBe(200);
  const people = await fetch(`${baseUrl}/api/clues/${clueId}/assign-people`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf('P-243-ST') },
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

async function getJson(path: string, code: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, { headers: { cookie: await cookieOf(code) } });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function fileCase(): Promise<string> {
  offset += 1;
  const registered = await register(offset);
  await toHandlerAssigned(registered.id);
  const drafted = await postJson(`/api/clues/${registered.id}/filing-approval`, 'P-243-H1', {
    content: { conclusion: 'file', partyNames: ['张三'] },
  });
  expect(drafted.status).toBe(200);
  const approvalId = String(drafted.body.approvalId);
  expect((await postJson(`/api/filing-approvals/${approvalId}/submit`, 'P-243-H1')).status).toBe(200);
  expect((await postJson(`/api/filing-approvals/${approvalId}/review`, 'P-243-RV', { opinion: '同意' })).status).toBe(200);
  const approved = await postJson(`/api/filing-approvals/${approvalId}/approve`, 'P-APPROVE-HQ', { opinion: '同意' });
  expect(approved.status).toBe(200);
  return String(approved.body.caseId);
}

async function runProcedure(caseId: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const drafted = await postJson(`/api/cases/${caseId}/procedures`, 'P-243-H1', body);
  expect(drafted.status, JSON.stringify(drafted.body)).toBe(200);
  const approvalId = String(drafted.body.approvalId);
  expect((await postJson(`/api/procedures/${approvalId}/submit`, 'P-243-H1')).status).toBe(200);
  expect((await postJson(`/api/procedures/${approvalId}/review`, 'P-243-RV', { opinion: '同意' })).status).toBe(200);
  const approved = await postJson(`/api/procedures/${approvalId}/approve`, 'P-APPROVE-HQ', { opinion: '同意' });
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  return approved.body;
}

async function withdrawCase(): Promise<string> {
  const caseId = await fileCase();
  await runProcedure(caseId, { kind: 'terminate', reason: 'other' });
  await runProcedure(caseId, { kind: 'withdraw', reason: 'fact-not-established' });
  return caseId;
}

async function closeCase(caseId: string, options: { readonly termination: boolean }): Promise<void> {
  await cloned.prisma.caseRecord.update({ where: { id: caseId }, data: { status: 'closed' } });
  if (options.termination) {
    await cloned.prisma.caseTransition.create({
      data: {
        id: ulid(),
        caseId,
        clueId: null,
        transitionCode: 'T07',
        actorId: handlerMainId,
        fromJson: '{}',
        toJson: '{}',
        createdAt: new Date(T0),
      },
    });
  }
}

async function seedStage(caseId: string, stage: string, transitionCode: string): Promise<void> {
  await cloned.prisma.caseStageInstance.create({
    data: {
      id: ulid(),
      caseId,
      stage,
      entrySeq: 1,
      status: 'completed',
      enteredAt: new Date(T0),
      enteredBy: handlerMainId,
      transitionCode,
    },
  });
}

async function seedTransfer(caseId: string, withReceipt: boolean): Promise<string> {
  const approvalId = ulid();
  const transferId = ulid();
  await cloned.prisma.caseTransferApproval.create({
    data: {
      id: approvalId,
      caseId,
      kind: 'jurisdiction',
      status: 'approved',
      currentVersionNo: 0,
      drafterId: handlerMainId,
      approvalChainId: null,
    },
  });
  await cloned.prisma.caseTransfer.create({
    data: {
      id: transferId,
      caseId,
      kind: 'jurisdiction',
      receivingOrg: '某区市场监督管理局',
      documentNo: '穗自然资移〔2026〕9 号',
      letterDate: '2026-10-30',
      reason: '不属本部门管辖',
      approvalId,
      recordedBy: handlerMainId,
      recordedAt: new Date(T0),
    },
  });
  if (withReceipt) await seedReceipt(caseId, transferId);
  return transferId;
}

async function seedReceipt(caseId: string, transferId: string): Promise<void> {
  await cloned.prisma.caseTransferFile.create({
    data: {
      id: ulid(),
      caseId,
      approvalId: null,
      transferId,
      kind: 'receipt',
      fileKey: `case/${caseId}/transfer/${transferId}/receipt`,
      versionId: 'version-1',
      fileName: '回证.pdf',
      contentType: 'application/pdf',
      byteSize: 10,
      digest: 'digest',
      uploadedBy: handlerMainId,
      uploadedAt: new Date(T0),
    },
  });
}

async function addMaterial(caseId: string, itemCode: number, delivery?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  return postJson(`/api/cases/${caseId}/dossier-materials`, 'P-243-H1', {
    itemCode,
    ...(delivery === undefined ? {} : { delivery }),
  });
}

async function addBaseMaterials(caseId: string): Promise<void> {
  for (const itemCode of [1, 2, 4, 19]) {
    const added = await addMaterial(caseId, itemCode);
    expect(added.status, JSON.stringify(added.body)).toBe(200);
  }
}

async function startApproval(caseId: string, missingReason = ''): Promise<string> {
  const drafted = await postJson(`/api/cases/${caseId}/finalize`, 'P-243-H1', { missingReason });
  expect(drafted.status, JSON.stringify(drafted.body)).toBe(200);
  return String(drafted.body.approvalId);
}

async function submitApproval(approvalId: string): Promise<{ status: number; body: Record<string, unknown> }> {
  return postJson(`/api/finalize-approvals/${approvalId}/submit`, 'P-243-H1');
}

async function approveApproval(approvalId: string): Promise<{ status: number; body: Record<string, unknown> }> {
  expect((await postJson(`/api/finalize-approvals/${approvalId}/review`, 'P-243-RV', { opinion: '同意' })).status).toBe(200);
  return postJson(`/api/finalize-approvals/${approvalId}/approve`, 'P-APPROVE-HQ', { opinion: '同意' });
}

beforeAll(async () => {
  cloned = await openClonedDatabase();
  const app = await createApplication(cloned.connectionString, { now: () => new Date(T0) }, undefined, {
    storagePort: new RecordingStorage() as never,
    queuePort: new RecordingQueue() as never,
    filingAdminReview: 'one-level',
  });
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeApp = () => app.close();
  const orgOf = async (code: string) => {
    const org = await cloned.prisma.orgUnit.findUnique({ where: { code } });
    if (!org) throw new Error(`缺少种子机构 ${code}`);
    return org.id;
  };
  deptAId = await orgOf('ORG-DEPT-A');
  stationAId = await orgOf('ORG-STATION-A');
  await seedPerson('P-243-IN', '甲区内勤', deptAId, ['内勤'], '13900024301');
  await seedPerson('P-243-ST', '甲所内勤', stationAId, ['内勤'], '13900024302');
  handlerMainId = await seedPerson('P-243-H1', '主办甲', stationAId, ['经办'], '13900024303');
  handlerAssistId = await seedPerson('P-243-H2', '协办乙', stationAId, ['经办'], '13900024304');
  await seedPerson('P-243-RV', '所内审核', stationAId, ['行政审核'], '13900024305');
}, 180_000);

afterAll(async () => {
  await closeApp();
  await cloned.close();
});

beforeEach(() => {
  cookies.clear();
});

describe('#243 定型', () => {
  it('已撤案且材料齐全：归档审批通过后已定型，写归档代次 1 与冻结清单', async () => {
    const caseId = await withdrawCase();
    await addBaseMaterials(caseId);
    const generic = await postJson(`/api/cases/${caseId}/transitions`, 'P-APPROVE-HQ', { transitionId: 'T27' });
    expect(generic.status).toBe(409);
    expect(generic.body.reason).toBe('procedure-required');
    const read = await getJson(`/api/cases/${caseId}/finalize`, 'P-243-H1');
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({
      status: 'withdrawn',
      missingItems: [],
      materialsRule: { ruleId: 'cfg.rule.dossier-materials.v1' },
      readiness: { reasonRequired: false, conclusion: 'complete' },
    });
    const approvalId = await startApproval(caseId);
    expect((await submitApproval(approvalId)).status).toBe(200);
    const approved = await approveApproval(approvalId);
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body).toMatchObject({
      result: 'finalize-approved',
      status: 'finalized',
      generationNo: 1,
      conclusion: 'complete',
      conclusionName: '完整',
    });
    const row = await cloned.prisma.caseRecord.findUniqueOrThrow({ where: { id: caseId } });
    expect(row.status).toBe('finalized');
    const finalize = await cloned.prisma.caseFinalize.findFirstOrThrow({ where: { caseId } });
    expect(finalize.generationNo).toBe(1);
    expect(finalize.conclusion).toBe('complete');
    expect(finalize.missingReason).toBeNull();
    const checklist = JSON.parse(finalize.checklistJson) as Array<{ itemCode: number; required: boolean }>;
    expect(checklist).toHaveLength(21);
    expect(checklist.filter((row) => row.required).map((row) => row.itemCode)).toEqual([1, 2, 4, 19]);
    const transition = await cloned.prisma.caseTransition.findFirstOrThrow({ where: { caseId, transitionCode: 'T27' } });
    expect(transition.toJson).toContain('finalized');
    const detail = await getJson(`/api/cases/${caseId}/finalize`, 'P-243-H1');
    expect(detail.body).toMatchObject({
      finalize: { generationNo: 1, conclusion: 'complete', conclusionName: '完整' },
    });
  });

  it('已结案但材料缺失：未写理由提交 409；写明理由经批准后定型，结论经批准缺项且理由随卷', async () => {
    const caseId = await fileCase();
    await closeCase(caseId, { termination: true });
    for (const itemCode of [1, 2, 4]) {
      expect((await addMaterial(caseId, itemCode)).status).toBe(200);
    }
    const approvalId = await startApproval(caseId);
    const denied = await submitApproval(approvalId);
    expect(denied.status).toBe(409);
    expect(denied.body.reason).toBe('materials-incomplete');
    expect(await cloned.prisma.caseFinalize.count({ where: { caseId } })).toBe(0);

    const redrafted = await startApproval(caseId, '结案呈批表线下留存，随纸质卷宗归档');
    expect(redrafted).toBe(approvalId);
    expect((await submitApproval(approvalId)).status).toBe(200);
    const approved = await approveApproval(approvalId);
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body).toMatchObject({
      status: 'finalized',
      conclusion: 'approved-missing',
      conclusionName: '经批准缺项',
      missingItems: [19],
    });
    const finalize = await cloned.prisma.caseFinalize.findFirstOrThrow({ where: { caseId } });
    expect(finalize.conclusion).toBe('approved-missing');
    expect(finalize.missingReason).toBe('结案呈批表线下留存，随纸质卷宗归档');
    expect(finalize.receiptDeficient).toBe(false);
  });

  it('未结案、未撤案：T27 返回 409 invalid-state', async () => {
    const caseId = await fileCase();
    const drafted = await postJson(`/api/cases/${caseId}/finalize`, 'P-243-H1', {});
    expect(drafted.status).toBe(409);
    expect(drafted.body.reason).toBe('invalid-state');
    expect(await cloned.prisma.caseFinalizeApproval.count({ where: { caseId } })).toBe(0);
    const generic = await postJson(`/api/cases/${caseId}/transitions`, 'P-APPROVE-HQ', { transitionId: 'T27' });
    expect(generic.status).toBe(409);
    expect(generic.body.reason).toBe('invalid-state');
  });

  it('移送管辖、终止调查结案豁免 (5)(6)(7)(9)；未豁免的案件仍要求这四项', async () => {
    const exemptCase = await fileCase();
    await seedStage(exemptCase, 'E04', 'T08');
    await closeCase(exemptCase, { termination: true });
    await addBaseMaterials(exemptCase);
    const exemptRead = await getJson(`/api/cases/${exemptCase}/finalize`, 'P-243-H1');
    expect(exemptRead.body).toMatchObject({
      requirement: { requiredItems: [1, 2, 4, 19], exemptItems: [5, 6, 7, 9] },
      missingItems: [],
    });
    const exemptApproval = await startApproval(exemptCase);
    expect((await submitApproval(exemptApproval)).status).toBe(200);
    expect((await approveApproval(exemptApproval)).status).toBe(200);

    const strictCase = await fileCase();
    await seedStage(strictCase, 'E04', 'T08');
    await closeCase(strictCase, { termination: false });
    await addBaseMaterials(strictCase);
    const strictApproval = await startApproval(strictCase);
    const denied = await submitApproval(strictApproval);
    expect(denied.status).toBe(409);
    expect(denied.body.reason).toBe('materials-incomplete');
    const strictRead = await getJson(`/api/cases/${strictCase}/finalize`, 'P-243-H1');
    expect(strictRead.body).toMatchObject({
      missingItems: [5, 6, 7, 9],
    });
  });

  it('移送回证缺失：未写理由提交 409；写明理由经批准后定型，回证缺项随卷', async () => {
    const caseId = await fileCase();
    await closeCase(caseId, { termination: true });
    await addBaseMaterials(caseId);
    await seedTransfer(caseId, false);
    const approvalId = await startApproval(caseId);
    const denied = await submitApproval(approvalId);
    expect(denied.status).toBe(409);
    expect(denied.body.reason).toBe('receipt-missing');

    await startApproval(caseId, '回证线下取得后补');
    expect((await submitApproval(approvalId)).status).toBe(200);
    const approved = await approveApproval(approvalId);
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body).toMatchObject({ conclusion: 'approved-missing', receiptDeficient: true });
    const finalize = await cloned.prisma.caseFinalize.findFirstOrThrow({ where: { caseId } });
    expect(finalize.receiptDeficient).toBe(true);
  });

  it('回证齐全不阻断；送达接受回证或公告替代材料', async () => {
    const receiptCase = await fileCase();
    await closeCase(receiptCase, { termination: true });
    await addBaseMaterials(receiptCase);
    await seedTransfer(receiptCase, true);
    const receiptApproval = await startApproval(receiptCase);
    expect((await submitApproval(receiptApproval)).status).toBe(200);
    expect((await approveApproval(receiptApproval)).status).toBe(200);

    const deliveryCase = await fileCase();
    await seedStage(deliveryCase, 'E10', 'T24');
    await closeCase(deliveryCase, { termination: true });
    for (const itemCode of [1, 2, 4, 5, 6, 7, 9, 19]) {
      expect((await addMaterial(deliveryCase, itemCode)).status).toBe(200);
    }
    const invalid = await addMaterial(deliveryCase, 20);
    expect(invalid.status).toBe(400);
    expect(invalid.body.reason).toBe('invalid-delivery-evidence');
    const added = await addMaterial(deliveryCase, 20, {
      kind: 'announcement',
      reasonRecord: '当事人下落不明，已公告送达',
      announcementMaterials: ['公告截图.pdf'],
    });
    expect(added.status).toBe(200);
    const deliveryRead = await getJson(`/api/cases/${deliveryCase}/finalize`, 'P-243-H1');
    expect(deliveryRead.body).toMatchObject({
      requirement: { deliveryRequired: true },
      missingItems: [],
    });
    const deliveryApproval = await startApproval(deliveryCase);
    expect((await submitApproval(deliveryApproval)).status).toBe(200);
    expect((await approveApproval(deliveryApproval)).status).toBe(200);
  });

  it('已定型后业务写 409 X12；阅读与定型状态放行', async () => {
    const caseId = await fileCase();
    await closeCase(caseId, { termination: true });
    await addBaseMaterials(caseId);
    const approvalId = await startApproval(caseId);
    expect((await submitApproval(approvalId)).status).toBe(200);
    expect((await approveApproval(approvalId)).status).toBe(200);

    const material = await addMaterial(caseId, 21);
    expect(material.status).toBe(409);
    expect(material.body.reason).toBe('X12');
    const transition = await postJson(`/api/cases/${caseId}/transitions`, 'P-APPROVE-HQ', { transitionId: 'T03' });
    expect(transition.status).toBe(409);
    expect(transition.body.reason).toBe('X12');
    const read = await getJson(`/api/cases/${caseId}`, 'P-243-H1');
    expect(read.status).toBe(200);
    expect(read.body.status).toBe('finalized');
    const readFinalize = await getJson(`/api/cases/${caseId}/finalize`, 'P-243-H1');
    expect(readFinalize.status).toBe(200);
    expect(readFinalize.body.finalize).toMatchObject({ generationNo: 1, conclusion: 'complete' });
  });

  it('结案本身不依赖本票：未定型也保持已结案', async () => {
    const caseId = await fileCase();
    await closeCase(caseId, { termination: true });
    const row = await cloned.prisma.caseRecord.findUniqueOrThrow({ where: { id: caseId } });
    expect(row.status).toBe('closed');
    expect(await cloned.prisma.caseFinalize.count({ where: { caseId } })).toBe(0);
    const read = await getJson(`/api/cases/${caseId}`, 'P-243-H1');
    expect(read.status).toBe(200);
    expect(read.body.status).toBe('closed');
  });
});