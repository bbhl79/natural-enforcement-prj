// 定型页签的可见行为（#243）：必需材料与缺件、发起归档审批、查看定型状态。
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CaseFinalizeSection, type CaseFinalizeSectionProps } from './CaseFinalizeSection';
import type { FinalizeChecklistRow, FinalizeView } from './finalize';

function rows(missing: readonly number[]): FinalizeChecklistRow[] {
  return [
    { itemCode: 1, itemName: '封面、目录', required: true, exempt: false, present: true, current: true, missing: false },
    { itemCode: 2, itemName: '案件来源材料', required: true, exempt: false, present: true, current: true, missing: false },
    { itemCode: 4, itemName: '立案（不予立案）呈批表', required: true, exempt: false, present: true, current: true, missing: false },
    {
      itemCode: 19,
      itemName: '案件结案呈批表',
      required: true,
      exempt: false,
      present: !missing.includes(19),
      current: true,
      missing: missing.includes(19),
    },
  ];
}

function view(partial: Partial<FinalizeView> = {}): FinalizeView {
  return {
    caseId: 'case-1',
    status: 'withdrawn',
    currentStage: 'E02',
    materialsRule: {
      ruleId: 'cfg.rule.dossier-materials.v1',
      version: '2026-10-30',
      basis: '规程 13.1',
    },
    requirement: { requiredItems: [1, 2, 4, 19], exemptItems: [], deliveryRequired: false },
    checklist: rows([19]),
    missingItems: [19],
    receipt: { complete: true, transfers: [] },
    readiness: {
      reasonRequired: true,
      blocked: true,
      conclusion: 'approved-missing',
      conclusionName: '经批准缺项',
    },
    approval: null,
    finalize: null,
    ...partial,
  };
}

function props(partial: Partial<CaseFinalizeSectionProps> = {}): CaseFinalizeSectionProps {
  return {
    view: view(),
    message: null,
    onSaveDraft: () => undefined,
    onSubmit: () => undefined,
    onReview: () => undefined,
    onApprove: () => undefined,
    ...partial,
  };
}

describe('定型页签', () => {
  it('展示卷宗材料清单与缺件', () => {
    const html = renderToStaticMarkup(<CaseFinalizeSection {...props()} />);
    expect(html).toContain('data-role="case-finalize"');
    expect(html).toContain('案件结案呈批表');
    expect(html).toContain('缺件');
    expect(html).toContain('2026-10-30');
  });

  it('已结案、已撤案可发起归档审批；缺件理由随卷保存', () => {
    const html = renderToStaticMarkup(<CaseFinalizeSection {...props()} />);
    expect(html).toContain('发起归档审批');
    expect(html).toContain('缺件或移送回证缺失时须写明理由');
    expect(html).toContain('经批准缺项');
    expect(html).not.toContain('只有已结案或已撤案的案件可以发起归档审批');
  });

  it('未结案、未撤案不出现发起入口', () => {
    const html = renderToStaticMarkup(<CaseFinalizeSection {...props({ view: view({ status: 'in_progress' }) })} />);
    expect(html).not.toContain('data-role="finalize-form"');
    expect(html).toContain('只有已结案或已撤案的案件可以发起归档审批');
  });

  it('归档审批按状态给出提交、审核、批准入口', () => {
    const base = { id: 'a1', currentVersionNo: 1, drafterId: 'p1', missingReason: '线下留存', note: null };
    const drafting = renderToStaticMarkup(
      <CaseFinalizeSection {...props({ view: view({ approval: { ...base, status: 'drafting' } }) })} />,
    );
    expect(drafting).toContain('提交归档审批');
    expect(drafting).toContain('保存归档审批稿');
    const reviewing = renderToStaticMarkup(
      <CaseFinalizeSection {...props({ view: view({ approval: { ...base, status: 'pending_review' } }) })} />,
    );
    expect(reviewing).toContain('审核通过');
    const approving = renderToStaticMarkup(
      <CaseFinalizeSection {...props({ view: view({ approval: { ...base, status: 'pending_approval' } }) })} />,
    );
    expect(approving).toContain('批准归档');
  });

  it('定型后展示代次与结论，不再提供发起入口', () => {
    const html = renderToStaticMarkup(
      <CaseFinalizeSection
        {...props({
          view: view({
            status: 'finalized',
            missingItems: [],
            checklist: rows([]),
            finalize: {
              id: 'f1',
              generationNo: 1,
              conclusion: 'approved-missing',
              conclusionName: '经批准缺项',
              missingReason: '结案呈批表线下留存',
              receiptDeficient: false,
              checklist: rows([19]),
              finalizedAt: '2026-10-30T06:00:00.000Z',
            },
          }),
        })}
      />,
    );
    expect(html).toContain('已定型，代次 1，结论 经批准缺项');
    expect(html).toContain('结案呈批表线下留存');
    expect(html).not.toContain('发起归档审批');
    expect(html).not.toContain('#243');
  });

  it('界面文案不出现工程词', () => {
    const html = renderToStaticMarkup(<CaseFinalizeSection {...props()} />);
    expect(html).not.toContain('捞回');
    expect(html).not.toContain('#243');
  });
});