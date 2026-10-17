import { configureStore } from '@reduxjs/toolkit';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import reducer, { loadSession } from '../login/loginSlice';
import type { RouterStore } from '../router';
import { renderRoute, renderRouter } from '../test-utils';
import { AuditContent, type AuditContentProps, type ExportState } from './AuditPage';
import {
  defaultRange,
  exportAudit,
  filenameFromDisposition,
  filterFromSearch,
  filterSummary,
  loadAuditList,
  type AuditFilter,
  type AuditRow,
} from './audit';

type Json = Record<string, unknown>;
type Call = { url: string; method: string; body: Json | null };

const ADMIN = ['org.unit.register', 'personnel.profile.read', 'personnel.locked.read', 'audit.admin.read', 'audit.admin.export'];
const SUPERVISE = ['audit.admin.read', 'audit.admin.export'];
const CLERK = ['clue.read', 'case.read'];
/** 内勤：只有选承办机构用的 org.tree.read，不是进管理台的码。 */
const INTAKE = ['clue.read', 'case.read', 'org.tree.read'];
const NOW = Date.parse('2026-10-17T02:00:00.000Z');

function person(roles: string[], opcodes: string[], orgName = '海珠区分局'): Json {
  return { result: 'authenticated', name: '何静', code: 'HZ0101', orgName, roles, opcodes };
}

function row(id: string, extra: Partial<AuditRow> = {}): AuditRow {
  return {
    id,
    action: 'account.unlocked',
    time: '2026-10-17 09:48',
    actorCode: 'TH0102',
    operation: '解锁',
    object: '人员 TH0331',
    orgName: '龙洞自然资源所',
    anchored: true,
    result: '成功',
    tone: 'ok',
    ...extra,
  };
}

function listed(rows: AuditRow[], scope = { orgUnitId: 'O1', orgName: '海珠区分局', includesUnanchored: false }): [number, Json] {
  return [200, { result: 'listed', scope, filter: {}, total: rows.length, rows }];
}

/** 会话查询返回 session；其余接口按地址取 routes 里的结果，并记下方法与请求体。 */
function serve(session: Json, routes: Record<string, [number, Json] | Promise<Response>> = {}): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: typeof init.body === 'string' ? JSON.parse(init.body) as Json : null });
    if (url === '/api/auth/session') return Promise.resolve(new Response(JSON.stringify(session), { status: 200 }));
    const hit = routes[url];
    if (hit instanceof Promise) return hit;
    const [status, body] = hit ?? [404, {}];
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  });
  return calls;
}

const fresh = () => configureStore({ reducer: { login: reducer } });

/**
 * 跑完 loader 后渲染两遍：静态渲染里 Await 第一次只登记延迟数据并出骨架，
 * 数据落定后第二遍才渲染内容（与浏览器里 Suspense 落定后重绘一致）。
 */
async function renderSettled(path: string): Promise<{ html: string; first: string }> {
  const store = fresh();
  const { html: first, router } = await renderRoute(store as RouterStore, path);
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  return { html: renderRouter(store as RouterStore, router), first };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('筛选条件', () => {
  it('默认昨天至今天（北京时间）；查询串拆成起止日、类别、工号、结果', () => {
    expect(defaultRange(NOW)).toEqual({ from: '2026-10-16', to: '2026-10-17' });
    expect(defaultRange(Date.parse('2026-10-16T16:30:00.000Z'))).toEqual({ from: '2026-10-16', to: '2026-10-17' });
    expect(filterFromSearch(new URLSearchParams(''), NOW)).toEqual({
      from: '2026-10-16', to: '2026-10-17', category: null, actorCode: null, outcome: null,
    });
    expect(filterFromSearch(new URLSearchParams('range=2026-10-01+至+2026-10-15&category=auth-session&actor=+TH0102+&outcome=failed'), NOW))
      .toEqual({ from: '2026-10-01', to: '2026-10-15', category: 'auth-session', actorCode: 'TH0102', outcome: 'failed' });
    // 格式不对时原样交服务端，由服务端判定不合规
    expect(filterFromSearch(new URLSearchParams('range=上周'), NOW)).toMatchObject({ from: '上周', to: '?' });
    // 下拉之外的类别、结果不带给服务端
    expect(filterFromSearch(new URLSearchParams('category=bogus&outcome=maybe'), NOW)).toMatchObject({ category: null, outcome: null });
  });

  it('确认框的筛选说明与导出文件名', () => {
    const filter: AuditFilter = { from: '2026-10-16', to: '2026-10-17', category: null, actorCode: null, outcome: null };
    expect(filterSummary(filter)).toBe('全部操作');
    expect(filterSummary({ ...filter, category: 'unlock-reset', actorCode: 'TH0102', outcome: 'failed' }))
      .toBe('解锁与重设口令；操作人工号 TH0102；结果：失败或被拒绝');
    expect(filenameFromDisposition(
      `attachment; filename="audit.xlsx"; filename*=UTF-8''${encodeURIComponent('管理台留痕_20261016-20261017.xlsx')}`,
      'x',
    )).toBe('管理台留痕_20261016-20261017.xlsx');
    expect(filenameFromDisposition(null, '兜底.xlsx')).toBe('兜底.xlsx');
  });
});

describe('管理台留痕页（P8）', () => {
  it('系统管理：按查询串 POST 查阅；表格、无所属机构标记与说明、导出按钮', async () => {
    const calls = serve(person(['系统管理'], ADMIN, '广州市规划和自然资源局'), {
      '/api/admin/audit/query': listed([
        row('A'),
        row('B', { action: 'authz.denied', actorCode: 'HZ0101', result: '被拒绝：超出数据范围', tone: 'red' }),
        row('C', { action: 'session.ended', operation: '结束会话', result: '空闲超过 30 分钟', tone: 'gray' }),
        row('D', { action: 'login.failed', actorCode: '—', operation: '登录', object: '未对上人员', orgName: '无所属机构', anchored: false, result: '失败：未对上人员', tone: 'red' }),
      ], { orgUnitId: 'HQ', orgName: '广州市规划和自然资源局', includesUnanchored: true }),
    });
    const { html } = await renderSettled('/admin/audit?range=2026-10-16+至+2026-10-17');
    const query = calls.find((call) => call.url === '/api/admin/audit/query');
    expect(query).toEqual({
      url: '/api/admin/audit/query',
      method: 'POST',
      body: { from: '2026-10-16', to: '2026-10-17', category: null, actorCode: null, outcome: null },
    });
    expect(html).toContain('管理台 / <b>管理台留痕</b>');
    expect(html).toContain('你任职机构及其下级范围内的机构维护、人员维护、执法证、解锁与重设口令、导出等记录。');
    expect(html).toContain('data-requires="audit.admin.export"');
    expect(html).toContain('value="2026-10-16 至 2026-10-17"');
    expect(html).toContain('共 4 条');
    expect(html).toContain('<tr data-action="account.unlocked"><td>2026-10-17 09:48</td><td class="mono">TH0102</td><td>解锁</td><td>人员 TH0331</td><td>龙洞自然资源所</td><td><span class="tag">成功</span></td></tr>');
    expect(html).toContain('<span class="tag red">被拒绝：超出数据范围</span>');
    expect(html).toContain('<span class="tag gray">空闲超过 30 分钟</span>');
    expect(html).toContain('<td><span class="tag gray">无所属机构</span></td>');
    expect(html).toContain('标有「无所属机构」的记录，对象不属于任何机构（例如没有任职的人员）。');
    expect(html).toContain('留痕写入后不能更改。只写工号，不写手机号和执法证号。');
    expect(html).not.toContain('你任职在');
    expect(html).not.toContain('class="mask"');
    expect(html.match(/<tr data-action=/g)).toHaveLength(4);
  });

  it('区监督：说明与范围横幅带任职机构；不出无所属机构说明', async () => {
    serve(person(['监督'], SUPERVISE), { '/api/admin/audit/query': listed([row('A')]) });
    const { html } = await renderSettled('/admin/audit');
    expect(html).toContain('海珠区分局及其下级范围内的管理台留痕。按被操作对象所属机构筛选。');
    expect(html).toContain('你任职在海珠区分局，只能看到对象属于海珠区分局及其下级的记录。不属于任何机构的记录（如全市共用的配置类对象，例如工作日历）只有市局任职的人员能看到。');
    expect(html).not.toContain('标有「无所属机构」');
  });

  it('没有导出码：不出导出按钮', async () => {
    serve(person(['监督'], ['audit.admin.read']), { '/api/admin/audit/query': listed([row('A')]) });
    const { html } = await renderSettled('/admin/audit');
    expect(html).not.toContain('data-requires="audit.admin.export"');
  });

  it('筛选类别：下拉选中，标题旁写类别说明，查询带类别与工号', async () => {
    const calls = serve(person(['系统管理'], ADMIN), { '/api/admin/audit/query': listed([row('A', { action: 'login.succeeded' })]) });
    const { html } = await renderSettled('/admin/audit?category=auth-session&actor=TH0315&outcome=succeeded');
    expect(calls.find((call) => call.url === '/api/admin/audit/query')?.body).toMatchObject({
      category: 'auth-session', actorCode: 'TH0315', outcome: 'succeeded',
    });
    expect(html).toContain('<option value="auth-session" selected="">认证与会话</option>');
    expect(html).toContain('<option value="succeeded" selected="">结果：成功</option>');
    expect(html).toContain('<span class="hint">操作类别：认证与会话（含登录的成功与失败、被锁定、结束会话）</span>');
    const view = await renderSettled('/admin/audit?category=personnel-view');
    expect(view.html).toContain('<span class="hint">操作类别：人员查阅（打开人员详情）</span>');
  });

  it('空：提示放宽时间范围，不出表格和范围横幅', async () => {
    serve(person(['监督'], SUPERVISE), { '/api/admin/audit/query': listed([]) });
    const { html } = await renderSettled('/admin/audit');
    expect(html).toContain('<div class="desc">海珠区分局及其下级范围内的管理台留痕。</div>');
    expect(html).toContain('所选时间内没有留痕');
    expect(html).toContain('可以放宽时间范围或清空筛选再试。');
    expect(html).not.toContain('class="table"');
    expect(html).not.toContain('你任职在');
  });

  it('加载中：先出筛选条和骨架', async () => {
    serve(person(['系统管理'], ADMIN), { '/api/admin/audit/query': new Promise<Response>(() => {}) });
    const { html } = await renderSettled('/admin/audit');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('class="filters"');
    expect(html).not.toContain('class="table"');
  });

  it('加载失败：可重试的错误卡片，无工程报错', async () => {
    serve(person(['系统管理'], ADMIN), { '/api/admin/audit/query': [500, { message: 'Internal server error' }] });
    const { html } = await renderSettled('/admin/audit');
    expect(html).toContain('留痕没有加载出来');
    expect(html).toContain('重新加载');
    expect(html).not.toContain('HTTP');
    expect(html).not.toContain('Internal');
  });

  it('筛选不合规：人话提示，不出表格', async () => {
    serve(person(['系统管理'], ADMIN), { '/api/admin/audit/query': [400, { result: 'non-compliant', rules: ['invalid-filter'] }] });
    const { html } = await renderSettled('/admin/audit?range=上周');
    expect(html).toContain('<div class="banner danger">筛选条件填写不对');
    expect(html).toContain('value="上周"');
    expect(html).not.toContain('class="table"');
  });

  it('只持 org.tree.read（内勤）：不是进管理台留痕的码，无权限卡片', async () => {
    const calls = serve(person(['内勤'], INTAKE));
    const { html } = await renderSettled('/admin/audit');
    expect(html).toContain('你没有查看管理台留痕的权限');
    expect(calls.map((call) => call.url)).not.toContain('/api/admin/audit/query');
  });

  it('没有查阅码：无权限卡片，不调查阅接口', async () => {
    const calls = serve(person(['经办'], CLERK));
    const { html } = await renderSettled('/admin/audit');
    expect(html).toContain('你没有查看管理台留痕的权限');
    expect(calls.map((call) => call.url)).not.toContain('/api/admin/audit/query');
  });

  it('查阅接口 403：交给壳内路由错误边界（整页无权限页，与管理台首页同一做法）', async () => {
    const store = fresh();
    serve(person(['监督'], SUPERVISE), { '/api/admin/audit/query': [403, { reason: 'scope-denied' }] });
    await store.dispatch(loadSession());
    const filter = filterFromSearch(new URLSearchParams(''), NOW);
    await expect(loadAuditList(store.dispatch, filter)).rejects.toMatchObject({ init: { status: 403 } });
    serve(person(['监督'], SUPERVISE), { '/api/admin/audit/query': [400, { result: 'non-compliant', rules: ['invalid-filter'] }] });
    expect(await loadAuditList(store.dispatch, filter)).toEqual({ kind: 'non-compliant', rules: ['invalid-filter'] });
  });
});

describe('导出（P8 exportConfirm / exportDone）', () => {
  const filter: AuditFilter = { from: '2026-10-16', to: '2026-10-17', category: null, actorCode: null, outcome: null };
  const content = (exportState: ExportState, extra: Partial<AuditContentProps> = {}) => {
    const props: AuditContentProps = {
      filter,
      result: { kind: 'listed', scope: { orgUnitId: 'HQ', orgName: '广州市规划和自然资源局', includesUnanchored: true }, total: 46, rows: [row('A')] },
      supervise: false,
      pendingDesc: '',
      canExport: true,
      exportState,
      onExport: () => {},
      onCancelExport: () => {},
      onConfirmExport: () => {},
      ...extra,
    };
    const router = createMemoryRouter([{ path: '/admin/audit', element: <AuditContent {...props} /> }], { initialEntries: ['/admin/audit'] });
    return renderToStaticMarkup(<RouterProvider router={router} />);
  };

  it('确认框写明范围、时间、筛选、文件名、条数和格式', () => {
    const html = content({ phase: 'confirm' });
    expect(html).toContain('<h3>导出管理台留痕</h3>');
    for (const [k, v] of [
      ['范围', '广州市规划和自然资源局及全部下级'],
      ['时间', '2026-10-16 至 2026-10-17'],
      ['筛选', '全部操作'],
      ['文件名', '管理台留痕_20261016-20261017.xlsx'],
      ['条数', '46 条'],
      ['格式', '表格文件（.xlsx）'],
    ]) {
      expect(html).toContain(`<div class="k">${k}</div><div>${v}</div>`);
    }
    expect(html).toContain('<li>导出内容与页面一致，只含工号，不含手机号和执法证号；</li><li>本次导出本身也会留痕。</li>');
    expect(html).toContain('>取消</button>');
    expect(html).toContain('>确认导出</button>');
  });

  it('导出完成横幅；失败时说明原因', () => {
    expect(content({ phase: 'done', count: 46, filename: '管理台留痕_20261016-20261017.xlsx' }))
      .toContain('<div class="banner ok">已导出 46 条留痕，文件「管理台留痕_20261016-20261017.xlsx」已开始下载。本次导出已留痕。</div>');
    expect(content({ phase: 'failed', message: '导出没有完成：网络或服务暂时不可用，请稍后重试。' }))
      .toContain('<div class="banner danger">导出没有完成：网络或服务暂时不可用，请稍后重试。</div>');
    expect(content({ phase: 'running' })).toContain('正在导出…');
  });

  it('导出接口：POST 同一筛选，文件名取响应头，条数取 x-item-count', async () => {
    const store = fresh();
    serve(person(['系统管理'], ADMIN));
    await store.dispatch(loadSession());
    const calls: Call[] = [];
    vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
      calls.push({ url, method: init.method ?? 'GET', body: JSON.parse(String(init.body)) as Json });
      return Promise.resolve(new Response(new Uint8Array([0x50, 0x4b]), {
        status: 200,
        headers: {
          'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'content-disposition': `attachment; filename="audit.xlsx"; filename*=UTF-8''${encodeURIComponent('管理台留痕_20261016-20261017.xlsx')}`,
          'x-item-count': '46',
        },
      }));
    });
    const outcome = await exportAudit(store.dispatch, { ...filter, category: 'export' });
    expect(calls).toEqual([{ url: '/api/admin/audit/export', method: 'POST', body: { ...filter, category: 'export' } }]);
    expect(outcome).toMatchObject({ kind: 'exported', count: 46, filename: '管理台留痕_20261016-20261017.xlsx' });
  });

  it('导出接口：403 → 无权导出；400 → 不合规；网络错误 → 未完成', async () => {
    const store = fresh();
    serve(person(['系统管理'], ADMIN), { '/api/admin/audit/export': [403, { reason: 'permission-denied' }] });
    await store.dispatch(loadSession());
    expect(await exportAudit(store.dispatch, filter)).toEqual({ kind: 'denied' });
    serve(person(['系统管理'], ADMIN), { '/api/admin/audit/export': [400, { result: 'non-compliant', rules: ['invalid-filter'] }] });
    expect(await exportAudit(store.dispatch, filter)).toEqual({ kind: 'non-compliant', rules: ['invalid-filter'] });
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('network')));
    expect(await exportAudit(store.dispatch, filter)).toEqual({ kind: 'failed' });
  });
});
