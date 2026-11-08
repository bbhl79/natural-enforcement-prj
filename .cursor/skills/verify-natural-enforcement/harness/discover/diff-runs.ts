// 发现器信号源 1（spec #322 首期 T2）：跨跑次 diff + 基线选择 + ack 过滤。
// 纯函数，无 I/O。报告写出由 report.ts 负责。
import type { UncoveredItem } from './uncovered.ts';

/** 跨跑次 diff 结果：新增缺口与消失缺口。 */
export interface UncoveredDiff {
  added: UncoveredItem[];
  removed: UncoveredItem[];
}

/** diff 键：optional 字段缺省归空串。identityRef 入键，新身份不算同一缺口。 */
function keyOf(item: UncoveredItem): string {
  return JSON.stringify([
    item.kind,
    item.scenarioId ?? '',
    item.stepId ?? '',
    item.featureMapRef ?? '',
    item.identityRef ?? '',
  ]);
}

/** 两份 uncovered[] 跨跑次 diff：current 新增入 added，baseline 消失入 removed。 */
export function diffUncovered(
  baseline: readonly UncoveredItem[],
  current: readonly UncoveredItem[],
): UncoveredDiff {
  const baselineKeys = new Set(baseline.map(keyOf));
  const currentKeys = new Set(current.map(keyOf));
  return {
    added: current.filter((item) => !baselineKeys.has(keyOf(item))),
    removed: baseline.filter((item) => !currentKeys.has(keyOf(item))),
  };
}

/** 跑次快照：基线选择所需最小字段（manifest 时间戳 + summary 状态与 uncovered）。 */
export interface RunSnapshot {
  readonly runId: string;
  readonly status: 'passed' | 'failed' | 'blocked';
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly uncovered: readonly UncoveredItem[];
}

/** 跑次有效时间戳：endedAt 优先，缺省回退 startedAt（ISO UTC 串按字典序即时间序）。 */
function timestampOf(run: RunSnapshot): string {
  return run.endedAt ?? run.startedAt;
}

/** 基线 = 最近一次入账（非 blocked）跑次；无入账跑次则 null。 */
export function selectBaseline(runs: readonly RunSnapshot[]): RunSnapshot | null {
  let latest: RunSnapshot | null = null;
  for (const run of runs) {
    if (run.status === 'blocked') continue;
    if (latest === null || timestampOf(run) > timestampOf(latest)) latest = run;
  }
  return latest;
}

/** ack 键类型：地图节点或路由（spec #322 Q4）。首期过滤只用地图节点，路由留 T5。 */
export type CoverageAckKeyType = 'feature-map-node' | 'route';

/**
 * by-design 确认态一条。确认权归 Lei Hu，代理只提案；初始清单为空。
 * 只有 kind + scenarioId + key 齐备，且 stepId／identityRef 与缺口一致时才过滤。
 * 只写地图节点、不写步骤或身份的粗键不匹配任何缺口。
 */
export interface CoverageAck {
  readonly key: string;
  readonly keyType: CoverageAckKeyType;
  readonly kind?: string;
  readonly scenarioId?: string;
  readonly stepId?: string;
  readonly identityRef?: string;
}

function sameToken(left: string | undefined, right: string | undefined): boolean {
  return (left ?? '') === (right ?? '');
}

/** 粗键：缺 kind 或 scenarioId，或不是地图节点键。这种 ack 不过滤缺口。 */
export function isPreciseAck(ack: CoverageAck): boolean {
  return (
    ack.keyType === 'feature-map-node' &&
    ack.key.trim() !== '' &&
    (ack.kind ?? '').trim() !== '' &&
    (ack.scenarioId ?? '').trim() !== ''
  );
}

/** 精确匹配才过滤。新步骤、新身份、无 featureMapRef 的缺口不被粗键吞掉。 */
export function ackMatches(ack: CoverageAck, item: UncoveredItem): boolean {
  if (!isPreciseAck(ack)) return false;
  if ((item.featureMapRef ?? '') === '') return false;
  if (ack.key !== item.featureMapRef) return false;
  if (ack.kind !== item.kind) return false;
  if (ack.scenarioId !== item.scenarioId) return false;
  if (!sameToken(ack.stepId, item.stepId)) return false;
  if (!sameToken(ack.identityRef, item.identityRef)) return false;
  return true;
}

/** 过滤已被精确 ack 命中的缺口。粗键与路由类 ack 一律保留原缺口。 */
export function filterAcked(
  items: readonly UncoveredItem[],
  acks: readonly CoverageAck[],
): UncoveredItem[] {
  return items.filter((item) => !acks.some((ack) => ackMatches(ack, item)));
}

/** 报告用：这些 ack 因缺身份字段而未参与过滤，不能当成已确认零缺口。 */
export function coarseAcks(acks: readonly CoverageAck[]): CoverageAck[] {
  return acks.filter((ack) => !isPreciseAck(ack));
}
