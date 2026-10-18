import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { afterEach, describe, expect, it, vi } from 'vitest';

import LoginPage from './LoginPage';
import reducer, {
  acknowledgeSessionEnd,
  dismissExpiryNotice,
  enterPasswordChange,
  expiryNoticeVisible,
  forgotPassword,
  loadSession,
  loginSubmitEnabled,
  logout,
  PASSWORD_CONCURRENT_TEXT,
  PASSWORD_HISTORY_HINT,
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
import { apiFetch } from '../api';
import { renderRoute } from '../test-utils';

function loginHtml(): string {
  return renderToStaticMarkup(
    createElement(Provider, { store, children: createElement(LoginPage) }),
  );
}

/** 渲染强制改密页（P2）：把状态塞进 store 后按 /auth/password 出 HTML。 */
async function passwordPageHtml(state: LoginState): Promise<string> {
  const view = configureStore({
    reducer: { login: reducer },
    preloadedState: {
      login: { ...state, phase: 'password-change-required' as const, passwordChangeKind: 'first-login' as const },
    },
  });
  const { html } = await renderRoute(view, '/auth/password');
  return html;
}

/** 强制改密被拒后的状态：只给拒绝原因，其余字段取初值。 */
function passwordRejected(failure: PasswordFailureForTest): LoginState {
  return reducer(reducer(undefined, setCurrentPassword('Old-pass-97!')), submitPassword.rejected(
    new Error('rejected'),
    'req-rejected',
    undefined,
    failure,
  ));
}

type PasswordFailureForTest =
  | { result: 'non-compliant'; rules: string[] }
  | { result: 'concurrent-change' };

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
    const view = configureStore({ reducer: { login: reducer } });
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
    const view = configureStore({ reducer: { login: reducer } });
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
      reducer: { login: reducer },
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
      reducer: { login: reducer },
      preloadedState: { login: failed },
    });
    const html = renderToStaticMarkup(
      createElement(Provider, { store: view, children: createElement(LoginPage) }),
    );
    expect(html).toContain('账号或口令不正确。如需帮助，请联系本单位管理员。');
  });

  it('满员时提示稍后再试，不显示口令错误', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ result: 'capacity-reached' }), { status: 503 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const view = configureStore({ reducer: { login: reducer } });
    view.dispatch(setPhone('13800009501'));
    view.dispatch(setPassword('Correct-horse-95'));
    await view.dispatch(submitLogin());
    expect(view.getState().login.phase).toBe('anonymous');
    const html = renderToStaticMarkup(
      createElement(Provider, { store: view, children: createElement(LoginPage) }),
    );
    expect(html).toContain('稍后再试');
    expect(html).not.toContain('账号或口令不正确。如需帮助，请联系本单位管理员。');
    expect(html).not.toMatch(/placeholder="手机号"[^>]*disabled/);
  });

  it('首次登录进入改口令页，完成前不显示系统功能', async () => {
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
      reducer: { login: reducer },
      preloadedState: { login: blocked },
    });
    const { html } = await renderRoute(view, '/auth/password');
    expect(html).toContain('必须改口令');
    expect(html).toContain('首次登录必须更换初始口令');
    expect(html).toContain('placeholder="当前口令"');
    expect(html).toContain('placeholder="新口令"');
    expect(html).not.toContain('class="sidenav"');
    expect(html).not.toContain('placeholder="手机号"');
  });

  it('口令超过 90 天时说明必须更换', async () => {
    const blocked = reducer(
      undefined,
      submitLogin.rejected(new Error('rejected'), 'req-expired', undefined, { result: 'password-expired' }),
    );
    expect(blocked.passwordChangeKind).toBe('expired');
    const view = configureStore({
      reducer: { login: reducer },
      preloadedState: { login: blocked },
    });
    const { html } = await renderRoute(view, '/auth/password');
    expect(html).toContain('口令已超过 90 天，必须更换口令');
  });

  it('规则码一次显示为全部中文提示', async () => {
    const withRules = passwordRejected({
      result: 'non-compliant',
      rules: ['too-short', 'insufficient-classes', 'sequential', 'repeated', 'common', 'contains-code', 'same-as-current', 'too-long'],
    });
    const html = await passwordPageHtml(withRules);
    for (const code of withRules.ruleCodes) {
      expect(html).toContain(PASSWORD_RULE_TEXT[code]);
    }
    // reused 走单句拒绝提示，不与可公开规则一起列（#132）。
    expect(withRules.ruleCodes).not.toContain('reused');
    expect(html).not.toContain(PASSWORD_RULE_TEXT.reused);
  });

  it('没有拒绝提示时，新口令框下常驻一句口令历史提示（原型 v0.4 P2，#132）', async () => {
    const html = await passwordPageHtml(reducer(undefined, setCurrentPassword('Old-pass-97!')));
    expect(html).toContain(`<div class="help" style="margin-bottom:12px">${PASSWORD_HISTORY_HINT}</div>`);
    expect(html).toContain('不能与最近 5 次使用过的口令相同。');
    expect(html).not.toContain('class="err"');
  });

  it('新口令命中历史（P2 forcedReused，#132）：只出单句拒绝提示，写明原因，不说明第几次', async () => {
    const state = passwordRejected({ result: 'non-compliant', rules: ['reused'] });
    expect(state.ruleCodes).toEqual(['reused']);
    expect(state.concurrentChangeRejected).toBe(false);
    const html = await passwordPageHtml(state);
    expect(html).toContain(`<div class="err" data-reason="password-reused" style="margin-bottom:12px">${PASSWORD_RULE_TEXT.reused}</div>`);
    expect(html).toContain('新口令不能与你最近 5 次使用过的口令相同，请换一个。');
    // 单句替换常驻提示与规则清单，不并列出现。
    expect(html).not.toContain(PASSWORD_HISTORY_HINT);
    expect(html).not.toContain('<ul class="err"');
    // 本人侧写明原因，但不说明命中的是第几次，也不露规则码。
    expect(html).not.toContain('第 ');
    expect(html.replace(/<[^>]*>/g, ' ')).not.toMatch(/reused|non-compliant|unavailable/);
  });

  it('并发改密被拒（409 concurrent-change，#132）：出红色横幅，不出规则清单', async () => {
    const state = passwordRejected({ result: 'concurrent-change' });
    expect(state.concurrentChangeRejected).toBe(true);
    expect(state.ruleCodes).toEqual([]);
    expect(state.currentPasswordRejected).toBe(false);
    const html = await passwordPageHtml(state);
    expect(html).toContain(`<div class="banner danger" role="status" data-reason="concurrent-change">${PASSWORD_CONCURRENT_TEXT}</div>`);
    expect(html).toContain('口令刚被另一次操作修改，本次修改没有生效。请重新填写后再试。');
    expect(html).not.toContain('当前口令不正确。');
    expect(html).not.toContain('<ul class="err"');
    // 规则提示清空后，新口令框下回到常驻的历史规则提示。
    expect(html).toContain(PASSWORD_HISTORY_HINT);
    expect(html.replace(/<[^>]*>/g, ' ')).not.toMatch(/concurrent-change|409/);
  });

  it('并发横幅在重新填写任一口令后消失', () => {
    const state = passwordRejected({ result: 'concurrent-change' });
    expect(reducer(state, setNewPassword('New-pass-98!')).concurrentChangeRejected).toBe(false);
    expect(reducer(state, setCurrentPassword('Old-pass-98!')).concurrentChangeRejected).toBe(false);
  });

  it('改口令接口回 409 concurrent-change 时判为并发冲突，不当成当前口令不正确', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ result: 'concurrent-change' }), { status: 409 }),
    ));
    const view = configureStore({ reducer: { login: reducer } });
    view.dispatch(setCurrentPassword('Old-pass-97!'));
    view.dispatch(setNewPassword('New-pass-97!'));
    await view.dispatch(submitPassword());
    const state = view.getState().login;
    expect(state.concurrentChangeRejected).toBe(true);
    expect(state.currentPasswordRejected).toBe(false);
    expect(state.screen).toBe('default');
  });

  it('距到期 7 天显示提醒，关闭后同一会话不再出现，第 8 天不出现', async () => {
    const entered = reducer(
      undefined,
      submitLogin.fulfilled(
        { name: '丁经办', code: 'P-95-OK', orgName: '第一执法支队', roles: ['经办'], opcodes: [], daysRemaining: 7 },
        'req-banner',
        undefined,
      ),
    );
    expect(expiryNoticeVisible(entered)).toBe(true);
    const view = configureStore({
      reducer: { login: reducer },
      preloadedState: { login: entered },
    });
    const { html: shown } = await renderRoute(view, '/');
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
      }, 'req-reload', undefined),
    );
    expect(expiryNoticeVisible(reloaded)).toBe(false);
    const hidden = configureStore({
      reducer: { login: reducer },
      preloadedState: { login: reloaded },
    });
    const { html: after } = await renderRoute(hidden, '/');
    expect(after).not.toContain('口令还剩');
    const eighth = reducer(
      undefined,
      submitLogin.fulfilled(
        { name: '丁经办', code: 'P-95-OK', orgName: '第一执法支队', roles: ['经办'], opcodes: [], daysRemaining: 8 },
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

  it('其他请求返回 403：强制改密进入改口令；其他 403 重新拉一次会话', async () => {
    const responses = [
      new Response(JSON.stringify({ reason: 'permission-denied' }), { status: 403 }),
      new Response(JSON.stringify({ result: 'password-expired' }), { status: 403 }),
      new Response(JSON.stringify({ result: 'password-change-required' }), { status: 403 }),
    ];
    const calls: string[] = [];
    vi.stubGlobal('fetch', (url: string) => {
      calls.push(url);
      if (url === '/api/auth/session') {
        return Promise.resolve(new Response(JSON.stringify({
          result: 'authenticated', name: '丁经办', code: 'P-95-OK', orgName: '第一执法支队', roles: ['经办'], opcodes: [],
        }), { status: 200 }));
      }
      return Promise.resolve(responses.shift()!);
    });
    const view = configureStore({ reducer: { login: reducer } });
    await view.dispatch(loadSession());
    await apiFetch(view.dispatch, '/api/admin/locked-personnel');
    expect(calls).toEqual(['/api/auth/session', '/api/admin/locked-personnel', '/api/auth/session']);
    expect(view.getState().login.phase).toBe('authenticated');
    await apiFetch(view.dispatch, '/api/admin/locked-personnel');
    expect(view.getState().login.phase).toBe('password-change-required');
    expect(view.getState().login.passwordChangeKind).toBe('expired');
    await apiFetch(view.dispatch, '/api/admin/locked-personnel');
    expect(view.getState().login.passwordChangeKind).toBe('first-login');
    expect(calls.filter((url) => url === '/api/auth/session')).toHaveLength(2);
  });

  it('重新拉会话失败时保持现状，启动查询失败时进入「暂时无法确认登录状态」', async () => {
    let healthy = true;
    vi.stubGlobal('fetch', () => Promise.resolve(healthy
      ? new Response(JSON.stringify({
        result: 'authenticated', name: '丁经办', code: 'P-95-OK', orgName: '第一执法支队', roles: ['经办'], opcodes: ['clue.read'],
      }), { status: 200 })
      : new Response(JSON.stringify({}), { status: 502 })));
    const view = configureStore({ reducer: { login: reducer } });
    await view.dispatch(loadSession());
    healthy = false;
    await view.dispatch(loadSession({ refresh: true }));
    expect(view.getState().login.phase).toBe('authenticated');
    expect(view.getState().login.operator?.opcodes).toEqual(['clue.read']);
    const fresh = configureStore({ reducer: { login: reducer } });
    await fresh.dispatch(loadSession());
    expect(fresh.getState().login.phase).toBe('error');
  });

  it('改口令返回锁定时显示锁定文案并禁用表单', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ result: 'locked' }), { status: 401 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const view = configureStore({ reducer: { login: reducer } });
    view.dispatch(enterPasswordChange('first-login'));
    view.dispatch(setCurrentPassword('Old-pass-97!'));
    view.dispatch(setNewPassword('New-pass-97!'));
    await view.dispatch(submitPassword());
    expect(view.getState().login.screen).toBe('locked');
    const { html } = await renderRoute(view, '/auth/password');
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
    const view = configureStore({ reducer: { login: reducer } });
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

  it('已登录顶栏显示姓名、机构、角色和退出，不显示工号', async () => {
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
          opcodes: ['clue.read'],
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
      opcodes: ['clue.read'],
    });
    const view = configureStore({
      reducer: { login: reducer },
      preloadedState: { login: entered },
    });
    const { html } = await renderRoute(view, '/');
    expect(html).toContain('丁经办');
    expect(html).toContain('第一执法支队');
    expect(html).toContain('>退出</button>');
    expect(html).not.toContain('P-95-OK');
    // 原型 v0.4 P1：顶栏显示姓名·机构·角色。
    expect(html).toContain('第一执法支队 · 监督、经办');
    expect(entered.operator?.code).toBe('P-95-OK');
    expect(entered.operator?.roles).toEqual(['监督', '经办']);
    // #80：一期不展示连通状态。
    expect(html).not.toContain('健康');
    const left = reducer(entered, logout.fulfilled(undefined, 'req-4'));
    expect(left.phase).toBe('anonymous');
    expect(left.operator).toBeNull();
  });

  it('未登录显示登录页', async () => {
    const anonymous = reducer(undefined, loadSession.fulfilled({ result: 'anonymous' }, 'req-5', undefined));
    const view = configureStore({
      reducer: { login: reducer },
      preloadedState: { login: anonymous },
    });
    const { html } = await renderRoute(view, '/auth/login');
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
    const view = configureStore({ reducer: { login: reducer } });
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

  it('启动时先等会话查询返回，再发其他请求，且不轮询', async () => {
    let release!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const calls: string[] = [];
    vi.stubGlobal('fetch', (url: string) => {
      calls.push(url);
      if (url === '/api/auth/session') return pending;
      return Promise.resolve(new Response(JSON.stringify({ personnel: [] }), { status: 200 }));
    });
    // 启动闸门是模块级的一次性状态，这里用全新模块模拟一次冷启动。
    vi.resetModules();
    const fresh = await import('./loginSlice');
    const { apiFetch: freshFetch } = await import('../api');
    const view = configureStore({ reducer: { login: fresh.default } });
    const boot = view.dispatch(fresh.loadSession());
    const other = freshFetch(view.dispatch, '/api/admin/locked-personnel');
    await Promise.resolve();
    expect(calls).toEqual(['/api/auth/session']);
    release(new Response(JSON.stringify({ result: 'anonymous' }), { status: 200 }));
    await boot;
    await other;
    expect(calls).toEqual(['/api/auth/session', '/api/admin/locked-personnel']);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls.filter((url) => url === '/api/auth/session')).toHaveLength(1);
  });

  it('已登录时其他请求返回 401：会话已结束，看过提示后去登录页', async () => {
    vi.stubGlobal('fetch', (url: string) => {
      if (url === '/api/admin/locked-personnel') {
        return Promise.resolve(new Response(JSON.stringify({ reason: 'not-authenticated' }), { status: 401 }));
      }
      return Promise.resolve(new Response(JSON.stringify({
        result: 'authenticated', name: '丁经办', code: 'P-95-OK', orgName: '第一执法支队', roles: ['经办'], opcodes: [],
      }), { status: 200 }));
    });
    const view = configureStore({ reducer: { login: reducer } });
    await view.dispatch(loadSession());
    await apiFetch(view.dispatch, '/api/admin/locked-personnel');
    expect(view.getState().login.phase).toBe('expired');
    expect(view.getState().login.operator).toBeNull();
    view.dispatch(acknowledgeSessionEnd());
    expect(view.getState().login.phase).toBe('anonymous');
    expect(view.getState().login.explicitLogout).toBe(false);
  });

  it('会话查询带回本人允许的操作码清单；退出后清空并标记主动退出', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(JSON.stringify({
      result: 'authenticated', name: '何静', code: 'TH0102', orgName: '天河区分局', roles: ['经办', '系统管理'],
      opcodes: ['clue.read', 'personnel.locked.read'],
    }), { status: 200 })));
    const view = configureStore({ reducer: { login: reducer } });
    await view.dispatch(loadSession());
    expect(view.getState().login.operator?.opcodes).toEqual(['clue.read', 'personnel.locked.read']);
    await view.dispatch(logout());
    expect(view.getState().login.operator).toBeNull();
    expect(view.getState().login.explicitLogout).toBe(true);
  });

  it('退出后迟到的会话刷新结果被丢弃，不会恢复登录态', async () => {
    const authenticated = () => new Response(JSON.stringify({
      result: 'authenticated', name: '丁经办', code: 'P-95-OK', orgName: '第一执法支队', roles: ['经办'], opcodes: ['clue.read'],
    }), { status: 200 });
    let release!: (response: Response) => void;
    let calls = 0;
    vi.stubGlobal('fetch', (url: string) => {
      if (url === '/api/auth/logout') return Promise.resolve(new Response('{}', { status: 200 }));
      calls += 1;
      if (calls === 1) return Promise.resolve(authenticated());
      return new Promise<Response>((resolve) => { release = resolve; });
    });
    const view = configureStore({ reducer: { login: reducer } });
    await view.dispatch(loadSession());
    const refresh = view.dispatch(loadSession({ refresh: true }));
    await view.dispatch(logout());
    release(authenticated());
    await refresh;
    expect(view.getState().login.phase).toBe('anonymous');
    expect(view.getState().login.operator).toBeNull();
    expect(view.getState().login.explicitLogout).toBe(true);
  });

  it('两次会话刷新乱序返回时只采用后发的那次', async () => {
    const pending: Array<(response: Response) => void> = [];
    vi.stubGlobal('fetch', () => new Promise<Response>((resolve) => { pending.push(resolve); }));
    const view = configureStore({ reducer: { login: reducer } });
    const first = view.dispatch(loadSession({ refresh: true }));
    const second = view.dispatch(loadSession({ refresh: true }));
    const body = (opcodes: string[]) => new Response(JSON.stringify({
      result: 'authenticated', name: '丁经办', code: 'P-95-OK', orgName: '第一执法支队', roles: ['经办'], opcodes,
    }), { status: 200 });
    pending[1](body(['case.read']));
    await second;
    pending[0](body(['clue.read', 'audit.admin.read']));
    await first;
    expect(view.getState().login.operator?.opcodes).toEqual(['case.read']);
  });

  it('到期横幅的关闭记录跟着会话走：同一会话不再出现，换了会话（如记住我新建）重新出现', () => {
    const view = (tag: string) => loadSession.fulfilled({
      result: 'authenticated', name: '丁经办', code: 'P-95-OK', orgName: '第一执法支队', roles: ['经办'],
      opcodes: [], daysRemaining: 5, noticeTag: tag,
    }, `req-${tag}`, undefined);
    const first = reducer(undefined, view('aaaaaaaaaaaaaaaa'));
    expect(first.noticeTag).toBe('aaaaaaaaaaaaaaaa');
    expect(expiryNoticeVisible(first)).toBe(true);
    const closed = reducer(first, dismissExpiryNotice());
    expect(expiryNoticeVisible(reducer(closed, view('aaaaaaaaaaaaaaaa')))).toBe(false);
    expect(expiryNoticeVisible(reducer(closed, view('bbbbbbbbbbbbbbbb')))).toBe(true);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
