// 案件详情的回避页签（#237）：登记声明、作出回避决定、查看记录。
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router';

import { useAppDispatch, useAppSelector } from '../hooks';
import {
  CONFLICT_SOURCES,
  DECISION_CONCLUSIONS,
  decideConflict,
  declareConflict,
  loadConflicts,
  type ConflictDecisionView,
  type ConflictRecordView,
} from './conflict';

export function CaseConflictTab({
  records,
  decisions,
  canDeclare,
  canDecide,
  message,
  onDeclare,
  onDecide,
}: {
  readonly records: readonly ConflictRecordView[];
  readonly decisions: readonly ConflictDecisionView[];
  readonly canDeclare: boolean;
  readonly canDecide: boolean;
  readonly message: string | null;
  readonly onDeclare: (input: { personId: string; source: string; reason: string }) => void;
  readonly onDecide: (input: { lineageId: string; conclusion: string; reason: string }) => void;
}) {
  const [personId, setPersonId] = useState('');
  const [source, setSource] = useState('self');
  const [reason, setReason] = useState('');
  const [lineageId, setLineageId] = useState('');
  const [conclusion, setConclusion] = useState('recuse');
  const [decisionReason, setDecisionReason] = useState('');

  return (
    <>
      <div className="crumb"><b>案件详情</b></div>
      <div className="checks" role="tablist" aria-label="案件详情页签">
        <button type="button" className="btn" data-role="conflict-tab" aria-current="page">回避</button>
      </div>
      {message ? <div className="help" data-role="failure">{message}</div> : null}
      <div className="card">
        <div className="card-h">利害关系记录</div>
        {records.length === 0 ? <div className="help">尚无记录</div> : (
          <ul data-role="conflict-records">
            {records.map((row) => (
              <li key={row.id} data-lineage={row.lineageId}>
                {row.sourceName} · {row.statusName} · {row.reason}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="card">
        <div className="card-h">回避决定</div>
        {decisions.length === 0 ? <div className="help">尚无决定</div> : (
          <ul data-role="conflict-decisions">
            {decisions.map((row) => (
              <li key={row.id}>
                {row.conclusionName} · {row.reason}
              </li>
            ))}
          </ul>
        )}
      </div>
      {canDeclare ? (
        <form
          className="card"
          data-role="declare-form"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            onDeclare({ personId, source, reason });
          }}
        >
          <div className="card-h">登记声明</div>
          <div className="form-row">
            <label htmlFor="conflict-person">人员</label>
            <input id="conflict-person" value={personId} onChange={(event) => setPersonId(event.target.value)} />
          </div>
          <div className="form-row">
            <label htmlFor="conflict-source">来源</label>
            <select id="conflict-source" value={source} onChange={(event) => setSource(event.target.value)}>
              {CONFLICT_SOURCES.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label htmlFor="conflict-reason">理由</label>
            <input id="conflict-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
          </div>
          <button type="submit" className="btn" data-role="declare-submit">登记声明</button>
        </form>
      ) : null}
      {canDecide ? (
        <form
          className="card"
          data-role="decide-form"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            onDecide({ lineageId, conclusion, reason: decisionReason });
          }}
        >
          <div className="card-h">作出回避决定</div>
          <div className="form-row">
            <label htmlFor="decision-lineage">声明</label>
            <input id="decision-lineage" value={lineageId} onChange={(event) => setLineageId(event.target.value)} />
          </div>
          <div className="form-row">
            <label htmlFor="decision-conclusion">结论</label>
            <select id="decision-conclusion" value={conclusion} onChange={(event) => setConclusion(event.target.value)}>
              {DECISION_CONCLUSIONS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label htmlFor="decision-reason">理由</label>
            <input id="decision-reason" value={decisionReason} onChange={(event) => setDecisionReason(event.target.value)} />
          </div>
          <button type="submit" className="btn" data-role="decide-submit">作出回避决定</button>
        </form>
      ) : null}
    </>
  );
}

export default function CaseConflictPage() {
  const { caseId = '' } = useParams();
  const dispatch = useAppDispatch();
  const opcodes = useAppSelector((root) => root.login.operator?.opcodes ?? []);
  const [records, setRecords] = useState<readonly ConflictRecordView[]>([]);
  const [decisions, setDecisions] = useState<readonly ConflictDecisionView[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const view = await loadConflicts(dispatch, caseId);
    setRecords(view.records);
    setDecisions(view.decisions);
  }, [caseId, dispatch]);

  useEffect(() => {
    if (caseId === '') return;
    void reload().catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : '取数失败');
    });
  }, [caseId, reload]);

  return (
    <CaseConflictTab
      records={records}
      decisions={decisions}
      canDeclare={opcodes.includes('doc.draft')}
      canDecide={opcodes.includes('doc.approve')}
      message={message}
      onDeclare={(input) => {
        void declareConflict(dispatch, caseId, input)
          .then(() => reload())
          .then(() => setMessage(null))
          .catch((error: unknown) => {
            setMessage(error instanceof Error ? error.message : '登记失败');
          });
      }}
      onDecide={(input) => {
        void decideConflict(dispatch, caseId, input.lineageId, {
          conclusion: input.conclusion,
          reason: input.reason,
        })
          .then(() => reload())
          .then(() => setMessage(null))
          .catch((error: unknown) => {
            setMessage(error instanceof Error ? error.message : '决定失败');
          });
      }}
    />
  );
}
