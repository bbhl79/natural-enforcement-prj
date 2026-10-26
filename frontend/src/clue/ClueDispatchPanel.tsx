// 分派决定与两步分派的办理界面（#214；规格 B/D 节、GLOSSARY）。
//
// 决定步集中展示「与哪条线索重复／与谁重复」：多面命中按对方线索分组折叠，
// 每个命中面对显示「占本线索 x.x%／占对方 y.y%」（保留 1 位小数，达标一方加粗），
// 可打开图斑对比。默认不派；点「已知晓」可继续派；群众举报只能派；
// 全部对方已结案可直接派出，但仍由人完成决定。
// 两步分派：派机构（带辖区建议，建议不自动派）→ 派主办／协办；重新分派理由必填。
//
// 纯渲染组件（单测直接渲染），取数与提交在容器组件里。

import { useState, type ReactNode } from 'react';

import {
  dispatchStatusLabel,
  hitQualified,
  hitRatioText,
  muText,
  suggestionEmptyText,
  type DispatchView,
} from './dispatch';

/** 报请指定管辖（本级机构内勤；理由必填、可选拟归属机构）。 */
export function DesignateRequestPanel({
  busy,
  failure,
  orgOptions,
  onRequest,
  readOnly = false,
}: {
  busy: boolean;
  failure: string | null;
  orgOptions: readonly OrgOption[];
  onRequest: (input: { reason: string; proposedOrgId: string | null }) => void;
  /** 监督身份只读：写操作禁用。 */
  readOnly?: boolean;
}) {
  const [reason, setReason] = useState('');
  const [proposedOrgId, setProposedOrgId] = useState('');
  return (
    <div className="card" data-role="designate-request-panel">
      <div className="card-h">
        报请指定管辖
        <span className="hint">{readOnly ? '监督身份只读，不可分派' : '线索不属本级管辖（含应归平级机构的）时报请上级指定'}</span>
      </div>
      {failure ? <div className="banner danger" data-role="failure">{failure}</div> : null}
      <div className="form-row">
        <label htmlFor="designate-reason">报请理由</label>
        <div>
          <input
            id="designate-reason"
            className="input"
            value={reason}
            disabled={readOnly}
            onChange={(event) => setReason(event.target.value)}
          />
          <div className="help">理由必填；报请期间该线索不能分派、重新分派或移送。</div>
        </div>
      </div>
      <div className="form-row">
        <label htmlFor="designate-proposed">拟归属机构</label>
        <div>
          <select
            id="designate-proposed"
            className="select"
            value={proposedOrgId}
            disabled={readOnly}
            onChange={(event) => setProposedOrgId(event.target.value)}
          >
            <option value="">不指定（由直接上级受理）</option>
            {orgOptions.map((org) => (
              <option key={org.orgUnitId} value={org.orgUnitId}>
                {org.name}
              </option>
            ))}
          </select>
          <div className="help">选填；受理人＝报请方与拟归属机构的最近共同上级内勤。</div>
        </div>
      </div>
      <div className="actions">
        <button
          type="button"
          className="btn btn-primary"
          data-role="designate-request"
          disabled={readOnly || busy || reason.trim() === ''}
          title={readOnly ? '监督身份只读，不可分派' : undefined}
          onClick={() => onRequest({ reason: reason.trim(), proposedOrgId: proposedOrgId === '' ? null : proposedOrgId })}
        >
          报请指定管辖
        </button>
      </div>
    </div>
  );
}

/** 受理人处理进行中的报请（#215）：指定管辖（designate=true 派机构）或驳回。 */
export function DesignateReviewPanel({
  view,
  busy,
  failure,
  onReject,
  readOnly = false,
}: {
  view: DispatchView;
  busy: boolean;
  failure: string | null;
  onReject: (reason: string) => void;
  /** 监督身份只读：驳回与指定管辖禁用。 */
  readOnly?: boolean;
}) {
  const [rejectReason, setRejectReason] = useState('');
  const designation = view.designation;
  if (!designation) return null;
  return (
    <div className="card" data-role="designate-review-panel">
      <div className="card-h">
        指定管辖报请
        <span className="hint">{`报请机构：${designation.requestingOrgName}`}</span>
      </div>
      {failure ? <div className="banner danger" data-role="failure">{failure}</div> : null}
      <div className="banner amber" data-role="designate-pending">
        {`${designation.requestingOrgName}报请指定管辖：${designation.reason}；拟归属：${designation.proposedOrgName ?? '未指定'}。`}
      </div>
      {view.mayReviewDesignation || readOnly ? (
        <>
          <div className="help">
            {readOnly
              ? '监督身份只读，不可分派。可查阅报请内容，不能指定管辖或驳回。'
              : '处理＝以「指定管辖」指定承办机构（同时关闭报请），或驳回。驳回须填理由。'}
          </div>
          <div className="form-row">
            <label htmlFor="designate-reject-reason">驳回理由</label>
            <div>
              <input
                id="designate-reject-reason"
                className="input"
                value={rejectReason}
                disabled={readOnly}
                onChange={(event) => setRejectReason(event.target.value)}
              />
            </div>
          </div>
          <div className="actions">
            <button
              type="button"
              className="btn"
              data-role="designate-reject"
              disabled={readOnly || busy || rejectReason.trim() === ''}
              title={readOnly ? '监督身份只读，不可分派' : undefined}
              onClick={() => onReject(rejectReason.trim())}
            >
              驳回报请
            </button>
            <span className="help">指定承办机构请用下方「重新分派／指定管辖」，勾选指定管辖。</span>
          </div>
        </>
      ) : (
        <div className="help">{`该报请由${designation.reviewerOrgName}的内勤受理。`}</div>
      )}
    </div>
  );
}

/** 对比查看的一对命中面（审图意见 #1 口径：两边的面各自什么形状、占多少）。 */
function CompareDialog({
  view,
  groupIndex,
  pairIndex,
}: {
  view: DispatchView;
  groupIndex: number;
  pairIndex: number;
}) {
  const group = view.hitGroups[groupIndex];
  const pair = group?.pairs[pairIndex];
  if (!group || !pair) return null;
  return (
    <div className="banner gray" data-role="dialog-compare">
      <div>
        {`图斑对比：本线索 ${view.code} 第 ${pair.partIndex + 1} 面 与 ${group.otherClueCode} 的命中面`}
      </div>
      <div>{`占本线索 ${hitRatioText(pair.selfRatio)}（${muText(pair.intersectionArea)}相交）／占对方 ${hitRatioText(pair.otherRatio)}`}</div>
      <div className="help">图斑以登记几何为准，可在地图应用里按编号调阅原图。</div>
    </div>
  );
}

/** 疑似重复的命中展示：按对方线索分组折叠。 */
export function HitGroups({ view }: { view: DispatchView }) {
  const [compare, setCompare] = useState<{ group: number; pair: number } | null>(null);
  if (view.hitGroups.length === 0) {
    return <div className="help" data-role="no-hits">未发现疑似重复，可直接进入分派。</div>;
  }
  return (
    <div data-role="hit-groups">
      {view.hitGroups.map((group, groupIndex) => (
        <div className="card" key={group.otherClueId} data-role="hit-group" data-other={group.otherClueCode}>
          <div className="card-h">
            {`与 ${group.otherClueCode} 重复`}
            <span className="hint">{group.open ? '对方未结案' : '对方已结案'}</span>
          </div>
          {group.pairs.map((pair, pairIndex) => (
            <div className="form-row" key={`${pair.partId}-${pair.otherPartId}`} data-role="hit-pair">
              <label>{`本线索第 ${pair.partIndex + 1} 面`}</label>
              <div>
                <span>
                  {'占本线索 '}
                  <b className={hitQualified(pair.selfRatio) ? 'hit-strong' : undefined}>
                    {hitRatioText(pair.selfRatio)}
                  </b>
                  {'／占对方 '}
                  <b className={hitQualified(pair.otherRatio) ? 'hit-strong' : undefined}>
                    {hitRatioText(pair.otherRatio)}
                  </b>
                  {`（相交 ${muText(pair.intersectionArea)}）`}
                </span>{' '}
                <button
                  type="button"
                  className="btn btn-sm"
                  data-role="open-compare"
                  onClick={() => setCompare({ group: groupIndex, pair: pairIndex })}
                >
                  对比
                </button>
              </div>
            </div>
          ))}
        </div>
      ))}
      {compare ? <CompareDialog view={view} groupIndex={compare.group} pairIndex={compare.pair} /> : null}
    </div>
  );
}

/** 辖区建议（不自动派；空建议不拦手工分派）。 */
export function SuggestionList({ view }: { view: DispatchView }) {
  const suggestion = view.suggestion;
  const emptyText = suggestionEmptyText(suggestion);
  if (emptyText) {
    return <div className="banner amber" data-role="suggestion-empty">{emptyText}</div>;
  }
  if (suggestion.suggestions.length === 0) return null;
  return (
    <div className="card" data-role="suggestion">
      <div className="card-h">
        辖区建议
        <span className="hint">按占比降序，供参考、不自动分派</span>
      </div>
      {suggestion.crossDistrict ? (
        <div className="banner amber" data-role="cross-district">{suggestion.hint}</div>
      ) : null}
      {suggestion.suggestions.map((item) => (
        <div className="form-row" key={item.orgUnitId} data-role="suggestion-item" data-org={item.orgName}>
          <label>{item.orgName}</label>
          <div>
            <b>{hitRatioText(item.ratio)}</b>
            {suggestion.kind === 'point' ? null : `（${muText(item.area)}）`}
            <div className="help">
              {item.streets
                .map((street) =>
                  street.faces.length > 0
                    ? `${street.streetName}：${street.faces.map((face) => `第 ${face.partIndex + 1} 面 ${muText(face.area)}`).join('、')}`
                    : street.streetName,
                )
                .join('；')}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** 分派决定步（待分派决定）。 */
export function DecidePanel({
  view,
  busy,
  failure,
  onDecide,
  readOnly = false,
}: {
  view: DispatchView;
  busy: boolean;
  failure: string | null;
  onDecide: (decision: 'dispatch' | 'hold', acknowledged: boolean, conflictResolution?: string, conflictBasis?: string) => void;
  /** 监督身份只读：派与不派都禁用。 */
  readOnly?: boolean;
}) {
  const hasOpenHits = view.hitGroups.some((group) => group.open);
  const [conflictResolution, setConflictResolution] = useState('');
  const [conflictBasis, setConflictBasis] = useState('');
  const needsConflictResolution = view.hasCaseByCasePlanningType && !view.complaint;
  const canDispatch =
    !busy &&
    (!needsConflictResolution ||
      ((conflictResolution === 'handle-in-system' || conflictResolution === 'transfer-outside') &&
        conflictBasis.trim() !== ''));
  return (
    <div className="card" data-role="decide-panel">
      <div className="card-h">
        分派决定
        <span className="hint">{readOnly ? '监督身份只读，不可分派' : view.complaint ? '群众举报线索只能派、不能选不派' : '默认不派，点「已知晓」可继续派'}</span>
      </div>
      {failure ? <div className="banner danger" data-role="failure">{failure}</div> : null}
      {view.complaint ? (
        <div className="banner gray">群众举报及其下级的线索只能派、不能选不派；重合信息仍展示供参考。</div>
      ) : null}
      {needsConflictResolution ? (
        <div className="banner amber" data-role="conflict-banner">
          该线索涉及规划类主体冲突待定项，派出前须选择办理方向并填写依据留痕。
        </div>
      ) : null}
      {hasOpenHits ? (
        <div className="banner amber">存在未结案的疑似重复命中：点「已知晓并派出」继续，或选「不派」。</div>
      ) : (
        <div className="banner gray">全部对方已结案，可直接派出；仍须由人完成决定。</div>
      )}
      {needsConflictResolution ? (
        <>
          <div className="form-row">
            <label>办理方向</label>
            <div>
              <label className="help" style={{ marginRight: 16 }}>
                <input
                  type="radio"
                  name="conflict-resolution"
                  value="handle-in-system"
                  data-role="conflict-handle-in-system"
                  checked={conflictResolution === 'handle-in-system'}
                  onChange={(event) => setConflictResolution(event.target.value)}
                  disabled={readOnly || busy}
                />
                {' 本系统办理'}
              </label>
              <label className="help">
                <input
                  type="radio"
                  name="conflict-resolution"
                  value="transfer-outside"
                  data-role="conflict-transfer-outside"
                  checked={conflictResolution === 'transfer-outside'}
                  onChange={(event) => setConflictResolution(event.target.value)}
                  disabled={readOnly || busy}
                />
                {' 移送系统外'}
              </label>
            </div>
          </div>
          <div className="form-row">
            <label htmlFor="conflict-basis">依据（必填）</label>
            <div>
              <textarea
                id="conflict-basis"
                className="input"
                rows={3}
                value={conflictBasis}
                onChange={(event) => setConflictBasis(event.target.value)}
                data-role="conflict-basis"
                disabled={readOnly || busy}
              />
              <div className="help">填写法律依据与判断理由，留痕在审计记录中。</div>
            </div>
          </div>
        </>
      ) : null}
      <HitGroups view={view} />
      <div className="actions">
        {view.complaint ? null : (
          <button
            type="button"
            className="btn"
            data-role="decide-hold"
            disabled={readOnly || busy}
            title={readOnly ? '监督身份只读，不可分派' : undefined}
            onClick={() => onDecide('hold', false)}
          >
            不派
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary"
          data-role="decide-dispatch"
          disabled={readOnly || !canDispatch}
          title={readOnly ? '监督身份只读，不可分派' : undefined}
          onClick={() =>
            onDecide(
              'dispatch',
              hasOpenHits && !view.complaint,
              needsConflictResolution ? conflictResolution : undefined,
              needsConflictResolution ? conflictBasis.trim() : undefined,
            )
          }
        >
          {hasOpenHits && !view.complaint ? '已知晓并派出' : '派出'}
        </button>
      </div>
    </div>
  );
}

/** 机构选项（含辖区建议候选与本单位数据范围内的机构）。 */
export interface OrgOption {
  readonly orgUnitId: string;
  readonly name: string;
}

/** 派机构（含重新分派与指定管辖）。 */
export function AssignOrgPanel({
  view,
  orgOptions,
  reassigning,
  busy,
  failure,
  onAssign,
  designateByDefault = false,
  readOnly = false,
}: {
  view: DispatchView;
  orgOptions: readonly OrgOption[];
  reassigning: boolean;
  busy: boolean;
  failure: string | null;
  onAssign: (input: { orgUnitId: string; reason: string; designate: boolean }) => void;
  /** 受理人处理报请时默认勾选指定管辖（#215）。 */
  designateByDefault?: boolean;
  /** 监督身份只读：派机构与重新分派禁用。 */
  readOnly?: boolean;
}) {
  const [orgUnitId, setOrgUnitId] = useState('');
  const [reason, setReason] = useState('');
  const [designate, setDesignate] = useState(designateByDefault);
  const suggested = new Set(view.suggestion.suggestions.map((item) => item.orgUnitId));
  return (
    <div className="card" data-role="assign-org-panel">
      <div className="card-h">
        {reassigning ? '重新分派' : '派机构'}
        <span className="hint">{readOnly ? '监督身份只读，不可分派' : reassigning ? '理由必填、留痕、不限次数' : '接收侧内勤派机构'}</span>
      </div>
      {failure ? <div className="banner danger" data-role="failure">{failure}</div> : null}
      <SuggestionList view={view} />
      <div className="form-row">
        <label htmlFor="dispatch-org">承办机构</label>
        <div>
          <select id="dispatch-org" className="select" value={orgUnitId} disabled={readOnly} onChange={(event) => setOrgUnitId(event.target.value)}>
            <option value="">请选择机构</option>
            {orgOptions.map((org) => (
              <option key={org.orgUnitId} value={org.orgUnitId}>
                {suggested.has(org.orgUnitId) ? `${org.name}（辖区建议）` : org.name}
              </option>
            ))}
          </select>
          <div className="help">只能派给本人数据范围内的机构；线索不属本级管辖的，报请上级指定管辖。</div>
        </div>
      </div>
      {reassigning || designateByDefault ? (
        <div className="form-row">
          <label htmlFor="dispatch-reason">理由</label>
          <div>
            <input
              id="dispatch-reason"
              className="input"
              value={reason}
              disabled={readOnly}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
        </div>
      ) : null}
      <div className="actions">
        <button
          type="button"
          className="btn btn-primary"
          data-role="assign-org"
          disabled={readOnly || busy || orgUnitId === ''}
          title={readOnly ? '监督身份只读，不可分派' : undefined}
          onClick={() => onAssign({ orgUnitId, reason: reason.trim(), designate })}
        >
          {reassigning ? '重新分派' : '派出机构'}
        </button>
        <label className="help">
          <input
            type="checkbox"
            data-role="designate"
            checked={designate}
            disabled={readOnly}
            onChange={(event) => setDesignate(event.target.checked)}
          />
          {' 指定管辖（上级内勤指定下级机构承办）'}
        </label>
      </div>
    </div>
  );
}

/** 移送（自然资源部门以外的机关；#216）。 */
export function TransferPanel({
  busy,
  failure,
  onTransfer,
  readOnly = false,
}: {
  busy: boolean;
  failure: string | null;
  onTransfer: (input: { transferOrg: string; documentNo: string; letterDate: string; reason: string; attachments: readonly File[] }) => void;
  /** 监督身份只读：移送登记禁用。 */
  readOnly?: boolean;
}) {
  const [transferOrg, setTransferOrg] = useState('');
  const [documentNo, setDocumentNo] = useState('');
  const [letterDate, setLetterDate] = useState('');
  const [reason, setReason] = useState('');
  const [attachments, setAttachments] = useState<readonly File[]>([]);
  const today = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return (
    <div className="card" data-role="transfer-panel">
      <div className="card-h">
        移送（自然资源部门以外机关）
        <span className="hint">{readOnly ? '监督身份只读，不可分派' : '登记后进已移送终态，退出比对与待办计数'}</span>
      </div>
      {failure ? <div className="banner danger" data-role="failure">{failure}</div> : null}
      <div className="form-row">
        <label htmlFor="transfer-org">移送机关</label>
        <div>
          <input
            id="transfer-org"
            className="input"
            value={transferOrg}
            disabled={readOnly}
            onChange={(event) => setTransferOrg(event.target.value)}
          />
          <div className="help">只指向自然资源部门以外的机关；不区分管辖、涉刑、党纪政务。</div>
        </div>
      </div>
      <div className="form-row">
        <label htmlFor="transfer-doc-no">文书编号</label>
        <div>
          <input
            id="transfer-doc-no"
            className="input"
            value={documentNo}
            disabled={readOnly}
            onChange={(event) => setDocumentNo(event.target.value)}
          />
        </div>
      </div>
      <div className="form-row">
        <label htmlFor="transfer-letter-date">发函日期</label>
        <div>
          <input
            id="transfer-letter-date"
            className="input"
            type="date"
            value={letterDate}
            disabled={readOnly}
            onChange={(event) => setLetterDate(event.target.value)}
          />
          <div className="help">{`留空默认北京当日（${today}），允许补录。`}</div>
        </div>
      </div>
      <div className="form-row">
        <label htmlFor="transfer-reason">原因</label>
        <div>
          <input
            id="transfer-reason"
            className="input"
            value={reason}
            disabled={readOnly}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
      </div>
      <div className="form-row">
        <label htmlFor="transfer-attachments">附件</label>
        <div>
          <input
            id="transfer-attachments"
            data-role="transfer-attachments"
            type="file"
            multiple
            disabled={readOnly}
            onChange={(event) => setAttachments(Array.from(event.target.files ?? []))}
          />
          <div className="help">选填 0..n 件：图片、PDF 或 Office 文档，服务端核对真实内容。</div>
        </div>
      </div>
      <div className="actions">
        <button
          type="button"
          className="btn"
          data-role="transfer-submit"
          disabled={readOnly || busy || transferOrg.trim() === '' || documentNo.trim() === '' || reason.trim() === ''}
          title={readOnly ? '监督身份只读，不可分派' : undefined}
          onClick={() =>
            onTransfer({
              transferOrg: transferOrg.trim(),
              documentNo: documentNo.trim(),
              letterDate: letterDate,
              reason: reason.trim(),
              attachments,
            })
          }
        >
          登记移送
        </button>
      </div>
    </div>
  );
}

/** 派主办／协办。 */
export function AssignPeoplePanel({
  view,
  busy,
  failure,
  onAssign,
  readOnly = false,
}: {
  view: DispatchView;
  busy: boolean;
  failure: string | null;
  onAssign: (input: { mainId: string; assistIds: readonly string[] }) => void;
  /** 监督身份只读：派主办与协办禁用。 */
  readOnly?: boolean;
}) {
  const [mainId, setMainId] = useState('');
  const [assistIds, setAssistIds] = useState<readonly string[]>([]);
  return (
    <div className="card" data-role="assign-people-panel">
      <div className="card-h">
        派主办／协办
        <span className="hint">{readOnly ? '监督身份只读，不可分派' : '承办机构内勤指定'}</span>
      </div>
      {failure ? <div className="banner danger" data-role="failure">{failure}</div> : null}
      {view.candidates.length === 0 ? (
        <div className="banner amber">承办机构暂无在职人员，请重新分派或由上级指定管辖。</div>
      ) : (
        <>
          <div className="form-row">
            <label htmlFor="dispatch-main">主办</label>
            <div>
              <select id="dispatch-main" className="select" value={mainId} disabled={readOnly} onChange={(event) => setMainId(event.target.value)}>
                <option value="">请选择主办</option>
                {view.candidates.map((person) => (
                  <option key={person.personnelId} value={person.personnelId}>
                    {`${person.name}（${person.code}）`}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-row">
            <label>协办</label>
            <div className="checks">
              {view.candidates
                .filter((person) => person.personnelId !== mainId)
                .map((person) => (
                  <label key={person.personnelId}>
                    <input
                      type="checkbox"
                      data-assist={person.personnelId}
                      disabled={readOnly}
                      checked={assistIds.includes(person.personnelId)}
                      onChange={(event) =>
                        setAssistIds(
                          event.target.checked
                            ? [...assistIds, person.personnelId]
                            : assistIds.filter((id) => id !== person.personnelId),
                        )
                      }
                    />
                    {` ${person.name}（${person.code}）`}
                  </label>
                ))}
            </div>
          </div>
        </>
      )}
      <div className="actions">
        <button
          type="button"
          className="btn btn-primary"
          data-role="assign-people"
          disabled={readOnly || busy || mainId === ''}
          title={readOnly ? '监督身份只读，不可分派' : undefined}
          onClick={() => onAssign({ mainId, assistIds })}
        >
          派出承办人
        </button>
      </div>
    </div>
  );
}

/** 分派办理面板：按线索状态渲染决定／派机构／派承办人。 */
export function ClueDispatchBody({
  view,
  orgOptions,
  busy,
  failure,
  onDecide,
  onAssignOrg,
  onAssignPeople,
  onTransfer,
  onDesignateRequest,
  onDesignateReject,
  supervisorReadonly = false,
}: {
  view: DispatchView;
  orgOptions: readonly OrgOption[];
  busy: boolean;
  failure: string | null;
  onDecide: (decision: 'dispatch' | 'hold', acknowledged: boolean, conflictResolution?: string, conflictBasis?: string) => void;
  onAssignOrg: (input: { orgUnitId: string; reason: string; designate: boolean }) => void;
  onAssignPeople: (input: { mainId: string; assistIds: readonly string[] }) => void;
  onTransfer: (input: { transferOrg: string; documentNo: string; letterDate: string; reason: string; attachments: readonly File[] }) => void;
  onDesignateRequest: (input: { reason: string; proposedOrgId: string | null }) => void;
  onDesignateReject: (reason: string) => void;
  /** 监督且无经办、内勤角色：分派写操作全部禁用并说明原因。 */
  supervisorReadonly?: boolean;
}): ReactNode {
  const ro = supervisorReadonly;
  const assigned = view.status === 'org_assigned' || view.status === 'handler_assigned';
  // 与服务端一致：报请取 ORG_ASSIGN_FROM_STATUSES，移送取 mayTransfer。
  // 两者都是待分派池、已派机构、已派承办人。监督只读按此展示，写控件禁用。
  // 报请另须没有进行中的报请（服务端 mayRequestDesignation 要求 designation === null）。
  const requestOrTransfer = view.status === 'in_pool' || assigned;
  const showTransfer = view.mayTransfer || (ro && requestOrTransfer);
  const showPeople = view.mayAssignPeople || (ro && assigned);
  const showReassign = view.mayReassignOrg || (ro && assigned);
  const showDesignateRequest =
    view.mayRequestDesignation || (ro && requestOrTransfer && view.designation === null);
  return (
    <>
      <div className="card">
        <div className="card-h">
          {`线索 ${view.code}`}
          <span className="hint">{`${view.sourceName} · ${dispatchStatusLabel(view.status)}`}</span>
        </div>
        {ro ? (
          <div className="banner amber" data-role="assign-readonly">
            监督身份只读，不可分派。可查阅分派进度，不能执行派机构、派主办、报请指定管辖或移送。
          </div>
        ) : null}
        {view.designation !== null ? (
          <>
            {view.designationLocked ? (
              <div className="banner amber" data-role="designation-lock">
                该线索正在报请指定管辖：报请期间不能分派、重新分派或移送，待上级受理后恢复办理。
              </div>
            ) : null}
            <DesignateReviewPanel view={view} busy={busy} failure={failure} onReject={onDesignateReject} readOnly={ro} />
          </>
        ) : null}
        {view.status === 'pending_decision' && (view.mayDecide || ro) ? (
          <DecidePanel view={view} busy={busy} failure={failure} onDecide={onDecide} readOnly={ro} />
        ) : null}
        {view.status === 'pending_decision' && !view.mayDecide && !ro ? (
          <div className="banner gray">分派决定由录入人完成；当前账号不是该线索的录入人。</div>
        ) : null}
        {view.status === 'in_pool' && (view.mayAssignOrg || ro) ? (
          <AssignOrgPanel view={view} orgOptions={orgOptions} reassigning={false} busy={busy} failure={failure} onAssign={onAssignOrg} readOnly={ro} />
        ) : null}
        {view.status === 'in_pool' && !view.mayAssignOrg && !ro ? (
          <div className="banner gray">待分派池的线索由本机构内勤派出。</div>
        ) : null}
        {showTransfer ? (
          <TransferPanel busy={busy} failure={failure} onTransfer={onTransfer} readOnly={ro} />
        ) : null}
        {assigned && view.assignment ? (
          <div data-role="assigned">
            <div className="banner ok">
              {`承办机构：${view.assignment.orgName}${view.assignment.designate ? '（指定管辖）' : ''}`}
            </div>
            {view.handlers.length > 0 ? (
              <div className="help" data-role="handlers">
                {`承办人：${view.handlers.map((handler) => `${handler.name}（${handler.role === 'main' ? '主办' : '协办'}）`).join('、')}`}
              </div>
            ) : null}
            {showPeople ? (
              <AssignPeoplePanel view={view} busy={busy} failure={failure} onAssign={onAssignPeople} readOnly={ro} />
            ) : null}
            {showReassign ? (
              <AssignOrgPanel view={view} orgOptions={orgOptions} reassigning busy={busy} failure={failure} onAssign={onAssignOrg} readOnly={ro} />
            ) : null}
          </div>
        ) : null}
        {view.status === 'held' ? (
          <div className="banner gray">该线索已选不派；需要时可由有权人撤回不派。</div>
        ) : null}
        {view.mayReviewDesignation && !view.mayAssignOrg && !view.mayReassignOrg && !ro ? (
          <AssignOrgPanel
            view={view}
            orgOptions={orgOptions}
            reassigning={view.status !== 'in_pool'}
            busy={busy}
            failure={failure}
            onAssign={onAssignOrg}
            designateByDefault
          />
        ) : null}
        {showDesignateRequest ? (
          <DesignateRequestPanel
            busy={busy}
            failure={failure}
            orgOptions={orgOptions}
            onRequest={onDesignateRequest}
            readOnly={ro}
          />
        ) : null}
      </div>
    </>
  );
}
