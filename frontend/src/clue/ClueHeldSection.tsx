// 不派视图（#217；规格 D 节、GLOSSARY「撤回不派」）。
//
// 列出数据范围内当前「不派」的线索；有权的账号可发起撤回不派：
// 勾选常用原因（至少一项）＋写明补充说明，撤回后线索回待分派池。
// 系统不自动派、不自动关：撤回由人发起。

import { useCallback, useEffect, useState } from 'react';

import { useAppDispatch } from '../hooks';
import { ErrorCard } from '../shell/StatusPages';
import { ClueWithdrawDialog } from './ClueWithdrawDialog';
import {
  closureFailureText,
  loadClosureOptions,
  loadHeldClues,
  submitWithdraw,
  type HeldClue,
} from './closure';
import { DOMAIN_LABEL } from './registration';

/** 不派视图。 */
export default function ClueHeldSection() {
  const dispatch = useAppDispatch();
  const [clues, setClues] = useState<readonly HeldClue[]>([]);
  const [reasons, setReasons] = useState<readonly string[]>([]);
  const [target, setTarget] = useState<HeldClue | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [options, rows] = await Promise.all([
        loadClosureOptions(dispatch),
        loadHeldClues(dispatch),
      ]);
      setReasons(options.withdrawReasons);
      setClues(rows);
      setError(false);
    } catch {
      setError(true);
    }
  }, [dispatch]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const submit = async (reasonCodes: readonly string[], note: string) => {
    if (!target) return;
    setBusy(true);
    setFailure(null);
    const result = await submitWithdraw(dispatch, target.clueId, {
      reasonCodes,
      note,
      expectedStatus: 'held',
    });
    setBusy(false);
    if (result.ok) {
      setTarget(null);
      await reload();
      return;
    }
    setFailure(closureFailureText(result.body));
  };

  if (error) return <ErrorCard what="不派视图" onRetry={() => void reload()} />;

  return (
    <div className="card" data-role="held-section">
      <div className="card-h">
        不派
        <span className="hint">当前不派的线索；有权人可撤回不派</span>
      </div>
      {clues.length === 0 ? (
        <div className="help" data-role="held-empty">当前没有不派线索。</div>
      ) : (
        clues.map((clue) => (
          <div className="form-row" key={clue.clueId} data-role="held-item" data-code={clue.code}>
            <label>{clue.code}</label>
            <div>
              <div>{`${clue.sourceName} · ${DOMAIN_LABEL[clue.domain as keyof typeof DOMAIN_LABEL] ?? clue.domain}`}</div>
              {clue.hitCodes.length > 0 ? (
                <div className="help" data-role="held-hits">{`与 ${clue.hitCodes.join('、')} 疑似重复`}</div>
              ) : null}
              {clue.mayWithdraw ? (
                <button
                  type="button"
                  className="btn btn-sm"
                  data-role="held-withdraw"
                  onClick={() => {
                    setFailure(null);
                    setTarget(clue);
                  }}
                >
                  撤回不派
                </button>
              ) : (
                <div className="help">当前账号不能撤回不派。</div>
              )}
            </div>
          </div>
        ))
      )}
      {target ? (
        <ClueWithdrawDialog
          clueCode={target.code}
          reasons={reasons}
          busy={busy}
          failure={failure}
          onSubmit={(reasonCodes, note) => void submit(reasonCodes, note)}
          onCancel={() => setTarget(null)}
        />
      ) : null}
    </div>
  );
}
