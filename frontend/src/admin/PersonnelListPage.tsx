import { Suspense } from 'react';
import { Await, Link, useAsyncError, useLoaderData, useRevalidator, useSearchParams } from 'react-router';

import { useAppSelector } from '../hooks';
import { ErrorCard, errorStatus } from '../shell/StatusPages';
import {
  CERT_FILTER_LABEL,
  CERT_FILTERS,
  CERT_TAG,
  DEFAULT_FILTER,
  filterFromSearch,
  filterHint,
  filterPersonnel,
  listHint,
  orgUnitsInTreeOrder,
  pageFromSearch,
  paginate,
  PERSONNEL_READ,
  PERSONNEL_REGISTER,
  ROLES,
  searchFromFilter,
  searchWithPage,
  type CertFilter,
  type PersonnelFilter,
  type PersonnelList,
  type PersonnelRow,
} from './personnel';
import { PersonnelDenied, SkeletonCard } from './PersonnelStatus';

const SUPERVISE = '监督可以在「管理台留痕」里查阅人员维护的留痕，但不能打开人员名单和人员详情。';

function Crumb() {
  return <div className="crumb">管理台 / <b>人员</b></div>;
}

/** 页头（标题、说明、新建按钮）。P5:32 的 denied 态没有页头，所以页头与面包屑分开渲染。 */
function PageHead({ scopeName, opcodes }: { scopeName: string | null; opcodes: readonly string[] }) {
  return (
    <div className="page-h">
      <div>
        <h1>人员</h1>
        <div className="desc">{`${scopeName ?? '你任职机构'}及下级机构的人员。打开人员详情会留痕。`}</div>
      </div>
      {opcodes.includes(PERSONNEL_REGISTER) ? (
        <div className="actions">
          <Link className="btn btn-primary" to="/admin/personnel/new" data-requires={PERSONNEL_REGISTER}>新建人员</Link>
        </div>
      ) : null}
    </div>
  );
}

export function Filters({
  list,
  filter,
  onChange,
}: {
  list: PersonnelList | null;
  filter: PersonnelFilter;
  onChange: (next: PersonnelFilter) => void;
}) {
  const units = list ? orgUnitsInTreeOrder(list.orgUnits, list.rootId) : [];
  return (
    <div className="filters">
      <input
        className="input"
        placeholder="工号或姓名"
        value={filter.keyword}
        onChange={(event) => onChange({ ...filter, keyword: event.target.value })}
      />
      <select className="select" value={filter.orgUnitId} onChange={(event) => onChange({ ...filter, orgUnitId: event.target.value })}>
        <option value="">全部机构（含下级）</option>
        {units.map((unit) => (
          <option key={unit.id} value={unit.id}>{unit.deactivatedAt ? `${unit.name}（已停用）` : unit.name}</option>
        ))}
      </select>
      <select className="select" value={filter.role} onChange={(event) => onChange({ ...filter, role: event.target.value })}>
        <option value="">全部角色</option>
        {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
      </select>
      <select className="select" value={filter.cert} onChange={(event) => onChange({ ...filter, cert: event.target.value as CertFilter })}>
        {CERT_FILTERS.map((cert) => <option key={cert} value={cert}>{CERT_FILTER_LABEL[cert]}</option>)}
      </select>
      <label className="checks" style={{ padding: 0 }}>
        <input
          type="checkbox"
          checked={filter.includeDeactivated}
          onChange={(event) => onChange({ ...filter, includeDeactivated: event.target.checked })}
        />
        {' 含已停用人员'}
      </label>
    </div>
  );
}

function Row({ row }: { row: PersonnelRow }) {
  const tag = CERT_TAG[row.certStatus];
  return (
    <tr className={row.deactivatedAt ? 'off' : ''} data-personnel={row.id}>
      <td className="mono">{row.code}</td>
      <td>{row.name}</td>
      <td>{row.orgName ?? '—'}</td>
      <td>{row.roles.join('、') || '—'}</td>
      <td><span className={tag.tone ? `tag ${tag.tone}` : 'tag'}>{tag.label}</span></td>
      <td>{row.deactivatedAt ? <span className="tag gray">已停用</span> : '在职'}</td>
      <td><Link className="btn btn-sm" to={`/admin/personnel/${row.id}`} data-requires={PERSONNEL_READ}>查看</Link></td>
    </tr>
  );
}

/** P5 列表视图（纯渲染，单测直接渲染）。 */
export function PersonnelListView({
  list,
  filter,
  opcodes,
  onFilter,
  page = 1,
  onPage = () => undefined,
}: {
  list: PersonnelList;
  filter: PersonnelFilter;
  opcodes: readonly string[];
  onFilter: (next: PersonnelFilter) => void;
  page?: number;
  onPage?: (page: number) => void;
}) {
  const rows = filterPersonnel(list, filter);
  const off = rows.filter((row) => row.deactivatedAt).length;
  const shown = paginate(rows, page);
  const hint = listHint(filterHint(list, filter), off, shown.page, shown.pages);
  return (
    <>
      <Filters list={list} filter={filter} onChange={onFilter} />
      {rows.length === 0 ? (
        <div className="card">
          <div className="empty">
            <div className="t">没有符合条件的人员</div>
            <div>换个关键词或清空筛选条件再试。要找的人如果还没建，可以新建。</div>
            <div style={{ marginTop: 14 }}>
              <button type="button" className="btn" onClick={() => onFilter(DEFAULT_FILTER)}>清空筛选</button>
              {opcodes.includes(PERSONNEL_REGISTER) ? (
                <>
                  {' '}
                  <Link className="btn btn-primary" to="/admin/personnel/new" data-requires={PERSONNEL_REGISTER}>新建人员</Link>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="card-h">
            {`共 ${rows.length} 人`}
            <span className="hint">{hint}</span>
          </div>
          <table className="table">
            <thead>
              <tr><th>工号</th><th>姓名</th><th>当前机构</th><th>角色</th><th>执法证</th><th>状态</th><th /></tr>
            </thead>
            <tbody>
              {shown.rows.map((row) => <Row key={row.id} row={row} />)}
            </tbody>
          </table>
          {shown.pages > 1 ? (
            <div className="actions" data-pager style={{ marginTop: 12 }}>
              <button type="button" className="btn btn-sm" disabled={shown.page <= 1} onClick={() => onPage(shown.page - 1)}>上一页</button>
              <button type="button" className="btn btn-sm" disabled={shown.page >= shown.pages} onClick={() => onPage(shown.page + 1)}>下一页</button>
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}

/**
 * 名单接口失败的一段。403 只出无权限卡（原型 P5:32 denied 态只有面包屑和无权限卡，页头不渲染）；
 * 其他失败保留页头、筛选和错误卡（原型 P5:34）。
 */
function ListError({ filter }: { filter: PersonnelFilter }) {
  const error = useAsyncError();
  const revalidator = useRevalidator();
  const opcodes = useAppSelector((root) => root.login.operator?.opcodes ?? []);
  const scopeName = useAppSelector((root) => root.login.operator?.orgName ?? null);
  if (errorStatus(error) === 403) return <PersonnelDenied what="人员名单" opcodes={opcodes} supervise={SUPERVISE} />;
  return (
    <>
      <PageHead scopeName={scopeName} opcodes={opcodes} />
      <Filters list={null} filter={filter} onChange={() => undefined} />
      <ErrorCard what="人员名单" onRetry={() => void revalidator.revalidate()} />
    </>
  );
}

/** 人员（P5）：系统管理按数据范围看名单、筛选、进卡片、新建；监督与其他人员看到无权限卡片。 */
export default function PersonnelListPage() {
  const { list } = useLoaderData() as { list: Promise<PersonnelList | null> };
  const opcodes = useAppSelector((root) => root.login.operator?.opcodes ?? []);
  const orgName = useAppSelector((root) => root.login.operator?.orgName ?? null);
  const [search, setSearch] = useSearchParams();
  const filter = filterFromSearch(search);
  const page = pageFromSearch(search);
  // 改筛选回到第 1 页（searchFromFilter 不带 page）；翻页保留筛选。
  const onFilter = (next: PersonnelFilter) => setSearch(searchFromFilter(next), { replace: true });
  const onPage = (next: number) => setSearch(searchWithPage(search, next));
  if (!opcodes.includes(PERSONNEL_READ)) {
    return (
      <>
        <Crumb />
        <PersonnelDenied what="人员名单" opcodes={opcodes} supervise={SUPERVISE} />
      </>
    );
  }
  return (
    <>
      <Crumb />
      <Suspense
        fallback={(
          <>
            <PageHead scopeName={orgName} opcodes={opcodes} />
            <div aria-busy="true">
              <Filters list={null} filter={filter} onChange={() => undefined} />
              <SkeletonCard rows={9} />
            </div>
          </>
        )}
      >
        <Await resolve={list} errorElement={<ListError filter={filter} />}>
          {(resolved: PersonnelList | null) => (resolved ? (
            <>
              <PageHead scopeName={orgName} opcodes={opcodes} />
              <PersonnelListView list={resolved} filter={filter} opcodes={opcodes} onFilter={onFilter} page={page} onPage={onPage} />
            </>
          ) : null)}
        </Await>
      </Suspense>
    </>
  );
}
