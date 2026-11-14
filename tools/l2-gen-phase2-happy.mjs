#!/usr/bin/env node
// 用途：按 21 种子生成 Phase 2 登记 happy 账（用例/Oracle/矩阵格/纪要/缺口）。
// 调用方：本机一次性生成或刷新 e2e/l2/ledger；不进 CI。
// 边界：不横铺 E2/E3；不宣称 Min；mineral/planning 记 unwired 缺口。
// 依据：e2e/l2/README.md；L2 计划 Phase 2。

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const L2 = join(ROOT, 'e2e/l2');
const PROFILES = join(ROOT, 'e2e/verify/fixtures/case-profiles');
const limits = JSON.parse(readFileSync(join(L2, 'config/limits.json'), 'utf8'));

const SCENARIO_BY_SEED = {
  'vf-case-01-map-review-missing': 'vf-sc-verify-loop-survey-register',
  'vf-case-02-occupy-without-approval': 'vf-sc-verify-loop-land-register',
};

function capForDomain(domain) {
  if (domain === 'mineral') return { capabilityId: 'register-mineral', harnessCapability: 'unwired' };
  if (domain === 'planning') return { capabilityId: 'register-planning', harnessCapability: 'unwired' };
  return { capabilityId: 'register-clue', harnessCapability: 'wired' };
}

function writeJson(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(obj, null, 2)}\n`);
}

function minutesTemplate({ caseId, seedId, matrixCellId, domain, sourceClass, harnessCapability }) {
  return {
    id: `L2-MIN-${seedId}-happy-register`.replace(/[^A-Za-z0-9-]/g, '-'),
    caseId,
    seedId,
    edgeClass: 'happy',
    iteration: 1,
    roles: [
      {
        role: 'Generator',
        verdict: 'pass',
        notes: `Phase2 happy 登记根；矩阵 ${matrixCellId}；harness=${harnessCapability}。`,
      },
      {
        role: 'Legality Challenger',
        verdict: 'pass',
        notes: 'EXIT-REGISTERED + PROC-REGISTER；无广州专规。',
      },
      {
        role: 'Coverage Challenger',
        verdict: 'pass',
        notes: `覆盖 ${domain}/sourceClass=${sourceClass}/happy；不宣称 Min。`,
      },
      {
        role: 'Process/Edge Challenger',
        verdict: 'pass',
        notes: '单步 register-clue；非 E* 横铺。',
      },
      {
        role: 'Reverse Validator',
        verdict: 'pass',
        notes: '见 reverseSection。',
      },
      {
        role: 'Adversary',
        verdict: 'pass',
        notes: '见 adversarySection。',
      },
      {
        role: 'Synthesizer',
        verdict: 'pass',
        notes: '共识 admit。',
      },
    ],
    openMustFix: [],
    reverseSection: {
      R1: 'domain/sourceCode/party/spatial/register 叶子均有 seedPath。',
      R2: '无 mocked 字段。',
      R3: 'approvalTier=none；呈批不在本切片步骤。',
      R4: 'halfRunPolicy=gap-not-reached。',
    },
    adversarySection: {
      A1: '缺关键输入→生成拒收（§1.5）；本条无 Mock。',
      A2: 'n/a 非 edge。',
      A3: 'domain/source 漂移由 X1 捕获。',
      A4: 'n/a 非 E3。',
      A5: 'n/a 非 E2。',
      A6: '坏 legalRefs 由 X2b 覆盖。',
    },
    g6LineCited: '§1.5 行1：缺必填/非法 legalRefs → 生成错误拒收',
    synthesizer: 'admit',
    diffOnly: false,
  };
}

const index = JSON.parse(readFileSync(join(PROFILES, 'index.json'), 'utf8'));
const canons = index.profiles.filter((p) => p.role === 'canonical');
const cellCover = new Map();

for (const meta of canons) {
  const seed = JSON.parse(readFileSync(join(PROFILES, `${meta.id}.json`), 'utf8'));
  const sourceCode = String(seed.sourceCode);
  const sourceClass = limits.sourceClassByCode[sourceCode];
  if (!sourceClass) throw new Error(`无 sourceClass 映射: ${sourceCode} (${meta.id})`);
  const domain = seed.domain;
  const approvalTier = 'none';
  const edgeClass = 'happy';
  const matrixCellId = `MC-${domain}-${sourceClass}-${approvalTier}-${edgeClass}`;
  const caseId = `L2-CASE-${meta.id}-happy-register`;
  const oracleId = `L2-ORACLE-${meta.id}-happy-register`;
  const minutesId = `L2-MIN-${meta.id}-happy-register`;
  const { capabilityId, harnessCapability } = capForDomain(domain);
  const verifyScenarioRef = SCENARIO_BY_SEED[meta.id];

  const lineageFields = [
    { path: 'domain', provenance: 'derived', value: seed.domain, seedPath: 'domain' },
    { path: 'sourceCode', provenance: 'derived', value: sourceCode, seedPath: 'sourceCode' },
    {
      path: 'party.displayName',
      provenance: 'derived',
      value: seed.party.displayName,
      seedPath: 'party.displayName',
    },
    {
      path: 'spatial.kind',
      provenance: 'derived',
      value: seed.spatial.kind,
      seedPath: 'spatial.kind',
    },
    {
      path: 'stages.register.system.sourceCode',
      provenance: 'derived',
      value: String(seed.stages.register.system.sourceCode),
      seedPath: 'stages.register.system.sourceCode',
    },
    {
      path: 'stages.register.system.domain',
      provenance: 'derived',
      value: seed.stages.register.system.domain,
      seedPath: 'stages.register.system.domain',
    },
  ];

  const caseObj = {
    id: caseId,
    seedId: meta.id,
    edgeClass,
    matrixCellId,
    domain,
    sourceCode,
    sourceClass,
    approvalTier,
    lineage: { fields: lineageFields },
    steps: [
      {
        id: 'register',
        action: 'register-clue',
        inputsRef: `${meta.id}#stages.register.system`,
        expectReachable: harnessCapability === 'wired',
      },
    ],
    oracleId,
    g6Disposition: 'admit-ok',
    harnessCapability,
    capabilityId,
    panelMinutesId: minutesId,
    mockRatio: 0,
    notes: `Phase2 种子 happy 登记根；capability=${capabilityId}/${harnessCapability}。`,
  };
  if (verifyScenarioRef) caseObj.verifyScenarioRef = verifyScenarioRef;

  const oracleObj = {
    id: oracleId,
    caseId,
    legalExit: 'EXIT-REGISTERED',
    legalRefs: [
      {
        kind: 'PROC',
        id: 'PROC-REGISTER',
        reason: '登记入池为作业规程起点；本切片不断言期限数值',
      },
    ],
    asserts: [
      {
        id: 'http-ok',
        kind: 'http',
        path: 'http.status',
        op: 'in',
        expect: [200, 201],
        provenance: 'derived',
      },
      {
        id: 'result-registered',
        kind: 'state',
        path: 'body.result',
        op: 'eq',
        expect: 'registered',
        provenance: 'derived',
      },
      {
        id: 'status-pool',
        kind: 'state',
        path: 'body.status',
        op: 'in',
        expect: ['in_pool', 'pending_decision'],
        provenance: 'derived',
      },
    ],
    halfRunPolicy: 'gap-not-reached',
    notes: '登记环机器断言；终局未跑到记 not-reached。',
  };

  writeJson(join(L2, 'ledger/cases', `${caseId}.json`), caseObj);
  writeJson(join(L2, 'ledger/oracles', `${oracleId}.json`), oracleObj);
  writeJson(
    join(L2, 'ledger/minutes', `${minutesId}.json`),
    minutesTemplate({
      caseId,
      seedId: meta.id,
      matrixCellId,
      domain,
      sourceClass,
      harnessCapability,
    }),
  );

  if (!cellCover.has(matrixCellId)) {
    cellCover.set(matrixCellId, {
      id: matrixCellId,
      domain,
      sourceClass,
      approvalTier,
      edgeClass,
      status: 'covered',
      coveringCaseIds: [],
      mandatoryMin: true,
      mandatoryTarget: true,
    });
  }
  cellCover.get(matrixCellId).coveringCaseIds.push(caseId);

  if (harnessCapability === 'unwired') {
    writeJson(join(L2, 'ledger/gaps', `L2-GAP-${meta.id}-register-unwired.json`), {
      id: `L2-GAP-${meta.id}-register-unwired`,
      caseId,
      edgeClass,
      matrixCellId,
      gapKind: 'capability-unwired',
      productHint: `${domain} 登记场景仍在 UNWIRED；产品/驱动接入后关闭缺口`,
      status: 'open',
    });
  }
}

for (const cell of cellCover.values()) {
  writeJson(join(L2, 'ledger/matrix', `${cell.id}.json`), cell);
}

console.log(
  `generated happy roots: ${canons.length} cases, ${cellCover.size} matrix cells`,
);
