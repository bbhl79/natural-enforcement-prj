// 被锁人员（P7，A10）：取数、解锁与重设初始口令的请求、页面状态与文案。
// 接口沿用已有 A10：GET /api/admin/locked-personnel、POST /api/admin/personnel/:id/unlock、
// POST /api/admin/personnel/:id/password-reset（body { password }）。
// 列表只靠手动刷新；动作成功后该行从列表移除（#105 故事 43–45）。
// 文案逐字取自原型 v0.4 P7（35 条定稿与 #84 批准的「重设成功」「重设被拒」两句）。

import { data } from 'react-router';

import { apiFetch, type ApiDispatch } from '../api';
import { sessionOpcodes, type SessionStore } from '../session';

export const LOCKED_READ = 'personnel.locked.read';
export const LOCKED_RELEASE = 'personnel.locked.release';
export const PASSWORD_RESET = 'personnel.password.reset';

export const LOCKED_LIST_URL = '/api/admin/locked-personnel';
export const unlockUrl = (id: string) => `/api/admin/personnel/${encodeURIComponent(id)}/unlock`;
export const resetUrl = (id: string) => `/api/admin/personnel/${encodeURIComponent(id)}/password-reset`;

/** 列表一行，字段照 #91：人员标识、工号、姓名、当前机构名、自动解锁时间。 */
export interface LockedRow {
  id: string;
  code: string;
  name: string;
  /** 没有当前任职时为空 */
  orgName: string | null;
  /** ISO 时间 */
  lockedUntil: string;
}

export type LockedActionKind = 'unlock' | 'reset';

// ---- 文案（原型 v0.4 P7） ----

export const PAGE_TITLE = '被锁人员';
export const PAGE_DESC = '你任职机构及其下级中，当前处于锁定期的人员。连续输错口令 5 次会锁定 30 分钟，到时自动解锁。';
export const COLUMNS = ['人员标识', '工号', '姓名', '当前机构名', '自动解锁时间'] as const;
export const EMPTY_TITLE = '当前没有被锁的人员';
export const EMPTY_HINT = '有人来电说登录不了时，可先刷新本页确认是否被锁。';
export const NO_ORG_HINT = '当前机构名为空的人员没有任职机构，只有市局的系统管理人员能看到和处理';
export const UNLOCK_NOTE = '解锁后对方可以立即用原口令登录。请先核实来电人确是本人。';
export const RESET_PLACEHOLDER = '请输入新的初始口令';
export const RESET_EFFECT = '确认后：同时解锁；对方的全部会话都会结束，同时结束全部「记住我」；对方下次登录必须先改口令。';

/**
 * 重设弹窗的口令要求，逐条以「；」相连，句末「。」。
 * 口令历史一条（「不能与对方最近 5 次使用过的口令相同」）由口令历史票（#132）追加到末尾。
 */
export const RESET_RULES: readonly string[] = [
  '至少 10 位，最多 64 位',
  '大写、小写、数字、特殊字符中至少 3 类',
  '不能包含对方工号',
  '不能有 4 位及以上连续或重复字符',
  '不能用常见弱口令',
];

export function resetRulesSentence(rules: readonly string[] = RESET_RULES): string {
  return `${rules.join('；')}。`;
}

/** 重设被服务端判为不合规时，输入框下逐条显示。口令历史的 unavailable 由 #132 补进来。 */
export const RESET_RULE_TEXT: Readonly<Record<string, string>> = {
  'too-short': '口令至少 10 位',
  'too-long': '口令最多 64 位',
  'insufficient-classes': '大写、小写、数字、特殊字符中至少包含 3 类',
  sequential: '不能包含 4 位及以上连续数字或字母',
  repeated: '不能包含 4 位及以上重复字符',
  common: '不能使用常见弱口令',
  'contains-code': '不能包含对方工号',
};

export const SELF_DENIED = '不能解锁自己，也不能给自己重设口令。请联系本单位其他系统管理人员处理。';

const who = (row: Pick<LockedRow, 'name' | 'code'>) => `「${row.name}」（${row.code}）`;

/** 「解锁「王芳」（TH0331）」或「为「王芳」（TH0331）重设初始口令」 */
function actionPhrase(kind: LockedActionKind, row: LockedRow): string {
  return kind === 'unlock' ? `解锁${who(row)}` : `为${who(row)}重设初始口令`;
}

export const unlockDialogTitle = (row: LockedRow) => `解锁「${row.name}」？`;
export const resetDialogTitle = (row: LockedRow) => `为「${row.name}」重设初始口令`;

/** 动作结果横幅。 */
export type Notice =
  | { kind: 'unlocked'; row: LockedRow }
  | { kind: 'reset'; row: LockedRow }
  | { kind: 'scope-denied'; action: LockedActionKind; row: LockedRow }
  | { kind: 'self-denied'; action: LockedActionKind; row: LockedRow }
  | { kind: 'permission-denied'; action: LockedActionKind; row: LockedRow }
  | { kind: 'failed'; action: LockedActionKind; row: LockedRow };

export function noticeText(notice: Notice): string {
  switch (notice.kind) {
    case 'unlocked':
      return `已解锁${who(notice.row)}，对方现在可以登录。`;
    case 'reset':
      return `已为${who(notice.row)}重设初始口令，并已解锁。对方的全部会话和全部「记住我」已结束，下次登录须先改口令。`;
    case 'scope-denied':
      return `没有${actionPhrase(notice.action, notice.row)}：对方已不在你的数据范围内，可能刚刚调岗。请刷新列表，或联系对方现在所在单位的系统管理人员。`;
    case 'self-denied':
      return SELF_DENIED;
    // 以下两句原型 v0.4 没有单独状态：由已定稿的句子拼成（工程决定，见 PR）。
    case 'permission-denied':
      return `没有${actionPhrase(notice.action, notice.row)}：这个操作需要的权限不在你当前的角色里。如工作需要，请联系本单位的系统管理人员调整角色。`;
    case 'failed':
      return `没有${actionPhrase(notice.action, notice.row)}：网络或服务暂时不可用，请稍后重试。问题持续时请联系本单位的系统管理人员。`;
  }
}

/** 横幅的 data-reason（原型只在 data- 属性里放原因码）。 */
export function noticeReason(notice: Notice): string | null {
  switch (notice.kind) {
    case 'scope-denied':
      return 'scope-denied';
    case 'self-denied':
    case 'permission-denied':
      return 'permission-denied';
    case 'failed':
      return 'failed';
    default:
      return null;
  }
}

export const isDenial = (notice: Notice | null) => notice !== null && notice.kind !== 'unlocked' && notice.kind !== 'reset';

// ---- 时间 ----

const SHANGHAI_MINUTE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** 自动解锁时间按 Asia/Shanghai 显示到分钟：2026-10-17 10:21。 */
export function formatUnlockTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const parts = Object.fromEntries(SHANGHAI_MINUTE.formatToParts(date).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

// ---- 取数 ----

function asRows(body: unknown): LockedRow[] {
  const list = (body as { personnel?: unknown } | null)?.personnel;
  if (!Array.isArray(list)) throw new Error('被锁人员列表格式不对');
  return list.map((item) => {
    const row = item as Partial<LockedRow>;
    return {
      id: String(row.id ?? ''),
      code: String(row.code ?? ''),
      name: String(row.name ?? ''),
      orgName: typeof row.orgName === 'string' && row.orgName !== '' ? row.orgName : null,
      lockedUntil: String(row.lockedUntil ?? ''),
    };
  });
}

/** 取被锁人员。403 交给页面显示无权限卡片；401 由会话已结束页接手。 */
export async function loadLockedPersonnel(dispatch: ApiDispatch): Promise<LockedRow[]> {
  const response = await apiFetch(dispatch, LOCKED_LIST_URL);
  if (response.status === 401) return [];
  if (response.status === 403) throw data(null, { status: 403 });
  if (!response.ok) throw new Error(`被锁人员读取失败：HTTP ${response.status}`);
  return asRows(await response.json());
}

let generation = 0;

/** loader 只取数，不做授权判断；列表异步到达，先出骨架（P7 loading）。每次加载编号不同，页面据此重置。 */
export function lockedPersonnelLoader(store: SessionStore) {
  return () => {
    const list = sessionOpcodes(store).then((opcodes) =>
      (opcodes.includes(LOCKED_READ) ? loadLockedPersonnel(store.dispatch) : []));
    // 失败交给页面的 Await 错误分支；这里先挂一个空处理，免得页面渲染前拒绝被当成未处理。
    list.catch(() => undefined);
    generation += 1;
    return { list, generation };
  };
}

// ---- 动作 ----

/** 一次动作的结果：完成、口令不合规（弹窗不关）、或出横幅。 */
export type ActionResult =
  | { type: 'done' }
  | { type: 'non-compliant'; rules: string[] }
  | { type: 'denied'; notice: Notice }
  | { type: 'ended' };

/**
 * 把接口回答换成页面结果。selfCode 是本人工号：服务端对本人一律 403 permission-denied，
 * 是不是「对自己操作」由工号比对得出。
 */
export async function interpretAction(
  kind: LockedActionKind,
  row: LockedRow,
  response: Response,
  selfCode: string | null,
): Promise<ActionResult> {
  if (response.ok) return { type: 'done' };
  if (response.status === 401) return { type: 'ended' };
  let body: { reason?: unknown; result?: unknown; rules?: unknown } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    body = {};
  }
  if (kind === 'reset' && response.status === 400 && body.result === 'non-compliant' && Array.isArray(body.rules)) {
    return { type: 'non-compliant', rules: body.rules.filter((code): code is string => typeof code === 'string') };
  }
  if (response.status === 403) {
    if (body.reason === 'scope-denied') return { type: 'denied', notice: { kind: 'scope-denied', action: kind, row } };
    if (body.reason === 'permission-denied' && selfCode !== null && row.code === selfCode) {
      return { type: 'denied', notice: { kind: 'self-denied', action: kind, row } };
    }
    if (typeof body.reason === 'string') {
      return { type: 'denied', notice: { kind: 'permission-denied', action: kind, row } };
    }
  }
  return { type: 'denied', notice: { kind: 'failed', action: kind, row } };
}

/** 发出解锁或重设请求。网络失败按「没有……：网络或服务暂时不可用」处理。 */
export async function performAction(
  dispatch: ApiDispatch,
  kind: LockedActionKind,
  row: LockedRow,
  password: string,
  selfCode: string | null,
): Promise<ActionResult> {
  try {
    const response = kind === 'unlock'
      ? await apiFetch(dispatch, unlockUrl(row.id), { method: 'POST' })
      : await apiFetch(dispatch, resetUrl(row.id), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
    return await interpretAction(kind, row, response, selfCode);
  } catch {
    return { type: 'denied', notice: { kind: 'failed', action: kind, row } };
  }
}

// ---- 页面状态 ----

export interface LockedState {
  rows: LockedRow[];
  /** 打开中的确认弹窗 */
  dialog: { kind: LockedActionKind; row: LockedRow } | null;
  /** 重设弹窗里输入的新初始口令 */
  password: string;
  /** 服务端判定不合规的规则码，显示在输入框下 */
  ruleCodes: string[];
  /** 请求进行中，确认按钮置灰 */
  pending: boolean;
  /** 上一次动作的横幅 */
  notice: Notice | null;
}

export type LockedEvent =
  | { type: 'open'; kind: LockedActionKind; row: LockedRow }
  | { type: 'close' }
  | { type: 'password'; value: string }
  | { type: 'submit' }
  /** 结算时带上发请求时的动作与目标，不读当前弹窗，免得结算到别的行上 */
  | { type: 'settled'; kind: LockedActionKind; row: LockedRow; result: ActionResult };

export function initialLockedState(rows: LockedRow[]): LockedState {
  return { rows, dialog: null, password: '', ruleCodes: [], pending: false, notice: null };
}

export function lockedReducer(state: LockedState, event: LockedEvent): LockedState {
  switch (event.type) {
    case 'open':
      // 请求进行中不换弹窗目标
      if (state.pending) return state;
      return { ...state, dialog: { kind: event.kind, row: event.row }, password: '', ruleCodes: [], pending: false };
    case 'close':
      return state.pending ? state : { ...state, dialog: null, password: '', ruleCodes: [] };
    case 'password':
      return { ...state, password: event.value, ruleCodes: [] };
    case 'submit':
      return { ...state, pending: true };
    case 'settled': {
      const { kind, row: target, result } = event;
      const sameDialog = state.dialog?.kind === kind && state.dialog.row.id === target.id;
      if (result.type === 'non-compliant') {
        return sameDialog ? { ...state, pending: false, ruleCodes: result.rules } : { ...state, pending: false };
      }
      const closed = sameDialog
        ? { ...state, dialog: null, password: '', ruleCodes: [], pending: false }
        : { ...state, pending: false };
      if (result.type === 'ended') return closed;
      if (result.type === 'denied') return { ...closed, notice: result.notice };
      const notice: Notice = kind === 'unlock' ? { kind: 'unlocked', row: target } : { kind: 'reset', row: target };
      return { ...closed, rows: state.rows.filter((row) => row.id !== target.id), notice };
    }
  }
}

/** 被拒时高亮的那一行。 */
export function markedRowId(state: LockedState): string | null {
  return state.notice && isDenial(state.notice) ? state.notice.row.id : null;
}
