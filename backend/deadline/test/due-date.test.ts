import { describe, expect, it } from 'vitest';

import {
  BUSINESS_EXCLUSION_NOTE,
  COMPLEX_CASE_REASON,
  DEADLINE_RULE_VERSION,
  MANUAL_CONFIRMATION_TRACE,
  OVERDUE_PROMPT,
  WORK_CALENDAR_SOURCE_URL,
  WORK_CALENDAR_V1,
  anchorKey,
  calculateDueDate,
  checkExtension,
  checkManualPeriod,
  checkSystemPeriod,
  exclusionsFromClock,
  findDeadlineRule,
  inclusiveInterval,
  mergeCalendars,
  planAnchor,
  planRevision,
} from '../src/index.ts';

const calendar = WORK_CALENDAR_V1;

describe('工作日历', () => {
  it('装入 2026 年放假与调休，并写明出处；2027 年留空', () => {
    expect(calendar.years).toEqual([2026]);
    expect(calendar.sourceUrl).toBe(WORK_CALENDAR_SOURCE_URL);
    expect(calendar.sourceUrl).toBe('https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm');
    expect(calendar.holidays.filter((day) => day.startsWith('2026-02-'))).toHaveLength(9);
    expect(calendar.holidays.filter((day) => day.startsWith('2026-10-'))).toHaveLength(7);
    expect(calendar.makeupWorkdays).toEqual([
      '2026-01-04',
      '2026-02-14',
      '2026-02-28',
      '2026-05-09',
      '2026-09-20',
      '2026-10-10',
    ]);
    expect(calendar.holidays).not.toContain('2027-01-01');
  });
});

describe('到期日', () => {
  it('立案日加 90 个日历日，起算日不计入，届满日遇节假日顺延', () => {
    const hit = calculateDueDate({
      startedOn: '2026-01-05',
      dayCount: 90,
      dayBasis: 'calendar',
      exclusions: [],
      extensionDays: 0,
      paused: false,
      calendar,
    });
    expect(hit.dueOn).toBe('2026-04-07');
    expect(hit.postponed).toBe(true);
    expect(hit.needsManualConfirmation).toBe(false);
  });

  it('起算日当天不计入', () => {
    const hit = calculateDueDate({
      startedOn: '2026-03-02',
      dayCount: 1,
      dayBasis: 'calendar',
      exclusions: [],
      extensionDays: 0,
      paused: false,
      calendar,
    });
    expect(hit.dueOn).toBe('2026-03-03');
  });

  it('在途日期不计入', () => {
    const hit = calculateDueDate({
      startedOn: '2026-03-02',
      dayCount: 90,
      dayBasis: 'calendar',
      exclusions: [inclusiveInterval('2026-03-10', '2026-03-11')],
      extensionDays: 0,
      paused: false,
      calendar,
    });
    expect(hit.dueOn).toBe('2026-06-02');
  });

  it('停表到续表的天数不计入；未恢复则停表', () => {
    const paired = exclusionsFromClock([
      { eventKind: 'stop', on: '2026-03-10' },
      { eventKind: 'continue', on: '2026-03-20' },
    ]);
    const hit = calculateDueDate({
      startedOn: '2026-03-02',
      dayCount: 90,
      dayBasis: 'calendar',
      exclusions: paired.intervals,
      extensionDays: 0,
      paused: paired.paused,
      calendar,
    });
    expect(paired.paused).toBe(false);
    expect(hit.dueOn).toBe('2026-06-10');

    const open = exclusionsFromClock([{ eventKind: 'stop', on: '2026-03-10' }]);
    const paused = calculateDueDate({
      startedOn: '2026-03-02',
      dayCount: 90,
      dayBasis: 'calendar',
      exclusions: open.intervals,
      extensionDays: 0,
      paused: open.paused,
      calendar,
    });
    expect(paused.paused).toBe(true);
    expect(paused.dueOn).toBeNull();
  });

  it('工作日计入调休上班日，跳过普通周末', () => {
    const makeup = calculateDueDate({
      startedOn: '2026-01-03',
      dayCount: 1,
      dayBasis: 'working',
      exclusions: [],
      extensionDays: 0,
      paused: false,
      calendar,
    });
    expect(makeup.dueOn).toBe('2026-01-04');
    const weekend = calculateDueDate({
      startedOn: '2026-01-05',
      dayCount: 5,
      dayBasis: 'working',
      exclusions: [],
      extensionDays: 0,
      paused: false,
      calendar,
    });
    expect(weekend.dueOn).toBe('2026-01-12');
  });

  it('工作日跨入 2027 年时提示人工确认，不给出到期日', () => {
    const hit = calculateDueDate({
      startedOn: '2026-12-31',
      dayCount: 1,
      dayBasis: 'working',
      exclusions: [],
      extensionDays: 0,
      paused: false,
      calendar,
    });
    expect(hit.needsManualConfirmation).toBe(true);
    expect(hit.dueOn).toBeNull();
    expect(hit.trace).toBe(MANUAL_CONFIRMATION_TRACE);
  });

  it('超期提示不替代到期日', () => {
    expect(OVERDUE_PROMPT).toContain('只提示');
  });
});

describe('延长上限', () => {
  it('超过 30 日不写案情特别复杂则拒绝，写了则放行', () => {
    expect(checkExtension(31, '').ok).toBe(false);
    expect(checkExtension(31, '需要补充材料').ok).toBe(false);
    const allowed = checkExtension(31, `本案${COMPLEX_CASE_REASON}，需继续调查`);
    expect(allowed).toEqual({ ok: true, complex: true });
    expect(checkExtension(30, '').ok).toBe(true);
  });
});

describe('四维锚点与规则', () => {
  it('起算文书不进入锚点键；法审再送审重新起算并保存规则版本', () => {
    const first = anchorKey({ caseId: 'c1', ruleKey: 'legal-review.round', entrySeq: 1, procedureNode: 'E07' });
    const sameDocument = anchorKey({ caseId: 'c1', ruleKey: 'legal-review.round', entrySeq: 1, procedureNode: 'E07' });
    const nextRound = anchorKey({ caseId: 'c1', ruleKey: 'legal-review.round', entrySeq: 2, procedureNode: 'E07' });
    expect(first).toBe(sameDocument);
    expect(nextRound).not.toBe(first);
    const planned = planAnchor({
      caseId: 'c1',
      ruleKey: 'legal-review.round',
      entrySeq: 2,
      procedureNode: 'E07',
      startingDocument: '法制审核意见书',
      startedOn: '2026-01-05',
      exclusions: [],
      extensionDays: 0,
      paused: false,
      calendar,
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.plan.rule.consumption).toBe('restart');
    expect(planned.plan.rule.version).toBe(DEADLINE_RULE_VERSION);
    expect(planned.plan.rule.extensionAllowance).toBe(10);
    expect(planned.plan.startingDocument).toBe('法制审核意见书');
    expect(planned.plan.due.dueOn).toBe('2026-01-12');
    expect(findDeadlineRule('hearing.apply')?.consumption).toBe('restart');
    expect(findDeadlineRule('case.handle')?.consumption).toBe('continue');
  });

  it('重新告知的听证申请期按五个工作日重新起算', () => {
    const planned = planAnchor({
      caseId: 'c1',
      ruleKey: 'hearing.apply',
      entrySeq: 2,
      procedureNode: 'E05',
      startingDocument: '行政处罚告知书',
      startedOn: '2026-01-05',
      exclusions: [],
      extensionDays: 99,
      paused: true,
      calendar,
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.plan.due.dueOn).toBe('2026-01-12');
    expect(planned.plan.due.paused).toBe(false);
  });
});

describe('换日历修订', () => {
  it('未届满的工作日期限追加修订；当事人期限不提前；已届满和视为放弃不动', () => {
    const next = mergeCalendars(calendar, [
      { version: 'test-makeup', year: 2026, holidays: [], makeupWorkdays: ['2026-09-19'], sourceUrl: 'https://example.test/calendar' },
    ]);
    const shared = {
      dayBasis: 'working' as const,
      startedOn: '2026-09-18',
      dayCount: 5,
      dueOn: '2026-09-24',
      historicalDueOns: ['2026-09-24'],
      asOf: '2026-03-02',
      calendar: next,
    };
    const review = planRevision({ ...shared, rowStatus: 'open', partyFacing: false });
    expect(review).toMatchObject({ action: 'append', dueOn: '2026-09-23', clamped: false });
    const hearing = planRevision({ ...shared, rowStatus: 'open', partyFacing: true });
    expect(hearing).toMatchObject({ action: 'append', dueOn: '2026-09-24', clamped: true });
    expect(planRevision({ ...shared, rowStatus: 'open', partyFacing: false, dueOn: '2026-01-12', asOf: '2026-03-02' }).action).toBe('keep');
    expect(planRevision({ ...shared, rowStatus: 'deemed-waived', partyFacing: true }).action).toBe('keep');
    expect(planRevision({ ...shared, dayBasis: 'calendar', rowStatus: 'open', partyFacing: false }).action).toBe('keep');
  });

  it('装入 2027 年后，原先需人工确认的工作日期限可以算出到期日', () => {
    const next = mergeCalendars(calendar, [
      { version: '2027-installed', year: 2027, holidays: ['2027-01-01'], makeupWorkdays: [], sourceUrl: WORK_CALENDAR_SOURCE_URL },
    ]);
    const revised = planRevision({
      dayBasis: 'working',
      rowStatus: 'open',
      partyFacing: false,
      startedOn: '2026-12-31',
      dayCount: 1,
      dueOn: null,
      historicalDueOns: [],
      asOf: '2026-03-02',
      calendar: next,
    });
    expect(revised).toMatchObject({ action: 'append', dueOn: '2027-01-04', needsManualConfirmation: false });
  });
});

describe('期间事件', () => {
  it('人工登记缺理由、缺依据或区间颠倒时拒绝；系统事件不要求理由', () => {
    expect(checkManualPeriod({
      eventKind: 'in-transit',
      reason: '  ',
      basisLabel: '邮递在途',
      startedOn: '2026-03-10',
      endedOn: '2026-03-11',
      backfill: true,
    }).ok).toBe(false);
    expect(checkManualPeriod({
      eventKind: 'appraisal',
      reason: '补登鉴定',
      basisLabel: ' ',
      startedOn: '2026-03-01',
      endedOn: '2026-03-05',
      backfill: true,
    }).ok).toBe(false);
    const inverted = checkManualPeriod({
      eventKind: 'hearing',
      reason: '补登听证',
      basisLabel: '听证',
      startedOn: '2026-04-08',
      endedOn: '2026-04-01',
      backfill: true,
    });
    expect(inverted).toMatchObject({ ok: false, reason: 'invalid-interval' });
    const system = checkSystemPeriod({
      eventKind: 'hearing',
      basisLabel: '听证受理到终结',
      startedOn: '2026-04-01',
      endedOn: '2026-04-08',
    });
    expect(system.ok).toBe(true);
    const business = checkManualPeriod({
      eventKind: 'business-exclusion',
      reason: '中止期间补登',
      basisLabel: '中止调查',
      startedOn: '2026-03-01',
      endedOn: '2026-03-05',
      backfill: false,
    });
    expect(business.ok).toBe(true);
    if (!business.ok) return;
    expect(business.event.basisNote).toBe(BUSINESS_EXCLUSION_NOTE);
  });
});
