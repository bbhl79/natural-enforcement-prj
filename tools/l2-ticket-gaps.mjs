#!/usr/bin/env node
// 用途：将 open 缺口批量标为 ticketed 并写入 ticketRef（Phase 3）。
// 调用方：本机维护 e2e/l2/ledger/gaps；不进 CI。
// 边界：不关闭缺口；不改用例/Oracle。
// 依据：e2e/l2/README.md；L2 计划 Phase 3。

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GAPS = join(ROOT, 'e2e/l2/ledger/gaps');
const ticketRef = process.argv[2];
if (!ticketRef) {
  console.error('用法: node tools/l2-ticket-gaps.mjs <ticketRef>');
  process.exit(2);
}

let n = 0;
for (const name of readdirSync(GAPS).filter((f) => f.endsWith('.json'))) {
  const path = join(GAPS, name);
  const gap = JSON.parse(readFileSync(path, 'utf8'));
  if (gap.status !== 'open') continue;
  gap.status = 'ticketed';
  gap.ticketRef = ticketRef;
  writeFileSync(path, `${JSON.stringify(gap, null, 2)}\n`);
  n += 1;
}
console.log(`ticketed ${n} gaps → ${ticketRef}`);
