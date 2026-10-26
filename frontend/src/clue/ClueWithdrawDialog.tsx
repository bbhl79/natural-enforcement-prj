// 撤回不派弹窗（#217；规格 D 节、GLOSSARY「撤回不派」）。
//
// 四项常用原因逐字取自服务端（/api/clues/closure-options），可多选且至少一项，
// 每个原因单独一行；补充说明必填。系统不自动派、不自动关：撤回成功即回待分派池。
// 纯渲染组件（单测直接渲染），取数与提交在容器组件里。

import { useState } from 'react';

/** 撤回不派弹窗。 */
export function ClueWithdrawDialog({
  clueCode,
  reasons,
  busy,
  failure,
  onSubmit,
  onCancel,
}: {
  readonly clueCode: string;
  readonly reasons: readonly string[];
  readonly busy: boolean;
  readonly failure: string | null;
  readonly onSubmit: (reasonCodes: readonly string[], note: string) => void;
  readonly onCancel: () => void;
}) {
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [note, setNote] = useState('');

  const toggle = (reason: string, checked: boolean) => {
    setSelected((current) =>
      checked ? [...current, reason] : current.filter((item) => item !== reason),
    );
  };

  return (
    <div className="banner gray" data-role="withdraw-dialog">
      <div>{`撤回不派：线索 ${clueCode}`}</div>
      <div className="help">勾选撤回原因（至少一项），并写明补充说明。撤回后线索回待分派池。</div>
      {failure ? <div className="banner danger" data-role="failure">{failure}</div> : null}
      <div className="checks-col" data-role="withdraw-reasons">
        {reasons.map((reason) => (
          <label key={reason}>
            <input
              type="checkbox"
              data-reason={reason}
              checked={selected.includes(reason)}
              onChange={(event) => toggle(reason, event.target.checked)}
            />
            {` ${reason}`}
          </label>
        ))}
      </div>
      <div className="form-row">
        <label htmlFor="withdraw-note">补充说明</label>
        <div>
          <textarea
            id="withdraw-note"
            className="input"
            data-role="withdraw-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <div className="help">补充说明必填。</div>
        </div>
      </div>
      <div className="actions">
        <button
          type="button"
          className="btn btn-primary"
          data-role="withdraw-submit"
          disabled={busy}
          onClick={() => onSubmit(selected, note.trim())}
        >
          撤回不派
        </button>
        <button type="button" className="btn" data-role="withdraw-cancel" onClick={onCancel}>
          取消
        </button>
      </div>
    </div>
  );
}

/** 写明原因随旧线索办结：说明必填。 */
export function ClueCloseWithOldDialog({
  clueCode,
  otherClueCode,
  busy,
  failure,
  onSubmit,
  onCancel,
}: {
  readonly clueCode: string;
  readonly otherClueCode: string | null;
  readonly busy: boolean;
  readonly failure: string | null;
  readonly onSubmit: (note: string) => void;
  readonly onCancel: () => void;
}) {
  const [note, setNote] = useState('');
  return (
    <div className="banner gray" data-role="close-with-old-dialog">
      <div>{`随旧线索办结：线索 ${clueCode}`}</div>
      <div className="help">
        {otherClueCode === null
          ? '写明原因后，本条线索随旧线索一并办结。'
          : `写明原因后，本条线索随 ${otherClueCode} 一并办结。`}
      </div>
      {failure ? <div className="banner danger" data-role="failure">{failure}</div> : null}
      <div className="form-row">
        <label htmlFor="close-with-old-note">原因说明</label>
        <div>
          <textarea
            id="close-with-old-note"
            className="input"
            data-role="close-with-old-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <div className="help">原因说明必填。</div>
        </div>
      </div>
      <div className="actions">
        <button
          type="button"
          className="btn btn-primary"
          data-role="close-with-old-submit"
          disabled={busy}
          onClick={() => onSubmit(note.trim())}
        >
          随旧线索办结
        </button>
        <button type="button" className="btn" data-role="close-with-old-cancel" onClick={onCancel}>
          取消
        </button>
      </div>
    </div>
  );
}
