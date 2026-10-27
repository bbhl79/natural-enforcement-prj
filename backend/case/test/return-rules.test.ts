// #238 退回点与接收人。不碰数据库。
import { describe, expect, it } from 'vitest';

import {
  FILING_DRAFT_TARGET,
  RETURN_CODES,
  RETURN_REASONS,
  bothHandlersUnavailable,
  checkDocumentEdit,
  checkReceiver,
  hearingHasStarted,
  legalReviewAttributionOrgId,
  planReturn,
  returnTarget,
  signatureReusable,
  targetKeys,
  type HandlerAvailability,
  type ReceiverCandidate,
  type ReturnInstanceFact,
} from '../src/return/index.ts';

function keys(
  reason: string,
  stage: 'E02' | 'E03' | 'E04' | 'E09' | 'filing',
  context?: { readonly defectiveStage?: 'E04' | 'E05'; readonly earlierChainLevels?: readonly string[]; readonly inheritedCode?: string },
): readonly string[] {
  const listed = returnTarget(reason, stage, context);
  if (!listed.ok) throw new Error(`${reason} 应给出目标`);
  return targetKeys(listed.targets);
}
const HANDLERS: readonly HandlerAvailability[] = [
  { personnelId: 'main', role: 'main', deactivated: false, transferredAway: false },
  { personnelId: 'assist', role: 'assist', deactivated: false, transferredAway: false },
];

function handler(partial: Partial<ReceiverCandidate> = {}): ReceiverCandidate {
  return {
    personnelId: 'main',
    roles: ['经办'],
    handlerRole: 'main',
    deactivated: false,
    transferredAway: false,
    orgCoversCase: true,
    legalReviewAttributed: false,
    clerkOfHandlingOrg: false,
    ...partial,
  };
}

function clerk(): ReceiverCandidate {
  return handler({
    personnelId: 'clerk',
    roles: ['内勤'],
    handlerRole: null,
    orgCoversCase: true,
    clerkOfHandlingOrg: true,
  });
}

const INSTANCES: readonly ReturnInstanceFact[] = [
  { id: 'e02', stage: 'E02', entrySeq: 1 },
  { id: 'e03', stage: 'E03', entrySeq: 1 },
  { id: 'e04', stage: 'E04', entrySeq: 1 },
  { id: 'e09', stage: 'E09', entrySeq: 1 },
];

describe('退回原因目录', () => {
  it('R1–R10 十类，名称与是否回流按定案表', () => {
    expect(RETURN_CODES).toEqual(['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10']);
    expect(RETURN_REASONS.find((item) => item.code === 'R2')?.reflow).toBe(true);
    expect(RETURN_REASONS.find((item) => item.code === 'R8')?.incrementsEntrySeq).toBe(false);
    expect(RETURN_REASONS.find((item) => item.code === 'R9')?.incrementsEntrySeq).toBe(false);
    expect(RETURN_REASONS.find((item) => item.code === 'R3')?.reflow).toBe('external');
    expect(RETURN_REASONS.find((item) => item.code === 'R10')?.name).toBe('其他（须写明）');
  });
});

describe('returnTarget', () => {
  it('R1 审理开始前给终止调查后撤案，审理开始后给不予处罚', () => {
    expect(hearingHasStarted('E02')).toBe(false);
    expect(hearingHasStarted('filing')).toBe(false);
    expect(hearingHasStarted('E04')).toBe(true);
    expect(keys('R1', 'E02')).toEqual(['exit:withdraw-after-terminate']);
    expect(keys('R1', 'E04')).toEqual(['exit:no-penalty']);
    const before = returnTarget('R1', 'E03');
    const after = returnTarget('R1', 'E09');
    expect(before.ok && before.targets[0]).toMatchObject({ reflow: false, incrementEntrySeq: false });
    expect(after.ok && after.targets[0]).toMatchObject({ exit: 'no-penalty' });
  });

  it('R2 回 E02 且须重新提请审理；R4 回 E04 并留下告知有效性调用点', () => {
    const r2 = returnTarget('R2', 'E09');
    expect(r2.ok && r2.targets).toEqual([
      expect.objectContaining({
        key: 'stage:E02',
        reflow: true,
        incrementEntrySeq: true,
        rehearingRequired: true,
      }),
    ]);
    const r4 = returnTarget('R4', 'E09');
    expect(r4.ok && r4.noticeValidity).toBe('deferred');
    expect(r4.ok && targetKeys(r4.targets)).toEqual(['stage:E04']);
  });

  it('R3 不经本函数', () => {
    expect(returnTarget('R3', 'E04')).toEqual({ ok: false, reason: 'external-return' });
  });

  it('R5 回到有瑕疵的环节；未指出则集合为空', () => {
    const pointed = returnTarget('R5', 'E09', { defectiveStage: 'E04' });
    expect(pointed.ok && targetKeys(pointed.targets)).toEqual(['stage:E04']);
    const missing = returnTarget('R5', 'E09');
    expect(missing.ok && missing.targets).toEqual([]);
    const notice = returnTarget('R5', 'E09', { defectiveStage: 'E05' });
    expect(notice.ok && targetKeys(notice.targets)).toEqual(['stage:E05']);
  });

  it('R6 走移送出口；R7 撤销原告知并再进 E05', () => {
    const r6 = returnTarget('R6', 'E04');
    expect(r6.ok && r6.targets[0]).toMatchObject({ kind: 'exit', exit: 'transfer', reflow: false });
    const r7 = returnTarget('R7', 'E09');
    expect(r7.ok && r7.targets[0]).toMatchObject({
      key: 'stage:E05',
      revokeNotice: true,
      incrementEntrySeq: true,
    });
  });

  it('R8 只在 E09 回到拟制中；R9 回当前拟制或链内较早一级，都不加次序号', () => {
    const absent = returnTarget('R8', 'E02');
    expect(absent.ok ? absent.targets : []).toEqual([]);
    const r8 = returnTarget('R8', 'E09');
    expect(r8.ok && r8.noticeValidity).toBe('deferred');
    expect(r8.ok && r8.targets[0]).toMatchObject({ key: 'drafting:E09', incrementEntrySeq: false, reflow: false });
    const r9 = returnTarget('R9', 'E04', { earlierChainLevels: ['review'] });
    expect(r9.ok && targetKeys(r9.targets)).toEqual(['drafting:E04', 'chain:review']);
    expect(r9.ok && r9.targets.every((item) => item.incrementEntrySeq === false)).toBe(true);
    expect(keys('R9', 'filing')).toEqual([FILING_DRAFT_TARGET]);
  });

  it('R10 继承所选原因的退回点；不选或选 R3 都不给空目标冒充', () => {
    const inherited = returnTarget('R10', 'E09', { inheritedCode: 'R2' });
    expect(inherited.ok && inherited.inheritedCode).toBe('R2');
    expect(inherited.ok && targetKeys(inherited.targets)).toEqual(['stage:E02']);
    expect(returnTarget('R10', 'E02')).toEqual({ ok: false, reason: 'missing-return-target' });
    expect(returnTarget('R10', 'E02', { inheritedCode: 'R3' })).toEqual({ ok: false, reason: 'external-return' });
    expect(returnTarget('R10', 'E02', { inheritedCode: 'R10' })).toEqual({ ok: false, reason: 'missing-return-target' });
    expect(returnTarget('R0', 'E02')).toEqual({ ok: false, reason: 'invalid-reason' });
  });
});

describe('planReturn 不变式', () => {
  const base = {
    note: '补调查',
    currentStage: 'E09' as const,
    currentEntrySeq: 1,
    inheritedCode: null,
    defectiveStage: null,
    earlierChainLevels: [],
    instances: INSTANCES,
    invalidatedInstanceIds: [],
    receiver: handler(),
    handlers: HANDLERS,
  };

  it('R2 回 E02：次序号加 1，E04 及以后失效，E03 不失效，不碰材料', () => {
    const planned = planReturn({ ...base, reasonCode: 'R2', targetKey: 'stage:E02' });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.plan.nextEntrySeq).toBe(2);
    expect(planned.plan.pointer).toEqual({ stage: 'E02', entrySeq: 2 });
    expect(planned.plan.invalidateInstanceIds).toEqual(['e04', 'e09']);
    expect(planned.plan.rehearingRequired).toBe(true);
    expect(planned.plan.touchesMaterials).toBe(false);
    expect(planned.plan.exit).toBeNull();
  });

  it('R8、R9 链内退回不加次序号，也不失效下游', () => {
    const r8 = planReturn({ ...base, reasonCode: 'R8', targetKey: 'drafting:E09', currentStage: 'E09' });
    expect(r8.ok && r8.plan.nextEntrySeq).toBeNull();
    expect(r8.ok && r8.plan.pointer).toBeNull();
    expect(r8.ok && r8.plan.invalidateInstanceIds).toEqual([]);
    const r9 = planReturn({
      ...base,
      reasonCode: 'R9',
      note: '改文号',
      currentStage: 'E04',
      targetKey: 'drafting:E04',
    });
    expect(r9.ok && r9.plan.nextEntrySeq).toBeNull();
    expect(r9.ok && r9.plan.target.incrementEntrySeq).toBe(false);
  });

  it('目标不在集合内 409；E05、E10 未启用 409；不填原因 400；R10 不填说明或不选点 409', () => {
    expect(planReturn({ ...base, reasonCode: '', targetKey: 'stage:E02' }).ok).toBe(false);
    expect(planReturn({ ...base, reasonCode: '', targetKey: null })).toMatchObject({
      ok: false,
      reason: 'missing-return-reason',
      httpStatus: 400,
    });
    expect(planReturn({ ...base, reasonCode: 'R2', targetKey: 'stage:E04' })).toMatchObject({
      ok: false,
      reason: 'return-target-not-allowed',
      httpStatus: 409,
    });
    expect(planReturn({ ...base, reasonCode: 'R7', targetKey: 'stage:E05' })).toMatchObject({
      reason: 'transition-disabled',
      httpStatus: 409,
    });
    expect(
      planReturn({ ...base, reasonCode: 'R5', defectiveStage: 'E10', targetKey: 'stage:E10' }),
    ).toMatchObject({ reason: 'transition-disabled' });
    expect(planReturn({ ...base, reasonCode: 'R10', note: '', targetKey: 'stage:E02', inheritedCode: 'R2' })).toMatchObject({
      reason: 'missing-return-note',
      httpStatus: 409,
    });
    expect(planReturn({ ...base, reasonCode: 'R10', note: '其他', targetKey: null, inheritedCode: null })).toMatchObject({
      reason: 'missing-return-target',
    });
    expect(planReturn({ ...base, reasonCode: 'R3', targetKey: 'stage:E02' })).toMatchObject({
      reason: 'external-return',
    });
  });

  it('已失效的实例不重复列入', () => {
    const planned = planReturn({
      ...base,
      reasonCode: 'R2',
      targetKey: 'stage:E02',
      invalidatedInstanceIds: ['e04'],
    });
    expect(planned.ok && planned.plan.invalidateInstanceIds).toEqual(['e09']);
  });
});

describe('接收人', () => {
  const investigate = returnTarget('R2', 'E09');
  const inChain = returnTarget('R9', 'E04');
  if (!investigate.ok || !inChain.ok) throw new Error('样例目标应成功');
  const toInvestigation = investigate.targets[0]!;
  const toDraft = inChain.targets[0]!;

  it('回调查时只能是可用的主办或协办', () => {
    expect(checkReceiver(toInvestigation, handler(), HANDLERS)).toEqual({ ok: true, n5: false });
    expect(checkReceiver(toInvestigation, handler({ personnelId: 'assist', handlerRole: 'assist' }), HANDLERS)).toEqual({
      ok: true,
      n5: false,
    });
    expect(checkReceiver(toInvestigation, clerk(), HANDLERS).ok).toBe(false);
    expect(
      checkReceiver(
        toInvestigation,
        handler({ personnelId: 'legal', roles: ['法制审核'], handlerRole: null }),
        HANDLERS,
      ).ok,
    ).toBe(false);
  });

  it('任一主办或协办可用时不能指定内勤；两人都停用或调离时可以，且只到承办机构内勤', () => {
    const oneDown: readonly HandlerAvailability[] = [
      { personnelId: 'main', role: 'main', deactivated: true, transferredAway: false },
      { personnelId: 'assist', role: 'assist', deactivated: false, transferredAway: false },
    ];
    expect(bothHandlersUnavailable(oneDown)).toBe(false);
    expect(checkReceiver(toInvestigation, clerk(), oneDown).ok).toBe(false);

    const bothDown: readonly HandlerAvailability[] = [
      { personnelId: 'main', role: 'main', deactivated: true, transferredAway: false },
      { personnelId: 'assist', role: 'assist', deactivated: false, transferredAway: true },
    ];
    expect(bothHandlersUnavailable(bothDown)).toBe(true);
    expect(checkReceiver(toInvestigation, clerk(), bothDown)).toEqual({ ok: true, n5: true });
    expect(
      checkReceiver(
        toInvestigation,
        handler({ personnelId: 'boss', roles: ['行政审批'], handlerRole: null }),
        bothDown,
      ).ok,
    ).toBe(false);
    expect(
      checkReceiver(toInvestigation, handler({ personnelId: 'watch', roles: ['监督'], handlerRole: null }), bothDown).ok,
    ).toBe(false);
    expect(
      checkReceiver(
        toInvestigation,
        handler({ personnelId: 'root', roles: ['系统管理'], handlerRole: null }),
        bothDown,
      ).ok,
    ).toBe(false);
    expect(
      checkReceiver(
        toInvestigation,
        clerk(),
        [{ personnelId: 'main', role: 'main', deactivated: true, transferredAway: false }],
      ).ok,
    ).toBe(false);
  });

  it('非回调查仍不能指定内勤、行政审批、监督、系统管理', () => {
    expect(checkReceiver(toDraft, clerk(), HANDLERS).ok).toBe(false);
    expect(
      checkReceiver(toDraft, handler({ personnelId: 'boss', roles: ['行政审批'], handlerRole: null }), HANDLERS).ok,
    ).toBe(false);
  });

  it('法制审核按归属，不看数据范围；行政审核仍看覆盖', () => {
    const cityLegal = handler({
      personnelId: 'city-legal',
      roles: ['法制审核'],
      handlerRole: null,
      orgCoversCase: true,
      legalReviewAttributed: false,
      transferredAway: true,
    });
    expect(checkReceiver(toDraft, cityLegal, HANDLERS).ok).toBe(false);
    const districtLegal = handler({
      personnelId: 'district-legal',
      roles: ['法制审核'],
      handlerRole: null,
      orgCoversCase: false,
      legalReviewAttributed: true,
      transferredAway: true,
    });
    expect(checkReceiver(toDraft, districtLegal, HANDLERS)).toEqual({ ok: true, n5: false });
    const admin = handler({
      personnelId: 'admin',
      roles: ['行政审核'],
      handlerRole: null,
      orgCoversCase: true,
      legalReviewAttributed: false,
      transferredAway: true,
    });
    expect(checkReceiver(toDraft, admin, HANDLERS)).toEqual({ ok: true, n5: false });
    expect(checkReceiver(toDraft, { ...admin, orgCoversCase: false }, HANDLERS).ok).toBe(false);
    expect(checkReceiver(toInvestigation, districtLegal, HANDLERS).ok).toBe(false);
  });

  it('法制审核归属：市归市局，区或所归所在区分局', () => {
    const city = { id: 'hq', level: 'city' as const, parentId: null };
    const district = { id: 'dept', level: 'district' as const, parentId: 'hq' };
    const station = { id: 'station', level: 'station' as const, parentId: 'dept' };
    expect(legalReviewAttributionOrgId(city, null)).toBe('hq');
    expect(legalReviewAttributionOrgId(district, city)).toBe('dept');
    expect(legalReviewAttributionOrgId(station, district)).toBe('dept');
    expect(legalReviewAttributionOrgId(station, city)).toBeNull();
    expect(legalReviewAttributionOrgId(station, null)).toBeNull();
  });

  it('内勤编辑文书 403；本案承办人不受这条限制', () => {
    expect(checkDocumentEdit({ roles: ['内勤'], isCaseHandler: false })).toEqual({
      ok: false,
      httpStatus: 403,
      reason: 'clerk-cannot-edit',
    });
    expect(checkDocumentEdit({ roles: ['经办', '内勤'], isCaseHandler: true })).toEqual({ ok: true });
  });

  it('旧签字在实例失效后不能再用', () => {
    expect(signatureReusable('e04', ['e04'])).toBe(false);
    expect(signatureReusable('e02', ['e04'])).toBe(true);
  });
});
