// 用途：把案件状态引擎产生的效果落库为环节实例与迁移历史。
// 把引擎效果写成环节实例与迁移历史（#235）。调用方已在同一事务里。

import type {
  CaseStore,
  TransitionEffects,
} from '@natural-enforcement/case';

/**
 * 在同一事务内追加环节实例与迁移历史行；无迁移码时直接返回 true。
 * 有实例但 caseId 为空、或任一实例插入冲突时返回 false，由调用方决定事务去留。
 * 调用方：backend/server/src 下经状态引擎的处理服务，例如 case-state.service.ts、case-filing.service.ts。
 */
export async function persistTransitionEffects(
  cases: CaseStore,
  input: {
    readonly effects: TransitionEffects;
    readonly caseId: string | null;
    readonly clueId: string | null;
    readonly actorId: string;
    readonly at: Date;
    readonly fromJson: string;
    readonly toJson: string;
    readonly newId: () => string;
  },
): Promise<boolean> {
  const code = input.effects.transitionCode;
  if (!code) return true;
  if (input.effects.instances.length > 0 && !input.caseId) return false;
  for (const instance of input.effects.instances) {
    const inserted = await cases.appendStageInstance({
      id: input.newId(),
      caseId: input.caseId as string,
      stage: instance.stage,
      entrySeq: instance.entrySeq,
      status: instance.status,
      enteredAt: input.at,
      enteredBy: input.actorId,
      transitionCode: instance.transitionCode,
    });
    if (!inserted) return false;
  }
  await cases.appendTransition({
    id: input.newId(),
    caseId: input.caseId,
    clueId: input.clueId,
    transitionCode: code,
    actorId: input.actorId,
    fromJson: input.fromJson,
    toJson: input.toJson,
    createdAt: input.at,
  });
  return true;
}
