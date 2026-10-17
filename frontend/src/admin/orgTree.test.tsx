import { configureStore } from '@reduxjs/toolkit';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import reducer, { loadSession } from '../login/loginSlice';
import { renderRoute } from '../test-utils';
import { CreateDialog, DeactivateDialog, INITIAL_UI, OrgTreeView, RenameDialog, type OrgTreeUi } from './OrgTreePage';
import {
  activeOrgUnits,
  buildTree,
  childCountText,
  childLevelOf,
  deactivateOrgUnit,
  deactivationBlockers,
  formerNames,
  loadOrgTree,
  namePeriods,
  onlyRootOrgUnit,
  registerOrgUnit,
  treeCountHint,
  treeKeyAction,
  visibleOrder,
  type OrgTreeData,
  type OrgUnit,
} from './orgTree';

type Json = Record<string, unknown>;

const day = (date: string) => `${date}T00:00:00+08:00`;

function unit(partial: Partial<OrgUnit> & Pick<OrgUnit, 'id' | 'name' | 'level'>): OrgUnit {
  return {
    code: `ORG-${partial.id}`,
    parentId: null,
    deactivatedAt: null,
    activePersonnel: 0,
    names: [{ name: partial.name, from: day('2020-01-01'), to: null }],
    ...partial,
  };
}

const TREE: OrgTreeData = {
  rootId: 'gz',
  orgUnits: [
    unit({ id: 'gz', name: '广州市规划和自然资源局', level: 'city', activePersonnel: 12 }),
    unit({
      id: 'th',
      name: '天河区分局',
      level: 'district',
      parentId: 'gz',
      activePersonnel: 46,
      names: [
        { name: '天河区国土资源和规划分局', from: day('2015-06-01'), to: day('2019-03-01') },
        { name: '天河区分局', from: day('2019-03-01'), to: null },
      ],
    }),
    unit({ id: 'sp', name: '石牌自然资源所', level: 'station', parentId: 'th' }),
    unit({ id: 'ws', name: '五山自然资源所', level: 'station', parentId: 'th', deactivatedAt: day('2026-09-01') }),
    unit({ id: 'hz', name: '海珠区分局', level: 'district', parentId: 'gz' }),
    unit({ id: 'py', name: '番禺区分局（旧）', level: 'district', parentId: 'gz', deactivatedAt: day('2026-01-01') }),
  ],
};

const ADMIN = ['org.tree.read', 'org.unit.register', 'org.unit.rename', 'org.unit.deactivate'];
const INTAKE = ['clue.read', 'case.read', 'org.tree.read'];

function view(opcodes: string[], ui: Partial<OrgTreeUi> = {}, tree = TREE): string {
  return renderToStaticMarkup(
    <OrgTreeView
      tree={tree}
      opcodes={opcodes}
      ui={{ ...INITIAL_UI, ...ui }}
      onUi={() => undefined}
      dialog={null}
      onDialog={() => undefined}
      onCreate={async () => ({ ok: true, id: 'x' })}
      onRename={async () => ({ ok: true, id: 'x' })}
      onDeactivate={async () => ({ ok: true, id: 'x' })}
    />,
  );
}

const byId = (id: string) => TREE.orgUnits.find((item) => item.id === id)!;

function deactivateDialog(id: string): string {
  return renderToStaticMarkup(
    <DeactivateDialog tree={TREE} unit={byId(id)} onCancel={() => undefined} onSubmit={async () => ({ ok: true, id })} />,
  );
}

function person(opcodes: string[]): Json {
  return { result: 'authenticated', name: '周敏', code: 'SJ0001', orgName: '广州市规划和自然资源局', roles: ['系统管理'], opcodes };
}

function serve(session: Json, routes: Record<string, [number, Json]> = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url === '/api/auth/session') return Promise.resolve(new Response(JSON.stringify(session), { status: 200 }));
    const [status, body] = routes[url] ?? [404, {}];
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  });
  return calls;
}

const fresh = () => configureStore({ reducer: { login: reducer } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('机构树纯函数', () => {
  it('层级：市下建区，区下建所，所下不能再建', () => {
    expect(childLevelOf('city')).toBe('district');
    expect(childLevelOf('district')).toBe('station');
    expect(childLevelOf('station')).toBeNull();
  });

  it('组树、计数、下级说明', () => {
    const root = buildTree(TREE)!;
    expect(root.unit.id).toBe('gz');
    expect(root.children.map((child) => child.unit.id)).toEqual(['th', 'hz', 'py']);
    expect(buildTree(TREE, false)!.children.map((child) => child.unit.id)).toEqual(['th', 'hz']);
    expect(treeCountHint(TREE)).toBe('6 个机构，2 个已停用');
    expect(childCountText(TREE, 'th')).toBe('2 个（其中 1 个已停用）');
    expect(childCountText(TREE, 'sp')).toBe('无');
  });

  it('业务侧只取未停用节点', () => {
    expect(activeOrgUnits(TREE).map((item) => item.id)).toEqual(['gz', 'th', 'sp', 'hz']);
  });

  it('名称使用期间：新名在前，旧名止于新名开始的前一天', () => {
    const names = TREE.orgUnits[1]!.names;
    expect(namePeriods(names)).toEqual([
      { name: '天河区分局', period: '2019-03-01 至今' },
      { name: '天河区国土资源和规划分局', period: '2015-06-01 至 2019-02-28' },
    ]);
    expect(formerNames(names)).toEqual([{ name: '天河区国土资源和规划分局', until: '2019-03-01 前使用' }]);
  });
});

describe('机构树键盘操作（PR #142 Copilot 意见 3）', () => {
  const root = buildTree(TREE)!;
  const order = visibleOrder(root, new Set());
  const at = (id: string, open = true) => {
    const node = TREE.orgUnits.find((item) => item.id === id)!;
    const hasChildren = TREE.orgUnits.some((item) => item.parentId === id);
    return { parentId: node.parentId, hasChildren, open: hasChildren && open, collapsible: node.parentId !== null };
  };

  it('看得见的节点顺序：折叠的节点不展开下级，根节点始终展开', () => {
    expect(order).toEqual(['gz', 'th', 'sp', 'ws', 'hz', 'py']);
    expect(visibleOrder(root, new Set(['th', 'gz']))).toEqual(['gz', 'th', 'hz', 'py']);
  });

  it('上下、首尾键移动选中；回车、空格选中当前节点', () => {
    expect(treeKeyAction('ArrowDown', order, 'th', at('th'))).toEqual({ kind: 'select', id: 'sp' });
    expect(treeKeyAction('ArrowUp', order, 'th', at('th'))).toEqual({ kind: 'select', id: 'gz' });
    expect(treeKeyAction('ArrowUp', order, 'gz', at('gz'))).toBeNull();
    expect(treeKeyAction('ArrowDown', order, 'py', at('py'))).toBeNull();
    expect(treeKeyAction('Home', order, 'hz', at('hz'))).toEqual({ kind: 'select', id: 'gz' });
    expect(treeKeyAction('End', order, 'th', at('th'))).toEqual({ kind: 'select', id: 'py' });
    expect(treeKeyAction('Enter', order, 'hz', at('hz'))).toEqual({ kind: 'select', id: 'hz' });
    expect(treeKeyAction(' ', order, 'hz', at('hz'))).toEqual({ kind: 'select', id: 'hz' });
    expect(treeKeyAction('a', order, 'hz', at('hz'))).toBeNull();
  });

  it('右键展开或进入第一个下级，左键折叠或回到上级；根节点不折叠', () => {
    expect(treeKeyAction('ArrowRight', order, 'th', at('th', false))).toEqual({ kind: 'toggle', id: 'th' });
    expect(treeKeyAction('ArrowRight', order, 'th', at('th'))).toEqual({ kind: 'select', id: 'sp' });
    expect(treeKeyAction('ArrowRight', order, 'sp', at('sp'))).toBeNull();
    expect(treeKeyAction('ArrowLeft', order, 'th', at('th'))).toEqual({ kind: 'toggle', id: 'th' });
    expect(treeKeyAction('ArrowLeft', order, 'sp', at('sp'))).toEqual({ kind: 'select', id: 'th' });
    expect(treeKeyAction('ArrowLeft', order, 'gz', at('gz'))).toBeNull();
  });

  it('节点可以获得焦点：只有选中的节点在 Tab 序列里', () => {
    const html = view(ADMIN, { selectedId: 'th' });
    expect(html).toContain('role="tree" aria-label="机构树"');
    expect(html).toMatch(/data-org-unit="th" role="treeitem" aria-selected="true" aria-expanded="true" tabindex="0"/);
    expect(html).toMatch(/data-org-unit="gz" role="treeitem" aria-selected="false" aria-expanded="true" tabindex="-1"/);
  });
});

describe('机构树界面（P4）', () => {
  it('expanded：全部展开，已停用节点标出，详情有在职人员、下级、调整隶属说明，无移动入口', () => {
    const html = view(ADMIN, { selectedId: 'th' });
    expect(html).toContain('6 个机构，2 个已停用');
    expect(html).toContain('五山自然资源所</span><span class="tag gray">已停用</span>');
    expect(html).toContain('class="node sel"');
    expect(html).toContain('46 人');
    expect(html).toContain('2 个（其中 1 个已停用）');
    expect(html).toContain('天河区国土资源和规划分局');
    expect(html).toContain('2019-03-01 前使用');
    expect(html).toContain('机构不能移动到其他上级下面。需要调整隶属时：新建机构，把人员调岗过去，再停用旧机构。');
    expect(html).toContain('data-requires="org.unit.register"');
    expect(html).toContain('data-requires="org.unit.rename"');
    expect(html).not.toMatch(/draggable|>移动<|>合并<|>恢复</);
  });

  it('collapsed：折叠节点显示下级数，根节点始终展开', () => {
    const html = view(ADMIN, { collapsed: new Set(['th']) });
    expect(html).toContain('2 个下级');
    expect(html).not.toContain('石牌自然资源所');
    expect(html).toContain('天河区分局');
  });

  it('不显示已停用时隐藏已停用节点', () => {
    const html = view(ADMIN, { showDeactivated: false });
    expect(html).not.toContain('番禺区分局（旧）');
    expect(html).not.toContain('五山自然资源所');
  });

  it('onlyroot：只有根机构时引导先建区分局，根机构不能停用', () => {
    const only: OrgTreeData = { rootId: 'gz', orgUnits: [TREE.orgUnits[0]!] };
    const html = view(ADMIN, {}, only);
    expect(html).toContain('1 个机构');
    expect(html).toContain('还没有下级机构。请先建区分局，再在区分局下建所。');
    expect(html).toContain('根机构不能停用。');
    expect(html).toContain('无（根机构）');
    expect(html).not.toContain('全部展开');
  });

  it('区分局管理员反例：树里有根和区分局但还没有所时，不显示「请先建区分局」', () => {
    const district = unit({ id: 'th', name: '天河区分局', level: 'district', parentId: 'gz' });
    // 区分局管理员的子树：根是区分局（上级不在范围内），还没有所。
    const ownSubtree: OrgTreeData = { rootId: 'th', orgUnits: [district] };
    // 树里有根机构和区分局，区分局下还没有所。
    const rootAndDistrict: OrgTreeData = { rootId: 'gz', orgUnits: [TREE.orgUnits[0]!, district] };
    expect(onlyRootOrgUnit(ownSubtree)).toBe(false);
    expect(onlyRootOrgUnit(rootAndDistrict)).toBe(false);
    expect(onlyRootOrgUnit({ rootId: 'gz', orgUnits: [TREE.orgUnits[0]!] })).toBe(true);
    for (const html of [view(ADMIN, {}, ownSubtree), view(ADMIN, { selectedId: 'th' }, rootAndDistrict)]) {
      expect(html).toContain('天河区分局');
      expect(html).not.toContain('请先建区分局');
      expect(html).toContain('机构不能移动到其他上级下面。');
    }
  });

  it('所节点不能新建下级；已停用机构不能新建下级', () => {
    expect(view(ADMIN, { selectedId: 'sp' })).toContain('所下不能再建下级机构。');
    const off = view(ADMIN, { selectedId: 'py' });
    expect(off).toContain('已停用的机构下不能新建下级机构。');
    expect(off).toMatch(/<button type="button" class="btn btn-primary" data-requires="org.unit.register" disabled=""/);
  });

  it('内勤只读看树：没有新建、改名按钮', () => {
    const html = view(INTAKE);
    expect(html).toContain('广州市规划和自然资源局');
    expect(html).not.toContain('data-requires="org.unit.register"');
    expect(html).not.toContain('data-requires="org.unit.rename"');
  });

  it('create：上级只读、层级默认为唯一合法层级、名称必填', () => {
    const html = renderToStaticMarkup(
      <CreateDialog parent={TREE.orgUnits[1]!} onCancel={() => undefined} onSubmit={async () => ({ ok: true, id: 'x' })} />,
    );
    expect(html).toContain('在「天河区分局」下新建机构');
    expect(html).toMatch(/<input class="input ro" disabled="" value="天河区分局"\/>|<input class="input ro" value="天河区分局" disabled=""\/>/);
    expect(html).toContain('<option value="station" selected="">所</option>');
    expect(html).toContain('名称以编制批复为准。以后改名会保留历史名称。');
    // 打开时焦点落在名称输入框（PR #142 Copilot 意见 4）。
    expect(html).toContain('<input id="org-name" class="input" data-autofocus="true" value=""/>');
  });

  it('rename：显示历史名称及使用期间', () => {
    const html = renderToStaticMarkup(
      <RenameDialog unit={TREE.orgUnits[1]!} onCancel={() => undefined} onSubmit={async () => ({ ok: true, id: 'x' })} />,
    );
    expect(html).toContain('改名：天河区分局');
    expect(html).toContain('<input id="org-new-name" class="input" data-autofocus="true" value=""/>');
    expect(html).toContain('改名后，此前的案件、卷宗和记录仍显示当时的名称。');
    expect(html).toContain('<td>天河区分局</td><td>2019-03-01 至今</td>');
    expect(html).toContain('<td>天河区国土资源和规划分局</td><td>2015-06-01 至 2019-02-28</td>');
  });
});

describe('机构停用（P4 blocked/confirm，#124）', () => {
  const DEACTIVATE_BUTTON = 'data-requires="org.unit.deactivate"';

  it('有停用码：未停用的非根机构详情里有「停用」按钮', () => {
    expect(view(ADMIN, { selectedId: 'th' })).toContain(`<button type="button" class="btn btn-ghost-danger" ${DEACTIVATE_BUTTON}>停用</button>`);
    expect(view(ADMIN, { selectedId: 'sp' })).toContain(DEACTIVATE_BUTTON);
  });

  it('根机构、已停用机构、没有停用码（内勤，或只有新建改名码）：不显示「停用」按钮', () => {
    expect(view(ADMIN, { selectedId: 'gz' })).not.toContain(DEACTIVATE_BUTTON);
    expect(view(ADMIN, { selectedId: 'ws' })).not.toContain(DEACTIVATE_BUTTON);
    expect(view(INTAKE, { selectedId: 'th' })).not.toContain(DEACTIVATE_BUTTON);
    expect(view(['org.tree.read', 'org.unit.register', 'org.unit.rename'], { selectedId: 'th' })).not.toContain(DEACTIVATE_BUTTON);
  });

  it('树数据上的前提：在职人员、未停用的下级（已停用的下级不算）', () => {
    expect(deactivationBlockers(TREE, byId('th'))).toEqual([
      { kind: 'personnel', count: 46 },
      { kind: 'children', names: ['石牌自然资源所'] },
    ]);
    expect(deactivationBlockers(TREE, byId('sp'))).toEqual([]);
  });

  it('blocked：列出不满足的条件和条数、下级名称，只有「知道了」', () => {
    const html = deactivateDialog('th');
    expect(html).toContain('暂时不能停用「天河区分局」');
    expect(html).toContain('<div class="banner amber" style="margin-bottom:8px">停用机构前，需要先满足以下条件：</div>');
    expect(html).toContain('<li>还有 <b>46 名</b>在职人员：请先把他们调岗到其他机构，或停用相应人员。</li>');
    expect(html).toContain('<li>还有 <b>1 个</b>未停用的下级机构（石牌自然资源所）：请先停用下级机构。</li>');
    expect(html).toContain('<button type="button" class="btn btn-primary">知道了</button>');
    expect(html).not.toContain('确认停用');
  });

  it('confirm：说明停用后果与已核对，取消 / 确认停用', () => {
    const html = deactivateDialog('sp');
    expect(html).toContain('停用「石牌自然资源所」？');
    expect(html).toContain('<li>不能再在这个机构下建人员或下级机构；</li>');
    expect(html).toContain('<li>业务办理时不能再选它作为承办机构；</li>');
    expect(html).toContain('<li>历史记录照常保留，仍显示这个机构名称；</li>');
    expect(html).toContain('<li>一期不提供恢复，请确认后再操作。</li>');
    expect(html).toContain('已核对：没有在职人员，没有未停用的下级机构。');
    expect(html).toContain('<button type="button" class="btn btn-danger">确认停用</button>');
  });

  it('确认停用：POST 停用接口；409 显示服务端可读原因（含未办结），403 与网络失败给固定说明', async () => {
    const store = fresh();
    serve(person(ADMIN));
    await store.dispatch(loadSession());
    const url = '/api/admin/org-units/sp/deactivate';
    const calls = serve(person(ADMIN), { [url]: [200, { result: 'deactivated', orgUnit: { id: 'sp', deactivatedAt: day('2026-10-18') } }] });
    expect(await deactivateOrgUnit(store.dispatch, 'sp')).toEqual({ ok: true, id: 'sp' });
    expect(calls.find((call) => call.url === url)?.init?.method).toBe('POST');
    const openItems = '本机构还有 3 条未办结的线索或案件（线索 1 条、案件 2 条），全部办结后才能停用。';
    serve(person(ADMIN), {
      [url]: [409, { result: 'invalid-state', reason: 'org-has-open-items', openItems: { clues: 1, cases: 2 }, message: openItems }],
    });
    expect(await deactivateOrgUnit(store.dispatch, 'sp')).toEqual({ ok: false, rules: [], message: openItems });
    serve(person(ADMIN), { [url]: [409, { result: 'invalid-state' }] });
    expect(await deactivateOrgUnit(store.dispatch, 'sp'))
      .toEqual({ ok: false, rules: [], message: '这个机构暂时不能停用，请刷新后查看原因。' });
    serve(person(ADMIN), { [url]: [403, { reason: 'scope-denied' }] });
    expect(await deactivateOrgUnit(store.dispatch, 'sp'))
      .toEqual({ ok: false, rules: [], message: '你没有权限执行这个操作，或这个机构不在你的范围内。' });
  });
});

describe('机构页路由与接口', () => {
  it('没有树读码（监督）：无权限卡片，不取树', async () => {
    const calls = serve(person(['audit.admin.read']));
    const { html } = await renderRoute(fresh(), '/admin/org-units');
    expect(html).toContain('你没有查看机构的权限');
    expect(calls.map((call) => call.url)).not.toContain('/api/org-units');
  });

  it('系统管理打开机构页：首屏先出骨架并取树，机构菜单高亮', async () => {
    const calls = serve(person(ADMIN), { '/api/org-units': [200, { result: 'listed', ...TREE }] });
    const { html } = await renderRoute(fresh(), '/admin/org-units');
    expect(html).toContain('显示你任职机构及其全部下级，已停用的机构也会列出并标明。');
    expect(html).toContain('<div class="grid2" aria-busy="true">');
    expect(html).toContain('nav-item active" data-menu="org"');
    expect(calls.map((call) => call.url)).toContain('/api/org-units');
  });

  it('取树：200 交出树；403 交给无权限卡片；其他失败交给错误卡片', async () => {
    const store = fresh();
    serve(person(ADMIN), { '/api/org-units': [200, { result: 'listed', ...TREE }] });
    await store.dispatch(loadSession());
    expect(await loadOrgTree(store.dispatch)).toEqual(TREE);
    serve(person(ADMIN), { '/api/org-units': [403, { reason: 'scope-denied' }] });
    await expect(loadOrgTree(store.dispatch)).rejects.toMatchObject({ init: { status: 403 } });
    serve(person(ADMIN), { '/api/org-units': [500, {}] });
    await expect(loadOrgTree(store.dispatch)).rejects.toThrow('机构树读取失败：HTTP 500');
  });

  it('内勤直接打开机构页：只读取树（菜单里没有机构）', async () => {
    const calls = serve(person(INTAKE), { '/api/org-units': [200, { result: 'listed', ...TREE }] });
    const { html } = await renderRoute(fresh(), '/admin/org-units');
    expect(calls.map((call) => call.url)).toContain('/api/org-units');
    expect(html).not.toContain('data-menu="org"');
  });

  it('新建下级：400 规则码原样交回，409 给出可读原因', async () => {
    const store = fresh();
    serve(person(ADMIN), {
      '/api/admin/org-units': [400, { result: 'non-compliant', rules: ['org-level-mismatch'] }],
    });
    await store.dispatch(loadSession());
    expect(await registerOrgUnit(store.dispatch, { parentId: 'gz', name: '甲', level: 'station' }))
      .toEqual({ ok: false, rules: ['org-level-mismatch'], message: null });
    const calls = serve(person(ADMIN), { '/api/admin/org-units': [409, { result: 'invalid-state' }] });
    const conflict = await registerOrgUnit(store.dispatch, { parentId: 'py', name: '甲', level: 'station' });
    expect(conflict).toEqual({ ok: false, rules: [], message: '上级机构已停用，不能在它下面新建机构。' });
    expect(calls[0]?.init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ parentId: 'py', name: '甲', level: 'station' });
  });

  it('写请求网络失败或服务出错：用定稿句（原型 shell.js:62）', async () => {
    const store = fresh();
    serve(person(ADMIN), { '/api/admin/org-units': [500, {}] });
    await store.dispatch(loadSession());
    const FINAL = '网络或服务暂时不可用，请稍后重试。问题持续时请联系本单位的系统管理人员。';
    expect(await registerOrgUnit(store.dispatch, { parentId: 'gz', name: '甲', level: 'district' }))
      .toEqual({ ok: false, rules: [], message: FINAL });
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('network down')));
    expect(await registerOrgUnit(store.dispatch, { parentId: 'gz', name: '甲', level: 'district' }))
      .toEqual({ ok: false, rules: [], message: FINAL });
  });
});
