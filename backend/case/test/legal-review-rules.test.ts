// #269 法制审核与集体讨论纯规则：必审清单、接收人与负责人、三去向、闸口、讨论标准。
import { describe, expect, it } from 'vitest';

import {
  COLLECTIVE_DISCUSSION_CRITERIA,
  LEGAL_REVIEW_LIST_ID,
  LEGAL_REVIEW_LIST_VERSION,
  MANDATORY_REVIEW_PENALTY_CODES,
  assertDecisionGate,
  assertNoticeGate,
  assessMandatoryReview,
  checkDiscussionReference,
  checkLegalReviewHead,
  checkLegalReviewReceiver,
  isCollectiveDiscussionCriterion,
  isManualReviewItemCode,
  legalQualificationHint,
  readDiscussionMarkContent,
  readDiscussionRecordContent,
  readLegalReviewOpinionContent,
  samePersonWarning,
  summaryCoversDecision,
} from '../src/index.ts';

function facts(overrides: Record<string, unknown> = {}) {
  return {
    decisionKind: 'penalty',
    hearingHeld: false,
    hearingEntered: false,
    penaltyCodes: ['fine'],
    criminalTransfer: false,
    manualItems: [],
    ...overrides,
  } as Parameters<typeof assessMandatoryReview>[0];
}

describe('#269 必审清单判定', () => {
  it('拟处罚、罚款 5000 元、无听证：不必审', () => {
    const result = assessMandatoryReview(facts());
    expect(result).toMatchObject({
      required: false,
      excluded: false,
      autoReasons: [],
      manualItems: [],
      listId: LEGAL_REVIEW_LIST_ID,
      listVersion: LEGAL_REVIEW_LIST_VERSION,
      listLevel: 'city',
    });
  });

  it('自动命中：实际举行过听证、已受理或已排期、涉刑移送', () => {
    expect(assessMandatoryReview(facts({ hearingHeld: true })).autoReasons).toEqual(['hearing-held']);
    expect(assessMandatoryReview(facts({ hearingEntered: true })).autoReasons).toEqual(['hearing-entered']);
    expect(assessMandatoryReview(facts({ criminalTransfer: true })).autoReasons).toEqual(['criminal-transfer']);
  });

  it('自动命中：拟处罚种类含清单第 5 项列举种类；只认列举代码', () => {
    for (const row of MANDATORY_REVIEW_PENALTY_CODES) {
      const result = assessMandatoryReview(facts({ penaltyCodes: [row.code] }));
      expect(result.required).toBe(true);
      expect(result.autoReasons).toContain('penalty-item-5');
    }
    const extended = assessMandatoryReview(facts({ penaltyCodes: ['fine', 'revoke-permit'] }));
    expect(extended.required).toBe(false);
  });

  it('人工勾选：清单第 1、3、4、6 项与条例第 37 条（三）任一即必审', () => {
    for (const item of [
      'major-public-interest',
      'major-social-impact',
      'complex-multiple-relations',
      'law-requires',
      'material-rights',
    ]) {
      expect(isManualReviewItemCode(item)).toBe(true);
      const result = assessMandatoryReview(facts({ manualItems: [item] }));
      expect(result.required).toBe(true);
      expect(result.manualItems).toEqual([item]);
    }
    expect(assessMandatoryReview(facts({ manualItems: ['not-an-item'] })).required).toBe(false);
  });

  it('拟不予处罚只命中第 1–4 项：只收第 1、3、4 项人工勾选', () => {
    expect(assessMandatoryReview(facts({ decisionKind: 'no-penalty', manualItems: ['major-public-interest'] })).required).toBe(true);
    expect(assessMandatoryReview(facts({ decisionKind: 'no-penalty', manualItems: ['law-requires'] })).required).toBe(false);
    expect(assessMandatoryReview(facts({ decisionKind: 'no-penalty', manualItems: ['material-rights'] })).required).toBe(false);
    expect(assessMandatoryReview(facts({ decisionKind: 'no-penalty', hearingEntered: true })).required).toBe(true);
  });

  it('不必审情形：立案、不予立案、撤案、管辖移送、中止、终止、结案、党纪政务移送', () => {
    for (const kind of [
      'filing',
      'no-filing',
      'withdrawal',
      'jurisdiction-transfer',
      'suspension',
      'termination',
      'closure',
      'party-discipline-transfer',
    ]) {
      const result = assessMandatoryReview(facts({ decisionKind: kind, hearingHeld: true, manualItems: ['major-public-interest'] }));
      expect(result.excluded).toBe(true);
      expect(result.required).toBe(false);
    }
  });

  it('区分局覆盖清单时记录所用清单与版本', () => {
    const result = assessMandatoryReview(facts(), {
      listId: 'cfg.rule.legal-review-list.district-a.v1',
      listVersion: '2026-01-01',
      listLevel: 'district',
    });
    expect(result).toMatchObject({
      listId: 'cfg.rule.legal-review-list.district-a.v1',
      listVersion: '2026-01-01',
      listLevel: 'district',
    });
  });
});

describe('#269 接收人与负责人', () => {
  const receiver = (overrides: Record<string, unknown> = {}) =>
    checkLegalReviewReceiver({
      roles: ['法制审核'],
      attributedOrgMatches: true,
      isHandlerEver: false,
      hasActiveConflict: false,
      deactivated: false,
      ...overrides,
    } as Parameters<typeof checkLegalReviewReceiver>[0]);

  it('合格接收人', () => {
    expect(receiver()).toEqual({ ok: true });
  });

  it('逐条拒绝：非法制审核、停用、非归属、承办人员、有利害关系', () => {
    expect(receiver({ roles: ['行政审核'] })).toMatchObject({ ok: false, reason: 'receiver-not-legal-reviewer' });
    expect(receiver({ deactivated: true })).toMatchObject({ ok: false, reason: 'receiver-deactivated' });
    expect(receiver({ attributedOrgMatches: false })).toMatchObject({ ok: false, reason: 'receiver-org-not-attributed' });
    expect(receiver({ isHandlerEver: true })).toMatchObject({ ok: false, reason: 'receiver-is-handler' });
    expect(receiver({ hasActiveConflict: true })).toMatchObject({ ok: false, reason: 'receiver-conflict-active' });
  });

  it('法制审核负责人：持行政审核、带岗位标记、任职在归属那一级', () => {
    const head = (overrides: Record<string, unknown> = {}) =>
      checkLegalReviewHead({
        roles: ['行政审核'],
        posts: ['legal-review-lead'],
        attributedOrgMatches: true,
        deactivated: false,
        ...overrides,
      } as Parameters<typeof checkLegalReviewHead>[0]);
    expect(head()).toEqual({ ok: true });
    expect(head({ roles: ['法制审核'] })).toMatchObject({ ok: false, reason: 'head-not-admin-reviewer' });
    expect(head({ posts: [] })).toMatchObject({ ok: false, reason: 'head-post-marker-missing' });
    expect(head({ attributedOrgMatches: false })).toMatchObject({ ok: false, reason: 'head-org-not-attributed' });
  });
});

describe('#269 法审意见三去向', () => {
  it('通过时不填去向；不通过时去向必填', () => {
    expect(readLegalReviewOpinionContent({ conclusion: 'pass', content: '同意' })).toEqual({
      ok: true,
      content: { conclusion: 'pass', failRoute: null, content: '同意', discussionRecordId: null },
    });
    expect(readLegalReviewOpinionContent({ conclusion: 'fail', content: '不同意' })).toMatchObject({
      ok: false,
      hit: { reason: 'missing-fail-route' },
    });
    expect(
      readLegalReviewOpinionContent({ conclusion: 'fail', content: '不同意', failRoute: 'accept-revise' }),
    ).toMatchObject({ ok: true, content: { failRoute: 'accept-revise' } });
    expect(
      readLegalReviewOpinionContent({ conclusion: 'fail', content: '不同意', failRoute: 'collective-discussion' }),
    ).toMatchObject({ ok: true, content: { failRoute: 'collective-discussion' } });
    expect(readLegalReviewOpinionContent({ conclusion: 'pass', content: '同意', failRoute: 'accept-revise' })).toMatchObject({
      ok: false,
      hit: { reason: 'invalid-fail-route' },
    });
  });

  it('讨论记录引用：属本案、目的含统一法制审核意见、晚于不通过定稿', () => {
    const record = {
      id: 'R1',
      caseId: 'C1',
      purposes: ['unify-legal-opinion'],
      createdAt: new Date('2026-10-29T10:00:00Z'),
    };
    expect(
      checkDiscussionReference({ record, caseId: 'C1', latestFailAt: new Date('2026-10-29T09:00:00Z') }),
    ).toEqual({ ok: true });
    expect(checkDiscussionReference({ record: null, caseId: 'C1', latestFailAt: null })).toMatchObject({
      reason: 'discussion-record-not-found',
    });
    expect(checkDiscussionReference({ record, caseId: 'C2', latestFailAt: null })).toMatchObject({
      reason: 'discussion-record-not-in-case',
    });
    expect(
      checkDiscussionReference({ record: { ...record, purposes: ['penalty-decision'] }, caseId: 'C1', latestFailAt: null }),
    ).toMatchObject({ reason: 'discussion-purpose-mismatch' });
    expect(
      checkDiscussionReference({ record, caseId: 'C1', latestFailAt: new Date('2026-10-29T10:00:00Z') }),
    ).toMatchObject({ reason: 'discussion-record-too-early' });
  });
});

describe('#269 摘要覆盖与闸口', () => {
  it('摘要覆盖只认同一次冻结', () => {
    expect(summaryCoversDecision({ reviewedFrozenDecisionId: 'F1', currentFrozenDecisionId: 'F1' })).toBe(true);
    expect(summaryCoversDecision({ reviewedFrozenDecisionId: 'F1', currentFrozenDecisionId: 'F2' })).toBe(false);
    expect(summaryCoversDecision({ reviewedFrozenDecisionId: null, currentFrozenDecisionId: 'F2' })).toBe(false);
  });

  it('X26 告知前闸口：命中必审且无引用 → 警告；通过且覆盖 → 放行', () => {
    expect(assertNoticeGate({ mandatory: false, preReviewApproval: null, coverage: 'unknown' })).toBeNull();
    expect(assertNoticeGate({ mandatory: true, preReviewApproval: null, coverage: 'unknown' })).toMatchObject({
      level: 'warn',
      code: 'X26',
      authority: 'normative',
    });
    expect(assertNoticeGate({ mandatory: true, preReviewApproval: 'F1', coverage: 'covered' })).toBeNull();
    expect(assertNoticeGate({ mandatory: true, preReviewApproval: 'F1', coverage: 'not-covered' })).toMatchObject({
      code: 'X26',
    });
    // 外部引用沿用 #272 口径，不另告警。
    expect(assertNoticeGate({ mandatory: true, preReviewApproval: 'LEGACY', coverage: 'unknown' })).toBeNull();
  });

  it('决定闸口顺序：X27 → X08 → X09', () => {
    const base = {
      mandatory: false,
      latestConclusion: null,
      latestPassCovered: false,
      hearingEntered: false,
      latestHearingEntryAt: null,
      latestPassAt: null,
      discussionRequired: false,
      discussionSatisfied: true,
    };
    expect(assertDecisionGate(base)).toEqual({ ok: true });
    expect(
      assertDecisionGate({
        ...base,
        hearingEntered: true,
        latestHearingEntryAt: new Date('2026-10-29T09:00:00Z'),
      }),
    ).toMatchObject({ ok: false, block: { code: 'X27' } });
    expect(
      assertDecisionGate({
        ...base,
        mandatory: true,
      }),
    ).toMatchObject({ ok: false, block: { code: 'X08' } });
    expect(
      assertDecisionGate({
        ...base,
        discussionRequired: true,
        discussionSatisfied: false,
      }),
    ).toMatchObject({ ok: false, block: { code: 'X09' } });
    expect(
      assertDecisionGate({
        ...base,
        hearingEntered: true,
        latestHearingEntryAt: new Date('2026-10-29T09:00:00Z'),
        latestConclusion: 'pass',
        latestPassAt: new Date('2026-10-29T10:00:00Z'),
        latestPassCovered: true,
        mandatory: true,
        discussionRequired: true,
        discussionSatisfied: true,
      }),
    ).toEqual({ ok: true });
  });

  it('听证后再审：最近一次结论为不通过时不算已再审', () => {
    expect(
      assertDecisionGate({
        mandatory: true,
        latestConclusion: 'fail',
        latestPassCovered: false,
        hearingEntered: true,
        latestHearingEntryAt: new Date('2026-10-29T09:00:00Z'),
        latestPassAt: new Date('2026-10-29T10:00:00Z'),
        discussionRequired: false,
        discussionSatisfied: true,
      }),
    ).toMatchObject({ ok: false, block: { code: 'X27' } });
  });
});

describe('#269 集体讨论与提示', () => {
  it('四种情形＋情节复杂或重大违法行为在清单内', () => {
    expect(COLLECTIVE_DISCUSSION_CRITERIA.map((row) => row.code)).toEqual([
      'mixed-lenient-severe',
      'not-in-benchmark',
      'no-illegal-gains',
      'other-collective',
      'complex-or-major',
    ]);
    expect(isCollectiveDiscussionCriterion('complex-or-major')).toBe(true);
    expect(isCollectiveDiscussionCriterion('unknown')).toBe(false);
  });

  it('触发勾选：至少一项且理由必填', () => {
    expect(readDiscussionMarkContent({ criteriaCodes: ['complex-or-major'], reason: '案情复杂' })).toMatchObject({
      ok: true,
      content: { criteriaCodes: ['complex-or-major'] },
    });
    expect(readDiscussionMarkContent({ criteriaCodes: [], reason: '案情复杂' })).toMatchObject({
      ok: false,
      hit: { reason: 'missing-criteria' },
    });
    expect(readDiscussionMarkContent({ criteriaCodes: ['complex-or-major'] })).toMatchObject({
      ok: false,
      hit: { reason: 'missing-reason' },
    });
  });

  it('讨论记录：目的至少一项、内容必填', () => {
    expect(
      readDiscussionRecordContent({
        purposes: ['unify-legal-opinion'],
        criteriaCodes: ['complex-or-major'],
        note: '讨论结论',
      }),
    ).toMatchObject({ ok: true, content: { purposes: ['unify-legal-opinion'] } });
    expect(readDiscussionRecordContent({ purposes: [], note: '结论' })).toMatchObject({
      ok: false,
      hit: { reason: 'missing-purpose' },
    });
    expect(readDiscussionRecordContent({ purposes: ['penalty-decision'] })).toMatchObject({
      ok: false,
      hit: { reason: 'missing-note' },
    });
  });

  it('审理人＝法审人：警告不阻断；资格未登记：提示不阻断', () => {
    expect(samePersonWarning(false)).toBeNull();
    expect(samePersonWarning(true)).toMatchObject({
      level: 'warn',
      code: 'LEGAL-SAME-PERSON',
      authority: 'normative',
    });
    expect(legalQualificationHint(true)).toBeNull();
    expect(legalQualificationHint(null)).toMatchObject({ level: 'hint', code: 'LEGAL-QUALIFICATION' });
  });
});