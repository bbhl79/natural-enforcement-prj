// 撤回不派与结案的领域规则单测（#217；规格 B/D 节）。
// 四项原因逐字、至少一项、补充说明必填；不予立案／随旧线索办结说明必填。
import { describe, expect, it } from 'vitest';

import {
  CLUE_CLOSURE_RULE_CODES,
  DISPOSITION_RECORD_FROM_STATUS,
  REMINDER_KINDS,
  REMINDER_RESOLUTIONS,
  WITHDRAW_FROM_STATUS,
  WITHDRAW_REASONS,
  checkDispositionNote,
  checkWithdrawInput,
} from '../src/clue/closure/index.ts';

describe('撤回不派输入校验', () => {
  it('四项原因逐字采用原型', () => {
    expect(WITHDRAW_REASONS).toEqual([
      '同一地点不同违法',
      '新增情况',
      '原线索核查不属实需重派',
      '误判重复',
    ]);
  });

  it('至少勾一项原因：缺原因报 missing-withdraw-reason', () => {
    expect(checkWithdrawInput({ reasonCodes: [], note: '说明' })).toEqual({
      ok: false,
      rule: 'missing-withdraw-reason',
    });
  });

  it('原因不在四项之内报 invalid-withdraw-reason', () => {
    expect(checkWithdrawInput({ reasonCodes: ['新增情况', '乱写原因'], note: '说明' })).toEqual({
      ok: false,
      rule: 'invalid-withdraw-reason',
    });
  });

  it('补充说明必填：缺说明报 missing-withdraw-note', () => {
    expect(checkWithdrawInput({ reasonCodes: ['误判重复'], note: '  ' })).toEqual({
      ok: false,
      rule: 'missing-withdraw-note',
    });
  });

  it('多选合法原因且说明齐全：通过', () => {
    expect(
      checkWithdrawInput({
        reasonCodes: ['同一地点不同违法', '新增情况', '原线索核查不属实需重派', '误判重复'],
        note: '经核应派。',
      }),
    ).toEqual({ ok: true });
  });

  it('撤回不派只从「不派」出发', () => {
    expect(WITHDRAW_FROM_STATUS).toBe('held');
  });
});

describe('不予立案登记约束', () => {
  it('仅已派承办人可登记', () => {
    expect(DISPOSITION_RECORD_FROM_STATUS).toBe('handler_assigned');
  });

  it('处置说明必填', () => {
    expect(checkDispositionNote('')).toEqual({ ok: false });
    expect(checkDispositionNote('   ')).toEqual({ ok: false });
    expect(checkDispositionNote('经核查违法事实不成立。')).toEqual({ ok: true });
  });

  it('结案提醒类型与处理结果封闭', () => {
    expect(REMINDER_KINDS).toEqual(['no-case', 'transfer', 'case']);
    expect(REMINDER_RESOLUTIONS).toEqual(['withdraw', 'close-with-old']);
    expect(CLUE_CLOSURE_RULE_CODES).toContain('missing-disposition-fields');
    expect(CLUE_CLOSURE_RULE_CODES).toContain('unsupported-disposition');
  });
});
