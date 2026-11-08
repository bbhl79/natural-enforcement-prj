// 发现器信号源 1（spec #322 首期 T2）：跨跑次 diff + 基线选择 + ack 过滤。
// 纯函数，无 I/O。报告写出由 report.ts 负责。
import type { UncoveredItem } from './uncovered.ts';

/** 跨跑次 diff 结果：新增缺口与消失缺口。 */
export interface UncoveredDiff {
  added: UncoveredItem[];
  removed: UncoveredItem[];
}

/** diff 键四元组归一：optional 字段缺省归空串，键稳定（spec #322 Q2）。 */
function keyOf(item: UncoveredItem): string {
  return JSON.stringify([
    item.kind,
    item.scenarioId ?? '',
    item.stepId ?? '',
    item.featureMapRef ?? '',
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

/** by-design 确认态一条。确认权归 Lei Hu，代理只提案；初始清单为空。 */
export interface CoverageAck {
  readonly key: string;
  readonly keyType: CoverageAckKeyType;
}

/** 过滤已 ack 的缺口：首期按 featureMapRef 匹配地图节点 ack；路由类 ack 留 T5。 */
export function filterAcked(
  items: readonly UncoveredItem[],
  acks: readonly CoverageAck[],
): UncoveredItem[] {
  const ackedNodes = new Set(
    acks.filter((ack) => ack.keyType === 'feature-map-node').map((ack) => ack.key),
  );
  return items.filter(
    (item) => item.featureMapRef === undefined || !ackedNodes.has(item.featureMapRef),
  );
}
