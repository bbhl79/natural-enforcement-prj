// 用途：L2 合法闸与负例探针自测；确认账绿、X2b 按条拒收、能力匹配与 Schema。
// 调用方：dev 脚本的 lint l2 子项（node --test）。
// 边界：只读 e2e/l2 夹具与 L1 产物；不写盘、不调产品 API。
// 依据：e2e/l2/README.md。

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  lintLedger,
  resolveCapability,
  validateAgainstSchema,
  validateMockedLineageField,
  validateLegalExit,
} from './l2-lint.mjs';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const L2 = join(ROOT, 'e2e/l2');

function readJson(rel) {
  return JSON.parse(readFileSync(join(L2, rel), 'utf8'));
}

test('L2 账与 X2b：lintLedger 通过且按条拒收全部 expectLint=fail 负例', () => {
  const result = lintLedger();
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(result.negativeProbeKills, 4);
});

test('Schema：空 steps 的 case 应失败', () => {
  const schema = readJson('schema/case.schema.json');
  const bad = {
    id: 'L2-CASE-bad',
    seedId: 'x',
    edgeClass: 'happy',
    matrixCellId: 'MC-x',
    domain: 'survey',
    sourceCode: '305',
    sourceClass: '3',
    approvalTier: 'none',
    lineage: { fields: [{ path: 'a', provenance: 'derived', value: 1, seedPath: 'a' }] },
    steps: [],
    oracleId: 'L2-ORACLE-x',
    g6Disposition: 'admit-ok',
    harnessCapability: 'wired',
    mockRatio: 0,
  };
  const errs = validateAgainstSchema(bad, schema);
  assert.ok(errs.some((e) => e.includes('minItems')), errs.join('; '));
});

test('X5b：显式 scenarioRef 优先，filing 场景不得回退为 register wired', () => {
  const capability = readJson('capability/harvest-capability.json');
  const cap = resolveCapability(
    {
      verifyScenarioRef: 'vf-sc-filing-after-dispatch',
      edgeClass: 'happy',
      harnessCapability: 'wired',
    },
    capability,
  );
  assert.ok(cap);
  assert.equal(cap.capabilityId, 'filing-after-dispatch');
  assert.equal(cap.verdict, 'unwired');
});

test('共用校验：缺 mockBasis.legal 与 E1 处罚出口均拒', () => {
  const vocab = readJson('vocabulary/legal-exits.json');
  const errs1 = [];
  validateMockedLineageField(
    {
      path: 'x',
      provenance: 'mocked',
      value: 1,
      mockBasis: { product: 'p', legal: null },
    },
    vocab,
    new Set(),
    new Set(),
    'neg',
    errs1,
  );
  assert.ok(errs1.some((e) => e.includes('mockBasis.legal')));

  const errs2 = [];
  validateLegalExit('EXIT-PENALTY-OR-CLOSE', 'E1', vocab, 'neg', errs2);
  assert.ok(errs2.some((e) => e.includes('E1 禁止出口')));
});
