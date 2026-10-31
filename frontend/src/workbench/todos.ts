// 工作台统一待办清单的数据层（#297 F1；原型 frontend/prototype/clue-dispatch）。
//
// 待办从既有接口派生，不另造台账：
// - 待分派决定／待派机构／待派承办人：GET /api/clues?view=assign；
// - 补齐缺件／重跑核查：同一次分配视图里按 hasGaps／verificationStatus 派生；
// - 撤回不派：GET /api/clues?view=held；
// - 处理结案提醒：GET /api/clues/reminders；
// - 受理指定管辖：GET /api/clues/designation-requests（无受理权时按无待办处理）。
//
// 办理时限：本系统没有法定办理时限规则，三色点一律蓝（还有时间），
// 蓝内按等待时长排序；不发明时限。深红／橙的色值与排序位次保留给后续规则接入。

import type { ApiDispatch } from '../api';
import { loadReminders, reminderKindLabel, type ReminderItem } from '../clue/closure';
import { loadDesignationTodos, type DesignationTodoItem } from '../clue/dispatch';
import { listClues, type ClueListRow } from '../clue/list';
import { registerStepPath } from '../clue/registration';

/** 待办事项类型。 */
export type TodoKind =
  | 'decide'
  | 'pool'
  | 'org-set'
  | 'gaps'
  | 'rerun'
  | 'held'
  | 'remind'
  | 'designate';

/** 紧急程度：深红＝已超期、橙＝紧急、蓝＝还有时间。 */
export type UrgencyLevel = 'overdue' | 'urgent' | 'ontime';

/** 统一待办的一行。 */
export interface WorkbenchTodo {
  readonly key: string;
  readonly kind: TodoKind;
  readonly kindLabel: string;
  readonly stage: string;
  readonly title: string;
  readonly from: string;
  readonly to: string;
  readonly waitHours: number;
  readonly updatedAt: string;
  readonly urgency: UrgencyLevel;
}

/** 事项类型筛选的选项（与原型同序）。 */
export const TODO_KINDS: readonly { readonly id: TodoKind; readonly label: string }[] = [
  { id: 'decide', label: '待分派决定' },
  { id: 'pool', label: '待派机构' },
  { id: 'org-set', label: '待派承办人' },
  { id: 'held', label: '撤回不派' },
  { id: 'gaps', label: '补齐缺件' },
  { id: 'rerun', label: '重跑核查' },
  { id: 'remind', label: '处理结案提醒' },
  { id: 'designate', label: '受理指定管辖' },
];

/** 默认排序位次：深红 → 橙 → 蓝。 */
export const URGENCY_RANK: Readonly<Record<UrgencyLevel, number>> = {
  overdue: 0,
  urgent: 1,
  ontime: 2,
};

/** 紧急程度圆点的提示。 */
export const URGENCY_TIP: Readonly<Record<UrgencyLevel, string>> = {
  overdue: '已超期',
  urgent: '紧急',
  ontime: '暂无办理时限规则，按等待时长排序',
};

/** 标题里事由摘要的最大字数（原型同口径）。 */
const TITLE_NARRATIVE_MAX = 36;

/** 等待时长换算：整小时，未来时间或无效时间按 0。 */
export function waitHoursSince(now: Date, iso: string): number {
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return 0;
  const hours = Math.floor((now.getTime() - time) / 3_600_000);
  return hours > 0 ? hours : 0;
}

/** 日期展示：取 ISO 的日期段，读不出给「—」。 */
export function dateOf(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : '—';
}

/** 标题：编号 ＋ 事由摘要。 */
export function todoTitle(code: string, narrative: string): string {
  const text = narrative.trim();
  if (text === '') return code;
  const clipped = text.length > TITLE_NARRATIVE_MAX ? `${text.slice(0, TITLE_NARRATIVE_MAX)}…` : text;
  return `${code} · ${clipped}`;
}

/** 线索中心对应办理全页的地址（详情在页内，不用右侧抽屉）。 */
function clueCenterPath(view: string, clueId: string): string {
  const params = new URLSearchParams({ view, clue: clueId, tab: 'basic' });
  return `/clue?${params.toString()}`;
}

/** 派生待办所需的取数结果。 */
export interface TodoSources {
  readonly assignRows: readonly ClueListRow[];
  readonly heldRows: readonly ClueListRow[];
  readonly reminders: readonly ReminderItem[];
  readonly designations: readonly DesignationTodoItem[];
}

/** 从取数结果派生统一待办（纯函数，单测直接调用）。 */
export function buildWorkbenchTodos(
  sources: TodoSources,
  now: Date = new Date(),
): WorkbenchTodo[] {
  const rows: WorkbenchTodo[] = [];

  const pushClueTodo = (
    row: ClueListRow,
    kind: TodoKind,
    kindLabel: string,
    stage: string,
    to: string,
    titleSuffix = '',
  ) => {
    rows.push({
      key: `${kind}:${row.id}`,
      kind,
      kindLabel,
      stage,
      title: `${todoTitle(row.code, row.narrative)}${titleSuffix}`,
      from: '—',
      to,
      waitHours: waitHoursSince(now, row.registeredAt),
      updatedAt: dateOf(row.registeredAt),
      urgency: 'ontime',
    });
  };

  for (const row of sources.assignRows) {
    const dispatchPath = registerStepPath(3, row.id);
    if (row.status === 'pending_decision') {
      pushClueTodo(row, 'decide', '待分派决定', '分派决定', dispatchPath);
    }
    if (row.status === 'in_pool') {
      pushClueTodo(row, 'pool', '待派机构', '待分派（内勤池）', dispatchPath);
    }
    if (row.status === 'org_assigned') {
      pushClueTodo(row, 'org-set', '待派承办人', '已派机构待指定主办', dispatchPath);
    }
    if (row.hasGaps) {
      pushClueTodo(
        row,
        'gaps',
        '补齐缺件',
        '要件补齐',
        clueCenterPath('assign', row.id),
        ' · 需补齐缺件',
      );
    }
    if (row.verificationStatus === 'failed') {
      const params = new URLSearchParams({ step: '2', clue: row.id });
      pushClueTodo(row, 'rerun', '重跑核查', '内业核查', `/workbench?${params.toString()}`);
    }
  }

  for (const row of sources.heldRows) {
    pushClueTodo(row, 'held', '撤回不派', '暂存不派', clueCenterPath('held', row.id));
  }

  for (const reminder of sources.reminders) {
    const reason = reminderKindLabel(reminder.kind);
    const other = reminder.otherClueCode ?? '';
    rows.push({
      key: `remind:${reminder.reminderId}`,
      kind: 'remind',
      kindLabel: '处理结案提醒',
      stage: '旧线索结案提醒',
      title: other === '' ? `${reminder.clueCode} · ${reason}` : `${reminder.clueCode} · ${reason}：旧线索 ${other}`,
      from: other === '' ? '—' : `旧线索 ${other}`,
      to: clueCenterPath('remind', reminder.clueId),
      waitHours: waitHoursSince(now, reminder.createdAt),
      updatedAt: dateOf(reminder.createdAt),
      urgency: 'ontime',
    });
  }

  for (const item of sources.designations) {
    rows.push({
      key: `designate:${item.requestId}`,
      kind: 'designate',
      kindLabel: '受理指定管辖',
      stage: '指定管辖受理',
      title: todoTitle(item.clueCode, item.reason),
      from: item.requestingOrgName === '' ? '—' : item.requestingOrgName,
      to: registerStepPath(3, item.clueId),
      waitHours: waitHoursSince(now, item.createdAt),
      updatedAt: dateOf(item.createdAt),
      urgency: 'ontime',
    });
  }

  return sortWorkbenchTodos(rows);
}

/** 默认排序：深红 → 橙 → 蓝；同色内等待更久的优先。 */
export function sortWorkbenchTodos(rows: readonly WorkbenchTodo[]): WorkbenchTodo[] {
  return [...rows].sort(
    (left, right) =>
      URGENCY_RANK[left.urgency] - URGENCY_RANK[right.urgency] ||
      right.waitHours - left.waitHours ||
      left.key.localeCompare(right.key),
  );
}

/** 轻筛选：事项类型＋关键词（编号／事由／地点摘要、事项类型、环节、来自）。 */
export function filterWorkbenchTodos(
  rows: readonly WorkbenchTodo[],
  kind: string,
  keyword: string,
): WorkbenchTodo[] {
  const text = keyword.trim().toLowerCase();
  return rows.filter((row) => {
    if (kind !== '' && row.kind !== kind) return false;
    if (text === '') return true;
    return [row.title, row.kindLabel, row.stage, row.from]
      .join(' ')
      .toLowerCase()
      .includes(text);
  });
}

/** 取统一待办：分配视图、不派视图、结案提醒、指定管辖报请。 */
export async function loadWorkbenchTodos(dispatch: ApiDispatch): Promise<readonly WorkbenchTodo[]> {
  const listParams = {
    page: 1,
    size: 100,
    keyword: '',
    domain: '',
    source: '',
    org: '',
    status: '',
    check: '',
    gap: '',
    from: '',
    to: '',
  };
  const [assign, held, reminders, designations] = await Promise.all([
    listClues(dispatch, { ...listParams, view: 'assign' }),
    listClues(dispatch, { ...listParams, view: 'held' }),
    loadReminders(dispatch),
    // 指定管辖报请只对受理人有意义；无受理权按无待办处理，不影响其余待办。
    loadDesignationTodos(dispatch).catch((): DesignationTodoItem[] => []),
  ]);
  return buildWorkbenchTodos(
    { assignRows: assign.rows, heldRows: held.rows, reminders, designations },
    new Date(),
  );
}