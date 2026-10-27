// 把引擎效果写成环节实例与迁移历史（#235）。调用方已在同一事务里。

import type {
  CaseStore,
  TransitionEffects,
} from '@natural-enforcement/case';

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
