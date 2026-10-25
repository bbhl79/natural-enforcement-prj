// 疑似重复比对页签（#212；规格 B「几何与疑似重复」与交互锁）。
//
// 显示：决定步提示（默认不派／已知晓／举报必派）、按对方线索分组折叠的命中面对
// （占本线索 x.x%／占对方 y.y%，1 位小数，达标一方加粗）、交集面积（亩）、
// 图斑对比（涉匿名分组关闭，防精确坐标外泄）、反映人默认脱敏与查看实名入口。
// 点状线索不做空间重合判定，只显示说明。

import { useState } from 'react';

import {
  areaMuText,
  compareSvgModel,
  decisionText,
  hitSide,
  ratioText,
  type DuplicateFaceView,
  type DuplicateGroupView,
  type DuplicateView,
  type ReporterReadResult,
} from './duplicate';

/** 图斑对比：两面同图叠加（本线索绿色、对方橙色）。 */
function CompareFaces({ face }: { readonly face: DuplicateFaceView }) {
  const model =
    face.selfGeojson !== null && face.otherGeojson !== null
      ? compareSvgModel(face.selfGeojson, face.otherGeojson)
      : null;
  if (model === null) {
    return <div className="help">本组涉匿名保护，不支持图斑对比。</div>;
  }
  return (
    <div className="dup-compare">
      <svg viewBox={model.viewBox} role="img" aria-label="图斑对比">
        <polygon points={model.selfPoints} fill="#2f7d4f" fillOpacity={0.45} stroke="#2f7d4f" />
        <polygon points={model.otherPoints} fill="#b3541e" fillOpacity={0.45} stroke="#b3541e" />
      </svg>
      <div className="dup-legend">
        <span className="tag">绿：本线索面（第 {face.partIndex + 1} 面）</span>
        <span className="tag gray">橙：对方面（第 {face.otherPartIndex + 1} 面）</span>
      </div>
    </div>
  );
}

/** 一个命中面对行。 */
function FaceRow({ face }: { readonly face: DuplicateFaceView }) {
  const [open, setOpen] = useState(false);
  const side = hitSide(face.selfRatio, face.otherRatio);
  const bold = (which: 'self' | 'other'): boolean =>
    side === 'both' || side === which;
  return (
    <tr>
      <td>{`本线索第 ${face.partIndex + 1} 面 × 对方第 ${face.otherPartIndex + 1} 面`}</td>
      <td className={bold('self') ? 'dup-hit' : undefined}>{`占本线索 ${ratioText(face.selfRatio)}`}</td>
      <td className={bold('other') ? 'dup-hit' : undefined}>{`占对方 ${ratioText(face.otherRatio)}`}</td>
      <td>{areaMuText(face.intersectionArea)}</td>
      <td>
        <button type="button" className="btn btn-sm" onClick={() => setOpen(!open)}>
          {open ? '收起对比' : '对比查看'}
        </button>
        {open ? <CompareFaces face={face} /> : null}
      </td>
    </tr>
  );
}

/** 一个对方线索分组（多面命中分组折叠）。 */
function GroupBlock({
  group,
  onReadReporter,
}: {
  readonly group: DuplicateGroupView;
  readonly onReadReporter: (otherClueId: string) => Promise<ReporterReadResult>;
}) {
  const [reporter, setReporter] = useState<{ name: string | null; contact: string | null } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const read = () => {
    setFailure(null);
    onReadReporter(group.otherClueId)
      .then((result) => {
        if (!result.ok) {
          setFailure(result.status === 403 ? '没有查看实名权限。' : `查看实名未受理（${result.status}）。`);
          return;
        }
        setReporter({ name: result.reporterName, contact: result.reporterContact });
      })
      .catch(() => setFailure('查看实名读取失败。'));
  };
  return (
    <details className="dup-group" open={group.faces.length <= 1}>
      <summary>
        {`与 ${group.otherClueCode} 疑似重复`}
        <span className="tag">{group.otherStatusLabel}</span>
        {group.anonymous ? <span className="tag gray">涉匿名</span> : null}
        <span className="hint">{`登记于 ${group.otherRegisteredAt}`}</span>
      </summary>
      <div className="dup-peer">
        {group.otherLocation !== null ? <span className="tag gray">{`位置：${group.otherLocation}`}</span> : null}
        {group.otherReporterName !== null || group.otherReporterContact !== null ? (
          <span className="tag gray">
            {`反映人：${group.otherReporterName ?? '—'}（${group.otherReporterContact ?? '—'}）`}
          </span>
        ) : null}
        {reporter === null && (group.otherReporterName !== null || group.otherReporterContact !== null) ? (
          <button type="button" className="btn btn-sm" onClick={read}>
            查看实名
          </button>
        ) : null}
        {reporter !== null ? (
          <span className="tag">{`实名：${reporter.name ?? '—'}（${reporter.contact ?? '—'}）`}</span>
        ) : null}
        {failure !== null ? <span className="err">{failure}</span> : null}
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>面对</th>
            <th>占本线索</th>
            <th>占对方</th>
            <th>交集面积</th>
            <th>图斑</th>
          </tr>
        </thead>
        <tbody>
          {group.faces.map((face) => (
            <FaceRow key={`${face.partId}:${face.otherPartId}`} face={face} />
          ))}
        </tbody>
      </table>
    </details>
  );
}

/**
 * 疑似重复比对页签。
 * view 为比对视图；onReadReporter 取对方实名（服务端记查阅留痕）。
 */
export function ClueDuplicateTab({
  view,
  onReadReporter,
}: {
  readonly view: DuplicateView;
  readonly onReadReporter: (otherClueId: string) => Promise<ReporterReadResult>;
}) {
  const hint = decisionText(view);
  return (
    <div>
      <div className="card">
        <div className="card-h">
          疑似重复比对
          <span className="hint">{`线索编号 ${view.code}`}</span>
        </div>
        {view.pointNotice !== null ? <div className="banner">{view.pointNotice}</div> : null}
        {hint !== null ? <div className="banner">{hint}</div> : null}
        {view.dupComputedAt !== null ? (
          <div className="help">{`命中集计算于 ${view.dupComputedAt}`}</div>
        ) : null}
      </div>

      {view.spatialKind === 'point' ? null : view.groups.length === 0 ? (
        <div className="empty">
          <div className="t">没有疑似重复</div>
          <div>与未结案的既有线索没有任一面对达到重合阈值。</div>
        </div>
      ) : (
        view.groups.map((group) => (
          <GroupBlock key={group.otherClueId} group={group} onReadReporter={onReadReporter} />
        ))
      )}
    </div>
  );
}
