// #248 有效性判据纯规则：A1–A6、B1b、B1a／B2／B5 差异分组、Q14、决定闸口。
import { describe, expect, it } from 'vitest';

import {
  aggravationSourceValid,
  assertValidityGate,
  assessValidity,
  decisionDigest,
  readDecisionSummary,
  type DecisionSummary,
  type DecisionViolation,
  type ValidityBaseline,
  type ValidityGateFacts,
} from '../src/validity/rules.ts';

function violation(overrides: Partial<DecisionViolation> = {}): DecisionViolation {
  return {
    violationRecordId: 'v1',
    kind: 'penalty',
    penaltyCodes: ['fine'],
    fineAmount: 5000,
    fineBases: ['土地管理法第77条'],
    basisText: '土地管理法第77条',
    factChange: null,
    ...overrides,
  };
}

function summary(overrides: Partial<DecisionSummary> = {}): DecisionSummary {
  return {
    parties: ['张三'],
    kind: 'penalty',
    violations: [violation()],
    confiscationValue: null,
    ...overrides,
  };
}

function baseline(overrides: Partial<ValidityBaseline> = {}): ValidityBaseline {
  return {
    noticeId: 'n1',
    entrySeq: 1,
    kind: 'penalty',
    partyType: 'citizen',
    hearingNoticeAttached: true,
    confiscationValue: null,
    summary: summary(),
    ...overrides,
  };
}

function codesOf(assessment: ReturnType<typeof assessValidity>): string[] {
  return assessment.hits.map((item) => item.code);
}

describe('#248 A 类：系统判失效', () => {
  it('A1 当事人变更或增加', () => {
    const result = assessValidity({ baseline: baseline(), current: summary({ parties: ['张三', '李四'] }) });
    expect(codesOf(result)).toEqual(['A1']);
    expect(result.groups[0]?.violationRecordId).toBeNull();
  });

  it('A2 违法记录增加', () => {
    const result = assessValidity({
      baseline: baseline(),
      current: summary({ violations: [violation(), violation({ violationRecordId: 'v2' })] }),
    });
    expect(codesOf(result)).toContain('A2');
  });

  it('A3 依据条款变更', () => {
    const result = assessValidity({
      baseline: baseline(),
      current: summary({ violations: [violation({ fineBases: ['土地管理法第78条'], basisText: '土地管理法第78条' })] }),
    });
    expect(codesOf(result)).toEqual(['A3']);
  });

  it('A4 罚种增加或加重', () => {
    const result = assessValidity({
      baseline: baseline(),
      current: summary({ violations: [violation({ penaltyCodes: ['fine', 'confiscation'] })] }),
    });
    expect(codesOf(result)).toContain('A4');
  });

  it('A5 罚款金额上调', () => {
    const result = assessValidity({
      baseline: baseline(),
      current: summary({ violations: [violation({ fineAmount: 8000 })] }),
    });
    expect(codesOf(result)).toEqual(['A5']);
  });

  it('A6 新拟决定命中应听证而原告知未告知听证', () => {
    const result = assessValidity({
      baseline: baseline({ hearingNoticeAttached: false }),
      current: summary({ violations: [violation({ penaltyCodes: ['revoke-permit'], fineAmount: null })] }),
    });
    expect(codesOf(result)).toContain('A6');
  });

  it('B1b 同一违法记录内事实收窄并入 A 类', () => {
    const result = assessValidity({
      baseline: baseline(),
      current: summary({ violations: [violation({ fineAmount: 3000, factChange: 'narrowed' })] }),
    });
    expect(codesOf(result)).toEqual(['B1b']);
  });

  it('理由已变化勾选后系统判失效', () => {
    const result = assessValidity({ baseline: baseline(), current: summary(), reasonChanged: true });
    expect(result.conclusion).toBe('invalid');
    expect(codesOf(result)).toEqual(['reason-changed']);
  });
});

describe('#248 B 类：差异清单按违法记录分组', () => {
  it('B1a 整条违法记录剔除：只产生差异，不产生 A 类命中', () => {
    const result = assessValidity({
      baseline: baseline({ summary: summary({ violations: [violation(), violation({ violationRecordId: 'v2' })] }) }),
      current: summary(),
    });
    expect(result.hits).toEqual([]);
    expect(result.differences.map((item) => [item.violationRecordId, item.field, item.change])).toEqual([
      ['v2', 'violation-record', 'removed'],
    ]);
  });

  it('B2 罚款金额下调：只产生差异，不产生 A 类命中', () => {
    const result = assessValidity({
      baseline: baseline(),
      current: summary({ violations: [violation({ fineAmount: 3000 })] }),
    });
    expect(result.hits).toEqual([]);
    expect(result.differences).toEqual([
      expect.objectContaining({ violationRecordId: 'v1', field: 'fine-amount', change: 'decreased' }),
    ]);
  });

  it('B5 只更正文字、格式、文号：摘要指纹不变，无差异', () => {
    const result = assessValidity({ baseline: baseline(), current: summary() });
    expect(result.hits).toEqual([]);
    expect(result.differences).toEqual([]);
    expect(result.conclusion).toBe('valid');
  });

  it('差异按违法记录分组，整体项排在最前', () => {
    const result = assessValidity({
      baseline: baseline({ summary: summary({ violations: [violation(), violation({ violationRecordId: 'v2' })] }) }),
      current: summary({
        parties: ['张三', '李四'],
        violations: [violation({ fineAmount: 3000 }), violation({ violationRecordId: 'v2', fineAmount: 3000 })],
      }),
    });
    expect(result.hits.map((item) => item.code)).toEqual(['A1']);
    expect(result.groups.map((group) => group.violationRecordId)).toEqual([null, 'v1', 'v2']);
  });
});

describe('#248 摘要与指纹', () => {
  it('读摘要时缺省当事人与没收等价值用调用方默认值', () => {
    const read = readDecisionSummary(
      { violations: [{ violationRecordId: 'v1', kind: 'penalty', penaltyCodes: ['fine'], fineAmount: 100, basisText: '甲' }] },
      { parties: ['张三'], confiscationValue: 20 },
    );
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.summary.parties).toEqual(['张三']);
      expect(read.summary.confiscationValue).toBe(20);
      expect(read.summary.violations[0]?.fineBases).toEqual([]);
    }
  });

  it('摘要含不合规违法记录时拒绝，不把读不出差异当成没有差异', () => {
    expect(readDecisionSummary({ violations: [{ violationRecordId: '' }] }, { parties: [], confiscationValue: null }).ok).toBe(false);
    expect(readDecisionSummary({}, { parties: [], confiscationValue: null }).ok).toBe(false);
    expect(readDecisionSummary({ violations: [{ violationRecordId: 'v1', kind: 'penalty', fineAmount: -1 }] }, { parties: [], confiscationValue: null }).ok).toBe(false);
  });

  it('指纹与数组顺序无关，内容变化则变化', () => {
    const first = decisionDigest(summary({ parties: ['李四', '张三'], violations: [violation({ penaltyCodes: ['fine', 'confiscation'] })] }));
    const second = decisionDigest(summary({ parties: ['张三', '李四'], violations: [violation({ penaltyCodes: ['confiscation', 'fine'] })] }));
    expect(first).toBe(second);
    expect(decisionDigest(summary({ violations: [violation({ fineAmount: 8000 })] }))).not.toBe(first);
  });
});

describe('#248 Q14 加重来源', () => {
  const later = new Date('2026-10-29T10:00:00.000Z');
  const earlier = new Date('2026-10-28T10:00:00.000Z');

  it('回流取得的新事实、新证据：须晚于最近一次陈述申辩', () => {
    expect(
      aggravationSourceValid({
        sourceKind: 'reflow-new-evidence',
        reference: { reasonCode: 'R2', inheritedCode: null, reflow: true, createdAt: later },
        afterAt: earlier,
      }),
    ).toBe(true);
    expect(
      aggravationSourceValid({
        sourceKind: 'reflow-new-evidence',
        reference: { reasonCode: 'R2', inheritedCode: null, reflow: true, createdAt: earlier },
        afterAt: later,
      }),
    ).toBe(false);
  });

  it('R4 定性或法律适用纠正：含 R10 继承 R4；其他原因不算', () => {
    const afterAt = earlier;
    expect(
      aggravationSourceValid({
        sourceKind: 'r4-qualification-correction',
        reference: { reasonCode: 'R4', inheritedCode: null, reflow: true, createdAt: later },
        afterAt,
      }),
    ).toBe(true);
    expect(
      aggravationSourceValid({
        sourceKind: 'r4-qualification-correction',
        reference: { reasonCode: 'R10', inheritedCode: 'R4', reflow: true, createdAt: later },
        afterAt,
      }),
    ).toBe(true);
    expect(
      aggravationSourceValid({
        sourceKind: 'r4-qualification-correction',
        reference: { reasonCode: 'R8', inheritedCode: null, reflow: false, createdAt: later },
        afterAt,
      }),
    ).toBe(false);
    expect(aggravationSourceValid({ sourceKind: 'r4-qualification-correction', reference: null, afterAt })).toBe(false);
  });
});

function gateFacts(overrides: Partial<ValidityGateFacts> = {}): ValidityGateFacts {
  return {
    noticeExists: true,
    baselinePresent: true,
    currentPresent: true,
    hits: [],
    differences: [],
    confirmation: null,
    q14: [],
    ...overrides,
  };
}

describe('#248 决定呈批闸口', () => {
  it('未发告知的案件不适用有效性判据', () => {
    expect(assertValidityGate(gateFacts({ noticeExists: false, baselinePresent: false }))).toEqual({ ok: true });
  });

  it('缺少送达基线或当前摘要：阻断', () => {
    expect(assertValidityGate(gateFacts({ baselinePresent: false }))).toMatchObject({ ok: false, block: { code: 'validity-baseline-missing' } });
    expect(assertValidityGate(gateFacts({ currentPresent: false }))).toMatchObject({ ok: false, block: { code: 'validity-summary-missing' } });
  });

  it('A 类命中：409 阻断，不因确认键放行', () => {
    const result = assertValidityGate(
      gateFacts({
        hits: [{ code: 'A5', violationRecordId: 'v1', message: '罚款金额上调' }],
        confirmation: { conclusion: 'valid', digestMatches: true, reviewedPass: true, reasonChanged: false },
      }),
    );
    expect(result).toMatchObject({ ok: false, block: { code: 'validity-invalid' } });
  });

  it('B 类差异无确认：阻断；有确认但未复核：阻断', () => {
    const differences = [{ violationRecordId: 'v2', field: 'violation-record', change: 'removed', before: 'v2', after: null }] as const;
    expect(assertValidityGate(gateFacts({ differences }))).toMatchObject({
      ok: false,
      block: { code: 'validity-b-confirmation-required' },
    });
    expect(
      assertValidityGate(
        gateFacts({
          differences,
          confirmation: { conclusion: 'valid', digestMatches: true, reviewedPass: false, reasonChanged: false },
        }),
      ),
    ).toMatchObject({ ok: false, block: { code: 'validity-review-required' } });
  });

  it('B 类差异有确认且覆盖并经复核：放行；摘要不覆盖则阻断', () => {
    const differences = [{ violationRecordId: 'v1', field: 'fine-amount', change: 'decreased', before: 5000, after: 3000 }] as const;
    expect(
      assertValidityGate(
        gateFacts({
          differences,
          confirmation: { conclusion: 'valid', digestMatches: true, reviewedPass: true, reasonChanged: false },
        }),
      ),
    ).toEqual({ ok: true });
    expect(
      assertValidityGate(
        gateFacts({
          differences,
          confirmation: { conclusion: 'valid', digestMatches: false, reviewedPass: true, reasonChanged: false },
        }),
      ),
    ).toMatchObject({ ok: false, block: { code: 'validity-b-confirmation-stale' } });
  });

  it('确认结论失效或勾选理由已变化：阻断', () => {
    expect(
      assertValidityGate(
        gateFacts({ confirmation: { conclusion: 'invalid', digestMatches: true, reviewedPass: true, reasonChanged: false } }),
      ),
    ).toMatchObject({ ok: false, block: { code: 'validity-invalid-confirmed' } });
    expect(
      assertValidityGate(
        gateFacts({ confirmation: { conclusion: 'valid', digestMatches: true, reviewedPass: true, reasonChanged: true } }),
      ),
    ).toMatchObject({ ok: false, block: { code: 'validity-invalid' } });
  });

  it('Q14 适用但无来源：阻断；来源已填：放行', () => {
    const q14 = [{ noticeId: 'n1', hitCodes: ['A5'] as const, satisfied: false }];
    expect(assertValidityGate(gateFacts({ q14 }))).toMatchObject({ ok: false, block: { code: 'Q14' } });
    expect(assertValidityGate(gateFacts({ q14: [{ ...q14[0]!, satisfied: true }] }))).toEqual({ ok: true });
  });
});