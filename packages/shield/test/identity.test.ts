// #16 全局标识契约的机器可读断言（E5 前半）。
// 期望值为定案文档（docs/global-contract-identity-references.md §1）的独立字面编码：
// 契约常量一旦被 weakening，本文件即红——区分「校验缺失」与「校验拒绝」。
import { describe, expect, it } from 'vitest';
import {
  BUSINESS_NUMBER_RULE,
  CROSS_DOMAIN_REFERENCE_RULE,
  PRIMARY_KEY_RULE,
  isTechnicalPrimaryKey,
  requireCrossDomainReference,
} from '../src/index.js';

// ULID 规范（crockford 本人实现 README）的已知良好样例：26 位大写 Crockford Base32
const KNOWN_GOOD_ULID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

describe('#16 §1.1 主键规则：全局唯一技术主键', () => {
  it('主键为全局唯一、不可复用、无业务含义的技术主键（ULID）', () => {
    expect(PRIMARY_KEY_RULE).toEqual({
      keyKind: 'technical',
      format: 'ULID',
      globallyUnique: true,
      reusable: false,
      carriesBusinessMeaning: false,
    });
  });

  it('类型守卫只放行 ULID 形制的技术主键，业务编号形制被拒', () => {
    expect(isTechnicalPrimaryKey(KNOWN_GOOD_ULID)).toBe(true);
    expect(isTechnicalPrimaryKey('01arz3ndektsv4rrffq69g5fav')).toBe(false); // 小写不接受
    expect(isTechnicalPrimaryKey(`${KNOWN_GOOD_ULID}Z`)).toBe(false); // 27 位
    expect(isTechnicalPrimaryKey(KNOWN_GOOD_ULID.slice(0, 25))).toBe(false); // 25 位
    expect(isTechnicalPrimaryKey('01ARZ3NDEKTSV4RRFFQ69G5FA!')).toBe(false); // 非法字符
    expect(isTechnicalPrimaryKey('京自然资罚〔2026〕1号')).toBe(false); // 业务编号形制
    expect(isTechnicalPrimaryKey('')).toBe(false);
    expect(isTechnicalPrimaryKey(null)).toBe(false);
    expect(isTechnicalPrimaryKey(42)).toBe(false);
  });
});

describe('#16 §1.2 编号规则：编号 ≠ 主键', () => {
  it('业务编号与主键分离，可换可补，但永不充当引用键', () => {
    expect(BUSINESS_NUMBER_RULE).toEqual({
      separatedFromPrimaryKey: true,
      mutable: true,
      usableAsReferenceKey: false,
    });
  });
});

describe('#16 §1.3 引用规则：跨域引用一律用主键', () => {
  it('跨域引用只使用技术主键，业务编号禁用为引用键', () => {
    expect(CROSS_DOMAIN_REFERENCE_RULE).toEqual({
      referenceKey: 'primaryKey',
      forbiddenReferenceKeys: ['businessNumber'],
    });
  });

  it('requireCrossDomainReference 放行技术主键、拒绝业务编号', () => {
    expect(requireCrossDomainReference(KNOWN_GOOD_ULID)).toBe(KNOWN_GOOD_ULID);
    expect(() => requireCrossDomainReference('京自然资罚〔2026〕1号')).toThrow(/技术主键/);
    expect(() => requireCrossDomainReference(undefined)).toThrow(/技术主键/);
  });
});
