// 发现器报告写口：只写 .run/discover/<runId>/ 下的允许文件名。
// 验证期只写报告，不自动开票。
// runId 必须是单段。路径上的符号链接一律拒绝，避免写出 .run。
import fs from 'node:fs/promises';
import path from 'node:path';

import { repoRoot } from '../paths.ts';
import {
  coarseAcks,
  diffUncovered,
  filterAcked,
  selectBaseline,
  type CoverageAck,
  type RunSnapshot,
} from './diff-runs.ts';
import type { UncoveredItem } from './uncovered.ts';

/** diff 报告形态。runId = 被 diff 的当前跑次。 */
export interface DiffReport {
  runId: string;
  baselineRunId: string | null;
  added: UncoveredItem[];
  removed: UncoveredItem[];
  /** 因缺步骤或身份而未过滤任何缺口的 ack。空数组表示没有粗键，不是零缺口。 */
  coarseAcksIgnored: CoverageAck[];
}

/** 报告输入：当前跑次 + 历史跑次（基线候选）+ ack 清单 + 可注入 root。 */
export interface DiffReportInput {
  current: RunSnapshot;
  history: readonly RunSnapshot[];
  acks: readonly CoverageAck[];
  root?: string;
}

const RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
const ALLOWED_FILES = new Set(['diff-report.json', 'discover-report.json']);

/** runId 只允许单段。含分隔符或 `..` 直接拒绝。 */
export function assertDiscoverRunId(runId: string): void {
  if (!RUN_ID_RE.test(runId)) {
    throw new Error(`discover runId 非法：${JSON.stringify(runId)}`);
  }
}

function lexicalRunFile(root: string, runId: string, name: string): string {
  assertDiscoverRunId(runId);
  if (!ALLOWED_FILES.has(name)) {
    throw new Error(`discover 报告文件名非法：${JSON.stringify(name)}`);
  }
  const runRoot = path.resolve(root, '.run');
  const target = path.resolve(runRoot, 'discover', runId, name);
  if (target !== runRoot && !target.startsWith(runRoot + path.sep)) {
    throw new Error(`discover 报告写出口越界：${target} 不在 ${runRoot} 下`);
  }
  return target;
}

/** 从 .run 往下逐段 lstat。符号链接拒绝。缺段则停，留给 mkdir 创建。 */
async function rejectSymlink(runRoot: string, target: string): Promise<void> {
  let current = runRoot;
  try {
    const rootStat = await fs.lstat(current);
    if (rootStat.isSymbolicLink()) {
      throw new Error(`discover 拒绝符号链接：${current}`);
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw error;
  }
  const rel = path.relative(runRoot, target);
  for (const part of rel.split(path.sep)) {
    if (part === '' || part === '.') continue;
    current = path.join(current, part);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) {
        throw new Error(`discover 拒绝符号链接：${current}`);
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return;
      throw error;
    }
  }
}

async function assertRealpathInsideRun(root: string, dir: string): Promise<void> {
  const runRoot = path.resolve(root, '.run');
  const realRun = await fs.realpath(runRoot);
  const realDir = await fs.realpath(dir);
  const rel = path.relative(realRun, realDir);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`discover 报告写出口越界：${realDir} 不在 ${realRun} 下`);
  }
}

async function writeJsonNoFollow(target: string, text: string): Promise<void> {
  const flags =
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW;
  const handle = await fs.open(target, flags);
  try {
    await handle.writeFile(text, 'utf8');
  } finally {
    await handle.close();
  }
}

/** 写出允许的报告文件。唯一写文件入口。 */
export async function writeDiscoverJson(input: {
  readonly root?: string;
  readonly runId: string;
  readonly name: string;
  readonly body: unknown;
}): Promise<string> {
  const root = input.root ?? repoRoot();
  const target = lexicalRunFile(root, input.runId, input.name);
  const runRoot = path.resolve(root, '.run');
  await rejectSymlink(runRoot, target);
  const dir = path.dirname(target);
  await fs.mkdir(dir, { recursive: true });
  await rejectSymlink(runRoot, target);
  await assertRealpathInsideRun(root, dir);
  await writeJsonNoFollow(target, `${JSON.stringify(input.body, null, 2)}\n`);
  return target;
}

/** 组装并写出 diff 报告。 */
export async function writeDiffReport(input: DiffReportInput): Promise<DiffReport> {
  const root = input.root ?? repoRoot();
  const baseline = selectBaseline(input.history);
  const diff = diffUncovered(baseline?.uncovered ?? [], input.current.uncovered);
  const ignored = coarseAcks(input.acks);
  const report: DiffReport = {
    runId: input.current.runId,
    baselineRunId: baseline?.runId ?? null,
    added: filterAcked(diff.added, input.acks),
    removed: filterAcked(diff.removed, input.acks),
    coarseAcksIgnored: ignored,
  };
  await writeDiscoverJson({
    root,
    runId: input.current.runId,
    name: 'diff-report.json',
    body: report,
  });
  return report;
}
