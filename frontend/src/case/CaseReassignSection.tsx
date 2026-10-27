// 案件详情「人员」页签（#239）：发起改派、批准、曾任承办人员、材料效力认定清单。
import { useState, type FormEvent } from 'react';

import {
  EFFECTIVENESS_CONCLUSIONS,
  REASSIGN_REASONS,
  type HandlerView,
  type ReassignListView,
} from './reassign';

export interface CaseReassignSectionProps {
  readonly view: ReassignListView;
  readonly canSubmit: boolean;
  readonly canApprove: boolean;
  readonly canDetermine: boolean;
  readonly message: string | null;
  readonly onSubmit: (input: {
    readonly mainId: string;
    readonly assistIds: readonly string[];
    readonly reasonCode: string;
    readonly note: string;
    readonly conflictLineageId: string | null;
  }) => void;
  readonly onApprove: (reassignmentId: string) => void;
  readonly onDetermine: (input: {
    readonly materialId: string;
    readonly conclusion: string;
    readonly reason: string;
  }) => void;
}

function handlerText(row: HandlerView): string {
  return `${row.roleName} ${row.personnelId}`;
}

function assistText(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

export function CaseReassignSection(props: CaseReassignSectionProps) {
  const [reasonCode, setReasonCode] = useState('transfer');
  const [note, setNote] = useState('');
  const [conflictLineageId, setConflictLineageId] = useState('');
  const [mainId, setMainId] = useState('');
  const [assistIds, setAssistIds] = useState('');
  const [materialId, setMaterialId] = useState('');
  const [conclusion, setConclusion] = useState('valid');
  const [determineReason, setDetermineReason] = useState('');

  return (
    <>
      {props.message ? <div className="help" data-role="reassign-failure">{props.message}</div> : null}
      <div className="card">
        <div className="card-h">承办人员</div>
        {props.view.handlers.length === 0 ? <div className="help">尚未指定</div> : (
          <ul data-role="current-handlers">
            {props.view.handlers.map((row) => (
              <li key={row.id}>{handlerText(row)}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="card">
        <div className="card-h">曾任承办人员</div>
        {props.view.formerHandlers.length === 0 ? <div className="help">尚无换下的人</div> : (
          <ul data-role="former-handlers">
            {props.view.formerHandlers.map((row) => (
              <li key={row.id}>{handlerText(row)}</li>
            ))}
          </ul>
        )}
      </div>
      {props.canSubmit ? (
        <form
          className="card"
          data-role="reassign-form"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            props.onSubmit({
              mainId,
              assistIds: assistText(assistIds),
              reasonCode,
              note,
              conflictLineageId: conflictLineageId.trim() === '' ? null : conflictLineageId.trim(),
            });
          }}
        >
          <div className="card-h">发起改派</div>
          <div className="form-row">
            <label htmlFor="reassign-main">新主办</label>
            <input id="reassign-main" value={mainId} onChange={(event) => setMainId(event.target.value)} />
          </div>
          <div className="form-row">
            <label htmlFor="reassign-assists">新协办（逗号分隔）</label>
            <input id="reassign-assists" value={assistIds} onChange={(event) => setAssistIds(event.target.value)} />
          </div>
          <div className="form-row">
            <label htmlFor="reassign-reason">原因</label>
            <select
              id="reassign-reason"
              value={reasonCode}
              onChange={(event) => setReasonCode(event.target.value)}
            >
              {REASSIGN_REASONS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </div>
          {reasonCode === 'recusal' ? (
            <div className="form-row">
              <label htmlFor="reassign-conflict">回避决定</label>
              <input
                id="reassign-conflict"
                value={conflictLineageId}
                onChange={(event) => setConflictLineageId(event.target.value)}
              />
            </div>
          ) : null}
          <div className="form-row">
            <label htmlFor="reassign-note">说明</label>
            <input id="reassign-note" value={note} onChange={(event) => setNote(event.target.value)} />
          </div>
          <button type="submit" className="btn" data-role="reassign-submit">发起改派</button>
        </form>
      ) : null}
      <div className="card">
        <div className="card-h">改派呈批</div>
        {props.view.reassignments.length === 0 ? <div className="help">尚无记录</div> : (
          <ul data-role="reassignments">
            {props.view.reassignments.map((row) => (
              <li key={row.id} data-status={row.status}>
                {row.reasonName} · {row.statusName}
                {row.status === 'pending_approval' && props.canApprove ? (
                  <button
                    type="button"
                    className="btn"
                    data-role="reassign-approve"
                    onClick={() => props.onApprove(row.id)}
                  >
                    批准
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="card">
        <div className="card-h">材料效力认定</div>
        {props.view.materials.length === 0 ? <div className="help">尚无材料</div> : (
          <ul data-role="material-effectivities">
            {props.view.materials.map((row) => (
              <li key={row.materialId} data-invalid={props.view.invalidMaterialIds.includes(row.materialId)}>
                {row.materialId} · {row.effectiveness ? `${row.effectiveness.conclusionName}（${row.effectiveness.reason}）` : '未认定'}
              </li>
            ))}
          </ul>
        )}
      </div>
      {props.canDetermine ? (
        <form
          className="card"
          data-role="effectivity-form"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            props.onDetermine({ materialId, conclusion, reason: determineReason });
          }}
        >
          <div className="card-h">逐件认定</div>
          <div className="form-row">
            <label htmlFor="effectivity-material">材料</label>
            <input id="effectivity-material" value={materialId} onChange={(event) => setMaterialId(event.target.value)} />
          </div>
          <div className="form-row">
            <label htmlFor="effectivity-conclusion">结论</label>
            <select
              id="effectivity-conclusion"
              value={conclusion}
              onChange={(event) => setConclusion(event.target.value)}
            >
              {EFFECTIVENESS_CONCLUSIONS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label htmlFor="effectivity-reason">理由</label>
            <input
              id="effectivity-reason"
              value={determineReason}
              onChange={(event) => setDetermineReason(event.target.value)}
            />
          </div>
          <button type="submit" className="btn" data-role="effectivity-submit">记录认定</button>
        </form>
      ) : null}
    </>
  );
}