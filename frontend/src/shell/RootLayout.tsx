import { useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';

import { useAppSelector } from '../hooks';
import { authRedirect } from '../routing';
import { LoadingShell, SessionEndedPage, SessionErrorPage } from './StatusPages';

/**
 * 根布局：认证状态变化时（登录、改口令、退出、接口返回 401/403 强制改密）按 #91 规则改写地址。
 * 与根 loader 共用 authRedirect，不做授权判断。
 */
export default function RootLayout() {
  const phase = useAppSelector((root) => root.login.phase);
  const explicitLogout = useAppSelector((root) => root.login.explicitLogout);
  const location = useLocation();
  const navigate = useNavigate();
  const target = authRedirect(phase, location, { keepPath: !explicitLogout });

  useEffect(() => {
    if (target) void navigate(target, { replace: true });
  }, [target, navigate]);

  if (phase === 'error') return <SessionErrorPage />;
  if (phase === 'expired') return <SessionEndedPage />;
  if (phase === 'unknown') return <LoadingShell />;
  if (target) return null;
  return <Outlet />;
}
