// 路由（#105「前端：路由与应用壳」、#207 H 节路由契约、#209 执行票）：
// react-router data 模式，createBrowserRouter + RouterProvider。
// 根 loader 只取会话并按 #91 规则跳转，不做授权判断；页面 loader 只取数。
// 一级入口地址定型：/workbench、/clue、/case、/supervise、/admin；「/」重定向 /workbench。
import { createBrowserRouter, redirect, type LoaderFunctionArgs, type RouteObject } from 'react-router';

import CaseConflictPage from './case/CaseConflictPage';
import ChangePasswordPage from './account/ChangePasswordPage';
import AdminHomePage from './admin/AdminHomePage';
import { adminHomeLoader } from './admin/adminHome';
import AuditPage from './admin/AuditPage';
import { auditLoader } from './admin/audit';
import LockedPersonnelPage from './admin/LockedPersonnelPage';
import { lockedPersonnelLoader } from './admin/lockedPersonnel';
import OrgTreePage from './admin/OrgTreePage';
import { orgTreeLoader } from './admin/orgTree';
import PersonnelCardPage from './admin/PersonnelCardPage';
import PersonnelCreatePage from './admin/PersonnelCreatePage';
import PersonnelListPage from './admin/PersonnelListPage';
import {
  personnelCardLoader,
  personnelCreateLoader,
  personnelListLoader,
  shouldRevalidatePersonnelList,
} from './admin/personnel';
import LoginPage from './login/LoginPage';
import PasswordPage from './login/PasswordPage';
import { clueCenterLoader } from './clue/center';
import { CLUE_REGISTER_PATH, clueRegisterLoader } from './clue/registration';
import ClueCenterPage from './pages/ClueCenterPage';
import CaseDeadlinePage from './case/CaseDeadlinePage';
import CaseFinalizePage from './case/CaseFinalizePage';
import CaseTransferPage from './case/CaseTransferPage';
import { deadlineLoader } from './case/deadline';
import { finalizeLoader } from './case/finalize';
import { transferLoader } from './case/transfer';
import CaseInvestigationPage from './case/CaseInvestigationPage';
import { investigationLoader } from './case/investigation';
import CaseReviewPage from './case/CaseReviewPage';
import { reviewLoader } from './case/review';
import CaseValidityPage from './case/CaseValidityPage';
import { validityLoader } from './case/validity';
import PlannedCenterPage from './pages/PlannedCenterPage';
import WorkbenchPage from './pages/WorkbenchPage';
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

/** 「/」重定向到统一工作台。 */
export function homeRedirect() {
  return redirect('/workbench');
}

/**
 * 工作台登记壳的参照取数：只有进入登记壳（含旧 ?step= 续办）才预取。
 * 待办分区不取登记参照；②③ 续办也不需要。
 */
export function workbenchLoader(store: RouterStore) {
  return async (args: LoaderFunctionArgs) => {
    const url = new URL(args.request.url);
    const flow =
      url.pathname === CLUE_REGISTER_PATH ||
      url.pathname.startsWith(`${CLUE_REGISTER_PATH}/`) ||
      url.searchParams.has('step') ||
      url.searchParams.get('section') === 'flow';
    if (!flow) return null;
    const step = url.searchParams.get('step');
    // ②③ 续办不需要登记参照；其余（含缺省与非法值回落①）都要。
    if (step === '2' || step === '3') return null;
    return clueRegisterLoader(store)(args);
  };
}

/** 旧 /clue/register 并入工作台登记壳，保留来源、法域与步骤参数。 */
export function legacyClueRegisterLoader() {
  return ({ request }: LoaderFunctionArgs) =>
    redirect(`${CLUE_REGISTER_PATH}${new URL(request.url).search}`);
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
                { id: 'home', index: true, loader: homeRedirect },
                { id: 'workbench', path: 'workbench', loader: workbenchLoader(store), element: <WorkbenchPage /> },
                {
                  id: 'workbench-register',
                  path: 'workbench/register',
                  loader: workbenchLoader(store),
                  element: <WorkbenchPage />,
                },
                {
                  id: 'clue',
                  path: 'clue',
                  loader: clueCenterLoader(store),
                  element: <ClueCenterPage />,
                },
                {
                  id: 'clue-register',
                  path: 'clue/register',
                  loader: legacyClueRegisterLoader(),
                },
                { id: 'case', path: 'case', element: <PlannedCenterPage primary="case" /> },
                {
                  id: 'case-investigation',
                  path: 'case/:caseId/investigation',
                  loader: investigationLoader(store),
                  element: <CaseInvestigationPage />,
                },
                {
                  id: 'case-review',
                  path: 'case/:caseId/review',
                  loader: reviewLoader(store),
                  element: <CaseReviewPage />,
                },
                {
                  id: 'case-validity',
                  path: 'case/:caseId/validity',
                  loader: validityLoader(store),
                  element: <CaseValidityPage />,
                },
                {
                  id: 'case-deadline',
                  path: 'case/:caseId/deadline',
                  loader: deadlineLoader(store),
                  element: <CaseDeadlinePage />,
                },
                {
                  id: 'case-transfer',
                  path: 'case/:caseId/transfer',
                  loader: transferLoader(store),
                  element: <CaseTransferPage />,
                },
                {
                  id: 'case-finalize',
                  path: 'case/:caseId/finalize',
                  loader: finalizeLoader(store),
                  element: <CaseFinalizePage />,
                },
                { id: 'case-onsite', path: 'case/onsite-check', element: <PlannedCenterPage primary="case" /> },
                { id: 'case-trial', path: 'case/trial', element: <PlannedCenterPage primary="case" /> },
                { id: 'case-conflict', path: 'case/:caseId', element: <CaseConflictPage /> },
                { id: 'supervise', path: 'supervise', element: <PlannedCenterPage primary="supervise" /> },
                {
                  id: 'supervise-review',
                  path: 'supervise/review',
                  element: <PlannedCenterPage primary="supervise" />,
                },
                { id: 'admin-home', path: 'admin', loader: adminHomeLoader(store), element: <AdminHomePage /> },
                { id: 'org-tree', path: 'admin/org-units', loader: orgTreeLoader(store), element: <OrgTreePage /> },
                {
                  id: 'locked-personnel',
                  path: 'admin/locked-personnel',
                  loader: lockedPersonnelLoader(store),
                  element: <LockedPersonnelPage />,
                },
                { id: 'admin-audit', path: 'admin/audit', loader: auditLoader(store), element: <AuditPage /> },
                {
                  id: 'personnel',
                  path: 'admin/personnel',
                  loader: personnelListLoader(store),
                  shouldRevalidate: shouldRevalidatePersonnelList,
                  element: <PersonnelListPage />,
                },
                { id: 'personnel-new', path: 'admin/personnel/new', loader: personnelCreateLoader(store), element: <PersonnelCreatePage /> },
                { id: 'personnel-card', path: 'admin/personnel/:id', loader: personnelCardLoader(store), element: <PersonnelCardPage /> },
                { id: 'admin-roles', path: 'admin/roles', element: <PlannedCenterPage primary="admin" /> },
                { id: 'admin-reference', path: 'admin/reference', element: <PlannedCenterPage primary="admin" /> },
                { id: 'account-password', path: 'account/password', element: <ChangePasswordPage /> },
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
