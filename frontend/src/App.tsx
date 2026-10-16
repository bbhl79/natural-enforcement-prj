import { useEffect } from 'react';
import { Provider } from 'react-redux';

import HealthPanel from './health/HealthPanel';
import { useAppDispatch, useAppSelector } from './hooks';
import LoginPage from './login/LoginPage';
import { loadSession, logout } from './login/loginSlice';
import { store } from './store';

export function AuthShell() {
  const dispatch = useAppDispatch();
  const phase = useAppSelector((root) => root.login.phase);
  const operator = useAppSelector((root) => root.login.operator);

  useEffect(() => {
    void dispatch(loadSession());
  }, [dispatch]);

  if (phase === 'authenticated' && operator) {
    return (
      <>
        <header className="flex flex-wrap items-center gap-4 border-b border-slate-200 px-6 py-3 text-sm text-slate-800">
          <span>{operator.name}</span>
          <span>{operator.code}</span>
          <span>{operator.orgName ?? ''}</span>
          <span>{operator.roles.join('、')}</span>
          <button type="button" onClick={() => void dispatch(logout())}>退出</button>
        </header>
        <HealthPanel />
      </>
    );
  }

  if (phase === 'password-change-required') {
    return <p role="status">必须改口令</p>;
  }

  if (phase === 'unknown') {
    return <p>正在确认会话</p>;
  }

  return <LoginPage />;
}

export default function App() {
  return (
    <Provider store={store}>
      <AuthShell />
    </Provider>
  );
}
