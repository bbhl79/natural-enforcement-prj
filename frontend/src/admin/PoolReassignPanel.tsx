// 停用机构池重新指定面板（#216；管理台机构详情内，截图键 admin-org-pool-reassign）。
//
// 只在已停用机构的详情里出现，且会话须有 clue.pool.reassign。
// 纯渲染部分（PoolReassignView）供单测直接渲染；取数与提交在 PoolReassignPanel。

import { useCallback, useEffect, useState } from 'react';

import { useAppDispatch } from '../hooks';
import {
  loadPoolClues,
  poolStatusLabel,
  reassignPoolClue,
  type PoolClue,
} from './poolReassign';

/** 可选的接收机构（未停用）。 */
export interface TargetOption {
  readonly id: string;
  readonly name: string;
}

/** 纯渲染：清单、目标机构、理由与每行的重新指定按钮。 */
export function PoolReassignView({
  orgName,
  clues,
  targets,
  busy,
  failure,
  notice,
  onReassign,
}: {
  orgName: string;
  clues: readonly PoolClue[];
  targets: readonly TargetOption[];
  busy: boolean;
  failure: string | null;
  notice: string | null;
  onReassign: (clue: PoolClue, input: { orgUnitId: string; reason: string }) => void;
}) {
  const [orgUnitId, setOrgUnitId] = useState('');
  const [reason, setReason] = useState('');
  const ready = orgUnitId !== '' && reason.trim() !== '';
  return (
    <div className="card" data-role="pool-reassign">
      <div className="card-h">
        {`待分派池线索重新指定`}
        <span className="hint">{`${orgName}已停用，其池里未派出的线索须由系统管理员重新指定接收机构`}</span>
      </div>
      {failure ? <div className="banner danger" data-role="failure">{failure}</div> : null}
      {notice ? <div className="banner ok" data-role="notice">{notice}</div> : null}
      <div className="form-row">
        <label htmlFor="pool-reassign-org">接收机构</label>
        <div>
          <select
            id="pool-reassign-org"
            className="select"
            value={orgUnitId}
            onChange={(event) => setOrgUnitId(event.target.value)}
          >
            <option value="">请选择未停用的机构</option>
            {targets.map((target) => (
              <option key={target.id} value={target.id}>{target.name}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="form-row">
        <label htmlFor="pool-reassign-reason">理由</label>
        <div>
          <input
            id="pool-reassign-reason"
            className="input"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <div className="help">理由必填并留痕。重新指定不构成指定管辖，接收机构可正常分派。</div>
        </div>
      </div>
      {clues.length === 0 ? (
        <div className="help" data-role="pool-empty">该机构的待分派池里没有未派出的线索。</div>
      ) : (
        <table className="table" data-role="pool-clues">
          <thead>
            <tr>
              <th>线索编号</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {clues.map((clue) => (
              <tr key={clue.clueId} data-clue={clue.code}>
                <td>{clue.code}</td>
                <td>{poolStatusLabel(clue.status)}</td>
                <td>
                  <button
                    type="button"
                    className="btn btn-sm"
                    data-role="pool-reassign-submit"
                    disabled={busy || !ready}
                    onClick={() => onReassign(clue, { orgUnitId, reason: reason.trim() })}
                  >
                    重新指定
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** 容器：取池线索清单，提交后重取。 */
export default function PoolReassignPanel({
  orgUnitId,
  orgName,
  targets,
}: {
  orgUnitId: string;
  orgName: string;
  targets: readonly TargetOption[];
}) {
  const dispatch = useAppDispatch();
  const [clues, setClues] = useState<readonly PoolClue[] | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const list = await loadPoolClues(dispatch, orgUnitId);
    setError(list === null);
    if (list !== null) setClues(list);
  }, [dispatch, orgUnitId]);

  useEffect(() => {
    setClues(null);
    setFailure(null);
    setNotice(null);
    void reload();
  }, [reload]);

  if (error) {
    return (
      <div className="banner amber" data-role="pool-error">
        池线索清单读取失败。
        <button type="button" className="btn btn-sm" onClick={() => void reload()}>重试</button>
      </div>
    );
  }
  if (clues === null) return <div className="card" aria-busy="true">载入中…</div>;
  return (
    <PoolReassignView
      orgName={orgName}
      clues={clues}
      targets={targets}
      busy={busy}
      failure={failure}
      notice={notice}
      onReassign={(clue, input) => {
        setBusy(true);
        setFailure(null);
        setNotice(null);
        void reassignPoolClue(dispatch, clue, input).then(async (result) => {
          setBusy(false);
          if (result.ok) {
            setNotice(`${clue.code} 已重新指定。`);
            await reload();
          } else {
            setFailure(result.message);
          }
        });
      }}
    />
  );
}
