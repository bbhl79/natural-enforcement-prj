// #128 人员登记规则、执法证情况、角色顺序（纯函数）。期望按 #105 与原型 v0.4 独立写出。
// #133 执法证登记：证件状态、资格判定、登记规则与前值。
import { describe, expect, it } from 'vitest';

import {
  PERSONNEL_POSTS,
  certPreviousValue,
  certStatusOf,
  certUpdateRules,
  hasEnforcementQualification,
  normalizeCertUpdate,
  parseCalendarDay,
  registrationRules,
} from '../src/index.ts';
import { sortRoleNames } from '../src/domain/personnel-profile.ts';

const valid = {
  code: 'TH0360',
  name: '邓雅',
  orgUnitId: 'org-1',
  mobilePhone: '13900007788',
  initialPassword: 'Gz@Field2026',
  roles: ['经办'],
  posts: [] as string[],
};

describe('登记规则（#105 故事 28、29）', () => {
  it('六项齐全、口令合规时没有规则码', () => {
    expect(registrationRules(valid)).toEqual([]);
  });

  it('岗位标记取值固定两项，可多选', () => {
    expect(PERSONNEL_POSTS).toEqual(['legal-review-lead', 'legal-affairs-leader']);
    expect(registrationRules({ ...valid, posts: ['legal-review-lead', 'legal-affairs-leader'] })).toEqual([]);
  });

  it('六项必填各自报缺；口令为空只报 password-required', () => {
    expect(registrationRules({
      code: ' ', name: '', orgUnitId: '', mobilePhone: '', initialPassword: '', roles: [' '], posts: [],
    })).toEqual([
      'personnel-code-required',
      'personnel-name-required',
      'org-unit-required',
      'mobile-phone-required',
      'roles-required',
      'password-required',
    ]);
  });

  it('手机号须为 11 位且以 1 开头；工号、姓名超长；岗位标记取值不认识', () => {
    expect(registrationRules({ ...valid, mobilePhone: '1390000778' })).toEqual(['mobile-phone-invalid']);
    expect(registrationRules({ ...valid, mobilePhone: '23900007788' })).toEqual(['mobile-phone-invalid']);
    expect(registrationRules({ ...valid, code: 'X'.repeat(33) })).toEqual(['personnel-code-too-long']);
    expect(registrationRules({ ...valid, name: '甲'.repeat(101) })).toEqual(['personnel-name-too-long']);
    expect(registrationRules({ ...valid, posts: ['法制审核负责人'] })).toEqual(['post-unknown']);
  });

  it('执法证可留空；要填须证号和有效期都填，有效期是真实日历日，证号最长 64', () => {
    expect(registrationRules({ ...valid, certNo: '', certExpiresOn: '' })).toEqual([]);
    expect(registrationRules({ ...valid, certNo: ' GD-0001 ', certExpiresOn: '2027-06-30' })).toEqual([]);
    expect(registrationRules({ ...valid, certNo: 'GD-0001' })).toEqual(['cert-expires-on-required']);
    expect(registrationRules({ ...valid, certExpiresOn: '2027-06-30' })).toEqual(['cert-no-required']);
    expect(registrationRules({ ...valid, certNo: 'X'.repeat(65), certExpiresOn: '2027-06-30' })).toEqual(['cert-no-too-long']);
    expect(registrationRules({ ...valid, certNo: 'GD-0001', certExpiresOn: '2027-02-29' })).toEqual(['cert-expires-on-invalid']);
    expect(registrationRules({ ...valid, certNo: 'GD-0001', certExpiresOn: '2028-02-29' })).toEqual([]);
    expect(parseCalendarDay('2027-13-01')).toBeNull();
    expect(parseCalendarDay('2027-06-30')?.toISOString()).toBe('2027-06-30T00:00:00.000Z');
  });

  it('初始口令过口令策略，含工号按本次填写的工号判断，不比口令历史', () => {
    expect(registrationRules({ ...valid, initialPassword: 'Th0360abc' })).toEqual(['too-short', 'contains-code']);
    expect(registrationRules({ ...valid, initialPassword: 'Gz@Field2026', code: 'FIELD' })).toEqual(['contains-code']);
  });
});

describe('执法证情况（北京时间日界，30 天内到期）', () => {
  const now = new Date('2026-10-17T15:59:00.000Z'); // 北京时间 2026-10-17 23:59
  const day = (text: string) => new Date(`${text}T00:00:00.000Z`);

  it('证号或有效期为空即未登记', () => {
    expect(certStatusOf(null, day('2030-01-01'), 'valid', now)).toBe('none');
    expect(certStatusOf('  ', day('2030-01-01'), 'valid', now)).toBe('none');
    expect(certStatusOf('C-1', null, 'valid', now)).toBe('none');
  });

  it('有效期等于今天仍有效（临期）；早于今天已过期；30 天内为临期；更远为有效', () => {
    expect(certStatusOf('C-1', day('2026-10-17'), 'valid', now)).toBe('expiring');
    expect(certStatusOf('C-1', day('2026-10-16'), 'valid', now)).toBe('expired');
    expect(certStatusOf('C-1', day('2026-11-16'), 'valid', now)).toBe('expiring');
    expect(certStatusOf('C-1', day('2026-11-17'), 'valid', now)).toBe('valid');
  });

  it('跨过北京时间零点即按次日算', () => {
    const next = new Date('2026-10-17T16:00:00.000Z'); // 北京时间 2026-10-18 00:00
    expect(certStatusOf('C-1', day('2026-10-17'), 'valid', next)).toBe('expired');
  });

  it('证件状态为「失效」即失效，不再按有效期推导（#133，Lei Hu 7-3）', () => {
    expect(certStatusOf('C-1', day('2030-01-01'), 'invalid', now)).toBe('invalid');
    expect(certStatusOf('C-1', day('2026-10-16'), 'invalid', now)).toBe('invalid');
    expect(certStatusOf(null, null, 'invalid', now)).toBe('none');
  });
});

describe('执法资格判定（#133 fail-closed）', () => {
  const day = (text: string) => new Date(`${text}T00:00:00.000Z`);
  const beforeMidnight = new Date('2026-10-17T15:59:00.000Z'); // 北京时间 2026-10-17 23:59
  const afterMidnight = new Date('2026-10-17T16:00:00.000Z'); // 北京时间 2026-10-18 00:00

  it('状态为「有效」且在有效期内才有资格；到期当天仍有效，次日零点起失效', () => {
    expect(hasEnforcementQualification('C-1', day('2026-10-17'), 'valid', beforeMidnight)).toBe(true);
    expect(hasEnforcementQualification('C-1', day('2026-10-17'), 'valid', afterMidnight)).toBe(false);
    expect(hasEnforcementQualification('C-1', day('2030-01-01'), 'valid', beforeMidnight)).toBe(true);
  });

  it('状态为「失效」，或证号、有效期缺一项，一律没有资格', () => {
    expect(hasEnforcementQualification('C-1', day('2030-01-01'), 'invalid', beforeMidnight)).toBe(false);
    expect(hasEnforcementQualification(null, day('2030-01-01'), 'valid', beforeMidnight)).toBe(false);
    expect(hasEnforcementQualification('  ', day('2030-01-01'), 'valid', beforeMidnight)).toBe(false);
    expect(hasEnforcementQualification('C-1', null, 'valid', beforeMidnight)).toBe(false);
  });
});

describe('执法证登记规则（#133）', () => {
  const filled = { certNo: ' GD-0001 ', certExpiresOn: '2031-09-16', certStatus: 'valid' };

  it('三项齐全时没有规则码；证号去掉首尾空白，有效期按日历日解析', () => {
    expect(certUpdateRules(filled)).toEqual([]);
    expect(normalizeCertUpdate(filled)).toEqual({
      certNo: 'GD-0001',
      certExpiresOn: new Date('2031-09-16T00:00:00.000Z'),
      certStatus: 'valid',
    });
  });

  it('三项各必填；证号最长 64；有效期须是真实日历日；状态只取有效、失效', () => {
    expect(certUpdateRules({ ...filled, certNo: '  ' })).toEqual(['cert-no-required']);
    expect(certUpdateRules({ ...filled, certNo: 'X'.repeat(65) })).toEqual(['cert-no-too-long']);
    expect(certUpdateRules({ ...filled, certExpiresOn: '' })).toEqual(['cert-expires-on-required']);
    expect(certUpdateRules({ ...filled, certExpiresOn: '2031-02-30' })).toEqual(['cert-expires-on-invalid']);
    expect(certUpdateRules({ ...filled, certStatus: '' })).toEqual(['cert-status-unknown']);
    expect(certUpdateRules({ ...filled, certStatus: '有效' })).toEqual(['cert-status-unknown']);
    expect(certUpdateRules({ certNo: '', certExpiresOn: '', certStatus: '暂扣' })).toEqual([
      'cert-no-required',
      'cert-expires-on-required',
      'cert-status-unknown',
    ]);
    expect(certUpdateRules({ ...filled, certStatus: 'invalid' })).toEqual([]);
    expect(normalizeCertUpdate({ ...filled, certStatus: '' })).toBeNull();
  });

  it('前值只写旧有效期和旧状态，不写证号；没有旧证时前值为空', () => {
    expect(certPreviousValue(new Date('2027-06-30T00:00:00.000Z'), 'valid')).toBe('expiresOn=2027-06-30;status=valid');
    expect(certPreviousValue(new Date('2027-06-30T00:00:00.000Z'), 'invalid')).toBe('expiresOn=2027-06-30;status=invalid');
    expect(certPreviousValue(null, 'valid')).toBeNull();
  });
});

describe('角色顺序', () => {
  it('按七个角色的固定顺序，去重', () => {
    expect(sortRoleNames(['系统管理', '经办', '内勤', '经办'])).toEqual(['内勤', '经办', '系统管理']);
  });
});
