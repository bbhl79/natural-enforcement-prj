// 录入要件声明（ADR 0018；#207 协议 E 节「case 常量是唯一要件声明源」）。
//
// 声明＝三层叠加：公共层 8 项 ＋ 来源层（按线索来源的大类）＋ 类型层（按初步涉嫌违法类型）。
// 前端渲染表单与服务端判定缺件读同一份声明（ADR 0018「一份声明，两个用途」）。
//
// 依据引用按 ADR 0019 写「文件编号 + 条号」，指向文件表；违法类型编码按 ADR 0020 取
// `<法域短码>_<行为直述>`，要件键是 `type.<类型编码>.<字段>`。
//
// 本模块不依赖别的业务模块：来源大类与类型编码的合法性由调用方（HTTP 启动包）拿
// 空间字典模块的参照数据核，核过之后把「来源大类编码 + 类型编码集合」交给本模块叠加。

import { PUBLIC_LAYER_ITEMS } from './public-layer.ts';
import { SOURCE_LAYER_GROUPS } from './source-layer.ts';
import { TYPE_LAYER_ITEMS } from './type-layer.generated.ts';
import type { RequirementItem, TypeLayerItem } from './types.ts';

export { PUBLIC_LAYER_ITEMS } from './public-layer.ts';
export { SOURCE_LAYER_GROUPS, type SourceLayerGroup } from './source-layer.ts';
export { TYPE_LAYER_ITEMS } from './type-layer.generated.ts';
export {
  DOMAINS,
  PUBLIC_GROUPS,
  REQUIREMENT_CONSEQUENCES,
  REQUIREMENT_TIMINGS,
  SOURCE_GROUPS,
  TYPE_GROUPS,
} from './types.ts';
export type {
  BasisReference,
  Domain,
  RequirementConsequence,
  RequirementItem,
  RequirementTiming,
  TypeLayerItem,
} from './types.ts';

/**
 * 声明版本。改动声明（公共层、来源层、类型层任一处）时同时改这里。
 * 响应带它，前端按「组合 + 版本」在会话内缓存（#207 协议 E 节）。
 */
export const CLUE_REQUIREMENT_DECLARATION_VERSION = 'requirements-2026-10-24-01';

/** 叠加输入。来源大类编码取自线索来源编码表（1／5／22／3／21）。 */
export interface FormSchemaInput {
  readonly sourceGroupCode: string;
  readonly typeCodes: readonly string[];
}

/** 类型层按类型编码分组，便于按类型取并集。 */
const TYPE_LAYER_BY_TYPE = new Map<string, TypeLayerItem[]>();
for (const item of TYPE_LAYER_ITEMS) {
  const typeCode = item.key.split('.')[1];
  const bucket = TYPE_LAYER_BY_TYPE.get(typeCode);
  if (bucket) bucket.push(item);
  else TYPE_LAYER_BY_TYPE.set(typeCode, [item]);
}

/** 来源层按大类编码分组。 */
const SOURCE_LAYER_BY_GROUP = new Map(SOURCE_LAYER_GROUPS.map((group) => [group.sourceGroupCode, group]));

/**
 * 叠加三层，返回录入项。
 * 类型要件取并集（#192 决议第三条：键含类型编码，各类型的键互不相同，没有合并问题）。
 * 「附录外其他」类型没有类型层要件，只带公共层与来源层（GLOSSARY「附录外其他」）。
 */
export function buildFormSchemaItems(input: FormSchemaInput): RequirementItem[] {
  const items: RequirementItem[] = [...PUBLIC_LAYER_ITEMS];
  const sourceGroup = SOURCE_LAYER_BY_GROUP.get(input.sourceGroupCode);
  if (sourceGroup) items.push(...sourceGroup.items);
  for (const typeCode of input.typeCodes) {
    items.push(...(TYPE_LAYER_BY_TYPE.get(typeCode) ?? []));
  }
  return items;
}

/**
 * 录入环节被阻断的要件项集合。
 * ADR 0018 新增断言：录入环节被阻断的项集合，等于公共层与来源层后果为阻断的项集合，类型层为空集。
 * 类型层要件键以 `type.` 开头，据此分层，不另设层属性。
 */
export function blockingItems(items: readonly RequirementItem[]): RequirementItem[] {
  return items.filter((item) => item.consequence === '阻断' && !item.key.startsWith('type.'));
}
