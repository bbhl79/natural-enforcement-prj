// #242 案件阶段三类移送的纯规则：呈批正文、链路、涉刑法审闸口、X11 结案闸口、
// T30 外部决定与人工出口、回证齐全。
import { describe, expect, it } from 'vitest';

import { findTransition } from '../src/state-machine/index.ts';
import {
  CRIMINAL_DECISION_REVIEW_RULE_KEY,
  CRIMINAL_TRANSFER_DECISION_RULE_KEY,
  DEFAULT_TRANSFER_APPROVAL_CHAIN,
  TRANSFER_APPROVAL_CHAIN_BASIS,
  assertCloseoutTransferGate,
  assertCriminalTransferReview,
  criminalOutletLanding,
  criminalTransferReviewPass,
  readCriminalDecisionContent,
  readCriminalOutletContent,
  readTransferContent,
  receiptsCompleteOf,
  resolveTransferApprovalChain,
  transferStatusAfter,
} from '../src/transfer/index.ts';

const TODAY = '2026-10-29';

function determination(autoReasons: readonly string[]): string {
  return JSON.stringify({ required: true, excluded: false, autoReasons, manualItems: [] });
}

describe('#242 移送呈批正文', () => {
  it('三类移送类型；接收机关、文书编号、原因必填', () => {
    const base = {
      kind: 'jurisdiction',
      receivingOrg: '某区市场监督管理局',
      documentNo: '穗自然资移〔2026〕1 号',
      reason: '不属本部门管辖',
    };
    expect(readTransferContent(base, TODAY)).toMatchObject({
      ok: true,
      content: { kind: 'jurisdiction', letterDate: TODAY, attachments: [] },
    });
    expect(readTransferContent({ ...base, kind: 'criminal' }, TODAY).ok).toBe(true);
    expect(readTransferContent({ ...base, kind: 'party-discipline' }, TODAY).ok).toBe(true);
    expect(readTransferContent({ ...base, kind: 'other' }, TODAY)).toMatchObject({
      ok: false,
      hit: { reason: 'invalid-kind' },
    });
    for (const missing of ['receivingOrg', 'documentNo', 'reason']) {
      expect(readTransferContent({ ...base, [missing]: ' ' }, TODAY)).toMatchObject({
        ok: false,
        hit: { reason: 'missing-fields' },
      });
    }
  });

  it('发函日期缺省北京当日；补录只收真实日历日；附件 0..n 去重', () => {
    const base = {
      kind: 'criminal',
      receivingOrg: '某市公安局',
      documentNo: '穗自然资移〔2026〕2 号',
      reason: '涉嫌犯罪',
    };
    expect(readTransferContent({ ...base, letterDate: '2026-10-20', attachments: ['a.pdf', 'a.pdf', 'b.pdf'] }, TODAY)).toEqual({
      ok: true,
      content: {
        kind: 'criminal',
        receivingOrg: '某市公安局',
        documentNo: '穗自然资移〔2026〕2 号',
        letterDate: '2026-10-20',
        reason: '涉嫌犯罪',
        attachments: ['a.pdf', 'b.pdf'],
      },
    });
    expect(readTransferContent({ ...base, letterDate: '2026-02-31' }, TODAY)).toMatchObject({
      ok: false,
      hit: { reason: 'invalid-letter-date' },
    });
  });
});

describe('#242 呈批链路', () => {
  it('默认链路＝承办机构负责人审核→部门负责人批准；规程无明文', () => {
    expect(DEFAULT_TRANSFER_APPROVAL_CHAIN).toMatchObject({
      levels: ['review', 'approve'],
      basis: '规程无明文',
      ruleId: 'cfg.rule.transfer-approval-chain.v1',
    });
    expect(TRANSFER_APPROVAL_CHAIN_BASIS).toBe('规程无明文');
  });

  it('层级可配置；非法配置回落默认', () => {
    expect(resolveTransferApprovalChain({ levels: ['approve'] }).levels).toEqual(['approve']);
    expect(resolveTransferApprovalChain({ levels: ['review', 'review', 'approve'] }).levels).toEqual(['review', 'approve']);
    expect(resolveTransferApprovalChain({ levels: ['review'] })).toEqual(DEFAULT_TRANSFER_APPROVAL_CHAIN);
    expect(resolveTransferApprovalChain({ levels: ['approve', 'review'] })).toEqual(DEFAULT_TRANSFER_APPROVAL_CHAIN);
  });

  it('提交与审核后的状态', () => {
    expect(transferStatusAfter('submit', DEFAULT_TRANSFER_APPROVAL_CHAIN)).toBe('pending_review');
    expect(transferStatusAfter('review', DEFAULT_TRANSFER_APPROVAL_CHAIN)).toBe('pending_approval');
    const short = resolveTransferApprovalChain({ levels: ['approve'] });
    expect(transferStatusAfter('submit', short)).toBe('pending_approval');
  });
});

describe('#242 涉刑法审闸口', () => {
  it('只认已定稿、结论通过且判定含涉刑移送的轮次', () => {
    const rows = [
      { id: 'L1', status: 'concluded', conclusion: 'pass', determinationJson: determination(['penalty-item-5']) },
      { id: 'L2', status: 'pending_head', conclusion: null, determinationJson: determination(['criminal-transfer']) },
      { id: 'L3', status: 'concluded', conclusion: 'fail', determinationJson: determination(['criminal-transfer']) },
      { id: 'L4', status: 'concluded', conclusion: 'pass', determinationJson: '不是 JSON' },
      { id: 'L5', status: 'concluded', conclusion: 'pass', determinationJson: determination(['criminal-transfer']) },
    ];
    expect(criminalTransferReviewPass(rows)).toBe('L5');
    expect(criminalTransferReviewPass(rows.filter((row) => row.id !== 'L5'))).toBeNull();
  });

  it('未通过即阻断，通过放行', () => {
    const blocked = assertCriminalTransferReview({ required: true, passedReviewId: null });
    expect(blocked).toMatchObject({ level: 'block', code: 'legal-review-required', authority: 'regulation' });
    expect(assertCriminalTransferReview({ required: true, passedReviewId: 'L5' })).toBeNull();
  });
});

describe('#242 X11 结案闸口', () => {
  it('已提交的涉刑或党纪政务呈批未形成记载即阻断；草稿不算', () => {
    const blocked = assertCloseoutTransferGate({
      records: [],
      approvals: [{ kind: 'criminal', status: 'pending_approval' }],
    });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) throw new Error('应阻断');
    expect(blocked.block.code).toBe('X11');
    expect(blocked.block.citation).toBe('办法第46条末款');

    expect(
      assertCloseoutTransferGate({ records: [], approvals: [{ kind: 'party-discipline', status: 'pending_review' }] }).ok,
    ).toBe(false);
    expect(assertCloseoutTransferGate({ records: [], approvals: [{ kind: 'criminal', status: 'drafting' }] }).ok).toBe(true);
    expect(
      assertCloseoutTransferGate({
        records: [{ kind: 'criminal' }],
        approvals: [{ kind: 'criminal', status: 'approved' }],
      }).ok,
    ).toBe(true);
  });

  it('回证不影响 X11 判定；回证齐全按记载逐条计算', () => {
    expect(
      assertCloseoutTransferGate({
        records: [{ kind: 'party-discipline' }],
        approvals: [{ kind: 'party-discipline', status: 'approved' }],
      }).ok,
    ).toBe(true);
    expect(receiptsCompleteOf([{ id: 't1' }, { id: 't2' }], [{ transferId: 't1' }])).toBe(false);
    expect(receiptsCompleteOf([{ id: 't1' }], [{ transferId: 't1' }, { transferId: 't1' }])).toBe(true);
    expect(receiptsCompleteOf([], [])).toBe(true);
  });
});

describe('#242 T30 外部决定与人工出口', () => {
  const decisionBase = {
    source: 'procuratorate',
    notifiedOn: '2026-10-28',
    reason: '不构成犯罪，退回案卷',
    caseReturned: true,
    returnedList: ['案卷一卷'],
  };

  it('必填来源、通知日期、理由、是否退回案卷；退回须附清单', () => {
    expect(readCriminalDecisionContent(decisionBase)).toMatchObject({
      ok: true,
      content: { source: 'procuratorate', caseReturned: true, returnedList: ['案卷一卷'], reviewRequested: null },
    });
    expect(readCriminalDecisionContent({ ...decisionBase, source: 'court' })).toMatchObject({
      ok: false,
      hit: { reason: 'invalid-source' },
    });
    expect(readCriminalDecisionContent({ ...decisionBase, notifiedOn: '2026-02-31' })).toMatchObject({
      ok: false,
      hit: { reason: 'invalid-notified-on' },
    });
    expect(readCriminalDecisionContent({ ...decisionBase, reason: '' })).toMatchObject({
      ok: false,
      hit: { reason: 'missing-reason' },
    });
    expect(readCriminalDecisionContent({ ...decisionBase, caseReturned: undefined })).toMatchObject({
      ok: false,
      hit: { reason: 'missing-case-returned' },
    });
    expect(readCriminalDecisionContent({ ...decisionBase, returnedList: [] })).toMatchObject({
      ok: false,
      hit: { reason: 'missing-returned-list' },
    });
    expect(
      readCriminalDecisionContent({
        source: 'police',
        notifiedOn: '2026-10-28',
        reason: '不予立案',
        caseReturned: false,
        reviewRequested: true,
        supervisionSuggested: false,
        reviewOn: '2026-10-29',
        reviewResult: '已提请复议',
        partyNotifiedOn: '2026-10-29',
        partyNoticeNote: '电话告知',
      }),
    ).toMatchObject({
      ok: true,
      content: {
        reviewRequested: true,
        supervisionSuggested: false,
        reviewOn: '2026-10-29',
        partyNotifiedOn: '2026-10-29',
        partyNoticeNote: '电话告知',
      },
    });
  });

  it('出口 A 须写违法状态与处罚依据；出口 B 须写理由；A、B 互斥字段', () => {
    expect(
      readCriminalOutletContent({
        outlet: 'investigate-again',
        illegalStateCleared: 'no',
        illegalStateNote: '违法状态仍未消除',
        penaltyBasis: '土地管理法第77条',
      }),
    ).toMatchObject({
      ok: true,
      content: { outlet: 'investigate-again', reason: null, penaltyBasis: '土地管理法第77条' },
    });
    expect(readCriminalOutletContent({ outlet: 'investigate-again', penaltyBasis: '土地管理法第77条' })).toMatchObject({
      ok: false,
      hit: { reason: 'missing-illegal-state' },
    });
    expect(
      readCriminalOutletContent({ outlet: 'investigate-again', illegalStateCleared: 'no', illegalStateNote: '仍未消除' }),
    ).toMatchObject({ ok: false, hit: { reason: 'missing-penalty-basis' } });
    expect(readCriminalOutletContent({ outlet: 'close-or-other', reason: '' })).toMatchObject({
      ok: false,
      hit: { reason: 'missing-reason' },
    });
    expect(readCriminalOutletContent({ outlet: 'close-or-other', reason: '依法结案' })).toMatchObject({
      ok: true,
      content: { outlet: 'close-or-other', illegalStateCleared: null, penaltyBasis: null },
    });
  });

  it('A 的落点是回 E02 且进入次序号加 1；B 不前移；T30 目录仍是分支边', () => {
    expect(criminalOutletLanding('investigate-again')).toEqual({
      kind: 'enter',
      stage: 'E02',
      instanceStatus: 'drafting',
      reenter: true,
    });
    expect(criminalOutletLanding('close-or-other')).toBeNull();
    expect(findTransition('T30')?.to.kind).toBe('branch');
  });

  it('期限规则键已登记：涉刑审批三个工作日、外部决定三日只警告', () => {
    expect(CRIMINAL_TRANSFER_DECISION_RULE_KEY).toBe('criminal-transfer.decision');
    expect(CRIMINAL_DECISION_REVIEW_RULE_KEY).toBe('criminal-decision.review');
  });
});