// #272 告知／听证纯规则：X07 自动∪人工、较大数额提示、X26 衔接、主持人资格、X28、期限窗口。
import { describe, expect, it } from 'vitest';

import {
  HEARING_AMOUNT_RULE_KEY,
  HEARING_AMOUNT_RULE_V1,
  HEARING_MANUAL_ITEMS,
  assessHearing,
  checkHearingHost,
  checkHearingReopen,
  hearingCountsAsHeld,
  hearingWindowState,
  mandatoryReviewHit,
  preReviewWarning,
  readNoticeContent,
  type HearingFacts,
} from '../src/notice/index.ts';

function facts(partial: Partial<HearingFacts> = {}): HearingFacts {
  return {
    penaltyCodes: ['fine'],
    fineAmount: 1000,
    confiscationValue: null,
    partyType: 'citizen',
    manualItems: [],
    notApplicableHearing: false,
    hearingNoticeAttached: false,
    ...partial,
  };
}

describe('#272 X07 命中：自动 ∪ 人工', () => {
  it('公民罚款达 5000 自动命中；未带听证告知 409', () => {
    const hit = assessHearing(facts({ fineAmount: 5000 }));
    expect(hit.autoHit).toBe(true);
    expect(hit.autoReasons).toContain('amount');
    expect(hit.required).toBe(true);
    expect(hit.block).toEqual({ code: 'X07', message: '应听证情形未发听证告知' });
  });

  it('法人或其他组织按 10 万元阈值；99999 不自动命中', () => {
    expect(assessHearing(facts({ partyType: 'legal-person', fineAmount: 99999 })).autoHit).toBe(false);
    expect(assessHearing(facts({ partyType: 'legal-person', fineAmount: 100000 })).autoHit).toBe(true);
  });

  it('非金额类触发罚种自动命中：降低资质等级、吊销许可证件、责令停产停业等', () => {
    for (const code of ['suspend-permit', 'lower-qualification', 'revoke-permit', 'order-stop-production', 'order-close', 'restrict-practice']) {
      const hit = assessHearing(facts({ penaltyCodes: [code], fineAmount: 0 }));
      expect(hit.autoHit, code).toBe(true);
      expect(hit.autoReasons).toContain('penalty-kind');
    }
  });

  it('人工勾选应听证：只能加，不能撤销系统自动命中', () => {
    const manual = assessHearing(facts({ fineAmount: 100, manualItems: ['cannot-structure'] }));
    expect(manual.autoHit).toBe(false);
    expect(manual.manualHit).toBe(true);
    expect(manual.required).toBe(true);

    const auto = assessHearing(facts({ fineAmount: 5000, manualItems: [] }));
    expect(auto.autoHit).toBe(true);
    expect(auto.required).toBe(true);
    const cannotUndo = assessHearing(facts({ fineAmount: 5000, manualItems: [], notApplicableHearing: true }));
    expect(cannotUndo.required).toBe(true);
    expect(cannotUndo.block).toEqual({ code: 'X07', message: '应听证情形不得勾选不适用听证' });
  });

  it('命中后勾「不适用听证」→ 409 口径；未命中时勾选允许且不阻断', () => {
    for (const input of [
      facts({ fineAmount: 5000, notApplicableHearing: true }),
      facts({ fineAmount: 0, manualItems: ['other-heavy'], notApplicableHearing: true }),
    ]) {
      expect(assessHearing(input).block?.code).toBe('X07');
    }
    const notApplicable = assessHearing(facts({ fineAmount: 100, notApplicableHearing: true }));
    expect(notApplicable.required).toBe(false);
    expect(notApplicable.block).toBeNull();
  });

  it('命中且带听证告知：无阻断', () => {
    expect(assessHearing(facts({ fineAmount: 5000, hearingNoticeAttached: true })).block).toBeNull();
  });
});

describe('#272 较大数额提示', () => {
  it('任一单项达阈值即提示；默认比对口径 any；提示键已登记', () => {
    const fine = assessHearing(facts({ fineAmount: 5000 }));
    expect(fine.amountReached).toBe(true);
    expect(fine.hints).toEqual([
      expect.objectContaining({ ruleKey: HEARING_AMOUNT_RULE_KEY }),
    ]);
    const confiscation = assessHearing(facts({ penaltyCodes: ['confiscation'], fineAmount: 0, confiscationValue: 5000 }));
    expect(confiscation.amountReached).toBe(true);
    expect(confiscation.autoHit).toBe(true);
  });

  it('比对口径可配置：sum 时单项未达相加达阈值才自动命中', () => {
    const rule = { ...HEARING_AMOUNT_RULE_V1, comparison: 'sum' as const };
    const split = assessHearing(facts({ fineAmount: 3000, confiscationValue: 2500 }), rule);
    expect(split.autoHit).toBe(true);
    expect(split.amountReached).toBe(false);
    expect(split.hints).toEqual([]);

    const onlyFine = assessHearing(facts({ fineAmount: 5000, confiscationValue: 0 }), rule);
    expect(onlyFine.autoHit).toBe(true);
    expect(onlyFine.amountReached).toBe(true);
    expect(onlyFine.hints).toHaveLength(1);
  });

  it('提示本身不替代 X07：未达阈值时无提示也无命中', () => {
    const below = assessHearing(facts({ fineAmount: 4999, hearingNoticeAttached: false }));
    expect(below.amountReached).toBe(false);
    expect(below.required).toBe(false);
    expect(below.block).toBeNull();
  });
});

describe('#272 X26 衔接', () => {
  it('命中必审且无告知前法审 → normative 警告；有通过引用 → 不警告', () => {
    expect(mandatoryReviewHit({ manual: true, hearingEntered: false })).toBe(true);
    expect(mandatoryReviewHit({ manual: false, hearingEntered: true })).toBe(true);
    const warning = preReviewWarning({ mandatoryReview: true, preReviewApproval: null });
    expect(warning).toEqual(
      expect.objectContaining({ level: 'warn', code: 'X26', authority: 'normative' }),
    );
    expect(preReviewWarning({ mandatoryReview: true, preReviewApproval: 'legal-1' })).toBeNull();
    expect(preReviewWarning({ mandatoryReview: false, preReviewApproval: null })).toBeNull();
  });
});

describe('#272 主持人资格', () => {
  it('曾任主办、协办（含已换下）不得主持；其他人可主持', () => {
    const refused = checkHearingHost({ handlerPersonnelIds: ['p1', 'p2'], candidateId: 'p1' });
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error('应拒绝');
    expect(refused.reason).toBe('hearing-host-is-handler');
    expect(checkHearingHost({ handlerPersonnelIds: ['p1'], candidateId: 'p9' }).ok).toBe(true);
  });
});

describe('#272 X28 与经过听证', () => {
  it('已终止的听证自动复开 → X28；无已终止听证 → invalid-state', () => {
    const x28 = checkHearingReopen({ hasTerminatedHearing: true });
    expect(x28.ok).toBe(false);
    if (x28.ok) throw new Error('应拒绝');
    expect(x28.code).toBe('X28');
    expect(checkHearingReopen({ hasTerminatedHearing: false }).code).toBe('invalid-state');
  });

  it('受理前撤回不算经过听证；受理后各类终结算', () => {
    expect(hearingCountsAsHeld('withdrawn-before-acceptance')).toBe(false);
    for (const kind of ['concluded', 'withdrawn', 'waived', 'no-show', 'terminated'] as const) {
      expect(hearingCountsAsHeld(kind), kind).toBe(true);
    }
  });
});

describe('#272 期限窗口', () => {
  it('届满日当天有效；次日关闭；缺日历转人工确认', () => {
    expect(hearingWindowState({ dueOn: '2026-11-05', needsManualConfirmation: false, today: '2026-11-05' })).toBe('open');
    expect(hearingWindowState({ dueOn: '2026-11-05', needsManualConfirmation: false, today: '2026-11-06' })).toBe('closed');
    expect(hearingWindowState({ dueOn: null, needsManualConfirmation: true, today: '2026-11-05' })).toBe('manual');
  });
});

describe('#272 告知正文校验', () => {
  const valid = {
    kind: 'penalty',
    partyType: 'citizen',
    hearingNoticeAttached: true,
    manualHearingItems: ['other-heavy', 'other-heavy'],
    notApplicableHearing: false,
    mandatoryReview: true,
    preReviewApproval: '',
    confiscationValue: 0,
    note: '告知书正文',
  };

  it('合法正文归一化：人工清单去重、空引用转 null', () => {
    const read = readNoticeContent(valid);
    expect(read.ok).toBe(true);
    if (!read.ok) throw new Error('应通过');
    expect(read.content.manualHearingItems).toEqual(['other-heavy']);
    expect(read.content.preReviewApproval).toBeNull();
  });

  it('非法枚举与缺说明返回 400', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ ...valid, kind: 'warning' }, 'invalid-kind'],
      [{ ...valid, partyType: 'group' }, 'invalid-party-type'],
      [{ ...valid, manualHearingItems: ['unknown'] }, 'invalid-hearing-selection'],
      [{ ...valid, note: ' ' }, 'missing-note'],
      [{ ...valid, confiscationValue: -1 }, 'invalid-confiscation-value'],
    ];
    for (const [input, reason] of cases) {
      const read = readNoticeContent(input);
      expect(read.ok, reason).toBe(false);
      if (read.ok) continue;
      expect(read.hit.reason).toBe(reason);
    }
  });

  it('人工清单只接受登记项', () => {
    expect(HEARING_MANUAL_ITEMS).toEqual(['other-heavy', 'law-required', 'cannot-structure']);
  });
});