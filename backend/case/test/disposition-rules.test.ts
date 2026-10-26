// 移送与停用机构池重新指定的领域规则单测（#216；规格 D 节）。
// 必填校验、发函日期缺省北京当日与补录、池重新指定的状态门槛。
import { describe, expect, it } from 'vitest';

import {
  CLUE_DISPOSITION_RULE_CODES,
  POOL_REASSIGN_FROM_STATUSES,
  TRANSFER_FROM_STATUSES,
  TRANSFERRED_OUT_STATUS,
  assessTransfer,
  beijingDateOf,
  parseLetterDate,
} from '../src/clue/disposition/index.ts';

describe('移送登记规则', () => {
  it('北京当日：按 UTC+8 日历日取值', () => {
    // 2026-10-25T03:00Z ＝ 北京 11:00，当日 2026-10-25。
    expect(beijingDateOf(new Date('2026-10-25T03:00:00.000Z'))).toBe('2026-10-25');
    // 2026-10-24T18:00Z ＝ 北京 10-25 02:00，跨日取北京侧。
    expect(beijingDateOf(new Date('2026-10-24T18:00:00.000Z'))).toBe('2026-10-25');
    // 2026-10-25T16:00Z ＝ 北京 10-26 00:00。
    expect(beijingDateOf(new Date('2026-10-25T16:00:00.000Z'))).toBe('2026-10-26');
  });

  it('发函日期补录：只收真实日历日，回卷即不合规', () => {
    expect(parseLetterDate('2026-10-20')).toBe('2026-10-20');
    expect(parseLetterDate('2026-02-30')).toBeNull();
    expect(parseLetterDate('2026-13-01')).toBeNull();
    expect(parseLetterDate('2026/10/20')).toBeNull();
    expect(parseLetterDate('')).toBeNull();
  });

  it('必填：移送机关、文书编号、原因任一缺失即 missing-disposition-fields', () => {
    const base = { documentNo: '粤自然移〔2026〕1 号', letterDateRaw: '', today: '2026-10-25', reason: '涉嫌污染环境罪' };
    expect(assessTransfer({ ...base, transferOrg: '' })).toEqual({
      ok: false,
      rule: 'missing-disposition-fields',
    });
    expect(assessTransfer({ ...base, documentNo: '' })).toEqual({
      ok: false,
      rule: 'missing-disposition-fields',
    });
    expect(assessTransfer({ ...base, reason: '  ' })).toEqual({
      ok: false,
      rule: 'missing-disposition-fields',
    });
  });

  it('发函日期缺省取北京当日，允许补录', () => {
    const base = { transferOrg: '市公安局', documentNo: 'X-2026-1', reason: '涉刑' };
    expect(
      assessTransfer({ ...base, letterDateRaw: '', today: '2026-10-25' }),
    ).toEqual({ ok: true, letterDate: '2026-10-25' });
    expect(
      assessTransfer({ ...base, letterDateRaw: '2026-10-20', today: '2026-10-25' }),
    ).toEqual({ ok: true, letterDate: '2026-10-20' });
    expect(
      assessTransfer({ ...base, letterDateRaw: '2026-02-30', today: '2026-10-25' }),
    ).toEqual({ ok: false, rule: 'invalid-letter-date' });
  });

  it('状态门槛与规则码封闭表就位', () => {
    expect(TRANSFER_FROM_STATUSES).toEqual(['in_pool', 'org_assigned', 'handler_assigned']);
    expect(POOL_REASSIGN_FROM_STATUSES).toEqual(['in_pool', 'pending_decision', 'held']);
    expect(TRANSFERRED_OUT_STATUS).toBe('transferred_out');
    expect(CLUE_DISPOSITION_RULE_CODES).toContain('missing-disposition-fields');
    expect(CLUE_DISPOSITION_RULE_CODES).toContain('invalid-letter-date');
    expect(CLUE_DISPOSITION_RULE_CODES).toContain('missing-reassign-reason');
  });
});
