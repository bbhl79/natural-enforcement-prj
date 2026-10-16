import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { describe, expect, it } from 'vitest';

import LoginPage from './LoginPage';
import reducer, {
  forgotPassword,
  loginSubmitEnabled,
  setPassword,
  setPhone,
  submitLogin,
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

  it('点登录不建立会话', () => {
    const ready = reducer(
      reducer(undefined, setPhone('13800138000')),
      setPassword('correct-horse'),
    );
    const submitted = reducer(ready, submitLogin());
    expect(submitted.session).toBeNull();
    expect(submitted.screen).toBe('default');
  });
});
