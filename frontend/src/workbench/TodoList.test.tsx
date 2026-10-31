// 工作台统一待办清单的组件测（#297 F1）。
// 测可见结果：七列齐全、三色点＋图例、来源模块固定「线索中心」、
// 标题链接进办理全页、空态有「录入线索」按钮、筛选空态可重置。

import { MemoryRouter } from 'react-router';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import TodoList, { type TodoListProps } from './TodoList';
import type { WorkbenchTodo } from './todos';

const DECIDE: WorkbenchTodo = {
  key: 'decide:clue-1',
  kind: 'decide',
  kindLabel: '待分派决定',
  stage: '分派决定',
  title: 'CL0000000001 · 天河区石牌街道涉嫌非法占地',
  from: '—',
  to: '/workbench/register?step=3&clue=clue-1',
  waitHours: 77,
  updatedAt: '2026-10-21',
  urgency: 'ontime',
};

const HELD: WorkbenchTodo = {
  key: 'held:clue-2',
  kind: 'held',
  kindLabel: '撤回不派',
  stage: '暂存不派',
  title: 'CL0000000002 · 天河区五山街道涉嫌非法建设',
  from: '—',
  to: '/clue?view=held&clue=clue-2&tab=basic',
  waitHours: 12,
  updatedAt: '2026-10-28',
  urgency: 'ontime',
};

const PROPS: TodoListProps = {
  todos: [DECIDE, HELD],
  error: false,
  onRetry: () => undefined,
  kind: '',
  keyword: '',
  keywordDraft: '',
  onKindChange: () => undefined,
  onKeywordChange: () => undefined,
  onApply: () => undefined,
  onReset: () => undefined,
};

function render(over: Partial<TodoListProps> = {}): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <TodoList {...PROPS} {...over} />
    </MemoryRouter>,
  );
}

describe('统一待办清单', () => {
  it('七列齐全：紧急圆点｜标题｜事项类型｜所处环节｜来源模块｜来自／上一手｜等待时长／更新时间', () => {
    const html = render();
    for (const header of ['标题', '事项类型', '所处环节', '来源模块', '来自／上一手', '等待时长／更新时间']) {
      expect(html).toContain(`>${header}</th>`);
    }
    expect(html).toContain('title="紧急程度（仅圆点）"');
    expect(html).toContain('我的待办 · 统一清单');
    expect(html).toContain('共 2 条');
  });

  it('三色点＋图例；无时限规则全部蓝点并带说明', () => {
    const html = render();
    expect(html).toContain('已超期');
    expect(html).toContain('紧急');
    expect(html).toContain('还有时间');
    expect(html).toContain('点色仅为示意；无办理时限规则时全部按等待时长排序');
    expect(html).not.toContain('todo-dot overdue" title');
    expect(html).not.toContain('todo-dot urgent" title');
    expect(html.match(/class="todo-dot ontime" title="暂无办理时限规则，按等待时长排序"/g)).toHaveLength(2);
  });

  it('来源模块固定「线索中心」；等待时长与更新日期分两行', () => {
    const html = render();
    expect(html.match(/>线索中心</g)).toHaveLength(2);
    expect(html).toContain('已等 77 小时');
    expect(html).toContain('2026-10-21');
    expect(html).toContain('已等 12 小时');
  });

  it('点标题进对应办理全页（工作台决定页／线索中心不派视图）', () => {
    const html = render();
    expect(html).toContain('href="/workbench/register?step=3&amp;clue=clue-1"');
    expect(html).toContain('href="/clue?view=held&amp;clue=clue-2&amp;tab=basic"');
    expect(html).toContain('title="进入线索中心对应办理全页"');
  });

  it('空态居中提示并可「录入线索」', () => {
    const html = render({ todos: [] });
    expect(html).toContain('data-role="todo-empty"');
    expect(html).toContain('待办已全部处理，当前没有需要你办的事');
    expect(html).toContain('href="/workbench/register"');
    expect(html).toContain('>录入线索</a>');
    expect(html).toContain('共 0 条');
  });

  it('筛选无结果：提示没有符合条件并可重置，不误报全部处理完', () => {
    const html = render({ kind: 'decide', todos: [HELD] });
    expect(html).toContain('data-role="todo-filter-empty"');
    expect(html).toContain('没有符合筛选条件的待办');
    expect(html).toContain('重置筛选');
    expect(html).not.toContain('待办已全部处理');
  });

  it('载入中给骨架；加载失败可重新加载', () => {
    const loading = render({ todos: null });
    expect(loading).toContain('aria-busy="true"');
    const failed = render({ todos: null, error: true });
    expect(failed).toContain('待办清单没有加载出来');
    expect(failed).toContain('重新加载');
  });
});