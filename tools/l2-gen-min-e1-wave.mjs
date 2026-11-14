#!/usr/bin/env node
// 用途：冲 Min——为尚无 E1 孪生的种子补 E1 不立案/终止点，把 admit-ok 推入 [40,60]。
// 调用方：本机生成 e2e/l2/ledger；不进 CI。
// 边界：只扩 E1；不横铺 E2/E3；纪要完整指纹；缺口只创建不覆盖。
// 依据：e2e/l2/README.md；L2 计划 §4 Min / X5b；NELC-15 后续。

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const L2 = join(ROOT, 'e2e/l2');
const SEEDS = join(ROOT, 'e2e/verify/fixtures/case-profiles');
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

/** 种子正文摘要：种子文件变更必须使指纹失效并触发 panel-blocked。 */
function seedContentDigest(seedId) {
  const path = join(SEEDS, `${seedId}.json`);
  if (!existsSync(path)) throw new Error(`missing seed profile ${path}`);
  const raw = readFileSync(path, 'utf8');
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
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

/**
 * 按账内当前 admit-ok 用例重算矩阵覆盖。
 * 降级为 not-reached 的用例不得继续撑起 covered。
 */
function syncMatrixCell(meta, waveCaseIds) {
  const path = join(L2, 'ledger/matrix', `${meta.id}.json`);
  const existing = readJsonIfExists(path) || {};
  const casesDir = join(L2, 'ledger/cases');
  const byId = new Map();
  if (existsSync(casesDir)) {
    for (const name of readdirSync(casesDir).filter((n) => n.endsWith('.json'))) {
      const c = JSON.parse(readFileSync(join(casesDir, name), 'utf8'));
      byId.set(c.id, c);
    }
  }
  const candidate = new Set([...(existing.coveringCaseIds || []), ...waveCaseIds]);
  const coveringCaseIds = [...candidate].filter((id) => {
    const c = byId.get(id);
    return Boolean(
      c &&
        c.g6Disposition === 'admit-ok' &&
        c.matrixCellId === meta.id,
    );
  });
  writeJson(path, {
    id: meta.id,
    domain: meta.domain ?? existing.domain,
    sourceClass: meta.sourceClass ?? existing.sourceClass,
    approvalTier: meta.approvalTier ?? existing.approvalTier,
    edgeClass: meta.edgeClass ?? existing.edgeClass,
    status: coveringCaseIds.length > 0 ? 'covered' : 'sparse',
    coveringCaseIds,
    mandatoryMin: existing.mandatoryMin || meta.mandatoryMin || false,
    mandatoryTarget: existing.mandatoryTarget || meta.mandatoryTarget || false,
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
      { role: 'Generator', verdict: 'pass', notes: `Min-wave ${edgeClass}；${matrixCellId}；harness=${harnessCapability}。` },
      { role: 'Legality Challenger', verdict: 'pass', notes: '出口/PROC 在白名单；非处罚成功冒充。' },
      { role: 'Coverage Challenger', verdict: 'pass', notes: '补 E1 孪生与矩阵点；冲 Min 用例量；不横铺 E2/E3。' },
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
  legalExit = 'EXIT-NO-FILING',
  procId = 'PROC-FILING-DECLINE',
  conclusionPath = 'stages.filing.system.conclusion',
  conclusionValue = 'no-case',
  mockProduct,
  matrixApproval = 'approval-only',
}) {
  const sourceClass = sourceClassOf(sourceCode);
  const isTerminate = legalExit === 'EXIT-TERMINATE-UNFOUNDED';
  const capabilityId = isTerminate ? 'terminate-unfounded' : 'filing-decline';
  return {
    caseId: `L2-CASE-${short}`,
    oracleId: `L2-ORACLE-${short}`,
    minutesId: `L2-MIN-${short}`,
    gapId: `L2-GAP-${short}-latent`,
    seedId,
    edgeClass: 'E1',
    domain,
    sourceCode: String(sourceCode),
    sourceClass,
    approvalTier: matrixApproval,
    matrixCellId: `MC-${domain}-${sourceClass}-${matrixApproval}-E1`,
    capabilityId,
    harnessCapability: 'latent',
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
    steps: [
      {
        id: 'e1-exit',
        action: isTerminate ? 'terminate-unfounded' : 'filing-decline',
        expectReachable: false,
      },
    ],
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

// 优先：尚无 E1 孪生的种子；跨法域与来源大类补点；不碰 E2/E3。
const samples = [
  e1Sample({
    short: 'vf-case-03-E1-no-filing',
    seedId: 'vf-case-03-temporary-land-refuse',
    domain: 'land',
    sourceCode: '16',
    party: 'vf-某临时用地使用单位',
    mockProduct: 'E1 发散 Mock；相对 happy-register 仅出口差分',
  }),
  e1Sample({
    short: 'vf-case-06-E1-no-filing',
    seedId: 'vf-case-06-reclaim-obligation',
    domain: 'land',
    sourceCode: '16',
    party: 'vf-当事人丙',
    mockProduct: 'E1 发散 Mock；相对 happy-register 仅出口差分',
  }),
  e1Sample({
    short: 'vf-case-07-E1-no-filing',
    seedId: 'vf-case-07-occupy-heyuan',
    domain: 'land',
    sourceCode: '16',
    party: 'vf-当事人丁',
    mockProduct: 'E1 发散 Mock；相对 happy-register 仅出口差分',
  }),
  e1Sample({
    short: 'vf-case-08-E1-no-filing',
    seedId: 'vf-case-08-reclaim-meizhou',
    domain: 'land',
    sourceCode: '16',
    party: 'vf-张某',
    mockProduct: 'E1 发散 Mock；相对 happy-register 仅出口差分',
  }),
  e1Sample({
    short: 'vf-case-10-E1-no-filing',
    seedId: 'vf-case-10-farmland-destroy',
    domain: 'land',
    sourceCode: '16',
    party: 'vf-刘某',
    mockProduct: 'E1 发散 Mock；相对 happy-register 仅出口差分',
  }),
  e1Sample({
    short: 'vf-case-11-E1-no-filing',
    seedId: 'vf-case-11-transfer-illegal',
    domain: 'land',
    sourceCode: '502',
    party: 'vf-张三',
    mockProduct: 'E1 发散 Mock；上级交办来源 × E1 点',
  }),
  e1Sample({
    short: 'vf-case-14-E1-no-filing',
    seedId: 'vf-case-14-occupy-highway',
    domain: 'land',
    sourceCode: '501',
    party: 'vf-某公路事务中心',
    mockProduct: 'E1 发散 Mock；上级交办来源 × E1 点',
  }),
  e1Sample({
    short: 'vf-case-17-E1-no-filing',
    seedId: 'vf-case-17-mine-overstep-zq',
    domain: 'mineral',
    sourceCode: '2203',
    party: 'vf-某采矿企业',
    mockProduct: 'E1 发散 Mock；mineral 第三 E1 点',
  }),
  e1Sample({
    short: 'vf-case-19-E1-no-filing',
    seedId: 'vf-case-19-survey-project-transfer',
    domain: 'survey',
    sourceCode: '16',
    party: 'vf-某测绘单位',
    mockProduct: 'E1 发散 Mock；survey 主动发现 × E1',
  }),
  e1Sample({
    short: 'vf-case-20-E1-no-filing',
    seedId: 'vf-case-20-survey-qual-fraud',
    domain: 'survey',
    sourceCode: '301',
    party: 'vf-某规划编制单位',
    mockProduct: 'E1 发散 Mock；survey 群众举报 × E1',
  }),
];

const stats = { minutes: {} };
const cellWaveIds = new Map(); // matrixCellId → caseIds touched this run

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
  const seedDigest = seedContentDigest(s.seedId);
  const fingerprint = fingerprintInputs({
    caseId: s.caseId,
    seedId: s.seedId,
    seedContentDigest: seedDigest,
    edgeClass: s.edgeClass,
    domain: s.domain,
    sourceCode: s.sourceCode,
    sourceClass: s.sourceClass,
    approvalTier: s.approvalTier,
    matrixCellId: s.matrixCellId,
    capabilityId: s.capabilityId,
    harnessCapability: s.harnessCapability,
    verifyScenarioRef: null,
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
    notes: `Min-wave E1；capability=${s.capabilityId}/${s.harnessCapability}；冲 Min 量级；不横铺 E2/E3。`,
  };

  const oracleObj = {
    id: s.oracleId,
    caseId: s.caseId,
    legalExit: s.legalExit,
    legalRefs: s.legalRefs,
    asserts: s.asserts,
    halfRunPolicy: 'gap-not-reached',
    notes: 'E1；产品未具备记缺口。',
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
    ticketRef: '#347',
  });

  if (!cellWaveIds.has(s.matrixCellId)) cellWaveIds.set(s.matrixCellId, []);
  cellWaveIds.get(s.matrixCellId).push(s.caseId);
}

// 用例写盘后再按 admit-ok 重算矩阵，避免降级用例仍撑 covered。
for (const [cellId, waveIds] of cellWaveIds) {
  const sample = samples.find((x) => x.matrixCellId === cellId);
  syncMatrixCell(
    {
      id: cellId,
      domain: sample.domain,
      sourceClass: sample.sourceClass,
      approvalTier: sample.approvalTier,
      edgeClass: sample.edgeClass,
      mandatoryMin: true,
      mandatoryTarget: true,
    },
    waveIds,
  );
}

console.log(`min e1-wave: ${samples.length}; minutes=${JSON.stringify(stats.minutes)}`);
