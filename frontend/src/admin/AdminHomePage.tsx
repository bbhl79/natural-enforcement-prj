import { Suspense } from 'react';
import { Await, Link, useAsyncError, useLoaderData, useRevalidator } from 'react-router';

import { useAppSelector } from '../hooks';
import { hasAny } from '../shell/menu';
import { DeniedCard, ErrorCard, errorStatus } from '../shell/StatusPages';
import {
  ADMIN_TILES,
  adminHomeView,
  firstDayPending,
  SUPERVISE_AUDIT_DESC,
  type AdminHomeSummary,
  type AdminTile,
} from './adminHome';

const ADMIN_DESC = '维护机构、人员和执法证，处理被锁人员，查阅管理台留痕。';
const SUPERVISE_DESC = '你可以查阅和导出管理台留痕。';
const SCOPE_DESC = '范围限于你任职机构及其下级。';

function Crumb() {
  return <div className="crumb">管理台 / <b>首页</b></div>;
}

function Head({ desc }: { desc: string }) {
  return (
    <>
      <Crumb />
      <div className="page-h">
        <div>
          <h1>管理台</h1>
          <div className="desc">{`${desc}${SCOPE_DESC}`}</div>
        </div>
      </div>
    </>
  );
}

function Tile({ tile, summary, desc }: { tile: AdminTile; summary: AdminHomeSummary; desc?: string }) {
  const count = tile.count(summary);
  return (
    <Link className="tile" to={tile.path} data-requires={tile.anyOf.join(' ')}>
      <div className="t">{tile.title}</div>
      <div className="d">{desc ?? tile.desc}</div>
      {count ? <div className="n">{count}</div> : null}
    </Link>
  );
}

function TileSkeletons() {
  return (
    <div className="tiles" aria-busy="true">
      {[1, 2, 3, 4].map((key) => (
        <div key={key} className="tile">
          <div className="skel" />
          <div className="skel" style={{ width: '50%' }} />
        </div>
      ))}
    </div>
  );
}

function SummaryError() {
  const error = useAsyncError();
  const revalidator = useRevalidator();
  // 403 交给壳内路由错误边界，整页显示无权限页（P2 forbidden），与其他页面一致
  if (errorStatus(error) === 403) throw error;
  return <ErrorCard what="管理台首页" onRetry={() => void revalidator.revalidate()} />;
}

/** 上线首日三步引导（P3 firstday）。 */
export function FirstDayGuide() {
  return (
    <div className="banner amber">
      <b>还不能开始核查和立案：</b>
      目前只有市局一个机构，除你以外没有其他人员，也没有人登记执法证。请按顺序完成：① 在「机构」里建区分局和所；② 在「人员」里建人员并分配角色；③ 为经办人员登记执法证。
      <br />
      没有有效执法证的人员可以登录，但不能启动核查、不能立案。
    </div>
  );
}

export function AdminHomeContent({ opcodes, summary }: { opcodes: readonly string[]; summary: AdminHomeSummary }) {
  const view = adminHomeView(opcodes);
  if (view === 'supervise') {
    const audit = ADMIN_TILES.filter((tile) => tile.id === 'audit');
    return (
      <>
        <div className="tiles">
          {audit.map((tile) => <Tile key={tile.id} tile={tile} summary={summary} desc={SUPERVISE_AUDIT_DESC} />)}
        </div>
        <div className="banner gray" style={{ marginTop: 12 }}>
          监督只查阅留痕，不能打开人员名单和人员详情，也不能导出人员资料。
        </div>
      </>
    );
  }
  const tiles = ADMIN_TILES.filter((tile) => hasAny(opcodes, tile.anyOf));
  const firstDay = firstDayPending(summary);
  return (
    <>
      {firstDay ? <FirstDayGuide /> : null}
      <div className="tiles">
        {tiles.map((tile) => <Tile key={tile.id} tile={tile} summary={summary} />)}
      </div>
      {firstDay ? null : (
        <div className="grid2" style={{ marginTop: 12 }}>
          {/* 「需要留意的执法证」统计卡片由执法证票（#133）放在这里。 */}
          <div data-slot="cert-attention" />
          <div className="card">
            <div className="card-h">后续开放</div>
            <div style={{ color: 'var(--muted)', fontSize: 12, lineHeight: 1.8 }}>
              文书模板、校验规则、工作日历、统计口径的维护，待对应业务功能上线后在此开放。
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** 管理台首页（P3）：系统管理看到维护入口与首日引导；监督只看到留痕入口。 */
export default function AdminHomePage() {
  const { summary } = useLoaderData() as { summary: Promise<AdminHomeSummary> };
  const opcodes = useAppSelector((root) => root.login.operator?.opcodes ?? []);
  const view = adminHomeView(opcodes);
  if (view === 'denied') {
    return (
      <>
        <Crumb />
        <DeniedCard what="管理台" />
      </>
    );
  }
  return (
    <>
      <Head desc={view === 'supervise' ? SUPERVISE_DESC : ADMIN_DESC} />
      <Suspense fallback={<TileSkeletons />}>
        <Await resolve={summary} errorElement={<SummaryError />}>
          {(resolved: AdminHomeSummary) => <AdminHomeContent opcodes={opcodes} summary={resolved} />}
        </Await>
      </Suspense>
    </>
  );
}
