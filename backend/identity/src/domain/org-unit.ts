// 机构树（#105「机构树」，#123）：层级、操作码与名称规则。
// 机构树只分市、区、所三级，不建「科」（Lei Hu 2026-10-17 22:14，A1）。

/** 机构层级：city 市、district 区、station 所。根机构固定为市。 */
export const ORG_UNIT_LEVELS = ['city', 'district', 'station'] as const;
export type OrgUnitLevel = (typeof ORG_UNIT_LEVELS)[number];

export const ROOT_ORG_UNIT_LEVEL: OrgUnitLevel = 'city';

export const ORG_TREE_READ_OPCODE = 'org.tree.read';
export const ORG_UNIT_REGISTER_OPCODE = 'org.unit.register';
export const ORG_UNIT_RENAME_OPCODE = 'org.unit.rename';

/** 机构名称最长字数（工程定，#123）。 */
export const ORG_UNIT_NAME_MAX_LENGTH = 100;

/**
 * 新建下级与改名的校验失败规则码（400 non-compliant，不写留痕）。
 * org-level-mismatch：层级不符（市下非区、区下非所、所下新建，或层级取值不认识）。
 * org-name-required：名称为空。org-name-too-long：名称超过 100 字。
 */
export type OrgUnitRuleCode = 'org-level-mismatch' | 'org-name-required' | 'org-name-too-long';

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
