// 用途：L2 合法闸与负例探针自测；确认账绿、X2b 负例必杀。
// 调用方：dev 脚本的 lint l2 子项（node --test）。
// 边界：只读 e2e/l2 夹具与 L1 产物；不写盘、不调产品 API。
// 依据：e2e/l2/README.md。

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lintLedger } from './l2-lint.mjs';

test('L2 账与 X2b：lintLedger 通过且负例有杀伤', () => {
  const result = lintLedger();
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.ok(result.negativeProbeKills >= 4, 'X2b 至少杀伤 4 条负例');
});
