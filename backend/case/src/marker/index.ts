// 用途：定义案件标记键、置位／清除的当前状态计算与读取入口。
// 调用方：backend/server/src 下各案件服务，例如 backend/server/src/case-decision.service.ts、backend/server/src/case-notice.service.ts、backend/server/src/case-transfer.service.ts。
// 边界：只读标记行并计算当前状态；写入由调用方经 CaseStore 完成。
// 依据：Issue #272、#256。
// 案件标记（#272 R-02）：统一标记存储与读写 API。
// 标记是案件上的命名事实，按「置位／清除」追加行；读取当前状态取每个键最后一行。
// 其他票（#269／#242／#270）复用本出口，不另造第二套机制。
// 「已送达」「进入听证程序」一经置位不得清除（#256 §4 第 4 条）。

import type { CaseStore } from '../persistence/case-store.ts';

/** 本票登记的案件标记键。追加新键时同步这里与迁移里的取值约束。 */
export const CASE_MARKER_KEYS = [
  /** 告知书已送达（供决定票读 X05）。 */
  'notice-served',
  /** 告知等待尚未结束（决定未作出）。 */
  'notice-waiting',
  /** 期满未申请或逾期，视为放弃听证。 */
  'deemed-waived',
  /** 进入听证程序：已受理或已排期（含其后终止）。写「是」后不清除。 */
  'hearing-entered',
  /** 听证已终止，等待当事人重新申请（X28）。 */
  'hearing-terminated',
  /** 已形成涉刑移送记载（T30 侧链起点）。本键只由移送票置位，不清除。 */
  'criminal-transfer',
] as const;

// 案件标记键的类型别名。
export type CaseMarkerKey = (typeof CASE_MARKER_KEYS)[number];

/** 一经置位不得清除的标记。调用方清除时由服务层拒绝。 */
export const STICKY_CASE_MARKERS: readonly CaseMarkerKey[] = ['notice-served', 'hearing-entered'];

// 判断字符串是否为登记的案件标记键；服务层校验入参时调用。
export function isCaseMarkerKey(value: string): value is CaseMarkerKey {
  return (CASE_MARKER_KEYS as readonly string[]).includes(value);
}

// 判断标记是否一经置位不得清除；服务层处理清除请求前调用。
export function isStickyCaseMarker(marker: string): boolean {
  return (STICKY_CASE_MARKERS as readonly string[]).includes(marker);
}

/** 标记行。state 为 set 或 cleared；只追加。 */
export interface CaseMarkerFact {
  readonly id: string;
  readonly marker: string;
  readonly state: 'set' | 'cleared';
  readonly changedAt: Date;
}

/**
 * 当前生效的标记键。每个键取最后一行的状态；未知键也原样返回，便于读旧数据。
 * 时间相同时按行主键定序（ULID 单调）。
 */
export function activeMarkerKeys(rows: readonly CaseMarkerFact[]): string[] {
  const ordered = [...rows].sort((left, right) => {
    const byTime = left.changedAt.getTime() - right.changedAt.getTime();
    return byTime !== 0 ? byTime : left.id.localeCompare(right.id);
  });
  const state = new Map<string, 'set' | 'cleared'>();
  for (const row of ordered) state.set(row.marker, row.state);
  return [...state.entries()].filter(([, value]) => value === 'set').map(([marker]) => marker);
}

/** 读本案当前生效标记。各服务构造引擎 subject 时统一走本函数。 */
export async function readActiveCaseMarkers(cases: CaseStore, caseId: string): Promise<readonly string[]> {
  return activeMarkerKeys(await cases.listCaseMarkers(caseId));
}