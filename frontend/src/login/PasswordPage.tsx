import type { FormEvent } from 'react';

import { useAppDispatch, useAppSelector } from '../hooks';
import './login.css';
import {
  logout,
  PASSWORD_RULE_TEXT,
  setCurrentPassword,
  setNewPassword,
  submitPassword,
} from './loginSlice';

export default function PasswordPage() {
  const dispatch = useAppDispatch();
  const state = useAppSelector((root) => root.login);
  const canSubmit = state.currentPassword !== '' && state.newPassword !== '';
  const explanation = state.passwordChangeKind === 'expired'
    ? '口令已超过 90 天，必须更换口令。完成前不能使用其他功能。'
    : '首次登录必须更换初始口令。完成前不能使用其他功能。';

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void dispatch(submitPassword());
  }

  return (
    <div className="product">
      <section className="panel">
        <div className="form-wrap">
          <h2>必须改口令</h2>
          <p className="lead" role="status">{explanation}</p>
          {state.currentPasswordRejected ? (
            <div className="banner danger" role="status">当前口令不正确。</div>
          ) : null}
          {state.ruleCodes.length > 0 ? (
            <ul>
              {state.ruleCodes.map((code) => (
                <li key={code}>{PASSWORD_RULE_TEXT[code] ?? code}</li>
              ))}
            </ul>
          ) : null}
          <form onSubmit={onSubmit}>
            <div className="field">
              <input
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                placeholder="当前口令"
                aria-label="当前口令"
                value={state.currentPassword}
                onChange={(event) => dispatch(setCurrentPassword(event.target.value))}
              />
            </div>
            <div className="field">
              <input
                name="newPassword"
                type="password"
                autoComplete="new-password"
                placeholder="新口令"
                aria-label="新口令"
                value={state.newPassword}
                onChange={(event) => dispatch(setNewPassword(event.target.value))}
              />
            </div>
            <button className="login" type="submit" disabled={!canSubmit}>更换口令</button>
          </form>
          <button type="button" onClick={() => void dispatch(logout())}>退出</button>
        </div>
      </section>
    </div>
  );
}
