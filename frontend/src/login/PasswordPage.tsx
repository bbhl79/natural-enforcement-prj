import type { FormEvent } from 'react';
import { useSearchParams } from 'react-router';

import { useAppDispatch, useAppSelector } from '../hooks';
import { safeNext } from '../routing';
import { BarePage } from '../shell/StatusPages';
import {
  logout,
  PASSWORD_CONCURRENT_TEXT,
  PASSWORD_MISMATCH_TEXT,
  setConfirmPassword,
  setNewPassword,
  submitPassword,
} from './loginSlice';
import PasswordStrength, { evaluatePasswordStrength, PasswordRuleFeedback } from './PasswordStrength';

const INPUT_STYLE = { height: 44 } as const;

/** 强制改密页（#91；#292：首登／过期只填新口令与确认，不要当前口令）。 */
export default function PasswordPage() {
  const dispatch = useAppDispatch();
  const state = useAppSelector((root) => root.login);
  const [params] = useSearchParams();
  const redirected = safeNext(params.get('next')) !== null;
  const locked = state.screen === 'locked';
  const strength = evaluatePasswordStrength({ password: state.newPassword });
  const mismatch = state.confirmPassword !== '' && state.confirmPassword !== state.newPassword;
  const canSubmit = !locked
    && state.newPassword !== ''
    && state.confirmPassword === state.newPassword
    && strength.passed;
  const explanation = state.passwordChangeKind === 'expired'
    ? '口令已超过 90 天，必须更换口令。完成前不能使用其他功能。'
    : '首次登录必须更换初始口令。完成前不能使用其他功能。';

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    void dispatch(submitPassword());
  }

  return (
    <BarePage>
      <div className="center-page">
        <div className="center-box" style={{ textAlign: 'left', width: 400 }}>
          <h2>必须改口令</h2>
          {redirected ? (
            <div className="banner amber">你要打开的页面需要先完成改口令。改好后会自动回到刚才的页面。</div>
          ) : null}
          <p role="status">{explanation}</p>
          {locked ? (
            <div className="banner amber" role="status">账号已锁定。请联系本单位管理员解锁。</div>
          ) : null}
          {state.concurrentChangeRejected ? (
            <div className="banner danger" role="status" data-reason="concurrent-change">{PASSWORD_CONCURRENT_TEXT}</div>
          ) : null}
          <form onSubmit={onSubmit}>
            <input
              className="input"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              placeholder="新口令"
              aria-label="新口令"
              style={{ ...INPUT_STYLE, marginBottom: 4 }}
              value={state.newPassword}
              disabled={locked}
              onChange={(event) => dispatch(setNewPassword(event.target.value))}
            />
            <PasswordStrength password={state.newPassword} />
            <PasswordRuleFeedback ruleCodes={state.ruleCodes} />
            <input
              className="input"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              placeholder="确认新口令"
              aria-label="确认新口令"
              style={{ ...INPUT_STYLE, marginBottom: 4 }}
              value={state.confirmPassword}
              disabled={locked}
              onChange={(event) => dispatch(setConfirmPassword(event.target.value))}
            />
            {mismatch ? (
              <div className="err" role="status" data-reason="confirm-mismatch" style={{ marginBottom: 10 }}>
                {PASSWORD_MISMATCH_TEXT}
              </div>
            ) : null}
            <button
              className="btn btn-primary"
              type="submit"
              style={{ width: '100%', height: 44, justifyContent: 'center' }}
              disabled={!canSubmit}
            >
              更换口令
            </button>
          </form>
          <div style={{ marginTop: 10 }}>
            <button type="button" className="link-btn" onClick={() => void dispatch(logout())}>退出</button>
          </div>
        </div>
      </div>
    </BarePage>
  );
}
