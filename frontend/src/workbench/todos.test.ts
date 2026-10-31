// 统一待办清单的数据层单测（#297 F1）。
// 覆盖：事项类型派生、跳转目标、等待时长、排序（深红→橙→蓝）、轻筛选、
// 以及「不发明法定时限」——没有时限规则时全部蓝点。

import { describe, expect, it } from 'vitest';

import type { ReminderItem } from '../clue/closure';
import type { DesignationTodoItem } from '../clue/dispatch';
import type { ClueListRow } from '../clue/list';
import {
  buildWorkbenchTodos,
  dateOf,
  filterWorkbenchTodos,
  sortWorkbenchTodos,
  todoTitle,
  URGENCY_TIP,
  waitHoursSince,
  type TodoSources,
  type WorkbenchTodo,
} from './todos';

const NOW = new Date('2026-10-31T12:00:00Z');

function clueRow(over: Partial<ClueListRow> = {}): ClueListRow {
  return {
    id: 'clue-1',
    code: 'CL0000000001',
    domain: 'land',
    sourceCode: '16',
    status: 'pending_decision',
    statusLabel: '待分派决定',
    verificationStatus: 'done',
    verificationStatusLabel: '已完成',
    narrative: '天河区石牌街道涉嫌非法占地',
    registeredAt: '2026-10-29T12:00:00Z',
    hasGaps: false,
    tags: [],
    ...over,
  };
}

const EMPTY: TodoSources = { assignRows: [], heldRows: [], reminders: [], designations: [] };

function reminder(over: Partial<ReminderItem> = {}): ReminderItem {
  return {
    reminderId: 'rem-1',
    clueId: 'clue-2',
    clueCode: 'CL0000000002',
    kind: 'no-case',
    otherClueId: 'clue-0',
    otherClueCode: 'CL0000000000',
    otherStatus: 'closed',
    createdAt: '2026-10-30T12:00:00Z',
    mayResolve: true,
    ...over,
  };
}

function designation(over: Partial<DesignationTodoItem> = {}): DesignationTodoItem {
  return {
    requestId: 'req-1',
    clueId: 'clue-9',
    clueCode: 'CL0000000009',
    requestingOrgId: 'org-a',
    requestingOrgName: '天河区分局',
    proposedOrgId: null,
    proposedOrgName: null,
    reviewerOrgId: 'org-b',
    reviewerOrgName: '市局',
    reason: '跨区管辖争议',
    createdAt: '2026-10-31T00:00:00Z',
    ...over,
  };
}

describe('事项类型派生', () => {
  it('待分派决定 / 待派机构 / 待派承办人按状态各自成行，进工作台办理全页', () => {
    const rows = buildWorkbenchTodos(
      {
        ...EMPTY,
        assignRows: [
          clueRow({ id: 'a', code: 'CL000000000A', status: 'pending_decision' }),
          clueRow({ id: 'b', code: 'CL000000000B', status: 'in_pool' }),
          clueRow({ id: 'c', code: 'CL000000000C', status: 'org_assigned' }),
        ],
      },
      NOW,
    );
    const byKind = new Map(rows.map((row) => [row.kind, row]));
    expect(byKind.get('decide')?.kindLabel).toBe('待分派决定');
    expect(byKind.get('decide')?.stage).toBe('分派决定');
    expect(byKind.get('decide')?.to).toBe('/workbench/register?step=3&clue=a');
    expect(byKind.get('pool')?.kindLabel).toBe('待派机构');
    expect(byKind.get('pool')?.stage).toBe('待分派（内勤池）');
    expect(byKind.get('org-set')?.kindLabel).toBe('待派承办人');
    expect(byKind.get('org-set')?.stage).toBe('已派机构待指定主办');
  });

  it('已派承办人且无缺件、核查没失败：不产生待办行', () => {
    const rows = buildWorkbenchTodos(
      { ...EMPTY, assignRows: [clueRow({ status: 'handler_assigned' })] },
      NOW,
    );
    expect(rows).toEqual([]);
  });

  it('缺件与核查没跑成分列成行，点标题分别进线索中心与工作台全页', () => {
    const rows = buildWorkbenchTodos(
      {
        ...EMPTY,
        assignRows: [
          clueRow({ id: 'g', code: 'CL000000000G', hasGaps: true }),
          clueRow({ id: 'r', code: 'CL000000000R', verificationStatus: 'failed' }),
        ],
      },
      NOW,
    );
    const gaps = rows.find((row) => row.kind === 'gaps');
    expect(gaps?.kindLabel).toBe('补齐缺件');
    expect(gaps?.stage).toBe('要件补齐');
    expect(gaps?.to).toBe('/clue?view=assign&clue=g&tab=basic');
    expect(gaps?.title).toContain('需补齐缺件');
    const rerun = rows.find((row) => row.kind === 'rerun');
    expect(rerun?.kindLabel).toBe('重跑核查');
    expect(rerun?.stage).toBe('内业核查');
    expect(rerun?.to).toBe('/workbench?step=2&clue=r');
  });

  it('撤回不派取不派视图，标题带编号与事由', () => {
    const rows = buildWorkbenchTodos(
      {
        ...EMPTY,
        heldRows: [clueRow({ id: 'h', code: 'CL000000000H', status: 'held' })],
      },
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].kindLabel).toBe('撤回不派');
    expect(rows[0].stage).toBe('暂存不派');
    expect(rows[0].to).toBe('/clue?view=held&clue=h&tab=basic');
    expect(rows[0].title).toContain('CL000000000H');
    expect(rows[0].title).toContain('天河区石牌街道涉嫌非法占地');
  });

  it('结案提醒与指定管辖报请并进清单，来自与旧线索编号进「来自／上一手」', () => {
    const rows = buildWorkbenchTodos(
      { ...EMPTY, reminders: [reminder()], designations: [designation()] },
      NOW,
    );
    const remind = rows.find((row) => row.kind === 'remind');
    expect(remind?.kindLabel).toBe('处理结案提醒');
    expect(remind?.stage).toBe('旧线索结案提醒');
    expect(remind?.from).toBe('旧线索 CL0000000000');
    expect(remind?.to).toBe('/clue?view=remind&clue=clue-2&tab=basic');
    const designate = rows.find((row) => row.kind === 'designate');
    expect(designate?.kindLabel).toBe('受理指定管辖');
    expect(designate?.stage).toBe('指定管辖受理');
    expect(designate?.from).toBe('天河区分局');
    expect(designate?.to).toBe('/workbench/register?step=3&clue=clue-9');
  });

  it('同一线索的多个待办并列（决定＋缺件＋重跑）', () => {
    const rows = buildWorkbenchTodos(
      {
        ...EMPTY,
        assignRows: [clueRow({ hasGaps: true, verificationStatus: 'failed' })],
      },
      NOW,
    );
    expect(rows.map((row) => row.kind).sort()).toEqual(['decide', 'gaps', 'rerun']);
  });
});

describe('三色点与排序', () => {
  it('无办理时限规则：全部蓝点，提示按等待时长排序，不发明时限', () => {
    const rows = buildWorkbenchTodos(
      {
        ...EMPTY,
        assignRows: [
          clueRow({ id: 'a', code: 'CL000000000A' }),
          clueRow({ id: 'b', code: 'CL000000000B', status: 'in_pool' }),
        ],
      },
      NOW,
    );
    for (const row of rows) expect(row.urgency).toBe('ontime');
    expect(URGENCY_TIP.ontime).toBe('暂无办理时限规则，按等待时长排序');
  });

  it('排序位次：深红→橙→蓝；同色内等待更久的优先', () => {
    const todo = (key: string, urgency: WorkbenchTodo['urgency'], waitHours: number): WorkbenchTodo => ({
      key,
      kind: 'decide',
      kindLabel: '待分派决定',
      stage: '分派决定',
      title: key,
      from: '—',
      to: '/workbench/register?step=3&clue=x',
      waitHours,
      updatedAt: '2026-10-31',
      urgency,
    });
    const sorted = sortWorkbenchTodos([
      todo('blue-short', 'ontime', 2),
      todo('red', 'overdue', 1),
      todo('blue-long', 'ontime', 20),
      todo('amber', 'urgent', 1),
    ]);
    expect(sorted.map((row) => row.key)).toEqual(['red', 'amber', 'blue-long', 'blue-short']);
  });

  it('等待时长按整小时算，未来或无效时间按 0', () => {
    expect(waitHoursSince(NOW, '2026-10-29T12:00:00Z')).toBe(48);
    expect(waitHoursSince(NOW, '2026-11-01T12:00:00Z')).toBe(0);
    expect(waitHoursSince(NOW, 'not-a-date')).toBe(0);
    expect(dateOf('2026-10-29T12:00:00Z')).toBe('2026-10-29');
    expect(dateOf('')).toBe('—');
  });
});

describe('标题与轻筛选', () => {
  it('标题＝编号＋事由摘要，事由过长截断', () => {
    expect(todoTitle('CL1', ' 非法占地 ')).toBe('CL1 · 非法占地');
    expect(todoTitle('CL1', '')).toBe('CL1');
    const long = '一二三四五六七八九十'.repeat(4);
    const title = todoTitle('CL1', long);
    expect(title.endsWith('…')).toBe(true);
    expect(title.length).toBe('CL1 · '.length + 36 + 1);
  });

  it('事项类型与关键词（编号／事由／环节／来自）一行筛选', () => {
    const rows = buildWorkbenchTodos(
      {
        ...EMPTY,
        assignRows: [clueRow({ id: 'a', code: 'CL000000000A' })],
        heldRows: [clueRow({ id: 'h', code: 'CL000000000H', status: 'held' })],
        reminders: [reminder()],
      },
      NOW,
    );
    expect(filterWorkbenchTodos(rows, 'held', '').map((row) => row.kind)).toEqual(['held']);
    expect(filterWorkbenchTodos(rows, '', '石牌').every((row) => row.title.includes('石牌'))).toBe(true);
    expect(filterWorkbenchTodos(rows, '', '旧线索 cl0000000000').map((row) => row.kind)).toEqual(['remind']);
    expect(filterWorkbenchTodos(rows, 'decide', '石牌')).toHaveLength(1);
    expect(filterWorkbenchTodos(rows, 'decide', '不存在')).toEqual([]);
  });
});