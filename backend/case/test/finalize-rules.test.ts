// #243 定型：归档审批正文、缺件阻断出口、T27 起点与终态写。
import { describe, expect, it } from 'vitest';

import {
  finalizeBlockOf,
  readFinalizeContent,
} from '../src/dossier/index.ts';
import { evaluateDossierCompleteness, requiredDossierItems } from '../src/dossier/index.ts';
import { decideTransition, findTransition, type TransitionSubject } from '../src/state-machine/index.ts';

function subject(partial: Partial<TransitionSubject> = {}): TransitionSubject {
  return {
    caseId: partial.caseId ?? 'c1',
    mainStatus: partial.mainStatus ?? null,
    stage: partial.stage ?? 'E02',
    stageEntrySeq: partial.stageEntrySeq ?? 1,
    suspended: partial.suspended ?? false,
    markers: partial.markers ?? [],
    clueStatus: partial.clueStatus ?? 'filed',
    handlingOrgId: partial.handlingOrgId ?? 'org-1',
    proposedHandlingOrgId: partial.proposedHandlingOrgId ?? null,
    actorRoles: partial.actorRoles ?? [],
    otherInFlightChains: partial.otherInFlightChains ?? 0,
    instances: partial.instances ?? [{ stage: 'E02', entrySeq: 1, status: 'drafting' }],
  };
}

const requirement = requiredDossierItems({
  reachedReview: false,
  reachedDelivery: false,
  terminationClosed: false,
  jurisdictionTransfer: false,
});

describe('#243 归档审批正文', () => {
  it('空正文合法；理由与说明去空白，空串视同未填', () => {
    expect(readFinalizeContent(null)).toEqual({ ok: true, content: { missingReason: null, note: null } });
    expect(readFinalizeContent({ missingReason: '  归档时补齐  ', note: ' ' })).toEqual({
      ok: true,
      content: { missingReason: '归档时补齐', note: null },
    });
  });

  it('非法正文拒绝', () => {
    expect(readFinalizeContent('x')).toMatchObject({ ok: false, hit: { reason: 'invalid-content' } });
    expect(readFinalizeContent({ missingReason: 1 })).toMatchObject({
      ok: false,
      hit: { reason: 'invalid-missing-reason' },
    });
    expect(readFinalizeContent({ note: 1 })).toMatchObject({ ok: false, hit: { reason: 'invalid-content' } });
  });
});

describe('#243 缺件阻断出口', () => {
  it('缺件优先报材料；只缺回证报回证；有理由不阻断', () => {
    const missingMaterial = evaluateDossierCompleteness({
      requirement,
      materials: [],
      receiptsComplete: false,
      missingReason: null,
    });
    expect(finalizeBlockOf(missingMaterial)).toMatchObject({ reason: 'materials-incomplete' });

    const missingReceipt = evaluateDossierCompleteness({
      requirement,
      materials: [1, 2, 4, 19].map((itemCode) => ({ itemCode, current: true, evidenceJson: null })),
      receiptsComplete: false,
      missingReason: null,
    });
    expect(finalizeBlockOf(missingReceipt)).toMatchObject({ reason: 'receipt-missing' });

    const approved = evaluateDossierCompleteness({
      requirement,
      materials: [],
      receiptsComplete: false,
      missingReason: '回证线下取得',
    });
    expect(finalizeBlockOf(approved)).toBeNull();
    expect(approved.conclusion).toBe('approved-missing');
  });
});

describe('#243 T27 定型', () => {
  it('终点是已定型；起点是已结案或已撤案', () => {
    const edge = findTransition('T27');
    expect(edge).toMatchObject({ enabled: true, to: { kind: 'main', status: 'finalized' } });
    for (const status of ['closed', 'withdrawn'] as const) {
      const decision = decideTransition({
        operation: { kind: 'transition', transitionId: 'T27' },
        subject: subject({ mainStatus: status }),
      });
      expect(decision.ok).toBe(true);
      if (!decision.ok) throw new Error('应成功');
      expect(decision.effects.mainStatus).toBe('finalized');
      expect(decision.effects.transitionCode).toBe('T27');
    }
  });

  it('未结案与已定型返回 invalid-state', () => {
    for (const status of ['in_progress', 'finalized'] as const) {
      const decision = decideTransition({
        operation: { kind: 'transition', transitionId: 'T27' },
        subject: subject({ mainStatus: status }),
      });
      expect(decision.ok).toBe(false);
      if (decision.ok || decision.level !== 'block') throw new Error('应为阻断');
      expect(decision.reason).toBe('invalid-state');
      expect(decision.httpStatus).toBe(409);
    }
  });

  it('待收尾在引擎里先命中 X03 警告；定型服务另行硬拦为 invalid-state', () => {
    const decision = decideTransition({
      operation: { kind: 'transition', transitionId: 'T27' },
      subject: subject({ mainStatus: 'terminated_pending' }),
    });
    expect(decision.ok).toBe(false);
    if (decision.ok || decision.level !== 'warn') throw new Error('引擎应为警告');
    expect(decision.reason).toBe('X03');
    expect(decision.httpStatus).toBe(200);
  });

  it('已有进行中的审批链时 X18', () => {
    const decision = decideTransition({
      operation: { kind: 'transition', transitionId: 'T27' },
      subject: subject({ mainStatus: 'closed', otherInFlightChains: 1 }),
    });
    expect(decision.ok).toBe(false);
    if (decision.ok || decision.level !== 'block') throw new Error('应为阻断');
    expect(decision.reason).toBe('X18');
  });
});