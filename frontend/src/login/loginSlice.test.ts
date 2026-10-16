import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { afterEach, describe, expect, it, vi } from 'vitest';

import healthReducer from '../health/healthSlice';
import { AuthShell } from '../App';
import LoginPage from './LoginPage';
import reducer, {
  forgotPassword,
  loadSession,
  loginSubmitEnabled,
  logout,
  setPassword,
  setPhone,
  submitLogin,
  toggleRemember,
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

  it('上次改密时间为空时显示必须改口令，不提供改口令页', () => {
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
    expect(blocked.operator).toBeNull();
    const view = configureStore({
      reducer: { login: reducer, health: healthReducer },
      preloadedState: { login: blocked },
    });
    const html = renderToStaticMarkup(
      createElement(Provider, { store: view, children: createElement(AuthShell) }),
    );
    expect(html).toContain('必须改口令');
    expect(html).not.toContain('新口令');
    expect(html).not.toContain('placeholder="密码"');
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
