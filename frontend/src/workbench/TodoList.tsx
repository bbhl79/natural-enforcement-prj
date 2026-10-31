// 工作台统一待办清单（#297 F1；原型 frontend/prototype/clue-dispatch）。
//
// 主区＝一条待办 LIST：紧急圆点｜标题｜事项类型｜所处环节｜来源模块｜来自／上一手｜
// 等待时长／更新时间。标题点开进线索中心／工作台办理全页（页内展示，不用右侧抽屉）。
// 三色点图例在表头旁；没有办理时限规则时全部蓝点，按等待时长排序。
// 空态给「录入线索」按钮，不甩无控件的空文案。

import { Link } from 'react-router';

import { CLUE_REGISTER_PATH } from '../clue/registration';
import { ErrorCard } from '../shell/StatusPages';
import {
  filterWorkbenchTodos,
  TODO_KINDS,
  URGENCY_TIP,
  type WorkbenchTodo,
} from './todos';

export interface TodoListProps {
  /** null＝载入中。 */
  readonly todos: readonly WorkbenchTodo[] | null;
  readonly error: boolean;
  readonly onRetry: () => void;
  /** 已应用的事项类型筛选（空串＝全部）。 */
  readonly kind: string;
  /** 已应用的关键词筛选。 */
  readonly keyword: string;
  /** 输入框里的关键词草稿（点「筛选」才应用）。 */
  readonly keywordDraft: string;
  readonly onKindChange: (kind: string) => void;
  readonly onKeywordChange: (value: string) => void;
  readonly onApply: () => void;
  readonly onReset: () => void;
}

function Legend() {
  return (
    <div className="todo-legend">
      <span><i className="todo-dot overdue" />已超期</span>
      <span><i className="todo-dot urgent" />紧急</span>
      <span><i className="todo-dot ontime" />还有时间</span>
      <span className="small">点色仅为示意；无办理时限规则时全部按等待时长排序</span>
    </div>
  );
}

export default function TodoList({
  todos,
  error,
  onRetry,
  kind,
  keyword,
  keywordDraft,
  onKindChange,
  onKeywordChange,
  onApply,
  onReset,
}: TodoListProps) {
  const rows = todos === null ? [] : filterWorkbenchTodos(todos, kind, keyword);
  const filtering = kind !== '' || keyword !== '';

  return (
    <div className="card" data-role="workbench-todos">
      <div className="card-h">
        我的待办 · 统一清单
        <span className="hint">清空本表＝当前工作办完；办理请点标题进入线索中心对应全页</span>
      </div>
      <div className="todo-filters">
        <select
          className="select"
          aria-label="事项类型"
          value={kind}
          onChange={(event) => onKindChange(event.target.value)}
        >
          <option value="">全部事项类型</option>
          {TODO_KINDS.map((item) => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </select>
        <input
          className="input"
          aria-label="关键词"
          value={keywordDraft}
          placeholder="关键词：编号 / 事由 / 地点…"
          onChange={(event) => onKeywordChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onApply();
          }}
        />
        <button type="button" className="btn btn-sm" onClick={onApply}>筛选</button>
        <button type="button" className="btn btn-sm" onClick={onReset}>重置</button>
        {todos === null ? null : <span className="todo-count">{`共 ${rows.length} 条`}</span>}
      </div>
      <Legend />
      {error ? (
        <ErrorCard what="待办清单" onRetry={onRetry} />
      ) : todos === null ? (
        <div aria-busy="true">
          <div className="skel" />
          <div className="skel" style={{ width: '60%' }} />
        </div>
      ) : rows.length === 0 ? (
        filtering ? (
          <div className="todo-empty" data-role="todo-filter-empty">
            <div className="msg">没有符合筛选条件的待办</div>
            <button type="button" className="btn" onClick={onReset}>重置筛选</button>
          </div>
        ) : (
          <div className="todo-empty" data-role="todo-empty">
            <div className="msg">待办已全部处理，当前没有需要你办的事</div>
            <Link className="btn btn-primary" to={CLUE_REGISTER_PATH}>录入线索</Link>
          </div>
        )
      ) : (
        <table className="table todo-table">
          <thead>
            <tr>
              <th style={{ width: 36 }} title="紧急程度（仅圆点）" />
              <th>标题</th>
              <th style={{ width: 110 }}>事项类型</th>
              <th style={{ width: 120 }}>所处环节</th>
              <th style={{ width: 88 }}>来源模块</th>
              <th style={{ width: 100 }}>来自／上一手</th>
              <th style={{ width: 120 }}>等待时长／更新时间</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr className="todo-row" key={row.key} data-kind={row.kind}>
                <td className="todo-dot-cell">
                  <i className={`todo-dot ${row.urgency}`} title={URGENCY_TIP[row.urgency]} />
                </td>
                <td>
                  <Link
                    className="todo-title-link"
                    to={row.to}
                    title="进入线索中心对应办理全页"
                  >
                    {row.title}
                  </Link>
                </td>
                <td>{row.kindLabel}</td>
                <td>{row.stage}</td>
                <td>线索中心</td>
                <td className="todo-from">{row.from}</td>
                <td className="todo-wait">{`已等 ${row.waitHours} 小时`}<br />{row.updatedAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}