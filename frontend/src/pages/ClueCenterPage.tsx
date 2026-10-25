// 线索中心（一级入口）。视图、关键词、筛选、日期与分页都从地址取（见 shell/clueUrl.ts），
// 本页只提供入口与筛选条件的回显；线索清单的取数与列表由后续业务范围接入。
// 抽屉按四页签装配（基本信息与要件／内业核查／疑似重复比对／流转与留痕），
// 本期落地的是「内业核查」页签（#213）。
import { Suspense, useState } from 'react';
import { Await, Link, useLoaderData, useRevalidator, useSearchParams } from 'react-router';

import { useAppDispatch } from '../hooks';
import { ClueDuplicateTab } from '../clue/ClueDuplicateTab';
import { ClueVerificationTab } from '../clue/ClueVerificationTab';
import { readReporter, type DuplicateView } from '../clue/duplicate';
import { retryVerification, type VerificationView } from '../clue/verification';
import { clueViewLabel, readClueUrlState, CLUE_VIEW_KEY } from '../shell/clueUrl';

/** 抽屉四页签（规格 H 节）。 */
const TABS = [
  { id: 'basic', label: '基本信息与要件' },
  { id: 'verification', label: '内业核查' },
  { id: 'duplicate', label: '疑似重复比对' },
  { id: 'trail', label: '流转与留痕' },
] as const;

export default function ClueCenterPage() {
  const [params] = useSearchParams();
  const state = readClueUrlState(params.toString());
  const view = state.view || 'all';
  const filters = Object.entries(state.filters).filter(([, value]) => value);
  const { verification, duplicate } = useLoaderData() as {
    verification: Promise<VerificationView> | null;
    duplicate: Promise<DuplicateView> | null;
  };
  const dispatch = useAppDispatch();
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState(false);
  const [retryFailure, setRetryFailure] = useState<string | null>(null);
  const clueId = state.clue;
  const tab = state.tab === '' ? 'basic' : state.tab;

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

  return (
    <>
      <div className="crumb"><b>线索中心</b></div>
      <div className="page-h">
        <div>
          <h1>线索中心</h1>
          <div className="desc">全部登记的线索统一进这里，可按视图、筛选与关键词查询。</div>
        </div>
        <Link className="btn btn-primary" to="/clue/register">登记线索</Link>
      </div>
      <div className="card">
        <div className="card-h">
          {clueViewLabel(view)}
          <span className="hint">视图、筛选与关键词都在地址里，可直接分享或收藏</span>
        </div>
        <div className="filters">
          <span className="tag gray">{`视图：${clueViewLabel(view)}`}</span>
          {state.keyword ? <span className="tag">{`关键词：${state.keyword}`}</span> : null}
          {filters.map(([key, value]) => (
            <span key={key} className="tag gray">{`${key}：${value}`}</span>
          ))}
          {state.from || state.to ? (
            <span className="tag gray">{`登记日：${state.from || '不限'} 至 ${state.to || '不限'}`}</span>
          ) : null}
          {state.keyword || filters.length || state.from || state.to ? (
            <Link className="btn btn-sm" to={`/clue?${CLUE_VIEW_KEY}=${view}`}>清除筛选</Link>
          ) : null}
        </div>
        <div className="empty">
          <div className="t">线索清单尚未开放</div>
          <div>线索的查询与详情办理在后续范围接入。登记已开放：点上面的「登记线索」按来源与法域逐层填。</div>
        </div>
      </div>

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
          {tab === 'duplicate' ? (
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
          ) : tab !== 'verification' ? (
            <div className="empty">
              <div className="t">{TABS.find((item) => item.id === tab)?.label ?? '基本信息与要件'}</div>
              <div>本页签的内容在后续范围接入。</div>
            </div>
          ) : verification === null ? (
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
          )}
        </div>
      )}
    </>
  );
}
