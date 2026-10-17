import { configureStore } from '@reduxjs/toolkit';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import prototype from '../../prototype/admin-console/P7-locked-personnel.html?raw';
import reducer, { loadSession } from '../login/loginSlice';
import { renderRoute, renderRouter } from '../test-utils';
import { LockedPersonnelView } from './LockedPersonnelPage';
import {
  COLUMNS,
  EMPTY_HINT,
  EMPTY_TITLE,
  formatUnlockTime,
  initialLockedState,
  interpretAction,
  lockedReducer,
  NO_ORG_HINT,
  noticeText,
  PAGE_DESC,
  performAction,
  RESET_EFFECT,
  RESET_PLACEHOLDER,
  RESET_RULES,
  resetDialogTitle,
  resetRulesSentence,
  SELF_DENIED,
  UNLOCK_NOTE,
  unlockDialogTitle,
  type LockedRow,
  type LockedState,
  type Notice,
} from './lockedPersonnel';

type Json = Record<string, unknown>;

// 人物与原型 v0.4 P7 一致（assets/shell.js 的 cityAdmin 与 ROWS）。
const ADMIN_OPCODES = ['personnel.locked.read', 'personnel.locked.release', 'personnel.password.reset', 'audit.admin.read'];
const CITY_ADMIN: Json = { result: 'authenticated', name: '周敏', code: 'SJ0001', orgName: '广州市规划和自然资源局', roles: ['系统管理'], opcodes: ADMIN_OPCODES };
const SUPERVISOR: Json = { result: 'authenticated', name: '林清', code: 'SJ0108', orgName: '广州市规划和自然资源局', roles: ['监督'], opcodes: ['case.read', 'audit.admin.read', 'audit.admin.export'] };

const WANG: LockedRow = { id: '01K7DQ4M2X8VJ3N6T9C1R5W0EA', code: 'TH0331', name: '王芳', orgName: '龙洞自然资源所', lockedUntil: '2026-10-17T02:21:00.000Z' };
const ZHANG: LockedRow = { id: '01K7DQ9B5H2KZ7P4F8S3M6Y1GD', code: 'HZ0217', name: '张敏', orgName: '海珠区分局', lockedUntil: '2026-10-17T02:34:00.000Z' };
const ZHOU: LockedRow = { id: '01K7DR1C8N4QW6J2V5X9T3B7HK', code: 'SJ0001', name: '周敏', orgName: '广州市规划和自然资源局', lockedUntil: '2026-10-17T02:40:00.000Z' };
const CHEN: LockedRow = { id: '01K7DR3F6T9MB2R8K4Z1C5N7PS', code: 'PY0042', name: '陈立', orgName: null, lockedUntil: '2026-10-17T02:47:00.000Z' };
const ROWS = [WANG, ZHANG, ZHOU, CHEN];

const fresh = () => configureStore({ reducer: { login: reducer } });

interface Call { url: string; init?: RequestInit }

/** 按地址回答：会话查询返回 session，其余接口按 routes 登记。 */
function serve(session: Json, routes: Record<string, [number, Json]> = {}): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url === '/api/auth/session') return Promise.resolve(new Response(JSON.stringify(session), { status: 200 }));
    const [status, body] = routes[url] ?? [404, {}];
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  });
  return calls;
}

/**
 * 打开页面并渲染列表到达后的样子。静态渲染不等延迟数据：第一次渲染让 Await 记下这次加载，
 * 等它落定后再渲染一次。
 */
async function openPage(store = fresh()): Promise<string> {
  const { router } = await renderRoute(store, '/admin/locked-personnel');
  await new Promise((resolve) => setTimeout(resolve, 0));
  return renderRouter(store, router);
}

const listed = (rows: LockedRow[]): [number, Json] => [200, { result: 'listed', personnel: rows }];

afterEach(() => {
  vi.unstubAllGlobals();
});

const view = (state: LockedState, opcodes = ADMIN_OPCODES) => renderToStaticMarkup(
  <MemoryRouter><LockedPersonnelView state={state} opcodes={opcodes} send={() => {}} onConfirm={() => {}} /></MemoryRouter>,
);

/** 去掉标签，只留可见文本，便于与原型逐字比对。 */
const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"');

describe('P7 文案与原型 v0.4 逐字一致（35 条定稿、#84 批准的两句）', () => {
  it('固定文案逐字出现在原型里', () => {
    for (const copy of [PAGE_DESC, EMPTY_TITLE, EMPTY_HINT, NO_ORG_HINT, UNLOCK_NOTE, RESET_PLACEHOLDER, RESET_EFFECT, SELF_DENIED]) {
      expect(prototype).toContain(copy);
    }
    expect(prototype).toContain(`data-fields="${COLUMNS.join(' ')}"`);
    expect(prototype).toContain(`<tr><th>${COLUMNS.join('</th><th>')}</th>`);
    for (const label of ['>刷新<', '>解锁<', '>重设初始口令<', '>取消<', '>确认解锁<', '>确认重设<', '新的初始口令<span class="req">*</span>']) {
      expect(prototype).toContain(label);
    }
  });

  it('带人名的句子按原型人物代入后逐字出现在原型里', () => {
    expect(prototype).toContain(unlockDialogTitle(WANG));
    expect(prototype).toContain(resetDialogTitle(WANG));
    const notices: Notice[] = [
      { kind: 'unlocked', row: WANG },
      { kind: 'reset', row: WANG },
      { kind: 'scope-denied', action: 'unlock', row: ZHANG },
      { kind: 'scope-denied', action: 'reset', row: ZHANG },
      { kind: 'self-denied', action: 'unlock', row: ZHOU },
      { kind: 'self-denied', action: 'reset', row: ZHOU },
    ];
    for (const notice of notices) expect(prototype).toContain(noticeText(notice));
  });

  it('口令要求：除口令历史一句（留给 #132）外与原型逐字一致', () => {
    expect(resetRulesSentence()).toBe('至少 10 位，最多 64 位；大写、小写、数字、特殊字符中至少 3 类；不能包含对方工号；不能有 4 位及以上连续或重复字符；不能用常见弱口令。');
    expect(prototype).toContain(resetRulesSentence([...RESET_RULES, '不能与对方最近 5 次使用过的口令相同']));
    expect(resetRulesSentence()).not.toContain('最近 5 次');
  });
});

describe('自动解锁时间', () => {
  it('按 Asia/Shanghai 显示到分钟', () => {
    expect(formatUnlockTime('2026-10-17T02:21:00.000Z')).toBe('2026-10-17 10:21');
    expect(formatUnlockTime('2026-10-17T16:05:00.000Z')).toBe('2026-10-18 00:05');
    expect(formatUnlockTime('not-a-time')).toBe('');
  });
});

describe('被锁人员页（P7）路由', () => {
  it('data：列名照 #91，每行解锁与重设初始口令，无任职者机构名为空，无手机号', async () => {
    serve(CITY_ADMIN, { '/api/admin/locked-personnel': listed(ROWS) });
    const html = await openPage();
    expect(html).toContain('管理台 / <b>被锁人员</b>');
    expect(html).toContain('nav-item active" data-menu="locked"');
    expect(html).toContain(`<div class="desc">${PAGE_DESC}</div>`);
    expect(html).toContain('共 4 人');
    expect(html).toContain(`<tr><th>${COLUMNS.join('</th><th>')}</th>`);
    expect(html).toContain(`<td class="mono">${CHEN.id}</td><td class="mono">PY0042</td><td>陈立</td><td></td><td>2026-10-17 10:47</td>`);
    expect(html.match(/data-requires="personnel.locked.release"/g)).toHaveLength(4);
    expect(html.match(/data-requires="personnel.password.reset"/g)).toHaveLength(4);
    expect(text(html)).not.toContain('手机');
    expect(html).not.toContain('class="mask"');
  });

  it('empty：当前没有被锁的人员', async () => {
    serve(CITY_ADMIN, { '/api/admin/locked-personnel': listed([]) });
    const html = await openPage();
    expect(html).toContain(EMPTY_TITLE);
    expect(html).toContain(EMPTY_HINT);
    expect(html).not.toContain('<table');
  });

  it('denied：监督没有列表码，显示无权限卡片且不取列表', async () => {
    const calls = serve(SUPERVISOR);
    const { html } = await renderRoute(fresh(), '/admin/locked-personnel');
    expect(html).toContain('你没有查看被锁人员的权限');
    expect(html).not.toContain('刷新');
    expect(calls.map((call) => call.url)).not.toContain('/api/admin/locked-personnel');
  });

  it('列表接口 403：显示无权限卡片', async () => {
    serve(CITY_ADMIN, { '/api/admin/locked-personnel': [403, { reason: 'permission-denied' }] });
    const html = await openPage();
    expect(html).toContain('你没有查看被锁人员的权限');
  });

  it('error：加载失败可重新加载', async () => {
    serve(CITY_ADMIN, { '/api/admin/locked-personnel': [500, {}] });
    const html = await openPage();
    expect(html).toContain('被锁人员没有加载出来');
    expect(html).toContain('重新加载');
  });

  it('loading：列表未到时先出骨架', async () => {
    serve(CITY_ADMIN);
    const original = globalThis.fetch;
    let release!: (response: Response) => void;
    vi.stubGlobal('fetch', (url: string) => (url === '/api/admin/locked-personnel'
      ? new Promise<Response>((resolve) => { release = resolve; })
      : original(url)));
    const { html } = await renderRoute(fresh(), '/admin/locked-personnel');
    expect(html).toContain('aria-busy="true"');
    expect(html.match(/class="skel"/g)).toHaveLength(5);
    release(new Response(JSON.stringify({ personnel: [] }), { status: 200 }));
  });
});

describe('动作：解锁与重设初始口令', () => {
  const open = (kind: 'unlock' | 'reset', row: LockedRow) =>
    lockedReducer(initialLockedState(ROWS), { type: 'open', kind, row });

  it('解锁成功：该行从列表移除，显示成功横幅', () => {
    const state = lockedReducer(lockedReducer(open('unlock', WANG), { type: 'submit' }), { type: 'settled', result: { type: 'done' } });
    expect(state.rows.map((row) => row.code)).toEqual(['HZ0217', 'SJ0001', 'PY0042']);
    expect(state.dialog).toBeNull();
    const html = view(state);
    expect(html).toContain('<div class="banner ok" role="status">已解锁「王芳」（TH0331），对方现在可以登录。</div>');
    expect(html).toContain('共 3 人');
    expect(html).not.toContain(WANG.id);
  });

  it('重设成功：该行移除，横幅说明同时解锁、会话和记住我已结束', () => {
    let state = lockedReducer(open('reset', WANG), { type: 'password', value: 'Gz@Field2026' });
    state = lockedReducer(lockedReducer(state, { type: 'submit' }), { type: 'settled', result: { type: 'done' } });
    expect(state.rows).toHaveLength(3);
    expect(state.password).toBe('');
    expect(view(state)).toContain('已为「王芳」（TH0331）重设初始口令，并已解锁。对方的全部会话和全部「记住我」已结束，下次登录须先改口令。');
  });

  it('跨区被拒：行保留并高亮，横幅为「超出数据范围」定稿句', () => {
    const unlock = lockedReducer(open('unlock', ZHANG), {
      type: 'settled', result: { type: 'denied', notice: { kind: 'scope-denied', action: 'unlock', row: ZHANG } },
    });
    expect(unlock.rows).toHaveLength(4);
    const html = view(unlock);
    expect(html).toContain('data-reason="scope-denied">没有解锁「张敏」（HZ0217）：对方已不在你的数据范围内，可能刚刚调岗。请刷新列表，或联系对方现在所在单位的系统管理人员。</div>');
    expect(html).toContain(`<tr style="background:#fffaeb" data-personnel="${ZHANG.id}">`);
    const reset = lockedReducer(open('reset', ZHANG), {
      type: 'settled', result: { type: 'denied', notice: { kind: 'scope-denied', action: 'reset', row: ZHANG } },
    });
    expect(view(reset)).toContain('没有为「张敏」（HZ0217）重设初始口令：对方已不在你的数据范围内，可能刚刚调岗。');
  });

  it('对自己操作被拒：解锁和重设都显示同一句定稿句', () => {
    for (const kind of ['unlock', 'reset'] as const) {
      const state = lockedReducer(open(kind, ZHOU), {
        type: 'settled', result: { type: 'denied', notice: { kind: 'self-denied', action: kind, row: ZHOU } },
      });
      const html = view(state);
      expect(html).toContain(`data-reason="permission-denied">${SELF_DENIED}</div>`);
      expect(html).toContain(`<tr style="background:#fffaeb" data-personnel="${ZHOU.id}">`);
    }
  });

  it('重设口令不合规：弹窗不关，输入框下逐条列出', () => {
    const state = lockedReducer(open('reset', WANG), {
      type: 'settled', result: { type: 'non-compliant', rules: ['too-short', 'contains-code', 'unknown-code'] },
    });
    expect(state.dialog?.row).toBe(WANG);
    const html = view(state);
    expect(html).toContain('<li>口令至少 10 位</li><li>不能包含对方工号</li></ul>');
    expect(html).not.toContain('unknown-code');
    expect(lockedReducer(state, { type: 'password', value: 'x' }).ruleCodes).toEqual([]);
  });

  it('请求中不能取消；取消后弹窗关闭、口令清空', () => {
    const typed = lockedReducer(open('reset', WANG), { type: 'password', value: 'secret' });
    const pending = lockedReducer(typed, { type: 'submit' });
    expect(lockedReducer(pending, { type: 'close' })).toBe(pending);
    const closed = lockedReducer(typed, { type: 'close' });
    expect(closed.dialog).toBeNull();
    expect(closed.password).toBe('');
  });

  it('解锁确认弹窗只展示五字段内的信息', () => {
    const html = view(open('unlock', WANG));
    expect(html).toContain('<h3>解锁「王芳」？</h3>');
    expect(html).toContain('<div class="k">工号</div><div class="mono">TH0331</div><div class="k">当前机构名</div><div>龙洞自然资源所</div><div class="k">自动解锁时间</div><div>2026-10-17 10:21</div>');
    expect(html).toContain(UNLOCK_NOTE);
    expect(html).toContain('确认解锁');
  });

  it('重设确认弹窗：口令要求、同时解锁并结束会话和记住我', () => {
    const html = view(open('reset', WANG));
    expect(html).toContain('<h3>为「王芳」重设初始口令</h3>');
    expect(html).toContain(`placeholder="${RESET_PLACEHOLDER}"`);
    expect(html).toContain(`<div class="help">${resetRulesSentence()}</div>`);
    expect(html).toContain(RESET_EFFECT);
    expect(html).toContain('type="password"');
  });

  it('没有解锁码或重设码时不出对应按钮', () => {
    const html = view(initialLockedState(ROWS), ['personnel.locked.read', 'personnel.locked.release']);
    expect(html).toContain('>解锁</button>');
    expect(html).not.toContain('重设初始口令</button>');
  });
});

describe('动作请求与结果判定', () => {
  it('解锁 POST 到 A10 解锁接口；重设带 JSON 口令', async () => {
    const store = fresh();
    const calls = serve(CITY_ADMIN, {
      [`/api/admin/personnel/${WANG.id}/unlock`]: [200, { result: 'unlocked' }],
      [`/api/admin/personnel/${WANG.id}/password-reset`]: [200, { result: 'reset' }],
    });
    await store.dispatch(loadSession());
    expect(await performAction(store.dispatch, 'unlock', WANG, '', 'SJ0001')).toEqual({ type: 'done' });
    expect(await performAction(store.dispatch, 'reset', WANG, 'Gz@Field2026', 'SJ0001')).toEqual({ type: 'done' });
    const posts = calls.filter((call) => call.url.startsWith('/api/admin/personnel/'));
    expect(posts.map((call) => [call.url, call.init?.method])).toEqual([
      [`/api/admin/personnel/${WANG.id}/unlock`, 'POST'],
      [`/api/admin/personnel/${WANG.id}/password-reset`, 'POST'],
    ]);
    expect(JSON.parse(String(posts[1].init?.body))).toEqual({ password: 'Gz@Field2026' });
  });

  const reply = (status: number, body: Json) => new Response(JSON.stringify(body), { status });

  it('403 scope-denied → 超出数据范围；对本人的 permission-denied → 对自己操作', async () => {
    expect(await interpretAction('unlock', ZHANG, reply(403, { reason: 'scope-denied' }), 'SJ0001'))
      .toEqual({ type: 'denied', notice: { kind: 'scope-denied', action: 'unlock', row: ZHANG } });
    expect(await interpretAction('reset', ZHOU, reply(403, { reason: 'permission-denied' }), 'SJ0001'))
      .toEqual({ type: 'denied', notice: { kind: 'self-denied', action: 'reset', row: ZHOU } });
    expect(await interpretAction('unlock', WANG, reply(403, { reason: 'permission-denied' }), 'SJ0001'))
      .toEqual({ type: 'denied', notice: { kind: 'permission-denied', action: 'unlock', row: WANG } });
  });

  it('400 不合规交回规则码；401 交给会话已结束；其余失败出可重试的横幅', async () => {
    expect(await interpretAction('reset', WANG, reply(400, { result: 'non-compliant', rules: ['too-short'] }), 'SJ0001'))
      .toEqual({ type: 'non-compliant', rules: ['too-short'] });
    expect(await interpretAction('unlock', WANG, reply(401, {}), 'SJ0001')).toEqual({ type: 'ended' });
    const failed = await interpretAction('unlock', WANG, reply(500, {}), 'SJ0001');
    expect(failed).toEqual({ type: 'denied', notice: { kind: 'failed', action: 'unlock', row: WANG } });
    expect(noticeText({ kind: 'failed', action: 'unlock', row: WANG }))
      .toBe('没有解锁「王芳」（TH0331）：网络或服务暂时不可用，请稍后重试。问题持续时请联系本单位的系统管理人员。');
  });

  it('网络错误按失败处理，不抛出', async () => {
    const store = fresh();
    serve(CITY_ADMIN);
    await store.dispatch(loadSession());
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('network')));
    expect(await performAction(store.dispatch, 'unlock', WANG, '', 'SJ0001'))
      .toEqual({ type: 'denied', notice: { kind: 'failed', action: 'unlock', row: WANG } });
  });
});
