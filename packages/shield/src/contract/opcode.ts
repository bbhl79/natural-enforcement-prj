// 操作码名册（#71 决议、#96）。名册外的字符串不是操作码。
// 允许行不在这里。这里只记每条操作码的三项要求，以及随角色变化的覆盖。
// 一人持有多个能放行该操作码的角色时，取要求最宽的一个。
// 入参角色必须是当前仍能放行该操作码的角色。不能放行的角色不参与取宽。

export const QUALIFICATION_DEMANDS = ['none', 'operator', 'assignee'] as const;
export type QualificationDemand = (typeof QUALIFICATION_DEMANDS)[number];

/** 监督角色名。改变主状态的判断不采用这个角色贡献的允许行。 */
export const SUPERVISION_ROLE = '监督';

export interface OpcodeRequirements {
  /** none 不要求；operator 查操作的人；assignee 只查被指定的人 */
  readonly qualification: QualificationDemand;
  readonly mustBeCaseHandler: boolean;
  readonly changesPrimaryState: boolean;
}

interface OpcodeEntry {
  readonly requirements: OpcodeRequirements;
  readonly roleOverrides?: Readonly<
    Record<string, Partial<Pick<OpcodeRequirements, 'qualification' | 'mustBeCaseHandler'>>>
  >;
}

const QUALIFICATION_WIDTH: Record<QualificationDemand, number> = {
  none: 2,
  assignee: 1,
  operator: 0,
};

function entry(
  qualification: QualificationDemand,
  mustBeCaseHandler: boolean,
  changesPrimaryState: boolean,
  roleOverrides?: OpcodeEntry['roleOverrides'],
): OpcodeEntry {
  return { requirements: { qualification, mustBeCaseHandler, changesPrimaryState }, roleOverrides };
}

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
  }),
  'legal.review.request': entry('none', false, false, {
    经办: { qualification: 'operator', mustBeCaseHandler: true },
  }),
  'legal.opinion.draft': entry('none', false, false),
  'legal.opinion.submit': entry('none', false, false),
  'doc.admin.review': entry('none', false, false),
  'doc.approve': entry('none', false, true),
  'clue.read': entry('none', false, false),
  'case.read': entry('none', false, false),
  'doc.read': entry('none', false, false),
  'clue.export': entry('none', false, false),
  'case.export': entry('none', false, false),
  'doc.export': entry('none', false, false),
} as const satisfies Record<string, OpcodeEntry>;

const ADMIN_OBJECTS = ['template', 'rule', 'calendar', 'metric'] as const;
const ADMIN_ACTIONS = ['submit', 'approve', 'void', 'withdraw', 'read'] as const;

const ADMIN_OPCODES: Record<string, OpcodeEntry> = {};
for (const object of ADMIN_OBJECTS) {
  for (const action of ADMIN_ACTIONS) {
    ADMIN_OPCODES[`cfg.${object}.${action}`] = entry('none', false, false);
  }
}
for (const code of [
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
]) {
  ADMIN_OPCODES[code] = entry('none', false, false);
}

// 无原型字典：constructor、toString、__proto__ 等继承属性不会命中名册（#103 评审）。
const CATALOG: Readonly<Record<string, OpcodeEntry>> = Object.freeze(
  Object.assign(Object.create(null) as Record<string, OpcodeEntry>, CASE_OPCODES, ADMIN_OPCODES),
);

function lookup(opcode: string): OpcodeEntry | null {
  return Object.hasOwn(CATALOG, opcode) ? (CATALOG[opcode] ?? null) : null;
}

export const OPCODES = Object.freeze(Object.keys(CATALOG)) as readonly string[];

export function opcodeRequirements(opcode: string): OpcodeRequirements | null {
  const found = lookup(opcode);
  if (!found) return null;
  return found.requirements;
}

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
