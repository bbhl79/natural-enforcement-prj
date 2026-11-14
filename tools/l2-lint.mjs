#!/usr/bin/env node
// 用途：L2 账机器闸（schema 字段、合法词表、X1–X4/X2b/X5b 骨架、Mock 占比、纪要准入）。
// 调用方：dev 脚本的 lint l2 子项；本文件也可 node tools/l2-lint.mjs 直接跑。
// 边界：不跑产品 API；产品红记缺口，不在本闸判定业务具备。
// 依据：e2e/l2/README.md；Project store L2 实现计划 §1–§8。

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const L2 = join(ROOT, 'e2e/l2');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function listJson(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .map((n) => join(dir, n));
}

function readPath(obj, dotted) {
  const parts = dotted.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}

function loadCritDecIds() {
  const crit = new Set();
  const dec = new Set();
  for (const rel of [
    'backend/deadline/src/criteria.generated.ts',
    'backend/case/src/criteria.generated.ts',
  ]) {
    const text = readFileSync(join(ROOT, rel), 'utf8');
    for (const m of text.matchAll(/id:\s*"(CRIT-[^"]+)"/g)) crit.add(m[1]);
    for (const m of text.matchAll(/id:\s*"(DEC-[^"]+)"/g)) dec.add(m[1]);
  }
  const decisions = readFileSync(join(ROOT, 'docs/research/criteria/decisions.md'), 'utf8');
  for (const m of decisions.matchAll(/"id":\s*"(DEC-[^"]+)"/g)) dec.add(m[1]);
  return { crit, dec };
}

function requireKeys(obj, keys, label, errors) {
  for (const k of keys) {
    if (obj[k] === undefined || obj[k] === null) errors.push(`${label}: 缺字段 ${k}`);
  }
}

function validateLegalRef(ref, vocab, critIds, decIds, label, errors) {
  if (!vocab.kinds.includes(ref.kind)) {
    errors.push(`${label}: legal kind 非法 ${ref.kind}`);
    return;
  }
  if (ref.kind === 'CRIT') {
    if (!critIds.has(ref.id)) errors.push(`${label}: CRIT 不存在 ${ref.id}`);
  } else if (ref.kind === 'DEC') {
    if (!decIds.has(ref.id)) errors.push(`${label}: DEC 不存在 ${ref.id}`);
  } else if (ref.kind === 'PROC') {
    if (!vocab.proc.some((p) => p.id === ref.id)) {
      errors.push(`${label}: PROC 不在白名单 ${ref.id}`);
    }
  } else if (ref.kind === 'STATE') {
    if (!vocab.state.some((s) => s.id === ref.id)) {
      errors.push(`${label}: STATE 不在白名单 ${ref.id}`);
    }
  } else if (ref.kind === 'UNSPEC') {
    if (ref.id !== vocab.unspecId) {
      errors.push(`${label}: UNSPEC id 必须为 ${vocab.unspecId}`);
    }
    if (!ref.reason) errors.push(`${label}: UNSPEC 缺 reason`);
  }
}

/** 跑完整账校验；返回 { ok, errors }。 */
export function lintLedger() {
  const errors = [];
  const vocab = readJson(join(L2, 'vocabulary/legal-exits.json'));
  const limits = readJson(join(L2, 'config/limits.json'));
  const capability = readJson(join(L2, 'capability/harvest-capability.json'));
  const { crit: critIds, dec: decIds } = loadCritDecIds();

  const cases = listJson(join(L2, 'ledger/cases')).map(readJson);
  const oracles = new Map(listJson(join(L2, 'ledger/oracles')).map((p) => {
    const o = readJson(p);
    return [o.id, o];
  }));
  const minutes = new Map(listJson(join(L2, 'ledger/minutes')).map((p) => {
    const m = readJson(p);
    return [m.id, m];
  }));
  const cells = new Map(listJson(join(L2, 'ledger/matrix')).map((p) => {
    const c = readJson(p);
    return [c.id, c];
  }));
  const gaps = listJson(join(L2, 'ledger/gaps')).map(readJson);

  for (const cell of cells.values()) {
    requireKeys(
      cell,
      [
        'id',
        'domain',
        'sourceClass',
        'approvalTier',
        'edgeClass',
        'status',
        'mandatoryMin',
        'mandatoryTarget',
      ],
      cell.id,
      errors,
    );
    if (cell.status === 'deferred' && !limits.allowedDeferredReasons.includes(cell.deferredReason)) {
      errors.push(`${cell.id}: deferredReason 非法`);
    }
    if (cell.status === 'covered' && (!cell.coveringCaseIds || cell.coveringCaseIds.length === 0)) {
      errors.push(`${cell.id}: covered 但 coveringCaseIds 空`);
    }
  }

  for (const gap of gaps) {
    requireKeys(
      gap,
      ['id', 'caseId', 'edgeClass', 'matrixCellId', 'gapKind', 'status'],
      gap.id,
      errors,
    );
  }

  let mockSum = 0;
  for (const c of cases) {
    requireKeys(
      c,
      [
        'id',
        'seedId',
        'edgeClass',
        'matrixCellId',
        'domain',
        'sourceCode',
        'sourceClass',
        'approvalTier',
        'lineage',
        'steps',
        'oracleId',
        'g6Disposition',
        'harnessCapability',
        'mockRatio',
      ],
      c.id,
      errors,
    );

    const expectedClass = limits.sourceClassByCode[c.sourceCode];
    if (expectedClass && expectedClass !== c.sourceClass) {
      errors.push(`${c.id}: sourceClass ${c.sourceClass} 与 sourceCode ${c.sourceCode} 不符`);
    }

    const seedPath = join(
      ROOT,
      'e2e/verify/fixtures/case-profiles',
      `${c.seedId}.json`,
    );
    if (!existsSync(seedPath)) {
      errors.push(`${c.id}: 种子不存在 ${c.seedId}`);
      continue;
    }
    const seed = readJson(seedPath);

    // X1
    if (seed.domain !== c.domain) {
      errors.push(`${c.id}: X1 domain 与种子不一致`);
    }
    if (String(seed.sourceCode) !== String(c.sourceCode)) {
      errors.push(`${c.id}: X1 sourceCode 与种子不一致`);
    }
    const cell = cells.get(c.matrixCellId);
    if (!cell) {
      errors.push(`${c.id}: 矩阵格缺失 ${c.matrixCellId}`);
    } else {
      if (cell.domain !== c.domain || cell.sourceClass !== c.sourceClass || cell.edgeClass !== c.edgeClass) {
        errors.push(`${c.id}: X1 矩阵格坐标与用例不一致`);
      }
      if (cell.status === 'covered' && !(cell.coveringCaseIds || []).includes(c.id)) {
        errors.push(`${c.id}: 未列入矩阵格 coveringCaseIds`);
      }
    }

    // lineage + X3 + mock
    const fields = c.lineage?.fields || [];
    if (fields.length === 0) errors.push(`${c.id}: lineage.fields 空`);
    let mocked = 0;
    for (const f of fields) {
      if (f.provenance === 'mocked') {
        mocked += 1;
        if (!f.mockBasis?.product || !f.mockBasis?.legal) {
          errors.push(`${c.id}: mocked 缺 mockBasis ${f.path}`);
        } else {
          validateLegalRef(f.mockBasis.legal, vocab, critIds, decIds, `${c.id}/${f.path}`, errors);
        }
      } else if (f.provenance === 'derived') {
        if (!f.seedPath) {
          errors.push(`${c.id}: derived 缺 seedPath ${f.path}`);
        } else {
          const actual = readPath(seed, f.seedPath);
          if (JSON.stringify(actual) !== JSON.stringify(f.value)) {
            errors.push(
              `${c.id}: X3 derived 不符 ${f.seedPath} expect=${JSON.stringify(f.value)} got=${JSON.stringify(actual)}`,
            );
          }
        }
      } else {
        errors.push(`${c.id}: provenance 非法 ${f.path}`);
      }
    }
    const ratio = fields.length ? mocked / fields.length : 0;
    if (Math.abs(ratio - c.mockRatio) > 1e-9) {
      errors.push(`${c.id}: mockRatio 声明 ${c.mockRatio} 与计算 ${ratio} 不符`);
    }
    const maxRatio = c.edgeClass === 'happy' ? limits.mockRatioMaxHappy : limits.mockRatioMaxEdge;
    if (ratio > maxRatio) errors.push(`${c.id}: mockRatio ${ratio} 超过上限 ${maxRatio}`);
    mockSum += ratio;

    // oracle
    const oracle = oracles.get(c.oracleId);
    if (!oracle) {
      errors.push(`${c.id}: Oracle 缺失 ${c.oracleId}`);
    } else {
      requireKeys(
        oracle,
        ['id', 'caseId', 'legalExit', 'legalRefs', 'asserts', 'halfRunPolicy'],
        oracle.id,
        errors,
      );
      if (oracle.caseId !== c.id) errors.push(`${oracle.id}: caseId 不匹配`);
      const state = vocab.state.find((s) => s.id === oracle.legalExit);
      if (!state) {
        errors.push(`${oracle.id}: legalExit 不在 STATE 白名单`);
      } else if (!state.allowedEdgeClasses.includes(c.edgeClass)) {
        errors.push(`${oracle.id}: legalExit ${oracle.legalExit} 不允许 edgeClass ${c.edgeClass}`);
      }
      if (c.edgeClass === 'E1' && vocab.forbiddenE1Exits.includes(oracle.legalExit)) {
        errors.push(`${oracle.id}: E1 禁止出口 ${oracle.legalExit}`);
      }
      for (const ref of oracle.legalRefs || []) {
        validateLegalRef(ref, vocab, critIds, decIds, oracle.id, errors);
      }
      if (!Array.isArray(oracle.asserts) || oracle.asserts.length === 0) {
        errors.push(`${oracle.id}: asserts 空`);
      } else {
        for (const a of oracle.asserts) {
          if (!a.id || !a.kind || a.expect === undefined || !a.provenance) {
            errors.push(`${oracle.id}: assert 缺字段`);
          }
        }
      }
    }

    // panel
    if (c.panelMinutesId) {
      const min = minutes.get(c.panelMinutesId);
      if (!min) {
        errors.push(`${c.id}: 纪要缺失 ${c.panelMinutesId}`);
      } else {
        if (min.caseId !== c.id) errors.push(`${min.id}: caseId 不匹配`);
        if (min.synthesizer !== 'admit') {
          errors.push(`${min.id}: 已挂 panelMinutesId 但 synthesizer≠admit`);
        }
        if (!Array.isArray(min.openMustFix) || min.openMustFix.length > 0) {
          errors.push(`${min.id}: openMustFix 未清空`);
        }
        if (!min.g6LineCited) errors.push(`${min.id}: 缺 g6LineCited`);
        const roles = new Set((min.roles || []).map((r) => r.role));
        if (!roles.has('Synthesizer') || !roles.has('Generator')) {
          errors.push(`${min.id}: 须含 Generator 与 Synthesizer`);
        }
        if (c.edgeClass !== 'happy') {
          for (const key of ['R1', 'R2', 'R3', 'R4']) {
            if (!min.reverseSection?.[key]) errors.push(`${min.id}: E* 缺 reverse ${key}`);
          }
          for (const key of ['A1', 'A2', 'A3', 'A4', 'A5', 'A6']) {
            if (!min.adversarySection?.[key]) errors.push(`${min.id}: E* 缺 adversary ${key}`);
          }
        }
      }
    } else if (c.g6Disposition === 'admit-ok') {
      errors.push(`${c.id}: admit-ok 缺 panelMinutesId`);
    }

    // X5b harness
    const cap = capability.capabilities.find((x) => {
      if (c.verifyScenarioRef && (x.scenarioRefs || []).includes(c.verifyScenarioRef)) return true;
      if (c.edgeClass === 'E2') return x.capabilityId === 'suspend-resume';
      if (c.edgeClass === 'E3') return x.capabilityId === 'reassign-handler';
      if (c.edgeClass === 'E1') return x.capabilityId === 'filing-decline';
      return x.capabilityId === 'register-clue' && c.edgeClass === 'happy';
    });
    if (cap && cap.verdict !== c.harnessCapability) {
      // allow partial mismatch only if case declares stricter
      const order = ['wired', 'partial', 'unwired', 'latent', 'missing'];
      if (order.indexOf(c.harnessCapability) < order.indexOf(cap.verdict)) {
        errors.push(
          `${c.id}: X5b harnessCapability=${c.harnessCapability} 优于盘点 ${cap.capabilityId}=${cap.verdict}`,
        );
      }
    }
  }

  if (cases.length > 0) {
    const mean = mockSum / cases.length;
    if (mean > limits.ledgerMeanMockRatioMaxAtMin && cases.length >= 40) {
      errors.push(`账级 mockRatio 均值 ${mean} 超过 Min 上限`);
    }
  }

  // X2b negatives must fail probes
  const negErrors = runNegativeProbes(vocab, critIds, decIds);
  if (negErrors.length === 0) {
    errors.push('X2b: 负例探针无一失败，闸可能死绿');
  }

  return { ok: errors.length === 0, errors, negativeProbeKills: negErrors.length };
}

function runNegativeProbes(vocab, critIds, decIds) {
  const kills = [];
  const negs = listJson(join(L2, 'fixtures/negatives')).map(readJson);
  for (const neg of negs) {
    const probeErrors = [];
    if (neg.oracleFragment?.legalRefs) {
      for (const ref of neg.oracleFragment.legalRefs) {
        validateLegalRef(ref, vocab, critIds, decIds, neg.id, probeErrors);
      }
    }
    if (neg.legalRefs) {
      for (const ref of neg.legalRefs) {
        validateLegalRef(ref, vocab, critIds, decIds, neg.id, probeErrors);
      }
    }
    if (neg.lineageField) {
      const f = neg.lineageField;
      if (f.provenance === 'mocked' && (!f.mockBasis?.legal || f.mockBasis.legal === null)) {
        probeErrors.push(`${neg.id}: mockBasis.legal 缺失`);
      }
    }
    if (neg.edgeClass === 'E1' && vocab.forbiddenE1Exits.includes(neg.legalExit)) {
      probeErrors.push(`${neg.id}: E1 禁止出口`);
    }
    if (probeErrors.length > 0) kills.push(...probeErrors);
  }
  return kills;
}

function main() {
  const { ok, errors, negativeProbeKills } = lintLedger();
  if (!ok) {
    for (const e of errors) console.error(`[FAIL] ${e}`);
    process.exit(1);
  }
  console.log(
    `lint l2：账校验通过（负例探针杀伤 ${negativeProbeKills}）。`,
  );
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
