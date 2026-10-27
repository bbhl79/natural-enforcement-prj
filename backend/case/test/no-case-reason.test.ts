// #226 不予立案理由两类互斥校验。
import { describe, expect, it } from 'vitest';

import { checkNoCaseReason } from '../src/clue/closure/index.ts';

describe('checkNoCaseReason（#226）', () => {
  it('(a) non-filing-grounds 至少一项成功', () => {
    const out = checkNoCaseReason({
      kind: 'non-filing-grounds',
      grounds: ['art16-2-no-violation-fact'],
      note: '核查无违法事实',
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.reason.kind).toBe('non-filing-grounds');
    }
  });

  it('(b) 末款三项全确认成功', () => {
    const out = checkNoCaseReason({
      kind: 'minor-corrected-no-harm',
      minor: { confirmed: true, note: '轻微' },
      timelyCorrection: { confirmed: true, note: '已及时纠正' },
      noHarm: { confirmed: true, note: '没有造成危害后果' },
    });
    expect(out.ok).toBe(true);
  });

  it('皆空拒绝', () => {
    expect(checkNoCaseReason({}).ok).toBe(false);
    expect(checkNoCaseReason(null).ok).toBe(false);
  });

  it('混选拒绝', () => {
    const out = checkNoCaseReason({
      kind: 'non-filing-grounds',
      grounds: ['art16-1-no-clear-actor'],
      minor: { confirmed: true, note: 'x' },
    });
    expect(out.ok).toBe(false);
  });

  it('末款三项仅确认部分拒绝', () => {
    const out = checkNoCaseReason({
      kind: 'minor-corrected-no-harm',
      minor: { confirmed: true, note: '轻微' },
      timelyCorrection: { confirmed: true, note: '已及时纠正' },
      // noHarm 缺
    });
    expect(out.ok).toBe(false);
  });

  it('(a) 无勾选项拒绝', () => {
    expect(checkNoCaseReason({ kind: 'non-filing-grounds', grounds: [] }).ok).toBe(false);
  });

  it('(a) 非法编码拒绝', () => {
    expect(
      checkNoCaseReason({ kind: 'non-filing-grounds', grounds: ['not-a-code'] }).ok,
    ).toBe(false);
  });
});
