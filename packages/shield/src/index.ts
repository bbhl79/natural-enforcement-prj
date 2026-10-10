// 统一契约载体公共出口（#47 定案：全仓唯一入口；绕过本文件互引 shield 内部路径
// 由结构测试拦截——tools/structural-test.sh 规则 shield-single-entry）。
// 契约内容 = #16 全局标识契约的机器可读断言
//（docs/global-contract-identity-references.md，只做合成不改定案）。
export {
  BUSINESS_NUMBER_RULE,
  CROSS_DOMAIN_REFERENCE_RULE,
  PRIMARY_KEY_RULE,
  isTechnicalPrimaryKey,
  requireCrossDomainReference,
} from './contract/identity.js';
export type { TechnicalPrimaryKey } from './contract/identity.js';
