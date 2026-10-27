// #239 改派纯规则：发起人资格、人数与资格（X14）、机构范围、回避决定引用、效力认定派生。
import { describe, expect, it } from 'vitest';

import {
  checkRecusalReference,
  checkReassignProposal,
  invalidMaterialIds,
  isMaterialEffectivenessConclusion,
  isReassignReasonCode,
  latestEffectivenessByMaterial,
  reassignInitiator,
  type HandlerCandidateFacts,
  type MaterialEffectivenessFact,
} from '../src/reassign/index.ts';

function candidate(partial: Partial<HandlerCandidateFacts> = {}): HandlerCandidateFacts {
  return {
    personnelId: partial.personnelId ?? 'p1',
    role: partial.role ?? 'main',
    exists: partial.exists ?? true,
    deactivated: partial.deactivated ?? false,
    holdsHandlerRole: partial.holdsHandlerRole ?? true,
    inHandlingOrgSubtree: partial.inHandlingOrgSubtree ?? true,
    qualified: partial.qualified ?? true,
  };
}

describe('#239 发起人资格', () => {
  const base = {
    actorRoles: [] as string[],
    actorOrgId: 'org-station',
    handlingOrgId: 'org-station',
    bothHandlersUnavailable: false,
  };

  it('主办或协办本人可发起', () => {
    expect(reassignInitiator({ ...base, actorIsHandler: true })).toBe('handler');
    expect(reassignInitiator({ ...base, actorIsHandler: true, bothHandlersUnavailable: true })).toBe('handler');
  });

  it('两人都可用时内勤不能发起', () => {
    expect(
      reassignInitiator({ ...base, actorIsHandler: false, actorRoles: ['内勤'], bothHandlersUnavailable: false }),
    ).toBeNull();
  });

  it('两人都停用或调离时，承办机构内勤可发起', () => {
    expect(
      reassignInitiator({ ...base, actorIsHandler: false, actorRoles: ['内勤'], bothHandlersUnavailable: true }),
    ).toBe('n5-clerk');
  });

  it('非承办机构的内勤不能发起', () => {
    expect(
      reassignInitiator({
        ...base,
        actorIsHandler: false,
        actorRoles: ['内勤'],
        actorOrgId: 'org-dept',
        bothHandlersUnavailable: true,
      }),
    ).toBeNull();
  });

  it('既非承办人又非内勤不能发起', () => {
    expect(
      reassignInitiator({ ...base, actorIsHandler: false, actorRoles: ['经办'], bothHandlersUnavailable: true }),
    ).toBeNull();
  });
});

describe('#239 拟任名单', () => {
  it('主办加协办两人且都合格时通过', () => {
    expect(
      checkReassignProposal([
        candidate(),
        candidate({ personnelId: 'p2', role: 'assist' }),
      ]),
    ).toBeNull();
  });

  it('没有主办：400', () => {
    const hit = checkReassignProposal([candidate({ role: 'assist' })]);
    expect(hit).toMatchObject({ code: 'missing-main', httpStatus: 400 });
  });

  it('名单重复：400', () => {
    const hit = checkReassignProposal([
      candidate(),
      candidate({ role: 'assist' }),
    ]);
    expect(hit).toMatchObject({ code: 'invalid-proposal', httpStatus: 400 });
  });

  it('换完少于两人：409 X14', () => {
    const hit = checkReassignProposal([candidate()]);
    expect(hit).toMatchObject({ code: 'X14', httpStatus: 409 });
  });

  it('新人缺执法资格：409 X14', () => {
    const hit = checkReassignProposal([
      candidate(),
      candidate({ personnelId: 'p2', role: 'assist', qualified: false }),
    ]);
    expect(hit).toMatchObject({ code: 'X14', httpStatus: 409 });
  });

  it('新人已停用或不持经办角色：409', () => {
    expect(
      checkReassignProposal([
        candidate(),
        candidate({ personnelId: 'p2', role: 'assist', deactivated: true }),
      ]),
    ).toMatchObject({ code: 'handler-not-eligible', httpStatus: 409 });
    expect(
      checkReassignProposal([
        candidate(),
        candidate({ personnelId: 'p2', role: 'assist', holdsHandlerRole: false }),
      ]),
    ).toMatchObject({ code: 'handler-not-eligible', httpStatus: 409 });
  });

  it('新经办不属承办机构或其下属：409', () => {
    const hit = checkReassignProposal([
      candidate(),
      candidate({ personnelId: 'p2', role: 'assist', inHandlingOrgSubtree: false }),
    ]);
    expect(hit).toMatchObject({ code: 'handler-out-of-scope', httpStatus: 409 });
  });
});

describe('#239 回避决定引用', () => {
  it('非回避原因不校验', () => {
    expect(
      checkRecusalReference({
        reasonCode: 'transfer',
        lineageId: null,
        decision: null,
        approverId: null,
      }),
    ).toBeNull();
  });

  it('回避原因未引用决定：409 原因', () => {
    expect(
      checkRecusalReference({
        reasonCode: 'recusal',
        lineageId: null,
        decision: null,
        approverId: null,
      }),
    ).toBe('conflict-decision-required');
  });

  it('引用的决定不是回避或未生效：409 原因', () => {
    expect(
      checkRecusalReference({
        reasonCode: 'recusal',
        lineageId: 'l1',
        decision: { conclusion: 'reject', deciderId: 'd1', effective: true },
        approverId: null,
      }),
    ).toBe('conflict-decision-not-effective');
    expect(
      checkRecusalReference({
        reasonCode: 'recusal',
        lineageId: 'l1',
        decision: { conclusion: 'recuse', deciderId: 'd1', effective: false },
        approverId: null,
      }),
    ).toBe('conflict-decision-not-effective');
  });

  it('批准人与决定人不一致：409 原因', () => {
    expect(
      checkRecusalReference({
        reasonCode: 'recusal',
        lineageId: 'l1',
        decision: { conclusion: 'recuse', deciderId: 'd1', effective: true },
        approverId: 'd2',
      }),
    ).toBe('conflict-decider-mismatch');
    expect(
      checkRecusalReference({
        reasonCode: 'recusal',
        lineageId: 'l1',
        decision: { conclusion: 'recuse', deciderId: 'd1', effective: true },
        approverId: 'd1',
      }),
    ).toBeNull();
  });
});

describe('#239 效力认定', () => {
  const at = (iso: string): Date => new Date(iso);
  const rows: MaterialEffectivenessFact[] = [
    { id: 'a', materialId: 'm1', conclusion: 'invalid', reason: '未入卷', determinedBy: 'p1', determinedAt: at('2026-10-27T00:00:00Z') },
    { id: 'b', materialId: 'm1', conclusion: 'valid', reason: '补正后有效', determinedBy: 'p1', determinedAt: at('2026-10-27T01:00:00Z') },
    { id: 'c', materialId: 'm2', conclusion: 'needs-correction', reason: '缺签名', determinedBy: 'p1', determinedAt: at('2026-10-27T00:00:00Z') },
    { id: 'd', materialId: 'm3', conclusion: 'invalid', reason: '来源不明', determinedBy: 'p1', determinedAt: at('2026-10-27T00:00:00Z') },
  ];

  it('每件材料取最新一次认定', () => {
    const latest = latestEffectivenessByMaterial(rows);
    expect(latest.get('m1')?.conclusion).toBe('valid');
    expect(latest.get('m2')?.conclusion).toBe('needs-correction');
  });

  it('只有最新结论为无效的材料进入无效清单', () => {
    expect(invalidMaterialIds(rows)).toEqual(['m3']);
  });

  it('关闭集校验', () => {
    expect(isReassignReasonCode('recusal')).toBe(true);
    expect(isReassignReasonCode('retire')).toBe(false);
    expect(isMaterialEffectivenessConclusion('needs-correction')).toBe(true);
    expect(isMaterialEffectivenessConclusion('unknown')).toBe(false);
  });
});