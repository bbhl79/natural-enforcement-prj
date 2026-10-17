import { Outlet } from 'react-router';

import { useAppDispatch, useAppSelector } from '../hooks';
import { closeExpiryNotice, expiryNoticeVisible, logout } from '../login/loginSlice';
import SideNav from './SideNav';
import { LoadingShell } from './StatusPages';
import Topbar from './Topbar';

/** 口令到期横幅（X1）：剩 7 天以内出现，可关闭，同一会话关闭后不再出现。 */
export function ExpiryNotice({ daysRemaining, onClose }: { daysRemaining: number; onClose: () => void }) {
  return (
    <div className="banner amber" role="status" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span>{`口令还剩 ${daysRemaining} 天到期`}</span>
      <button type="button" className="link-btn" style={{ marginLeft: 'auto' }} onClick={onClose}>关闭</button>
    </div>
  );
}

/** 应用壳（P1）：业务区和管理台区在同一个壳里，左导按会话清单裁剪。 */
export default function AppShell() {
  const dispatch = useAppDispatch();
  const login = useAppSelector((root) => root.login);
  const operator = login.operator;
  if (!operator) return <LoadingShell />;
  return (
    <div className="console">
      <Topbar operator={operator} onLogout={() => void dispatch(logout())} />
      <div className="shell">
        <SideNav opcodes={operator.opcodes} />
        <main className="main">
          {expiryNoticeVisible(login) && login.daysRemaining !== null ? (
            <ExpiryNotice
              daysRemaining={login.daysRemaining}
              onClose={() => void dispatch(closeExpiryNotice())}
            />
          ) : null}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
