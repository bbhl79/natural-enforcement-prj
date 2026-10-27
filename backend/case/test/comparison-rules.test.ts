// #271 新旧比对最小版：人工比对、提交检查、批准新鲜度、Q31 警告、Q32 提示。
// 系统不自动判「较轻」；26 号答复与法工办发〔2012〕20 号意见不写入依据表。
// 调查报告呈批不调用比对检查（源码级断言 + 集成夹具体现在 case-comparison.test.ts）。

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { DOCUMENTS } from '@natural-enforcement/geo-dict';

import {
  COMPARISON_MISSING_MESSAGE,
  COMPARISON_STALE_MESSAGE,
  COMPARISON_STALE_OUTLET,
  EFFECTIVE_DAY_ATTRIBUTION_V1,
  Q31_OUTLET,
  Q32_PROMPT,
  Q32_RULE_KEY,
  assessComparisonFreshness,
  assessDecisionSubmission,
  confirmationGap,
  findRuleParameter,
  latestJudgments,
  q32Hints,
  readComparisonJudgment,
  type ComparisonBasis,
  type ComparisonBenchmark,
  type ComparisonFreshnessInput,
  type ComparisonJudgment,
  type ComparisonJudgmentEntry,
  type ComparisonJudgmentRef,
  type RawComparisonJudgment,
} from '../src/index.ts';

function basis(overrides: Partial<ComparisonBasis> = {}): ComparisonBasis {
  return {
    clause: 'doc_019 第 21 条',
    version: 'doc_019@2021-09-01',
    effectiveFrom: '2021-09-01',
    expiresOn: null,
    ...overrides,
  };
}

function benchmark(overrides: Partial<ComparisonBenchmark> = {}): ComparisonBenchmark {
  return {
    clause: 'doc_025 附件 4',
    version: '粤自然资规字〔2022〕2号',
    validUntil: '2027-08-31',
    ...overrides,
  };
}

function judgment(overrides: Partial<ComparisonJudgment> = {}): ComparisonJudgment {
  return {
    violationRecordId: 'vr-1',
    behaviorBases: [basis()],
    decisionBases: [basis()],
    behaviorBenchmarks: [benchmark()],
    decisionBenchmarks: [benchmark()],
    adoptedVersion: '决定时版本',
    reason: '行为时与决定时依据一致，差异为零',
    noticeRef: 'notice-1',
    zeroDifference: true,
    ...overrides,
  };
}

function entry(id: string, at: string, overrides: Partial<ComparisonJudgment> = {}): ComparisonJudgmentEntry {
  return { id, createdAt: new Date(at), ...judgment(overrides) };
}

function raw(overrides: Partial<RawComparisonJudgment> = {}): RawComparisonJudgment {
  return {
    violationRecordId: 'vr-1',
    behaviorBases: [basis()],
    decisionBases: [basis()],
    behaviorBenchmarks: [benchmark()],
    decisionBenchmarks: [benchmark()],
    adoptedVersion: '决定时版本',
    reason: '行为时与决定时依据一致，差异为零',
    noticeRef: 'notice-1',
    zeroDifference: true,
    ...overrides,
  };
}

function freshness(overrides: Partial<ComparisonFreshnessInput> = {}): ReturnType<typeof assessComparisonFreshness> {
  return assessComparisonFreshness({
    activeViolationIds: ['vr-1'],
    judgments: [entry('j-1', '2026-10-01T00:00:00.000Z')],
    approvedAt: new Date('2026-10-28T00:00:00.000Z'),
    config: EFFECTIVE_DAY_ATTRIBUTION_V1,
    ...overrides,
  });
}

describe('判定材料录入（#271）', () => {
  it('合规材料逐字段收下；差异为零也保留人的判定与理由', () => {
    const read = readComparisonJudgment(raw());
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.judgment.violationRecordId).toBe('vr-1');
    expect(read.judgment.zeroDifference).toBe(true);
    expect(read.judgment.adoptedVersion).toBe('决定时版本');
    expect(read.judgment.reason).toBe('行为时与决定时依据一致，差异为零');
    expect(read.judgment.noticeRef).toBe('notice-1');
    expect(read.judgment.behaviorBases[0]?.effectiveFrom).toBe('2021-09-01');
    expect(read.judgment.behaviorBenchmarks[0]?.clause).toBe('doc_025 附件 4');
  });

  it('缺行为时或决定时依据：缺依据', () => {
    expect(readComparisonJudgment(raw({ behaviorBases: [] }))).toMatchObject({ ok: false, reason: 'missing-basis' });
    expect(readComparisonJudgment(raw({ decisionBases: undefined }))).toMatchObject({ ok: false, reason: 'missing-basis' });
  });

  it('施行日不是真实日历日或失效日不晚于施行日：依据不合规', () => {
    expect(
      readComparisonJudgment(raw({ behaviorBases: [basis({ effectiveFrom: '2027-02-30' })] })),
    ).toMatchObject({ ok: false, reason: 'invalid-basis' });
    expect(
      readComparisonJudgment(raw({ decisionBases: [basis({ expiresOn: '2021-09-01' })] })),
    ).toMatchObject({ ok: false, reason: 'invalid-basis' });
  });

  it('差异为零也必须写理由；未写判定版本或告知书同样拒绝', () => {
    expect(readComparisonJudgment(raw({ reason: '   ' }))).toMatchObject({ ok: false, reason: 'missing-reason' });
    expect(readComparisonJudgment(raw({ adoptedVersion: '' }))).toMatchObject({
      ok: false,
      reason: 'missing-judgment',
    });
    expect(readComparisonJudgment(raw({ noticeRef: '' }))).toMatchObject({ ok: false, reason: 'missing-notice' });
    expect(readComparisonJudgment(raw({ zeroDifference: undefined }))).toMatchObject({
      ok: false,
      reason: 'invalid-input',
    });
  });

  it('裁量基准允许版本留空（新版未录入），到期日须真实', () => {
    const read = readComparisonJudgment(
      raw({ decisionBenchmarks: [benchmark({ version: '', validUntil: null })] }),
    );
    expect(read.ok).toBe(true);
    expect(
      readComparisonJudgment(raw({ decisionBenchmarks: [benchmark({ validUntil: '2027-13-01' })] })),
    ).toMatchObject({ ok: false, reason: 'invalid-basis' });
  });
});

describe('决定呈批提交检查（#271）', () => {
  it('有效违法记录逐条都要有判定，缺一条即阻断', () => {
    const result = assessDecisionSubmission({
      activeViolationIds: ['vr-1', 'vr-2'],
      judgments: [entry('j-1', '2026-10-01T00:00:00.000Z')],
    });
    expect(result).toMatchObject({
      ok: false,
      missingViolationIds: ['vr-2'],
      message: COMPARISON_MISSING_MESSAGE,
    });
  });

  it('作废的违法记录不要求判定；已覆盖即放行', () => {
    const result = assessDecisionSubmission({
      activeViolationIds: ['vr-1'],
      judgments: [entry('j-1', '2026-10-01T00:00:00.000Z')],
    });
    expect(result).toEqual({ ok: true });
  });

  it('每条违法记录取最新一条判定', () => {
    const refs: ComparisonJudgmentRef[] = [
      { id: 'j-1', violationRecordId: 'vr-1', createdAt: new Date('2026-10-01T00:00:00.000Z') },
      { id: 'j-2', violationRecordId: 'vr-1', createdAt: new Date('2026-10-02T00:00:00.000Z') },
      { id: 'j-3', violationRecordId: 'vr-2', createdAt: new Date('2026-10-02T00:00:00.000Z') },
    ];
    const latest = latestJudgments(refs);
    expect(latest.get('vr-1')?.id).toBe('j-2');
    expect(latest.get('vr-2')?.id).toBe('j-3');
  });

  it('调查报告规则不引用比对检查（本票只在决定环节设校验）', () => {
    const source = readFileSync(new URL('../src/investigation/rules.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('comparison');
    expect(source).not.toContain('新旧比对');
  });
});

describe('批准时新鲜度（#271）', () => {
  it('没有人的判定：比对过时，出路为重新比对', () => {
    const result = freshness({ judgments: [] });
    expect(result).toMatchObject({
      kind: 'stale',
      reason: 'missing-judgment',
      message: COMPARISON_STALE_MESSAGE,
      outlet: COMPARISON_STALE_OUTLET,
      missingViolationIds: ['vr-1'],
    });
  });

  it('判定没有理由：比对过时', () => {
    const result = freshness({
      judgments: [entry('j-1', '2026-10-01T00:00:00.000Z', { reason: '' })],
    });
    expect(result).toMatchObject({ kind: 'stale', reason: 'missing-judgment' });
  });

  it('决定时版本在批准当日尚未施行：比对过时', () => {
    const result = freshness({
      judgments: [
        entry('j-1', '2026-10-01T00:00:00.000Z', {
          decisionBases: [basis({ effectiveFrom: '2027-01-01' })],
        }),
      ],
    });
    expect(result).toMatchObject({ kind: 'stale', reason: 'comparison-stale' });
  });

  it('决定时版本在批准当日已失效：比对过时', () => {
    const result = freshness({
      judgments: [
        entry('j-1', '2026-10-01T00:00:00.000Z', {
          decisionBases: [basis({ effectiveFrom: '2021-09-01', expiresOn: '2026-10-28' })],
        }),
      ],
    });
    expect(result).toMatchObject({ kind: 'stale', reason: 'comparison-stale' });
  });

  it('决定时版本在批准当日有效：放行', () => {
    const result = freshness();
    expect(result.kind).toBe('fresh');
  });

  it('批准日等于某依据条款施行日：Q31 警告，不以新／旧版判过时', () => {
    const result = freshness({
      judgments: [
        entry('j-1', '2026-10-01T00:00:00.000Z', {
          behaviorBases: [basis({ clause: 'doc_021 第 76 条', version: 'doc_021@2027-01-01', effectiveFrom: '2027-01-01' })],
          decisionBases: [basis({ effectiveFrom: '2021-09-01', expiresOn: '2027-01-01' })],
        }),
      ],
      approvedAt: new Date('2027-01-01T02:00:00.000Z'),
    });
    expect(result).toMatchObject({
      kind: 'effective-day-warning',
      approvedDay: '2027-01-01',
      clauses: ['doc_021 第 76 条'],
      outlet: Q31_OUTLET,
      ruleId: EFFECTIVE_DAY_ATTRIBUTION_V1.ruleId,
      attribution: null,
    });
    if (result.kind !== 'effective-day-warning') return;
    expect(result.warning).toMatchObject({
      level: 'warn',
      code: 'CMP-01',
      message: '施行日当天批准，适用哪一版请法制部门确认',
      ruleKey: 'CMP-01',
    });
  });

  it('Q31 情形下仍只看人的判定与理由', () => {
    const result = freshness({
      judgments: [
        entry('j-1', '2026-10-01T00:00:00.000Z', {
          reason: '',
          behaviorBases: [basis({ effectiveFrom: '2027-01-01' })],
        }),
      ],
      approvedAt: new Date('2027-01-01T02:00:00.000Z'),
    });
    expect(result).toMatchObject({ kind: 'stale', reason: 'missing-judgment' });
  });

  it('批准时刻按北京日期换算：UTC 跨日即进入次日', () => {
    const result = freshness({
      judgments: [
        entry('j-1', '2026-10-01T00:00:00.000Z', {
          behaviorBases: [basis({ effectiveFrom: '2027-01-01' })],
        }),
      ],
      approvedAt: new Date('2026-12-31T16:00:00.000Z'),
    });
    expect(result).toMatchObject({ kind: 'effective-day-warning', approvedDay: '2027-01-01' });
  });

  it('当天归属配置项带版本且不设默认', () => {
    expect(EFFECTIVE_DAY_ATTRIBUTION_V1).toEqual({
      ruleId: 'cfg.rule.comparison-effective-day-attribution.v1',
      version: '1',
      attribution: null,
    });
  });
});

describe('Q32 裁量基准提示（#271）', () => {
  it('基准到期或新版未录入：提示，不阻断', () => {
    const expired = freshness({
      judgments: [
        entry('j-1', '2026-10-01T00:00:00.000Z', {
          decisionBenchmarks: [benchmark({ validUntil: '2026-10-28' })],
        }),
      ],
    });
    expect(expired.kind).toBe('fresh');
    if (expired.kind !== 'fresh') return;
    expect(expired.hints).toEqual([
      { level: 'hint', code: Q32_RULE_KEY, message: Q32_PROMPT, citation: null, ruleKey: Q32_RULE_KEY },
    ]);

    const unversioned = q32Hints(judgment({ decisionBenchmarks: [benchmark({ version: '', validUntil: null })] }), '2026-10-28');
    expect(unversioned).toHaveLength(1);
    expect(unversioned[0]?.message).toBe(Q32_PROMPT);
  });

  it('基准未到期且版本已录入：无提示', () => {
    const result = freshness();
    expect(result.kind).toBe('fresh');
    if (result.kind !== 'fresh') return;
    expect(result.hints).toEqual([]);
  });
});

describe('Q31 规则键登记与不自动判较轻（#271）', () => {
  it('CMP-01 登记为可确认的警告，不要求确认理由', () => {
    expect(findRuleParameter('CMP-01')).toMatchObject({
      ruleKey: 'CMP-01',
      version: '1',
      level: 'warn',
      reasonRequired: false,
    });
    expect(
      confirmationGap({ warnRuleKeys: ['CMP-01'], confirmedRuleKeys: ['CMP-01'], confirmReasons: {} }),
    ).toEqual({ kind: 'ready' });
  });

  it('26 号答复与法工办发〔2012〕20 号意见不写入依据表', () => {
    const hits = DOCUMENTS.filter((document) =>
      /法行字第\s*26\s*号|法工办发〔2012〕20\s*号/.test(`${document.name} ${document.note ?? ''}`),
    );
    expect(hits).toEqual([]);
  });

  it('模块不导出自动判较轻的能力', () => {
    const source = readFileSync(new URL('../src/comparison/rules.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/function\s+\w*(lighter|从轻|较轻)\w*/i);
    expect(source).not.toMatch(/kind:\s*'(lighter|从轻|较轻)'/);
  });

  it('比对结果不接入对外文书生成', () => {
    const rules = readFileSync(new URL('../src/comparison/rules.ts', import.meta.url), 'utf8');
    expect(rules).not.toMatch(/from\s+['"][^'"]*document/);
  });
});