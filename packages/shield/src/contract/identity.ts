// 统一契约：标识、主键与跨域引用规则（#16 §1 的机器可读断言）。
// 唯一事实源 = docs/global-contract-identity-references.md；本文件只做合成、不改定案。
// 编号字段细则归各业务子 Map（#16 §1.4），契约层只钉「编号 ≠ 主键、引用不用编号」。

/** #16 §1.1：所有实体一律全局唯一、不可复用、无业务含义的技术主键（ULID） */
export const PRIMARY_KEY_RULE = {
  keyKind: 'technical',
  format: 'ULID',
  globallyUnique: true,
  reusable: false,
  carriesBusinessMeaning: false,
} as const;

/** #16 §1.2：业务编号（案号、文号、线索编号等）是与主键分离的受管字段，永不充当引用键 */
export const BUSINESS_NUMBER_RULE = {
  separatedFromPrimaryKey: true,
  mutable: true,
  usableAsReferenceKey: false,
} as const;

/** #16 §1.3：跨域引用一律使用技术主键，不使用业务编号 */
export const CROSS_DOMAIN_REFERENCE_RULE = {
  referenceKey: 'primaryKey',
  forbiddenReferenceKeys: ['businessNumber'],
} as const;

/** 技术主键品牌类型：跨域引用字段只接受该类型（结构层禁止业务编号流入引用位） */
export type TechnicalPrimaryKey = string & { readonly __technicalPrimaryKey: unique symbol };

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** #16 §1.1 类型守卫：仅放行 26 位大写 Crockford Base32 形制的技术主键 */
export function isTechnicalPrimaryKey(value: unknown): value is TechnicalPrimaryKey {
  return typeof value === 'string' && ULID_PATTERN.test(value);
}

/** #16 §1.3 引用入口：跨域引用只放行技术主键，业务编号在此被拒 */
export function requireCrossDomainReference(value: unknown): TechnicalPrimaryKey {
  if (!isTechnicalPrimaryKey(value)) {
    throw new TypeError('跨域引用必须是技术主键（#16 §1.3：禁用业务编号作引用键）');
  }
  return value;
}
