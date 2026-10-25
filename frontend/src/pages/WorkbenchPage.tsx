// 统一工作台（一级入口）。待办看板的取数与线索录入三环节的办理界面由后续业务范围接入，
// 本页先给壳层：看板占位、录入三环节入口、以及按身份给出的角色说明。
// #214：三环节步骤条走通——②内业核查与③分派决定带 clue 参数打开既有线索时，
// 保留线索上下文续办；环节切换不丢线索。
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { ClueVerificationTab } from '../clue/ClueVerificationTab';
import ClueDispatchSection from '../clue/ClueDispatchSection';
import { loadDesignationTodos, type DesignationTodoItem } from '../clue/dispatch';
import { loadVerification, retryVerification, type VerificationView } from '../clue/verification';
import { useAppDispatch, useAppSelector } from '../hooks';
import { ErrorCard } from '../shell/StatusPages';

function quoted(roles: readonly string[]): string {
  const marks = roles.map((role) => `「${role}」`);
  if (marks.length <= 1) return marks.join('');
  return `${marks.slice(0, -1).join('、')}和${marks.at(-1)}`;
}

/** 线索录入三环节：与侧栏二级一致，键位固定。 */
const STEPS = [
  { step: '1', label: '① 线索录入', desc: '登记来源、要件与空间位置，保存后线索进入线索中心。' },
  { step: '2', label: '② 内业核查', desc: '土地类与矿产类线索自动核查，逐面比对未结案线索。' },
  { step: '3', label: '③ 分派决定', desc: '集中看到疑似重复与命中比例，完成决定并落到承办机构与承办人。' },
] as const;

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
            <Link className="btn btn-sm" to={`/workbench?step=3&clue=${item.clueId}`}>
              处理
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * 统一工作台。地址带 step=1|2|3 时进对应环节；不带时进待办看板。
 * ②／③ 带 clue=<id> 时续办该线索，环节切换保留线索上下文。
 */
export default function WorkbenchPage() {
  const operator = useAppSelector((root) => root.login.operator);
  const [params] = useSearchParams();
  const step = params.get('step') ?? '';
  const clueId = params.get('clue') ?? '';
  if (!operator) return null;
  const current = STEPS.find((item) => item.step === step);
  const stepTarget = (target: string) =>
    clueId === '' ? `/workbench?step=${target}` : `/workbench?step=${target}&clue=${clueId}`;
  return (
    <>
      <div className="crumb"><b>统一工作台</b></div>
      <div className="page-h">
        <div>
          <h1>统一工作台</h1>
          <div className="desc">{`${operator.orgName ?? ''} · ${operator.roles.join('、')}`}</div>
        </div>
      </div>
      {operator.roles.length > 1 ? (
        <div className="banner gray">
          {`你同时担任${quoted(operator.roles)}。顶栏的五个一级入口都可进入，不用换一个登录标识重新登录。`}
        </div>
      ) : null}
      {current ? (
        <>
          <div className="card">
            <div className="card-h">
              {current.label}
              <span className="hint">线索录入入口</span>
            </div>
            <div className="desc" style={{ marginBottom: 10 }}>{current.desc}</div>
            <div className="checks">
              {STEPS.map((item) => (
                <Link
                  key={item.step}
                  className={item.step === step ? 'btn btn-sm btn-primary' : 'btn btn-sm'}
                  to={stepTarget(item.step)}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
          {step === '3' && clueId !== '' ? <ClueDispatchSection clueId={clueId} /> : null}
          {step === '3' && clueId === '' ? (
            <div className="card">
              <div className="empty">
                <div className="t">打开一条线索后开始分派决定</div>
                <div>从待办看板或线索中心打开待分派决定的线索，这里集中展示疑似重复并完成派／不派。</div>
              </div>
            </div>
          ) : null}
          {step === '2' && clueId !== '' ? <VerificationContinue clueId={clueId} /> : null}
          {step === '2' && clueId === '' ? (
            <div className="card">
              <div className="empty">
                <div className="t">打开一条线索后查看内业核查</div>
                <div>土地类与矿产类线索保存后自动核查；没跑成时重跑提示一直挂到跑成，线索仍可分派。</div>
              </div>
            </div>
          ) : null}
          {step === '1' ? (
            <div className="card">
              <div className="empty">
                <div className="t">线索登记</div>
                <div>
                  <Link className="btn btn-primary" to="/clue/register">进入线索登记</Link>
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
            <div className="empty">
              <div className="t">待办看板尚未开放</div>
              <div>看板取数接入后，这里按一线、领导、监督三类视角给出待办与概览。</div>
            </div>
          </div>
          <div className="card">
            <div className="card-h">
              线索录入入口
              <span className="hint">三环节逐步推进</span>
            </div>
            <div className="checks">
              {STEPS.map((item) => (
                <Link key={item.step} className="btn btn-sm" to={`/workbench?step=${item.step}`}>
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}
