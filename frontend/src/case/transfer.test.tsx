// 移送页签的可见行为（#242）：链路依据、三类移送、回证补传、外部决定与出口。
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CaseTransferSection, type CaseTransferSectionProps } from './CaseTransferSection';
import type { TransferView } from './transfer';

const view: TransferView = {
  caseId: 'case-1',
  chain: {
    ruleId: 'cfg.rule.transfer-approval-chain.v1',
    version: '2026-10-29',
    basis: '规程无明文',
    levels: ['review', 'approve'],
  },
  transfers: [
    {
      id: 't1',
      kind: 'jurisdiction',
      kindName: '管辖移送',
      receivingOrg: '某区市场监督管理局',
      documentNo: '穗自然资移〔2026〕1 号',
      letterDate: '2026-10-29',
      reason: '不属本部门管辖',
      recordedAt: '2026-10-29T06:00:00.000Z',
      receiptCount: 0,
      receiptsComplete: false,
    },
    {
      id: 't2',
      kind: 'criminal',
      kindName: '涉刑移送',
      receivingOrg: '某市公安局某分局',
      documentNo: '穗自然资移〔2026〕2 号',
      letterDate: '2026-10-29',
      reason: '涉嫌犯罪',
      recordedAt: '2026-10-29T06:10:00.000Z',
      receiptCount: 1,
      receiptsComplete: true,
    },
  ],
  receiptsComplete: false,
  approvals: [
    {
      id: 'a1',
      kind: 'criminal',
      kindName: '涉刑移送',
      status: 'pending_approval',
      decisionDueOn: '2026-11-03',
      attachments: [],
    },
  ],
  criminalTransferReviewPass: null,
  criminalDecisions: [
    {
      id: 'd1',
      source: 'police',
      sourceName: '公安',
      notifiedOn: '2026-10-28',
      reason: '不予立案，退回案卷',
      caseReturned: true,
      returnedList: ['案卷一卷'],
      countdown: {
        dueOn: '2026-10-31',
        expired: false,
        warning: { level: 'warn', code: 'criminal-decision.review', message: '三日提示' },
      },
    },
  ],
  outlets: [],
};

function props(partial: Partial<CaseTransferSectionProps> = {}): CaseTransferSectionProps {
  return {
    view,
    message: null,
    canDraft: true,
    onDraftTransfer: () => undefined,
    onUploadReceipt: () => undefined,
    onRecordDecision: () => undefined,
    onDraftOutlet: () => undefined,
    onCloseoutGate: () => undefined,
    ...partial,
  };
}

describe('移送页签', () => {
  it('展示链路依据（规程无明文）与两级名称', () => {
    const html = renderToStaticMarkup(<CaseTransferSection {...props()} />);
    expect(html).toContain('规程无明文');
    expect(html).toContain('承办机构负责人审核');
    expect(html).toContain('部门负责人批准');
    expect(html).toContain('data-role="transfer-chain"');
  });

  it('记载可见；回证缺失注明可后补；提供补传入口', () => {
    const html = renderToStaticMarkup(<CaseTransferSection {...props()} />);
    expect(html).toContain('管辖移送');
    expect(html).toContain('某区市场监督管理局');
    expect(html).toContain('穗自然资移〔2026〕1 号');
    expect(html).toContain('可后补');
    expect(html).toContain('data-role="receipt-form"');
    expect(html).toContain('上传或补传回证');
    expect(html).toContain('回证未齐全');
  });

  it('三类移送可选；发起入口带附件与补录日期', () => {
    const html = renderToStaticMarkup(<CaseTransferSection {...props()} />);
    expect(html).toContain('data-role="transfer-form"');
    expect(html).toContain('管辖移送');
    expect(html).toContain('涉刑移送');
    expect(html).toContain('党纪政务移送');
    expect(html).toContain('发函日期（留空取当日，可补录）');
    expect(html).toMatch(/type="file"[^>]*name="attachment"/);
  });

  it('涉刑呈批提示三个工作日期限；外部决定带三日提示', () => {
    const html = renderToStaticMarkup(<CaseTransferSection {...props()} />);
    expect(html).toContain('三个工作日内决定');
    expect(html).toContain('2026-11-03');
    expect(html).toContain('三日提示至 2026-10-31');
    expect(html).toContain('data-role="criminal-decision-form"');
  });

  it('人工出口二选一可见；不出现工程词', () => {
    const html = renderToStaticMarkup(<CaseTransferSection {...props()} />);
    expect(html).toContain('回调查继续行政处罚');
    expect(html).toContain('呈批结案或其他处理');
    expect(html).toContain('违法状态是否仍未消除');
    expect(html).not.toContain('#242');
  });
});