// #270 决定、送达、执行记载与结案（T23–T26）：X05／X06／X10／X11／X16、两支与 Q25。
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApplication } from '../backend/server/src/persistence.module.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const T0 = Date.parse('2026-10-30T06:00:00.000Z');
const SEED_PASSWORD = 'Seed-pass-52';
const NEW_PASSWORD = 'Case-decision-270!';
const INITIAL_PASSWORD = 'Decision-270!';
const DOSSIER_MATERIALS_VERSION = '2026-10-30';

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
      'clue.patrol_no': `XC-270-${polygonOffset}`,
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
      cookie: await cookieOf('P-270-IN'),
      'idempotency-key': `decision-${polygonOffset}-${Math.random().toString(36).slice(2)}`,
    },
    body: form,
  });
  expect([200, 201]).toContain(response.status);
  return (await response.json()) as { id: string };
}

async function toHandlerAssigned(clueId: string): Promise<void> {
  const org = await fetch(`${baseUrl}/api/clues/${clueId}/assign-org`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf('P-270-IN') },
    body: JSON.stringify({ orgUnitId: stationAId, expectedStatus: 'in_pool', reason: '', designate: false }),
  });
  expect(org.status).toBe(200);
  const people = await fetch(`${baseUrl}/api/clues/${clueId}/assign-people`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf('P-270-ST') },
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
  const drafted = await postJson(`/api/clues/${registered.id}/filing-approval`, 'P-270-H1', {
    content: { conclusion: 'file', partyNames: ['张三'] },
  });
  expect(drafted.status).toBe(200);
  const approvalId = String(drafted.body.approvalId);
  expect((await postJson(`/api/filing-approvals/${approvalId}/submit`, 'P-270-H1')).status).toBe(200);
  expect((await postJson(`/api/filing-approvals/${approvalId}/review`, 'P-270-RV', { opinion: '同意' })).status).toBe(200);
  const approved = await postJson(`/api/filing-approvals/${approvalId}/approve`, 'P-APPROVE-HQ', { opinion: '同意' });
  expect(approved.status).toBe(200);
  return String(approved.body.caseId);
}

async function seedStage(
  caseId: string,
  stage: string,
  transitionCode: string,
  status = 'completed',
): Promise<void> {
  await cloned.prisma.caseStageInstance.create({
    data: {
      id: ulid(),
      caseId,
      stage,
      entrySeq: 1,
      status,
      enteredAt: new Date(T0),
      enteredBy: handlerMainId,
      transitionCode,
    },
  });
}

async function pointCase(caseId: string, stage: string): Promise<void> {
  await cloned.prisma.caseRecord.update({
    where: { id: caseId },
    data: { status: 'in_progress', currentStage: stage, stageEntrySeq: 1, suspended: false },
  });
}

interface FrozenViolation {
  readonly kind: string;
  readonly penaltyCodes?: readonly string[];
  readonly fineAmount?: number | null;
  readonly fineBases?: readonly string[];
}

async function seedFrozen(caseId: string, violations: readonly FrozenViolation[]): Promise<void> {
  const designationId = ulid();
  await cloned.prisma.caseReviewerDesignation.create({
    data: {
      id: designationId,
      caseId,
      entrySeq: 1,
      personnelId: handlerMainId,
      designatedBy: handlerMainId,
      reason: null,
      replacesId: null,
      designatedAt: new Date(T0),
      supersededAt: null,
    },
  });
  const opinionId = ulid();
  const kind = violations.some((row) => row.kind === 'penalty') ? 'penalty' : 'no-penalty';
  await cloned.prisma.caseReviewOpinion.create({
    data: {
      id: opinionId,
      caseId,
      entrySeq: 1,
      opinionKind: kind,
      content: '同意',
      signedBy: handlerMainId,
      designationId,
      destinationCode: 'T14',
      outcomeCode: null,
      outcomeLabel: null,
      createdAt: new Date(T0),
    },
  });
  await cloned.prisma.caseFrozenDecision.create({
    data: {
      id: ulid(),
      caseId,
      opinionId,
      summaryJson: JSON.stringify({
        violations: violations.map((row) => ({
          kind: row.kind,
          penaltyCodes: row.penaltyCodes ?? [],
          fineAmount: row.fineAmount ?? null,
          fineBases: row.fineBases ?? [],
        })),
      }),
      createdAt: new Date(T0),
    },
  });
}

async function decisionCase(violations: readonly FrozenViolation[]): Promise<string> {
  const caseId = await fileCase();
  await seedStage(caseId, 'E09', 'T14', 'drafting');
  await pointCase(caseId, 'E09');
  await seedFrozen(caseId, violations);
  return caseId;
}

async function governanceCase(stage: 'E09' | 'E10' | 'E11', transitionCode: string): Promise<string> {
  const caseId = await fileCase();
  if (stage === 'E10') await seedStage(caseId, 'E09', 'T23');
  if (stage === 'E11') {
    await seedStage(caseId, 'E09', 'T23');
    await seedStage(caseId, 'E10', 'T24');
  }
  await seedStage(caseId, stage, transitionCode);
  await pointCase(caseId, stage);
  return caseId;
}

async function seedApprovedDecision(caseId: string, kind: 'penalty' | 'no-penalty', documentType: string): Promise<void> {
  const approvalId = ulid();
  await cloned.prisma.caseDecisionApproval.create({
    data: {
      id: approvalId,
      caseId,
      status: 'approved',
      currentVersionNo: 1,
      drafterId: handlerMainId,
      approvalChainId: null,
      createdAt: new Date(T0),
      updatedAt: new Date(T0),
    },
  });
  await cloned.prisma.caseDecisionApprovalVersion.create({
    data: {
      id: ulid(),
      approvalId,
      versionNo: 1,
      contentJson: JSON.stringify({
        kind,
        documentType,
        correctionOrdered: false,
        evidenceRefs: [],
        note: null,
        hasFine: false,
        frozenDecisionId: null,
      }),
      createdBy: handlerMainId,
      createdAt: new Date(T0),
    },
  });
}

async function seedServedNotice(caseId: string, dueOn: Date, needsManual = false): Promise<void> {
  const noticeId = ulid();
  await cloned.prisma.caseNotice.create({
    data: {
      id: noticeId,
      caseId,
      entrySeq: 1,
      kind: 'penalty',
      status: 'served',
      adminReview: null,
      currentVersionNo: 1,
      drafterId: handlerMainId,
      approvalChainId: null,
      contentJson: JSON.stringify({
        kind: 'penalty',
        partyType: 'citizen',
        hearingNoticeAttached: false,
        note: '告知',
      }),
      servedBy: handlerMainId,
      servedAt: new Date(T0),
      servedOn: new Date('2026-10-30T00:00:00.000Z'),
      createdAt: new Date(T0),
      updatedAt: new Date(T0),
    },
  });
  await cloned.prisma.caseDeadlineRow.create({
    data: {
      id: ulid(),
      caseId,
      ruleKey: 'notice.statement',
      entrySeq: 1,
      procedureNode: 'E05',
      startingDocument: noticeId,
      consumption: 'continue',
      ruleVersion: '1',
      dayCount: 5,
      dayBasis: 'working',
      partyFacing: true,
      extensionAllowance: null,
      startedOn: new Date('2026-10-30T00:00:00.000Z'),
      dueOn,
      needsManualConfirmation: needsManual,
      confirmationTrace: null,
      rowStatus: 'open',
      revisionNo: 0,
      calendarVersion: 'v1',
      clamped: false,
    },
  });
}

async function seedDelivery(caseId: string): Promise<void> {
  await cloned.prisma.caseDelivery.create({
    data: {
      id: ulid(),
      caseId,
      kind: 'receipt',
      documentKind: 'penalty-decision',
      deliveredOn: '2026-10-30',
      deliverersJson: JSON.stringify(['甲', '乙']),
      reasonRecord: null,
      announcementMaterialsJson: '[]',
      note: null,
      decisionApprovalId: null,
      recordedBy: handlerMainId,
      recordedAt: new Date(T0),
    },
  });
}

async function seedTransferRequirement(caseId: string, kind: 'criminal' | 'party-discipline', status: string): Promise<string> {
  const approvalId = ulid();
  await cloned.prisma.caseTransferApproval.create({
    data: {
      id: approvalId,
      caseId,
      kind,
      status,
      currentVersionNo: 0,
      drafterId: handlerMainId,
      approvalChainId: null,
      createdAt: new Date(T0),
      updatedAt: new Date(T0),
    },
  });
  return approvalId;
}

async function seedTransferRecord(caseId: string, kind: 'criminal' | 'party-discipline', approvalId: string): Promise<void> {
  await cloned.prisma.caseTransfer.create({
    data: {
      id: ulid(),
      caseId,
      kind,
      receivingOrg: '某区纪委监委',
      documentNo: '穗自然资移〔2026〕10 号',
      letterDate: '2026-10-30',
      reason: '须移送',
      approvalId,
      recordedBy: handlerMainId,
      recordedAt: new Date(T0),
    },
  });
}

async function startDecision(caseId: string, evidenceRefs: readonly string[] = []): Promise<string> {
  const drafted = await postJson(`/api/cases/${caseId}/decision`, 'P-270-H1', {
    correctionOrdered: false,
    evidenceRefs,
  });
  expect(drafted.status, JSON.stringify(drafted.body)).toBe(200);
  const approvalId = String(drafted.body.approvalId);
  expect((await postJson(`/api/decision-approvals/${approvalId}/submit`, 'P-270-H1')).status).toBe(200);
  expect((await postJson(`/api/decision-approvals/${approvalId}/review`, 'P-270-RV', { opinion: '同意' })).status).toBe(200);
  return approvalId;
}

async function approveDecision(approvalId: string, extra: Record<string, unknown> = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  return postJson(`/api/decision-approvals/${approvalId}/approve`, 'P-APPROVE-HQ', { opinion: '同意', ...extra });
}

async function startClosure(caseId: string): Promise<string> {
  const drafted = await postJson(`/api/cases/${caseId}/closure`, 'P-270-H1', {});
  expect(drafted.status, JSON.stringify(drafted.body)).toBe(200);
  const approvalId = String(drafted.body.approvalId);
  expect((await postJson(`/api/closure-approvals/${approvalId}/submit`, 'P-270-H1')).status).toBe(200);
  expect((await postJson(`/api/closure-approvals/${approvalId}/review`, 'P-270-RV', { opinion: '同意' })).status).toBe(200);
  return approvalId;
}

async function approveClosure(approvalId: string, extra: Record<string, unknown> = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  return postJson(`/api/closure-approvals/${approvalId}/approve`, 'P-APPROVE-HQ', { opinion: '同意', ...extra });
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
  await seedPerson('P-270-IN', '甲区内勤', deptAId, ['内勤'], '13900027001');
  await seedPerson('P-270-ST', '甲所内勤', stationAId, ['内勤'], '13900027002');
  handlerMainId = await seedPerson('P-270-H1', '主办甲', stationAId, ['经办'], '13900027003');
  handlerAssistId = await seedPerson('P-270-H2', '协办乙', stationAId, ['经办'], '13900027004');
  await seedPerson('P-270-RV', '所内审核', stationAId, ['行政审核'], '13900027005');
}, 180_000);

afterAll(async () => {
  await closeApp();
  await cloned.close();
});

beforeEach(() => {
  cookies.clear();
});

describe('#270 决定 T23', () => {
  it('不予处罚决定批准：T23 生效，文书类型与署名由事实推导', async () => {
    const caseId = await decisionCase([{ kind: 'no-penalty' }]);
    const read = await getJson(`/api/cases/${caseId}/decision`, 'P-270-H1');
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({
      decision: { kind: 'no-penalty', documentType: 'no-penalty-decision' },
      signature: { issuer: '广州市规划和自然资源局' },
    });
    const approvalId = await startDecision(caseId);
    const approved = await approveDecision(approvalId);
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body).toMatchObject({
      result: 'decision-approved',
      transitionId: 'T23',
      kind: 'no-penalty',
      documentType: 'no-penalty-decision',
    });
    const row = await cloned.prisma.caseRecord.findUniqueOrThrow({ where: { id: caseId } });
    expect(row.status).toBe('in_progress');
    expect(row.currentStage).toBe('E09');
    expect(row.stageEntrySeq).toBe(2);
    const instance = await cloned.prisma.caseStageInstance.findFirstOrThrow({
      where: { caseId, stage: 'E09', entrySeq: 2 },
    });
    expect(instance.status).toBe('completed');
    const transition = await cloned.prisma.caseTransition.findFirstOrThrow({ where: { caseId, transitionCode: 'T23' } });
    expect(transition.toJson).toContain('E09');
  });

  it('X05：拟处罚但告知书未送达，批准 409', async () => {
    const caseId = await decisionCase([{ kind: 'penalty' }]);
    const approvalId = await startDecision(caseId);
    const approved = await approveDecision(approvalId);
    expect(approved.status).toBe(409);
    expect(approved.body.reason).toBe('X05');
    const row = await cloned.prisma.caseRecord.findUniqueOrThrow({ where: { id: caseId } });
    expect(row.currentStage).toBe('E09');
    expect(await cloned.prisma.caseTransition.count({ where: { caseId, transitionCode: 'T23' } })).toBe(0);
  });

  it('X06：告知期限未满，批准 409', async () => {
    const caseId = await decisionCase([{ kind: 'penalty' }]);
    await seedServedNotice(caseId, new Date('2026-11-30T00:00:00.000Z'));
    const approvalId = await startDecision(caseId);
    const approved = await approveDecision(approvalId);
    expect(approved.status).toBe(409);
    expect(approved.body.reason).toBe('X06');
  });

  it('X16：引用未入卷证据，批准 409；证据入卷后可批准', async () => {
    const deniedCase = await decisionCase([{ kind: 'no-penalty' }]);
    const deniedApproval = await startDecision(deniedCase, ['NOT-IN-DOSSIER']);
    const denied = await approveDecision(deniedApproval);
    expect(denied.status).toBe(409);
    expect(denied.body.reason).toBe('X16');

    const passCase = await decisionCase([{ kind: 'no-penalty' }]);
    const material = await postJson(`/api/cases/${passCase}/dossier-materials`, 'P-270-H1', { itemCode: 5 });
    expect(material.status, JSON.stringify(material.body)).toBe(200);
    const passApproval = await startDecision(passCase, [String(material.body.id)]);
    const approved = await approveDecision(passApproval);
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body.transitionId).toBe('T23');
  });

  it('Q24：罚款基数缺失只提示，不阻断提交', async () => {
    const caseId = await decisionCase([
      { kind: 'penalty', penaltyCodes: ['fine'], fineAmount: null, fineBases: [] },
    ]);
    await seedServedNotice(caseId, new Date('2026-10-01T00:00:00.000Z'));
    const drafted = await postJson(`/api/cases/${caseId}/decision`, 'P-270-H1', {});
    expect(drafted.status).toBe(200);
    expect(Array.isArray(drafted.body.hints)).toBe(true);
    expect((drafted.body.hints as unknown[]).length).toBe(1);
    const submitted = await postJson(`/api/decision-approvals/${drafted.body.approvalId}/submit`, 'P-270-H1');
    expect(submitted.status).toBe(200);
    expect((submitted.body.hints as unknown[]).length).toBe(1);
  });
});

describe('#270 送达 T24 与结案 T26', () => {
  it('回证送达人不足两人 409；两人送达完成；不予处罚支 E10 直接结案，Q25 清单同源', async () => {
    const caseId = await decisionCase([{ kind: 'no-penalty' }]);
    const approvalId = await startDecision(caseId);
    expect((await approveDecision(approvalId)).status).toBe(200);

    const insufficient = await postJson(`/api/cases/${caseId}/delivery`, 'P-270-H1', {
      kind: 'receipt',
      deliveredOn: '2026-10-30',
      deliverers: ['甲'],
    });
    expect(insufficient.status).toBe(409);
    expect(insufficient.body.reason).toBe('insufficient-deliverers');

    const delivered = await postJson(`/api/cases/${caseId}/delivery`, 'P-270-H1', {
      kind: 'receipt',
      deliveredOn: '2026-10-30',
      deliverers: ['甲', '乙'],
    });
    expect(delivered.status, JSON.stringify(delivered.body)).toBe(200);
    expect(delivered.body).toMatchObject({ result: 'delivery-recorded', currentStage: 'E10' });

    const read = await getJson(`/api/cases/${caseId}/closeout`, 'P-270-H1');
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({
      branch: 'no-penalty',
      checklist: { materialsRuleId: 'cfg.rule.dossier-materials.v1', materialsRuleVersion: DOSSIER_MATERIALS_VERSION },
    });

    const closureApproval = await startClosure(caseId);
    const closed = await approveClosure(closureApproval);
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    expect(closed.body).toMatchObject({ status: 'closed', branch: 'no-penalty' });
    const row = await cloned.prisma.caseRecord.findUniqueOrThrow({ where: { id: caseId } });
    expect(row.status).toBe('closed');
    const closure = await cloned.prisma.caseClosure.findUniqueOrThrow({ where: { caseId } });
    expect(closure.branch).toBe('no-penalty');
    expect(closure.materialsRuleVersion).toBe(DOSSIER_MATERIALS_VERSION);
    expect(await cloned.prisma.caseTransition.count({ where: { caseId, transitionCode: 'T26' } })).toBe(1);
  });

  it('公告送达替代回证：原因经过加公告材料成功', async () => {
    const caseId = await governanceCase('E09', 'T23');
    const delivered = await postJson(`/api/cases/${caseId}/delivery`, 'P-270-H1', {
      kind: 'announcement',
      deliveredOn: '2026-10-30',
      reasonRecord: '当事人下落不明，已公告送达',
      announcementMaterials: ['公告截图.pdf'],
    });
    expect(delivered.status, JSON.stringify(delivered.body)).toBe(200);
    expect(delivered.body).toMatchObject({ kind: 'announcement', currentStage: 'E10' });
    const delivery = await cloned.prisma.caseDelivery.findFirstOrThrow({ where: { caseId } });
    expect(delivery.kind).toBe('announcement');
  });
});

describe('#270 执行记载 T25', () => {
  it('「已申请法院强制执行」无申请书 409；有申请书进入 E11', async () => {
    const caseId = await governanceCase('E10', 'T24');
    await seedDelivery(caseId);
    const denied = await postJson(`/api/cases/${caseId}/execution-records`, 'P-270-H1', {
      kind: 'court-enforcement',
    });
    expect(denied.status).toBe(409);
    expect(denied.body.reason).toBe('missing-attachment');
    const accepted = await postJson(`/api/cases/${caseId}/execution-records`, 'P-270-H1', {
      kind: 'court-enforcement',
      attachments: ['强制执行申请书.pdf'],
    });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    expect(accepted.body).toMatchObject({ result: 'execution-recorded', currentStage: 'E11' });
    const row = await cloned.prisma.caseRecord.findUniqueOrThrow({ where: { id: caseId } });
    expect(row.currentStage).toBe('E11');
  });

  it('「履行完毕」无缴款凭证 409', async () => {
    const caseId = await governanceCase('E10', 'T24');
    await seedDelivery(caseId);
    const denied = await postJson(`/api/cases/${caseId}/execution-records`, 'P-270-H1', { kind: 'fulfilled' });
    expect(denied.status).toBe(409);
    expect(denied.body.reason).toBe('missing-attachment');
  });

  it('X10：决定未送达时执行记载返回警告 200，确认后继续且不改业务行', async () => {
    const caseId = await governanceCase('E10', 'T24');
    const first = await postJson(`/api/cases/${caseId}/execution-records`, 'P-270-H1', {
      kind: 'court-enforcement',
      attachments: ['强制执行申请书.pdf'],
    });
    expect(first.status).toBe(200);
    expect(first.body.result).toBe('warnings');
    expect((first.body.warnings as Array<{ ruleKey: string }>)[0]?.ruleKey).toBe('X10');
    const before = await cloned.prisma.caseRecord.findUniqueOrThrow({ where: { id: caseId } });
    expect(before.currentStage).toBe('E10');
    expect(await cloned.prisma.caseExecutionRecord.count({ where: { caseId } })).toBe(0);

    const confirmed = await postJson(`/api/cases/${caseId}/execution-records`, 'P-270-H1', {
      kind: 'court-enforcement',
      attachments: ['强制执行申请书.pdf'],
      confirmedRuleKeys: ['X10'],
    });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    const after = await cloned.prisma.caseRecord.findUniqueOrThrow({ where: { id: caseId } });
    expect(after.currentStage).toBe('E11');
    expect(await cloned.prisma.caseExecutionRecord.count({ where: { caseId } })).toBe(1);
  });
});

describe('#270 结案 T26 与 X11', () => {
  it('X11：须移送未移送结案 409；已移送记载存在且无回证 → 结案成功', async () => {
    const caseId = await governanceCase('E11', 'T25');
    await seedDelivery(caseId);
    const requirementApprovalId = await seedTransferRequirement(caseId, 'party-discipline', 'pending_review');
    const approvalId = await startClosure(caseId);
    const denied = await approveClosure(approvalId);
    expect(denied.status).toBe(409);
    expect(denied.body.reason).toBe('X11');

    await seedTransferRecord(caseId, 'party-discipline', requirementApprovalId);
    const approved = await approveClosure(approvalId);
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body).toMatchObject({ status: 'closed', branch: 'penalty' });
    const closure = await cloned.prisma.caseClosure.findUniqueOrThrow({ where: { caseId } });
    expect(closure.branch).toBe('penalty');
    expect(await cloned.prisma.caseTransferFile.count({ where: { caseId, kind: 'receipt' } })).toBe(0);
  });

  it('处罚支不能由 E10 直接结案', async () => {
    const caseId = await governanceCase('E10', 'T24');
    await seedApprovedDecision(caseId, 'penalty', 'penalty-decision');
    const drafted = await postJson(`/api/cases/${caseId}/closure`, 'P-270-H1', {});
    expect(drafted.status).toBe(409);
    expect(drafted.body.reason).toBe('invalid-state');
  });

  it('X10：决定未送达时结案警告 200，确认后结案', async () => {
    const caseId = await governanceCase('E11', 'T25');
    const approvalId = await startClosure(caseId);
    const first = await approveClosure(approvalId);
    expect(first.status).toBe(200);
    expect(first.body.result).toBe('warnings');
    expect((first.body.warnings as Array<{ ruleKey: string }>)[0]?.ruleKey).toBe('X10');
    expect(await cloned.prisma.caseClosure.count({ where: { caseId } })).toBe(0);

    const confirmed = await approveClosure(approvalId, { confirmedRuleKeys: ['X10'] });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    const row = await cloned.prisma.caseRecord.findUniqueOrThrow({ where: { id: caseId } });
    expect(row.status).toBe('closed');
    const closure = await cloned.prisma.caseClosure.findUniqueOrThrow({ where: { caseId } });
    expect(closure.branch).toBe('penalty');
  });
});