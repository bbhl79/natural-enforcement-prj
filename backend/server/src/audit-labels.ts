// 管理台留痕的展示文字（#126，原型 v0.4 P8）。页面表格与导出文件用同一份文字，保证「导出内容与页面一致」。
// 只写工号；不写手机号、执法证号、口令（ADR 0007、ADR 0011）。

import type { AuditTrailRecord } from '@natural-enforcement/audit';

/** 表头（P8 表格列）。 */
export const AUDIT_COLUMNS = ['时间', '操作人工号', '操作', '对象', '所属机构', '结果'] as const;

/** 结果的着色：ok 成功、gray 中性（结束会话）、red 失败或被拒。 */
export type AuditTone = 'ok' | 'gray' | 'red';

export interface AuditRowView {
  time: string;
  actorCode: string;
  operation: string;
  object: string;
  /** 没有所属机构时为「无所属机构」。 */
  orgName: string;
  anchored: boolean;
  result: string;
  tone: AuditTone;
}

const LOGIN_ACTIONS = new Set([
  'login.succeeded', 'login.failed', 'login.locked', 'login.locked-retry', 'login.deactivated',
  'login.password-expired', 'login.password-change-required', 'login.source-limited', 'login.capacity-reached',
]);

const OPERATION_OF_ACTION: Readonly<Record<string, string>> = {
  'session.ended': '结束会话',
  'account.unlocked': '解锁',
  'account.password-reset': '重设初始口令',
  'account.password-rejected': '重设初始口令',
  'account.password-changed': '修改口令',
  'personnel.exported': '导出人员',
  'personnel.viewed': '打开人员详情',
  'personnel.registered': '新建人员',
  'personnel.renamed': '人员改名',
  'personnel.mobile-changed': '变更手机号',
  'personnel.role-granted': '授予角色',
  'personnel.role-revoked': '摘除角色',
  'personnel.transferred': '调岗',
  'personnel.deactivated': '停用人员',
  'personnel.restored': '恢复人员',
  'personnel.sessions-ended': '结束全部会话',
  'personnel.post-granted': '加岗位标记',
  'personnel.post-revoked': '摘岗位标记',
  'personnel.cert.updated': '变更执法证',
  'org.unit.registered': '新建下级机构',
  'org.unit.renamed': '机构改名',
  'org.unit.deactivated': '停用机构',
  'bootstrap.root-registered': '建立根机构',
  'bootstrap.admin-registered': '建立首个系统管理人员',
  'audit.viewed': '查阅管理台留痕',
  'audit.exported': '导出管理台留痕',
};

const OPERATION_OF_OPCODE: Readonly<Record<string, string>> = {
  'personnel.locked.read': '查看被锁人员',
  'personnel.locked.release': '解锁',
  'personnel.password.reset': '重设初始口令',
  'personnel.profile.export': '导出人员',
  'personnel.profile.read': '查看人员',
  'audit.admin.read': '查阅管理台留痕',
  'audit.admin.export': '导出管理台留痕',
  'authz.binding.submit': '维护机构或人员',
  'org.tree.read': '查看机构',
  'org.unit.register': '新建下级机构',
  'org.unit.rename': '机构改名',
  'org.unit.deactivate': '停用机构',
};

const DENIED_RESULT: Readonly<Record<string, string>> = {
  'permission-denied': '被拒绝：没有权限',
  'scope-denied': '被拒绝：超出数据范围',
  'identity-unknown': '被拒绝：身份无效',
  'not-authenticated': '被拒绝：未登录',
  'identity-deactivated': '被拒绝：人员已停用',
};

const FAILED_RESULT: Readonly<Record<string, string>> = {
  'login.locked': '失败：连续输错口令，已锁定',
  'login.locked-retry': '失败：已锁定',
  'login.deactivated': '失败：人员已停用',
  'login.password-expired': '失败：口令已到期',
  'login.password-change-required': '失败：须先修改口令',
  'login.source-limited': '失败：来源受限',
  'login.capacity-reached': '失败：同时在线已满',
};

const LOGIN_FAILED_RESULT: Readonly<Record<string, string>> = {
  'bad-credential': '失败：口令不正确',
  'unknown-identifier': '失败：未对上人员',
};

const SESSION_END_RESULT: Readonly<Record<string, string>> = {
  logout: '主动退出',
  'idle-timeout': '空闲超过 30 分钟',
  'absolute-timeout': '超过会话最长时间',
  'admin-ended': '系统管理人员重设口令后结束',
  displaced: '在别处登录后结束',
  'personnel-deactivated': '人员停用后结束',
  'remember-me-reuse': '「记住我」凭据被重复使用后结束',
};

const SHANGHAI_MINUTE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Asia/Shanghai 的「YYYY-MM-DD HH:mm」。 */
export function shanghaiMinute(at: Date): string {
  const parts = Object.fromEntries(SHANGHAI_MINUTE.formatToParts(at).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function operationOf(record: AuditTrailRecord): string {
  if (LOGIN_ACTIONS.has(record.action)) return '登录';
  if (record.action === 'authz.denied') {
    return (record.opcode && OPERATION_OF_OPCODE[record.opcode]) || `操作 ${record.opcode ?? '未知'}`;
  }
  return OPERATION_OF_ACTION[record.action] ?? record.action;
}

/** 按资源标识查到的展示名：人员的工号、机构的名称。 */
export interface AuditResourceNames {
  readonly personnelCodes: ReadonlyMap<string, string>;
  readonly orgNames: ReadonlyMap<string, string>;
}

const NO_NAMES: AuditResourceNames = { personnelCodes: new Map(), orgNames: new Map() };

function objectOf(record: AuditTrailRecord, names: AuditResourceNames): string {
  if (record.subjectCode) return `人员 ${record.subjectCode}`;
  if (record.action === 'audit.viewed' || record.action === 'audit.exported') return '管理台留痕';
  if (record.resourceType === 'personnel' && record.resourceId) {
    const code = names.personnelCodes.get(record.resourceId);
    return code ? `人员 ${code}` : '人员';
  }
  if (record.resourceType === 'org-unit') {
    // 对象按资源标识取名称（所属机构不一定就是对象，例如对象机构解析不出时按操作者机构兜底）
    const name = record.resourceId ? names.orgNames.get(record.resourceId) : undefined;
    return name ?? (record.resourceId && record.resourceId === record.orgUnitId ? record.orgUnitName : null) ?? '机构';
  }
  if (record.action === 'login.failed' && record.reason === 'unknown-identifier') return '未对上人员';
  return '—';
}

function resultOf(record: AuditTrailRecord): { result: string; tone: AuditTone } {
  if (record.action === 'session.ended') {
    return { result: (record.reason && SESSION_END_RESULT[record.reason]) || '结束会话', tone: 'gray' };
  }
  if (record.outcome === 'succeeded') return { result: '成功', tone: 'ok' };
  if (record.action === 'authz.denied') {
    return { result: (record.reason && DENIED_RESULT[record.reason]) || '被拒绝', tone: 'red' };
  }
  if (record.action === 'login.failed') {
    return { result: (record.reason && LOGIN_FAILED_RESULT[record.reason]) || '失败', tone: 'red' };
  }
  const fixed = FAILED_RESULT[record.action];
  if (fixed) return { result: fixed, tone: 'red' };
  return { result: record.reason ? `失败：${record.reason}` : '失败', tone: 'red' };
}

/** 所属机构名称：与 org_unit_id 相同时用连表取到的名称，否则按标识查（授权拒绝行的目标机构）。 */
function anchorNameOf(record: AuditTrailRecord, names: AuditResourceNames): string {
  const anchor = record.anchorOrgUnitId;
  if (!anchor) return '无所属机构';
  if (anchor === record.orgUnitId && record.orgUnitName) return record.orgUnitName;
  return names.orgNames.get(anchor) ?? '';
}

/**
 * 一行留痕的展示文字。names：按资源标识查到的人员工号与机构名称
 * （授权拒绝行不写被作用人员，只写资源；所属机构是目标机构，#105；ADR 0011 修正）。
 */
export function describeAuditRow(
  record: AuditTrailRecord,
  names: AuditResourceNames = NO_NAMES,
): AuditRowView {
  const { result, tone } = resultOf(record);
  return {
    time: shanghaiMinute(record.createdAt),
    actorCode: record.actorCode ?? '—',
    operation: operationOf(record),
    object: objectOf(record, names),
    orgName: anchorNameOf(record, names),
    anchored: record.anchorOrgUnitId != null,
    result,
    tone,
  };
}

/** 导出文件的一行，列序同 AUDIT_COLUMNS。 */
export function auditRowCells(view: AuditRowView): string[] {
  return [view.time, view.actorCode, view.operation, view.object, view.orgName, view.result];
}
