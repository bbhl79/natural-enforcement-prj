// #97 口令校验器。纯函数，无库。期望规则码来自规格字面值。
import { describe, expect, it } from 'vitest';

import { rejectedPasswordRules } from '../src/domain/password-policy.ts';

describe('口令校验器', () => {
  it('9 位拒绝、10 位通过', () => {
    expect(rejectedPasswordRules({
      password: 'Ab1!xyZ2#',
      personnelCode: 'P-97',
    })).toEqual(['too-short']);
    expect(rejectedPasswordRules({
      password: 'Ab1!xyZ2#q',
      personnelCode: 'P-97',
    })).toEqual([]);
  });

  it('64 位通过、65 位拒绝', () => {
    const sixtyFour = 'Aa1!'.repeat(16);
    expect(sixtyFour).toHaveLength(64);
    expect(rejectedPasswordRules({
      password: sixtyFour,
      personnelCode: 'P-97',
    })).toEqual([]);
    expect(rejectedPasswordRules({
      password: `${sixtyFour}b`,
      personnelCode: 'P-97',
    })).toEqual(['too-long']);
  });

  it('两类拒绝、三类通过', () => {
    expect(rejectedPasswordRules({
      password: 'aabbccdde1',
      personnelCode: 'P-97',
    })).toEqual(['insufficient-classes']);
    expect(rejectedPasswordRules({
      password: 'aabbccdd1A',
      personnelCode: 'P-97',
    })).toEqual([]);
  });

  it('连续 3 位通过、连续 4 位拒绝，含降序和大小写', () => {
    expect(rejectedPasswordRules({
      password: 'AbcXy1!mnp',
      personnelCode: 'P-97',
    })).toEqual([]);
    expect(rejectedPasswordRules({
      password: '123Xy!mnpQ',
      personnelCode: 'P-97',
    })).toEqual([]);
    expect(rejectedPasswordRules({
      password: 'AbcdXy1!mn',
      personnelCode: 'P-97',
    })).toEqual(['sequential']);
    expect(rejectedPasswordRules({
      password: '9876Xy!abQ',
      personnelCode: 'P-97',
    })).toEqual(['sequential']);
  });

  it('重复 3 次通过、重复 4 次拒绝', () => {
    expect(rejectedPasswordRules({
      password: 'aaaXy1!mnp',
      personnelCode: 'P-97',
    })).toEqual([]);
    expect(rejectedPasswordRules({
      password: 'aaaaXy1!mn',
      personnelCode: 'P-97',
    })).toEqual(['repeated']);
  });

  it('常见弱口令拒绝，其余规则都通过时只返回这一条', () => {
    expect(rejectedPasswordRules({
      password: 'Password1!',
      personnelCode: 'P-97',
    })).toEqual(['common']);
  });

  it('口令包含本人工号时拒绝，不区分大小写', () => {
    expect(rejectedPasswordRules({
      password: 'xxp-95-okY1!',
      personnelCode: 'P-95-OK',
    })).toEqual(['contains-code']);
    expect(rejectedPasswordRules({
      password: 'xxp-96-okY1!',
      personnelCode: 'P-95-OK',
    })).toEqual([]);
  });

  it('本人改密时不得与当前口令相同', () => {
    expect(rejectedPasswordRules({
      password: 'Ab1!xyZ2#q',
      personnelCode: 'P-97',
      currentPassword: 'Ab1!xyZ2#q',
    })).toEqual(['same-as-current']);
    expect(rejectedPasswordRules({
      password: 'Ab1!xyZ2#q',
      personnelCode: 'P-97',
      currentPassword: 'Ab1!xyZ2#Q',
    })).toEqual([]);
    expect(rejectedPasswordRules({
      password: 'Ab1!xyZ2#q',
      personnelCode: 'P-97',
    })).toEqual([]);
  });

  it('空串与纯空白不合规', () => {
    expect(rejectedPasswordRules({
      password: '',
      personnelCode: 'P-97',
    })).toEqual(['too-short', 'insufficient-classes']);
    expect(rejectedPasswordRules({
      password: '   ',
      personnelCode: 'P-97',
    })).toEqual(['too-short', 'insufficient-classes']);
    expect(rejectedPasswordRules({
      password: '          ',
      personnelCode: 'P-97',
    })).toEqual(['insufficient-classes', 'repeated']);
  });

  it('多条同时不合规时一次返回全部规则码', () => {
    expect(rejectedPasswordRules({
      password: '1234',
      personnelCode: '1234',
      currentPassword: '1234',
    })).toEqual([
      'too-short',
      'insufficient-classes',
      'sequential',
      'common',
      'contains-code',
      'same-as-current',
    ]);
  });
});
