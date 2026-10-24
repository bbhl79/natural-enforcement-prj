import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';

import type { OperatorSession } from '../login/loginSlice';
import { activePrimaryKey, globalSearchPath, visiblePrimaries } from './menu';

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

/**
 * 顶栏：系统名称、一级五总入口、综合查询、用户与退出。
 * 一级入口在会话没有相应操作码时不渲染（无权限者看不到「系统管理」）。
 * 综合查询人人可用，不占一级，提交后进入线索中心并带关键词。
 */
export default function Topbar({ operator, onLogout }: {
  operator?: OperatorSession | null;
  onLogout?: () => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState('');
  const primaries = operator ? visiblePrimaries(operator.opcodes) : [];
  const active = operator ? activePrimaryKey(location.pathname) : null;

  function onSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void navigate(globalSearchPath(keyword));
  }

  return (
    <header className="topbar">
      <div className="top-brand">
        <Logo />
        <div>
          <div className="top-brand-text">{SYSTEM_NAME}</div>
          <div className="top-brand-sub">自然资源行政执法</div>
        </div>
      </div>
      {operator ? (
        <nav className="top-nav" aria-label="一级主菜单">
          {primaries.map((item) => (
            <Link
              key={item.id}
              to={item.path}
              className={item.id === active ? 'top-nav-item active' : 'top-nav-item'}
              data-primary={item.id}
              aria-current={item.id === active ? 'page' : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      ) : null}
      <div className="top-actions">
        {operator ? (
          <form className="global-search" onSubmit={onSearch} role="search" aria-label="综合查询">
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="综合查询：编号 / 地点 / 当事人…"
              aria-label="综合查询"
            />
            <button type="submit" className="gs-btn">搜索</button>
          </form>
        ) : null}
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
