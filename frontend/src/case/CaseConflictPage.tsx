// 案件详情的回避页签（#237）：登记声明、作出回避决定、查看记录。
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router';

import { useAppDispatch, useAppSelector } from '../hooks';
import { loadAgencyConflict, markAgencyConflict } from './agency-conflict';
import {
  CONFLICT_SOURCES,
  DECISION_CONCLUSIONS,
  SIGN_KINDS,
  checkSign,
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
  agencyMarked,
  agencyWarning,
  agencyOutlet,
  canMarkAgency,
  message,
  signResult,
  onDeclare,
  onDecide,
  onSignCheck,
  onMarkAgency,
}: {
  readonly records: readonly ConflictRecordView[];
  readonly decisions: readonly ConflictDecisionView[];
  readonly canDeclare: boolean;
  readonly canDecide: boolean;
  readonly agencyMarked: boolean;
  readonly agencyWarning: string | null;
  readonly agencyOutlet: string | null;
  readonly canMarkAgency: boolean;
  readonly message: string | null;
  readonly signResult: string | null;
  readonly onDeclare: (input: { personId: string; source: string; reason: string }) => void;
  readonly onDecide: (input: { lineageId: string; conclusion: string; reason: string }) => void;
  readonly onSignCheck: (input: { personId: string; signKind: string }) => void;
  readonly onMarkAgency: () => void;
}) {
  const [personId, setPersonId] = useState('');
  const [source, setSource] = useState('self');
  const [reason, setReason] = useState('');
  const [lineageId, setLineageId] = useState('');
  const [conclusion, setConclusion] = useState('recuse');
  const [decisionReason, setDecisionReason] = useState('');
  const [signPersonId, setSignPersonId] = useState('');
  const [signKind, setSignKind] = useState('trial-opinion');
  const [agencyDraft, setAgencyDraft] = useState(false);

  return (
    <>
      <div className="crumb"><b>案件详情</b></div>
      <div className="checks" role="tablist" aria-label="案件详情页签">
        <button type="button" className="btn" data-role="conflict-tab" aria-current="page">回避</button>
      </div>
      <div className="card" data-role="agency-conflict">
        <div className="card-h">机关层利害关系</div>
        {agencyMarked && agencyWarning ? (
          <div className="help" role="status" data-role="agency-conflict-warning">
            {agencyWarning}。{agencyOutlet}
          </div>
        ) : (
          <div className="help">尚未登记</div>
        )}
        {agencyMarked ? (
          <label>
            <input type="checkbox" checked disabled data-role="agency-conflict-checkbox" readOnly />
            本机关与本案当事人存在利害关系
          </label>
        ) : canMarkAgency ? (
          <form
            data-role="agency-conflict-form"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              if (!agencyDraft) return;
              onMarkAgency();
            }}
          >
            <label>
              <input
                type="checkbox"
                checked={agencyDraft}
                data-role="agency-conflict-checkbox"
                onChange={(event) => setAgencyDraft(event.target.checked)}
              />
              本机关与本案当事人存在利害关系
            </label>
            <button type="submit" className="btn" data-role="agency-conflict-submit" disabled={!agencyDraft}>
              登记机关层利害关系
            </button>
          </form>
        ) : null}
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
      <form
        className="card"
        data-role="sign-check-form"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          onSignCheck({ personId: signPersonId, signKind });
        }}
      >
        <div className="card-h">检查签出</div>
        <div className="form-row">
          <label htmlFor="sign-person">人员</label>
          <input id="sign-person" value={signPersonId} onChange={(event) => setSignPersonId(event.target.value)} />
        </div>
        <div className="form-row">
          <label htmlFor="sign-kind">签出类型</label>
          <select id="sign-kind" value={signKind} onChange={(event) => setSignKind(event.target.value)}>
            {SIGN_KINDS.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn" data-role="sign-check-submit">检查签出</button>
        {signResult ? <div className="help" data-role="sign-result">{signResult}</div> : null}
      </form>
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
  const [agencyMarked, setAgencyMarked] = useState(false);
  const [agencyWarning, setAgencyWarning] = useState<string | null>(null);
  const [agencyOutlet, setAgencyOutlet] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [signResult, setSignResult] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const view = await loadConflicts(dispatch, caseId);
    const agency = await loadAgencyConflict(dispatch, caseId);
    setRecords(view.records);
    setDecisions(view.decisions);
    setAgencyMarked(agency.marked);
    setAgencyWarning(agency.warning);
    setAgencyOutlet(agency.outlet);
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
      agencyMarked={agencyMarked}
      agencyWarning={agencyWarning}
      agencyOutlet={agencyOutlet}
      canMarkAgency={opcodes.includes('doc.draft')}
      message={message}
      signResult={signResult}
      onSignCheck={(input) => {
        void checkSign(dispatch, caseId, input)
          .then((result) => {
            setSignResult(result.text);
            setMessage(null);
          })
          .catch((error: unknown) => {
            setSignResult(null);
            setMessage(error instanceof Error ? error.message : '检查失败');
          });
      }}
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
      onMarkAgency={() => {
        void markAgencyConflict(dispatch, caseId)
          .then(() => reload())
          .then(() => setMessage(null))
          .catch((error: unknown) => {
            setMessage(error instanceof Error ? error.message : '登记失败');
          });
      }}
    />
  );
}
