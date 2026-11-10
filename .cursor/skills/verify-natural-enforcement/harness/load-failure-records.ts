// 证据 loader（spec #322 二期 T6 / 票 #328）：读 .run/verify-<runId>/steps/**/*.json。
// 放在 discover/ 之外：discover/ 模块零 I/O（写边界门禁只允许 report.ts 写文件）。
// 只读、不新增/修改证据包；runId 取自 manifest.json，stepId 取自 JSON 正文（文件名会变形）。
// summary.failed 混杂 skip/中间步/_ui，不作输入；聚类只吃 step 记录。
import fs from 'node:fs/promises';
import path from 'node:path';

import type { FailureRecord } from './discover/cluster-failures.ts';
import { recordOf } from './record-of.ts';

/** 递归列出 steps/ 下全部 .json（按字典序，保证输出稳定）。 */
async function listStepJsonFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return []; // 无 steps/ 目录：该跑次无步骤记录。
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listStepJsonFiles(full)));
    else if (entry.isFile() && entry.name.endsWith('.json')) files.push(full);
  }
  return files.sort();
}

/** runId 只认 manifest.runId；缺失即报错，不用目录名猜测。 */
async function readRunId(runDir: string): Promise<string> {
  const manifestPath = path.join(runDir, 'manifest.json');
  let text: string;
  try {
    text = await fs.readFile(manifestPath, 'utf8');
  } catch {
    throw new Error(`跑次目录缺少 manifest.json：${runDir}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`manifest.json 不是合法 JSON：${manifestPath}`);
  }
  const runId = recordOf(parsed)?.runId;
  if (typeof runId !== 'string' || runId === '') {
    throw new Error(`manifest.json 缺少 runId：${manifestPath}`);
  }
  return runId;
}

/** summary.status === 'blocked'：跑次不入账，只聚门禁记录（blocked 不改记业务失败）。 */
async function isBlockedRun(runDir: string): Promise<boolean> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(path.join(runDir, 'summary.json'), 'utf8'));
    return recordOf(parsed)?.status === 'blocked';
  } catch {
    return false; // 无 summary 视为非 blocked，按普通跑次聚类。
  }
}

/** 逐字段窄化 step 记录；非法记录返回 null（跳过，不崩溃）。 */
function toFailureRecord(raw: unknown, runId: string, source: string): FailureRecord | null {
  const record = recordOf(raw);
  if (record === null) return null;
  const { scenarioId, stepId, pass } = record;
  if (typeof scenarioId !== 'string' || scenarioId === '') return null;
  if (typeof stepId !== 'string' || stepId === '') return null;
  if (typeof pass !== 'boolean') return null;
  const evidence = Array.isArray(record.evidence)
    ? record.evidence.filter((item): item is string => typeof item === 'string')
    : [];
  return {
    runId,
    scenarioId,
    stepId,
    pass,
    expected: record.expected,
    actual: record.actual,
    evidence,
    ...(Array.isArray(record.failures) ? { failures: record.failures } : {}),
    source,
  };
}

/**
 * 读取显式传入的跑次证据包，返回全部 step 记录（含 pass:true；过滤由纯聚类函数负责）。
 * 跑次选择由调用方决定：T6 只聚显式传入的跑次，不扫描全部历史。
 */
export async function loadFailureRecords(
  runDirs: readonly string[],
): Promise<FailureRecord[]> {
  const records: FailureRecord[] = [];
  for (const runDir of runDirs) {
    const runId = await readRunId(runDir);
    const blockedRun = await isBlockedRun(runDir);
    const stepFiles = [
      ...(await listStepJsonFiles(path.join(runDir, 'steps'))),
      ...(await listStepJsonFiles(path.join(runDir, 'ui'))).filter((file) =>
        path.relative(runDir, file).split(path.sep).join('/').includes('/steps/'),
      ),
    ];
    for (const file of stepFiles) {
      let raw: unknown;
      try {
        raw = JSON.parse(await fs.readFile(file, 'utf8'));
      } catch {
        continue; // 坏 JSON 跳过：证据包损坏不应阻断其余聚类。
      }
      const source = path.relative(runDir, file).split(path.sep).join('/');
      const record = toFailureRecord(raw, runId, source);
      if (record === null) continue;
      // blocked 跑次不得入账：只保留 _harness 门禁记录，先前业务失败不聚类。
      if (blockedRun && record.scenarioId !== '_harness') continue;
      records.push(record);
    }
  }
  return records;
}
