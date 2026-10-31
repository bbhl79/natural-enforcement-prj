// 统一工作台（一级入口）。主区二分页：待办｜登记新线索；工作台无侧栏。
// 录入＝总入口：本系统处理的所有线索都从「登记新线索」进入。
// 登记分区不渲染开单前步骤条：一进入即是完整表单；保存后结果里的链接可带 clue 参数
// 打开内业核查／分派决定，保留线索上下文续办。#214 的续办语义保持不变。
import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';

import { ClueVerificationTab } from '../clue/ClueVerificationTab';
import ClueDispatchSection from '../clue/ClueDispatchSection';
import ClueRegisterPage from '../clue/ClueRegisterPage';
import { loadDesignationTodos, type DesignationTodoItem } from '../clue/dispatch';
import { CLUE_REGISTER_PATH, registerStepPath } from '../clue/registration';
import { loadVerification, retryVerification, type VerificationView } from '../clue/verification';
import { useAppDispatch, useAppSelector } from '../hooks';
import { ErrorCard } from '../shell/StatusPages';
import { loadCardCounts, type WorkbenchCardCounts } from '../workbench/cards';

function quoted(roles: readonly string[]): string {
  const marks = roles.map((role) => `「${role}」`);
  if (marks.length <= 1) return marks.join('');
  return `${marks.slice(0, -1).join('、')}和${marks.at(-1)}`;
}

/** ②内业核查续办：带线索上下文打开既有线索的核查页签。 */
function VerificationContinue({ clueId }: { readonly clueId: string }) {
  const dispatch = useAppDispatch();
  const [view, setView] = useState<VerificationView | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const reload = useCallback(async () => {
    try {
      setView(await loadVerification(dispatch, clueId));
      setError(false);
    } catch {
      setError(true);
    }
  }, [dispatch, clueId]);
  useEffect(() => {
    void reload();
  }, [reload]);
  if (error) return <ErrorCard what="内业核查" onRetry={() => void reload()} />;
  if (!view) return <div className="card" aria-busy="true">载入中…</div>;
  return (
    <ClueVerificationTab
      view={view}
      busy={busy}
      onRetry={() => {
        void (async () => {
          setBusy(true);
          const result = await retryVerification(dispatch, clueId);
          setBusy(false);
          if (result.ok) setView(result.body);
        })();
      }}
    />
  );
}

/** 受理人待办：待处理的指定管辖报请（#215）；点开进③分派决定处理。 */
function DesignationTodos() {
  const dispatch = useAppDispatch();
  const [items, setItems] = useState<readonly DesignationTodoItem[]>([]);
  useEffect(() => {
    void loadDesignationTodos(dispatch).then(setItems, () => setItems([]));
  }, [dispatch]);
  if (items.length === 0) return null;
  return (
    <div className="card" data-role="designation-todos">
      <div className="card-h">
        待处理的指定管辖报请
        <span className="hint">{`${items.length} 项`}</span>
      </div>
      {items.map((item) => (
        <div className="form-row" key={item.requestId} data-role="designation-todo">
          <label>{item.clueCode}</label>
          <div>
            {`${item.requestingOrgName}报请：${item.reason}`}
            {item.proposedOrgName ? `（拟归属：${item.proposedOrgName}）` : ''}{' '}
            <Link className="btn btn-sm" to={registerStepPath(3, item.clueId)}>
              处理
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}

/** 看板卡片：标题、数字、说明与跳转链接。 */
function CardTile({
  title,
  count,
  desc,
  to,
}: {
  readonly title: string;
  readonly count: number;
  readonly desc: string;
  readonly to: string;
}) {
  return (
    <Link className="tile" to={to}>
      <div className="t">{title}</div>
      {count > 0 ? <div className="n">{count}</div> : null}
      <div className="d">{desc}</div>
    </Link>
  );
}

/** 一线看板六卡（内勤／经办）：2x3 网格。 */
function FrontlineCards({ counts }: { readonly counts: WorkbenchCardCounts['frontline'] }) {
  return (
    <div
      className="tiles"
      style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}
      data-role="frontline-cards"
    >
      <CardTile title="待分派决定" count={counts.pendingDecision} desc="需要做出派/不派决定的线索" to="/clue?view=assign&status=pending_decision" />
      <CardTile title="待派机构" count={counts.orgAssigned} desc="已决定派出、待指定承办机构" to="/clue?view=assign&status=org_assigned" />
      <CardTile title="待派承办人" count={counts.handlerAssigned} desc="已派机构、待指定主办与协办" to="/clue?view=assign&status=handler_assigned" />
      <CardTile title="不派线索" count={counts.held} desc="已决定不派的暂存线索" to="/clue?view=held" />
      <CardTile title="结案提醒" count={counts.reminders} desc="未处理的别案结案提醒" to="/clue?view=remind" />
      <CardTile title="待处理指定管辖" count={counts.designationPending} desc="待受理的指定管辖报请" to="/clue?view=assign" />
    </div>
  );
}

/** 领导看板四卡（法制审核／行政审核／行政审批）：2x2 网格。 */
function LeaderCards({ counts }: { readonly counts: WorkbenchCardCounts['leader'] }) {
  return (
    <div
      className="tiles"
      style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}
      data-role="leader-cards"
    >
      <CardTile title="待审核" count={counts.lawReview} desc="待法制审核的线索" to="/clue?view=assign" />
      <CardTile title="待审批" count={counts.approval} desc="待行政审核／行政审批的线索" to="/clue?view=assign" />
      <CardTile title="结案提醒" count={counts.reminders} desc="未处理的别案结案提醒" to="/clue?view=remind" />
      <CardTile title="待处理指定管辖" count={counts.designationPending} desc="待受理的指定管辖报请" to="/clue?view=assign" />
    </div>
  );
}

/** 监督看板四卡：2x2 网格。 */
function SupervisionCards({ counts }: { readonly counts: WorkbenchCardCounts['supervision'] }) {
  return (
    <div
      className="tiles"
      style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}
      data-role="supervision-cards"
    >
      <CardTile title="全部线索" count={counts.total} desc="数据范围内的全部线索" to="/clue?view=all" />
      <CardTile title="待分派线索" count={counts.pendingDispatch} desc="在待分派池或待分派决定的线索" to="/clue?view=assign" />
      <CardTile title="不派线索" count={counts.held} desc="已决定不派的暂存线索" to="/clue?view=held" />
      <CardTile title="已结案线索" count={counts.closed} desc="已结案的线索" to="/clue?view=all&status=closed" />
    </div>
  );
}

/** 根据操作者角色判断是否可见指定角色组。 */
function hasRole(roles: readonly string[], candidates: readonly string[]): boolean {
  return roles.some((role) => candidates.includes(role));
}

const FRONTLINE_ROLES = ['内勤', '经办'] as const;
const LEADER_ROLES = ['法制审核', '行政审核', '行政审批'] as const;
const SUPERVISION_ROLE = '监督';

/**
 * 统一工作台。主区二分页：待办｜登记新线索。
 * 地址带 step=1|2|3 或落在 /workbench/register 时进登记分区；否则进待办。
 * 登记分区不渲染开单前步骤条；②／③ 带 clue=<id> 时续办该线索。
 */
export default function WorkbenchPage() {
  const operator = useAppSelector((root) => root.login.operator);
  const dispatch = useAppDispatch();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const stepParam = params.get('step') ?? '';
  const registerPath =
    pathname === CLUE_REGISTER_PATH || pathname.startsWith(`${CLUE_REGISTER_PATH}/`);
  const flow = registerPath || params.get('section') === 'flow' || stepParam !== '';
  const step = flow ? (stepParam === '2' || stepParam === '3' ? stepParam : '1') : '';
  const clueId = params.get('clue') ?? '';

  // 看板卡片计数：仅在待办分区加载。
  const [counts, setCounts] = useState<WorkbenchCardCounts | null>(null);
  const [countsError, setCountsError] = useState(false);
  useEffect(() => {
    if (flow) return;
    setCounts(null);
    setCountsError(false);
    loadCardCounts(dispatch).then(setCounts, () => setCountsError(true));
  }, [dispatch, flow]);
  if (!operator) return null;

  const reloadCounts = () => {
    setCountsError(false);
    loadCardCounts(dispatch).then(setCounts, () => setCountsError(true));
  };
  const stepTarget = (target: string) => registerStepPath(target, clueId);

  return (
    <>
      <div className="crumb"><b>统一工作台</b></div>
      <div className="page-h">
        <div>
          <h1>统一工作台</h1>
          <div className="desc">
            {`${operator.orgName ?? ''} · ${operator.roles.join('、')}　·　单入口：待办与登记新线索在页内切换；本系统处理的所有线索都从「登记新线索」进入`}
          </div>
        </div>
      </div>
      <div className="ws-sec-tabs" role="tablist" aria-label="工作台分区">
        <Link
          role="tab"
          aria-selected={!flow}
          className={flow ? 'ws-sec-tab' : 'ws-sec-tab on'}
          to="/workbench"
        >
          待办
        </Link>
        <Link
          role="tab"
          aria-selected={flow}
          className={flow ? 'ws-sec-tab on' : 'ws-sec-tab'}
          to={CLUE_REGISTER_PATH}
        >
          登记新线索
        </Link>
      </div>
      {operator.roles.length > 1 ? (
        <div className="banner gray">
          {`你同时担任${quoted(operator.roles)}。顶栏的五个一级入口都可进入，不用换一个登录标识重新登录。`}
        </div>
      ) : null}
      {flow ? (
        <>
          {step === '1' ? <ClueRegisterPage embedded /> : null}
          {step === '3' && clueId !== '' ? <ClueDispatchSection clueId={clueId} /> : null}
          {step === '3' && clueId === '' ? (
            <div className="card">
              <div className="empty">
                <div className="t">打开一条线索后开始分派决定</div>
                <div>从待办或线索中心打开待分派决定的线索，这里集中展示疑似重复并完成派／不派。</div>
                <div className="checks" style={{ justifyContent: 'center', marginTop: 10 }}>
                  <Link className="btn btn-sm" to={stepTarget('1')}>回到登记新线索</Link>
                </div>
              </div>
            </div>
          ) : null}
          {step === '2' && clueId !== '' ? <VerificationContinue clueId={clueId} /> : null}
          {step === '2' && clueId === '' ? (
            <div className="card">
              <div className="empty">
                <div className="t">打开一条线索后查看内业核查</div>
                <div>土地类与矿产类线索保存后自动核查；没跑成时重跑提示一直挂到跑成，线索仍可分派。</div>
                <div className="checks" style={{ justifyContent: 'center', marginTop: 10 }}>
                  <Link className="btn btn-sm" to={stepTarget('1')}>回到登记新线索</Link>
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <DesignationTodos />
          <div className="card">
            <div className="card-h">
              我的待办
              <span className="hint">按你当前身份给出待办与概览</span>
            </div>
            {countsError ? (
              <ErrorCard what="看板计数" onRetry={reloadCounts} />
            ) : !counts ? (
              <div className="card" aria-busy="true">
                <div className="skel" />
                <div className="skel" style={{ width: '60%' }} />
              </div>
            ) : (
              <>
                {hasRole(operator.roles, FRONTLINE_ROLES) ? (
                  <FrontlineCards counts={counts.frontline} />
                ) : null}
                {hasRole(operator.roles, LEADER_ROLES) ? (
                  <LeaderCards counts={counts.leader} />
                ) : null}
                {hasRole(operator.roles, [SUPERVISION_ROLE]) ? (
                  <SupervisionCards counts={counts.supervision} />
                ) : null}
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}
