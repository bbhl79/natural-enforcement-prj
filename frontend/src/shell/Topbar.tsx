import type { OperatorSession } from '../login/loginSlice';

export const SYSTEM_NAME = '广州市规划和自然资源局监督监管与执法协同系统';

function Logo() {
  return (
    <div className="logo" aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 32 32">
        <path fill="#fff" d="M16 3 27 8v8.2c0 6.4-4.2 10.6-11 13.3C9.2 26.8 5 22.6 5 16.2V8L16 3z" />
        <path d="M11.2 16.1 14.3 19.2 20.9 12.6" stroke="#1f6b56" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/** 顶栏（P1）：系统名称；已登录时显示姓名、机构、角色和退出。不显示工号、手机号、连通状态。 */
export default function Topbar({ operator, onLogout }: {
  operator?: OperatorSession | null;
  onLogout?: () => void;
}) {
  return (
    <header className="topbar">
      <div className="top-brand">
        <Logo />
        <div>
          <div className="top-brand-text">{SYSTEM_NAME}</div>
          <div className="top-brand-sub">自然资源行政执法</div>
        </div>
      </div>
      <div className="top-actions">
        {operator ? (
          <>
            <div className="user-chip">
              <div className="avatar" aria-hidden="true">{operator.name.slice(0, 1)}</div>
              <div className="user-meta">
                {operator.name}
                <br />
                <span>{`${operator.orgName ?? ''} · ${operator.roles.join('、')}`}</span>
              </div>
            </div>
            <button type="button" className="link-btn" onClick={onLogout}>退出</button>
          </>
        ) : null}
      </div>
    </header>
  );
}
