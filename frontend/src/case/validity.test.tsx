import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ValidityPanel, type ValidityView } from './ValidityPanel';

function view(overrides: Partial<ValidityView> = {}): ValidityView {
  return {
    caseId: 'case-1',
    currentStage: 'E05',
    stageEntrySeq: 1,
    notice: { id: 'notice-1', entrySeq: 1, kind: 'penalty', servedOn: '2026-10-29' },
    baseline: { noticeId: 'notice-1', entrySeq: 1, digest: 'a'.repeat(64) },
    current: { digest: 'b'.repeat(64), parties: ['张三'] },
    systemHits: [],
    groups: [],
    q14: [],
    confirmation: null,
    confirmations: [],
    gate: { ok: true },
    entries: { confirm: false, review: false, aggravation: false, reissue: false },
    ...overrides,
  };
}

describe('#248 有效性确认最小入口', () => {
  it('展示原告知、闸口状态与差异清单', () => {
    const html = renderToStaticMarkup(
      <ValidityPanel
        view={view({
          systemHits: [{ code: 'A5', message: '罚款金额上调', violationRecordId: 'v1' }],
          groups: [
            {
              violationRecordId: 'v1',
              items: [{ violationRecordId: 'v1', field: 'fine-amount', change: 'increased', before: 5000, after: 8000 }],
            },
          ],
          gate: { ok: false, block: { code: 'validity-invalid', message: 'A 类告知失效命中', outlet: '发起重新告知' } },
        })}
      />,
    );
    expect(html).toContain('原告知第 1 次');
    expect(html).toContain('A 类告知失效命中');
    expect(html).toContain('data-role="validity-hits"');
    expect(html).toContain('data-role="validity-differences"');
    expect(html).toContain('fine-amount increased');
  });

  it('四个入口按服务端给的可办项显示', () => {
    const html = renderToStaticMarkup(
      <ValidityPanel
        view={view({
          entries: { confirm: true, review: true, aggravation: true, reissue: true },
          confirmations: [
            {
              id: 'c1',
              noticeId: 'notice-1',
              conclusion: 'valid',
              reason: '差异为从轻',
              reasonChanged: false,
              aggravation: null,
              review: null,
            },
          ],
          q14: [{ noticeId: 'notice-1', hitCodes: ['A5'], satisfied: false }],
        })}
      />,
    );
    for (const role of ['validity-confirmation', 'aggravation-source', 'validity-review', 'notice-reissue', 'validity-gate']) {
      expect(html, role).toContain(`data-role="${role}"`);
    }
    expect(html).toContain('理由已变化');
    expect(html).toContain('90 日办案期限不重置');
  });

  it('没有可办项时只显示环节与闸口', () => {
    const html = renderToStaticMarkup(<ValidityPanel view={view()} />);
    expect(html).toContain('当前环节 E05');
    expect(html).not.toContain('data-role="validity-confirmation"');
    expect(html).not.toContain('data-role="notice-reissue"');
  });
});