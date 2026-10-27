// #234 立案呈批纯规则：结论与理由校验（X30）、审批链迁移、X31 判定、批准守卫、案件最小字段。
import { describe, expect, it } from 'vitest';

import {
  buildCaseOpening,
  canTakeFilingStep,
  checkFilingContent,
  checkFilingGuards,
  checkFilingParty,
  filingStatusAfter,
  isFilingApprovalPending,
  type FilingHandlerFact,
} from '../src/filing/index.ts';

const grounds = { kind: 'non-filing-grounds', grounds: ['art16-2-no-violation-fact'] };
const minor = {
  kind: 'minor-corrected-no-harm',
  minor: { confirmed: true, note: '轻微' },
  timelyCorrection: { confirmed: true, note: '已及时纠正' },
  noHarm: { confirmed: true, note: '没有造成危害后果' },
};

describe('checkFilingContent（结论二选一＋X30）', () => {
  it('立案：当事人名称去空白去重', () => {
    const out = checkFilingContent({ conclusion: 'file', partyNames: [' 张三 ', '张三', '', 3] });
    expect(out).toEqual({ ok: true, content: { conclusion: 'file', partyNames: ['张三'] } });
  });

  it('不予立案 (a) 成功', () => {
    const out = checkFilingContent({ conclusion: 'no-case', noCaseReason: grounds });
    expect(out.ok).toBe(true);
    if (out.ok && out.content.conclusion === 'no-case') {
      expect(out.content.noCaseReason.kind).toBe('non-filing-grounds');
    }
  });

  it('不予立案 (b) 成功', () => {
    expect(checkFilingContent({ conclusion: 'no-case', noCaseReason: minor }).ok).toBe(true);
  });

  it.each([
    ['(a)(b) 皆空', {}],
    ['混选', { ...grounds, minor: { confirmed: true, note: 'x' } }],
    ['(a) 未勾条款项', { kind: 'non-filing-grounds', grounds: [] }],
    ['(b) 缺一项', { ...minor, noHarm: undefined }],
  ])('不予立案理由 %s → invalid-no-case-reason', (_label, reason) => {
    expect(checkFilingContent({ conclusion: 'no-case', noCaseReason: reason })).toEqual({
      ok: false,
      rule: 'invalid-no-case-reason',
    });
  });

  it('结论不在两项之内 → invalid-conclusion', () => {
    expect(checkFilingContent({ conclusion: 'transfer' })).toEqual({ ok: false, rule: 'invalid-conclusion' });
    expect(checkFilingContent(null)).toEqual({ ok: false, rule: 'invalid-conclusion' });
  });
});

describe('审批链最小固定形态', () => {
  it('提交按配置进行政审核或直达行政审批', () => {
    expect(filingStatusAfter('submit', 'one-level')).toBe('pending_review');
    expect(filingStatusAfter('submit', 'skip')).toBe('pending_approval');
    expect(filingStatusAfter('review', 'one-level')).toBe('pending_approval');
    expect(filingStatusAfter('approve', 'one-level')).toBe('approved');
    expect(filingStatusAfter('return', 'one-level')).toBe('drafting');
    expect(filingStatusAfter('withdraw', 'one-level')).toBe('drafting');
  });

  it('步骤门槛', () => {
    expect(canTakeFilingStep('submit', 'drafting')).toBe(true);
    expect(canTakeFilingStep('submit', 'pending_review')).toBe(false);
    expect(canTakeFilingStep('approve', 'pending_review')).toBe(false);
    expect(canTakeFilingStep('approve', 'pending_approval')).toBe(true);
    expect(canTakeFilingStep('withdraw', 'drafting')).toBe(false);
    expect(canTakeFilingStep('withdraw', 'approved')).toBe(false);
    expect(canTakeFilingStep('return', 'pending_approval')).toBe(true);
  });
});

describe('X31 在途判定', () => {
  it('已提交未批准未退回未撤回＝在途', () => {
    expect(isFilingApprovalPending('pending_review')).toBe(true);
    expect(isFilingApprovalPending('pending_approval')).toBe(true);
    expect(isFilingApprovalPending('drafting')).toBe(false);
    expect(isFilingApprovalPending('approved')).toBe(false);
    expect(isFilingApprovalPending(null)).toBe(false);
  });
});


describe('checkFilingParty（R-8 定案 C：提交与批准）', () => {
  it('立案当事人明确：无命中（提交可过）', () => {
    expect(checkFilingParty({ conclusion: 'file', partyNames: ['张三'], subjectUnknown: false })).toBeNull();
  });

  it('立案当事人空或不明：命中 party-unknown（提交／批准都拦；草稿不调本函数）', () => {
    expect(checkFilingParty({ conclusion: 'file', partyNames: [], subjectUnknown: false })).toMatchObject({
      reason: 'party-unknown',
      basis: '处罚办法第 16 条（一）',
    });
    expect(checkFilingParty({ conclusion: 'file', partyNames: ['张三'], subjectUnknown: true })?.reason).toBe(
      'party-unknown',
    );
  });

  it('不予立案不查当事人', () => {
    expect(checkFilingParty({ conclusion: 'no-case', partyNames: [], subjectUnknown: true })).toBeNull();
  });
});

describe('checkFilingGuards（T01／T02 守卫）', () => {
  const two: FilingHandlerFact[] = [
    { personnelId: 'a', role: 'main', qualified: true },
    { personnelId: 'b', role: 'assist', qualified: true },
  ];
  const base = { conclusion: 'file' as const, clueStatus: 'handler_assigned', handlers: two, partyNames: ['张三'], subjectUnknown: false };

  it('全部满足：无命中', () => {
    expect(checkFilingGuards(base)).toBeNull();
  });

  it('线索不是 handler_assigned → invalid-state（立案与不予立案都查）', () => {
    expect(checkFilingGuards({ ...base, clueStatus: 'filed' })?.reason).toBe('invalid-state');
    expect(checkFilingGuards({ ...base, conclusion: 'no-case', clueStatus: 'closed' })?.reason).toBe('invalid-state');
  });

  it('不予立案不查人数与当事人', () => {
    expect(checkFilingGuards({ ...base, conclusion: 'no-case', handlers: [], partyNames: [] })).toBeNull();
  });

  it('少于 2 人 → handlers-not-qualified，带行政处罚法第 42 条', () => {
    const hit = checkFilingGuards({ ...base, handlers: [two[0]!] });
    expect(hit).toMatchObject({ reason: 'handlers-not-qualified', basis: '行政处罚法第 42 条' });
  });

  it('有人缺执法资格 → handlers-not-qualified', () => {
    const hit = checkFilingGuards({ ...base, handlers: [two[0]!, { ...two[1]!, qualified: false }] });
    expect(hit?.reason).toBe('handlers-not-qualified');
  });

  it('当事人为空或线索标当事人不明 → party-unknown，带处罚办法第 16 条（一）', () => {
    expect(checkFilingGuards({ ...base, partyNames: [] })).toMatchObject({
      reason: 'party-unknown',
      basis: '处罚办法第 16 条（一）',
    });
    expect(checkFilingGuards({ ...base, subjectUnknown: true })?.reason).toBe('party-unknown');
  });
});

describe('buildCaseOpening（案件最小字段）', () => {
  it('主状态办理中、当前环节 E02、进入次序号 1、来源线索主键', () => {
    const opened = buildCaseOpening({
      caseId: 'case-1',
      handlingOrgId: 'org-1',
      handlers: [
        { personnelId: 'a', role: 'main' },
        { personnelId: 'b', role: 'assist' },
      ],
      partyNames: ['张三'],
      sourceClueId: 'clue-1',
      filingApprovalId: 'fa-1',
      openedAt: new Date(0),
    });
    expect(opened).toMatchObject({
      handlingOrgId: 'org-1',
      status: 'in_progress',
      currentStage: 'E02',
      stageEntrySeq: 1,
      sourceClueIds: ['clue-1'],
      filingApprovalId: 'fa-1',
    });
  });
});
