// 流转与留痕页签（#207 线索中心抽屉）。
//
// 以时间线样式展示留痕列表，按时间倒序排列。
// 每条含时间、操作人、操作人机构、动作描述，不含 detail。

import type { TrailEntry } from './trail';

/**
 * 流转与留痕页签。
 * entries 为留痕列表。
 */
export function ClueTrailTab({ entries }: { readonly entries: readonly TrailEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="empty">
        <div className="t">暂无流转留痕</div>
        <div>线索暂未产生流转记录。</div>
      </div>
    );
  }

  return (
    <div className="trail">
      {entries.map((entry, index) => (
        <div key={index} className="trail-entry">
          <div className="hint">{entry.createdAt}</div>
          <div>
            <span className="tag">{entry.actorName}</span>
            <span className="tag gray">{entry.orgName}</span>
          </div>
          <div>{entry.actionLabel}</div>
        </div>
      ))}
    </div>
  );
}