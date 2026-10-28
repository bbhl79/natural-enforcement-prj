// #240 审理纯规则：报告处理建议、意见去向、指定与签出守卫。不碰数据库。
import { describe, expect, it } from 'vitest';

import {
  FINE_COMPETITION_MESSAGE,
  MISSING_HANDLING_SUGGESTION_MESSAGE,
  REVIEW_OPINION_KINDS,
  allowsObjection,
  checkReviewSign,
  checkReviewerCandidate,
  isReviewOpinionKind,
  opinionDestination,
  readDesignationReason,
  readReviewObjectionContent,
  readReviewOpinionContent,
  readReviewReportContent,
  separationWarning,
} from '../src/review/index.ts';
import { LIMITATION_DISCOVERY_EXIT_V1 } from '../src/investigation/index.ts';
import { findRuleParameter } from '../src/state-machine/index.ts';

const ACTIVE = ['v1', 'v2'];

function penaltySuggestion(overrides: Record<string, unknown> = {}) {
  return {
    violationRecordId: 'v1',
    kind: 'penalty',
    penaltyCodes: ['fine'],
    fineAmount: 5000,
    discretionReason: '从轻',
    fineBases: ['土地管理法第77条'],
    comparisonReason: '',
    ...overrides,
  };
}

function report(suggestions: unknown[], reviewerId: unknown = null) {
  return { suggestions, reviewerId };
}

describe('#240 意见类型与去向', () => {
  it('六种意见类型齐全，补充调查与修改纠正都走 T09，修改纠正单独留痕', () => {
    expect(REVIEW_OPINION_KINDS).toEqual([
      'supplementary-investigation',
      'correction',
      'penalty',
      'no-penalty',
      'fact-not-established',
      'limitation-expired',
    ]);
    expect(isReviewOpinionKind('correction')).toBe(true);
    expect(isReviewOpinionKind('other')).toBe(false);
    expect(opinionDestination('supplementary-investigation').transitionId).toBe('T09');
    expect(opinionDestination('correction').transitionId).toBe('T09');
    expect(opinionDestination('correction').appliedInThisTicket).toBe(true);
    expect(opinionDestination('penalty').transitionId).toBe('T10');
    expect(opinionDestination('no-penalty').transitionId).toBe('T11');
    expect(opinionDestination('fact-not-established')).toMatchObject({
      transitionId: 'T12',
      outcomeCode: 'O2',
      outcomeLabel: '不予行政处罚',
      appliedInThisTicket: false,
    });
  });

  it('已过追诉时效的出口读 cfg.rule.limitation-discovery-exit.v1，不硬编码', () => {
    expect(opinionDestination('limitation-expired')).toMatchObject({
      transitionId: LIMITATION_DISCOVERY_EXIT_V1.afterHearing.transitionId,
      outcomeCode: 'O2',
      outcomeLabel: '不予行政处罚',
      appliedInThisTicket: false,
    });
    const configured = {
      ...LIMITATION_DISCOVERY_EXIT_V1,
      afterHearing: {
        outcomeCode: 'O9',
        outcomeLabel: '配置出口',
        transitionId: 'configured-exit',
        applyInThisTicket: false as const,
      },
    };
    expect(opinionDestination('limitation-expired', configured)).toMatchObject({
      transitionId: 'configured-exit',
      outcomeCode: 'O9',
      outcomeLabel: '配置出口',
    });
  });

  it('只有补充调查与修改纠正可提 T09a 异议', () => {
    expect(allowsObjection('supplementary-investigation')).toBe(true);
    expect(allowsObjection('correction')).toBe(true);
    expect(allowsObjection('penalty')).toBe(false);
    expect(allowsObjection('limitation-expired')).toBe(false);
  });
});

describe('#240 调查报告处理建议（T08 守卫）', () => {
  it('每条有效违法记录都要有处理建议；缺一条 409 并列出缺项', () => {
    const read = readReviewReportContent(report([penaltySuggestion()]), ACTIVE);
    expect(read.ok).toBe(false);
    if (read.ok) throw new Error('应拒绝');
    expect(read.hit.httpStatus).toBe(409);
    expect(read.hit.reason).toBe('missing-handling-suggestion');
    expect(read.hit.message).toBe(MISSING_HANDLING_SUGGESTION_MESSAGE);
    expect(read.hit.missingViolationIds).toEqual(['v2']);
  });

  it('非本案有效记录、重复建议、缺字段为 400', () => {
    const foreign = readReviewReportContent(
      report([penaltySuggestion({ violationRecordId: 'voided-1' }), { violationRecordId: 'v2', kind: 'no-penalty' }]),
      ACTIVE,
    );
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.hit.reason).toBe('invalid-violation-record');
    const duplicate = readReviewReportContent(
      report([penaltySuggestion(), penaltySuggestion(), { violationRecordId: 'v2', kind: 'no-penalty' }]),
      ACTIVE,
    );
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.hit.reason).toBe('duplicate-suggestion');
    const invalid = readReviewReportContent(
      report([{ violationRecordId: 'v1', kind: 'penalty', penaltyCodes: [], fineAmount: null }]),
      ACTIVE,
    );
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.hit.reason).toBe('invalid-suggestion');
  });

  it('罚款竞合（两条以上罚款依据）未写比对理由：409；写了：通过', () => {
    const suggestions = [
      penaltySuggestion({ fineBases: ['土地管理法第77条', '基本农田保护条例第33条'] }),
      { violationRecordId: 'v2', kind: 'fact-not-established' },
    ];
    const missing = readReviewReportContent(report(suggestions), ACTIVE);
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.hit.httpStatus).toBe(409);
      expect(missing.hit.message).toBe(FINE_COMPETITION_MESSAGE);
    }
    const filled = readReviewReportContent(
      report([penaltySuggestion({ fineBases: ['依据甲', '依据乙'], comparisonReason: '择一裁量' }), { violationRecordId: 'v2', kind: 'no-penalty' }]),
      ACTIVE,
    );
    expect(filled.ok).toBe(true);
    if (filled.ok) {
      expect(filled.content.suggestions[0]?.comparisonReason).toBe('择一裁量');
      expect(filled.content.suggestions[1]?.kind).toBe('no-penalty');
    }
  });

  it('拟制稿可暂存缺项与未填比对理由的建议；覆盖检查只在提交后执行', () => {
    const draft = readReviewReportContent(
      report([penaltySuggestion({ fineBases: ['依据甲', '依据乙'] })]),
      ACTIVE,
      { requireCoverage: false },
    );
    expect(draft.ok).toBe(true);
    if (draft.ok) expect(draft.content.suggestions).toHaveLength(1);
  });

  it('处理建议覆盖全部有效记录时通过，可带批准时的审理人', () => {
    const read = readReviewReportContent(
      report([penaltySuggestion(), { violationRecordId: 'v2', kind: 'no-penalty' }], 'p-review'),
      ACTIVE,
    );
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.content.reviewerId).toBe('p-review');
  });
});

describe('#240 审理意见正文', () => {
  it('类型与正文必填', () => {
    const bad = readReviewOpinionContent({ kind: 'other', content: '意见' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.hit.reason).toBe('invalid-kind');
    const empty = readReviewOpinionContent({ kind: 'correction', content: '  ' });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.hit.reason).toBe('missing-content');
    const ok = readReviewOpinionContent({ kind: 'correction', content: '重新调查' });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.content).toEqual({ kind: 'correction', content: '重新调查' });
  });
});

describe('#240 审理人候选与签出守卫', () => {
  it('持行政审核、任职覆盖、无回避通过；职能分离只警告', () => {
    expect(
      checkReviewerCandidate({ roles: ['行政审核'], orgCoversCase: true, hasActiveConflict: false, isHandlerEver: false }),
    ).toEqual({ ok: true, separationWarning: false });
    expect(
      checkReviewerCandidate({ roles: ['行政审核'], orgCoversCase: true, hasActiveConflict: false, isHandlerEver: true }),
    ).toEqual({ ok: true, separationWarning: true });
    expect(separationWarning()).toMatchObject({
      level: 'warn',
      code: 'REVIEW-SEPARATION',
      authority: 'normative',
    });
  });

  it('无行政审核、任职不覆盖、有回避声明：409', () => {
    const role = checkReviewerCandidate({ roles: ['经办'], orgCoversCase: true, hasActiveConflict: false, isHandlerEver: false });
    expect(role.ok).toBe(false);
    if (!role.ok) expect(role.hit.reason).toBe('reviewer-not-admin-reviewer');
    const org = checkReviewerCandidate({ roles: ['行政审核'], orgCoversCase: false, hasActiveConflict: false, isHandlerEver: false });
    expect(org.ok).toBe(false);
    if (!org.ok) expect(org.hit.reason).toBe('reviewer-org-not-covered');
    const conflict = checkReviewerCandidate({ roles: ['行政审核'], orgCoversCase: true, hasActiveConflict: true, isHandlerEver: false });
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.hit.reason).toBe('reviewer-conflict-active');
  });

  it('更换审理人理由必填；首次指定不要求', () => {
    const missing = readDesignationReason({ isReplacement: true, reason: ' ' });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.hit.reason).toBe('missing-reason');
    expect(readDesignationReason({ isReplacement: false, reason: '' }).ok).toBe(true);
    expect(readDesignationReason({ isReplacement: true, reason: '回避' })).toEqual({ ok: true, reason: '回避' });
  });

  it('签出：无行政审核 X23；未指定 409；非被指定 X32；承办人员 X22 警告', () => {
    const x23 = checkReviewSign({ roles: ['经办'], signerId: 'a', designatedReviewerId: 'a', isHandlerEver: false });
    expect(x23.block?.code).toBe('X23');
    const missing = checkReviewSign({ roles: ['行政审核'], signerId: 'a', designatedReviewerId: null, isHandlerEver: false });
    expect(missing.block).toMatchObject({ code: 'reviewer-not-designated', message: '尚未指定审理人' });
    const x32 = checkReviewSign({ roles: ['行政审核'], signerId: 'a', designatedReviewerId: 'b', isHandlerEver: false });
    expect(x32.block?.code).toBe('X32');
    const x22 = checkReviewSign({ roles: ['行政审核'], signerId: 'a', designatedReviewerId: 'a', isHandlerEver: true });
    expect(x22.block).toBeNull();
    expect(x22.warnings).toEqual([
      expect.objectContaining({ level: 'warn', code: 'X22', authority: 'normative' }),
    ]);
    const clean = checkReviewSign({ roles: ['行政审核'], signerId: 'a', designatedReviewerId: 'a', isHandlerEver: false });
    expect(clean).toEqual({ block: null, warnings: [] });
  });

  it('调查审理职能分离登记为独立规则，理由必填，不占 X 号', () => {
    expect(findRuleParameter('REVIEW-SEPARATION')).toMatchObject({ reasonRequired: true, level: 'warn' });
    expect(findRuleParameter('X22')).toMatchObject({ reasonRequired: false, level: 'warn' });
    // 不占 X 号：X22 仍是签出警告，X32／X33 仍是系统守卫。
    expect(findRuleParameter('X32')).toBeNull();
    expect(findRuleParameter('X33')).toBeNull();
  });
});

describe('#240 审理异议呈批正文', () => {
  it('异议理由必填，证据引用可为空数组', () => {
    const missing = readReviewObjectionContent({ note: ' ', evidenceRefs: [] });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.hit.reason).toBe('missing-note');
    const ok = readReviewObjectionContent({ note: '已补充证据', evidenceRefs: ['ev-1'] });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.content).toEqual({ note: '已补充证据', evidenceRefs: ['ev-1'] });
    const empty = readReviewObjectionContent({ note: '说明' });
    expect(empty.ok).toBe(true);
    if (empty.ok) expect(empty.content.evidenceRefs).toEqual([]);
  });
});