// 案件聚合模块公共出口（#47/#51 定案：跨模块消费只许经本文件；内部路径导入由结构测试
// module-public-entry 拦截）。空壳阶段暂无对外查询/事件接口内容，形态约定先行。
// #210：录入要件声明是本模块的常量（ADR 0018「case 常量是唯一要件声明源」）。
export {
  CLUE_REQUIREMENT_DECLARATION_VERSION,
  DOMAINS,
  PUBLIC_GROUPS,
  PUBLIC_LAYER_ITEMS,
  REQUIREMENT_CONSEQUENCES,
  REQUIREMENT_TIMINGS,
  SOURCE_GROUPS,
  SOURCE_LAYER_GROUPS,
  TYPE_GROUPS,
  TYPE_LAYER_ITEMS,
  blockingItems,
  buildFormSchemaItems,
} from './clue/requirements/index.ts';
export type {
  BasisReference,
  Domain,
  FormSchemaInput,
  RequirementConsequence,
  RequirementItem,
  RequirementTiming,
  SourceLayerGroup,
  TypeLayerItem,
} from './clue/requirements/index.ts';
export { CaseModule } from './case.module.ts';
