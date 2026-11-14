#!/usr/bin/env node
// 用途：L2 账机器闸（JSON Schema、合法词表、X1–X4/X2b/X5b、Mock 占比、纪要准入）。
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

/** 本仓库 L2 schema 子集校验（draft-2020-12 常用关键字；无外部依赖）。 */
export function validateAgainstSchema(instance, schema, root = schema, path = '$') {
  const errors = [];
  if (schema.$ref) {
    const ref = schema.$ref;
    if (!ref.startsWith('#/$defs/')) {
      errors.push(`${path}: 不支持的 $ref ${ref}`);
      return errors;
    }
    const name = ref.slice('#/$defs/'.length);
    const def = root.$defs?.[name];
    if (!def) {
      errors.push(`${path}: $defs 缺失 ${name}`);
      return errors;
    }
    return validateAgainstSchema(instance, def, root, path);
  }

  if (schema.type) {
    const t = schema.type;
    const ok =
      (t === 'object' && instance !== null && typeof instance === 'object' && !Array.isArray(instance)) ||
      (t === 'array' && Array.isArray(instance)) ||
      (t === 'string' && typeof instance === 'string') ||
      (t === 'number' && typeof instance === 'number' && !Number.isNaN(instance)) ||
      (t === 'integer' && Number.isInteger(instance)) ||
      (t === 'boolean' && typeof instance === 'boolean');
    if (!ok) errors.push(`${path}: 期望类型 ${t}`);
  }

  if (schema.enum && !schema.enum.includes(instance)) {
    errors.push(`${path}: 不在 enum`);
  }
  if (typeof instance === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern).test(instance)) {
      errors.push(`${path}: 不符 pattern`);
    }
    if (schema.minLength !== undefined && instance.length < schema.minLength) {
      errors.push(`${path}: 短于 minLength`);
    }
  }
  if (typeof instance === 'number') {
    if (schema.minimum !== undefined && instance < schema.minimum) {
      errors.push(`${path}: 小于 minimum`);
    }
    if (schema.maximum !== undefined && instance > schema.maximum) {
      errors.push(`${path}: 大于 maximum`);
    }
  }

  if (schema.type === 'object' && instance && typeof instance === 'object' && !Array.isArray(instance)) {
    for (const key of schema.required || []) {
      if (instance[key] === undefined) errors.push(`${path}: 缺必填 ${key}`);
    }
    const props = schema.properties || {};
    for (const [key, value] of Object.entries(instance)) {
      if (props[key]) {
        errors.push(...validateAgainstSchema(value, props[key], root, `${path}.${key}`));
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}: 多余字段 ${key}`);
      }
    }
  }

  if (schema.type === 'array' && Array.isArray(instance)) {
    if (schema.minItems !== undefined && instance.length < schema.minItems) {
      errors.push(`${path}: 短于 minItems`);
    }
    if (schema.items) {
      instance.forEach((item, i) => {
        errors.push(...validateAgainstSchema(item, schema.items, root, `${path}[${i}]`));
      });
    }
  }

  return errors;
}

/** 合法引用：账与负例共用。 */
export function validateLegalRef(ref, vocab, critIds, decIds, label, errors) {
  if (!ref || typeof ref !== 'object') {
    errors.push(`${label}: legalRef 缺失或非对象`);
    return;
  }
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

/** mocked 谱系字段：账与负例共用。 */
export function validateMockedLineageField(f, vocab, critIds, decIds, label, errors) {
  if (!f?.mockBasis || typeof f.mockBasis !== 'object') {
    errors.push(`${label}: mocked 缺 mockBasis`);
    return;
  }
  if (!f.mockBasis.product) errors.push(`${label}: mocked 缺 mockBasis.product`);
  if (f.mockBasis.legal === undefined || f.mockBasis.legal === null) {
    errors.push(`${label}: mocked 缺 mockBasis.legal`);
    return;
  }
  validateLegalRef(f.mockBasis.legal, vocab, critIds, decIds, label, errors);
}

/** legalExit × edgeClass：账与负例共用。 */
export function validateLegalExit(legalExit, edgeClass, vocab, label, errors) {
  if (!legalExit) {
    errors.push(`${label}: 缺 legalExit`);
    return;
  }
  const state = vocab.state.find((s) => s.id === legalExit);
  if (!state) {
    errors.push(`${label}: legalExit 不在 STATE 白名单`);
    return;
  }
  if (edgeClass && !state.allowedEdgeClasses.includes(edgeClass)) {
    errors.push(`${label}: legalExit ${legalExit} 不允许 edgeClass ${edgeClass}`);
  }
  if (edgeClass === 'E1' && vocab.forbiddenE1Exits.includes(legalExit)) {
    errors.push(`${label}: E1 禁止出口 ${legalExit}`);
  }
}

/** 能力盘点解析：capabilityId > verifyScenarioRef > edgeClass 回退；禁止错误 happy 回退。 */
export function resolveCapability(c, capability) {
  const caps = capability.capabilities || [];
  if (c.capabilityId) {
    return caps.find((x) => x.capabilityId === c.capabilityId) || null;
  }
  if (c.verifyScenarioRef) {
    return (
      caps.find((x) => (x.scenarioRefs || []).includes(c.verifyScenarioRef)) || null
    );
  }
  if (c.edgeClass === 'E2') return caps.find((x) => x.capabilityId === 'suspend-resume') || null;
  if (c.edgeClass === 'E3') return caps.find((x) => x.capabilityId === 'reassign-handler') || null;
  if (c.edgeClass === 'E1') return caps.find((x) => x.capabilityId === 'filing-decline') || null;
  if (c.edgeClass === 'happy') return caps.find((x) => x.capabilityId === 'register-clue') || null;
  return null;
}

/** 能力绑定不得与 domain / edgeClass / scenarioRef 矛盾（账与负例共用）。 */
export function validateCapabilityBinding(c, cap, label, errors) {
  if (!cap) {
    if (c.capabilityId) errors.push(`${label}: capabilityId=${c.capabilityId} 不在盘点`);
    return;
  }
  if (Array.isArray(cap.domains) && cap.domains.length > 0 && c.domain && !cap.domains.includes(c.domain)) {
    errors.push(
      `${label}: capability ${cap.capabilityId} 不允许 domain ${c.domain}（允许 ${cap.domains.join(',')}）`,
    );
  }
  if (Array.isArray(cap.edgeClasses) && cap.edgeClasses.length > 0 && c.edgeClass && !cap.edgeClasses.includes(c.edgeClass)) {
    errors.push(
      `${label}: capability ${cap.capabilityId} 不允许 edgeClass ${c.edgeClass}`,
    );
  }
  if (
    c.verifyScenarioRef &&
    Array.isArray(cap.scenarioRefs) &&
    cap.scenarioRefs.length > 0 &&
    !cap.scenarioRefs.includes(c.verifyScenarioRef)
  ) {
    errors.push(
      `${label}: capability ${cap.capabilityId} 与场景 ${c.verifyScenarioRef} 矛盾`,
    );
  }
}

const VERDICT_ORDER = ['wired', 'partial', 'unwired', 'latent', 'missing'];

function enforceScaleGate(cases, capability, errors) {
  const blocked = capability.scaleGate?.blockedEdgeClasses || {};
  for (const edge of ['E2', 'E3']) {
    const subset = cases.filter((c) => c.edgeClass === edge);
    if (subset.length === 0) continue;
    const domains = new Set(subset.map((c) => c.domain));
    const spread = subset.length >= 3 || domains.size >= 2;
    if (!spread) continue;
    const capId = edge === 'E2' ? 'suspend-resume' : 'reassign-handler';
    const cap = (capability.capabilities || []).find((x) => x.capabilityId === capId);
    const verdict = cap?.verdict || blocked[edge] || 'missing';
    if (!['wired', 'partial'].includes(verdict)) {
      errors.push(
        `X5b scaleGate: ${edge} 已横铺（n=${subset.length}, domains=${domains.size}）但盘点为 ${verdict}，须 wired|partial`,
      );
    }
  }
}

/** 负例探针：走与账相同的 formal 校验；按「被拒收负例条数」计数。 */
export function runNegativeProbes(vocab, critIds, decIds, capability) {
  const negs = listJson(join(L2, 'fixtures/negatives')).map(readJson);
  const rejected = [];
  const missed = [];
  for (const neg of negs) {
    const probeErrors = [];
    const refs = [
      ...(neg.oracleFragment?.legalRefs || []),
      ...(neg.legalRefs || []),
    ];
    for (const ref of refs) {
      validateLegalRef(ref, vocab, critIds, decIds, neg.id, probeErrors);
    }
    if (neg.lineageField) {
      if (neg.lineageField.provenance === 'mocked') {
        validateMockedLineageField(
          neg.lineageField,
          vocab,
          critIds,
          decIds,
          neg.id,
          probeErrors,
        );
      }
    }
    if (neg.legalExit !== undefined || neg.edgeClass === 'E1') {
      validateLegalExit(neg.legalExit, neg.edgeClass, vocab, neg.id, probeErrors);
    }
    if (neg.caseFragment && capability) {
      const frag = neg.caseFragment;
      const cap = resolveCapability(frag, capability);
      validateCapabilityBinding(frag, cap, neg.id, probeErrors);
    }
    const expectFail = neg.expectLint === 'fail';
    if (expectFail && probeErrors.length > 0) {
      rejected.push(neg.id);
    } else if (expectFail && probeErrors.length === 0) {
      missed.push(neg.id);
    } else if (!expectFail && probeErrors.length > 0) {
      missed.push(`${neg.id}: expectLint≠fail 却被拒`);
    }
  }
  return { rejectedCount: rejected.length, rejected, missed };
}

/** 跑完整账校验；返回 { ok, errors, negativeProbeKills }。 */
export function lintLedger() {
  const errors = [];
  const vocab = readJson(join(L2, 'vocabulary/legal-exits.json'));
  const limits = readJson(join(L2, 'config/limits.json'));
  const capability = readJson(join(L2, 'capability/harvest-capability.json'));
  const { crit: critIds, dec: decIds } = loadCritDecIds();

  const schemas = {
    case: readJson(join(L2, 'schema/case.schema.json')),
    oracle: readJson(join(L2, 'schema/oracle.schema.json')),
    gap: readJson(join(L2, 'schema/gap.schema.json')),
    matrix: readJson(join(L2, 'schema/matrix-cell.schema.json')),
    minutes: readJson(join(L2, 'schema/panel-minutes.schema.json')),
  };

  const cases = listJson(join(L2, 'ledger/cases')).map(readJson);
  const oracles = new Map(
    listJson(join(L2, 'ledger/oracles')).map((p) => {
      const o = readJson(p);
      return [o.id, o];
    }),
  );
  const minutes = new Map(
    listJson(join(L2, 'ledger/minutes')).map((p) => {
      const m = readJson(p);
      return [m.id, m];
    }),
  );
  const cells = new Map(
    listJson(join(L2, 'ledger/matrix')).map((p) => {
      const c = readJson(p);
      return [c.id, c];
    }),
  );
  const gaps = listJson(join(L2, 'ledger/gaps')).map(readJson);

  // 先 Schema，再跨记录
  for (const c of cases) {
    for (const e of validateAgainstSchema(c, schemas.case)) {
      errors.push(`${c.id || 'case'}: schema ${e}`);
    }
  }
  for (const o of oracles.values()) {
    for (const e of validateAgainstSchema(o, schemas.oracle)) {
      errors.push(`${o.id || 'oracle'}: schema ${e}`);
    }
  }
  for (const g of gaps) {
    for (const e of validateAgainstSchema(g, schemas.gap)) {
      errors.push(`${g.id || 'gap'}: schema ${e}`);
    }
  }
  for (const cell of cells.values()) {
    for (const e of validateAgainstSchema(cell, schemas.matrix)) {
      errors.push(`${cell.id || 'matrix'}: schema ${e}`);
    }
  }
  for (const m of minutes.values()) {
    for (const e of validateAgainstSchema(m, schemas.minutes)) {
      errors.push(`${m.id || 'minutes'}: schema ${e}`);
    }
  }

  for (const cell of cells.values()) {
    if (cell.status === 'deferred' && !limits.allowedDeferredReasons.includes(cell.deferredReason)) {
      errors.push(`${cell.id}: deferredReason 非法`);
    }
    if (cell.status === 'covered' && (!cell.coveringCaseIds || cell.coveringCaseIds.length === 0)) {
      errors.push(`${cell.id}: covered 但 coveringCaseIds 空`);
    }
  }

  let mockSum = 0;
  for (const c of cases) {
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

    // X1（含 approvalTier）
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
      if (
        cell.domain !== c.domain ||
        cell.sourceClass !== c.sourceClass ||
        cell.edgeClass !== c.edgeClass ||
        cell.approvalTier !== c.approvalTier
      ) {
        errors.push(`${c.id}: X1 矩阵格坐标与用例不一致（含 approvalTier）`);
      }
      if (cell.status === 'covered' && !(cell.coveringCaseIds || []).includes(c.id)) {
        errors.push(`${c.id}: 未列入矩阵格 coveringCaseIds`);
      }
    }

    const fields = c.lineage?.fields || [];
    let mocked = 0;
    for (const f of fields) {
      if (f.provenance === 'mocked') {
        mocked += 1;
        validateMockedLineageField(f, vocab, critIds, decIds, `${c.id}/${f.path}`, errors);
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

    const oracle = oracles.get(c.oracleId);
    if (!oracle) {
      errors.push(`${c.id}: Oracle 缺失 ${c.oracleId}`);
    } else {
      if (oracle.caseId !== c.id) errors.push(`${oracle.id}: caseId 不匹配`);
      validateLegalExit(oracle.legalExit, c.edgeClass, vocab, oracle.id, errors);
      for (const ref of oracle.legalRefs || []) {
        validateLegalRef(ref, vocab, critIds, decIds, oracle.id, errors);
      }
    }

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

    // X5b：capabilityId / 场景引用优先，且绑定不得与 domain/edge/scenario 矛盾
    const cap = resolveCapability(c, capability);
    if (c.capabilityId && !cap) {
      errors.push(`${c.id}: X5b capabilityId=${c.capabilityId} 不在能力盘点`);
    } else if (c.verifyScenarioRef && !c.capabilityId && !cap) {
      errors.push(`${c.id}: X5b 场景 ${c.verifyScenarioRef} 未出现在能力盘点 scenarioRefs`);
    } else if (cap) {
      validateCapabilityBinding(c, cap, c.id, errors);
      if (VERDICT_ORDER.indexOf(c.harnessCapability) < VERDICT_ORDER.indexOf(cap.verdict)) {
        errors.push(
          `${c.id}: X5b harnessCapability=${c.harnessCapability} 优于盘点 ${cap.capabilityId}=${cap.verdict}`,
        );
      }
    }
  }

  enforceScaleGate(cases, capability, errors);

  if (cases.length > 0) {
    const mean = mockSum / cases.length;
    if (mean > limits.ledgerMeanMockRatioMaxAtMin && cases.length >= 40) {
      errors.push(`账级 mockRatio 均值 ${mean} 超过 Min 上限`);
    }
  }

  const neg = runNegativeProbes(vocab, critIds, decIds, capability);
  if (neg.rejectedCount === 0) {
    errors.push('X2b: 负例探针无一拒收，闸可能死绿');
  }
  for (const id of neg.missed) {
    errors.push(`X2b: 负例未按 expectLint 拒收或误杀：${id}`);
  }

  const expectFailTotal = listJson(join(L2, 'fixtures/negatives'))
    .map(readJson)
    .filter((n) => n.expectLint === 'fail').length;
  if (neg.rejectedCount < expectFailTotal) {
    errors.push(
      `X2b: 拒收 ${neg.rejectedCount}/${expectFailTotal} 条 expectLint=fail 负例`,
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    negativeProbeKills: neg.rejectedCount,
  };
}

function main() {
  const { ok, errors, negativeProbeKills } = lintLedger();
  if (!ok) {
    for (const e of errors) console.error(`[FAIL] ${e}`);
    process.exit(1);
  }
  console.log(
    `lint l2：账校验通过（负例探针拒收 ${negativeProbeKills} 条）。`,
  );
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
