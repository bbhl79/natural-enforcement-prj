// #128 人员登记规则、执法证情况、角色顺序（纯函数）。期望按 #105 与原型 v0.4 独立写出。
// #129 人员编辑与调岗规则、编辑差异（纯函数）。
import { describe, expect, it } from 'vitest';

import {
  PERSONNEL_POSTS,
  certStatusOf,
  parseCalendarDay,
  registrationRules,
  transferRules,
  updateDiff,
  updateRules,
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

const editing = {
  name: '陈晓宁',
  mobilePhone: '13800005521',
  roles: ['经办', '法制审核'],
  posts: [] as string[],
};

describe('编辑规则（#105 故事 33，#129）', () => {
  it('姓名、手机号、角色齐全时没有规则码；岗位标记可多选也可不选', () => {
    expect(updateRules(editing)).toEqual([]);
    expect(updateRules({ ...editing, posts: ['legal-review-lead', 'legal-affairs-leader'] })).toEqual([]);
  });

  it('不比口令策略：编辑不收口令', () => {
    expect(updateRules({ ...editing, name: 'Th0360abc' })).toEqual([]);
  });

  it('姓名为空或超长、手机号为空或格式不对、角色为空、标记不认识各报各的码', () => {
    expect(updateRules({ ...editing, name: '  ' })).toEqual(['personnel-name-required']);
    expect(updateRules({ ...editing, name: '甲'.repeat(101) })).toEqual(['personnel-name-too-long']);
    expect(updateRules({ ...editing, mobilePhone: '' })).toEqual(['mobile-phone-required']);
    expect(updateRules({ ...editing, mobilePhone: '1380000552' })).toEqual(['mobile-phone-invalid']);
    expect(updateRules({ ...editing, roles: [] })).toEqual(['roles-required']);
    expect(updateRules({ ...editing, posts: ['法制审核负责人'] })).toEqual(['post-unknown']);
    expect(updateRules({ ...editing, name: '', mobilePhone: '', roles: [''], posts: ['x'] })).toEqual([
      'personnel-name-required', 'mobile-phone-required', 'roles-required', 'post-unknown',
    ]);
  });

  it('角色认识与否要查库：库外规则不报 role-unknown（同登记，由服务追加）', () => {
    expect(updateRules({ ...editing, roles: ['经办', '管理员'] })).toEqual([]);
  });

  it('调岗目的地必填', () => {
    expect(transferRules('org-1')).toEqual([]);
    expect(transferRules('  ')).toEqual(['org-unit-required']);
  });
});

describe('编辑差异（#105:219 重复授予或摘除返回 200 不写留痕）', () => {
  const current = {
    name: '陈晓宁',
    mobilePhone: '13800005521',
    roles: ['经办', '法制审核'],
    posts: ['legal-review-lead'] as const,
  };

  it('什么都没改时差异全空', () => {
    expect(updateDiff({ ...editing, roles: ['法制审核', '经办'], posts: ['legal-review-lead'] }, current)).toEqual({
      name: '', mobilePhone: '', rolesToGrant: [], rolesToRevoke: [], postsToGrant: [], postsToRevoke: [],
    });
  });

  it('改名与改手机号各自成为一处差异；手机号现值为空时按改动算', () => {
    expect(updateDiff({ ...editing, name: ' 邓雅 ' }, current)).toMatchObject({ name: '邓雅', mobilePhone: '' });
    expect(updateDiff({ ...editing, mobilePhone: '13900007788' }, current)).toMatchObject({ name: '', mobilePhone: '13900007788' });
    expect(updateDiff(editing, { ...current, mobilePhone: null })).toMatchObject({ mobilePhone: '13800005521' });
  });

  it('加角色只列新加的，摘角色只列被摘的，都按七角色顺序', () => {
    expect(updateDiff({ ...editing, roles: ['法制审核', '系统管理', '内勤'] }, current)).toMatchObject({
      rolesToGrant: ['内勤', '系统管理'], rolesToRevoke: ['经办'],
    });
  });

  it('加标记只列新加的，摘标记只列被摘的，都按名册顺序', () => {
    expect(updateDiff({ ...editing, posts: ['legal-affairs-leader'] }, current)).toMatchObject({
      postsToGrant: ['legal-affairs-leader'], postsToRevoke: ['legal-review-lead'],
    });
    expect(updateDiff({ ...editing, posts: [] }, current)).toMatchObject({
      postsToGrant: [], postsToRevoke: ['legal-review-lead'],
    });
  });

  it('本次填写里重复的角色只算一处差异，不会插入两行', () => {
    const diff = updateDiff({ ...editing, roles: ['经办', '法制审核', '系统管理', '系统管理'] }, current);
    expect(diff.rolesToGrant).toEqual(['系统管理']);
    expect(diff.rolesToRevoke).toEqual([]);
  });
});
