// 线索中心（一级入口）。视图、关键词、筛选、日期与分页都从地址取（见 shell/clueUrl.ts），
// 本页只提供入口与筛选条件的回显；线索清单的取数与列表由后续业务范围接入。
import { Link, useSearchParams } from 'react-router';

import { clueViewLabel, readClueUrlState, CLUE_VIEW_KEY } from '../shell/clueUrl';

export default function ClueCenterPage() {
  const [params] = useSearchParams();
  const state = readClueUrlState(params.toString());
  const view = state.view || 'all';
  const filters = Object.entries(state.filters).filter(([, value]) => value);
  return (
    <>
      <div className="crumb"><b>线索中心</b></div>
      <div className="page-h">
        <div>
          <h1>线索中心</h1>
          <div className="desc">全部登记的线索统一进这里，可按视图、筛选与关键词查询。</div>
        </div>
      </div>
      <div className="card">
        <div className="card-h">
          {clueViewLabel(view)}
          <span className="hint">视图、筛选与关键词都在地址里，可直接分享或收藏</span>
        </div>
        <div className="filters">
          <span className="tag gray">{`视图：${clueViewLabel(view)}`}</span>
          {state.keyword ? <span className="tag">{`关键词：${state.keyword}`}</span> : null}
          {filters.map(([key, value]) => (
            <span key={key} className="tag gray">{`${key}：${value}`}</span>
          ))}
          {state.from || state.to ? (
            <span className="tag gray">{`登记日：${state.from || '不限'} 至 ${state.to || '不限'}`}</span>
          ) : null}
          {state.keyword || filters.length || state.from || state.to ? (
            <Link className="btn btn-sm" to={`/clue?${CLUE_VIEW_KEY}=${view}`}>清除筛选</Link>
          ) : null}
        </div>
        <div className="empty">
          <div className="t">线索清单尚未开放</div>
          <div>线索的登记、查询与详情办理在后续范围接入。当前可先用顶栏综合查询带关键词进入本页。</div>
        </div>
      </div>
    </>
  );
}
