import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { InvestigationPanel } from './InvestigationPanel';
import { DeadlinePanel, type DeadlineView } from './DeadlinePanel';

const view: DeadlineView = {
  caseId: 'case-1',
  sourceUrl: 'https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm',
  asOf: '2026-03-02',
  blocked: false,
  prompts: ['办案期限已届满。只提示，不阻断。'],
  handling: { startedOn: '2026-03-02', dueOn: '2026-06-01', paused: false },
  rows: [
    {
      id: 'row-1',
      ruleKey: 'case.handle',
      entrySeq: 1,
      procedureNode: 'E02',
      startingDocument: null,
      consumptionName: '继续消耗',
      ruleVersion: '2026-10-27',
      dayCount: 90,
      dayBasis: 'calendar',
      dueOn: '2026-06-01',
      needsManualConfirmation: false,
      confirmationTrace: null,
      rowStatus: 'open',
      revisionNo: 0,
    },
  ],
};

describe('期限页', () => {
  it('展示到期日、延长呈批和期间事件补登', () => {
    const html = renderToStaticMarkup(
      <DeadlinePanel view={view} message={null} onExtend={() => undefined} onPeriod={() => undefined} />,
    );
    expect(html).toContain('到期日 2026-06-01');
    expect(html).toContain('继续消耗');
    expect(html).toContain('延长办案期限');
    expect(html).toContain('期间事件登记或补登');
    expect(html).toContain('补登');
    expect(html).toContain('办案期限已届满。只提示，不阻断。');
    expect(html).toContain(view.sourceUrl);
  });

  it('调查页链到期限页', () => {
    const html = renderToStaticMarkup(
      <InvestigationPanel
        view={{
          id: 'case-1',
          status: 'in_progress',
          currentStage: 'E02',
          suspended: false,
          prompts: { extendDeadline: '延长', partyNotice: '告知' },
          entries: {
            inquiry: false,
            violation: false,
            suspend: false,
            resume: false,
            terminate: false,
            withdraw: false,
            close: false,
          },
        }}
      />,
    );
    expect(html).toContain('href="/case/case-1/deadline"');
    expect(html).toContain('查看期限');
  });
});
