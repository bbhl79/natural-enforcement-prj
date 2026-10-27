// 立案呈批最小入口（#234）：拟制／提交／撤回；审批待办在详情同区完成审核／批准／退回。
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { useAppDispatch } from '../hooks';
import {
  approveFilingApproval,
  loadFilingApproval,
  FILING_RETURN_REASONS,
  returnFilingApproval,
  reviewFilingApproval,
  saveFilingDraft,
  submitFilingApproval,
  withdrawFilingApproval,
  type FilingApprovalView,
} from './filing';

export default function ClueFilingPanel({
  clueId,
  clueStatus,
}: {
  readonly clueId: string;
  readonly clueStatus: string;
}) {
  const dispatch = useAppDispatch();
  const [approval, setApproval] = useState<FilingApprovalView | null>(null);
  const [conclusion, setConclusion] = useState<'file' | 'no-case'>('file');
  const [partyNames, setPartyNames] = useState('');
  const [noCaseGround, setNoCaseGround] = useState('art16-2-no-violation-fact');
  const [opinion, setOpinion] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [inheritedCode, setInheritedCode] = useState('');
  const [receiverId, setReceiverId] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const result = await loadFilingApproval(dispatch, clueId);
    setApproval(result.approval);
  }, [clueId, dispatch]);

  useEffect(() => {
    if (clueStatus !== 'handler_assigned' && clueStatus !== 'filed' && clueStatus !== 'closed') return;
    void reload().catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : '立案呈批取数失败');
    });
  }, [clueStatus, reload]);

  if (clueStatus !== 'handler_assigned' && !(approval && (clueStatus === 'filed' || clueStatus === 'closed'))) {
    return null;
  }

  async function onSave(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const content =
        conclusion === 'file'
          ? {
              conclusion: 'file',
              partyNames: partyNames
                .split(/[,，]/)
                .map((name) => name.trim())
                .filter((name) => name !== ''),
            }
          : {
              conclusion: 'no-case',
              noCaseReason: { kind: 'non-filing-grounds', grounds: [noCaseGround] },
            };
      const result = await saveFilingDraft(dispatch, clueId, content);
      if (!result.ok) {
        setMessage(`保存失败（${result.status}）`);
        return;
      }
      setMessage('草稿已保存');
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function run(
    label: string,
    action: () => Promise<{ ok: boolean; status: number }>,
  ): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const result = await action();
      setMessage(result.ok ? `${label}成功` : `${label}失败（${result.status}）`);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" data-role="filing-approval-panel">
      <h3>立案呈批</h3>
      {approval ? (
        <p data-role="filing-status">
          状态：{approval.status}／结论：{approval.conclusion ?? '—'}／版本：{approval.currentVersionNo}
        </p>
      ) : (
        <p>尚未拟制。可先存草稿（当事人可后补），提交前须有明确当事人。</p>
      )}
      {clueStatus === 'handler_assigned' && (!approval || approval.status === 'drafting') ? (
        <form onSubmit={onSave}>
          <div className="form-row">
            <label htmlFor="filing-conclusion">结论</label>
            <select
              id="filing-conclusion"
              value={conclusion}
              onChange={(event) => setConclusion(event.target.value as 'file' | 'no-case')}
            >
              <option value="file">立案</option>
              <option value="no-case">不予立案</option>
            </select>
          </div>
          {conclusion === 'file' ? (
            <div className="form-row">
              <label htmlFor="filing-parties">当事人（逗号分隔；草稿可空）</label>
              <input
                id="filing-parties"
                value={partyNames}
                onChange={(event) => setPartyNames(event.target.value)}
              />
            </div>
          ) : (
            <div className="form-row">
              <label htmlFor="filing-ground">不予立案理由</label>
              <select
                id="filing-ground"
                value={noCaseGround}
                onChange={(event) => setNoCaseGround(event.target.value)}
              >
                <option value="art16-2-no-violation-fact">第十六条（二）没有违法事实</option>
              </select>
            </div>
          )}
          <button type="submit" disabled={busy} data-role="filing-save">
            保存草稿
          </button>
        </form>
      ) : null}
      <div className="form-row">
        <label htmlFor="filing-opinion">意见／理由</label>
        <input id="filing-opinion" value={opinion} onChange={(event) => setOpinion(event.target.value)} />
      </div>
      <div className="button-row">
        {approval?.status === 'drafting' ? (
          <button
            type="button"
            disabled={busy}
            data-role="filing-submit"
            onClick={() => void run('提交', () => submitFilingApproval(dispatch, approval.id))}
          >
            提交
          </button>
        ) : null}
        {approval?.status === 'pending_review' ? (
          <button
            type="button"
            disabled={busy}
            data-role="filing-review"
            onClick={() => void run('审核', () => reviewFilingApproval(dispatch, approval.id, opinion))}
          >
            审核通过
          </button>
        ) : null}
        {approval?.status === 'pending_approval' ? (
          <button
            type="button"
            disabled={busy}
            data-role="filing-approve"
            onClick={() => void run('批准', () => approveFilingApproval(dispatch, approval.id, opinion))}
          >
            批准
          </button>
        ) : null}
        {approval && (approval.status === 'pending_review' || approval.status === 'pending_approval') ? (
          <>
            <div className="form-row">
              <label htmlFor="filing-return-reason">退回原因</label>
              <select
                id="filing-return-reason"
                value={reasonCode}
                onChange={(event) => setReasonCode(event.target.value)}
              >
                <option value="">选择退回原因</option>
                {FILING_RETURN_REASONS.map(([code, name]) => (
                  <option key={code} value={code}>
                    {code} {name}
                  </option>
                ))}
              </select>
            </div>
            {reasonCode === 'R10' ? (
              <div className="form-row">
                <label htmlFor="filing-return-inherit">R10 退回点</label>
                <select
                  id="filing-return-inherit"
                  value={inheritedCode}
                  onChange={(event) => setInheritedCode(event.target.value)}
                >
                  <option value="">选择退回点</option>
                  {FILING_RETURN_REASONS.filter(([code]) => code !== 'R10').map(([code, name]) => (
                    <option key={code} value={code}>
                      {code} {name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="form-row">
              <label htmlFor="filing-return-receiver">退回接收人</label>
              <select
                id="filing-return-receiver"
                value={receiverId}
                onChange={(event) => setReceiverId(event.target.value)}
              >
                <option value="">选择接收人</option>
                <option value={approval.drafterId}>拟制人</option>
              </select>
            </div>
            <button
              type="button"
              disabled={busy}
              data-role="filing-return"
              onClick={() =>
                void run('退回', () =>
                  returnFilingApproval(dispatch, approval.id, {
                    reasonCode,
                    note: opinion,
                    receiverId,
                    inheritedCode,
                  }),
                )
              }
            >
              退回
            </button>
            <button
              type="button"
              disabled={busy}
              data-role="filing-withdraw"
              onClick={() => void run('撤回', () => withdrawFilingApproval(dispatch, approval.id, opinion))}
            >
              撤回
            </button>
          </>
        ) : null}
      </div>
      {message ? <p data-role="filing-message">{message}</p> : null}
    </div>
  );
}
