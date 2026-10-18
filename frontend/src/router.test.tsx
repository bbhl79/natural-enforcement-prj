import { configureStore } from '@reduxjs/toolkit';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMemoryRouter, data, MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminHomeContent } from './admin/AdminHomePage';
import { adminHomeView, EMPTY_SUMMARY, firstDayPending, loadAdminHomeSummary } from './admin/adminHome';
import reducer, { loadSession } from './login/loginSlice';
import AppShell, { AppShellError } from './shell/AppShell';
import { errorStatus } from './shell/StatusPages';
import { renderRoute, renderRouter, settled } from './test-utils';

type Json = Record<string, unknown>;

function person(roles: string[], opcodes: string[], extra: Json = {}): Json {
  return { result: 'authenticated', name: '何静', code: 'TH0102', orgName: '天河区分局', roles, opcodes, ...extra };
}

const CLERK = ['clue.read', 'case.read', 'case.open'];
const ADMIN = [
  'org.tree.read', 'org.unit.register', 'org.unit.rename',
  'personnel.profile.read', 'personnel.locked.read', 'personnel.locked.release', 'audit.admin.read',
];
const TREE: [number, Json] = [200, { result: 'listed', rootId: 'hq', orgUnits: [{ id: 'hq' }, { id: 'a' }, { id: 'b' }] }];
/** 人员名单（#128）：首页人员数只数未停用的。 */
const PERSONNEL: [number, Json] = [200, {
  result: 'listed', rootId: 'hq', orgUnits: [],
  personnel: [{ id: 'p1', deactivatedAt: null }, { id: 'p2', deactivatedAt: null }, { id: 'p3', deactivatedAt: '2026-09-01T00:00:00Z' }],
}];
const SUPERVISE = ['audit.admin.read', 'audit.admin.export'];
const SUMMARY: [number, Json] = [200, { result: 'counted', today: 7 }];
const ADMIN_ROUTES: Record<string, [number, Json]> = {
  '/api/admin/locked-personnel': [200, { personnel: [] }],
  '/api/admin/audit/summary': SUMMARY,
};
/** 内勤：业务读码，外加选承办机构用的 org.tree.read（#105:178）。 */
const INTAKE = ['clue.read', 'case.read', 'org.tree.read'];

/** 按地址回答：会话查询返回 session，其余接口返回 routes 里登记的结果。 */
function serve(session: Json | number, routes: Record<string, [number, Json]> = {}) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', (url: string) => {
    calls.push(url);
    if (url === '/api/auth/session') {
      return Promise.resolve(typeof session === 'number'
        ? new Response('{}', { status: session })
        : new Response(JSON.stringify(session), { status: 200 }));
    }
    const [status, body] = routes[url] ?? (url === '/api/org-units' ? TREE : url === '/api/admin/personnel' ? PERSONNEL : [404, {}]);
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  });
  return calls;
}

const fresh = () => configureStore({ reducer: { login: reducer } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('路由守卫（#91 页面路径约定）', () => {
  it('未登录打开受保护页 → 登录页并记下原路径', async () => {
    serve({ result: 'anonymous' });
    const { router, html } = await renderRoute(fresh(), '/admin?tab=1');
    expect(router.state.location.pathname).toBe('/auth/login');
    expect(router.state.location.search).toBe('?next=%2Fadmin%3Ftab%3D1');
    expect(html).toContain('placeholder="手机号"');
    expect(html).not.toContain('class="sidenav"');
  });

  it('强制改密打开其他页 → 改口令页并记下原路径，显示 P2 forced 提示', async () => {
    serve({ result: 'password-change-required' });
    const { router, html } = await renderRoute(fresh(), '/admin/audit');
    expect(router.state.location.pathname).toBe('/auth/password');
    expect(router.state.location.search).toBe('?next=%2Fadmin%2Faudit');
    expect(html).toContain('必须改口令');
    expect(html).toContain('你要打开的页面需要先完成改口令。改好后会自动回到刚才的页面。');
    expect(html).not.toContain('class="sidenav"');
  });

  it('直接打开改口令页（没有 next）不显示「回到刚才的页面」提示', async () => {
    serve({ result: 'password-expired' });
    const { html } = await renderRoute(fresh(), '/auth/password');
    expect(html).toContain('口令已超过 90 天');
    expect(html).not.toContain('回到刚才的页面');
  });

  it('已登录打开登录页 → 回到 next', async () => {
    serve(person(['系统管理'], ADMIN), ADMIN_ROUTES);
    const { router } = await renderRoute(fresh(), '/auth/login?next=%2Fadmin');
    expect(router.state.location.pathname).toBe('/admin');
  });

  it.each([
    ['外站地址', 'https%3A%2F%2Fevil.example.com%2F'],
    ['双斜杠', '%2F%2Fevil.example.com'],
    ['认证页', '%2Fauth%2Fpassword'],
  ])('已登录且 next 不合规（%s）→ 首页', async (_label, next) => {
    serve(person(['经办'], CLERK));
    const { router } = await renderRoute(fresh(), `/auth/login?next=${next}`);
    expect(router.state.location.pathname).toBe('/');
  });

  it('会话查询失败：显示「暂时无法确认登录状态」，不改写地址', async () => {
    serve(502);
    const { router, html } = await renderRoute(fresh(), '/admin');
    expect(router.state.location.pathname).toBe('/admin');
    expect(html).toContain('暂时无法确认登录状态');
    expect(html).toContain('刷新');
    expect(html).not.toContain('HTTP');
  });

  it('未知路径在应用壳里显示 404', async () => {
    serve(person(['经办'], CLERK));
    const { html } = await renderRoute(fresh(), '/no/such/page');
    expect(html).toContain('data-http="404"');
    expect(html).toContain('没有找到这个页面');
    expect(html).toContain('class="sidenav"');
  });
});

describe('应用壳与菜单（P1）', () => {
  it('兼任：两区菜单并集，工作台提示不用换登录标识', async () => {
    serve(person(['经办', '系统管理'], [...CLERK, ...ADMIN]));
    const { html } = await renderRoute(fresh(), '/');
    expect(html).toContain('>业务办理</div>');
    expect(html).toContain('>管理台</div>');
    for (const label of ['工作台', '线索', '案件', '管理台首页', '机构', '人员', '被锁人员', '管理台留痕']) {
      expect(html).toContain(`<span class="dot"></span>${label}</a>`);
    }
    expect(html).toContain('你同时担任「经办」和「系统管理」');
    expect(html).toContain('天河区分局 · 经办、系统管理');
    expect(html).toContain('我的待办<span class="hint">业务区内容不在本样板范围，仅占位</span>');
    expect(html).toContain('业务工作台由线索、案件等切片提供');
    expect(html).not.toContain('暂无待办');
  });

  it('无管理权：没有管理台一区', async () => {
    serve(person(['经办'], CLERK));
    const { html } = await renderRoute(fresh(), '/');
    expect(html).not.toContain('>管理台</div>');
    expect(html).not.toContain('管理台首页');
    expect(html).toContain('你的角色不含管理权，所以没有「管理台」一区。');
  });

  it('内勤反例：持有 org.tree.read 也没有管理台一区（#105:178，P1 noadmin）', async () => {
    serve(person(['内勤'], INTAKE));
    const { html } = await renderRoute(fresh(), '/');
    expect(html).not.toContain('>管理台</div>');
    expect(html).not.toContain('管理台首页');
    expect(html).not.toContain('data-menu="org"');
    expect(html).toContain('你的角色不含管理权，所以没有「管理台」一区。');
  });

  it('只有管理码：打开首页直接进管理台首页', async () => {
    serve(person(['系统管理'], ADMIN), ADMIN_ROUTES);
    const { router, html } = await renderRoute(fresh(), '/');
    expect(router.state.location.pathname).toBe('/admin');
    expect(html).not.toContain('>业务办理</div>');
    expect(html).toContain('nav-item active" data-menu="admin"');
  });

  it('距口令到期 ≤7 天显示横幅', async () => {
    serve(person(['经办'], CLERK, { daysRemaining: 3 }));
    const { html } = await renderRoute(fresh(), '/');
    expect(html).toContain('口令还剩 3 天到期');
    expect(html).toContain('关闭');
  });

  it('会话已结束：提示后去登录，带回原路径', async () => {
    serve(person(['经办'], CLERK));
    const store = fresh();
    await store.dispatch(loadSession());
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('{}', { status: 401 })));
    const { apiFetch } = await import('./api');
    await apiFetch(store.dispatch, '/api/admin/locked-personnel');
    const { html, router } = await renderRoute(store, '/admin/audit');
    expect(router.state.location.pathname).toBe('/admin/audit');
    expect(html).toContain('会话已结束');
    expect(html).toContain('href="/auth/login?next=%2Fadmin%2Faudit"');
  });
});

describe('管理台首页（P3）', () => {
  it('无管理台入口码：显示无权限卡片', async () => {
    serve(person(['经办'], CLERK));
    const { html } = await renderRoute(fresh(), '/admin');
    expect(html).toContain('你没有查看管理台的权限');
    expect(html).not.toContain('class="tiles"');
  });

  it('内勤反例：持有 org.tree.read 打开 /admin 显示无权限卡片', async () => {
    serve(person(['内勤'], INTAKE));
    const { html, router } = await renderRoute(fresh(), '/admin');
    expect(router.state.location.pathname).toBe('/admin');
    expect(html).toContain('你没有查看管理台的权限');
    expect(html).not.toContain('class="tiles"');
    expect(html).not.toContain('>管理台</div>');
  });

  it('首屏先出骨架', async () => {
    let release!: (response: Response) => void;
    serve(person(['系统管理'], ADMIN));
    const original = globalThis.fetch;
    vi.stubGlobal('fetch', (url: string) => (url === '/api/admin/locked-personnel'
      ? new Promise<Response>((resolve) => { release = resolve; })
      : original(url)));
    const { html } = await renderRoute(fresh(), '/admin');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('维护机构、人员和执法证，处理被锁人员，查阅管理台留痕。范围限于你任职机构及其下级。');
    release(new Response(JSON.stringify({ personnel: [] }), { status: 200 }));
  });

  it('视角：维护码 → 系统管理；只有留痕码 → 监督；都没有 → 无权限', () => {
    expect(adminHomeView(ADMIN)).toBe('admin');
    expect(adminHomeView(['personnel.locked.read'])).toBe('admin');
    expect(adminHomeView(SUPERVISE)).toBe('supervise');
    expect(adminHomeView(CLERK)).toBe('denied');
    expect(adminHomeView(INTAKE)).toBe('denied');
  });

  const render = (opcodes: string[], summary = EMPTY_SUMMARY) => renderToStaticMarkup(
    <MemoryRouter><AdminHomeContent opcodes={opcodes} summary={summary} /></MemoryRouter>,
  );

  it('监督只看到留痕入口和说明', () => {
    const html = render(SUPERVISE);
    expect(html).toContain('管理台留痕');
    expect(html).toContain('谁在什么时候做了哪些维护，结果如何');
    expect(html).toContain('监督只查阅留痕，不能打开人员名单和人员详情，也不能导出人员资料。');
    expect(html).not.toContain('被锁人员');
    expect(html).not.toContain('还不能开始核查和立案');
  });

  it('系统管理按码出入口，数字未知时不显示数字', () => {
    const html = render(ADMIN, { ...EMPTY_SUMMARY, lockedPersonnel: 2 });
    for (const title of ['机构', '人员', '被锁人员', '管理台留痕']) expect(html).toContain(`<div class="t">${title}</div>`);
    expect(html).toContain('<div class="n">2 人</div>');
    expect(html.match(/class="n"/g)).toHaveLength(1);
    expect(html).toContain('data-slot="cert-attention"');
    expect(html).toContain('后续开放');
    expect(html).not.toContain('还不能开始核查和立案');
  });

  it('上线首日：只有一个机构、只有本人、无人登记执法证时显示三步引导', () => {
    const firstDay = { ...EMPTY_SUMMARY, orgUnits: 1, personnel: 1, certifiedPersonnel: 0 };
    expect(firstDayPending(firstDay)).toBe(true);
    expect(firstDayPending(EMPTY_SUMMARY)).toBe(false);
    expect(firstDayPending({ ...firstDay, personnel: 2 })).toBe(false);
    expect(firstDayPending({ ...firstDay, certifiedPersonnel: null })).toBe(false);
    const html = render(ADMIN, firstDay);
    expect(html).toContain('还不能开始核查和立案');
    expect(html).toContain('① 在「机构」里建区分局和所；② 在「人员」里建人员并分配角色；③ 为经办人员登记执法证。');
    expect(html).not.toContain('后续开放');
  });

  it('取数：被锁人员数来自被锁人员接口，人员数来自人员名单（不数已停用），今日留痕来自留痕条数接口（GET）；403 交给无权限页', async () => {
    const store = fresh();
    const calls = serve(person(['系统管理'], ADMIN), {
      '/api/admin/locked-personnel': [200, { result: 'listed', personnel: [{}, {}] }],
      '/api/admin/audit/summary': SUMMARY,
    });
    await store.dispatch(loadSession());
    // 系统管理：机构数、人员数、被锁人员数、今日留痕条数四项都取
    expect(await loadAdminHomeSummary(store.dispatch, ADMIN)).toEqual({
      ...EMPTY_SUMMARY, orgUnits: 3, personnel: 2, lockedPersonnel: 2, auditToday: 7,
    });
    // 只有树读码（内勤）不取机构数：机构入口按维护码出现
    expect((await loadAdminHomeSummary(store.dispatch, ['org.tree.read', 'personnel.locked.read'])).orgUnits).toBeNull();
    expect(await loadAdminHomeSummary(store.dispatch, SUPERVISE)).toEqual({ ...EMPTY_SUMMARY, auditToday: 7 });
    expect(await loadAdminHomeSummary(store.dispatch, ['personnel.locked.read'])).toEqual({ ...EMPTY_SUMMARY, lockedPersonnel: 2 });
    expect(calls.filter((url) => url === '/api/admin/audit/summary')).toHaveLength(2);
    serve(person(['系统管理'], ADMIN), { '/api/admin/locked-personnel': [403, { reason: 'permission-denied' }] });
    await expect(loadAdminHomeSummary(store.dispatch, ADMIN)).rejects.toMatchObject({ init: { status: 403 } });
    serve(person(['监督'], SUPERVISE), { '/api/admin/audit/summary': [403, { reason: 'permission-denied' }] });
    await expect(loadAdminHomeSummary(store.dispatch, SUPERVISE)).rejects.toMatchObject({ init: { status: 403 } });
  });

  it('留痕入口显示今日条数', () => {
    const html = render(SUPERVISE, { ...EMPTY_SUMMARY, auditToday: 12 });
    expect(html).toContain('<div class="n">今日 12 条</div>');
  });

  it('无权限页：左侧导航没有任何项高亮（原型 P2-forbidden、P3-denied）', async () => {
    // 经办打开 /admin：管理台首页对本人不可见，出无权限卡片。
    serve(person(['经办'], CLERK));
    const denied = await renderRoute(fresh(), '/admin');
    expect(denied.html).toContain('你没有查看管理台的权限');
    expect(denied.html).toContain('data-menu="home"');
    expect(denied.html).not.toContain('nav-item active');

    // 管理台首页对本人可见，但页面取数 403 → 壳内整页无权限页（P2 forbidden），左导同样不高亮。
    const store = fresh();
    serve(person(['经办', '系统管理'], [...CLERK, ...ADMIN]));
    await store.dispatch(loadSession());
    const router = createMemoryRouter([{
      element: <AppShell />,
      errorElement: <AppShellError />,
      children: [{ path: 'admin', loader: () => { throw data(null, { status: 403 }); }, element: null }],
    }], { initialEntries: ['/admin'] });
    await settled(router);
    const forbidden = renderRouter(store, router);
    expect(forbidden).toContain('你没有权限打开这个页面');
    expect(forbidden).toContain('data-menu="admin"');
    expect(forbidden).not.toContain('nav-item active');
  });

  it('延迟数据里拒绝的 403 与 loader 抛出的 403 都被认作无权限', () => {
    expect(errorStatus(data(null, { status: 403 }))).toBe(403);
    expect(errorStatus(new Error('x'))).toBeNull();
    expect(errorStatus(null)).toBeNull();
  });
});
