// 回避页签的可见行为：页签、登记、决定入口按操作码出现，记录可见。
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CaseConflictTab } from './CaseConflictPage';

const record = {
  id: 'e1',
  lineageId: 'e1',
  personId: 'p1',
  source: 'self',
  sourceName: '本人申请',
  reason: '与当事人有亲属关系',
  status: 'declared',
  statusName: '声明',
  seq: 1,
  createdAt: '2026-10-27T00:00:00.000Z',
};

const agencyQuiet = {
  agencyMarked: false,
  agencyWarning: null,
  agencyOutlet: null,
  canMarkAgency: true,
  onMarkAgency: () => undefined,
};

describe('回避页签', () => {
  it('显示回避页签、记录，以及登记与决定入口', () => {
    const html = renderToStaticMarkup(
      <CaseConflictTab
        records={[record]}
        decisions={[]}
        canDeclare
        canDecide
        message={null}
        signResult="声明期间签出被拒。等待回避决定"
        onDeclare={() => undefined}
        onDecide={() => undefined}
        onSignCheck={() => undefined}
        {...agencyQuiet}
      />,
    );
    expect(html).toContain('回避');
    expect(html).toContain('data-role="conflict-tab"');
    expect(html).toContain('本人申请');
    expect(html).toContain('声明');
    expect(html).toContain('与当事人有亲属关系');
    expect(html).toContain('data-role="declare-form"');
    expect(html).toContain('data-role="decide-form"');
    expect(html).toContain('登记声明');
    expect(html).toContain('作出回避决定');
    expect(html).toContain('data-role="sign-check-form"');
    expect(html).toContain('data-role="sign-result"');
    expect(html).toContain('声明期间签出被拒。等待回避决定');
    expect(html).not.toContain('捞回');
    expect(html).not.toMatch(/#[0-9]{2,4}/);
  });

  it('没有批准入口时不显示作出决定', () => {
    const html = renderToStaticMarkup(
      <CaseConflictTab
        records={[]}
        decisions={[]}
        canDeclare
        canDecide={false}
        {...agencyQuiet}
        message="等待回避决定"
        signResult={null}
        onDeclare={() => undefined}
        onDecide={() => undefined}
        onSignCheck={() => undefined}
      />,
    );
    expect(html).toContain('data-role="declare-form"');
    expect(html).not.toContain('data-role="decide-form"');
    expect(html).toContain('等待回避决定');
    expect(html).toContain('尚无记录');
  });

  it('勾选机关层利害关系后显示提示，勾选框不能取消，签出检查仍在', () => {
    const html = renderToStaticMarkup(
      <CaseConflictTab
        records={[]}
        decisions={[]}
        canDeclare
        canDecide={false}
        agencyMarked
        agencyWarning="本机关与本案当事人存在利害关系"
        agencyOutlet="线下报请上级处理"
        canMarkAgency
        message={null}
        signResult={null}
        onDeclare={() => undefined}
        onDecide={() => undefined}
        onSignCheck={() => undefined}
        onMarkAgency={() => undefined}
      />,
    );
    expect(html).toContain('data-role="agency-conflict-warning"');
    expect(html).toContain('本机关与本案当事人存在利害关系');
    expect(html).toContain('线下报请上级处理');
    expect(html).toContain('data-role="agency-conflict-checkbox"');
    expect(html).toContain('disabled');
    expect(html).not.toContain('data-role="agency-conflict-form"');
    expect(html).toContain('data-role="sign-check-form"');
    expect(html).not.toMatch(/#[0-9]{2,4}/);
  });

  it('未勾选时经办可以登记，页面不显示机关层提示', () => {
    const html = renderToStaticMarkup(
      <CaseConflictTab
        records={[]}
        decisions={[]}
        canDeclare={false}
        canDecide={false}
        {...agencyQuiet}
        message={null}
        signResult={null}
        onDeclare={() => undefined}
        onDecide={() => undefined}
        onSignCheck={() => undefined}
      />,
    );
    expect(html).toContain('尚未登记');
    expect(html).toContain('data-role="agency-conflict-form"');
    expect(html).toContain('登记机关层利害关系');
    expect(html).not.toContain('data-role="agency-conflict-warning"');
  });
});
