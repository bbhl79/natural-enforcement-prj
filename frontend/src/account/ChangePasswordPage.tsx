// 个人中心·修改口令（#292）：自愿改密与强制改密分页，字段不共用显隐。
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';

import { useAppDispatch, useAppSelector } from '../hooks';
import PasswordStrength, { evaluatePasswordStrength, PasswordRuleFeedback } from '../login/PasswordStrength';
import {
  PASSWORD_CONCURRENT_TEXT,
  PASSWORD_MISMATCH_TEXT,
  setConfirmPassword,
  setCurrentPassword,
  setNewPassword,
  submitPassword,
} from '../login/loginSlice';
import { HOME_PATH } from '../routing';

export default function ChangePasswordPage() {
  const dispatch = useAppDispatch();
  const state = useAppSelector((root) => root.login);
  const operator = state.operator;
  const locked = state.screen === 'locked';
  const strength = evaluatePasswordStrength({
    password: state.newPassword,
    personnelCode: operator?.code,
    currentPassword: state.currentPassword === '' ? undefined : state.currentPassword,
  });
  const mismatch = state.confirmPassword !== '' && state.confirmPassword !== state.newPassword;
  const canSubmit = !locked
    && state.currentPassword !== ''
    && state.newPassword !== ''
    && state.confirmPassword === state.newPassword
    && strength.passed;
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setDone(false);
    try {
      await dispatch(submitPassword()).unwrap();
      setDone(true);
    } catch {
      // 失败原因由状态里的横幅与规则清单给出。
    }
  }

  return (
    <>
      <div className="page-h">
        <div>
          <h1>修改口令</h1>
          <div className="desc">修改本人登录口令。新口令生效后，其他设备需用新口令重新登录。</div>
        </div>
      </div>
      <div className="card" style={{ maxWidth: 560 }}>
        {operator ? (
          <div className="help" style={{ marginTop: 0, marginBottom: 12 }}>
            {`当前登录：${operator.name}${operator.orgName ? ` · ${operator.orgName}` : ''}`}
          </div>
        ) : null}
        {done ? (
          <div className="banner ok" role="status">口令已修改。</div>
        ) : null}
        {locked ? (
          <div className="banner amber" role="status">账号已锁定。请联系本单位管理员解锁。</div>
        ) : null}
        {state.currentPasswordRejected ? (
          <div className="banner danger" role="status">当前口令不正确。</div>
        ) : null}
        {state.concurrentChangeRejected ? (
          <div className="banner danger" role="status" data-reason="concurrent-change">{PASSWORD_CONCURRENT_TEXT}</div>
        ) : null}
        <form onSubmit={onSubmit}>
          <div className="form-row">
            <label htmlFor="current-password">当前口令<span className="req">*</span></label>
            <input
              id="current-password"
              className="input"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              placeholder="当前口令"
              aria-label="当前口令"
              value={state.currentPassword}
              disabled={locked}
              onChange={(event) => {
                setDone(false);
                dispatch(setCurrentPassword(event.target.value));
              }}
            />
          </div>
          <div className="form-row">
            <label htmlFor="new-password">新口令<span className="req">*</span></label>
            <div>
              <input
                id="new-password"
                className="input"
                name="newPassword"
                type="password"
                autoComplete="new-password"
                placeholder="新口令"
                aria-label="新口令"
                value={state.newPassword}
                disabled={locked}
                onChange={(event) => {
                  setDone(false);
                  dispatch(setNewPassword(event.target.value));
                }}
              />
              <PasswordStrength
                password={state.newPassword}
                personnelCode={operator?.code}
                currentPassword={state.currentPassword === '' ? undefined : state.currentPassword}
              />
              <PasswordRuleFeedback ruleCodes={state.ruleCodes} />
            </div>
          </div>
          <div className="form-row">
            <label htmlFor="confirm-password">确认新口令<span className="req">*</span></label>
            <div>
              <input
                id="confirm-password"
                className="input"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                placeholder="确认新口令"
                aria-label="确认新口令"
                value={state.confirmPassword}
                disabled={locked}
                onChange={(event) => {
                  setDone(false);
                  dispatch(setConfirmPassword(event.target.value));
                }}
              />
              {mismatch ? (
                <div className="err" role="status" data-reason="confirm-mismatch">
                  {PASSWORD_MISMATCH_TEXT}
                </div>
              ) : null}
            </div>
          </div>
          <div className="actions">
            <button className="btn btn-primary" type="submit" disabled={!canSubmit}>保存新口令</button>
            <Link className="btn" to={HOME_PATH}>返回工作台</Link>
          </div>
        </form>
      </div>
    </>
  );
}