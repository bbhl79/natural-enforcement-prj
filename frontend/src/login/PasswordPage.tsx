import type { FormEvent } from 'react';
import { useSearchParams } from 'react-router';

import { useAppDispatch, useAppSelector } from '../hooks';
import { safeNext } from '../routing';
import { BarePage } from '../shell/StatusPages';
import {
  logout,
  PASSWORD_RULE_TEXT,
  setCurrentPassword,
  setNewPassword,
  submitPassword,
} from './loginSlice';

const INPUT_STYLE = { height: 44 } as const;

/** 改口令页（#91；版式按原型 v0.4 P2 forced / forcedExpired）。 */
export default function PasswordPage() {
  const dispatch = useAppDispatch();
  const state = useAppSelector((root) => root.login);
  const [params] = useSearchParams();
  const redirected = safeNext(params.get('next')) !== null;
  const locked = state.screen === 'locked';
  const canSubmit = !locked && state.currentPassword !== '' && state.newPassword !== '';
  const explanation = state.passwordChangeKind === 'expired'
    ? '口令已超过 90 天，必须更换口令。完成前不能使用其他功能。'
    : '首次登录必须更换初始口令。完成前不能使用其他功能。';

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
          {state.currentPasswordRejected ? (
            <div className="banner danger" role="status">当前口令不正确。</div>
          ) : null}
          <form onSubmit={onSubmit}>
            <input
              className="input"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              placeholder="当前口令"
              aria-label="当前口令"
              style={{ ...INPUT_STYLE, marginBottom: 10 }}
              value={state.currentPassword}
              disabled={locked}
              onChange={(event) => dispatch(setCurrentPassword(event.target.value))}
            />
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
            {state.ruleCodes.length > 0 ? (
              <ul className="err" style={{ margin: '0 0 12px 18px' }}>
                {state.ruleCodes.map((code) => (
                  <li key={code}>{PASSWORD_RULE_TEXT[code] ?? code}</li>
                ))}
              </ul>
            ) : <div style={{ marginBottom: 12 }} />}
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
