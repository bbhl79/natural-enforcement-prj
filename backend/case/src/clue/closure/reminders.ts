// 结案提醒生成的内部服务（#217／#226；规格 D 节）。
//
// 不予立案、移送、立案、其他都按暂存线索的当前命中集逐对生成提醒，与状态写入同事务：
// 被结案的那条线索，逐个找出撞上它且当前「不派」的线索，为每一对写一条提醒。
// 提醒挂在「不派」的暂存线索上，对方是被结案的线索。
//
// #226：立案（kind='case'）与 no-case／transfer／other 同口径，恒生成；已删除 filedReminderEnabled。
//
// 本服务只依赖端口（ClueStore），技术主键由调用方注入（模块内不另起一份生成器）：
// 调用方把事务内的存储实例传进来，提醒行与状态写入同成同败。
// 案件段（#11）写入 filed 时必须在同一事务调用它。

import type { ClueStore } from '../../persistence/clue-store.ts';

/** 提醒生成的入参。 */
export interface ClosureReminderGeneration {
  /** 被结案的线索（不予立案、移送或立案的那一条）。 */
  readonly closedClueId: string;
  /** 提醒类型：no-case｜transfer｜case｜other（#229）。 */
  readonly kind: 'no-case' | 'transfer' | 'case' | 'other';
  readonly createdAt: Date;
  /** 技术主键生成（调用方注入）。 */
  readonly newId: () => string;
}

/**
 * 生成结案提醒：返回新建的提醒 id（无「不派」对方时为空数组）。
 * 与状态写入同一事务调用；事务回滚时提醒一并回滚。
 */
export async function generateClosureReminders(
  clues: ClueStore,
  generation: ClosureReminderGeneration,
): Promise<readonly string[]> {
  const targets = await clues.listClosureReminderTargets(generation.closedClueId);
  if (targets.length === 0) return [];
  const rows = targets.map((target) => ({
    id: generation.newId(),
    clueId: target.clueId,
    kind: generation.kind,
    otherClueId: target.otherClueId,
    createdAt: generation.createdAt,
  }));
  await clues.insertClosureReminders(rows);
  return rows.map((row) => row.id);
}
