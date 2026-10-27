// 人员页签的可见行为（#239）：发起与批准入口按操作码出现，曾任人员与无效材料可见。
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CaseConflictTab } from './CaseConflictPage';
import { CaseReassignSection, type CaseReassignSectionProps } from './CaseReassignSection';
import type { ReassignListView } from './reassign';

const handler = {
  id: 'h1',
  personnelId: 'p-main',
  role: 'main',
  roleName: '主办',
  assignedAt: '2026-10-27T00:00:00.000Z',
  endedAt: null,
};

const former = {
  id: 'h0',
  personnelId: 'p-former',
  role: 'main',
  roleName: '主办',
  assignedAt: '2026-10-26T00:00:00.000Z',
  endedAt: '2026-10-27T00:00:00.000Z',
};

const view: ReassignListView = {
  handlers: [handler],
  formerHandlers: [former],
  reassignments: [
    {
      id: 'r1',
      status: 'pending_approval',
      statusName: '待批准',
      reasonCode: 'recusal',
      reasonName: '回避',
      note: '',
      conflictLineageId: 'c1',
      requestedBy: 'p-main',
      requestedAt: '2026-10-27T00:00:00.000Z',
      approvedBy: null,
      approvedAt: null,
      proposedHandlers: [{ personnelId: 'p-next', role: 'main' }],
    },
  ],
  materials: [
    {
      materialId: 'm1',
      kind: 'investigation-record',
      createdAt: '2026-10-27T00:00:00.000Z',
      effectiveness: {
        id: 'e1',
        conclusion: 'invalid',
        conclusionName: '无效',
        reason: '未入卷',
        determinedBy: 'p-main',
        determinedAt: '2026-10-27T00:00:00.000Z',
      },
    },
    {
      materialId: 'm2',
      kind: 'notice',
      createdAt: '2026-10-27T00:00:00.000Z',
      effectiveness: null,
    },
  ],
  invalidMaterialIds: ['m1'],
};

function props(partial: Partial<CaseReassignSectionProps> = {}): CaseReassignSectionProps {
  return {
    view,
    canSubmit: true,
    canApprove: true,
    canDetermine: true,
    message: null,
    onSubmit: () => undefined,
    onApprove: () => undefined,
    onDetermine: () => undefined,
    ...partial,
  };
}

const agencyQuiet = {
  agencyMarked: false,
  agencyWarning: null,
  agencyOutlet: null,
  canMarkAgency: true,
  onMarkAgency: () => undefined,
};

describe('人员页签', () => {
  it('显示承办人员、曾任人员、改派入口、批准入口与效力认定清单', () => {
    const html = renderToStaticMarkup(<CaseReassignSection {...props()} />);
    expect(html).toContain('data-role="current-handlers"');
    expect(html).toContain('主办 p-main');
    expect(html).toContain('data-role="former-handlers"');
    expect(html).toContain('主办 p-former');
    expect(html).toContain('data-role="reassign-form"');
    expect(html).toContain('data-role="reassign-submit"');
    expect(html).toContain('data-role="reassign-approve"');
    expect(html).toContain('data-role="material-effectivities"');
    expect(html).toContain('无效（未入卷）');
    expect(html).toContain('data-invalid="true"');
    expect(html).toContain('data-role="effectivity-form"');
    expect(html).not.toMatch(/#[0-9]{2,4}/);
  });

  it('没有发起、批准或认定权限时只显示清单', () => {
    const html = renderToStaticMarkup(
      <CaseReassignSection {...props({ canSubmit: false, canApprove: false, canDetermine: false })} />,
    );
    expect(html).not.toContain('data-role="reassign-form"');
    expect(html).not.toContain('data-role="reassign-approve"');
    expect(html).not.toContain('data-role="effectivity-form"');
    expect(html).toContain('data-role="former-handlers"');
  });

  it('案件详情页签可切到人员，冲突表单隐藏', () => {
    const html = renderToStaticMarkup(
      <CaseConflictTab
        records={[]}
        decisions={[]}
        canDeclare
        canDecide
        message={null}
        signResult={null}
        onDeclare={() => undefined}
        onDecide={() => undefined}
        onSignCheck={() => undefined}
        {...agencyQuiet}
        activeTab="personnel"
        reassign={props()}
      />,
    );
    expect(html).toContain('data-role="personnel-tab"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('data-role="reassign-form"');
    expect(html).not.toContain('data-role="declare-form"');
    expect(html).not.toContain('data-role="decide-form"');
  });
});