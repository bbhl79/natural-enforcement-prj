#!/usr/bin/env node
// 用途：Phase 2b 续——E1 按法域扩展 + 呈批会办档抽样；不横铺 E2/E3。
// 调用方：本机生成 e2e/l2/ledger；不进 CI。
// 边界：仅 E1 / 会办 happy；纪要完整指纹；缺口只创建不覆盖。
// 依据：e2e/l2/README.md；L2 计划 Phase 2b / X5 M3·M6；NELC-15。

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const L2 = join(ROOT, 'e2e/l2');
const limits = JSON.parse(readFileSync(join(L2, 'config/limits.json'), 'utf8'));

function writeJson(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(obj, null, 2)}\n`);
}

function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function fingerprintInputs(parts) {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16);
}

function writeIfAbsent(path, obj) {
  if (existsSync(path)) return false;
  writeJson(path, obj);
  return true;
}

function writeMinutesPreserving(path, draft, fingerprint) {
  const existing = readJsonIfExists(path);
  if (!existing) {
    writeJson(path, draft);
    return 'created';
  }
  if (existing.inputFingerprint === fingerprint) return 'skipped-unchanged';
  // 缺指纹或指纹变化：一律 panel-blocked，禁止补签后沿用旧 admit。
  writeJson(path, {
    ...existing,
    inputFingerprint: fingerprint,
    iteration: (existing.iteration || 1) + 1,
    synthesizer: 'panel-blocked',
    openMustFix: Array.from(
      new Set([...(existing.openMustFix || []), 'inputs-changed-require-re-review']),
    ),
    roles: existing.roles,
    g6LineCited: existing.g6LineCited || draft.g6LineCited,
    reverseSection: existing.reverseSection || draft.reverseSection,
    adversarySection: existing.adversarySection || draft.adversarySection,
  });
  return 're-review-required';
}

function upsertMatrixCell(cell) {
  const path = join(L2, 'ledger/matrix', `${cell.id}.json`);
  const existing = readJsonIfExists(path);
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

function sourceClassOf(code) {
  const sc = limits.sourceClassByCode[String(code)];
  if (!sc) throw new Error(`unknown sourceCode ${code}`);
  return sc;
}

function minutesDraft({ id, caseId, seedId, edgeClass, matrixCellId, harnessCapability, fp, reverse, adversary }) {
  return {
    id,
    caseId,
    seedId,
    edgeClass,
    iteration: 1,
    roles: [
      { role: 'Generator', verdict: 'pass', notes: `Phase2b-scale ${edgeClass}；${matrixCellId}；harness=${harnessCapability}。` },
      { role: 'Legality Challenger', verdict: 'pass', notes: '出口/PROC 在白名单；非处罚成功冒充。' },
      { role: 'Coverage Challenger', verdict: 'pass', notes: '补 M3/M6 或 E1 法域点；不宣称 Min；不横铺 E2/E3。' },
      { role: 'Process/Edge Challenger', verdict: 'pass', notes: '相对同种子 happy 仅声明差分。' },
      { role: 'Reverse Validator', verdict: 'pass', notes: '见 reverseSection。' },
      { role: 'Adversary', verdict: 'pass', notes: '见 adversarySection。' },
      { role: 'Synthesizer', verdict: 'pass', notes: '共识 admit。' },
    ],
    openMustFix: [],
    reverseSection: reverse,
    adversarySection: adversary,
    g6LineCited: '§1.5：能力 latent/unwired → 缺口账，非生成拒收',
    synthesizer: 'admit',
    diffOnly: true,
    inputFingerprint: fp,
  };
}

function e1Sample({
  short,
  seedId,
  domain,
  sourceCode,
  party,
  legalExit,
  procId,
  conclusionPath,
  conclusionValue,
  mockProduct,
  matrixApproval = 'approval-only',
}) {
  const sourceClass = sourceClassOf(sourceCode);
  const caseId = `L2-CASE-${short}`;
  const edgeClass = 'E1';
  const isTerminate = legalExit === 'EXIT-TERMINATE-UNFOUNDED';
  const capabilityId = isTerminate ? 'terminate-unfounded' : 'filing-decline';
  return {
    caseId,
    oracleId: `L2-ORACLE-${short}`,
    minutesId: `L2-MIN-${short}`,
    gapId: `L2-GAP-${short}-latent`,
    seedId,
    edgeClass,
    domain,
    sourceCode: String(sourceCode),
    sourceClass,
    approvalTier: matrixApproval,
    matrixCellId: `MC-${domain}-${sourceClass}-${matrixApproval}-E1`,
    capabilityId,
    harnessCapability: 'latent',
    verifyScenarioRef:
      !isTerminate && domain === 'survey' ? 'vf-sc-latent-no-filing-survey' : undefined,
    legalExit,
    legalRefs: [{ kind: 'PROC', id: procId, reason: `E1 合法出口 ${legalExit}` }],
    derived: [
      { path: 'domain', value: domain, seedPath: 'domain' },
      { path: 'sourceCode', value: String(sourceCode), seedPath: 'sourceCode' },
      { path: 'party.displayName', value: party, seedPath: 'party.displayName' },
    ],
    mocked: [
      {
        path: conclusionPath,
        value: conclusionValue,
        mockBasis: {
          product: mockProduct,
          legal: { kind: 'PROC', id: procId },
        },
      },
    ],
    steps: [{ id: 'e1-exit', action: legalExit === 'EXIT-TERMINATE-UNFOUNDED' ? 'terminate-unfounded' : 'filing-decline', expectReachable: false }],
    asserts: [
      {
        id: 'e1-exit',
        kind: 'state',
        path: conclusionPath.replace(/^stages\./, 'body.'),
        op: 'eq',
        expect: conclusionValue,
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
      R1: 'domain/source/party 指回种子。',
      R2: '去掉 Mock 出口结论后断言不得成立。',
      R3: `approvalTier=${matrixApproval}。`,
      R4: 'latent → capability-latent 缺口。',
    },
    adversary: {
      A1: '缺 Mock→拒收。',
      A2: 'EXIT-PENALTY 则 X2 应红。',
      A3: '错法域由 X1 红。',
      A4: 'n/a 非 E3。',
      A5: 'n/a 非 E2。',
      A6: 'X2b 覆盖坏 refs。',
    },
  };
}

const samples = [
  e1Sample({
    short: 'vf-case-13-E1-no-filing',
    seedId: 'vf-case-13-mine-without-license',
    domain: 'mineral',
    sourceCode: '16',
    party: 'vf-某建材有限公司',
    legalExit: 'EXIT-NO-FILING',
    procId: 'PROC-FILING-DECLINE',
    conclusionPath: 'stages.filing.system.conclusion',
    conclusionValue: 'no-case',
    mockProduct: 'E1 发散 Mock；mineral 无 no-filing variant，双引规程',
  }),
  e1Sample({
    short: 'vf-case-09-E1-terminate-unfounded',
    seedId: 'vf-case-09-mine-overstep',
    domain: 'mineral',
    sourceCode: '2203',
    party: 'vf-某石场有限公司',
    legalExit: 'EXIT-TERMINATE-UNFOUNDED',
    procId: 'PROC-TERMINATE-UNFOUNDED',
    conclusionPath: 'stages.investigation.system.conclusion',
    conclusionValue: 'unfounded',
    mockProduct: 'E1 发散 Mock；对照 land terminate-unfounded 模板',
  }),
  e1Sample({
    short: 'vf-case-04-E1-no-filing',
    seedId: 'vf-case-04-build-without-permit',
    domain: 'planning',
    sourceCode: '16',
    party: 'vf-某建设单位',
    legalExit: 'EXIT-NO-FILING',
    procId: 'PROC-FILING-DECLINE',
    conclusionPath: 'stages.filing.system.conclusion',
    conclusionValue: 'no-case',
    mockProduct: 'E1 发散 Mock；planning 单种子补边界点',
  }),
  e1Sample({
    short: 'vf-case-02-E1-terminate-unfounded',
    seedId: 'vf-case-02-occupy-without-approval',
    domain: 'land',
    sourceCode: '16',
    party: 'vf-当事人甲',
    legalExit: 'EXIT-TERMINATE-UNFOUNDED',
    procId: 'PROC-TERMINATE-UNFOUNDED',
    conclusionPath: 'stages.investigation.system.conclusion',
    conclusionValue: 'unfounded',
    mockProduct: 'variant vf-case-02-occupy-without-approval.terminate-unfounded',
  }),
  e1Sample({
    short: 'vf-case-02-E1-no-filing',
    seedId: 'vf-case-02-occupy-without-approval',
    domain: 'land',
    sourceCode: '16',
    party: 'vf-当事人甲',
    legalExit: 'EXIT-NO-FILING',
    procId: 'PROC-FILING-DECLINE',
    conclusionPath: 'stages.filing.system.conclusion',
    conclusionValue: 'no-case',
    mockProduct: 'variant vf-case-02-occupy-without-approval.no-filing',
  }),
  e1Sample({
    short: 'vf-case-05-E1-no-filing',
    seedId: 'vf-case-05-farmland-permanent',
    domain: 'land',
    sourceCode: '16',
    party: 'vf-当事人乙',
    legalExit: 'EXIT-NO-FILING',
    procId: 'PROC-FILING-DECLINE',
    conclusionPath: 'stages.filing.system.conclusion',
    conclusionValue: 'no-case',
    mockProduct: 'E1 薄种子发散 Mock；补 land 覆盖点',
  }),
  e1Sample({
    short: 'vf-case-15-E1-no-filing',
    seedId: 'vf-case-15-survey-template',
    domain: 'survey',
    sourceCode: '305',
    party: 'vf-某测绘相关单位',
    legalExit: 'EXIT-NO-FILING',
    procId: 'PROC-FILING-DECLINE',
    conclusionPath: 'stages.filing.system.conclusion',
    conclusionValue: 'no-case',
    mockProduct: 'E1 薄种子发散 Mock；survey 第二点',
  }),
  // M6：approval+consult 档（独立会办能力 consult-dissent，非跨组织交接）
  {
    caseId: 'L2-CASE-vf-case-02-happy-consult-dissent',
    oracleId: 'L2-ORACLE-vf-case-02-happy-consult-dissent',
    minutesId: 'L2-MIN-vf-case-02-happy-consult-dissent',
    gapId: 'L2-GAP-vf-case-02-consult-dissent-latent',
    seedId: 'vf-case-02-occupy-without-approval',
    edgeClass: 'happy',
    domain: 'land',
    sourceCode: '16',
    sourceClass: '1',
    approvalTier: 'approval+consult',
    matrixCellId: 'MC-land-1-approval+consult-happy',
    capabilityId: 'consult-dissent',
    harnessCapability: 'latent',
    legalExit: 'EXIT-REGISTERED',
    legalRefs: [
      { kind: 'PROC', id: 'PROC-REGISTER', reason: '登记仍为起点' },
      { kind: 'PROC', id: 'PROC-CONSULT', reason: '会办异议后协调' },
    ],
    derived: [
      { path: 'domain', value: 'land', seedPath: 'domain' },
      { path: 'sourceCode', value: '16', seedPath: 'sourceCode' },
      { path: 'party.displayName', value: 'vf-当事人甲', seedPath: 'party.displayName' },
    ],
    mocked: [
      {
        path: 'process.consultations.outcome',
        value: 'dissent-then-pass',
        mockBasis: {
          product: 'variant vf-case-02-occupy-without-approval.consult-dissent-then-pass',
          legal: { kind: 'PROC', id: 'PROC-CONSULT' },
        },
      },
    ],
    steps: [
      { id: 'register', action: 'register-clue', expectReachable: true },
      { id: 'consult', action: 'consult-dissent', expectReachable: false },
    ],
    asserts: [
      {
        id: 'consult-outcome',
        kind: 'state',
        path: 'body.consultations.outcome',
        op: 'eq',
        expect: 'dissent-then-pass',
        provenance: 'mocked',
      },
    ],
    gapKind: 'capability-latent',
    reverse: {
      R1: 'domain/source/party 指回种子 02。',
      R2: '去掉会办 Mock 后不得断言异议通过。',
      R3: 'approvalTier=approval+consult。',
      R4: 'latent → capability-latent 缺口（非 collaborate-handoff）。',
    },
    adversary: {
      A1: '缺 Mock→拒收。',
      A2: 'n/a 非 E1 处罚。',
      A3: 'X1 捕错法域。',
      A4: 'n/a。',
      A5: 'n/a。',
      A6: 'X2b 覆盖。',
    },
  },
];

const stats = { minutes: {} };

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
  const fingerprint = fingerprintInputs({
    caseId: s.caseId,
    seedId: s.seedId,
    edgeClass: s.edgeClass,
    domain: s.domain,
    sourceCode: s.sourceCode,
    sourceClass: s.sourceClass,
    approvalTier: s.approvalTier,
    matrixCellId: s.matrixCellId,
    capabilityId: s.capabilityId,
    harnessCapability: s.harnessCapability,
    verifyScenarioRef: s.verifyScenarioRef || null,
    legalExit: s.legalExit,
    legalRefs: s.legalRefs,
    lineageFields,
    steps: s.steps,
    asserts: s.asserts,
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
    notes: `Phase2b-scale ${s.edgeClass}；capability=${s.capabilityId}/${s.harnessCapability}；不横铺 E2/E3；不宣称 Min。`,
  };
  if (s.verifyScenarioRef) caseObj.verifyScenarioRef = s.verifyScenarioRef;

  const oracleObj = {
    id: s.oracleId,
    caseId: s.caseId,
    legalExit: s.legalExit,
    legalRefs: s.legalRefs,
    asserts: s.asserts,
    halfRunPolicy: 'gap-not-reached',
    notes: `${s.edgeClass}；产品未具备记缺口。`,
  };

  const minutesPath = join(L2, 'ledger/minutes', `${s.minutesId}.json`);
  const minutesOutcome = writeMinutesPreserving(
    minutesPath,
    minutesDraft({
      id: s.minutesId,
      caseId: s.caseId,
      seedId: s.seedId,
      edgeClass: s.edgeClass,
      matrixCellId: s.matrixCellId,
      harnessCapability: s.harnessCapability,
      fp: fingerprint,
      reverse: s.reverse,
      adversary: s.adversary,
    }),
    fingerprint,
  );
  stats.minutes[minutesOutcome] = (stats.minutes[minutesOutcome] || 0) + 1;

  const minutesNow = JSON.parse(readFileSync(minutesPath, 'utf8'));
  if (minutesNow.synthesizer !== 'admit') {
    caseObj.g6Disposition = 'not-reached';
    caseObj.notes = `${caseObj.notes} 纪要待重审（${minutesNow.synthesizer}）。`;
  }

  writeJson(join(L2, 'ledger/cases', `${s.caseId}.json`), caseObj);
  writeJson(join(L2, 'ledger/oracles', `${s.oracleId}.json`), oracleObj);

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

console.log(`phase2b e1-scale: ${samples.length}; minutes=${JSON.stringify(stats.minutes)}`);
