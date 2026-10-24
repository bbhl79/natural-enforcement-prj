import { configureStore } from '@reduxjs/toolkit';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import reducer, { loadSession } from '../login/loginSlice';
import { visibleSecondaries } from '../shell/menu';
import { renderRoute, renderRouter, settled } from '../test-utils';
import {
  CertForm,
  PersonnelCardView,
  TransferDialog,
  DeactivateDialog,
  EndSessionsDialog,
  RestoreDialog,
  ResetPasswordDialog,
  RESET_PASSWORD_EFFECTS,
  RESET_PASSWORD_HELP,
  certSaveTransition,
  resetPasswordNotice,
  type CardNotice,
  type ConfirmState,
  type EditState,
  type ResetPasswordState,
  type RestoreState,
  type TransferState,
} from './PersonnelCardPage';
import { EMPTY_INPUT, PersonnelCreateForm } from './PersonnelCreatePage';
import { RESET_UNAVAILABLE_TEXT } from './lockedPersonnel';
import { PersonnelListView } from './PersonnelListPage';
import {
  certAttentionOf,
  certEditFrom,
  CERT_DEACTIVATED_MESSAGE,
  CERT_FILTER_LABEL,
  CERT_FILTERS,
  certNote,
  certRecordLabel,
  CERT_TAG,
  CONCURRENT_CHANGE_MESSAGE,
  deactivatePersonnel,
  DEFAULT_FILTER,
  DENIED_TARGET,
  destinationsInTreeOrder,
  editInputFromCard,
  endPersonnelSessions,
  filterFromSearch,
  filterHint,
  filterPersonnel,
  loadPersonnelCard,
  loadPersonnelList,
  loadRestoreOrgUnits,
  loadTransferDestinations,
  listHint,
  maskPhone,
  orgText,
  PAGE_SIZE,
  pageFromSearch,
  paginate,
  passwordText,
  PERSONNEL_DEACTIVATE,
  PERSONNEL_PASSWORD_RESET,
  PERSONNEL_RESTORE,
  PERSONNEL_SESSIONS_END,
  PERSONNEL_UPDATE,
  problemCount,
  qualifiedPersonnelCount,
  registerPersonnel,
  resetPersonnelPassword,
  restorePersonnel,
  searchFromFilter,
  searchWithPage,
  SESSIONS_ENDED_NOTICE,
  shouldRevalidatePersonnelList,
  transferPersonnel,
  updateCert,
  updatePersonnel,
  type CertUpdateInput,
  type CertUpdateResult,
  type EditInput,
  type PersonnelCard,
  type PersonnelFilter,
  type PersonnelList,
  type PersonnelRow,
  type TransferDestination,
} from './personnel';
import type { OrgUnit } from './orgTree';

type Json = Record<string, unknown>;

function row(partial: Partial<PersonnelRow> & Pick<PersonnelRow, 'id' | 'code' | 'name'>): PersonnelRow {
  return { orgUnitId: 'th', orgName: '天河区分局', roles: ['经办'], certStatus: 'valid', deactivatedAt: null, ...partial };
}

const LIST: PersonnelList = {
  rootId: 'th',
  orgUnits: [
    { id: 'th', name: '天河区分局', parentId: 'gz', deactivatedAt: null },
    { id: 'sp', name: '石牌自然资源所', parentId: 'th', deactivatedAt: null },
    { id: 'ld', name: '龙洞自然资源所', parentId: 'th', deactivatedAt: null },
    { id: 'ws', name: '五山自然资源所', parentId: 'th', deactivatedAt: '2026-09-01T00:00:00Z' },
  ],
  personnel: [
    row({ id: '1', code: 'TH0102', name: '何静', roles: ['经办', '系统管理'] }),
    row({ id: '2', code: 'TH0201', name: '黄志远', roles: ['内勤'], certStatus: 'none' }),
    row({ id: '3', code: 'TH0315', name: '陈晓宁', orgUnitId: 'sp', orgName: '石牌自然资源所' }),
    row({ id: '4', code: 'TH0331', name: '王芳', orgUnitId: 'ld', orgName: '龙洞自然资源所', certStatus: 'expired' }),
    row({ id: '5', code: 'TH0350', name: '刘洋', orgUnitId: 'ld', orgName: '龙洞自然资源所', certStatus: 'none' }),
    row({ id: '6', code: 'TH0360', name: '赵敏', orgUnitId: 'ld', orgName: '龙洞自然资源所', roles: ['内勤'], certStatus: 'expiring' }),
    row({ id: '7', code: 'TH0290', name: '冯晨', orgUnitId: 'ws', orgName: '五山自然资源所', certStatus: 'none', deactivatedAt: '2026-09-01T00:00:00Z' }),
  ],
};

const CARD: PersonnelCard = {
  id: '3',
  code: 'TH0315',
  name: '陈晓宁',
  mobilePhone: '13800005521',
  orgUnitId: 'sp',
  orgName: '石牌自然资源所',
  orgParentName: '天河区分局',
  orgDeactivated: false,
  roles: ['经办', '法制审核'],
  posts: ['legal-review-lead'],
  passwordChangedAt: '2026-09-02T02:00:00Z',
  deactivatedAt: null,
  cert: { no: '44010020210315', expiresOn: '2028-05-31', status: 'valid' },
};

/** 已停用、原任职机构在用（原型 P6-restore：冯晨 TH0290，龙洞自然资源所）。 */
const OFF_CARD: PersonnelCard = {
  id: '7',
  code: 'TH0290',
  name: '冯晨',
  mobilePhone: null,
  orgUnitId: 'ld',
  orgName: '龙洞自然资源所',
  orgParentName: null,
  orgDeactivated: false,
  roles: ['经办'],
  posts: [],
  passwordChangedAt: null,
  deactivatedAt: '2026-09-01T00:00:00Z',
  cert: { no: null, expiresOn: null, status: 'none' },
};

/** 已停用、原任职机构已停用（原型 P6-restoreNewOrg：冯晨，五山自然资源所）。 */
const OFF_CARD_DEAD_ORG: PersonnelCard = { ...OFF_CARD, orgUnitId: 'ws', orgName: '五山自然资源所', orgDeactivated: true };

const ORGS = [
  { id: 'th', name: '天河区分局' },
  { id: 'ld', name: '龙洞自然资源所' },
] as OrgUnit[];

const ADMIN = ['org.tree.read', 'org.unit.register', 'org.unit.rename', 'personnel.profile.read', 'personnel.profile.register', 'audit.admin.read'];
const SUPERVISE = ['audit.admin.read', 'audit.admin.export'];
const CLERK = ['clue.read', 'case.read', 'case.open'];

function person(opcodes: string[]): Json {
  return { result: 'authenticated', name: '何静', code: 'TH0102', orgName: '天河区分局', roles: ['系统管理'], opcodes };
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

const listHtml = (filter: Partial<PersonnelFilter> = {}, opcodes = ADMIN) => renderToStaticMarkup(
  <MemoryRouter>
    <PersonnelListView list={LIST} filter={{ ...DEFAULT_FILTER, ...filter }} opcodes={opcodes} onFilter={() => undefined} />
  </MemoryRouter>,
);

describe('人员名单筛选（P5）', () => {
  it('默认含已停用人员；去掉勾选后不含', () => {
    expect(filterPersonnel(LIST, DEFAULT_FILTER)).toHaveLength(7);
    expect(filterPersonnel(LIST, { ...DEFAULT_FILTER, includeDeactivated: false }).map((r) => r.code)).not.toContain('TH0290');
  });

  it('工号或姓名、机构（含下级）、角色、执法证需处理', () => {
    expect(filterPersonnel(LIST, { ...DEFAULT_FILTER, keyword: 'th03' }).map((r) => r.code))
      .toEqual(['TH0315', 'TH0331', 'TH0350', 'TH0360']);
    expect(filterPersonnel(LIST, { ...DEFAULT_FILTER, keyword: '何' }).map((r) => r.code)).toEqual(['TH0102']);
    expect(filterPersonnel(LIST, { ...DEFAULT_FILTER, orgUnitId: 'th' })).toHaveLength(7);
    expect(filterPersonnel(LIST, { ...DEFAULT_FILTER, orgUnitId: 'ld' }).map((r) => r.code)).toEqual(['TH0331', 'TH0350', 'TH0360']);
    const filtered = { ...DEFAULT_FILTER, orgUnitId: 'ld', role: '经办', cert: 'attention' as const };
    expect(filterPersonnel(LIST, filtered).map((r) => r.code)).toEqual(['TH0331', 'TH0350']);
    expect(filterHint(LIST, filtered)).toBe('筛选：龙洞自然资源所 · 经办 · 执法证需处理');
    expect(filterHint(LIST, DEFAULT_FILTER)).toBeNull();
  });

  it('筛选写在地址栏里，往返不变', () => {
    const filter: PersonnelFilter = { keyword: '王', orgUnitId: 'ld', role: '经办', cert: 'attention', includeDeactivated: false };
    expect(filterFromSearch(searchFromFilter(filter))).toEqual(filter);
    expect(searchFromFilter(DEFAULT_FILTER).toString()).toBe('');
    expect(filterFromSearch(new URLSearchParams('cert=bogus')).cert).toBe('all');
  });
});

describe('名单页重验证', () => {
  const at = (path: string) => new URL(`http://x${path}`);
  it('只改筛选（查询参数）不重取名单；进入页面、提交写操作、显式刷新照常取数', () => {
    const run = (from: string, to: string, formMethod?: string) => shouldRevalidatePersonnelList({
      currentUrl: at(from), nextUrl: at(to), formMethod, defaultShouldRevalidate: true,
    });
    expect(run('/admin/personnel', '/admin/personnel?q=%E7%8E%8B')).toBe(false);
    expect(run('/admin/personnel?q=a', '/admin/personnel?q=ab')).toBe(false);
    expect(run('/admin/personnel?q=a', '/admin/personnel?q=a')).toBe(true);
    expect(run('/admin', '/admin/personnel?q=a')).toBe(true);
    expect(run('/admin/personnel', '/admin/personnel?q=a', 'POST')).toBe(true);
  });

  it('筛选导航时不再请求名单接口', async () => {
    const calls = serve(person(ADMIN), { '/api/admin/personnel': [200, { result: 'listed', ...LIST }] });
    const { router } = await renderRoute(fresh(), '/admin/personnel');
    const count = () => calls.filter((call) => call.url === '/api/admin/personnel').length;
    expect(count()).toBe(1);
    await router.navigate('/admin/personnel?q=%E7%8E%8B', { replace: true });
    await settled(router);
    expect(count()).toBe(1);
    await router.revalidate();
    await settled(router);
    expect(count()).toBe(2);
  });
});

describe('人员名单界面（P5）', () => {
  it('district：共 N 人、已停用行置灰、执法证情况标签，没有手机号和证号列', () => {
    const html = listHtml();
    expect(html).toContain('共 7 人');
    expect(html).toContain('其中 1 人已停用 · 第 1 页');
    expect(html).toContain('<th>工号</th><th>姓名</th><th>当前机构</th><th>角色</th><th>执法证</th><th>状态</th>');
    expect(html).toContain('<tr class="off" data-personnel="7">');
    expect(html).toContain('<span class="tag red">已过期</span>');
    expect(html).toContain('<span class="tag amber">30 天内到期</span>');
    expect(html).toContain('<span class="tag gray">未登记</span>');
    expect(html).toContain('经办、系统管理');
    expect(html).not.toMatch(/手机|执法证号/);
  });

  it('filtered：提示筛选条件', () => {
    const html = listHtml({ orgUnitId: 'ld', role: '经办', cert: 'attention' });
    expect(html).toContain('共 2 人');
    expect(html).toContain('筛选：龙洞自然资源所 · 经办 · 执法证需处理');
  });

  it('empty：没有符合条件的人员，可清空筛选、可新建；没有登记码时不显示新建', () => {
    const html = listHtml({ keyword: '张三丰' });
    expect(html).toContain('没有符合条件的人员');
    expect(html).toContain('换个关键词或清空筛选条件再试。要找的人如果还没建，可以新建。');
    expect(html).toContain('清空筛选');
    expect(html).toContain('data-requires="personnel.profile.register"');
    expect(listHtml({ keyword: '张三丰' }, ['personnel.profile.read'])).not.toContain('data-requires="personnel.profile.register"');
  });
});

describe('人员名单分页（原型 P5:37「第 1 页」）', () => {
  const many: PersonnelList = {
    ...LIST,
    personnel: Array.from({ length: PAGE_SIZE + 5 }, (_, i) => row({ id: `m${i}`, code: `TH${String(1000 + i)}`, name: `人员${i}` })),
  };
  const pageHtml = (page: number, filter: Partial<PersonnelFilter> = {}) => renderToStaticMarkup(
    <MemoryRouter>
      <PersonnelListView list={many} filter={{ ...DEFAULT_FILTER, ...filter }} opcodes={ADMIN} onFilter={() => undefined} page={page} />
    </MemoryRouter>,
  );

  it('每页 20 人；共 N 人按筛选后的全部人数；第 2 页显示其余，翻页按钮按页码禁用', () => {
    const first = pageHtml(1);
    expect(first).toContain(`共 ${PAGE_SIZE + 5} 人`);
    expect(first).toContain('第 1 页');
    expect(first.match(/data-personnel=/g)).toHaveLength(PAGE_SIZE);
    expect(first).toContain('data-pager');
    expect(first).toMatch(/<button type="button" class="btn btn-sm" disabled="">上一页<\/button>/);
    const second = pageHtml(2);
    expect(second).toContain('第 2 页');
    expect(second.match(/data-personnel=/g)).toHaveLength(5);
    expect(second).toMatch(/disabled="">下一页<\/button>/);
    expect(pageHtml(9)).toContain('第 2 页');
  });

  it('只有一页时不显示翻页按钮；有机构、角色、证件筛选且只有一页时只写筛选（原型 P5 filtered）', () => {
    expect(listHtml()).not.toContain('data-pager');
    expect(listHtml({ orgUnitId: 'ld' })).toMatch(/<span class="hint">筛选：龙洞自然资源所<\/span>/);
    expect(pageHtml(2, { role: '经办' })).toContain('筛选：经办 · 第 2 页');
  });

  it('页码写在地址栏，改筛选回到第 1 页，翻页保留筛选', () => {
    expect(pageFromSearch(new URLSearchParams('page=3'))).toBe(3);
    expect(pageFromSearch(new URLSearchParams('page=0'))).toBe(1);
    expect(pageFromSearch(new URLSearchParams('page=x'))).toBe(1);
    expect(searchWithPage(new URLSearchParams('q=何&role=经办'), 2).toString()).toBe('q=%E4%BD%95&role=%E7%BB%8F%E5%8A%9E&page=2');
    expect(searchWithPage(new URLSearchParams('q=a&page=2'), 1).toString()).toBe('q=a');
    expect(searchFromFilter({ ...DEFAULT_FILTER, keyword: 'a' }).has('page')).toBe(false);
    expect(paginate([], 1)).toEqual({ rows: [], page: 1, pages: 1 });
    expect(listHint(null, 0, 1, 1)).toBe('第 1 页');
  });
});

describe('人员卡片（P6 view）', () => {
  const card = (
    partial: Partial<PersonnelCard> = {},
    registered = false,
    props: {
      self?: boolean;
      canUpdate?: boolean;
      canUpdateCert?: boolean;
      canDeactivate?: boolean;
      canRestore?: boolean;
      canEndSessions?: boolean;
      canResetPassword?: boolean;
      dangerBusy?: boolean;
      notice?: CardNotice | null;
      edit?: EditState | null;
    } = {},
  ) => renderToStaticMarkup(
    <MemoryRouter>
      <PersonnelCardView
        card={{ ...CARD, ...partial }}
        now={new Date('2026-10-17T04:00:00Z')}
        registered={registered}
        {...props}
      />
    </MemoryRouter>,
  );

  it('手机号默认遮挡，可点开；留痕提示；口令改过日期；执法证有效', () => {
    const html = card();
    expect(html).toContain('138****5521');
    expect(html).not.toContain('13800005521');
    expect(html).toContain('显示完整号码');
    expect(html).toContain('打开人员详情会留痕');
    expect(html).toContain('已改过初始口令（2026-09-02）');
    expect(html).toContain('经办、法制审核');
    expect(html).toContain('<div class="k">当前机构</div><div>天河区分局石牌自然资源所</div>');
    expect(html).toContain('44010020210315');
    expect(html).toContain('可以启动核查、立案，可以担任主办人或协办人。');
  });

  it('岗位标记一段（spec 例外）：显示标记中文名；没有标记时显示「无」', () => {
    expect(card()).toContain('<span class="tag" data-post="legal-review-lead">法制审核负责人</span>');
    expect(card({ posts: [] })).toMatch(/岗位标记<\/div><div>无<\/div>/);
  });

  it('登记后回到卡片：提示当面或电话告知初始口令', () => {
    const html = card({ passwordChangedAt: null }, true);
    expect(html).toContain('请当面或电话告知初始口令');
    expect(html).toContain('尚未改过初始口令');
    expect(card()).not.toContain('data-notice="registered"');
  });

  it('没有执法证登记码时不出登记按钮（#133）', () => {
    expect(card()).not.toContain('data-requires="personnel.cert.update"');
    expect(card({}, false, { canUpdateCert: true })).toContain('data-requires="personnel.cert.update"');
  });

  it('执法证一段（#133）：证件状态只写「有效」「失效」，未登记写破折号', () => {
    expect(card()).toContain('<div class="k">证件状态</div><div>有效</div>');
    expect(card({ cert: { no: '44010020210315', expiresOn: '2028-05-31', status: 'invalid' } }))
      .toContain('<div class="k">证件状态</div><div>失效</div>');
    expect(card({ cert: { no: '44010020160412', expiresOn: '2026-09-30', status: 'expired' } }))
      .toContain('<div class="k">证件状态</div><div>有效</div>');
    expect(card({ cert: { no: null, expiresOn: null, status: 'none' } }))
      .toContain('<div class="k">证件状态</div><div>—</div>');
  });

  it('执法证一段（#133）：按钮按情况写「登记执法证」或「变更执法证」（原型 P6:23）', () => {
    expect(card({}, false, { canUpdateCert: true })).toContain('>变更执法证</button>');
    expect(card({ cert: { no: '44010020210315', expiresOn: '2028-05-31', status: 'invalid' } }, false, { canUpdateCert: true }))
      .toContain('>变更执法证</button>');
    expect(card({ cert: { no: null, expiresOn: null, status: 'none' } }, false, { canUpdateCert: true })).toContain('>登记执法证</button>');
  });

  it('执法证失效（#133）：红色「失效」标记与说明句，不再按有效期推导', () => {
    const html = card({ cert: { no: '44010020210315', expiresOn: '2099-12-31', status: 'invalid' } });
    expect(html).toContain('<span class="tag red">失效</span>');
    expect(html).toContain('证件状态为失效。');
    expect(html).toContain('不能启动核查、不能立案、不能担任主办人或协办人。核对证件后请改回有效，或登记换发的新证。');
    expect(html).toContain('class="banner danger"');
  });

  it('卡片按钮只挂已入名册的码：编辑与调岗用 update，重设、结束、停用各挂自己的码，没给执法证码时登记按钮不出现', () => {
    const html = card({}, false, { canUpdate: true, canDeactivate: true, canEndSessions: true, canResetPassword: true });
    expect(html).toContain('需谨慎的操作');
    expect(html.match(/data-requires="[^"]+"/g)).toEqual([
      `data-requires="${PERSONNEL_UPDATE}"`,
      `data-requires="${PERSONNEL_UPDATE}"`,
      `data-requires="${PERSONNEL_PASSWORD_RESET}"`,
      `data-requires="${PERSONNEL_SESSIONS_END}"`,
      `data-requires="${PERSONNEL_DEACTIVATE}"`,
    ]);
    expect(html).not.toContain('personnel.cert.update');
    // 没有编辑码时按钮置灰。
    expect(card()).toMatch(/data-requires="personnel\.profile\.update" disabled/);
  });

  it('已停用卡片：危险操作区只有恢复人员一行，没有调岗、结束、停用入口；编辑与执法证按钮不可达（v0.4、#158）', () => {
    const off = card({ deactivatedAt: '2026-01-01T00:00:00Z' }, false, {
      canUpdate: true,
      canRestore: true,
      canUpdateCert: true,
    });
    expect(off).toContain('需谨慎的操作');
    expect(off.match(/data-requires="[^"]+"/g)).toEqual([
      `data-requires="${PERSONNEL_UPDATE}"`,
      `data-requires="${PERSONNEL_RESTORE}"`,
    ]);
    expect(off).not.toContain('data-action="transfer"');
    expect(off).not.toContain('data-action="endsessions"');
    expect(off).not.toContain('data-action="deactivate"');
    expect(off).not.toContain('data-requires="personnel.cert.update"');
    expect(off).not.toContain('>登记执法证</button>');
    expect(off).not.toContain('>变更执法证</button>');
    expect(off).toMatch(/data-requires="personnel\.profile\.update" disabled/);
  });

  it('当前机构带上级名（原型 P6:30）；本机构是根机构或上级是根机构时只写本名（原型 P6:69）；没有当前任职写「—」；机构已停用补「（已停用）」', () => {
    expect(orgText(CARD)).toBe('天河区分局石牌自然资源所');
    expect(orgText({ orgName: '天河区分局', orgParentName: null })).toBe('天河区分局');
    expect(orgText({ orgName: '广州市自然资源局', orgParentName: null })).toBe('广州市自然资源局');
    expect(orgText({ orgName: null, orgParentName: null })).toBe('—');
    expect(orgText({ ...CARD, orgDeactivated: true })).toBe('天河区分局石牌自然资源所（已停用）');
    expect(orgText({ orgName: '五山自然资源所', orgParentName: null, orgDeactivated: true })).toBe('五山自然资源所（已停用）');
  });

  it('遮挡与执法证说明', () => {
    expect(maskPhone(null)).toBe('—');
    expect(passwordText({ ...CARD, deactivatedAt: '2026-01-01T00:00:00Z' })).toBe('—');
    const now = new Date('2026-10-17T04:00:00Z');
    expect(certNote({ no: 'x', expiresOn: '2026-11-08', status: 'expiring' }, now).text).toContain('还有 22 天到期');
    expect(certNote({ no: 'x', expiresOn: '2026-09-30', status: 'expired' }, now).text).toContain('已于 2026-09-30 过期');
    expect(certNote({ no: null, expiresOn: null, status: 'none' }, now).text).toContain('尚未登记执法证');
    expect(certNote({ no: 'x', expiresOn: '2099-12-31', status: 'invalid' }, now).tone).toBe('danger');
  });
});

describe('执法证情况与首页统计（#133）', () => {
  const CERT_LIST: PersonnelList = {
    rootId: 'th',
    orgUnits: [{ id: 'th', name: '天河区分局', parentId: null, deactivatedAt: null }],
    personnel: [
      row({ id: 'c1', code: 'C1', name: '一', certStatus: 'valid' }),
      row({ id: 'c2', code: 'C2', name: '二', certStatus: 'expiring' }),
      row({ id: 'c3', code: 'C3', name: '三', certStatus: 'expired' }),
      row({ id: 'c4', code: 'C4', name: '四', certStatus: 'invalid' }),
      row({ id: 'c5', code: 'C5', name: '五', certStatus: 'none' }),
      row({ id: 'c6', code: 'C6', name: '六', certStatus: 'none', deactivatedAt: '2026-09-01T00:00:00Z' }),
    ],
  };

  it('情况多一项「失效」：标记、筛选项与「需处理」都含它', () => {
    expect(CERT_TAG.invalid).toEqual({ label: '失效', tone: 'red' });
    expect(CERT_FILTERS).toEqual(['all', 'attention', 'valid', 'expiring', 'expired', 'invalid', 'none']);
    expect(CERT_FILTER_LABEL.invalid).toBe('失效');
    expect(filterPersonnel(CERT_LIST, { ...DEFAULT_FILTER, cert: 'invalid' }).map((item) => item.code)).toEqual(['C4']);
    // 「需处理」= 已过期、失效、未登记、临期；默认含已停用人员
    expect(filterPersonnel(CERT_LIST, { ...DEFAULT_FILTER, cert: 'attention' }).map((item) => item.code))
      .toEqual(['C2', 'C3', 'C4', 'C5', 'C6']);
    expect(filterPersonnel(CERT_LIST, { ...DEFAULT_FILTER, cert: 'attention', includeDeactivated: false }).map((item) => item.code))
      .toEqual(['C2', 'C3', 'C4', 'C5']);
    expect(filterFromSearch(new URLSearchParams('cert=invalid')).cert).toBe('invalid');
  });

  it('「需要留意的执法证」四行人数：已停用的人不计（原型 P3:29）', () => {
    expect(certAttentionOf(CERT_LIST.personnel)).toEqual({ expiring: 1, expired: 1, invalid: 1, none: 1 });
  });

  it('有执法资格的人数只算有效与临期：失效、已过期、未登记都不算（#133 fail-closed）', () => {
    expect(qualifiedPersonnelCount(CERT_LIST.personnel)).toBe(2);
    expect(qualifiedPersonnelCount(CERT_LIST.personnel.filter((item) => item.certStatus !== 'invalid'))).toBe(2);
    expect(qualifiedPersonnelCount([])).toBe(0);
  });

  it('卡片「证件状态」一行只写有效、失效，未登记写破折号', () => {
    expect(certRecordLabel('invalid')).toBe('失效');
    expect(certRecordLabel('expired')).toBe('有效');
    expect(certRecordLabel('expiring')).toBe('有效');
    expect(certRecordLabel('valid')).toBe('有效');
    expect(certRecordLabel('none')).toBe('—');
  });

  it('起表值取卡片当前值；未登记时两项为空、状态默认有效', () => {
    expect(certEditFrom(CARD)).toEqual({ certNo: '44010020210315', certExpiresOn: '2028-05-31', certStatus: 'valid' });
    expect(certEditFrom({ cert: { no: null, expiresOn: null, status: 'none' } }))
      .toEqual({ certNo: '', certExpiresOn: '', certStatus: 'valid' });
    expect(certEditFrom({ cert: { no: ' 44010020210315 ', expiresOn: '2028-05-31', status: 'invalid' } }))
      .toEqual({ certNo: '44010020210315', certExpiresOn: '2028-05-31', certStatus: 'invalid' });
    expect(certEditFrom({ cert: { no: 'x', expiresOn: '2026-09-30', status: 'expired' } }).certStatus).toBe('valid');
  });
});

describe('执法证登记表单（P6 certEdit，#133）', () => {
  const FILLED: CertUpdateInput = { certNo: '44010020260917', certExpiresOn: '2031-09-16', certStatus: 'valid' };
  const form = (
    failure: Parameters<typeof CertForm>[0]['failure'] = null,
    input: CertUpdateInput = FILLED,
  ) => renderToStaticMarkup(
    <MemoryRouter>
      <CertForm
        input={input}
        failure={failure}
        busy={false}
        onInput={() => undefined}
        onSubmit={() => undefined}
        onCancel={() => undefined}
      />
    </MemoryRouter>,
  );

  it('三项都必填，文案取自原型 P6:21', () => {
    const html = form();
    expect(html).toContain('<div class="section-title">执法证</div>');
    expect(html).toContain('<label for="c-no">执法证号<span class="req">*</span></label>');
    expect(html).toContain('value="44010020260917"');
    expect(html).toContain('按证件原样填写。一人一证。');
    expect(html).toContain('<label for="c-expires">有效期至<span class="req">*</span></label>');
    expect(html).toContain('value="2031-09-16"');
    expect(html).toContain('<label for="c-status">证件状态<span class="req">*</span></label>');
    expect(html).toMatch(/<option value="valid"[^>]*>有效<\/option><option value="invalid"[^>]*>失效<\/option>/);
    expect(html).toContain('换发新证时直接改为新证号和新有效期。只能逐条人工登记，请对照实物证件核对。');
    expect(html).toContain('>取消</button>');
    expect(html).toContain('>保存执法证</button>');
  });

  it('选了「失效」时下拉停在失效', () => {
    expect(form(null, { ...FILLED, certStatus: 'invalid' })).toMatch(/<option value="invalid" selected[^>]*>失效<\/option>/);
    expect(form()).toMatch(/<option value="valid" selected[^>]*>有效<\/option>/);
  });

  it('校验不过：按字段标红，并写还有几处需要修改', () => {
    const html = form({
      ok: false,
      fields: { certNo: '请填写执法证号', certExpiresOn: '请按「年-月-日」填写有效的日期，如 2027-06-30' },
      message: null,
    });
    expect(html).toContain('还有 2 处需要修改，改好后再保存。');
    expect(html).toContain('<div class="err" data-error="certNo">请填写执法证号</div>');
    expect(html).toContain('<div class="err" data-error="certExpiresOn">请按「年-月-日」填写有效的日期，如 2027-06-30</div>');
    expect(html).not.toContain('按证件原样填写。一人一证。');
  });

  it('越权与服务失败写整页提示，不写字段提示', () => {
    const denied = form({ ok: false, fields: {}, message: '你没有权限执行这个操作，或这个人员不在你的范围内。' });
    expect(denied).toContain('你没有权限执行这个操作，或这个人员不在你的范围内。');
    expect(denied).not.toContain('还有 0 处需要修改');
  });
});

describe('执法证登记接口（#133）', () => {
  const INPUT: CertUpdateInput = { certNo: 'GD-0001', certExpiresOn: '2031-09-16', certStatus: 'valid' };
  const url = '/api/admin/personnel/3/cert';

  it('成功：POST 到人员卡片的执法证接口，交出三项，返回体不含证号', async () => {
    const store = fresh();
    const calls = serve(person([...ADMIN, 'personnel.cert.update']), { [url]: [200, { result: 'updated' }] });
    await store.dispatch(loadSession());
    expect(await updateCert(store.dispatch, '3', INPUT)).toEqual({ ok: true });
    const post = calls.find((call) => call.url === url);
    expect(post?.init?.method).toBe('POST');
    expect(JSON.parse(String(post?.init?.body))).toEqual(INPUT);
  });

  it('校验不过：规则码换成字段提示，不露规则码', async () => {
    const store = fresh();
    serve(person(ADMIN), {
      [url]: [400, { result: 'non-compliant', rules: ['cert-no-required', 'cert-expires-on-invalid', 'cert-status-unknown'] }],
    });
    await store.dispatch(loadSession());
    expect(await updateCert(store.dispatch, '3', INPUT)).toEqual({
      ok: false,
      fields: {
        certNo: '请填写执法证号',
        certExpiresOn: '请按「年-月-日」填写有效的日期，如 2027-06-30',
        certStatus: '请选择证件状态：有效或失效',
      },
      message: null,
    });
  });

  it('越权、人员不存在、服务失败各写一句人能读的话', async () => {
    const store = fresh();
    const messageOf = (result: CertUpdateResult) => (result.ok ? null : result.message);
    serve(person(ADMIN), { [url]: [403, { reason: 'scope-denied' }] });
    await store.dispatch(loadSession());
    expect(await updateCert(store.dispatch, '3', INPUT)).toEqual({
      ok: false, fields: {}, message: '你没有权限执行这个操作，或这个人员不在你的范围内。',
    });
    serve(person(ADMIN), { [url]: [404, { result: 'not-found' }] });
    expect(messageOf(await updateCert(store.dispatch, '3', INPUT))).toContain('没有找到这个人员');
    serve(person(ADMIN), { [url]: [500, {}] });
    expect(messageOf(await updateCert(store.dispatch, '3', INPUT)))
      .toBe('网络或服务暂时不可用，请稍后重试。问题持续时请联系本单位的系统管理人员。');
  });

  it('对方已停用：409 invalid-state（personnel-deactivated）出定稿拒绝句，不露服务端原句', async () => {
    const store = fresh();
    serve(person(ADMIN), {
      [url]: [409, {
        result: 'invalid-state',
        reason: 'personnel-deactivated',
        message: '服务端原句（界面不应显示）',
      }],
    });
    await store.dispatch(loadSession());
    expect(await updateCert(store.dispatch, '3', INPUT)).toEqual({
      ok: false,
      fields: {},
      message: CERT_DEACTIVATED_MESSAGE,
      deactivated: true,
    });
    expect(CERT_DEACTIVATED_MESSAGE).toBe('这个人员已停用，不能登记或修改执法证。请先恢复，再办理。');
  });
});

describe('执法证表单的保存去向（#158）', () => {
  it('成功关表单；对方已停用关闭旧表单并出定稿拒绝句；其余失败留在表单里', () => {
    expect(certSaveTransition({ ok: true })).toEqual({ editing: false, failure: null, denied: null });
    expect(certSaveTransition({
      ok: false, fields: {}, message: CERT_DEACTIVATED_MESSAGE, deactivated: true,
    })).toEqual({ editing: false, failure: null, denied: CERT_DEACTIVATED_MESSAGE });
    const failure = { ok: false as const, fields: { certNo: '请填写执法证号' }, message: null };
    expect(certSaveTransition(failure)).toEqual({ editing: true, failure, denied: null });
  });
});

describe('新建人员（P6 create / createInvalid）', () => {
  const form = (failure: Parameters<typeof PersonnelCreateForm>[0]['failure'] = null) => renderToStaticMarkup(
    <MemoryRouter>
      <PersonnelCreateForm orgUnits={ORGS} input={EMPTY_INPUT} failure={failure} busy={false} onInput={() => undefined} onSubmit={() => undefined} />
    </MemoryRouter>,
  );

  it('create：六项必填、七个角色、两个岗位标记、七条口令要求、执法证可稍后登记', () => {
    const html = form();
    expect(html.match(/class="req"/g)).toHaveLength(6);
    for (const role of ['内勤', '经办', '法制审核', '行政审核', '行政审批', '监督', '系统管理']) expect(html).toContain(` ${role}`);
    expect(html).toContain('data-post="legal-review-lead"');
    expect(html).toContain('data-post="legal-affairs-leader"');
    expect(html).toContain('分管法制的局领导');
    expect(html.match(/data-rule=/g)).toHaveLength(7);
    expect(html).toContain('请当面或电话告知，不要通过群聊发送。');
    expect(html).toContain('不登记执法证也能建人员；未登记的人员不能启动核查、不能立案。');
    // 原型 P6:51：执法证号、有效期至两个输入框，可留空，不是必填
    expect(html).toContain('<label for="p-cert-no">执法证号</label>');
    expect(html).toContain('placeholder="未登记可留空"');
    expect(html).toContain('<label for="p-cert-expires">有效期至</label>');
    expect(html).toContain('placeholder="年-月-日"');
    expect(html).toContain('<option value="ld">龙洞自然资源所</option>');
  });

  it('createInvalid：「还有 3 处」按字段计，口令未满足项标红', () => {
    const failure = {
      ok: false as const,
      fields: { name: '请填写姓名', mobilePhone: '这个手机号已被其他人员使用，请核对' },
      passwordRules: ['too-short', 'contains-code'],
      message: null,
    };
    expect(problemCount(failure)).toBe(3);
    const html = form(failure);
    expect(html).toContain('还有 3 处需要修改，改好后再保存。');
    expect(html).toContain('请填写姓名');
    expect(html).toContain('这个手机号已被其他人员使用，请核对');
    expect(html).toContain('口令至少 10 位（未满足）');
    expect(html).toContain('不能包含本人工号（未满足）');
    expect(html).not.toContain('口令最多 64 位（未满足）');
  });
});

// ---------- 编辑与调岗（#129） ----------

/** 根机构守卫的一句可读原因（后端 ROOT_GUARD_MESSAGE 同文，来源 #105 错误码表「409 可读原因」）。 */
const ROOT_GUARD = '根机构上只剩这一名系统管理人员。系统必须始终保留一名在根机构任职、未停用的系统管理人员，请先给根机构补上另一名系统管理人员。';
const FAILED_SENTENCE = '网络或服务暂时不可用，请稍后重试。问题持续时请联系本单位的系统管理人员。';

const EDIT_INPUT: EditInput = { name: '陈晓宁', mobilePhone: '13800005521', roles: ['经办', '法制审核'], posts: ['legal-review-lead'] };

const editState = (partial: Partial<EditState> = {}): EditState => ({
  input: EDIT_INPUT,
  failure: null,
  busy: false,
  onInput: () => undefined,
  onCancel: () => undefined,
  onSubmit: () => undefined,
  ...partial,
});

const DESTS: TransferDestination[] = [
  { id: 'gz', name: '广州市自然资源局', parentId: null },
  { id: 'th', name: '天河区分局', parentId: 'gz' },
  { id: 'sp', name: '石牌自然资源所', parentId: 'th' },
  { id: 'hz', name: '海珠区分局', parentId: 'gz' },
  { id: 'nh', name: '海珠区分局南华自然资源所', parentId: 'hz' },
];

const transferState = (partial: Partial<TransferState> = {}): TransferState => ({
  destinations: DESTS,
  loadFailed: false,
  orgUnitId: '',
  failure: null,
  busy: false,
  onChange: () => undefined,
  onCancel: () => undefined,
  onSubmit: () => undefined,
  ...partial,
});

const visibleText = (html: string) => html.replace(/<[^>]*>/g, ' ');
const RAW_TEXT = /personnel\.|audit\.|org\.|permission-denied|scope-denied|invalid-state|already-exists|non-compliant|not-found|root-admin-required|-required|too-short|contains-code|legal-review-lead|legal-affairs-leader/;

describe('人员卡片编辑（P6 edit / selfEdit，#129）', () => {
  const form = (self: boolean, partial: Partial<EditState> = {}) => renderToStaticMarkup(
    <MemoryRouter>
      <PersonnelCardView
        card={CARD}
        now={new Date('2026-10-17T04:00:00Z')}
        registered={false}
        self={self}
        canUpdate
        edit={editState(partial)}
      />
    </MemoryRouter>,
  );

  it('edit：工号只读，姓名手机号可改，七个角色、两个岗位标记，提示句照原型 P6', () => {
    const html = form(false);
    expect(html).toContain('<input id="e-code" class="input ro" disabled="" value="TH0315"/>');
    expect(html).toContain('<input id="e-name" class="input" value="陈晓宁"');
    expect(html).toContain('value="13800005521"');
    expect(html.match(/data-role=/g)).toHaveLength(7);
    expect(html).toContain('data-role="经办" checked');
    expect(html).toContain('data-role="法制审核" checked');
    expect(html).not.toMatch(/data-role="系统管理" checked/);
    expect(html.match(/type="checkbox" data-post=/g)).toHaveLength(2);
    expect(html).toContain('data-post="legal-review-lead" checked');
    expect(html).not.toMatch(/data-post="legal-affairs-leader" checked/);
    expect(html).toContain('至少保留一个角色。角色变化在对方下一次操作时生效，不用重新登录。');
    expect(html).toContain('手机号用于登录，全系统不能重复。');
    expect(html).toContain('取消');
    expect(html).toContain('保存');
    // 编辑态不出只读 kv 与执法证一段（原型 P6 edit）。
    expect(html).not.toContain('打开人员详情会留痕</div></div><div class="kv">');
    expect(html).not.toContain('执法证号');
  });

  it('selfEdit：角色与岗位标记置灰并说明原因，姓名手机号照改（G23）', () => {
    const html = form(true);
    expect(html).toContain('data-role="经办" disabled="" checked=""');
    expect(html).toContain('data-post="legal-review-lead" disabled="" checked=""');
    expect(html).toContain('data-reason="self-role"');
    expect(html).toContain('不能修改自己的角色。如需调整，请找本单位其他系统管理人员办理。');
    expect(html).toContain('不能修改自己的岗位标记。如需调整，请找本单位其他系统管理人员办理。');
    expect(html).not.toContain('至少保留一个角色');
    expect(html).not.toMatch(/id="e-name"[^>]*disabled/);
    expect(html).not.toMatch(/id="e-phone"[^>]*disabled/);
  });

  it('编辑失败：字段提示落在对应输入下，根机构守卫一句放整页提示，不露原因码', () => {
    const html = form(false, {
      failure: { fields: { name: '请填写姓名', mobilePhone: '这个手机号已被其他人员使用，请核对' }, message: ROOT_GUARD },
    });
    expect(html).toContain('data-error="name">请填写姓名');
    expect(html).toContain('这个手机号已被其他人员使用，请核对');
    expect(html).toContain(ROOT_GUARD);
    expect(visibleText(html)).not.toMatch(RAW_TEXT);
  });

  it('编辑保存中（busy）禁用调岗入口，避免编辑与调岗两回调互相覆盖卡片（#129 复核线程 3）', () => {
    // busy 时调岗按钮置灰：编辑请求在途时不能再开调岗弹窗提交。
    expect(form(false, { busy: true })).toMatch(/data-action="transfer"[^>]*disabled/);
    // 非 busy（可编辑）时调岗按钮照常可点。
    expect(form(false, { busy: false })).not.toMatch(/data-action="transfer"[^>]*disabled/);
  });
});

describe('调岗弹窗（P6 transfer，#129）', () => {
  const dialog = (partial: Partial<TransferState> = {}) => renderToStaticMarkup(
    <MemoryRouter>
      <TransferDialog card={CARD} transfer={transferState(partial)} />
    </MemoryRouter>,
  );

  it('标题带姓名，现机构只读，调入机构整棵树、提示不限本区，效果两句照原型', () => {
    const html = dialog();
    expect(html).toContain('调岗：陈晓宁');
    expect(html).toContain('<input id="t-from" class="input ro" disabled="" value="天河区分局石牌自然资源所"/>');
    expect(html).toContain('调入机构不限于本区。');
    expect(html).toContain('对方下一次操作起，只能看到新机构范围内的线索和案件；');
    expect(html).toContain('对方经手的历史记录不变。');
    expect(html).toContain('<option value="nh">海珠区分局南华自然资源所</option>');
    // 未选机构时确认调岗置灰，选了才可点。
    expect(html).toContain('disabled="">确认调岗');
    expect(dialog({ orgUnitId: 'nh' })).not.toContain('disabled="">确认调岗');
  });

  it('失败一句显示在弹窗里（根机构守卫），不露原因码；读取失败提示关闭后重试', () => {
    const html = dialog({ failure: { fields: {}, message: ROOT_GUARD } });
    expect(html).toContain(ROOT_GUARD);
    expect(visibleText(html)).not.toMatch(RAW_TEXT);
    expect(dialog({ destinations: null, loadFailed: true })).toContain('无法读取可选机构，请关闭后重试。');
  });

  it('目的地按树的先序；编辑表单初值取卡片当前态', () => {
    const shuffled = [DESTS[2], DESTS[4], DESTS[0], DESTS[3], DESTS[1]];
    // 先序 = 上级在前，同级按接口给的次序（sp、nh、gz、hz、th → gz 的子级 hz 先于 th 出现）。
    expect(destinationsInTreeOrder(shuffled).map((unit) => unit.id)).toEqual(['gz', 'hz', 'nh', 'th', 'sp']);
    expect(editInputFromCard(CARD)).toEqual(EDIT_INPUT);
  });
});

// ---------- 停用、恢复、结束全部会话（#130） ----------

/** 数据范围内在用的机构（原型 P6-restoreNewOrg 的三个选项；五山已停用不在内）。 */
const RESTORE_ORGS = [
  { id: 'th', name: '天河区分局', parentId: null },
  { id: 'sp', name: '石牌自然资源所', parentId: 'th' },
  { id: 'ld', name: '龙洞自然资源所', parentId: 'th' },
] as OrgUnit[];

const confirmState = (partial: Partial<ConfirmState> = {}): ConfirmState => ({
  busy: false,
  message: null,
  onCancel: () => undefined,
  onSubmit: () => undefined,
  ...partial,
});

const restoreState = (partial: Partial<RestoreState> = {}): RestoreState => ({
  orgUnits: [],
  loadFailed: false,
  initialPassword: '',
  orgUnitId: '',
  failure: null,
  busy: false,
  onPassword: () => undefined,
  onOrg: () => undefined,
  onCancel: () => undefined,
  onSubmit: () => undefined,
  ...partial,
});

const resetPasswordState = (partial: Partial<ResetPasswordState> = {}): ResetPasswordState => ({
  password: '',
  failure: null,
  busy: false,
  onPassword: () => undefined,
  onCancel: () => undefined,
  onSubmit: () => undefined,
  ...partial,
});

describe('危险操作区（P6，#130）', () => {
  const view = (
    partial: Partial<PersonnelCard> = {},
    props: {
      self?: boolean;
      canUpdate?: boolean;
      canDeactivate?: boolean;
      canRestore?: boolean;
      canEndSessions?: boolean;
      canResetPassword?: boolean;
      dangerBusy?: boolean;
      notice?: CardNotice | null;
    } = {},
  ) => renderToStaticMarkup(
    <MemoryRouter>
      <PersonnelCardView card={{ ...CARD, ...partial }} now={new Date('2026-10-17T04:00:00Z')} registered={false} {...props} />
    </MemoryRouter>,
  );

  it('在职卡片：调岗、重设初始口令、结束全部会话、停用人员四行，标题与提示句照原型，行序照原型', () => {
    const html = view({}, { canUpdate: true, canDeactivate: true, canEndSessions: true, canResetPassword: true });
    expect(html).toContain('重设初始口令<div class="help">同时解锁，并结束对方全部会话</div>');
    expect(html).toContain('结束全部会话<div class="help">对方的全部会话在下一次操作时结束</div>');
    expect(html).toContain('停用人员<div class="help">停用后不能登录，记录照常保留</div>');
    expect(html).toContain(`data-requires="${PERSONNEL_PASSWORD_RESET}" data-action="resetpw"`);
    expect(html).toContain(`data-requires="${PERSONNEL_SESSIONS_END}" data-action="endsessions"`);
    expect(html).toContain(`data-requires="${PERSONNEL_DEACTIVATE}" data-action="deactivate"`);
    expect(html).toContain('>重设</button>');
    expect(html).toContain('>结束</button>');
    expect(html).toContain('>停用</button>');
    // 执法证登记/变更由 #133 补入。
    expect(html).not.toContain('personnel.cert.update');
    // 行序照原型：调岗在前，重设居中，结束在后，停用最后。
    expect(html.indexOf('data-action="transfer"')).toBeLessThan(html.indexOf('data-action="resetpw"'));
    expect(html.indexOf('data-action="resetpw"')).toBeLessThan(html.indexOf('data-action="endsessions"'));
    expect(html.indexOf('data-action="endsessions"')).toBeLessThan(html.indexOf('data-action="deactivate"'));
  });

  it('已停用卡片：只有恢复人员一行，提示句照原型；恢复按钮挂恢复码', () => {
    const html = view({ deactivatedAt: '2026-09-01T00:00:00Z' }, { canRestore: true });
    expect(html).toContain('恢复人员<div class="help">恢复后需用新的初始口令登录</div>');
    expect(html).toContain(`data-requires="${PERSONNEL_RESTORE}" data-action="restore"`);
    expect(html).toContain('>恢复</button>');
  });

  it('本人卡片：调岗、重设、结束、停用全部置灰并给本人说明横幅；在职卡片没有恢复一行（G23）', () => {
    const html = view({}, { self: true, canUpdate: true, canDeactivate: true, canEndSessions: true, canResetPassword: true });
    expect(html).toMatch(/data-action="transfer"[^>]*disabled/);
    expect(html).toMatch(/data-action="resetpw"[^>]*disabled/);
    expect(html).toMatch(/data-action="endsessions"[^>]*disabled/);
    expect(html).toMatch(/data-action="deactivate"[^>]*disabled/);
    expect(html).toContain('这是你本人。不能给自己调岗、重设口令、结束会话或停用，请找本单位其他系统管理人员办理。');
    expect(html).not.toContain('恢复人员');
  });

  it('没有对应码置灰；编辑或危险动作在途（busy）时相关入口置灰', () => {
    const denied = view({}, { canUpdate: true });
    expect(denied).toMatch(/data-action="deactivate"[^>]*disabled/);
    expect(denied).toMatch(/data-action="endsessions"[^>]*disabled/);
    expect(denied).toMatch(/data-action="resetpw"[^>]*disabled/);
    expect(denied).not.toMatch(/data-action="transfer"[^>]*disabled/);
    const busy = view({}, { canUpdate: true, canDeactivate: true, canEndSessions: true, canResetPassword: true, dangerBusy: true });
    expect(busy).toMatch(/data-action="deactivate"[^>]*disabled/);
    expect(busy).toMatch(/data-action="endsessions"[^>]*disabled/);
    expect(busy).toMatch(/data-action="resetpw"[^>]*disabled/);
    expect(busy).toMatch(/data-action="transfer"[^>]*disabled/);
    const restoreBusy = view({ deactivatedAt: '2026-09-01T00:00:00Z' }, { canRestore: true, dangerBusy: true });
    expect(restoreBusy).toMatch(/data-action="restore"[^>]*disabled/);
  });

  it('结束全部会话、重设初始口令成功后各给一句结果横幅，横幅的 data-notice 分两种', () => {
    const ended = view({}, { notice: { kind: 'sessions-ended', text: SESSIONS_ENDED_NOTICE } });
    expect(ended).toContain('data-notice="sessions-ended"');
    expect(ended).toContain(SESSIONS_ENDED_NOTICE);
    const reset = view({}, { notice: { kind: 'password-reset', text: resetPasswordNotice(CARD.name) } });
    expect(reset).toContain('data-notice="password-reset"');
    expect(reset).toContain(`已为「${CARD.name}」重设初始口令。`);
    expect(view()).not.toContain('data-notice="sessions-ended"');
    expect(view()).not.toContain('data-notice="password-reset"');
  });
});

describe('停用与结束全部会话弹窗（P6 deactivate / endsessions，#130）', () => {
  const dialog = (kind: 'deactivate' | 'endsessions', partial: Partial<ConfirmState> = {}) => renderToStaticMarkup(
    <MemoryRouter>
      {kind === 'deactivate'
        ? <DeactivateDialog card={CARD} confirm={confirmState(partial)} />
        : <EndSessionsDialog card={CARD} confirm={confirmState(partial)} />}
    </MemoryRouter>,
  );

  it('停用确认：标题带姓名，三条后果照原型，确认停用为危险按钮', () => {
    const html = dialog('deactivate');
    expect(html).toContain('停用「陈晓宁」？');
    expect(html).toContain('<li>对方的全部会话会在下一次操作时结束，之后不能再登录；</li>');
    expect(html).toContain('<li>对方经手的线索、案件和记录照常保留；</li>');
    expect(html).toContain('<li>以后可以恢复，恢复时需要重设初始口令。</li>');
    expect(html).toContain('取消');
    expect(html).toContain('class="btn btn-danger"');
    expect(html).toContain('确认停用');
  });

  it('结束全部会话确认：适用情形一句、两条后果照原型，确认结束为危险按钮', () => {
    const html = dialog('endsessions');
    expect(html).toContain('结束「陈晓宁」的全部会话？');
    expect(html).toContain('适用于怀疑口令泄露、设备丢失等情况。');
    expect(html).toContain('<li>对方的全部会话和全部「记住我」，会在下一次操作时结束；</li>');
    expect(html).toContain('<li>对方可以用原口令重新登录。如怀疑口令泄露，请改用「重设初始口令」。</li>');
    expect(html).toContain('确认结束');
  });

  it('busy 时取消与确认都置灰；失败一句显示在弹窗里，不露原因码', () => {
    const busy = dialog('deactivate', { busy: true });
    expect(busy).toMatch(/class="btn" disabled="">取消/);
    expect(busy).toMatch(/class="btn btn-danger" disabled="">确认停用/);
    const failed = dialog('endsessions', { message: ROOT_GUARD });
    expect(failed).toContain(ROOT_GUARD);
    expect(visibleText(failed)).not.toMatch(RAW_TEXT);
  });
});

describe('恢复弹窗（P6 restore / restoreNewOrg，#130）', () => {
  const dialog = (card: PersonnelCard, partial: Partial<RestoreState> = {}) => renderToStaticMarkup(
    <MemoryRouter>
      <RestoreDialog card={card} restore={restoreState(partial)} />
    </MemoryRouter>,
  );

  it('restore：原任职机构在用时只设新的初始口令，不选机构；口令提示句照原型', () => {
    const html = dialog(OFF_CARD);
    expect(html).toContain('恢复「冯晨」？');
    expect(html).toContain('<div class="k">所在机构</div><div>龙洞自然资源所（在用）</div>');
    expect(html).not.toContain('新任职机构');
    expect(html).not.toContain('原任职机构已停用');
    expect(html).toContain('placeholder="请输入新的初始口令"');
    expect(html).toContain('恢复后对方首次登录必须改掉这个口令。不能与对方最近 5 次使用过的口令相同。');
    expect(html).toContain('class="btn btn-primary"');
    expect(html).toContain('确认恢复');
    expect(html).not.toContain('disabled="">确认恢复');
  });

  it('restoreNewOrg：原机构已停用时给原任职机构与说明条，新机构只列数据范围内在用的机构', () => {
    const html = dialog(OFF_CARD_DEAD_ORG, { orgUnits: RESTORE_ORGS });
    expect(html).toContain('<div class="k">原任职机构</div><div>五山自然资源所（已停用）</div>');
    expect(html).toContain('data-reason="org-deactivated"');
    expect(html).toContain('原任职机构已停用，恢复时需同时选一个新任职机构。');
    expect(html).toContain('新任职机构<span class="req">*</span>');
    expect(html).toContain('<option value="" selected="">请选择在用机构</option>');
    expect(html).toContain('<option value="th">天河区分局</option>');
    expect(html).toContain('<option value="sp">石牌自然资源所</option>');
    expect(html).toContain('<option value="ld">龙洞自然资源所</option>');
    expect(html).not.toContain('>五山自然资源所</option>');
    expect(html).toContain('只能选你数据范围内在用的机构。');
    expect(html).toContain('确认后，恢复和调到新任职机构一并完成。');
    // 没选机构时确认恢复置灰；选了才可点；清单还在读取时也置灰。
    expect(html).toContain('disabled="">确认恢复');
    expect(dialog(OFF_CARD_DEAD_ORG, { orgUnits: RESTORE_ORGS, orgUnitId: 'ld' })).not.toContain('disabled="">确认恢复');
    expect(dialog(OFF_CARD_DEAD_ORG, { orgUnits: null })).toContain('disabled="">确认恢复');
    expect(dialog(OFF_CARD_DEAD_ORG, { orgUnits: null, loadFailed: true })).toContain('无法读取可选机构，请关闭后重试。');
  });

  it('失败：必填提示落在对应输入下，口令策略未满足项列在口令下，整页句不露原因码', () => {
    const html = dialog(OFF_CARD_DEAD_ORG, {
      orgUnits: RESTORE_ORGS,
      failure: {
        fields: { initialPassword: '请填写初始口令', orgUnitId: '原任职机构已停用，恢复时必须同时选一个在用的新任职机构。' },
        passwordRules: ['too-short', 'contains-code'],
        unavailable: false,
        message: null,
      },
    });
    expect(html).toContain('data-error="initialPassword">请填写初始口令');
    expect(html).toContain('data-error="orgUnitId">原任职机构已停用，恢复时必须同时选一个在用的新任职机构。');
    expect(html).toContain('data-reason="non-compliant"');
    expect(html).toContain('口令至少 10 位');
    expect(html).toContain('不能包含本人工号');
    const guarded = dialog(OFF_CARD, { failure: { fields: {}, passwordRules: [], unavailable: false, message: ROOT_GUARD } });
    expect(guarded).toContain(ROOT_GUARD);
    expect(visibleText(guarded)).not.toMatch(RAW_TEXT);
    expect(dialog(OFF_CARD, { failure: { fields: {}, passwordRules: [], unavailable: false, message: '这个人员没有停用，不需要恢复。' } }))
      .toContain('这个人员没有停用，不需要恢复。');
  });

  it('busy 时口令输入、机构下拉与两个按钮都置灰', () => {
    const html = dialog(OFF_CARD_DEAD_ORG, { orgUnits: RESTORE_ORGS, orgUnitId: 'ld', initialPassword: 'Gz@Field2026', busy: true });
    expect(html).toMatch(/id="r-password"[^>]*disabled/);
    expect(html).toMatch(/id="r-org"[^>]*disabled/);
    expect(html).toMatch(/class="btn" disabled="">取消/);
    expect(html).toMatch(/disabled="">确认恢复/);
  });

  it('初始口令命中历史（#132）：输入框下只出「此口令不可用，请换一个。」，不列规则，不说明原因', () => {
    const html = dialog(OFF_CARD, { failure: { fields: {}, passwordRules: [], unavailable: true, message: null } });
    expect(html).toContain(`data-reason="unavailable">${RESET_UNAVAILABLE_TEXT}`);
    expect(html).not.toContain('data-reason="non-compliant"');
    expect(html).not.toContain('最近 5 次使用过的口令相同，请换一个');
    expect(html).toContain('恢复后对方首次登录必须改掉这个口令。不能与对方最近 5 次使用过的口令相同。');
    // 同时给规则码时也只出这一句：管理员侧不暴露历史命中原因。
    const both = dialog(OFF_CARD, { failure: { fields: {}, passwordRules: ['too-short'], unavailable: true, message: null } });
    expect(both).toContain(`data-reason="unavailable">${RESET_UNAVAILABLE_TEXT}`);
    expect(both).not.toContain('口令至少 10 位');
    expect(visibleText(html)).not.toMatch(RAW_TEXT);
  });
});

describe('重设初始口令弹窗（P6 resetpw / resetpwReused，#132）', () => {
  const dialog = (partial: Partial<ResetPasswordState> = {}) => renderToStaticMarkup(
    <MemoryRouter>
      <ResetPasswordDialog card={CARD} reset={resetPasswordState(partial)} />
    </MemoryRouter>,
  );

  it('resetpw：标题带姓名，提示句与三条后果逐字照原型，确认重设为危险按钮', () => {
    const html = dialog();
    expect(html).toContain(`为「${CARD.name}」重设初始口令`);
    expect(html).toContain('新的初始口令<span class="req">*</span>');
    expect(html).toContain('placeholder="请输入新的初始口令"');
    expect(html).toContain(`<div class="help">${RESET_PASSWORD_HELP}</div>`);
    expect(html).toContain('确认后：');
    for (const line of RESET_PASSWORD_EFFECTS) expect(html).toContain(`<li>${line}</li>`);
    expect(html).toContain('class="btn btn-danger"');
    expect(html).toContain('确认重设');
    // 口令为空时确认置灰。
    expect(html).toContain('disabled="">确认重设');
    expect(dialog({ password: 'Gz@Field2026' })).not.toContain('disabled="">确认重设');
  });

  it('resetpwReused：命中历史时输入框下只出「此口令不可用，请换一个。」，不列规则，不说明原因', () => {
    const html = dialog({ password: 'Gz@Field2026', failure: { passwordRules: [], unavailable: true, message: null } });
    expect(html).toContain(`data-reason="unavailable">${RESET_UNAVAILABLE_TEXT}`);
    expect(html).not.toContain('data-reason="non-compliant"');
    expect(html).not.toContain('reused');
    expect(html).not.toContain('最近 5 次使用过的口令相同，请换一个');
    expect(visibleText(html)).not.toMatch(RAW_TEXT);
    // 同时给规则码时也只出这一句。
    const both = dialog({ failure: { passwordRules: ['too-short'], unavailable: true, message: null } });
    expect(both).toContain(`data-reason="unavailable">${RESET_UNAVAILABLE_TEXT}`);
    expect(both).not.toContain('口令至少 10 位');
  });

  it('可公开规则不合规：输入框下逐条列出，提示句取对方工号口径', () => {
    const html = dialog({ failure: { passwordRules: ['too-short', 'contains-code'], unavailable: false, message: null } });
    expect(html).toContain('data-reason="non-compliant"');
    expect(html).toContain('<li>口令至少 10 位</li>');
    expect(html).toContain('<li>不能包含对方工号</li>');
    expect(html).not.toContain('不能包含本人工号');
    expect(html).not.toContain(`data-reason="unavailable"`);
    expect(visibleText(html)).not.toMatch(RAW_TEXT);
  });

  it('越权、并发与网络失败给弹窗级提示，不露操作码与结果码', () => {
    for (const message of [DENIED_TARGET, CONCURRENT_CHANGE_MESSAGE, FAILED_SENTENCE]) {
      const html = dialog({ failure: { passwordRules: [], unavailable: false, message } });
      expect(html).toContain('class="banner danger" data-error="message"');
      expect(html).toContain(message);
      expect(visibleText(html)).not.toMatch(RAW_TEXT);
    }
    expect(visibleText(dialog({ failure: { passwordRules: [], unavailable: false, message: CONCURRENT_CHANGE_MESSAGE } })))
      .not.toContain('concurrent-change');
  });

  it('busy 时口令输入与两个按钮都置灰', () => {
    const html = dialog({ password: 'Gz@Field2026', busy: true });
    expect(html).toMatch(/id="rp-password"[^>]*disabled/);
    expect(html).toMatch(/class="btn" disabled="">取消/);
    expect(html).toMatch(/disabled="">确认重设/);
  });

  it('成功横幅一句照 P7 重设成功定稿句去掉解锁分句', () => {
    expect(resetPasswordNotice(CARD.name)).toBe(
      `已为「${CARD.name}」重设初始口令。对方的全部会话和全部「记住我」已结束，下次登录须先改口令。`,
    );
  });
});

describe('用户可见文本不露操作码与原始结果码（SCREENS.md:8）', () => {
  const visible = (html: string) => html.replace(/<[^>]*>/g, ' ');
  const RAW = /personnel\.|audit\.|org\.|permission-denied|scope-denied|invalid-state|already-exists|non-compliant|not-found|-required|too-short|contains-code|legal-review-lead|legal-affairs-leader/;
  it('名单、空状态、卡片、执法证表单、新建、填写有误：可见文本里没有操作码和规则码', () => {
    const failure = {
      ok: false as const,
      fields: { name: '请填写姓名', code: '这个工号已被其他人员使用，请核对', orgUnitId: '所选机构已停用，请选择在用的机构' },
      passwordRules: ['too-short', 'contains-code'],
      message: '你没有权限执行这个操作，或所选机构不在你的范围内。',
    };
    const certFailure = {
      ok: false as const,
      fields: { certNo: '请填写执法证号', certStatus: '请选择证件状态：有效或失效' },
      message: '你没有权限执行这个操作，或这个人员不在你的范围内。',
    };
    const pages = [
      listHtml(),
      listHtml({ keyword: '张三丰' }),
      renderToStaticMarkup(<MemoryRouter><PersonnelCardView card={CARD} now={new Date('2026-10-17T04:00:00Z')} registered /></MemoryRouter>),
      renderToStaticMarkup(
        <MemoryRouter>
          <PersonnelCardView card={CARD} now={new Date('2026-10-17T04:00:00Z')} registered canUpdateCert />
        </MemoryRouter>,
      ),
      renderToStaticMarkup(
        <MemoryRouter>
          <CertForm
            input={{ certNo: '', certExpiresOn: '', certStatus: 'valid' }}
            failure={certFailure}
            busy={false}
            onInput={() => undefined}
            onSubmit={() => undefined}
            onCancel={() => undefined}
          />
        </MemoryRouter>,
      ),
      renderToStaticMarkup(
        <MemoryRouter>
          <PersonnelCreateForm orgUnits={ORGS} input={EMPTY_INPUT} failure={failure} busy={false} onInput={() => undefined} onSubmit={() => undefined} />
        </MemoryRouter>,
      ),
      // #129：卡片（含危险操作区）、编辑表单（含守卫失败句）、调岗弹窗（含守卫失败句）。
      renderToStaticMarkup(
        <MemoryRouter>
          <PersonnelCardView card={CARD} now={new Date('2026-10-17T04:00:00Z')} registered={false} canUpdate />
        </MemoryRouter>,
      ),
      renderToStaticMarkup(
        <MemoryRouter>
          <PersonnelCardView
            card={CARD}
            now={new Date('2026-10-17T04:00:00Z')}
            registered={false}
            canUpdate
            edit={editState({ failure: { fields: { roles: '请至少选一个角色' }, message: ROOT_GUARD } })}
          />
        </MemoryRouter>,
      ),
      renderToStaticMarkup(
        <MemoryRouter>
          <TransferDialog card={CARD} transfer={transferState({ failure: { fields: {}, message: ROOT_GUARD } })} />
        </MemoryRouter>,
      ),
      // #130：停用、结束全部会话、恢复三个弹窗（含失败句），已停用卡片（含恢复一行）。
      renderToStaticMarkup(
        <MemoryRouter>
          <DeactivateDialog card={CARD} confirm={confirmState({ message: ROOT_GUARD })} />
        </MemoryRouter>,
      ),
      renderToStaticMarkup(
        <MemoryRouter>
          <EndSessionsDialog card={CARD} confirm={confirmState({ message: ROOT_GUARD })} />
        </MemoryRouter>,
      ),
      renderToStaticMarkup(
        <MemoryRouter>
          <RestoreDialog
            card={OFF_CARD_DEAD_ORG}
            restore={restoreState({
              orgUnits: RESTORE_ORGS,
              failure: {
                fields: { initialPassword: '请填写初始口令', orgUnitId: '原任职机构已停用，恢复时必须同时选一个在用的新任职机构。' },
                passwordRules: ['too-short', 'contains-code'],
                unavailable: false,
                message: '这个人员没有停用，不需要恢复。',
              },
            })}
          />
        </MemoryRouter>,
      ),
      renderToStaticMarkup(
        <MemoryRouter>
          <ResetPasswordDialog
            card={CARD}
            reset={resetPasswordState({
              password: 'Gz@Field2026',
              failure: { passwordRules: ['too-short', 'contains-code'], unavailable: true, message: CONCURRENT_CHANGE_MESSAGE },
            })}
          />
        </MemoryRouter>,
      ),
      renderToStaticMarkup(
        <MemoryRouter>
          <PersonnelCardView card={OFF_CARD_DEAD_ORG} now={new Date('2026-10-17T04:00:00Z')} registered={false} canRestore />
        </MemoryRouter>,
      ),
    ];
    for (const html of pages) expect(visible(html)).not.toMatch(RAW);
  });
});

describe('登记接口', () => {
  const input = { ...EMPTY_INPUT, code: 'TH0360', name: '邓雅', orgUnitId: 'ld', mobilePhone: '13900007788', initialPassword: 'Gz@Field2026', roles: ['经办'], posts: ['legal-review-lead' as const] };

  it('200 交回新人员；请求体原样', async () => {
    const store = fresh();
    const calls = serve(person(ADMIN), { '/api/admin/personnel': [200, { result: 'registered', personnel: { id: 'N1', name: '邓雅' } }] });
    await store.dispatch(loadSession());
    expect(await registerPersonnel(store.dispatch, input)).toEqual({ ok: true, id: 'N1', name: '邓雅' });
    const post = calls.find((call) => call.url === '/api/admin/personnel');
    expect(post?.init?.method).toBe('POST');
    expect(JSON.parse(String(post?.init?.body))).toEqual(input);
  });

  it('400 规则码落到字段与口令要求；409 重复落到对应字段；409 停用落到机构；403 整页提示', async () => {
    const store = fresh();
    serve(person(ADMIN), { '/api/admin/personnel': [400, { result: 'non-compliant', rules: ['personnel-name-required', 'too-short', 'contains-code'] }] });
    await store.dispatch(loadSession());
    expect(await registerPersonnel(store.dispatch, input)).toEqual({
      ok: false, fields: { name: '请填写姓名' }, passwordRules: ['too-short', 'contains-code'], message: null,
    });
    serve(person(ADMIN), { '/api/admin/personnel': [409, { result: 'already-exists', conflict: 'mobile-phone' }] });
    expect((await registerPersonnel(store.dispatch, input)) as Json).toMatchObject({ fields: { mobilePhone: '这个手机号已被其他人员使用，请核对' } });
    serve(person(ADMIN), { '/api/admin/personnel': [409, { result: 'already-exists', conflict: 'personnel-code' }] });
    expect((await registerPersonnel(store.dispatch, input)) as Json).toMatchObject({ fields: { code: '这个工号已被其他人员使用，请核对' } });
    serve(person(ADMIN), { '/api/admin/personnel': [409, { result: 'invalid-state' }] });
    expect((await registerPersonnel(store.dispatch, input)) as Json).toMatchObject({ fields: { orgUnitId: '所选机构已停用，请选择在用的机构' } });
    serve(person(ADMIN), { '/api/admin/personnel': [403, { reason: 'scope-denied' }] });
    expect((await registerPersonnel(store.dispatch, input)) as Json).toMatchObject({ message: '你没有权限执行这个操作，或所选机构不在你的范围内。' });
  });

  it('执法证规则码落到执法证号、有效期两栏；请求体带两项', async () => {
    const store = fresh();
    const calls = serve(person(ADMIN), { '/api/admin/personnel': [400, { result: 'non-compliant', rules: ['cert-expires-on-required', 'cert-no-too-long'] }] });
    await store.dispatch(loadSession());
    const withCert = { ...input, certNo: 'GD-0001', certExpiresOn: '' };
    expect(await registerPersonnel(store.dispatch, withCert)).toEqual({
      ok: false,
      fields: { certExpiresOn: '填了执法证号，请同时填写有效期', certNo: '执法证号不能超过 64 个字符' },
      passwordRules: [],
      message: null,
    });
    const post = calls.find((call) => call.url === '/api/admin/personnel');
    expect(JSON.parse(String(post?.init?.body))).toMatchObject({ certNo: 'GD-0001', certExpiresOn: '' });
    serve(person(ADMIN), { '/api/admin/personnel': [400, { result: 'non-compliant', rules: ['cert-no-required', 'cert-expires-on-invalid'] }] });
    expect((await registerPersonnel(store.dispatch, withCert)) as Json).toMatchObject({
      fields: { certNo: '填了有效期，请同时填写执法证号', certExpiresOn: '请按「年-月-日」填写有效的日期，如 2027-06-30' },
    });
  });

  it('服务失败用定稿句（原型 assets/shell.js:62，同 #123）', async () => {
    const FINAL = '网络或服务暂时不可用，请稍后重试。问题持续时请联系本单位的系统管理人员。';
    const store = fresh();
    serve(person(ADMIN), { '/api/admin/personnel': [500, {}] });
    await store.dispatch(loadSession());
    expect(await registerPersonnel(store.dispatch, input)).toEqual({ ok: false, fields: {}, passwordRules: [], message: FINAL });
  });

  it('取名单与卡片：403 交给无权限卡片，404 交给找不到，其他失败交给错误卡片', async () => {
    const store = fresh();
    serve(person(ADMIN), { '/api/admin/personnel': [200, { result: 'listed', ...LIST }], '/api/admin/personnel/3': [200, { result: 'viewed', personnel: CARD }] });
    await store.dispatch(loadSession());
    expect(await loadPersonnelList(store.dispatch)).toEqual(LIST);
    expect(await loadPersonnelCard(store.dispatch, '3')).toEqual(CARD);
    serve(person(ADMIN), { '/api/admin/personnel': [403, { reason: 'permission-denied' }], '/api/admin/personnel/3': [404, { result: 'not-found' }] });
    await expect(loadPersonnelList(store.dispatch)).rejects.toMatchObject({ init: { status: 403 } });
    await expect(loadPersonnelCard(store.dispatch, '3')).rejects.toMatchObject({ init: { status: 404 } });
    serve(person(ADMIN), { '/api/admin/personnel': [500, {}] });
    await expect(loadPersonnelList(store.dispatch)).rejects.toThrow('人员名单读取失败：HTTP 500');
  });
});

describe('编辑与调岗接口（#129）', () => {
  const ADMIN_UPDATE = [...ADMIN, PERSONNEL_UPDATE];

  it('updatePersonnel：200；400 规则码落到字段；409 重复落到手机号字段；409 守卫句整页提示；403 整页提示；500 定稿句', async () => {
    const store = fresh();
    const calls = serve(person(ADMIN_UPDATE), { '/api/admin/personnel/3/edit': [200, { result: 'updated' }] });
    await store.dispatch(loadSession());
    expect(await updatePersonnel(store.dispatch, '3', EDIT_INPUT)).toEqual({ ok: true });
    const post = calls.find((call) => call.url === '/api/admin/personnel/3/edit');
    expect(post?.init?.method).toBe('POST');
    expect(JSON.parse(String(post?.init?.body))).toEqual(EDIT_INPUT);

    serve(person(ADMIN_UPDATE), { '/api/admin/personnel/3/edit': [400, { result: 'non-compliant', rules: ['personnel-name-required', 'mobile-phone-invalid', 'post-unknown'] }] });
    expect(await updatePersonnel(store.dispatch, '3', EDIT_INPUT)).toEqual({
      ok: false,
      fields: { name: '请填写姓名', mobilePhone: '手机号应为以 1 开头的 11 位数字', posts: '所选岗位标记不在可选范围内，请刷新页面后重选' },
      message: null,
    });
    serve(person(ADMIN_UPDATE), { '/api/admin/personnel/3/edit': [409, { result: 'already-exists', conflict: 'mobile-phone' }] });
    expect(await updatePersonnel(store.dispatch, '3', EDIT_INPUT)).toEqual({
      ok: false, fields: { mobilePhone: '这个手机号已被其他人员使用，请核对' }, message: null,
    });
    serve(person(ADMIN_UPDATE), { '/api/admin/personnel/3/edit': [409, { result: 'invalid-state', reason: 'root-admin-required', message: ROOT_GUARD }] });
    expect(await updatePersonnel(store.dispatch, '3', EDIT_INPUT)).toEqual({ ok: false, fields: {}, message: ROOT_GUARD });
    serve(person(ADMIN_UPDATE), { '/api/admin/personnel/3/edit': [403, { reason: 'scope-denied' }] });
    expect(await updatePersonnel(store.dispatch, '3', EDIT_INPUT)).toEqual({ ok: false, fields: {}, message: DENIED_TARGET });
    serve(person(ADMIN_UPDATE), { '/api/admin/personnel/3/edit': [500, {}] });
    expect(await updatePersonnel(store.dispatch, '3', EDIT_INPUT)).toEqual({ ok: false, fields: {}, message: FAILED_SENTENCE });
  });

  it('transferPersonnel：200；400 落到调入机构；409 守卫句整页提示；409 无句落到调入机构；403 整页提示', async () => {
    const store = fresh();
    const calls = serve(person(ADMIN_UPDATE), { '/api/admin/personnel/3/transfer': [200, { result: 'transferred', orgUnitId: 'sp' }] });
    await store.dispatch(loadSession());
    expect(await transferPersonnel(store.dispatch, '3', 'sp')).toEqual({ ok: true });
    const post = calls.find((call) => call.url === '/api/admin/personnel/3/transfer');
    expect(JSON.parse(String(post?.init?.body))).toEqual({ orgUnitId: 'sp' });

    serve(person(ADMIN_UPDATE), { '/api/admin/personnel/3/transfer': [400, { result: 'non-compliant', rules: ['org-unit-required'] }] });
    expect(await transferPersonnel(store.dispatch, '3', '')).toEqual({
      ok: false, fields: { orgUnitId: '请选择调入机构' }, message: null,
    });
    serve(person(ADMIN_UPDATE), { '/api/admin/personnel/3/transfer': [409, { result: 'invalid-state', reason: 'root-admin-required', message: ROOT_GUARD }] });
    expect(await transferPersonnel(store.dispatch, '3', 'sp')).toEqual({ ok: false, fields: {}, message: ROOT_GUARD });
    serve(person(ADMIN_UPDATE), { '/api/admin/personnel/3/transfer': [409, { result: 'invalid-state' }] });
    expect(await transferPersonnel(store.dispatch, '3', 'sp')).toEqual({
      ok: false, fields: { orgUnitId: '所选机构已停用，请选择在用的机构' }, message: null,
    });
    serve(person(ADMIN_UPDATE), { '/api/admin/personnel/3/transfer': [403, { reason: 'permission-denied' }] });
    expect(await transferPersonnel(store.dispatch, '3', 'sp')).toEqual({ ok: false, fields: {}, message: DENIED_TARGET });
  });

  it('loadTransferDestinations：200 按树的先序；403 或失败为 null', async () => {
    const store = fresh();
    const shuffled = [DESTS[3], DESTS[0], DESTS[4], DESTS[1], DESTS[2]];
    serve(person(ADMIN_UPDATE), { '/api/admin/personnel/3/transfer-destinations': [200, { result: 'listed', orgUnits: shuffled }] });
    await store.dispatch(loadSession());
    expect(await loadTransferDestinations(store.dispatch, '3')).toEqual([DESTS[0], DESTS[3], DESTS[4], DESTS[1], DESTS[2]]);
    serve(person(ADMIN_UPDATE), { '/api/admin/personnel/3/transfer-destinations': [403, { reason: 'permission-denied' }] });
    expect(await loadTransferDestinations(store.dispatch, '3')).toBeNull();
    serve(person(ADMIN_UPDATE), { '/api/admin/personnel/3/transfer-destinations': [500, {}] });
    expect(await loadTransferDestinations(store.dispatch, '3')).toBeNull();
  });
});

describe('停用、恢复、结束全部会话接口（#130）', () => {
  const ADMIN_DANGER = [...ADMIN, PERSONNEL_DEACTIVATE, PERSONNEL_RESTORE, PERSONNEL_SESSIONS_END];
  const RESTORE_INPUT = { initialPassword: 'Gz@Field2026', orgUnitId: 'ld' };

  it('deactivatePersonnel：200；409 守卫句直接用；403 整页提示；500 定稿句', async () => {
    const store = fresh();
    const calls = serve(person(ADMIN_DANGER), { '/api/admin/personnel/3/deactivate': [200, { result: 'deactivated' }] });
    await store.dispatch(loadSession());
    expect(await deactivatePersonnel(store.dispatch, '3')).toEqual({ ok: true });
    const post = calls.find((call) => call.url === '/api/admin/personnel/3/deactivate');
    expect(post?.init?.method).toBe('POST');
    serve(person(ADMIN_DANGER), { '/api/admin/personnel/3/deactivate': [409, { result: 'invalid-state', reason: 'root-admin-required', message: ROOT_GUARD }] });
    expect(await deactivatePersonnel(store.dispatch, '3')).toEqual({ ok: false, message: ROOT_GUARD });
    serve(person(ADMIN_DANGER), { '/api/admin/personnel/3/deactivate': [403, { reason: 'scope-denied' }] });
    expect(await deactivatePersonnel(store.dispatch, '3')).toEqual({ ok: false, message: DENIED_TARGET });
    serve(person(ADMIN_DANGER), { '/api/admin/personnel/3/deactivate': [500, {}] });
    expect(await deactivatePersonnel(store.dispatch, '3')).toEqual({ ok: false, message: FAILED_SENTENCE });
  });

  it('endPersonnelSessions：200；403 整页提示；500 定稿句', async () => {
    const store = fresh();
    const calls = serve(person(ADMIN_DANGER), { '/api/admin/personnel/3/end-sessions': [200, { result: 'ended' }] });
    await store.dispatch(loadSession());
    expect(await endPersonnelSessions(store.dispatch, '3')).toEqual({ ok: true });
    const post = calls.find((call) => call.url === '/api/admin/personnel/3/end-sessions');
    expect(post?.init?.method).toBe('POST');
    serve(person(ADMIN_DANGER), { '/api/admin/personnel/3/end-sessions': [403, { reason: 'permission-denied' }] });
    expect(await endPersonnelSessions(store.dispatch, '3')).toEqual({ ok: false, message: DENIED_TARGET });
    serve(person(ADMIN_DANGER), { '/api/admin/personnel/3/end-sessions': [500, {}] });
    expect(await endPersonnelSessions(store.dispatch, '3')).toEqual({ ok: false, message: FAILED_SENTENCE });
  });

  it('restorePersonnel：200 交回恢复后任职机构且请求体原样；400 规则码落到口令字段与口令策略；409 定稿句；403；500', async () => {
    const store = fresh();
    const calls = serve(person(ADMIN_DANGER), { '/api/admin/personnel/7/restore': [200, { result: 'restored', orgUnitId: 'ld' }] });
    await store.dispatch(loadSession());
    expect(await restorePersonnel(store.dispatch, '7', RESTORE_INPUT)).toEqual({ ok: true, orgUnitId: 'ld' });
    const post = calls.find((call) => call.url === '/api/admin/personnel/7/restore');
    expect(post?.init?.method).toBe('POST');
    expect(JSON.parse(String(post?.init?.body))).toEqual(RESTORE_INPUT);
    serve(person(ADMIN_DANGER), { '/api/admin/personnel/7/restore': [400, { result: 'non-compliant', rules: ['password-required'] }] });
    expect(await restorePersonnel(store.dispatch, '7', { initialPassword: '', orgUnitId: '' })).toEqual({
      ok: false, fields: { initialPassword: '请填写初始口令' }, passwordRules: [], unavailable: false, message: null,
    });
    serve(person(ADMIN_DANGER), { '/api/admin/personnel/7/restore': [400, { result: 'non-compliant', rules: ['too-short', 'contains-code'] }] });
    expect(await restorePersonnel(store.dispatch, '7', RESTORE_INPUT)).toEqual({
      ok: false, fields: {}, passwordRules: ['too-short', 'contains-code'], unavailable: false, message: null,
    });
    serve(person(ADMIN_DANGER), { '/api/admin/personnel/7/restore': [409, { result: 'invalid-state', reason: 'not-deactivated', message: '这个人员没有停用，不需要恢复。' }] });
    expect(await restorePersonnel(store.dispatch, '7', RESTORE_INPUT)).toEqual({
      ok: false, fields: {}, passwordRules: [], unavailable: false, message: '这个人员没有停用，不需要恢复。',
    });
    serve(person(ADMIN_DANGER), { '/api/admin/personnel/7/restore': [403, { reason: 'scope-denied' }] });
    expect(await restorePersonnel(store.dispatch, '7', RESTORE_INPUT)).toEqual({
      ok: false, fields: {}, passwordRules: [], unavailable: false, message: DENIED_TARGET,
    });
    serve(person(ADMIN_DANGER), { '/api/admin/personnel/7/restore': [500, {}] });
    expect(await restorePersonnel(store.dispatch, '7', RESTORE_INPUT)).toEqual({
      ok: false, fields: {}, passwordRules: [], unavailable: false, message: FAILED_SENTENCE,
    });
  });

  it('restorePersonnel（#132）：初始口令命中历史只回 unavailable，不进规则码清单；并发改口令回 409 定稿句', async () => {
    const store = fresh();
    serve(person(ADMIN_DANGER), { '/api/admin/personnel/7/restore': [400, { result: 'non-compliant', rules: ['unavailable'] }] });
    await store.dispatch(loadSession());
    expect(await restorePersonnel(store.dispatch, '7', RESTORE_INPUT)).toEqual({
      ok: false, fields: {}, passwordRules: [], unavailable: true, message: null,
    });
    // 可公开规则与 unavailable 同时回来时（服务端不会这样回，界面按优先级取 unavailable）也不丢规则码。
    serve(person(ADMIN_DANGER), { '/api/admin/personnel/7/restore': [400, { result: 'non-compliant', rules: ['unavailable', 'too-short'] }] });
    expect(await restorePersonnel(store.dispatch, '7', RESTORE_INPUT)).toEqual({
      ok: false, fields: {}, passwordRules: ['too-short'], unavailable: true, message: null,
    });
    serve(person(ADMIN_DANGER), { '/api/admin/personnel/7/restore': [409, { result: 'concurrent-change' }] });
    expect(await restorePersonnel(store.dispatch, '7', RESTORE_INPUT)).toEqual({
      ok: false, fields: {}, passwordRules: [], unavailable: false, message: CONCURRENT_CHANGE_MESSAGE,
    });
  });

  it('resetPersonnelPassword（#132）：200；400 规则码只收 RESET_RULE_TEXT 里的码；unavailable 单出；409；403；500；401 无提示', async () => {
    const store = fresh();
    const calls = serve(person(ADMIN_DANGER), { '/api/admin/personnel/3/password-reset': [200, { result: 'reset' }] });
    await store.dispatch(loadSession());
    expect(await resetPersonnelPassword(store.dispatch, '3', 'Gz@Field2026')).toEqual({ ok: true });
    const post = calls.find((call) => call.url === '/api/admin/personnel/3/password-reset');
    expect(post?.init?.method).toBe('POST');
    expect(JSON.parse(String(post?.init?.body))).toEqual({ password: 'Gz@Field2026' });
    const url = '/api/admin/personnel/3/password-reset';
    serve(person(ADMIN_DANGER), { [url]: [400, { result: 'non-compliant', rules: ['too-short', 'contains-code'] }] });
    expect(await resetPersonnelPassword(store.dispatch, '3', 'a')).toEqual({
      ok: false, passwordRules: ['too-short', 'contains-code'], unavailable: false, message: null,
    });
    serve(person(ADMIN_DANGER), { [url]: [400, { result: 'non-compliant', rules: ['unavailable'] }] });
    expect(await resetPersonnelPassword(store.dispatch, '3', 'Gz@Field2026')).toEqual({
      ok: false, passwordRules: [], unavailable: true, message: null,
    });
    serve(person(ADMIN_DANGER), { [url]: [409, { result: 'concurrent-change' }] });
    expect(await resetPersonnelPassword(store.dispatch, '3', 'Gz@Field2026')).toEqual({
      ok: false, passwordRules: [], unavailable: false, message: CONCURRENT_CHANGE_MESSAGE,
    });
    serve(person(ADMIN_DANGER), { [url]: [403, { reason: 'scope-denied' }] });
    expect(await resetPersonnelPassword(store.dispatch, '3', 'Gz@Field2026')).toEqual({
      ok: false, passwordRules: [], unavailable: false, message: DENIED_TARGET,
    });
    serve(person(ADMIN_DANGER), { [url]: [500, {}] });
    expect(await resetPersonnelPassword(store.dispatch, '3', 'Gz@Field2026')).toEqual({
      ok: false, passwordRules: [], unavailable: false, message: FAILED_SENTENCE,
    });
    serve(person(ADMIN_DANGER), { [url]: [401, {}] });
    expect(await resetPersonnelPassword(store.dispatch, '3', 'Gz@Field2026')).toEqual({
      ok: false, passwordRules: [], unavailable: false, message: null,
    });
  });

  it('loadRestoreOrgUnits：取数据范围内在用机构按树的先序，已停用不列；失败为 null', async () => {
    const store = fresh();
    serve(person(ADMIN_DANGER), {
      '/api/org-units': [200, {
        result: 'listed',
        rootId: 'th',
        orgUnits: [
          { id: 'th', name: '天河区分局', parentId: null, deactivatedAt: null },
          { id: 'sp', name: '石牌自然资源所', parentId: 'th', deactivatedAt: null },
          { id: 'ld', name: '龙洞自然资源所', parentId: 'th', deactivatedAt: null },
          { id: 'ws', name: '五山自然资源所', parentId: 'th', deactivatedAt: '2026-09-01T00:00:00Z' },
        ],
      }],
    });
    await store.dispatch(loadSession());
    const units = await loadRestoreOrgUnits(store.dispatch);
    expect(units?.map((unit) => unit.id)).toEqual(['th', 'sp', 'ld']);
    serve(person(ADMIN_DANGER), { '/api/org-units': [500, {}] });
    expect(await loadRestoreOrgUnits(store.dispatch)).toBeNull();
  });
});

describe('人员页路由', () => {
  it('监督打开人员名单：无权限卡片带「去看留痕」，不取名单', async () => {
    const calls = serve(person(SUPERVISE));
    const { html } = await renderRoute(fresh(), '/admin/personnel');
    expect(html).toContain('你没有查看人员名单的权限');
    expect(html).toContain('监督可以在「管理台留痕」里查阅人员维护的留痕，但不能打开人员名单和人员详情。');
    expect(html).toContain('去看留痕');
    expect(calls.map((call) => call.url)).not.toContain('/api/admin/personnel');
  });

  it('监督打开人员卡片：无权限卡片，不取卡片（不留痕）', async () => {
    const calls = serve(person(SUPERVISE));
    const { html } = await renderRoute(fresh(), '/admin/personnel/3');
    expect(html).toContain('你没有查看人员详情的权限');
    expect(html).toContain('去看留痕');
    expect(calls.map((call) => call.url)).not.toContain('/api/admin/personnel/3');
  });

  it('没有留痕码的人员（经办）：通用无权限卡片，没有「去看留痕」', async () => {
    serve(person(CLERK));
    const { html } = await renderRoute(fresh(), '/admin/personnel');
    expect(html).toContain('你没有查看人员名单的权限');
    expect(html).not.toContain('去看留痕');
  });

  it('系统管理打开名单：首屏先出骨架并取名单，「人员」菜单高亮，有新建按钮', async () => {
    const calls = serve(person(ADMIN), { '/api/admin/personnel': [200, { result: 'listed', ...LIST }] });
    const { html } = await renderRoute(fresh(), '/admin/personnel');
    expect(html).toContain('天河区分局及下级机构的人员。打开人员详情会留痕。');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('nav-item active" data-menu="person"');
    expect(html).toContain('href="/admin/personnel/new"');
    expect(calls.map((call) => call.url)).toContain('/api/admin/personnel');
  });

  // 名单接口晚于首屏返回时，Await 的失败分支才会进静态渲染；延迟响应模拟真实网络时序。
  function serveLate(status: number, body: Json) {
    const session = person(ADMIN);
    vi.stubGlobal('fetch', (url: string) => {
      if (url === '/api/auth/session') return Promise.resolve(new Response(JSON.stringify(session), { status: 200 }));
      if (url === '/api/admin/personnel') {
        return new Promise((resolve) => setTimeout(() => resolve(new Response(JSON.stringify(body), { status })), 10));
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 404 }));
    });
  }

  it('名单接口 403：只出面包屑与无权限卡，不出页头（原型 P5:32）', async () => {
    const store = fresh();
    serveLate(403, { reason: 'permission-denied' });
    const { router } = await renderRoute(store, '/admin/personnel');
    await new Promise((resolve) => setTimeout(resolve, 20));
    const html = renderRouter(store, router);
    expect(html).toContain('<div class="crumb">管理台 / <b>人员</b></div>');
    expect(html).toContain('你没有查看人员名单的权限');
    expect(html).not.toContain('新建人员');
    expect(html).not.toContain('<h1>');
  });

  it('名单接口其他失败：保留页头、筛选与错误卡（原型 P5:34）', async () => {
    const store = fresh();
    serveLate(500, {});
    const { router } = await renderRoute(store, '/admin/personnel');
    await new Promise((resolve) => setTimeout(resolve, 20));
    const html = renderRouter(store, router);
    expect(html).toContain('<h1>人员</h1>');
    expect(html).toContain('人员名单没有加载出来');
    expect(html).toContain('新建人员');
  });

  it('新建页与卡片页都高亮「人员」菜单；新建页取机构树', async () => {
    const calls = serve(person(ADMIN), { '/api/org-units': [200, { rootId: 'th', orgUnits: [] }] });
    const created = await renderRoute(fresh(), '/admin/personnel/new');
    expect(created.html).toContain('nav-item active" data-menu="person"');
    expect(created.html).toContain('<h1>新建人员</h1>');
    expect(calls.map((call) => call.url)).toContain('/api/org-units');
    serve(person(ADMIN), { '/api/admin/personnel/3': [200, { result: 'viewed', personnel: CARD }] });
    const viewed = await renderRoute(fresh(), '/admin/personnel/3');
    expect(viewed.html).toContain('nav-item active" data-menu="person"');
  });

  it('只有读码没有登记码：新建页显示无权限卡片', async () => {
    serve(person(['personnel.profile.read']));
    const { html } = await renderRoute(fresh(), '/admin/personnel/new');
    expect(html).toContain('你没有查看新建人员的权限');
  });

  it('岗位标记不影响菜单：菜单只由会话操作码决定，会话里没有岗位标记', async () => {
    const store = fresh();
    serve({ ...person(ADMIN), posts: ['legal-review-lead', 'legal-affairs-leader'] });
    await store.dispatch(loadSession());
    const operator = store.getState().login.operator as unknown as Json;
    expect(operator.posts).toBeUndefined();
    expect(visibleSecondaries('admin', store.getState().login.operator?.opcodes ?? []).map((item) => item.id))
      .toEqual(visibleSecondaries('admin', ADMIN).map((item) => item.id));
    expect(visibleSecondaries('admin', ADMIN).map((item) => item.id)).toContain('person');
  });
});
