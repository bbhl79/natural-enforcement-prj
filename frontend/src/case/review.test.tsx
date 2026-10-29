import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ReviewPanel, type ReviewView } from './ReviewPanel';

function view(overrides: Partial<ReviewView> = {}): ReviewView {
  return {
    id: 'case-1',
    status: 'in_progress',
    currentStage: 'E04',
    stageEntrySeq: 1,
    suspended: false,
    entries: { report: false, designate: false, sign: false, objection: false },
    reviewer: null,
    opinions: [],
    objections: [],
    prompts: { reviewer: null },
    ...overrides,
  };
}

describe('#240 审理最小入口', () => {
  it('未指定审理人时给出提示', () => {
    const html = renderToStaticMarkup(<ReviewPanel view={view({ prompts: { reviewer: '尚未指定审理人' } })} />);
    expect(html).toContain('尚未指定审理人');
  });

  it('四个入口按服务端给的可办项显示', () => {
    const html = renderToStaticMarkup(
      <ReviewPanel view={view({ entries: { report: true, designate: true, sign: true, objection: true } })} />,
    );
    for (const role of ['review-report', 'reviewer-designation', 'review-opinion', 'review-objection']) {
      expect(html, role).toContain(`data-role="${role}"`);
    }
    expect(html).toContain('补充调查');
    expect(html).toContain('修改纠正');
    expect(html).toContain('已过追诉时效');
    expect(html).toContain('报负责人决定，不作为退回');
    expect(html).toContain('被指定人为本案主办或协办时须填理由并确认');
  });

  it('没有可办项时只显示环节，不渲染表单', () => {
    const html = renderToStaticMarkup(<ReviewPanel view={view()} />);
    expect(html).toContain('当前环节 E04');
    expect(html).not.toContain('data-role="review-report"');
    expect(html).not.toContain('data-role="review-opinion"');
  });
});