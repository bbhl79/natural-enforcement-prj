// 用途：定义机构树的层级取值、维护操作码、名称规则与层级推导。
// 调用方：本模块机构服务与 AccessControlService 的数据范围判定。
// 边界：只定义常量与纯函数，不查库。
// 依据：#123
// 机构树（#105「机构树」，#123）：层级、操作码与名称规则。
// 机构树只分市、区、所三级，不建「科」（项目负责人 2026-10-17，A1）。

/** 机构层级：city 市、district 区、station 所。根机构固定为市。 */
export const ORG_UNIT_LEVELS = ['city', 'district', 'station'] as const;
/** 机构层级取值类型。 */
export type OrgUnitLevel = (typeof ORG_UNIT_LEVELS)[number];

/** 根机构固定层级：市。 */
export const ROOT_ORG_UNIT_LEVEL: OrgUnitLevel = 'city';

/** 读取机构树的操作码。 */
export const ORG_TREE_READ_OPCODE = 'org.tree.read';
/** 新建机构的操作码；根机构只经引导或种子通道建立。 */
export const ORG_UNIT_REGISTER_OPCODE = 'org.unit.register';
/** 机构改名的操作码。 */
export const ORG_UNIT_RENAME_OPCODE = 'org.unit.rename';
/** 停用机构的操作码。 */
export const ORG_UNIT_DEACTIVATE_OPCODE = 'org.unit.deactivate';

/** 机构名称最长字数（工程定，#123）。 */
export const ORG_UNIT_NAME_MAX_LENGTH = 100;

/**
 * 新建下级与改名的校验失败规则码（400 non-compliant，不写留痕）。
 * org-level-mismatch：层级不符（市下非区、区下非所、所下新建，或层级取值不认识）。
 * org-name-required：名称为空。org-name-too-long：名称超过 100 字。
 */
export type OrgUnitRuleCode = 'org-level-mismatch' | 'org-name-required' | 'org-name-too-long';

/** 判断取值是否为合法机构层级。 */
export function isOrgUnitLevel(value: unknown): value is OrgUnitLevel {
  return typeof value === 'string' && (ORG_UNIT_LEVELS as readonly string[]).includes(value);
}

/** 上级之下唯一允许新建的层级：市下只能建区，区下只能建所，所下不能再建（null）。 */
export function childLevelOf(parent: OrgUnitLevel): OrgUnitLevel | null {
  if (parent === 'city') return 'district';
  if (parent === 'district') return 'station';
  return null;
}

/** 名称规则。调用方先去掉首尾空白再比较。 */
export function orgUnitNameRules(name: string): OrgUnitRuleCode[] {
  if (name === '') return ['org-name-required'];
  if ([...name].length > ORG_UNIT_NAME_MAX_LENGTH) return ['org-name-too-long'];
  return [];
}
