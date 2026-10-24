// 统一工作台（一级入口）。待办看板的取数与线索录入三环节的办理界面由后续业务范围接入，
// 本页先给壳层：看板占位、录入三环节入口、以及按身份给出的角色说明。
import { Link, useSearchParams } from 'react-router';

import { useAppSelector } from '../hooks';

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

/**
 * 统一工作台。地址带 step=1|2|3 时进对应环节；不带时进待办看板。
 */
export default function WorkbenchPage() {
  const operator = useAppSelector((root) => root.login.operator);
  const [params] = useSearchParams();
  const step = params.get('step') ?? '';
  if (!operator) return null;
  const current = STEPS.find((item) => item.step === step);
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
                  to={`/workbench?step=${item.step}`}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="empty">
              <div className="t">本环节的办理界面尚未开放</div>
              <div>线索录入三环节的表单、核查与分派办理在后续范围接入，入口与地址先在此定型。</div>
            </div>
          </div>
        </>
      ) : (
        <>
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
