// 路由（#105「前端：路由与应用壳」）：react-router data 模式，createBrowserRouter + RouterProvider。
// 根 loader 只取会话并按 #91 规则跳转，不做授权判断；页面 loader 只取数。
import { createBrowserRouter, redirect, type LoaderFunctionArgs, type RouteObject } from 'react-router';

import AdminHomePage from './admin/AdminHomePage';
import { adminHomeLoader } from './admin/adminHome';
import AuditPage from './admin/AuditPage';
import { auditLoader } from './admin/audit';
import OrgTreePage from './admin/OrgTreePage';
import { orgTreeLoader } from './admin/orgTree';
import LoginPage from './login/LoginPage';
import PasswordPage from './login/PasswordPage';
import WorkbenchPage, { workbenchLoader } from './pages/WorkbenchPage';
import { authRedirect } from './routing';
import AppShell, { AppShellError } from './shell/AppShell';
import RootLayout from './shell/RootLayout';
import { ensureSession, type SessionStore } from './session';
import { LoadingShell, NotFoundPage, SessionErrorPage } from './shell/StatusPages';
import './shell/console.css';

export type RouterStore = SessionStore;

/** 启动时先等会话查询返回，再按认证状态改写地址。 */
export function rootLoader(store: RouterStore) {
  return async ({ request }: LoaderFunctionArgs) => {
    await ensureSession(store);
    const login = store.getState().login;
    const url = new URL(request.url);
    const target = authRedirect(login.phase, url, { keepPath: !login.explicitLogout });
    if (target) throw redirect(target);
    return null;
  };
}

export function appRoutes(store: RouterStore): RouteObject[] {
  return [
    {
      id: 'root',
      path: '/',
      loader: rootLoader(store),
      shouldRevalidate: () => true,
      element: <RootLayout />,
      hydrateFallbackElement: <LoadingShell />,
      errorElement: <SessionErrorPage />,
      children: [
        { id: 'login', path: 'auth/login', element: <LoginPage /> },
        { id: 'password', path: 'auth/password', element: <PasswordPage /> },
        {
          id: 'shell',
          children: [
            {
              id: 'shell-pages',
              element: <AppShell />,
              errorElement: <AppShellError />,
              children: [
                { id: 'workbench', index: true, loader: workbenchLoader(store), element: <WorkbenchPage /> },
                { id: 'admin-home', path: 'admin', loader: adminHomeLoader(store), element: <AdminHomePage /> },
                { id: 'org-tree', path: 'admin/org-units', loader: orgTreeLoader(store), element: <OrgTreePage /> },
                { id: 'admin-audit', path: 'admin/audit', loader: auditLoader(store), element: <AuditPage /> },
                { id: 'not-found', path: '*', element: <NotFoundPage /> },
              ],
            },
          ],
        },
      ],
    },
  ];
}

export function createAppRouter(store: RouterStore) {
  return createBrowserRouter(appRoutes(store));
}
