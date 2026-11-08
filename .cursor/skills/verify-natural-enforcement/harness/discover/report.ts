// 发现器报告唯一写口（spec #322 首期 T2）：只写 .run/discover/<runId>/diff-report.json。
// 验证期只写报告，不自动开票（不建 GitHub issue，不写提案出口）。
import fs from 'node:fs/promises';
import path from 'node:path';

import { repoRoot } from '../paths.ts';
import {
  diffUncovered,
  filterAcked,
  selectBaseline,
  type CoverageAck,
  type RunSnapshot,
} from './diff-runs.ts';
import type { UncoveredItem } from './uncovered.ts';

/** diff 报告形态。runId = 被 diff 的当前跑次（设计点 D）。 */
export interface DiffReport {
  runId: string;
  baselineRunId: string | null;
  added: UncoveredItem[];
  removed: UncoveredItem[];
}

/** 报告输入：当前跑次 + 历史跑次（基线候选）+ ack 清单 + 可注入 root。 */
export interface DiffReportInput {
  current: RunSnapshot;
  history: readonly RunSnapshot[];
  acks: readonly CoverageAck[];
  root?: string;
}

/** 写前正向边界：目标必须落在 <root>/.run/ 下，越界抛错（为 T3 写边界门禁铺垫）。 */
function assertWithinRun(root: string, target: string): void {
  const runRoot = path.resolve(root, '.run');
  const resolved = path.resolve(target);
  if (resolved !== runRoot && !resolved.startsWith(runRoot + path.sep)) {
    throw new Error(`discover 报告写出口越界：${resolved} 不在 ${runRoot} 下`);
  }
}

/** 组装并写出 diff 报告。discover 报告唯一写口，只写 .run/discover/<runId>/diff-report.json。 */
export async function writeDiffReport(input: DiffReportInput): Promise<DiffReport> {
  const root = input.root ?? repoRoot();
  const baseline = selectBaseline(input.history);
  const diff = diffUncovered(baseline?.uncovered ?? [], input.current.uncovered);
  const report: DiffReport = {
    runId: input.current.runId,
    baselineRunId: baseline?.runId ?? null,
    added: filterAcked(diff.added, input.acks),
    removed: filterAcked(diff.removed, input.acks),
  };
  const target = path.join(root, '.run', 'discover', input.current.runId, 'diff-report.json');
  assertWithinRun(root, target);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}
