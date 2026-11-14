#!/usr/bin/env node
// 用途：报告 X5 Min 必选格就绪情况；无 blocker 时 claimMin=true。
// 调用方：本机 / 文档；不进 lint 硬闸（宣称时再硬闸）。
// 边界：先 lintLedger；只计 admit-ok；不计 latent/missing 为「能力覆盖」。
// 依据：e2e/l2/config/x5-min-cells.json；L2 计划 §8.3。

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintLedger } from './l2-lint.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const L2 = join(ROOT, 'e2e/l2');
const minCfg = JSON.parse(readFileSync(join(L2, 'config/x5-min-cells.json'), 'utf8'));

const report = {
  caseCountAll: 0,
  caseCount: 0,
  rules: [],
  claimMin: false,
  blockers: [],
};

const lint = lintLedger();
if (!lint.ok) {
  for (const e of lint.errors.slice(0, 20)) {
    report.blockers.push(`lintLedger: ${e}`);
  }
  if (lint.errors.length > 20) {
    report.blockers.push(`lintLedger: …另有 ${lint.errors.length - 20} 条`);
  }
}

const allCases = existsSync(join(L2, 'ledger/cases'))
  ? readdirSync(join(L2, 'ledger/cases'))
      .filter((n) => n.endsWith('.json'))
      .map((n) => JSON.parse(readFileSync(join(L2, 'ledger/cases', n), 'utf8')))
  : [];

// M7 等准入口径：仅 admit-ok；panel-blocked/not-reached 不计覆盖。
const cases = allCases.filter((c) => c.g6Disposition === 'admit-ok');

const matrixCells = existsSync(join(L2, 'ledger/matrix'))
  ? readdirSync(join(L2, 'ledger/matrix'))
      .filter((n) => n.endsWith('.json'))
      .map((n) => JSON.parse(readFileSync(join(L2, 'ledger/matrix', n), 'utf8')))
  : [];

function groupCount(list, keyFn) {
  const m = new Map();
  for (const c of list) {
    const k = keyFn(c);
    if (k == null) continue;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

report.caseCountAll = allCases.length;
report.caseCount = cases.length;

for (const rule of minCfg.rules) {
  const m = rule.match;
  let pool = cases;
  if (m.edgeClass) pool = pool.filter((c) => c.edgeClass === m.edgeClass);
  if (m.edgeClassAny) pool = pool.filter((c) => m.edgeClassAny.includes(c.edgeClass));
  if (m.sourceClass) pool = pool.filter((c) => c.sourceClass === m.sourceClass);
  if (m.sourceClassAny) pool = pool.filter((c) => m.sourceClassAny.includes(c.sourceClass));
  if (m.approvalTierAny) {
    pool = pool.filter((c) => m.approvalTierAny.includes(c.approvalTier));
  }
  if (m.seedIdAny) pool = pool.filter((c) => m.seedIdAny.includes(c.seedId));

  let okGroups = 0;
  let detail = {};
  if (m.groupBy) {
    const g = groupCount(pool, (c) => c[m.groupBy]);
    detail = Object.fromEntries(g);
    okGroups = g.size;
  } else {
    okGroups = pool.length > 0 ? 1 : 0;
    detail = { hits: pool.length };
  }
  const pass = okGroups >= rule.minCount;
  report.rules.push({ id: rule.id, pass, okGroups, minCount: rule.minCount, detail });
  if (!pass) report.blockers.push(`${rule.id}: need ${rule.minCount} groups/hits, got ${okGroups}`);
}

const [lo, hi] = minCfg.caseCountRange;
if (cases.length < lo || cases.length > hi) {
  report.blockers.push(`admit-ok caseCount ${cases.length} not in [${lo},${hi}]`);
}

const mockMean =
  cases.reduce((s, c) => s + (typeof c.mockRatio === 'number' ? c.mockRatio : 0), 0) /
  (cases.length || 1);
report.meanMockRatio = Number(mockMean.toFixed(4));
if (mockMean > minCfg.maxLedgerMeanMockRatio) {
  report.blockers.push(`mean mockRatio ${report.meanMockRatio} > ${minCfg.maxLedgerMeanMockRatio}`);
}

const mandatory = matrixCells.filter((c) => c.mandatoryMin === true);
const deferredMandatory = mandatory.filter((c) => c.status === 'deferred');
const deferredShare =
  mandatory.length === 0 ? 0 : deferredMandatory.length / mandatory.length;
report.mandatoryMinCells = mandatory.length;
report.deferredMandatoryShare = Number(deferredShare.toFixed(4));
const maxDeferred = minCfg.maxDeferredShareInMandatory;
if (deferredShare > maxDeferred) {
  report.blockers.push(
    `mandatoryMin deferred share ${report.deferredMandatoryShare} > ${maxDeferred}`,
  );
}

report.structuralMinReady = report.rules.every((r) => r.pass);
// claimMin：lintLedger + 结构规则 + 用例量级 + Mock/deferred 限额均无 blocker。
report.claimMin = report.blockers.length === 0;
report.notes = report.claimMin
  ? 'claimMin=true：lintLedger 绿且 admit-ok 量级与 M1–M7/限额均通过。capability latent/missing/unwired 仍不计能力覆盖分子。'
  : 'claimMin=false：见 blockers。仅统计 g6Disposition=admit-ok。capability latent/missing/unwired 不计能力覆盖分子。';
report.lintOk = lint.ok;
report.lintErrorCount = lint.errors.length;

console.log(JSON.stringify(report, null, 2));
process.exit(report.blockers.length ? 1 : 0);
