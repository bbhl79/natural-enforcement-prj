import type { FormEvent, MouseEvent } from 'react';

import { useAppDispatch, useAppSelector } from '../hooks';
import './login.css';
import {
  forgotPassword,
  loginFormDisabled,
  loginSubmitEnabled,
  setPassword,
  setPhone,
  submitLogin,
  togglePasswordVisible,
  toggleRemember,
  type LoginScreen,
} from './loginSlice';

const COPY = {
  error: '账号或口令不正确。如需帮助，请联系本单位管理员。',
  locked: '账号已锁定。请联系本单位管理员解锁。',
  deactivated: '账号已停用。请联系本单位管理员恢复。',
} as const;

function bannerOf(screen: LoginScreen): { tone: 'danger' | 'amber'; text: string } | null {
  if (screen === 'default') return null;
  return {
    tone: screen === 'locked' ? 'amber' : 'danger',
    text: COPY[screen],
  };
}

export default function LoginPage() {
  const dispatch = useAppDispatch();
  const state = useAppSelector((root) => root.login);
  const disabled = loginFormDisabled(state.screen);
  const banner = bannerOf(state.screen);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    dispatch(submitLogin());
  }

  function onForgot(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    dispatch(forgotPassword());
  }

  return (
    <div className="product">
      <aside className="brand">
        <span className="orb a" />
        <span className="orb b" />
        <span className="orb c" />
        <div className="brand-inner">
          <div className="mark" aria-hidden="true">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <path fill="#fff" d="M16 3 27 8v8.2c0 6.4-4.2 10.6-11 13.3C9.2 26.8 5 22.6 5 16.2V8L16 3z" />
              <path d="M11.2 16.1 14.3 19.2 20.9 12.6" stroke="#1f6b56" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h1>广州市规划和自然资源局监督监管与执法协同系统</h1>
          <ul>
            <li><strong>全程办案</strong>覆盖线索登记、事件核查、案件查处、执行跟踪、案卷归档全生命周期</li>
            <li><strong>协同联动</strong>市区镇街三级执法联动，法制审核与业务会办贯穿全程</li>
            <li><strong>程序合规</strong>严格遵循立案查处规程，法定支线自动提示，门禁阻断自动预警</li>
            <li><strong>智能辅助</strong>GIS 空间定位与证据关联，文书字段自动继承，减少重复填报</li>
          </ul>
        </div>
      </aside>
      <section className="panel">
        <div className="form-wrap">
          <h2>欢迎登录</h2>
          <p className="lead">请输入您的账号信息以继续使用系统</p>
          {banner ? (
            <div className={`banner ${banner.tone}`} role="status">{banner.text}</div>
          ) : null}
          <form onSubmit={onSubmit}>
            <div className="field">
              <svg className="lead-icon" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="8" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
                <path d="M5.5 19.2c1.4-3 3.6-4.4 6.5-4.4s5.1 1.4 6.5 4.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              <input
                name="phone"
                type="text"
                autoComplete="username"
                placeholder="手机号"
                aria-label="手机号"
                value={state.phone}
                disabled={disabled}
                onChange={(event) => dispatch(setPhone(event.target.value))}
              />
            </div>
            <div className="field">
              <svg className="lead-icon" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="6" y="10" width="12" height="9" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
                <path d="M8.5 10V8.2a3.5 3.5 0 0 1 7 0V10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              <input
                name="password"
                type={state.passwordVisible ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="密码"
                aria-label="密码"
                value={state.password}
                disabled={disabled}
                onChange={(event) => dispatch(setPassword(event.target.value))}
              />
              <button
                type="button"
                className="eye"
                aria-label={state.passwordVisible ? '隐藏密码' : '显示密码'}
                disabled={disabled}
                onClick={() => dispatch(togglePasswordVisible())}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M2.5 12S6.2 6.5 12 6.5 21.5 12 21.5 12 17.8 17.5 12 17.5 2.5 12 2.5 12z" fill="none" stroke="currentColor" strokeWidth="1.6" />
                  <circle cx="12" cy="12" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
                </svg>
              </button>
            </div>
            <div className="row">
              <label className="remember">
                <input
                  type="checkbox"
                  checked={state.rememberMe}
                  disabled={disabled}
                  onChange={() => dispatch(toggleRemember())}
                />
                记住我
              </label>
              <button type="button" className="forgot" disabled={disabled} onClick={onForgot}>忘记密码？</button>
            </div>
            <button className="login" type="submit" disabled={!loginSubmitEnabled(state)}>登录</button>
          </form>
        </div>
      </section>
    </div>
  );
}
