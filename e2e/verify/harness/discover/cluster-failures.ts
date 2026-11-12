// 用途：把失败步骤记录聚类成去重后的失败簇，并规划建票、评论或重开的动作。
// 发现器信号源 3（spec #322 二期 T6 / 票 #328）：runnable 转红与 blocked 证据包聚类。
// 纯函数，无 I/O；本文件零 fs（写边界门禁只允许 report.ts 写文件）。
// 证据读取由 harness/load-failure-records.ts 负责，GitHub 动作在 harness/apply-failure-clusters.ts。
//
// 去重键 = scenarioId + stepId + failureKind（spec Q11）：粒度到 step，不到单条 assert。
// assert 失败归一为 assert:<排序去重后的 assert 路径集>；blocked 归一为 blocked:<原因码>。
import type { StepRecord } from '../evidence.ts';
import { recordOf } from '../record-of.ts';

/** 一条失败记录：StepRecord + 所属跑次（loader 补齐）。 */
export interface FailureRecord extends StepRecord {
  readonly runId: string;
  /** 证据包内相对路径，如 steps/<scenarioId>/<stepId>.json；票体只引用路径不贴正文。 */
  readonly source?: string;
}

/** 单条记录的分类结果。 */
export interface ClassifiedFailure {
  readonly scenarioId: string;
  readonly stepId: string;
  readonly failureKind: string;
  /** 稳定去重键 = JSON.stringify([scenarioId, stepId, failureKind])。 */
  readonly key: string;
  readonly message: string;
  readonly assertPaths: readonly string[];
}

/** 簇内一条证据（一次跑次的一条失败记录）。 */
export interface FailureClusterEvidence {
  readonly runId: string;
  readonly source?: string;
  readonly message: string;
  readonly assertPaths: readonly string[];
}

/** 同键失败归并后的簇。 */
export interface FailureCluster {
  readonly key: string;
  readonly scenarioId: string;
  readonly stepId: string;
  readonly failureKind: string;
  readonly evidence: readonly FailureClusterEvidence[];
}

/** 稳定去重键：JSON 数组编码，scenarioId/stepId 含短横、assert 路径含点均无分隔符冲突。 */
export function clusterKeyOf(scenarioId: string, stepId: string, failureKind: string): string {
  return JSON.stringify([scenarioId, stepId, failureKind]);
}

/** blocked 原因归一：键只放稳定原因码，原始 error 全文留作证据。 */
function blockedKindOf(actual: Record<string, unknown> | null): string {
  const error = typeof actual?.error === 'string' ? actual.error : '';
  const reason = /原因\s+([a-z][a-z0-9-]*)/.exec(error)?.[1];
  if (reason !== undefined) return `blocked:${reason}`;
  if (/overlay\s+(?:on|off)\s+退出/.test(error)) return 'blocked:overlay-exit';
  return 'blocked:harness-error';
}

/** failures[] 逐项窄化取 path，去重排序；非法项丢弃。 */
function assertPathsOf(failures: readonly unknown[]): string[] {
  const paths = new Set<string>();
  for (const item of failures) {
    const path = recordOf(item)?.path;
    if (typeof path === 'string' && path !== '') paths.add(path);
  }
  return [...paths].sort();
}

/** 步骤动作失败的一句话摘要（含 HTTP 状态，若有）。 */
function stepFailedMessageOf(actual: Record<string, unknown> | null): string {
  const http = recordOf(actual?.http);
  const status = http?.status;
  return typeof status === 'number' ? `步骤动作失败：HTTP ${status}` : '步骤动作失败';
}

/**
 * 单条失败记录 → 分类。非失败聚类对象返回 null：
 * - skip 记录（latent/driver 跳过）归信号源 1；
 * - pass:true 记录（含 decide 跳过）；
 * - 末步 strictSteps 派生红（failures 空但 expected.assert 在）——根因已在中间步成簇。
 */
export function classifyFailure(record: FailureRecord): ClassifiedFailure | null {
  if (record.stepId === 'skip') return null;
  if (record.pass) return null;

  const expected = recordOf(record.expected);
  const actual = recordOf(record.actual);
  let failureKind: string;
  let message: string;
  let assertPaths: readonly string[] = [];

  if (record.scenarioId === '_harness' && record.stepId === 'blocked') {
    failureKind = blockedKindOf(actual);
    message = typeof actual?.error === 'string' ? actual.error : '门禁 blocked';
  } else if (record.scenarioId === '_ui') {
    failureKind = `ui-hook:${record.stepId}`;
    message =
      typeof actual?.error === 'string' ? actual.error : `页面取证 ${record.stepId} 失败`;
  } else if (record.stepId === 'empty') {
    failureKind = 'empty-steps';
    message = 'scenario 无可执行步骤';
  } else {
    const failures = Array.isArray(record.failures) ? record.failures : [];
    if (failures.length > 0) {
      assertPaths = assertPathsOf(failures);
      failureKind = assertPaths.length > 0 ? `assert:${assertPaths.join('+')}` : 'assert:unknown';
      message =
        assertPaths.length > 0
          ? `assert 失败 ${assertPaths.length} 条：${assertPaths.join('、')}`
          : 'assert 失败（路径缺失）';
    } else if (expected?.note === 'intermediate') {
      failureKind = 'step-failed';
      message = stepFailedMessageOf(actual);
    } else if (Array.isArray(expected?.assert)) {
      // 末步 strictSteps 派生红：不单独成簇，根因在中间步。
      return null;
    } else {
      failureKind = 'step-failed';
      message = stepFailedMessageOf(actual);
    }
  }

  return {
    scenarioId: record.scenarioId,
    stepId: record.stepId,
    failureKind,
    key: clusterKeyOf(record.scenarioId, record.stepId, failureKind),
    message,
    assertPaths,
  };
}

/** 失败记录 → 同键簇。簇与证据均保持首次出现顺序；重复输入按 runId+source+message 去重。 */
export function clusterFailures(records: readonly FailureRecord[]): FailureCluster[] {
  const buckets: { classified: ClassifiedFailure; evidence: FailureClusterEvidence[] }[] = [];
  const indexByKey = new Map<string, number>();

  for (const record of records) {
    const classified = classifyFailure(record);
    if (classified === null) continue;

    let index = indexByKey.get(classified.key);
    if (index === undefined) {
      index = buckets.length;
      buckets.push({ classified, evidence: [] });
      indexByKey.set(classified.key, index);
    }
    const evidence: FailureClusterEvidence = {
      runId: record.runId,
      ...(record.source !== undefined ? { source: record.source } : {}),
      message: classified.message,
      assertPaths: classified.assertPaths,
    };
    const duplicated = buckets[index].evidence.some(
      (item) =>
        item.runId === evidence.runId &&
        item.source === evidence.source &&
        item.message === evidence.message,
    );
    if (!duplicated) buckets[index].evidence.push(evidence);
  }

  return buckets.map(({ classified, evidence }) => ({
    key: classified.key,
    scenarioId: classified.scenarioId,
    stepId: classified.stepId,
    failureKind: classified.failureKind,
    evidence,
  }));
}

// ---- GitHub 动作计划（仍是纯函数：只产出动作，不执行 gh）----

/** 只立 needs-triage 票（票 #328 纪律：不加 bug/enhancement，分类留给人）。 */
export const FAILURE_TRIAGE_LABEL = 'needs-triage';

/**
 * 票面机器键 marker。查重只匹配本 marker，不解析中文正文；
 * 人工载体（#319 等）要参与归并，需在对应条目旁写入同格式 marker。
 */
export function failureMarker(key: string): string {
  return `<!-- verify-failure-key: ${key} -->`;
}

/** 既有票快照：查重所需最小字段。 */
export interface ExistingIssue {
  readonly number: number;
  readonly state: 'open' | 'closed';
  readonly body: string;
  readonly closedAt?: string | null;
}

/** 一条待执行的 GitHub 动作。 */
export type ClusterIssueAction =
  | {
      readonly action: 'create';
      readonly cluster: FailureCluster;
      readonly title: string;
      readonly body: string;
      readonly labels: readonly string[];
    }
  | {
      readonly action: 'comment';
      readonly cluster: FailureCluster;
      readonly issueNumber: number;
      readonly body: string;
    }
  | {
      readonly action: 'reopen';
      readonly cluster: FailureCluster;
      readonly issueNumber: number;
      readonly comment: string;
    };

function issueTitleOf(cluster: FailureCluster): string {
  const prefix = cluster.failureKind.startsWith('blocked:') ? '[verify][blocked]' : '[verify]';
  return `${prefix} ${cluster.scenarioId}/${cluster.stepId}: ${cluster.failureKind}`;
}

function evidenceLinesOf(cluster: FailureCluster): string[] {
  return cluster.evidence.map((item) => {
    const where =
      item.source !== undefined
        ? `\`${item.runId}\`（\`${item.source}\`）`
        : `\`${item.runId}\``;
    return `- 跑次 ${where}：${item.message}`;
  });
}

function issueBodyOf(cluster: FailureCluster): string {
  return [
    failureMarker(cluster.key),
    '',
    '自动聚类自 verify 跑次失败证据。请人工 triage。',
    '',
    `- 场景：\`${cluster.scenarioId}\``,
    `- 步骤：\`${cluster.stepId}\``,
    `- 失败类别：\`${cluster.failureKind}\``,
    ...(cluster.failureKind.startsWith('blocked:')
      ? ['- 说明：本票记录门禁 blocked，不改记业务失败。']
      : []),
    '- 证据：',
    ...evidenceLinesOf(cluster),
  ].join('\n');
}

function commentBodyOf(cluster: FailureCluster, heading: string): string {
  return [
    heading,
    '',
    `- 场景：\`${cluster.scenarioId}\``,
    `- 步骤：\`${cluster.stepId}\``,
    `- 失败类别：\`${cluster.failureKind}\``,
    '- 证据：',
    ...evidenceLinesOf(cluster),
  ].join('\n');
}

/** 最近关闭的一张（closedAt ISO 串字典序即时间序；缺失按空串垫底）。 */
function latestClosedOf(issues: readonly ExistingIssue[]): ExistingIssue | undefined {
  let latest: ExistingIssue | undefined;
  for (const issue of issues) {
    if (latest === undefined || (issue.closedAt ?? '') > (latest.closedAt ?? '')) latest = issue;
  }
  return latest;
}

/**
 * 聚簇 → GitHub 动作计划（纯函数）。同键判定只看票面 marker：
 * - 同键有开放票 → 评论补证据，不立新；
 * - 同键仅关闭票 → 重开最近关闭的一张并附复发证据；
 * - 无同键票 → 立一张 needs-triage 新票。
 * 无 marker 的人工票（#319 形态）不触碰，保持并存。
 */
export function planClusterActions(
  clusters: readonly FailureCluster[],
  issues: readonly ExistingIssue[],
): ClusterIssueAction[] {
  const actions: ClusterIssueAction[] = [];
  for (const cluster of clusters) {
    const marker = failureMarker(cluster.key);
    const sameKey = issues.filter((issue) => issue.body.includes(marker));

    const open = sameKey
      .filter((issue) => issue.state === 'open')
      .sort((a, b) => a.number - b.number)[0];
    if (open !== undefined) {
      actions.push({
        action: 'comment',
        cluster,
        issueNumber: open.number,
        body: commentBodyOf(cluster, '同键失败追加证据（verify 失败聚类）。'),
      });
      continue;
    }

    const closed = latestClosedOf(sameKey.filter((issue) => issue.state === 'closed'));
    if (closed !== undefined) {
      actions.push({
        action: 'reopen',
        cluster,
        issueNumber: closed.number,
        comment: commentBodyOf(cluster, '同键失败在票关闭后复发，重开并追加证据（verify 失败聚类）。'),
      });
      continue;
    }

    actions.push({
      action: 'create',
      cluster,
      title: issueTitleOf(cluster),
      body: issueBodyOf(cluster),
      labels: [FAILURE_TRIAGE_LABEL],
    });
  }
  return actions;
}
