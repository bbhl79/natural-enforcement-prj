// 内业核查页签（#213；规格 C 节「产物」与 USER LOCK L2）。
//
// 显示四样东西：当前与历史运行、每层的三态与相交事实、分析图预览、手动重跑入口。
// 没跑成时重跑提示一直挂到跑成；核查状态不拦分派，本页签不提供任何跳过入口。

import { useState } from 'react';

import {
  areaText,
  ratioText,
  retryBlockedText,
  type VerificationLayerView,
  type VerificationRunView,
  type VerificationView,
} from './verification';

/** 一层的三态与相交事实。 */
function LayerRow({ layer }: { readonly layer: VerificationLayerView }) {
  return (
    <tr>
      <td>{layer.layerName}</td>
      <td>
        <span className={layer.state === 'unavailable' ? 'tag red' : 'tag'}>{layer.stateLabel}</span>
      </td>
      <td>{areaText(layer.totalArea)}</td>
      <td>{areaText(layer.overlapArea)}</td>
      <td>{areaText(layer.outsideArea)}</td>
      <td>{ratioText(layer.overlapRatio)}</td>
      <td>{layer.featureCount}</td>
    </tr>
  );
}

/** 一次运行。 */
function RunBlock({ run, current }: { readonly run: VerificationRunView; readonly current: boolean }) {
  return (
    <div className="card">
      <div className="card-h">
        {`第 ${run.runNo} 次核查（${run.trigger === 'manual' ? '手动重跑' : '自动核查'}）`}
        <span className="hint">{`${run.statusLabel}　已用尝试 ${run.attemptsUsed} 次`}</span>
      </div>
      {run.failureCategory !== null ? (
        <div className="banner">
          {`${run.failureCategory === 'deterministic' ? '确定性失败，不重试' : '瞬时失败，已自动重试到上限'}。`}
          {run.missingLayers.length > 0
            ? `缺图层：${run.missingLayers.map((layer) => layer.name).join('、')}。`
            : ''}
        </div>
      ) : null}
      {run.layers.length === 0 ? (
        <div className="empty">
          <div className="t">本次核查没有留下分层事实</div>
          <div>核查没跑成时不生成成功报告，报告与分析图不落位。</div>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>图层</th>
              <th>三态</th>
              <th>图斑总面积</th>
              <th>相交面积</th>
              <th>界外面积</th>
              <th>相交比例</th>
              <th>相交要素</th>
            </tr>
          </thead>
          <tbody>
            {run.layers.map((layer) => (
              <LayerRow key={layer.layerKey} layer={layer} />
            ))}
          </tbody>
        </table>
      )}
      {current ? null : <div className="foot">{`开始于 ${run.startedAt}`}</div>}
    </div>
  );
}

/**
 * 内业核查页签。
 * view 为核查视图；onRetry 是手动重跑入口（无权时不渲染按钮）。
 */
export function ClueVerificationTab({
  view,
  onRetry,
  busy,
}: {
  readonly view: VerificationView;
  readonly onRetry?: () => void;
  readonly busy?: boolean;
}) {
  const [failure, setFailure] = useState<string | null>(null);
  const blocked = retryBlockedText(view);

  if (!view.required) {
    return (
      <div className="empty">
        <div className="t">不设内业核查</div>
        <div>测绘类与规划类线索不跑内业核查。</div>
      </div>
    );
  }

  return (
    <div>
      <div className="card">
        <div className="card-h">
          内业核查
          <span className="hint">{view.verificationStatusLabel}</span>
        </div>
        <div className="filters">
          <span className={view.verificationStatus === 'done' ? 'tag ok' : 'tag gray'}>
            {view.verificationStatusLabel}
          </span>
          <span className="tag gray">{`线索编号 ${view.code}`}</span>
          {view.artifacts !== null ? (
            <a className="btn btn-sm" href={`/api/clues/${view.clueId}/verification/report`}>
              下载核查报告
            </a>
          ) : null}
          {view.artifacts !== null ? (
            <a className="btn btn-sm" href={`/api/clues/${view.clueId}/verification/analysis`}>
              下载分析图
            </a>
          ) : null}
          {view.canRetry && onRetry !== undefined ? (
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={busy === true}
              onClick={() => {
                setFailure(null);
                onRetry();
              }}
            >
              手动重跑
            </button>
          ) : null}
        </div>
        {view.verificationStatus === 'failed' ? (
          <div className="banner">
            内业核查没跑成。重跑提示一直挂到跑成，线索照常可以分派。
          </div>
        ) : null}
        {blocked !== null ? <div className="help">{blocked}</div> : null}
        {failure !== null ? <div className="err">{failure}</div> : null}
      </div>

      {view.current === null ? (
        <div className="empty">
          <div className="t">还没有核查记录</div>
          <div>录入保存后自动发起内业核查，不可跳过。</div>
        </div>
      ) : (
        <RunBlock run={view.current} current />
      )}

      {view.runs.length > 1 ? (
        <div className="card">
          <div className="card-h">历史运行</div>
          {view.runs.slice(1).map((run) => (
            <RunBlock key={run.id} run={run} current={false} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
