// 系统外移送附加记录（#229）：处置为 other 的线索详情展示列表，并可补挂。
import { useCallback, useEffect, useState } from 'react';

import { useAppDispatch } from '../hooks';
import {
  loadExternalTransfers,
  submitExternalTransfer,
  type ExternalTransferItem,
} from './dispatch';
import { dispatchFailureText } from './ClueDispatchSection';

export function ClueExternalTransferSection({
  clueId,
  mayAttach,
  supervisorReadonly = false,
}: {
  readonly clueId: string;
  /** 当前操作者能否补挂（主办／协办／承办机构内勤）。 */
  readonly mayAttach: boolean;
  readonly supervisorReadonly?: boolean;
}) {
  const dispatch = useAppDispatch();
  const [rows, setRows] = useState<readonly ExternalTransferItem[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [transferOrg, setTransferOrg] = useState('');
  const [documentNo, setDocumentNo] = useState('');
  const [letterDate, setLetterDate] = useState('');
  const [reason, setReason] = useState('');
  const [attachments, setAttachments] = useState<readonly File[]>([]);
  const today = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const reload = useCallback(async () => {
    setRows(await loadExternalTransfers(dispatch, clueId));
  }, [dispatch, clueId]);

  useEffect(() => {
    void reload().catch(() => setRows([]));
  }, [reload]);

  const readOnly = supervisorReadonly || !mayAttach;

  return (
    <div className="card" data-role="external-transfer-section">
      <div className="card-h">
        系统外移送附加记录
        <span className="hint">不分管辖／涉刑／党纪政务；不改线索状态</span>
      </div>
      {rows === null ? <div className="help">载入中…</div> : null}
      {rows !== null && rows.length === 0 ? <div className="help">尚无系统外移送记录。</div> : null}
      {rows !== null && rows.length > 0 ? (
        <ul className="list" data-role="external-transfer-list">
          {rows.map((row) => (
            <li key={row.id}>
              <div>
                <strong>{row.transferredOrg}</strong>
                <span className="hint">{` · ${row.documentNo} · ${row.letterDate}`}</span>
              </div>
              <div className="help">{row.reason}</div>
              {row.attachments.length > 0 ? (
                <div className="help">
                  附件：{row.attachments.map((file) => file.fileName).join('、')}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {!readOnly ? (
        <div className="actions">
          <button type="button" className="btn btn-sm" data-role="external-transfer-open" onClick={() => setOpen((value) => !value)}>
            {open ? '收起登记' : '登记系统外移送'}
          </button>
        </div>
      ) : null}
      {open && !readOnly ? (
        <div className="card" data-role="external-transfer-form">
          {failure ? <div className="banner danger">{failure}</div> : null}
          <div className="form-row">
            <label htmlFor="ext-org">移送机关</label>
            <div>
              <input id="ext-org" className="input" value={transferOrg} onChange={(e) => setTransferOrg(e.target.value)} />
            </div>
          </div>
          <div className="form-row">
            <label htmlFor="ext-doc">文书编号</label>
            <div>
              <input id="ext-doc" className="input" value={documentNo} onChange={(e) => setDocumentNo(e.target.value)} />
            </div>
          </div>
          <div className="form-row">
            <label htmlFor="ext-date">发函日期</label>
            <div>
              <input id="ext-date" className="input" type="date" value={letterDate} onChange={(e) => setLetterDate(e.target.value)} />
              <div className="help">{`留空默认北京当日（${today}）`}</div>
            </div>
          </div>
          <div className="form-row">
            <label htmlFor="ext-reason">原因</label>
            <div>
              <input id="ext-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          </div>
          <div className="form-row">
            <label htmlFor="ext-files">附件</label>
            <div>
              <input id="ext-files" type="file" multiple onChange={(e) => setAttachments(Array.from(e.target.files ?? []))} />
            </div>
          </div>
          <div className="actions">
            <button
              type="button"
              className="btn"
              data-role="external-transfer-submit"
              disabled={busy || transferOrg.trim() === '' || documentNo.trim() === '' || reason.trim() === ''}
              onClick={() => {
                void (async () => {
                  setBusy(true);
                  setFailure(null);
                  const result = await submitExternalTransfer(dispatch, clueId, {
                    transferOrg: transferOrg.trim(),
                    documentNo: documentNo.trim(),
                    letterDate,
                    reason: reason.trim(),
                    attachments,
                  });
                  setBusy(false);
                  if (!result.ok) {
                    setFailure(dispatchFailureText(result.body));
                    return;
                  }
                  setOpen(false);
                  setTransferOrg('');
                  setDocumentNo('');
                  setLetterDate('');
                  setReason('');
                  setAttachments([]);
                  await reload();
                })();
              }}
            >
              提交登记
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
