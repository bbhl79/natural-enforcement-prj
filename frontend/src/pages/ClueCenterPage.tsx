// 线索中心（一级入口）。
// 视图、关键词、筛选、日期与分页都从地址取（见 shell/clueUrl.ts）。
// 列表从后端取数（见 clue/list.ts），筛选栏独立组件（见 clue/ClueCenterFilters.tsx）。
// 抽屉按四页签装配（基本信息与要件／内业核查／疑似重复比对／流转与留痕），
// 四个页签均已落地（#207/#213/#212）。
import { Suspense, useState } from 'react';
import { Await, Link, useLoaderData, useRevalidator, useSearchParams } from 'react-router';

import { useAppDispatch, useAppSelector } from '../hooks';
import ClueCenterFilters, {
  type ClueCenterFiltersValue,
} from '../clue/ClueCenterFilters';
import ClueHeldSection from '../clue/ClueHeldSection';
import ClueReminderSection from '../clue/ClueReminderSection';
import { ClueBasicTab } from '../clue/ClueBasicTab';
import { ClueDuplicateTab } from '../clue/ClueDuplicateTab';
import { ClueTrailTab } from '../clue/ClueTrailTab';
import { ClueVerificationTab } from '../clue/ClueVerificationTab';
import { fillGaps, type ClueDetail } from '../clue/detail';
import { readReporter, type DuplicateView } from '../clue/duplicate';
import { type ClueListPage, type ClueListRow } from '../clue/list';
import { CLUE_REGISTER_PATH, DOMAIN_LABEL } from '../clue/registration';
import { type TrailEntry } from '../clue/trail';
import { retryVerification, type VerificationView } from '../clue/verification';
import {
  clueViewLabel,
  readClueUrlState,
  withPreservedQuery,
  CLUE_VIEWS,
  CLUE_VIEW_KEY,
  CLUE_CLUE_KEY,
  CLUE_TAB_KEY,
  CLUE_KEYWORD_KEY,
  CLUE_FROM_KEY,
  CLUE_TO_KEY,
  CLUE_PAGE_KEY,
} from '../shell/clueUrl';

/** 抽屉四页签（规格 H 节）。 */
const TABS = [
  { id: 'basic', label: '基本信息与要件' },
  { id: 'verification', label: '内业核查' },
  { id: 'duplicate', label: '疑似重复比对' },
  { id: 'trail', label: '流转与留痕' },
] as const;

/** 筛选键到 URL 参数名的映射。 */
const FILTER_PARAM_MAP: Record<string, string> = {
  keyword: CLUE_KEYWORD_KEY,
  domain: 'domain',
  source: 'source',
  org: 'org',
  status: 'status',
  check: 'check',
  gap: 'gap',
  from: CLUE_FROM_KEY,
  to: CLUE_TO_KEY,
};

/** 法域值到标签的映射。 */
const DOMAIN_OPTION_LABEL: Record<string, string> = {
  land: '土地',
  mineral: '矿产',
  survey: '测绘',
  planning: '规划',
};

/** 状态值到标签的映射（简版，详细标签由后端返回）。 */
const STATUS_OPTION_LABEL: Record<string, string> = {
  pending_decision: '待分派决定',
  in_pool: '待分派池',
  org_assigned: '已派机构',
  handler_assigned: '已派承办人',
  held: '不派',
  transferred_out: '已移送',
  closed: '已结案',
  filed: '已归档',
};

/** 核查状态值到标签的映射。 */
const CHECK_OPTION_LABEL: Record<string, string> = {
  not_required: '无需核查',
  running: '核查中',
  done: '已完成',
  failed: '未跑成',
};

/** 缺件状态值到标签的映射。 */
const GAP_OPTION_LABEL: Record<string, string> = {
  has_gap: '有缺件',
  no_gap: '无缺件',
};

/** 筛选键到显示标签的映射。 */
const FILTER_LABEL: Record<string, string> = {
  keyword: '关键词',
  domain: '法域',
  source: '来源',
  org: '机构',
  status: '状态',
  check: '核查',
  gap: '缺件',
};

/** 将筛选值转为可读标签。 */
function filterDisplayText(key: string, value: string): string {
  if (key === 'domain') return DOMAIN_OPTION_LABEL[value] ?? value;
  if (key === 'status') return STATUS_OPTION_LABEL[value] ?? value;
  if (key === 'check') return CHECK_OPTION_LABEL[value] ?? value;
  if (key === 'gap') return GAP_OPTION_LABEL[value] ?? value;
  return value;
}

/** 叙事摘要截断长度。 */
const NARRATIVE_MAX = 60;

function truncateNarrative(text: string): string {
  if (text.length <= NARRATIVE_MAX) return text;
  return `${text.slice(0, NARRATIVE_MAX)}…`;
}

/** 格式化登记日期（ISO → YYYY-MM-DD）。 */
function formatDate(iso: string): string {
  if (!iso) return '-';
  return iso.slice(0, 10);
}

export default function ClueCenterPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const state = readClueUrlState(searchParams.toString());
  const view = state.view || 'all';

  const { verification, duplicate, detail, trail, list } = useLoaderData() as {
    verification: Promise<VerificationView> | null;
    duplicate: Promise<DuplicateView> | null;
    detail: Promise<ClueDetail> | null;
    trail: Promise<TrailEntry[]> | null;
    list: Promise<ClueListPage>;
  };

  const dispatch = useAppDispatch();
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState(false);
  const [retryFailure, setRetryFailure] = useState<string | null>(null);
  const clueId = state.clue;
  const tab = state.tab === '' ? 'basic' : state.tab;

  /** 角色判断：监督且无经办/内勤角色时，补齐按钮不显示。 */
  const roles = useAppSelector((root) => root.login.operator?.roles) ?? [];
  const supervisorReadonly = roles.includes('监督') && !roles.includes('内勤') && !roles.includes('经办');

  const onReadReporterForBasic = async () => readReporter(dispatch, clueId);

  const onGapFill = async (fills: readonly { key: string; value: string }[]) => {
    const result = await fillGaps(dispatch, clueId, fills);
    if (result.ok) revalidator.revalidate();
    return result;
  };

  const onRetry = () => {
    setBusy(true);
    setRetryFailure(null);
    retryVerification(dispatch, clueId)
      .then((result) => {
        if (!result.ok) {
          setRetryFailure(
            result.status === 403 ? '没有重跑权限。' : `重跑未受理（${result.status}）。`,
          );
          return;
        }
        revalidator.revalidate();
      })
      .finally(() => setBusy(false));
  };

  /** 筛选值映射到 URL 参数并更新地址。 */
  const handleFilterChange = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    const paramKey = FILTER_PARAM_MAP[key] ?? key;
    if (value) {
      next.set(paramKey, value);
    } else {
      next.delete(paramKey);
    }
    // 筛选变化时回到第一页。
    next.delete(CLUE_PAGE_KEY);
    setSearchParams(next, { replace: true });
  };

  /** 翻页。 */
  const handlePageChange = (page: number) => {
    const next = new URLSearchParams(searchParams);
    if (page <= 1) {
      next.delete(CLUE_PAGE_KEY);
    } else {
      next.set(CLUE_PAGE_KEY, String(page));
    }
    setSearchParams(next, { replace: true });
  };

  /** 点击行打开抽屉。 */
  const handleRowClick = (row: ClueListRow) => {
    const next = new URLSearchParams(searchParams);
    next.set(CLUE_CLUE_KEY, row.id);
    next.set(CLUE_TAB_KEY, 'basic');
    setSearchParams(next, { replace: true });
  };

  // 当前筛选值。
  const filterValue: ClueCenterFiltersValue = {
    domain: state.filters.domain ?? '',
    source: state.filters.source ?? '',
    org: state.filters.org ?? '',
    status: state.filters.status ?? '',
    check: state.filters.check ?? '',
    gap: state.filters.gap ?? '',
    keyword: state.keyword ?? '',
    from: state.from ?? '',
    to: state.to ?? '',
  };

  // 活跃筛选条件列表（用于标签回显）。
  const activeConditions: { key: string; label: string; text: string }[] = [];
  if (state.keyword) {
    activeConditions.push({ key: 'keyword', label: '关键词', text: state.keyword });
  }
  for (const k of ['domain', 'source', 'org', 'status', 'check', 'gap'] as const) {
    const v = state.filters[k];
    if (v) {
      activeConditions.push({ key: k, label: FILTER_LABEL[k] ?? k, text: filterDisplayText(k, v) });
    }
  }
  const hasDateFilter = !!(state.from || state.to);

  const searchString = searchParams.toString();

  return (
    <>
      <div className="crumb"><b>线索中心</b></div>
      <div className="page-h">
        <div>
          <h1>线索中心</h1>
          <div className="desc">
            全部登记的线索统一进这里，可按视图、筛选与关键词查询；新办线索请到「统一工作台 · 登记新线索」。
          </div>
        </div>
      </div>
      <div
        className="banner blue"
        data-role="register-entry"
        style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}
      >
        <span>新办线索请到「统一工作台 · 登记新线索」；本中心只做查询、筛选与台账流转。</span>
        <Link className="btn btn-sm btn-primary" style={{ marginLeft: 'auto' }} to={CLUE_REGISTER_PATH}>
          去工作台登记
        </Link>
      </div>

      {/* 列表卡片 */}
      <div className="card">
        <div className="card-h">
          {clueViewLabel(view)}
          <span className="hint">视图、筛选与关键词都在地址里，可直接分享或收藏</span>
        </div>

        {/* 视图切换 */}
        <div className="filters">
          {CLUE_VIEWS.map((v) => (
            <Link
              key={v.id}
              className={v.id === view ? 'btn btn-sm btn-primary' : 'btn btn-sm'}
              to={withPreservedQuery(`/clue?${CLUE_VIEW_KEY}=${v.id}`, searchString)}
            >
              {v.label}
            </Link>
          ))}
        </div>

        {/* 筛选栏 */}
        <ClueCenterFilters value={filterValue} onChange={handleFilterChange} />

        {/* 活跃筛选条件回显 */}
        {(activeConditions.length > 0 || hasDateFilter) ? (
          <div className="filters">
            {activeConditions.map((c) => (
              <span key={c.key} className="tag gray">{`${c.label}：${c.text}`}</span>
            ))}
            {hasDateFilter ? (
              <span className="tag gray">{`登记日：${state.from || '不限'} 至 ${state.to || '不限'}`}</span>
            ) : null}
            <Link className="btn btn-sm" to={`/clue?${CLUE_VIEW_KEY}=${view}`}>
              清除筛选
            </Link>
          </div>
        ) : null}

        {/* 列表与分页 */}
        <Suspense
          fallback={
            <div className="card" aria-busy="true">
              <div className="skel" />
              <div className="skel" />
              <div className="skel" />
            </div>
          }
        >
          <Await resolve={list} errorElement={<div className="err">列表取数失败。</div>}>
            {(resolved: ClueListPage) => {
              if (resolved.rows.length === 0) {
                return (
                  <div className="empty">
                    <div className="t">没有匹配的线索</div>
                    <div>换一组筛选条件试试。</div>
                  </div>
                );
              }

              const totalPages = Math.max(1, Math.ceil(resolved.total / resolved.size));

              return (
                <>
                  <div style={{ overflowX: 'auto' }}>
                    <table className="table">
                      <thead>
                        <tr>
                          <th>编号</th>
                          <th>法域</th>
                          <th>来源</th>
                          <th>状态</th>
                          <th>核查状态</th>
                          <th>叙事摘要</th>
                          <th>标签</th>
                          <th>登记日期</th>
                          <th>缺件</th>
                        </tr>
                      </thead>
                      <tbody>
                        {resolved.rows.map((row) => (
                          <tr
                            key={row.id}
                            className={row.id === clueId ? 'dup-hit' : undefined}
                            style={{ cursor: 'pointer' }}
                            onClick={() => handleRowClick(row)}
                            data-clue-id={row.id}
                          >
                            <td className="mono">{row.code}</td>
                            <td>{DOMAIN_LABEL[row.domain as keyof typeof DOMAIN_LABEL] ?? row.domain}</td>
                            <td>{row.sourceCode}</td>
                            <td>
                              <span className="tag">{row.statusLabel}</span>
                            </td>
                            <td>
                              <span className="tag gray">{row.verificationStatusLabel}</span>
                            </td>
                            <td style={{ maxWidth: 280 }}>
                              {truncateNarrative(row.narrative)}
                            </td>
                            <td>
                              {row.tags.length > 0
                                ? row.tags.map((t) => (
                                    <span key={t} className="tag gray" style={{ marginRight: 4 }}>
                                      {t}
                                    </span>
                                  ))
                                : null}
                            </td>
                            <td>{formatDate(row.registeredAt)}</td>
                            <td>
                              {row.hasGaps ? (
                                <span className="tag amber">缺件</span>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* 分页 */}
                  <div
                    className="filters"
                    style={{ justifyContent: 'center', marginTop: 12, marginBottom: 0 }}
                  >
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={resolved.page <= 1}
                      onClick={() => handlePageChange(resolved.page - 1)}
                    >
                      上一页
                    </button>
                    <span style={{ fontSize: 13, color: 'var(--muted)' }}>
                      第 {resolved.page}/{totalPages} 页（共 {resolved.total} 条）
                    </span>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={resolved.page >= totalPages}
                      onClick={() => handlePageChange(resolved.page + 1)}
                    >
                      下一页
                    </button>
                  </div>
                </>
              );
            }}
          </Await>
        </Suspense>
      </div>

      {/* 办理面卡片 */}
      <div className="card">
        <div className="card-h">
          办理面
          <span className="hint">不派线索与结案提醒</span>
        </div>
        <ClueHeldSection />
        <ClueReminderSection />
      </div>

      {/* 抽屉卡片 */}
      {clueId === '' ? null : (
        <div className="card">
          <div className="card-h">
            线索详情
            <span className="hint">线索编号与页签都在地址里</span>
          </div>
          <div className="filters">
            {TABS.map((item) => (
              <Link
                key={item.id}
                className={item.id === tab ? 'btn btn-sm btn-primary' : 'btn btn-sm'}
                to={`/clue?${CLUE_VIEW_KEY}=${view}&clue=${clueId}&tab=${item.id}`}
              >
                {item.label}
              </Link>
            ))}
          </div>
          {tab === 'basic' ? (
            detail === null ? (
              <div className="empty">
                <div className="t">没有可看的详情</div>
                <div>地址里没有线索编号。</div>
              </div>
            ) : (
              <Suspense fallback={<div className="card" aria-busy="true">载入中…</div>}>
                <Await resolve={detail} errorElement={<div className="err">基本信息读取失败。</div>}>
                  {(resolved: ClueDetail) => (
                    <ClueBasicTab
                      view={resolved}
                      onReadReporter={onReadReporterForBasic}
                      onGapFill={onGapFill}
                      supervisorReadonly={supervisorReadonly}
                      busy={busy}
                    />
                  )}
                </Await>
              </Suspense>
            )
          ) : tab === 'verification' ? (
            verification === null ? (
              <div className="empty">
                <div className="t">没有可看的核查</div>
                <div>地址里没有线索编号。</div>
              </div>
            ) : (
              <Suspense fallback={<div className="card" aria-busy="true">载入中…</div>}>
                <Await resolve={verification} errorElement={<div className="err">核查结果读取失败。</div>}>
                  {(resolved: VerificationView) => (
                    <>
                      <ClueVerificationTab view={resolved} onRetry={onRetry} busy={busy} />
                      {retryFailure !== null ? <div className="err">{retryFailure}</div> : null}
                    </>
                  )}
                </Await>
              </Suspense>
            )
          ) : tab === 'duplicate' ? (
            duplicate === null ? (
              <div className="empty">
                <div className="t">没有可比的疑似重复</div>
                <div>地址里没有线索编号。</div>
              </div>
            ) : (
              <Suspense fallback={<div className="card" aria-busy="true">载入中…</div>}>
                <Await resolve={duplicate} errorElement={<div className="err">疑似重复比对读取失败。</div>}>
                  {(resolved: DuplicateView) => (
                    <ClueDuplicateTab
                      view={resolved}
                      onReadReporter={(otherClueId) => readReporter(dispatch, otherClueId)}
                    />
                  )}
                </Await>
              </Suspense>
            )
          ) : tab === 'trail' ? (
            trail === null ? (
              <div className="empty">
                <div className="t">没有可看的留痕</div>
                <div>地址里没有线索编号。</div>
              </div>
            ) : (
              <Suspense fallback={<div className="card" aria-busy="true">载入中…</div>}>
                <Await resolve={trail} errorElement={<div className="err">流转留痕读取失败。</div>}>
                  {(resolved: TrailEntry[]) => <ClueTrailTab entries={resolved} />}
                </Await>
              </Suspense>
            )
          ) : (
            <div className="empty">
              <div className="t">{TABS.find((item) => item.id === tab)?.label ?? '基本信息与要件'}</div>
              <div>本页签的内容在后续范围接入。</div>
            </div>
          )}
        </div>
      )}
    </>
  );
}