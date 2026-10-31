// 统一工作台（一级入口）。主区＝统一待办清单（F1，#297）；工作台无侧栏。
// 录入＝总入口：页头主按钮「录入线索」打开既有 R1 完整登记表单；
// 表单区「← 返回待办」回清单。旧的 /workbench/register?step= 续办语义保持不变。
// 登记分区不渲染开单前步骤条：一进入即是完整表单；保存后结果里的链接可带 clue 参数
// 打开内业核查／分派决定，保留线索上下文续办。#214 的续办语义保持不变。
import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';

import { ClueVerificationTab } from '../clue/ClueVerificationTab';
import ClueDispatchSection from '../clue/ClueDispatchSection';
import ClueRegisterPage from '../clue/ClueRegisterPage';
import { CLUE_REGISTER_PATH, registerStepPath } from '../clue/registration';
import { loadVerification, retryVerification, type VerificationView } from '../clue/verification';
import { useAppDispatch, useAppSelector } from '../hooks';
import { ErrorCard } from '../shell/StatusPages';
import TodoList from '../workbench/TodoList';
import { loadWorkbenchTodos, type WorkbenchTodo } from '../workbench/todos';

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

/**
 * 统一工作台。主区＝统一待办清单；「录入线索」进入登记分区。
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

  // 待办清单：仅在待办分区加载。
  const [todos, setTodos] = useState<readonly WorkbenchTodo[] | null>(null);
  const [todosError, setTodosError] = useState(false);
  const [kind, setKind] = useState('');
  const [keyword, setKeyword] = useState('');
  const [keywordDraft, setKeywordDraft] = useState('');
  const reloadTodos = useCallback(() => {
    setTodos(null);
    setTodosError(false);
    loadWorkbenchTodos(dispatch).then(setTodos, () => setTodosError(true));
  }, [dispatch]);
  useEffect(() => {
    if (flow) return;
    reloadTodos();
  }, [flow, reloadTodos]);
  if (!operator) return null;

  const stepTarget = (target: string) => registerStepPath(target, clueId);

  return (
    <>
      <div className="crumb"><b>统一工作台</b></div>
      <div className="page-h">
        <div>
          <h1>统一工作台</h1>
          <div className="desc">
            {`当前登录身份：${operator.name}（所属机构：${operator.orgName ?? ''}） · 工作台＝当前待办统一清单；办完即清 · 新线索从「录入线索」进入`}
          </div>
        </div>
        <div className="actions">
          {flow ? (
            <Link className="btn" to="/workbench">← 返回待办</Link>
          ) : (
            <Link className="btn btn-primary" to={CLUE_REGISTER_PATH}>录入线索</Link>
          )}
        </div>
      </div>
      {operator.roles.length > 1 ? (
        <div className="banner gray">
          {`你同时担任${quoted(operator.roles)}。顶栏的五个一级入口都可进入，不用换一个登录标识重新登录。`}
        </div>
      ) : null}
      {flow ? (
        <>
          <Link className="wb-back" to="/workbench">← 返回待办</Link>
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
        <TodoList
          todos={todos}
          error={todosError}
          onRetry={reloadTodos}
          kind={kind}
          keyword={keyword}
          keywordDraft={keywordDraft}
          onKindChange={setKind}
          onKeywordChange={setKeywordDraft}
          onApply={() => setKeyword(keywordDraft.trim())}
          onReset={() => {
            setKind('');
            setKeyword('');
            setKeywordDraft('');
          }}
        />
      )}
    </>
  );
}