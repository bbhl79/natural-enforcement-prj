// 保密报告工单领域规则单测（#225）。
// 锁行为：三态只进不退；默认 24 小时时限从发现时刻起算；提醒只给待报工单；
// 提醒计算只读注入的当前时刻，不读系统时钟。
import { describe, expect, it } from 'vitest';

import {
  SECRECY_REPORT_DEADLINE_HOURS,
  SECRECY_REPORT_STATUSES,
  SECRECY_REPORT_STATUS_LABELS,
  checkSecrecyReportTransition,
  secrecyReportDueAt,
  secrecyReportReminder,
} from '../src/secrecy-report/index.ts';

const DISCOVERED = new Date('2026-10-26T06:00:00.000Z');
const HOUR = 60 * 60 * 1000;

describe('保密报告工单状态机（#225）', () => {
  it('三态为待报／已报／已回执', () => {
    expect([...SECRECY_REPORT_STATUSES]).toEqual(['pending_report', 'reported', 'receipted']);
    expect(SECRECY_REPORT_STATUSES.map((s) => SECRECY_REPORT_STATUS_LABELS[s])).toEqual(['待报', '已报', '已回执']);
  });

  it('待报→已报→已回执合法', () => {
    expect(checkSecrecyReportTransition('pending_report', 'report')).toEqual({ ok: true, to: 'reported' });
    expect(checkSecrecyReportTransition('reported', 'receipt')).toEqual({ ok: true, to: 'receipted' });
  });

  it('跳步、回退、终态再迁移一律 invalid-state', () => {
    expect(checkSecrecyReportTransition('pending_report', 'receipt')).toEqual({ ok: false, reason: 'invalid-state' });
    expect(checkSecrecyReportTransition('reported', 'report')).toEqual({ ok: false, reason: 'invalid-state' });
    expect(checkSecrecyReportTransition('receipted', 'report')).toEqual({ ok: false, reason: 'invalid-state' });
    expect(checkSecrecyReportTransition('receipted', 'receipt')).toEqual({ ok: false, reason: 'invalid-state' });
    expect(checkSecrecyReportTransition('destroyed', 'receipt')).toEqual({ ok: false, reason: 'invalid-state' });
  });
});

describe('报告时限提醒（#225，默认 24h，假时钟）', () => {
  it('默认时限 24 小时，从发现时刻起算', () => {
    expect(SECRECY_REPORT_DEADLINE_HOURS).toBe(24);
    expect(secrecyReportDueAt(DISCOVERED).toISOString()).toBe('2026-10-27T06:00:00.000Z');
  });

  it('时限内：未超时，剩余分钟按注入时刻计算', () => {
    const due = secrecyReportDueAt(DISCOVERED);
    const r = secrecyReportReminder('pending_report', due, new Date(DISCOVERED.getTime() + 23 * HOUR));
    expect(r).toEqual({ dueAt: due, remainingMinutes: 60, overdue: false });
  });

  it('到期整点不算超时；超过一分钟算超时', () => {
    const due = secrecyReportDueAt(DISCOVERED);
    expect(secrecyReportReminder('pending_report', due, due)?.overdue).toBe(false);
    const late = secrecyReportReminder('pending_report', due, new Date(due.getTime() + 60_000));
    expect(late?.overdue).toBe(true);
    expect(late?.remainingMinutes).toBe(-1);
  });

  it('已报／已回执不再提醒；超时也不产生任何自动动作（只返回提醒数据）', () => {
    const due = secrecyReportDueAt(DISCOVERED);
    const farLate = new Date(due.getTime() + 30 * 24 * HOUR);
    expect(secrecyReportReminder('reported', due, farLate)).toBeNull();
    expect(secrecyReportReminder('receipted', due, farLate)).toBeNull();
    const r = secrecyReportReminder('pending_report', due, farLate);
    expect(Object.keys(r ?? {}).sort()).toEqual(['dueAt', 'overdue', 'remainingMinutes']);
  });
});
