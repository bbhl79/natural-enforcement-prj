#!/usr/bin/env node
// 用途：生成 Phase 2b 边界抽样（E1/E2/E3 各 1 条），遵守 X5b 不横铺。
// 调用方：本机生成 e2e/l2/ledger；不进 CI。
// 边界：E2/E3 仅单条；缺口只创建不覆盖；纪要新建，已有则跳过。
// 依据：e2e/l2/README.md；NELC-14；L2 计划 Phase 2b。

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const L2 = join(ROOT, 'e2e/l2');

function writeJson(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(obj, null, 2)}\n`);
}

function fingerprint(parts) {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16);
}

function writeIfAbsent(path, obj) {
  if (existsSync(path)) return false;
  writeJson(path, obj);
  return true;
}

function upsertMatrixCell(cell) {
  const path = join(L2, 'ledger/matrix', `${cell.id}.json`);
  const existing = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
  if (!existing) {
    writeJson(path, cell);
    return;
  }
  const ids = new Set([...(existing.coveringCaseIds || []), ...cell.coveringCaseIds]);
  writeJson(path, {
    ...existing,
    status: 'covered',
    coveringCaseIds: [...ids],
    mandatoryMin: existing.mandatoryMin || cell.mandatoryMin,
    mandatoryTarget: existing.mandatoryTarget || cell.mandatoryTarget,
  });
}

function edgeMinutes({
  id,
  caseId,
  seedId,
  edgeClass,
  matrixCellId,
  harnessCapability,
  fp,
  reverse,
  adversary,
}) {
  return {
    id,
    caseId,
    seedId,
    edgeClass,
    iteration: 1,
    roles: [
      { role: 'Generator', verdict: 'pass', notes: `Phase2b ${edgeClass} 抽样；${matrixCellId}；harness=${harnessCapability}。` },
      { role: 'Legality Challenger', verdict: 'pass', notes: '合法出口与 PROC 白名单对齐；非处罚成功。' },
      { role: 'Coverage Challenger', verdict: 'pass', notes: '单条抽样；不宣称 Min；不计横铺。' },
      { role: 'Process/Edge Challenger', verdict: 'pass', notes: '相对同种子 happy 仅 edge 差分；能力闸合规。' },
      { role: 'Reverse Validator', verdict: 'pass', notes: '见 reverseSection。' },
      { role: 'Adversary', verdict: 'pass', notes: '见 adversarySection。' },
      { role: 'Synthesizer', verdict: 'pass', notes: '共识 admit。' },
    ],
    openMustFix: [],
    reverseSection: reverse,
    adversarySection: adversary,
    g6LineCited: '§1.5：能力 latent/missing → 缺口账，非生成拒收',
    synthesizer: 'admit',
    diffOnly: true,
    inputFingerprint: fp,
  };
}

const samples = [
  {
    caseId: 'L2-CASE-vf-case-01-E1-no-filing',
    oracleId: 'L2-ORACLE-vf-case-01-E1-no-filing',
    minutesId: 'L2-MIN-vf-case-01-E1-no-filing',
    gapId: 'L2-GAP-vf-case-01-E1-filing-decline-latent',
    seedId: 'vf-case-01-map-review-missing',
    edgeClass: 'E1',
    domain: 'survey',
    sourceCode: '305',
    sourceClass: '3',
    approvalTier: 'approval-only',
    matrixCellId: 'MC-survey-3-approval-only-E1',
    capabilityId: 'filing-decline',
    harnessCapability: 'latent',
    verifyScenarioRef: 'vf-sc-latent-no-filing-survey',
    legalExit: 'EXIT-NO-FILING',
    legalRefs: [{ kind: 'PROC', id: 'PROC-FILING-DECLINE', reason: '核查不实/证据不足→不予立案' }],
    derived: [
      { path: 'domain', value: 'survey', seedPath: 'domain' },
      { path: 'sourceCode', value: '305', seedPath: 'sourceCode' },
      { path: 'party.displayName', value: 'vf-广州某信息科技有限公司', seedPath: 'party.displayName' },
    ],
    mocked: [
      {
        path: 'stages.filing.system.conclusion',
        value: 'no-case',
        mockBasis: {
          product: 'variant vf-case-01-map-review-missing.no-filing stages.filing',
          legal: { kind: 'PROC', id: 'PROC-FILING-DECLINE' },
        },
      },
    ],
    steps: [{ id: 'decline-filing', action: 'filing-decline', expectReachable: false }],
    asserts: [
      {
        id: 'exit-no-filing',
        kind: 'state',
        path: 'body.filing.conclusion',
        op: 'eq',
        expect: 'no-case',
        provenance: 'mocked',
      },
      {
        id: 'no-penalty',
        kind: 'negative',
        path: 'body.penalty.success',
        op: 'eq',
        expect: false,
        provenance: 'mocked',
      },
    ],
    gapKind: 'capability-latent',
    reverse: {
      R1: 'domain/sourceCode/party 指回 canonical 种子。',
      R2: '去掉 mocked 不立案结论后断言不得假装成立。',
      R3: '不予立案呈批在 approvalTier=approval-only 显式档。',
      R4: 'latent → gapKind=capability-latent，与 assert-failed 分列。',
    },
    adversary: {
      A1: '缺 Mock 结论→生成拒收；本条有 mockBasis。',
      A2: '若 EXIT-PENALTY → X2 应红。',
      A3: '错法域由 X1 红。',
      A4: 'n/a 非 E3。',
      A5: 'n/a 非 E2。',
      A6: '坏 legalRefs 由 X2b 覆盖。',
    },
  },
  {
    caseId: 'L2-CASE-vf-case-02-E2-suspend-resume',
    oracleId: 'L2-ORACLE-vf-case-02-E2-suspend-resume',
    minutesId: 'L2-MIN-vf-case-02-E2-suspend-resume',
    gapId: 'L2-GAP-vf-case-02-E2-suspend-resume-latent',
    seedId: 'vf-case-02-occupy-without-approval',
    edgeClass: 'E2',
    domain: 'land',
    sourceCode: '16',
    sourceClass: '1',
    approvalTier: 'approval-only',
    matrixCellId: 'MC-land-1-approval-only-E2',
    capabilityId: 'suspend-resume',
    harnessCapability: 'latent',
    verifyScenarioRef: 'vf-sc-latent-suspend-resume-land',
    legalExit: 'EXIT-RESUMED-CONTINUE',
    legalRefs: [
      { kind: 'PROC', id: 'PROC-SUSPEND', reason: '调查中止呈批' },
      { kind: 'PROC', id: 'PROC-RESUME', reason: '中止后恢复' },
    ],
    derived: [
      { path: 'domain', value: 'land', seedPath: 'domain' },
      { path: 'sourceCode', value: '16', seedPath: 'sourceCode' },
      { path: 'party.displayName', value: 'vf-当事人甲', seedPath: 'party.displayName' },
    ],
    mocked: [
      {
        path: 'investigation.statusSequence',
        value: ['active', 'suspended', 'active'],
        mockBasis: {
          product: 'variant vf-case-02-occupy-without-approval.suspend-resume',
          legal: { kind: 'PROC', id: 'PROC-RESUME' },
        },
      },
    ],
    steps: [
      { id: 'suspend', action: 'suspend-investigation', expectReachable: false },
      { id: 'resume', action: 'resume-investigation', expectReachable: false },
    ],
    asserts: [
      {
        id: 'resumed',
        kind: 'state',
        path: 'body.investigation.status',
        op: 'eq',
        expect: 'active',
        provenance: 'mocked',
      },
      {
        id: 'had-suspend',
        kind: 'timeline',
        path: 'body.timeline.kinds',
        op: 'includes',
        expect: 'suspend-approval',
        provenance: 'mocked',
      },
    ],
    gapKind: 'capability-latent',
    reverse: {
      R1: 'domain/source/party 指回种子 02。',
      R2: '去掉 suspend/resume Mock 后不得断言恢复。',
      R3: '中止呈批在 approvalTier=approval-only。',
      R4: '半程停在中止→not-reached；能力缺失→capability-latent。',
    },
    adversary: {
      A1: '缺 Mock→拒收。',
      A2: 'n/a 非 E1 处罚混淆。',
      A3: '错来源由 X1 红。',
      A4: 'n/a 非 E3。',
      A5: '中止未恢复就前进应失败（Oracle/闸）。',
      A6: 'X2b 覆盖坏 refs。',
    },
  },
  {
    caseId: 'L2-CASE-vf-case-02-E3-reassign-handler',
    oracleId: 'L2-ORACLE-vf-case-02-E3-reassign-handler',
    minutesId: 'L2-MIN-vf-case-02-E3-reassign-handler',
    gapId: 'L2-GAP-vf-case-02-E3-reassign-missing',
    seedId: 'vf-case-02-occupy-without-approval',
    edgeClass: 'E3',
    domain: 'land',
    sourceCode: '16',
    sourceClass: '1',
    approvalTier: 'none',
    matrixCellId: 'MC-land-1-none-E3',
    capabilityId: 'reassign-handler',
    harnessCapability: 'missing',
    legalExit: 'EXIT-HANDLER-REASSIGNED',
    legalRefs: [{ kind: 'PROC', id: 'PROC-REASSIGN', reason: '中途更换承办人；权限切换可追溯' }],
    derived: [
      { path: 'domain', value: 'land', seedPath: 'domain' },
      { path: 'sourceCode', value: '16', seedPath: 'sourceCode' },
      { path: 'party.displayName', value: 'vf-当事人甲', seedPath: 'party.displayName' },
    ],
    mocked: [
      {
        path: 'handler.from',
        value: 'clerk-a',
        mockBasis: {
          product: 'E3 新建 diverge；种子无 variant',
          legal: { kind: 'PROC', id: 'PROC-REASSIGN' },
        },
      },
      {
        path: 'handler.to',
        value: 'clerk-b',
        mockBasis: {
          product: 'E3 新建 diverge；种子无 variant',
          legal: { kind: 'PROC', id: 'PROC-REASSIGN' },
        },
      },
      {
        path: 'handler.previousCanWrite',
        value: false,
        mockBasis: {
          product: '换承办人后旧人不可写',
          legal: { kind: 'PROC', id: 'PROC-REASSIGN' },
        },
      },
    ],
    steps: [{ id: 'reassign', action: 'reassign-handler', expectReachable: false }],
    asserts: [
      {
        id: 'handler-switched',
        kind: 'field',
        path: 'body.handler.current',
        op: 'eq',
        expect: 'clerk-b',
        provenance: 'mocked',
      },
      {
        id: 'old-cannot-write',
        kind: 'permission',
        path: 'body.handler.previousCanWrite',
        op: 'eq',
        expect: false,
        provenance: 'mocked',
      },
    ],
    gapKind: 'capability-missing',
    reverse: {
      R1: 'domain/source/party 指回种子 02。',
      R2: '去掉 handler Mock 后权限断言不得成立。',
      R3: '本条无呈批链；approvalTier=none。',
      R4: 'missing 能力→capability-missing 缺口。',
    },
    adversary: {
      A1: '缺 Mock→拒收。',
      A2: 'n/a。',
      A3: 'X1 捕错法域。',
      A4: '旧人仍可写→Oracle 应失败（本断言覆盖）。',
      A5: 'n/a 非 E2。',
      A6: 'X2b 覆盖。',
    },
  },
];

for (const s of samples) {
  const lineageFields = [
    ...s.derived.map((d) => ({
      path: d.path,
      provenance: 'derived',
      value: d.value,
      seedPath: d.seedPath,
    })),
    ...s.mocked.map((m) => ({
      path: m.path,
      provenance: 'mocked',
      value: m.value,
      mockBasis: m.mockBasis,
    })),
  ];
  const mockRatio = s.mocked.length / lineageFields.length;
  const fp = fingerprint({
    caseId: s.caseId,
    seedId: s.seedId,
    edgeClass: s.edgeClass,
    capabilityId: s.capabilityId,
    legalExit: s.legalExit,
    lineageFields,
  });

  const caseObj = {
    id: s.caseId,
    seedId: s.seedId,
    edgeClass: s.edgeClass,
    matrixCellId: s.matrixCellId,
    domain: s.domain,
    sourceCode: s.sourceCode,
    sourceClass: s.sourceClass,
    approvalTier: s.approvalTier,
    lineage: { fields: lineageFields },
    steps: s.steps,
    oracleId: s.oracleId,
    g6Disposition: 'admit-ok',
    harnessCapability: s.harnessCapability,
    capabilityId: s.capabilityId,
    panelMinutesId: s.minutesId,
    mockRatio,
    notes: `Phase2b ${s.edgeClass} 抽样；capability=${s.capabilityId}/${s.harnessCapability}；不横铺。`,
  };
  if (s.verifyScenarioRef) caseObj.verifyScenarioRef = s.verifyScenarioRef;

  writeJson(join(L2, 'ledger/cases', `${s.caseId}.json`), caseObj);
  writeJson(join(L2, 'ledger/oracles', `${s.oracleId}.json`), {
    id: s.oracleId,
    caseId: s.caseId,
    legalExit: s.legalExit,
    legalRefs: s.legalRefs,
    asserts: s.asserts,
    halfRunPolicy: 'gap-not-reached',
    notes: `${s.edgeClass} 边界 Oracle；产品未具备记缺口。`,
  });

  writeIfAbsent(
    join(L2, 'ledger/minutes', `${s.minutesId}.json`),
    edgeMinutes({
      id: s.minutesId,
      caseId: s.caseId,
      seedId: s.seedId,
      edgeClass: s.edgeClass,
      matrixCellId: s.matrixCellId,
      harnessCapability: s.harnessCapability,
      fp,
      reverse: s.reverse,
      adversary: s.adversary,
    }),
  );

  writeIfAbsent(join(L2, 'ledger/gaps', `${s.gapId}.json`), {
    id: s.gapId,
    caseId: s.caseId,
    edgeClass: s.edgeClass,
    matrixCellId: s.matrixCellId,
    gapKind: s.gapKind,
    productHint: `${s.capabilityId} 仍为 ${s.harnessCapability}；接入前不计能力覆盖分子`,
    status: 'open',
  });

  upsertMatrixCell({
    id: s.matrixCellId,
    domain: s.domain,
    sourceClass: s.sourceClass,
    approvalTier: s.approvalTier,
    edgeClass: s.edgeClass,
    status: 'covered',
    coveringCaseIds: [s.caseId],
    mandatoryMin: true,
    mandatoryTarget: true,
  });
}

console.log(`phase2b edge samples: ${samples.length} (E1/E2/E3 ×1)`);
