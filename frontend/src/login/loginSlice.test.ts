import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { afterEach, describe, expect, it, vi } from 'vitest';

import healthReducer from '../health/healthSlice';
import { AuthShell } from '../App';
import LoginPage from './LoginPage';
import reducer, {
  dismissExpiryNotice,
  enterPasswordChange,
  expiryNoticeVisible,
  forgotPassword,
  loadSession,
  loginSubmitEnabled,
  logout,
  PASSWORD_RULE_TEXT,
  passwordChangeKindFromDenial,
  setCurrentPassword,
  setNewPassword,
  setPassword,
  setPhone,
  submitLogin,
  submitPassword,
  toggleRemember,
  type LoginState,
} from './loginSlice';
import { store } from '../store';

function loginHtml(): string {
  return renderToStaticMarkup(
    createElement(Provider, { store, children: createElement(LoginPage) }),
  );
}

describe('登录页', () => {
  it('输入框占位为手机号和密码', () => {
    const html = loginHtml();
    expect(html).toContain('placeholder="手机号"');
    expect(html).toContain('placeholder="密码"');
    expect(html).not.toContain('placeholder="用户名"');
  });

  it('两栏都非空才能登录', () => {
    const empty = reducer(undefined, { type: '@@init' });
    expect(loginSubmitEnabled(empty)).toBe(false);
    expect(loginSubmitEnabled(reducer(empty, setPhone('13800138000')))).toBe(false);
    expect(loginSubmitEnabled(reducer(empty, setPassword('correct-horse')))).toBe(false);
    const ready = reducer(reducer(empty, setPhone('13800138000')), setPassword('correct-horse'));
    expect(loginSubmitEnabled(ready)).toBe(true);
    const blankPhone = reducer(ready, setPhone('   '));
    expect(loginSubmitEnabled(blankPhone)).toBe(false);
    expect(loginHtml()).toMatch(/class="login"[^>]*disabled/);
  });

  it('忘记密码不离开本页', () => {
    const ready = reducer(
      reducer(undefined, setPhone('13800138000')),
      setPassword('correct-horse'),
    );
    const stayed = reducer(ready, forgotPassword());
    expect(stayed.screen).toBe('default');
    expect(stayed.phone).toBe('13800138000');
    const html = loginHtml();
    expect(html).toContain('>忘记密码？</button>');
    expect(html).not.toMatch(/<a[\s>/]/);
    expect(html).not.toMatch(/<form[^>]*action=/);
  });

  it('页面没有预置口令', () => {
    const state = reducer(undefined, { type: '@@init' });
    expect(state.password).toBe('');
    const html = loginHtml();
    expect(html).not.toContain('123456');
    expect(html).not.toContain('预置');
    expect(html).toContain('placeholder="密码"');
    expect(html).not.toMatch(/type="password"[^>]*value="[^"]+"/);
  });

  it('登录返回锁定时显示琥珀色文案并禁用表单', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ result: 'locked' }), { status: 401 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const view = configureStore({ reducer: { login: reducer, health: healthReducer } });
    view.dispatch(setPhone('13800009801'));
    view.dispatch(setPassword('wrong-password'));
    await view.dispatch(submitLogin());
    expect(view.getState().login.screen).toBe('locked');
    expect(view.getState().login.phase).toBe('anonymous');
    const html = renderToStaticMarkup(
      createElement(Provider, { store: view, children: createElement(LoginPage) }),
    );
    expect(html).toContain('class="banner amber"');
    expect(html).toContain('账号已锁定。请联系本单位管理员解锁。');
    expect(html).not.toContain('账号已停用。请联系本单位管理员恢复。');
    expect(html).toMatch(/placeholder="手机号"[^>]*disabled/);
    expect(html).toMatch(/placeholder="密码"[^>]*disabled/);
    expect(html).toMatch(/class="login"[^>]*disabled/);
  });

  it('登录返回停用时显示红色文案并禁用表单', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ result: 'deactivated' }), { status: 401 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const view = configureStore({ reducer: { login: reducer, health: healthReducer } });
    view.dispatch(setPhone('13800009802'));
    view.dispatch(setPassword('wrong-password'));
    await view.dispatch(submitLogin());
    expect(view.getState().login.screen).toBe('deactivated');
    const html = renderToStaticMarkup(
      createElement(Provider, { store: view, children: createElement(LoginPage) }),
    );
    expect(html).toContain('class="banner danger"');
    expect(html).toContain('账号已停用。请联系本单位管理员恢复。');
    expect(html).not.toContain('账号已锁定。请联系本单位管理员解锁。');
    expect(html).toMatch(/placeholder="手机号"[^>]*disabled/);
    expect(html).toMatch(/class="login"[^>]*disabled/);
  });

  it('刷新后锁定和停用文案消失，表单恢复可填', () => {
    const locked = reducer(
      reducer(reducer(undefined, setPhone('13800009801')), setPassword('wrong-password')),
      submitLogin.rejected(new Error('rejected'), 'req-refresh', undefined, { result: 'locked' }),
    );
    expect(loginSubmitEnabled(locked)).toBe(false);
    const fresh = reducer(undefined, { type: '@@init' });
    const filled = reducer(reducer(fresh, setPhone('13800009801')), setPassword('wrong-password'));
    expect(filled.screen).toBe('default');
    expect(loginSubmitEnabled(filled)).toBe(true);
    const view = configureStore({
      reducer: { login: reducer, health: healthReducer },
      preloadedState: { login: filled },
    });
    const html = renderToStaticMarkup(
      createElement(Provider, { store: view, children: createElement(LoginPage) }),
    );
    expect(html).not.toContain('账号已锁定');
    expect(html).not.toContain('账号已停用');
    expect(html).not.toMatch(/placeholder="手机号"[^>]*disabled/);
    expect(html).not.toMatch(/class="login"[^>]*disabled/);
  });

  it('口令错误时显示同一句文案，不进入系统', () => {
    const ready = reducer(
      reducer(undefined, setPhone('13800138000')),
      setPassword('correct-horse'),
    );
    const failed = reducer(
      ready,
      submitLogin.rejected(new Error('rejected'), 'req-1', undefined, { result: 'invalid-credential' }),
    );
    expect(failed.phase).toBe('anonymous');
    expect(failed.operator).toBeNull();
    expect(failed.screen).toBe('error');
    const view = configureStore({
      reducer: { login: reducer, health: healthReducer },
      preloadedState: { login: failed },
    });
    const html = renderToStaticMarkup(
      createElement(Provider, { store: view, children: createElement(LoginPage) }),
    );
    expect(html).toContain('账号或口令不正确。如需帮助，请联系本单位管理员。');
  });

  it('首次登录进入改口令页，完成前不显示系统功能', () => {
    const ready = reducer(
      reducer(undefined, setPhone('13800009502')),
      setPassword('Correct-horse-95'),
    );
    const blocked = reducer(
      ready,
      submitLogin.rejected(
        new Error('rejected'),
        'req-2',
        undefined,
        { result: 'password-change-required' },
      ),
    );
    expect(blocked.phase).toBe('password-change-required');
    expect(blocked.passwordChangeKind).toBe('first-login');
    expect(blocked.operator).toBeNull();
    const view = configureStore({
      reducer: { login: reducer, health: healthReducer },
      preloadedState: { login: blocked },
    });
    const html = renderToStaticMarkup(
      createElement(Provider, { store: view, children: createElement(AuthShell) }),
    );
    expect(html).toContain('必须改口令');
    expect(html).toContain('首次登录必须更换初始口令');
    expect(html).toContain('placeholder="当前口令"');
    expect(html).toContain('placeholder="新口令"');
    expect(html).not.toContain('环境健康面板');
    expect(html).not.toContain('placeholder="手机号"');
  });

  it('口令超过 90 天时说明必须更换', () => {
    const blocked = reducer(
      undefined,
      submitLogin.rejected(new Error('rejected'), 'req-expired', undefined, { result: 'password-expired' }),
    );
    expect(blocked.passwordChangeKind).toBe('expired');
    const view = configureStore({
      reducer: { login: reducer, health: healthReducer },
      preloadedState: { login: blocked },
    });
    const html = renderToStaticMarkup(
      createElement(Provider, { store: view, children: createElement(AuthShell) }),
    );
    expect(html).toContain('口令已超过 90 天，必须更换口令');
  });

  it('规则码一次显示为全部中文提示', () => {
    const withRules = reducer(
      reducer(undefined, setCurrentPassword('Old-pass-97!')),
      submitPassword.rejected(new Error('rejected'), 'req-rules', undefined, {
        result: 'non-compliant',
        rules: ['too-short', 'insufficient-classes', 'sequential', 'repeated', 'common', 'contains-code', 'same-as-current', 'too-long'],
      }),
    );
    const login: LoginState = {
      ...withRules,
      phase: 'password-change-required',
      passwordChangeKind: 'first-login',
    };
    const view = configureStore({
      reducer: { login: reducer, health: healthReducer },
      preloadedState: { login },
    });
    const html = renderToStaticMarkup(
      createElement(Provider, { store: view, children: createElement(AuthShell) }),
    );
    for (const text of Object.values(PASSWORD_RULE_TEXT)) {
      expect(html).toContain(text);
    }
  });

  it('距到期 7 天显示提醒，关闭后同一会话不再出现，第 8 天不出现', () => {
    const entered = reducer(
      undefined,
      submitLogin.fulfilled(
        { name: '丁经办', code: 'P-95-OK', orgName: '第一执法支队', roles: ['经办'], daysRemaining: 7 },
        'req-banner',
        undefined,
      ),
    );
    expect(expiryNoticeVisible(entered)).toBe(true);
    const view = configureStore({
      reducer: { login: reducer, health: healthReducer },
      preloadedState: { login: entered },
    });
    const shown = renderToStaticMarkup(
      createElement(Provider, { store: view, children: createElement(AuthShell) }),
    );
    expect(shown).toContain('口令还剩 7 天到期');
    const closed = reducer(entered, dismissExpiryNotice());
    const reloaded = reducer(
      closed,
      loadSession.fulfilled({
        result: 'authenticated',
        name: '丁经办',
        code: 'P-95-OK',
        orgName: '第一执法支队',
        roles: ['经办'],
        daysRemaining: 7,
      }, 'req-reload'),
    );
    expect(expiryNoticeVisible(reloaded)).toBe(false);
    const hidden = configureStore({
      reducer: { login: reducer, health: healthReducer },
      preloadedState: { login: reloaded },
    });
    const after = renderToStaticMarkup(
      createElement(Provider, { store: hidden, children: createElement(AuthShell) }),
    );
    expect(after).not.toContain('口令还剩');
    const eighth = reducer(
      undefined,
      submitLogin.fulfilled(
        { name: '丁经办', code: 'P-95-OK', orgName: '第一执法支队', roles: ['经办'], daysRemaining: 8 },
        'req-eighth',
        undefined,
      ),
    );
    expect(expiryNoticeVisible(eighth)).toBe(false);
  });

  it('403 强制改密进入改口令页', () => {
    expect(passwordChangeKindFromDenial(403, 'password-expired')).toBe('expired');
    expect(passwordChangeKindFromDenial(401, 'password-expired')).toBeNull();
    const forced = reducer(undefined, enterPasswordChange('expired'));
    expect(forced.phase).toBe('password-change-required');
    expect(forced.passwordChangeKind).toBe('expired');
  });

  it('改口令返回锁定时显示锁定文案并禁用表单', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ result: 'locked' }), { status: 401 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const view = configureStore({ reducer: { login: reducer, health: healthReducer } });
    view.dispatch(enterPasswordChange('first-login'));
    view.dispatch(setCurrentPassword('Old-pass-97!'));
    view.dispatch(setNewPassword('New-pass-97!'));
    await view.dispatch(submitPassword());
    expect(view.getState().login.screen).toBe('locked');
    const html = renderToStaticMarkup(
      createElement(Provider, { store: view, children: createElement(AuthShell) }),
    );
    expect(html).toContain('class="banner amber"');
    expect(html).toContain('账号已锁定。请联系本单位管理员解锁。');
    expect(html).not.toContain('当前口令不正确');
    expect(html).toMatch(/placeholder="当前口令"[^>]*disabled/);
    expect(html).toMatch(/placeholder="新口令"[^>]*disabled/);
  });

  it('改口令提交当前口令和新口令', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: 'established' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        result: 'authenticated',
        name: '丁经办',
        code: 'P-95-OK',
        orgName: '第一执法支队',
        roles: ['经办'],
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const view = configureStore({ reducer: { login: reducer, health: healthReducer } });
    view.dispatch(setCurrentPassword('Old-pass-97!'));
    view.dispatch(setNewPassword('New-pass-97!'));
    await view.dispatch(submitPassword());
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'Old-pass-97!', newPassword: 'New-pass-97!' }),
    });
    expect(view.getState().login.phase).toBe('authenticated');
  });

  it('口令正确且已改密后能看到姓名、工号、机构和角色，并能退出', () => {
    const ready = reducer(
      reducer(undefined, setPhone('13800009501')),
      setPassword('Correct-horse-95'),
    );
    const entered = reducer(
      ready,
      submitLogin.fulfilled(
        {
          name: '丁经办',
          code: 'P-95-OK',
          orgName: '第一执法支队',
          roles: ['监督', '经办'],
        },
        'req-3',
        undefined,
      ),
    );
    expect(entered.phase).toBe('authenticated');
    expect(entered.operator).toEqual({
      name: '丁经办',
      code: 'P-95-OK',
      orgName: '第一执法支队',
      roles: ['监督', '经办'],
    });
    const view = configureStore({
      reducer: { login: reducer, health: healthReducer },
      preloadedState: { login: entered },
    });
    const html = renderToStaticMarkup(
      createElement(Provider, { store: view, children: createElement(AuthShell) }),
    );
    expect(html).toContain('丁经办');
    expect(html).toContain('P-95-OK');
    expect(html).toContain('第一执法支队');
    expect(html).toContain('监督、经办');
    expect(html).toContain('>退出</button>');
    expect(html).toContain('环境健康面板');
    const left = reducer(entered, logout.fulfilled(undefined, 'req-4'));
    expect(left.phase).toBe('anonymous');
    expect(left.operator).toBeNull();
  });

  it('未登录显示登录页', () => {
    const anonymous = reducer(undefined, loadSession.fulfilled({ result: 'anonymous' }, 'req-5'));
    const view = configureStore({
      reducer: { login: reducer, health: healthReducer },
      preloadedState: { login: anonymous },
    });
    const html = renderToStaticMarkup(
      createElement(Provider, { store: view, children: createElement(AuthShell) }),
    );
    expect(html).toContain('placeholder="手机号"');
    expect(html).toContain('>登录</button>');
  });

  it('登录请求提交手机号、口令和是否记住我', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: 'established' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        result: 'authenticated',
        name: '丁经办',
        code: 'P-95-OK',
        orgName: '第一执法支队',
        roles: ['经办'],
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const view = configureStore({ reducer: { login: reducer, health: healthReducer } });
    view.dispatch(setPhone(' 13800009501 '));
    view.dispatch(setPassword('Correct-horse-95'));
    view.dispatch(toggleRemember());
    await view.dispatch(submitLogin());
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mobilePhone: '13800009501',
        password: 'Correct-horse-95',
        rememberMe: true,
      }),
    });
    expect(view.getState().login.phase).toBe('authenticated');
    expect(view.getState().login.operator?.roles).toEqual(['经办']);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
