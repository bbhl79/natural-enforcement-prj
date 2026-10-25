// 结案提醒列表与处理（#217；规格 D 节、GLOSSARY）。
//
// 旧线索不予立案、移送或立案时，按暂存线索的当前命中集逐对生成提醒。
// 处理人二选一：撤回不派再办（回待分派池）或写明原因随旧线索办结。
// 系统不自动派、不自动关；本期无超期、催办或升级。

import { useCallback, useEffect, useState } from 'react';

import { useAppDispatch } from '../hooks';
import { ErrorCard } from '../shell/StatusPages';
import { ClueCloseWithOldDialog, ClueWithdrawDialog } from './ClueWithdrawDialog';
import {
  closureFailureText,
  loadClosureOptions,
  loadReminders,
  reminderKindLabel,
  submitResolveReminder,
  type ReminderItem,
} from './closure';

/** 结案提醒列表。 */
export default function ClueReminderSection() {
  const dispatch = useAppDispatch();
  const [reminders, setReminders] = useState<readonly ReminderItem[]>([]);
  const [reasons, setReasons] = useState<readonly string[]>([]);
  const [withdrawTarget, setWithdrawTarget] = useState<ReminderItem | null>(null);
  const [closeTarget, setCloseTarget] = useState<ReminderItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [options, rows] = await Promise.all([
        loadClosureOptions(dispatch),
        loadReminders(dispatch),
      ]);
      setReasons(options.withdrawReasons);
      setReminders(rows);
      setError(false);
    } catch {
      setError(true);
    }
  }, [dispatch]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const resolve = async (
    reminder: ReminderItem,
    resolution: string,
    reasonCodes: readonly string[],
    note: string,
  ) => {
    setBusy(true);
    setFailure(null);
    const result = await submitResolveReminder(dispatch, reminder.reminderId, {
      resolution,
      reasonCodes,
      note,
      expectedStatus: 'held',
    });
    setBusy(false);
    if (result.ok) {
      setWithdrawTarget(null);
      setCloseTarget(null);
      await reload();
      return;
    }
    setFailure(closureFailureText(result.body));
  };

  if (error) return <ErrorCard what="结案提醒" onRetry={() => void reload()} />;

  return (
    <div className="card" data-role="reminder-section">
      <div className="card-h">
        结案提醒
        <span className="hint">旧线索已结案；处理人二选一，系统不自动派、不自动关</span>
      </div>
      {reminders.length === 0 ? (
        <div className="help" data-role="reminder-empty">当前没有待处理的结案提醒。</div>
      ) : (
        reminders.map((reminder) => (
          <div
            className="form-row"
            key={reminder.reminderId}
            data-role="reminder-item"
            data-code={reminder.clueCode}
          >
            <label>{reminder.clueCode}</label>
            <div>
              <div>
                {`${reminderKindLabel(reminder.kind)}：${reminder.otherClueCode ?? '对方线索'}`}
              </div>
              {reminder.mayResolve ? (
                <div className="actions">
                  <button
                    type="button"
                    className="btn btn-sm"
                    data-role="reminder-withdraw"
                    onClick={() => {
                      setFailure(null);
                      setCloseTarget(null);
                      setWithdrawTarget(reminder);
                    }}
                  >
                    撤回不派再办
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    data-role="reminder-close-with-old"
                    onClick={() => {
                      setFailure(null);
                      setWithdrawTarget(null);
                      setCloseTarget(reminder);
                    }}
                  >
                    写明原因随旧线索办结
                  </button>
                </div>
              ) : (
                <div className="help">当前账号不能处理这条提醒。</div>
              )}
            </div>
          </div>
        ))
      )}
      {withdrawTarget ? (
        <ClueWithdrawDialog
          clueCode={withdrawTarget.clueCode}
          reasons={reasons}
          busy={busy}
          failure={failure}
          onSubmit={(reasonCodes, note) =>
            void resolve(withdrawTarget, 'withdraw', reasonCodes, note)
          }
          onCancel={() => setWithdrawTarget(null)}
        />
      ) : null}
      {closeTarget ? (
        <ClueCloseWithOldDialog
          clueCode={closeTarget.clueCode}
          otherClueCode={closeTarget.otherClueCode}
          busy={busy}
          failure={failure}
          onSubmit={(note) => void resolve(closeTarget, 'close-with-old', [], note)}
          onCancel={() => setCloseTarget(null)}
        />
      ) : null}
    </div>
  );
}
