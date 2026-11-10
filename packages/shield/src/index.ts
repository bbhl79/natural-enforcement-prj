// 统一契约载体公共出口（#47 定案：全仓唯一入口；绕过本文件互引 shield 内部路径
// 由结构测试拦截——tools/structural-test.sh 规则 shield-single-entry）。
// 契约内容 = #16 全局标识契约的机器可读断言
//（docs/global-contract-identity-references.md，只做合成不改定案）。
//
// 包内相对导入一律用 .ts 扩展名（不是 NodeNext 风格的 .js）：契约包无任何依赖，
// 且种子通道（backend/prisma/seed.mjs）经 prisma7.config.ts 以 node 原生
// --experimental-transform-types 运行——原生 ESM 不做 .js→.ts 改写，.js 扩展名
// 会让种子通道引不到本包。仓库其余三包（audit/queue/storage）同样是 .ts 形态。
export {
  BUSINESS_NUMBER_RULE,
  CROSS_DOMAIN_REFERENCE_RULE,
  PRIMARY_KEY_RULE,
  isTechnicalPrimaryKey,
  requireCrossDomainReference,
} from './contract/identity.ts';
export type { TechnicalPrimaryKey } from './contract/identity.ts';
export {
  OPCODES,
  SUPERVISION_ROLE,
  effectiveOpcodeRequirements,
  opcodeRequirements,
} from './contract/opcode.ts';
export type { OpcodeName, OpcodeRequirements, QualificationDemand } from './contract/opcode.ts';
// 技术主键生成（#16 §1.1 ULID）。契约包无任何依赖，身份／地理字典／留痕三包都允许
// 依赖它——技术主键生成器统一收敛到本包，三包与种子通道共用一份实现。
export { createMonotonicUlidGenerator, newUlid } from './contract/ulid.ts';
export type { MonotonicUlidGenerator, MonotonicUlidSources } from './contract/ulid.ts';
