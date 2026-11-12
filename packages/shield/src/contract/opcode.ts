// 用途：登记合法操作码的名册，给出每条操作码的三项要求，并算出多角色下的有效要求。
// 操作码名册（#71 决议、#96）。名册外的字符串不是操作码。
// 允许行不在这里。这里只记每条操作码的三项要求，以及随角色变化的覆盖。
// 一人持有多个能放行该操作码的角色时，取要求最宽的一个。
// 入参角色必须是当前仍能放行该操作码的角色。不能放行的角色不参与取宽。
// 名册由三部分合并成冻结的 CATALOG：CASE_OPCODES 是手写条目（clue.*、case.*、doc.*、legal.*）；
// ADMIN_CODES 是管理侧字面量数组（org.*、personnel.*、audit.admin.*、authz.binding.*、storage.*）；
// cfg.<对象>.<动作> 由 4 个对象与 5 个动作组合生成 20 个码。后两部分一律登记为 none、false、false。
// 三项要求的含义见 OpcodeRequirements。多角色的取法见 effectiveOpcodeRequirements 上方的注释。
// 调用方：backend/identity/src/services/access-control.service.ts，其中 check 与 listPermittedOpcodes
// 读取 OPCODES、opcodeRequirements、SUPERVISION_ROLE。前端各文件经包名 @natural-enforcement/shield
// 取 OpcodeName 类型，例如 frontend/src/opcodes.ts、frontend/src/shell/menu.ts。
// 边界：本文件无导入，只含常量与纯函数。不含允许行（角色—权限表），不做授权判定，不做对象级校验。
// 名册外的码，两个查询函数都返回 null，不抛错。
// tools/structural-test.sh 按文本读取本文件的 CASE_OPCODES、ADMIN_CODES、ADMIN_OBJECTS、ADMIN_ACTIONS，
// 用来检查路由注释里的操作码。改这四处的书写格式，须同步该脚本。
// 依据：docs/adr/0009-角色按职责与案件单环节流转.md（名册位置、监督允许行的边界）；
// docs/adr/0006-配置类对象共用一套版本与批准.md（cfg 组合码）；GLOSSARY.md「执法资格」「监督」。
// 待确认：qualification 与 mustBeCaseHandler 暂无生产代码读取方，运行时由谁按它们判定，
// 来源 backend/identity/src/services/access-control.service.ts。

/** 执法资格要求的全部取值，也是 OpcodeRequirements.qualification 的取值范围。当前无外部调用方。 */
export const QUALIFICATION_DEMANDS = ['none', 'operator', 'assignee'] as const;
/** QUALIFICATION_DEMANDS 的字面量联合类型。经 packages/shield/src/index.ts 再导出。 */
export type QualificationDemand = (typeof QUALIFICATION_DEMANDS)[number];

// 调用方：backend/identity/src/services/access-control.service.ts 的 effectiveGrantingRoles。
// backend/case/src/state-machine/catalog.ts 的 CASE_SUPERVISION_ROLE 另存一份，注明与本常量是同一字符串。
/** 监督角色名。改变主状态的判断不采用这个角色贡献的允许行。 */
export const SUPERVISION_ROLE = '监督';

/**
 * 名册为一条操作码登记的三项要求。名册只承载「角色 × 操作码」这一层，对象级校验不在这里。
 * 三项要求逐项含义见各字段注释。只有 changesPrimaryState 在生产代码里被读取。
 */
export interface OpcodeRequirements {
  /** none 不要求；operator 查操作的人；assignee 只查被指定的人 */
  readonly qualification: QualificationDemand;
  /** true：对象级须是本案主办人或协办人（见 case.discussion.record 条目注释）。false：名册层不要求。 */
  readonly mustBeCaseHandler: boolean;
  /** true：该动作改写线索主状态或归属，授权时不采用 SUPERVISION_ROLE 贡献的允许行。不能按角色覆盖。 */
  readonly changesPrimaryState: boolean;
}

interface OpcodeEntry {
  readonly requirements: OpcodeRequirements;
  readonly roleOverrides?: Readonly<
    Record<string, Partial<Pick<OpcodeRequirements, 'qualification' | 'mustBeCaseHandler'>>>
  >;
}

// 要求的宽度，数值越大要求越宽：none 不要求，最宽；operator 要求最严，最窄。
// 只用于 effectiveOpcodeRequirements 在多个放行角色之间比较 qualification。
const QUALIFICATION_WIDTH: Record<QualificationDemand, number> = {
  none: 2,
  assignee: 1,
  operator: 0,
};

// 登记一条名册条目。参数依次是 qualification、mustBeCaseHandler、changesPrimaryState。
// roleOverrides 按角色名覆盖 qualification 与 mustBeCaseHandler，不能覆盖 changesPrimaryState。
function entry(
  qualification: QualificationDemand,
  mustBeCaseHandler: boolean,
  changesPrimaryState: boolean,
  roleOverrides?: OpcodeEntry['roleOverrides'],
): OpcodeEntry {
  return { requirements: { qualification, mustBeCaseHandler, changesPrimaryState }, roleOverrides };
}

// 手写条目，键即操作码名。OpcodeName 的第一部分由这些键推出。
const CASE_OPCODES = {
  'clue.org.assign': entry('none', false, true),
  'clue.handler.assign': entry('assignee', false, true),
  'clue.verify.start': entry('operator', true, true),
  // ---- #210 新增 11 个线索操作码（#207 协议 A 节「操作码终稿」）----
  // 名册只承载「角色 × 操作码」这一层。对象级校验（录入人、机构内勤、承办人等）
  // 归 case 服务（#207 协议 A 节），故这 11 码一律不要求执法资格、不必是主办人。
  // 「改变主状态」只表示该动作会改写线索主状态或归属，因而监督角色贡献的允许行
  // 对它不生效（改变主状态的判断不采用监督角色贡献的允许行）。
  'clue.register': entry('none', false, true),
  'clue.dispatch.decide': entry('none', false, true),
  'clue.withdraw.undo': entry('none', false, true),
  'clue.disposition.record': entry('none', false, true),
  'clue.reminder.resolve': entry('none', false, true),
  'clue.item.supplement': entry('none', false, false),
  'clue.verify.retry': entry('none', false, false),
  'clue.reference.read': entry('none', false, false),
  'clue.geometry.update': entry('none', false, true),
  'clue.designate.request': entry('none', false, false),
  'clue.pool.reassign': entry('none', false, true),
  'case.open': entry('operator', true, true),
  'doc.draft': entry('operator', true, false),
  'doc.submit': entry('operator', true, false),
  'case.reassign.submit': entry('operator', true, false, {
    内勤: { mustBeCaseHandler: false },
    // #269 G5：法制审核接收人改派由归属那一级的法制审核负责人执行。
    行政审核: { qualification: 'none', mustBeCaseHandler: false },
  }),
  'legal.review.request': entry('none', false, false, {
    经办: { qualification: 'operator', mustBeCaseHandler: true },
  }),
  'legal.opinion.draft': entry('none', false, false),
  'legal.opinion.submit': entry('none', false, false),
  'doc.admin.review': entry('none', false, false),
  'doc.approve': entry('none', false, true),
  // #240：审理意见签出。只增码、不增角色；允许行只授行政审核（#71 回写见 #230）。
  'case.review.record': entry('none', false, false),
  // #269：集体讨论记录录入。授经办；对象级须本案主办或协办。
  'case.discussion.record': entry('operator', true, false),
  // #270：执行记载录入（T25）。授经办；对象级须本案主办或协办；推进主状态。
  'case.execution.record': entry('operator', true, true),
  'clue.read': entry('none', false, false),
  'case.read': entry('none', false, false),
  'doc.read': entry('none', false, false),
  'clue.export': entry('none', false, false),
  'case.export': entry('none', false, false),
  'doc.export': entry('none', false, false),
} as const satisfies Record<string, OpcodeEntry>;

// cfg.<对象>.<动作> 的两个维度，两两组合成 20 个码，由下方循环登记。组合方式依据 ADR 0006。
const ADMIN_OBJECTS = ['template', 'rule', 'calendar', 'metric'] as const;
const ADMIN_ACTIONS = ['submit', 'approve', 'void', 'withdraw', 'read'] as const;

/** 管理侧操作码名册。字面量数组，字面量联合的来源。 */
const ADMIN_CODES = [
  // 机构树（#105「机构树」，#123）与机构停用（#124）。
  'org.tree.read',
  'org.unit.register',
  'org.unit.rename',
  'org.unit.deactivate',
  // 人员登记、列表与卡片（#105「人员与登录凭据」，#128）。其余 personnel.profile.* 随 #130 入册；personnel.cert.update 随 #133 入册。
  'personnel.profile.read',
  'personnel.profile.register',
  // 执法证登记（#105「执法证（#85）」，#133）：只给系统管理。通用授权不因执法资格拒绝。
  'personnel.cert.update',
  // 人员编辑与调岗（#105「人员与登录凭据」，#129）。调岗和改角色并入本码，岗位标记的维护也用它。
  'personnel.profile.update',
  // 人员停用、恢复与结束全部会话（#105「人员与登录凭据」，#130）。只给系统管理。
  'personnel.profile.deactivate',
  'personnel.profile.restore',
  'personnel.sessions.end',
  'personnel.locked.read',
  'personnel.locked.release',
  'personnel.password.reset',
  // #125（ADR 0013）：人员导出，只给系统管理。导出写共用留痕表的 personnel.exported。
  'personnel.profile.export',
  'audit.admin.read',
  'audit.admin.export',
  'authz.binding.submit',
  'authz.binding.approve',
  // #224：涉密误传标记／隔离。只给系统管理；对象级再收窄到目标所属根机构。
  'storage.quarantine.mark',
  // #225：保密报告工单（生成、登记已报、录入回执、时限提醒）。只给系统管理；对象级同 #224 收窄到根机构。
  'storage.secrecy-report.manage',
] as const;

// 管理侧条目表：先登记 cfg 组合码，再登记 ADMIN_CODES。两部分都是 none、false、false，没有角色覆盖。
const ADMIN_OPCODES: Record<string, OpcodeEntry> = {};
for (const object of ADMIN_OBJECTS) {
  for (const action of ADMIN_ACTIONS) {
    ADMIN_OPCODES[`cfg.${object}.${action}`] = entry('none', false, false);
  }
}
for (const code of ADMIN_CODES) {
  ADMIN_OPCODES[code] = entry('none', false, false);
}

// 无原型字典：constructor、toString、__proto__ 等继承属性不会命中名册（#103 评审）。
const CATALOG: Readonly<Record<string, OpcodeEntry>> = Object.freeze(
  Object.assign(Object.create(null) as Record<string, OpcodeEntry>, CASE_OPCODES, ADMIN_OPCODES),
);

// 按名册自有键取条目。名册外的字符串返回 null，不抛错。
function lookup(opcode: string): OpcodeEntry | null {
  return Object.hasOwn(CATALOG, opcode) ? (CATALOG[opcode] ?? null) : null;
}

/**
 * 名册里全部操作码名的冻结数组。顺序依次是手写条目、cfg 组合码、ADMIN_CODES。
 * 调用方：backend/identity/src/services/access-control.service.ts 的 listPermittedOpcodes，
 * 它按这个顺序产出会话的操作码清单。
 */
export const OPCODES = Object.freeze(Object.keys(CATALOG)) as readonly string[];

/**
 * 名册里的操作码名（字面量联合）。
 *
 * 前端与后端共用这一份：前端把界面上的操作码按本类型标注，后端改名或废码时前端编译
 * 即报错，不必等运行到某个页面才发现按钮永远不出现。
 */
export type OpcodeName =
  | keyof typeof CASE_OPCODES
  | (typeof ADMIN_CODES)[number]
  | `cfg.${(typeof ADMIN_OBJECTS)[number]}.${(typeof ADMIN_ACTIONS)[number]}`;

/**
 * 取一条操作码在名册里登记的基础要求，不含按角色的覆盖。名册外的码返回 null。
 * 调用方：backend/identity/src/services/access-control.service.ts。check 用它判断操作码是否在名册内，
 * effectiveGrantingRoles 读取其中的 changesPrimaryState。
 */
export function opcodeRequirements(opcode: string): OpcodeRequirements | null {
  const found = lookup(opcode);
  if (!found) return null;
  return found.requirements;
}

// 多角色的取法：grantingRoleNames 里的角色逐个处理，第一个角色的结果作初值。
// 每个角色先用自己的 roleOverrides 替换名册基础值，没有覆盖就用基础值，再参与比较。
// qualification 取宽度更大者，宽度见 QUALIFICATION_WIDTH。
// mustBeCaseHandler 只要有一个角色不要求，结果就不要求。
// 两项各自独立取宽，结果不一定等于其中某一个角色的整套要求。
// changesPrimaryState 不随角色变化，取名册基础值。入参为空数组时，返回名册基础要求。
// 调用方：当前无生产代码调用方。用例见 packages/shield/test/opcode.test.ts、integration/e2-access-matrix.test.ts。
/** 在能放行该操作码的角色里取要求最宽的一个。名册外返回 null。 */
export function effectiveOpcodeRequirements(
  opcode: string,
  grantingRoleNames: readonly string[],
): OpcodeRequirements | null {
  const found = lookup(opcode);
  if (!found) return null;
  let qualification = found.requirements.qualification;
  let mustBeCaseHandler = found.requirements.mustBeCaseHandler;
  let applied = false;
  for (const role of grantingRoleNames) {
    const override = found.roleOverrides && Object.hasOwn(found.roleOverrides, role)
      ? found.roleOverrides[role]
      : undefined;
    const nextQualification = override?.qualification ?? found.requirements.qualification;
    const nextHandler = override?.mustBeCaseHandler ?? found.requirements.mustBeCaseHandler;
    if (!applied) {
      qualification = nextQualification;
      mustBeCaseHandler = nextHandler;
      applied = true;
      continue;
    }
    if (QUALIFICATION_WIDTH[nextQualification] > QUALIFICATION_WIDTH[qualification]) {
      qualification = nextQualification;
    }
    if (!nextHandler) mustBeCaseHandler = false;
  }
  return {
    qualification,
    mustBeCaseHandler,
    changesPrimaryState: found.requirements.changesPrimaryState,
  };
}
