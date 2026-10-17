// #128 人员登记规则、执法证情况、角色顺序（纯函数）。期望按 #105 与原型 v0.4 独立写出。
import { describe, expect, it } from 'vitest';

import {
  PERSONNEL_POSTS,
  certStatusOf,
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

  it('初始口令过口令策略，含工号按本次填写的工号判断，不比口令历史', () => {
    expect(registrationRules({ ...valid, initialPassword: 'Th0360abc' })).toEqual(['too-short', 'contains-code']);
    expect(registrationRules({ ...valid, initialPassword: 'Gz@Field2026', code: 'FIELD' })).toEqual(['contains-code']);
  });
});

describe('执法证情况（北京时间日界，30 天内到期）', () => {
  const now = new Date('2026-10-17T15:59:00.000Z'); // 北京时间 2026-10-17 23:59
  const day = (text: string) => new Date(`${text}T00:00:00.000Z`);

  it('证号或有效期为空即未登记', () => {
    expect(certStatusOf(null, day('2030-01-01'), now)).toBe('none');
    expect(certStatusOf('  ', day('2030-01-01'), now)).toBe('none');
    expect(certStatusOf('C-1', null, now)).toBe('none');
  });

  it('有效期等于今天仍有效（临期）；早于今天已过期；30 天内为临期；更远为有效', () => {
    expect(certStatusOf('C-1', day('2026-10-17'), now)).toBe('expiring');
    expect(certStatusOf('C-1', day('2026-10-16'), now)).toBe('expired');
    expect(certStatusOf('C-1', day('2026-11-16'), now)).toBe('expiring');
    expect(certStatusOf('C-1', day('2026-11-17'), now)).toBe('valid');
  });

  it('跨过北京时间零点即按次日算', () => {
    const next = new Date('2026-10-17T16:00:00.000Z'); // 北京时间 2026-10-18 00:00
    expect(certStatusOf('C-1', day('2026-10-17'), next)).toBe('expired');
  });
});

describe('角色顺序', () => {
  it('按七个角色的固定顺序，去重', () => {
    expect(sortRoleNames(['系统管理', '经办', '内勤', '经办'])).toEqual(['内勤', '经办', '系统管理']);
  });
});
