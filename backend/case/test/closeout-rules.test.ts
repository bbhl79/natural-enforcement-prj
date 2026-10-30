// #270 送达（T24）、执行记载（T25）、结案（T26）纯规则：Q27、凭证、两支与 X10。
import { describe, expect, it } from 'vitest';

import {
  DELIVERY_MIN_DELIVERERS,
  closureBranchOf,
  isCivilDay,
  readClosureContent,
  readDeliveryRecord,
  readExecutionRecord,
  x10Guard,
} from '../src/closeout/index.ts';

describe('#270 送达', () => {
  it('回证路径要求送达人两人以上', () => {
    expect(DELIVERY_MIN_DELIVERERS).toBe(2);
    expect(
      readDeliveryRecord({
        kind: 'receipt',
        deliveredOn: '2026-10-30',
        deliverers: ['甲', '乙'],
      }),
    ).toEqual({
      ok: true,
      content: {
        kind: 'receipt',
        deliveredOn: '2026-10-30',
        deliverers: ['甲', '乙'],
        reasonRecord: null,
        announcementMaterials: [],
        note: null,
      },
    });
    expect(
      readDeliveryRecord({ kind: 'receipt', deliveredOn: '2026-10-30', deliverers: ['甲'] }),
    ).toMatchObject({ ok: false, hit: { reason: 'insufficient-deliverers' } });
  });

  it('公告路径要求原因经过与公告材料同时具备', () => {
    expect(
      readDeliveryRecord({
        kind: 'announcement',
        deliveredOn: '2026-10-30',
        reasonRecord: '当事人下落不明',
        announcementMaterials: ['公告截图.pdf'],
      }),
    ).toMatchObject({ ok: true, content: { kind: 'announcement', deliverers: [] } });
    expect(
      readDeliveryRecord({
        kind: 'announcement',
        deliveredOn: '2026-10-30',
        reasonRecord: '当事人下落不明',
        announcementMaterials: [],
      }),
    ).toMatchObject({ ok: false, hit: { reason: 'missing-announcement-materials' } });
    expect(
      readDeliveryRecord({ kind: 'announcement', deliveredOn: '2026-10-30', announcementMaterials: ['公告.pdf'] }),
    ).toMatchObject({ ok: false, hit: { reason: 'missing-reason-record' } });
  });

  it('送达完成日与类型不合规拒绝', () => {
    expect(isCivilDay('2026-10-30')).toBe(true);
    expect(isCivilDay('2026-02-30')).toBe(false);
    expect(isCivilDay('2026/10/30')).toBe(false);
    expect(
      readDeliveryRecord({ kind: 'fax', deliveredOn: '2026-10-30', deliverers: ['甲', '乙'] }),
    ).toMatchObject({ ok: false, hit: { reason: 'invalid-kind' } });
    expect(
      readDeliveryRecord({ kind: 'receipt', deliveredOn: '2026-02-30', deliverers: ['甲', '乙'] }),
    ).toMatchObject({ ok: false, hit: { reason: 'invalid-delivered-on' } });
  });
});

describe('#270 执行记载', () => {
  it('已申请法院强制执行须附申请书', () => {
    expect(readExecutionRecord({ kind: 'court-enforcement' })).toMatchObject({
      ok: false,
      hit: { reason: 'missing-attachment', message: '已申请法院强制执行须附申请书' },
    });
    expect(readExecutionRecord({ kind: 'court-enforcement', attachments: ['申请书.pdf'] })).toMatchObject({
      ok: true,
      content: { kind: 'court-enforcement', attachments: ['申请书.pdf'] },
    });
  });

  it('履行完毕须附缴款凭证等', () => {
    expect(readExecutionRecord({ kind: 'fulfilled' })).toMatchObject({
      ok: false,
      hit: { reason: 'missing-attachment', message: '履行完毕须附缴款凭证等' },
    });
    expect(readExecutionRecord({ kind: 'fulfilled', attachments: ['缴款凭证.pdf'] })).toMatchObject({ ok: true });
  });

  it('其他执行记载须写明事实', () => {
    expect(readExecutionRecord({ kind: 'other' })).toMatchObject({ ok: false, hit: { reason: 'missing-note' } });
    expect(readExecutionRecord({ kind: 'other', note: '分期缴纳' })).toMatchObject({
      ok: true,
      content: { kind: 'other', note: '分期缴纳', attachments: [] },
    });
  });
});

describe('#270 结案两支与 X10', () => {
  it('E11 是处罚支，E10 是不予处罚支，其他环节不能结案', () => {
    expect(closureBranchOf('E11')).toBe('penalty');
    expect(closureBranchOf('E10')).toBe('no-penalty');
    expect(closureBranchOf('E09')).toBeNull();
    expect(readClosureContent(null)).toEqual({ ok: true, content: { note: null } });
    expect(readClosureContent({ note: ' 已办结 ' })).toEqual({ ok: true, content: { note: '已办结' } });
    expect(readClosureContent({ note: 1 })).toMatchObject({ ok: false, hit: { reason: 'invalid-content' } });
  });

  it('X10：处罚决定未送达就执行记载或结案只警告（normative）', () => {
    expect(x10Guard({ branch: 'penalty', delivered: false })).toMatchObject({
      level: 'warn',
      code: 'X10',
      authority: 'normative',
    });
    expect(x10Guard({ branch: 'penalty', delivered: true })).toBeNull();
    expect(x10Guard({ branch: 'no-penalty', delivered: false })).toBeNull();
  });
});