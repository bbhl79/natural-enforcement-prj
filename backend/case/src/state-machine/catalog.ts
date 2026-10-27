// 案件状态机常量（#235）。
// 法定环节、主状态、环节实例状态：#27/6409848362。
// 迁移表：基线 #27/6409849007，修订 #27/6410091980，批2 追加 T09a（#27/6431079838）。
// 非法迁移：X01–X30 同修订；X31 由 #234 实现并在此登记；X32 只登记（#27/6431079838 Q10）；X33 回避声明守卫只登记（#27/6443123771）。
// X 分两类口径（#267，#27/6443175238）。纯系统完整性守卫（authority 为 system，与法律依据无关）一律 409。
// 带依据层级的 X 按 authority 定。userLock 非空，或 law、regulation，阻断（409）。normative、internal 降为警告（200）。
// X03、X10、X19、X21、X22、X26 为 normative，结果是警告。待法制确认后再议升级，不在本目录升为阻断。
// X12 白名单以 #235 正文及评论 6431387386 为准。
// #235 启用 T01、T02。#236 启用 T03–T07。其余边仍关闭。

import { GUARD_AUTHORITIES, type GuardAuthority, type GuardResult } from './guard.ts';

/** 法定环节 E01–E13。次序即清单次序，不能配置。 */
export const CASE_STAGE_CODES = [
  'E01',
  'E02',
  'E03',
  'E04',
  'E05',
  'E06',
  'E07',
  'E08',
  'E09',
  'E10',
  'E11',
  'E12',
  'E13',
] as const;
export type CaseStageCode = (typeof CASE_STAGE_CODES)[number];

export const CASE_STAGE_NAMES: Readonly<Record<CaseStageCode, string>> = {
  E01: '立案',
  E02: '调查',
  E03: '调查终结',
  E04: '审理',
  E05: '告知',
  E06: '听证',
  E07: '法制审核',
  E08: '集体讨论',
  E09: '决定',
  E10: '送达',
  E11: '执行记载',
  E12: '结案',
  E13: '定型',
};

/**
 * 案件主状态（#235 范围；#27 第 1／2 条）。
 * 「办理中·中止」是 E02 上的叠加标记，不是另一主状态。受控重开中随 T28 挪二期，不登记为主状态。
 */
export const CASE_MAIN_STATUSES = [
  'in_progress',
  'terminated_pending',
  'withdrawn',
  'closed',
  'finalized',
] as const;
export type CaseMainStatus = (typeof CASE_MAIN_STATUSES)[number];

export const CASE_MAIN_STATUS_NAMES: Readonly<Record<CaseMainStatus, string>> = {
  in_progress: '办理中',
  terminated_pending: '调查已终止·待收尾',
  withdrawn: '已撤案',
  closed: '已结案',
  finalized: '已定型',
};

/** 终态。非终态即未办结（OpenItems，#219）。 */
export const CASE_TERMINAL_STATUSES = ['withdrawn', 'closed', 'finalized'] as const;
export type CaseTerminalStatus = (typeof CASE_TERMINAL_STATUSES)[number];

export function isTerminalCaseStatus(status: string): status is CaseTerminalStatus {
  return (CASE_TERMINAL_STATUSES as readonly string[]).includes(status);
}

/** 环节实例状态（#27 Q1：拟制中／待审批／待前置环节／已完成）。 */
export const CASE_INSTANCE_STATUSES = [
  'drafting',
  'pending_approval',
  'waiting_prerequisite',
  'completed',
] as const;
export type CaseInstanceStatus = (typeof CASE_INSTANCE_STATUSES)[number];

export const CASE_INSTANCE_STATUS_NAMES: Readonly<Record<CaseInstanceStatus, string>> = {
  drafting: '拟制中',
  pending_approval: '待审批',
  waiting_prerequisite: '待前置环节',
  completed: '已完成',
};

/** 监督角色名，与 shield 的 SUPERVISION_ROLE、GLOSSARY「监督」同一字符串。 */
export const CASE_SUPERVISION_ROLE = '监督';

export type FromSpec =
  | { readonly kind: 'clue'; readonly status: 'handler_assigned' }
  | { readonly kind: 'stage'; readonly stage: CaseStageCode }
  | { readonly kind: 'stages'; readonly stages: readonly CaseStageCode[] }
  | { readonly kind: 'main'; readonly statuses: readonly CaseMainStatus[] }
  | { readonly kind: 'marker'; readonly marker: string }
  | { readonly kind: 'span'; readonly start: CaseStageCode; readonly end: CaseStageCode }
  | { readonly kind: 'after'; readonly stage: CaseStageCode }
  | { readonly kind: 'any-handled' }
  | { readonly kind: 'side'; readonly name: string };

export type ToSpec =
  | { readonly kind: 'open-case' }
  | { readonly kind: 'close-clue' }
  | {
      readonly kind: 'enter';
      readonly stage: CaseStageCode;
      readonly instanceStatus: CaseInstanceStatus;
      readonly reenter?: boolean;
      readonly mainStatus?: CaseMainStatus;
      readonly completeStage?: CaseStageCode;
    }
  | { readonly kind: 'main'; readonly status: CaseMainStatus }
  | { readonly kind: 'overlay'; readonly suspended: boolean }
  | { readonly kind: 'same' }
  | { readonly kind: 'branch'; readonly note: string };

/** 已启用边的守卫名。none 表示显式声明本边无额外守卫（通用守卫仍跑）。 */
export const TRANSITION_GUARDS = ['filing', 'closeout', 'none'] as const;
export type TransitionGuard = (typeof TRANSITION_GUARDS)[number];

export interface TransitionEdge {
  readonly id: string;
  readonly from: FromSpec | readonly FromSpec[];
  readonly to: ToSpec;
  readonly enabled: boolean;
  /** 边专属守卫。通用守卫 X12、X13、X17、X18 不写在这里。 */
  readonly guard: TransitionGuard;
  /** 起点还要求 E02 中止叠加标记。 */
  readonly requiresSuspended?: boolean;
  readonly summary: string;
}

const clueAssigned = { kind: 'clue', status: 'handler_assigned' } as const;
const stage = (code: CaseStageCode): FromSpec => ({ kind: 'stage', stage: code });
const main = (...statuses: CaseMainStatus[]): FromSpec => ({ kind: 'main', statuses });
const enter = (
  code: CaseStageCode,
  instanceStatus: CaseInstanceStatus,
  extra: { readonly reenter?: boolean; readonly mainStatus?: CaseMainStatus; readonly completeStage?: CaseStageCode } = {},
): ToSpec => ({ kind: 'enter', stage: code, instanceStatus, ...extra });

function edge(
  id: string,
  from: FromSpec | readonly FromSpec[],
  to: ToSpec,
  summary: string,
  options: { readonly enabled?: boolean; readonly guard?: TransitionGuard; readonly requiresSuspended?: boolean } = {},
): TransitionEdge {
  return {
    id,
    from,
    to,
    enabled: options.enabled ?? false,
    guard: options.guard ?? 'none',
    ...(options.requiresSuspended ? { requiresSuspended: true } : {}),
    summary,
  };
}

/** 41 条。未写 enabled 的边保持关闭，由各实现票打开。 */
export const TRANSITIONS: readonly TransitionEdge[] = [
  edge('T01', clueAssigned, { kind: 'open-case' }, '立案呈批批准（结论立案）：建案件，E01 完成，E02 拟制中', {
    enabled: true,
    guard: 'filing',
  }),
  edge('T02', clueAssigned, { kind: 'close-clue' }, '立案呈批批准（结论不予立案）：线索关闭，不建案件', {
    enabled: true,
    guard: 'filing',
  }),
  edge('T03', stage('E02'), { kind: 'overlay', suspended: true }, '中止呈批批准：E02 加中止标记', {
    enabled: true,
    guard: 'closeout',
  }),
  edge('T04', stage('E02'), { kind: 'overlay', suspended: false }, '恢复呈批批准：去掉中止标记', {
    enabled: true,
    guard: 'closeout',
    requiresSuspended: true,
  }),
  edge('T05', stage('E02'), { kind: 'main', status: 'terminated_pending' }, '终止调查呈批批准：调查已终止·待收尾', {
    enabled: true,
    guard: 'closeout',
  }),
  edge('T06', main('terminated_pending'), { kind: 'main', status: 'withdrawn' }, '撤销立案呈批批准：已撤案', {
    enabled: true,
    guard: 'closeout',
  }),
  edge('T07', main('terminated_pending'), { kind: 'main', status: 'closed' }, '待收尾结案呈批批准：已结案', {
    enabled: true,
    guard: 'closeout',
  }),
  edge('T08', stage('E02'), enter('E04', 'drafting', { completeStage: 'E03' }), '调查报告呈批批准：E03 完成，进入 E04'),
  edge('T09', stage('E04'), enter('E02', 'drafting', { reenter: true }), '审理意见补充调查：E02 再次进入'),
  edge('T09a', stage('E04'), { kind: 'branch', note: '负责人支持审理意见则走 T09；支持承办人员则按决定进入 T10、T11 或 T12' }, '审理异议呈批'),
  edge('T10', stage('E04'), { kind: 'branch', note: '未命中必审进入 E05 拟制中；命中必审转 T10a' }, '审理通过，拟处罚'),
  edge('T10a', stage('E04'), enter('E07', 'drafting'), '告知前法制审核'),
  edge('T10b', stage('E07'), enter('E05', 'drafting'), '告知前法制审核通过，进入 E05'),
  edge('T10c', stage('E07'), { kind: 'branch', note: '法审不通过：改后重送，视情况回 E04，或提请 E08 后回 E07' }, '告知前法制审核不通过'),
  edge('T11', stage('E04'), { kind: 'branch', note: '未命中必审时进入 E05 或直接 E09；命中必审转 T10a' }, '审理通过，拟不予处罚'),
  edge('T12', stage('E04'), enter('E09', 'drafting'), '审理认定违法事实不成立，进入不予处罚决定'),
  edge('T13', stage('E05'), { kind: 'same' }, '告知书送达，进入告知等待'),
  edge('T14', { kind: 'marker', marker: 'notice-waiting' }, enter('E09', 'drafting'), '告知等待结束，进入决定拟制'),
  edge('T14a', { kind: 'marker', marker: 'notice-waiting' }, { kind: 'branch', note: '清除视为放弃，转 T15' }, '视为放弃后在决定前要求听证'),
  edge('T15', { kind: 'marker', marker: 'notice-waiting' }, enter('E06', 'drafting'), '当事人申请听证'),
  edge('T16', stage('E06'), enter('E09', 'drafting'), '听证终结或放弃，进入决定拟制'),
  edge('T16a', { kind: 'marker', marker: 'hearing-terminated' }, { kind: 'branch', note: '不自动复开；重新申请按 T15' }, '已终止的听证'),
  edge(
    'T17',
    [{ kind: 'marker', marker: 'notice-waiting' }, stage('E06')],
    enter('E02', 'drafting', { reenter: true }),
    '陈述申辩或听证中须核实的新事实，回到调查',
  ),
  edge('T18', stage('E09'), { kind: 'same' }, '科长审核通过，进入闸口判定'),
  edge('T19', { kind: 'marker', marker: 'decision-gate' }, enter('E07', 'drafting'), '命中必审或进入听证程序，决定审批链挂起'),
  edge('T20', stage('E07'), { kind: 'branch', note: '须集体讨论的进入 E08，否则进入领导审批' }, '法制审核通过'),
  edge('T21', stage('E07'), { kind: 'branch', note: '决定审批链作废，E09 回到拟制中；视情况回 E04 或提请 E08' }, '法制审核不通过'),
  edge('T22', stage('E08'), { kind: 'branch', note: '回 E07 再进入一次，或进入领导审批' }, '集体讨论记录入卷'),
  edge('T23', { kind: 'marker', marker: 'leadership' }, enter('E09', 'completed'), '领导审批通过，决定书生效'),
  edge('T24', stage('E09'), enter('E10', 'completed'), '上传送达回证，送达完成'),
  edge('T25', stage('E10'), enter('E11', 'drafting'), '处罚案件执行记载'),
  edge('T26', [stage('E10'), stage('E11')], { kind: 'main', status: 'closed' }, '结案呈批批准：已结案'),
  edge('T27', main('closed', 'withdrawn'), { kind: 'main', status: 'finalized' }, '归档审批通过：已定型'),
  edge('T28', main('finalized'), { kind: 'main', status: 'finalized' }, '受控重开后再定型（主干不启用）'),
  edge('T29', { kind: 'span', start: 'E02', end: 'E11' }, { kind: 'same' }, '涉刑或党纪政务移送：当前环节不变'),
  edge('T30', { kind: 'side', name: 'criminal-transfer' }, { kind: 'same' }, '记载公安、检察的决定'),
  edge('T31', { kind: 'after', stage: 'E10' }, { kind: 'branch', note: '撤销原决定书，加受控重开；是否回流由主办决定' }, '决定书事实被推翻（主干不启用）'),
  edge('T32', { kind: 'span', start: 'E05', end: 'E09' }, enter('E05', 'drafting', { reenter: true }), '重新比对后撤销原告知，E05 再进入'),
  edge('T33', { kind: 'any-handled' }, { kind: 'same' }, '改派呈批批准：环节不变'),
  edge('T34', { kind: 'span', start: 'E01', end: 'E09' }, { kind: 'same' }, '延长办案期限：环节不变'),
  edge('T35', { kind: 'after', stage: 'E10' }, { kind: 'same' }, '复议、诉讼记载：主状态不变（主干不启用）'),
];

const TRANSITION_BY_ID = new Map(TRANSITIONS.map((item) => [item.id, item]));

export function findTransition(id: string): TransitionEdge | null {
  return TRANSITION_BY_ID.get(id) ?? null;
}

export function stageIndex(code: string): number {
  return (CASE_STAGE_CODES as readonly string[]).indexOf(code);
}

/** X12 可登记白名单。阅读、导出本票放行；T27 与结案后回证只登记，由 #243、#242 启用。 */
export const X12_WHITELIST = [
  { id: 'read', kind: 'read', basis: '终态后仍可阅读（#235）' },
  { id: 'export', kind: 'read', basis: '终态后仍可导出（#235）' },
  {
    id: 'T27',
    kind: 'transition',
    basis: '定型是结案后的独立步骤，T27 属定型本身（Lei Hu 2026-10-27 09:04；#243 启用）',
  },
  {
    id: 'post-close-receipt',
    kind: 'write',
    basis: 'T26 回证缺失不阻碍结案，T27 回证缺失阻碍定型（#40 Q28；#242、#243 启用）',
  },
] as const;

export type X12WhitelistId = (typeof X12_WHITELIST)[number]['id'];

export function isX12Whitelisted(id: string): boolean {
  return X12_WHITELIST.some((item) => item.id === id);
}

export type IllegalEnforcement = 'engine' | 'filing' | 'none';

export interface IllegalMigration {
  readonly id: string;
  readonly summary: string;
  readonly citation: string;
  readonly outlet: string;
  /** engine＝本票守卫；filing＝#234 已实现；none＝只登记。 */
  readonly enforcement: IllegalEnforcement;
  /** 依据层级（#255）。必填。漏标由 unannotatedMigrationIds 判红。 */
  readonly authority: GuardAuthority;
  /** 明文要求阻断的锁定出处。非空时引擎保持 block，不因层级降为警告。 */
  readonly userLock?: string;
}

export const ILLEGAL_MIGRATIONS: readonly IllegalMigration[] = [
  { id: 'X01', summary: '没有关联线索就立案', citation: '#16', outlet: '先关联来源线索', enforcement: 'none', authority: 'system' },
  { id: 'X02', summary: '中止期间推进到调查终结及以后', citation: '办法第27条（推定）', outlet: '先恢复调查', enforcement: 'engine', authority: 'system' },
  { id: 'X03', summary: '待收尾状态下，除撤案、结案呈批外的任何迁移', citation: '规程 4.3.3(4)', outlet: '只可走撤案呈批或结案呈批', enforcement: 'engine', authority: 'normative' },
  { id: 'X04', summary: '调查未终结就进入审理', citation: '办法第29条＋第30条（推定）', outlet: '先完成调查终结', enforcement: 'none', authority: 'system' },
  { id: 'X05', summary: '拟处罚，但告知书未送达就作出处罚决定', citation: '行政处罚法第 44 条', outlet: '先送达告知书', enforcement: 'none', authority: 'law' },
  { id: 'X06', summary: '告知期限未满就作出处罚决定', citation: '#111 L1', outlet: '待告知期限届满', enforcement: 'none', authority: 'regulation' },
  {
    id: 'X07',
    summary: '应听证的情形未发听证告知',
    citation: '处罚法第44、62条＋粤府令第294号第17条',
    outlet: '先发听证告知',
    enforcement: 'none',
    authority: 'law',
    userLock: '#111 L3',
  },
  // X08 的两层仍是同一条登记。拆开要新增拒绝码，本票不新增。整条标 regulation。摘要不一致一层待工程主管拆分。
  {
    id: 'X08',
    summary: '必审未审、审核未通过或摘要不一致就进入领导审批',
    citation: '处罚法第58条＋办法第32条第1款＋监督规定第21条第1款',
    outlet: '先完成法制审核且摘要覆盖当前决定文书',
    enforcement: 'none',
    authority: 'regulation',
  },
  { id: 'X09', summary: '须集体讨论而未讨论就进入领导审批', citation: '规程 7.1 末款；行政处罚法第 57 条第 2 款', outlet: '先完成集体讨论', enforcement: 'none', authority: 'law' },
  { id: 'X10', summary: '处罚决定未送达就执行记载或结案', citation: '规程第 9 章', outlet: '先送达处罚决定', enforcement: 'none', authority: 'normative' },
  { id: 'X11', summary: '须移送党纪政务、刑事而未移送就结案', citation: '办法第46条末款', outlet: '先完成应当的移送', enforcement: 'none', authority: 'regulation' },
  { id: 'X12', summary: '已撤案、已结案、已定型后的业务写操作（白名单除外）', citation: 'immutability §2 第 4 点；#235 评论 6431387386', outlet: '终态后仅可阅读、导出；归档走 T27；结案后回证按白名单上传', enforcement: 'engine', authority: 'system' },
  { id: 'X13', summary: '立案后修改承办机构', citation: '#40 Q29', outlet: '承办机构在立案时锁定，不能修改', enforcement: 'engine', authority: 'system' },
  { id: 'X14', summary: '改派后承办人员少于两人', citation: '规程 2.6；行政处罚法第 42 条', outlet: '改派后承办人员须不少于两人', enforcement: 'none', authority: 'law' },
  { id: 'X15', summary: '审理开始后走撤案，或调查中走不予处罚（事实不成立）', citation: '#40/6228984565 P2；Q2', outlet: '按当前环节走对应出口', enforcement: 'none', authority: 'system' },
  { id: 'X16', summary: '定案文书引用未入卷证据仍签发', citation: '#111 L4', outlet: '先把引用的证据入卷', enforcement: 'none', authority: 'system', userLock: '#111 L4' },
  { id: 'X17', summary: '监督角色的写操作推进主状态', citation: '#71/6169639094；GLOSSARY「监督」', outlet: '请由有权办理人操作，监督不能推进主状态', enforcement: 'engine', authority: 'system' },
  { id: 'X18', summary: '同一案件同时有两条进行中的审批链', citation: '#31/6233001360 Q12', outlet: '先办结或撤回当前审批链', enforcement: 'engine', authority: 'system' },
  { id: 'X19', summary: '未经立案呈批批准就登记或不予立案', citation: '规程 2.4；#31/6233001360 Q4a', outlet: '须经立案呈批批准', enforcement: 'none', authority: 'normative' },
  { id: 'X20', summary: '调查取证笔录在场承办人员少于两人仍保存', citation: '办法第17条第2款＋行政处罚法第42条；笔录记载在场人员属实现口径', outlet: '笔录在场承办人员须不少于两人', enforcement: 'none', authority: 'regulation' },
  { id: 'X21', summary: '带去重标记的线索单独立案', citation: '#27/6409981777', outlet: '同组附加来源线索，或改判独立', enforcement: 'none', authority: 'normative' },
  { id: 'X22', summary: '本案主办或协办签出审理意见', citation: '规程 5.1', outlet: '由非本案承办人员签出', enforcement: 'none', authority: 'normative' },
  { id: 'X23', summary: '未持行政审核角色的人签出审理意见', citation: '#27/6410042773', outlet: '由持行政审核角色的人签出', enforcement: 'none', authority: 'system' },
  { id: 'X24', summary: '勾选跨承办机构的附加来源线索', citation: '#27/6410046390', outlet: '附加来源线索须与本案同一承办机构', enforcement: 'none', authority: 'system' },
  { id: 'X25', summary: '对已并入本案的去重组线索再提单独立案', citation: '#27/6410046390', outlet: '已并入的线索不能再立独立案', enforcement: 'none', authority: 'system' },
  { id: 'X26', summary: '命中必审但未经告知前法审就批准告知书', citation: '规程7.1／8.2；设计加严，非规定要求', outlet: '先完成告知前法制审核且摘要覆盖', enforcement: 'none', authority: 'normative' },
  { id: 'X27', summary: '进入听证程序但听证后未再审即进入领导审批', citation: '粤府令第294号第33条＋处罚法第58条（二）', outlet: '听证后再审后才能进入领导审批', enforcement: 'none', authority: 'regulation' },
  { id: 'X28', summary: '自动复开已终止的听证', citation: '#90/6410046818', outlet: '须由当事人重新申请', enforcement: 'none', authority: 'system' },
  { id: 'X29', summary: '立案批准后未走受控重开就取消自动关联', citation: '#27/6410077358', outlet: '须走受控重开', enforcement: 'none', authority: 'system' },
  { id: 'X30', summary: '不予立案理由不合规', citation: '#226/6410041963', outlet: '两类理由择一且选完整', enforcement: 'none', authority: 'regulation' },
  { id: 'X31', summary: '线索上有在途立案呈批时做其他处置', citation: '#27/6431079838 Q9', outlet: '先撤回立案呈批', enforcement: 'filing', authority: 'system' },
  { id: 'X32', summary: '非被指定审理人签出审理意见', citation: '#27/6431079838 Q10', outlet: '须由被指定的审理人签出', enforcement: 'none', authority: 'system' },
  // X33 只登记，不接到迁移。现有 409 仍由 assertCanSign 拒绝。拦截点：E04 签出（T09–T12）、E07 签出（T10b、T10c、T20、T21）、决定审批链（T18、T23）。
  {
    id: 'X33',
    summary: '回避声明守卫：人员利害关系处于声明或生效状态时签出审理意见、法审意见或决定',
    citation: '#27/6443123771；#27/6430922951 Q2；#40/6430922449',
    outlet: '等待回避决定',
    enforcement: 'none',
    authority: 'system',
  },
];

const ILLEGAL_BY_ID = new Map(ILLEGAL_MIGRATIONS.map((item) => [item.id, item]));

export function findIllegal(id: string): IllegalMigration | null {
  return ILLEGAL_BY_ID.get(id) ?? null;
}

/** 登记表里 authority 缺失或不在五级之内的编号。空数组表示通过。漏标必须非空，供红探针判红。 */
export function unannotatedMigrationIds(
  rows: readonly { readonly id: string; readonly authority?: string | null }[],
): string[] {
  const allowed = new Set<string>(GUARD_AUTHORITIES);
  return rows.filter((row) => typeof row.authority !== 'string' || !allowed.has(row.authority)).map((row) => row.id);
}

export function block(
  code: string,
  message: string,
  authority: GuardAuthority,
  citation?: string,
  userLock?: string,
): GuardResult {
  return {
    level: 'block',
    code,
    message,
    authority,
    ...(citation ? { citation } : {}),
    ...(userLock ? { userLock } : {}),
  };
}
