// 应用壳的状态页（P1、P2）与通用卡片。文案逐字取自原型 v0.4。
import { useEffect, type ReactNode } from 'react';
import { isRouteErrorResponse, Link, useLocation, useRevalidator, useRouteError } from 'react-router';

import { useAppDispatch } from '../hooks';
import { acknowledgeSessionEnd } from '../login/loginSlice';
import { HOME_PATH, LOGIN_PATH, withNext } from '../routing';
import { SideNavSkeleton } from './SideNav';
import Topbar from './Topbar';

/** 没有左导的整页（会话失败、会话已结束、改口令）：顶栏不显示用户。 */
export function BarePage({ children }: { children: ReactNode }) {
  return (
    <div className="console">
      <Topbar />
      {children}
    </div>
  );
}

/** P1 loading：顶栏无用户、左导骨架，不先渲染菜单。 */
export function LoadingShell() {
  return (
    <div className="console">
      <Topbar />
      <div className="shell">
        <SideNavSkeleton />
        <main className="main">
          <div className="center-page">
            <div className="center-box"><p>正在确认登录状态…</p></div>
          </div>
        </main>
      </div>
    </div>
  );
}

/** P1 error：会话查询失败，可刷新重试，无工程报错。 */
export function SessionErrorPage() {
  return (
    <BarePage>
      <div className="center-page">
        <div className="center-box">
          <h2>暂时无法确认登录状态</h2>
          <p>网络或服务暂时不可用。请稍后刷新页面重试。</p>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>刷新</button>
        </div>
      </div>
    </BarePage>
  );
}

/** 会话已结束后自动前往登录页的等待时间。 */
export const SESSION_END_REDIRECT_MS = 3000;

/** P1 expired：提示并带「去登录」，登录后回到原路径。 */
export function SessionEndedPage() {
  const dispatch = useAppDispatch();
  const location = useLocation();
  const target = withNext(LOGIN_PATH, `${location.pathname}${location.search}`);
  useEffect(() => {
    const timer = setTimeout(() => dispatch(acknowledgeSessionEnd()), SESSION_END_REDIRECT_MS);
    return () => clearTimeout(timer);
  }, [dispatch]);
  return (
    <BarePage>
      <div className="center-page">
        <div className="center-box">
          <h2>会话已结束</h2>
          <p>你已较长时间未操作，或会话已被结束。即将前往登录页，重新登录后回到刚才的页面。</p>
          <a
            className="btn btn-primary"
            href={target}
            data-route={target}
            onClick={(event) => {
              event.preventDefault();
              dispatch(acknowledgeSessionEnd());
            }}
          >
            去登录
          </a>
        </div>
      </div>
    </BarePage>
  );
}

/** P2 forbidden：403，人话说明无权限。 */
export function ForbiddenPage() {
  return (
    <div className="center-page">
      <div className="center-box" data-http="403">
        <div className="code">403</div>
        <h2>你没有权限打开这个页面</h2>
        <p>这个页面需要的权限不在你当前的角色里。如工作需要，请联系本单位的系统管理人员调整角色。</p>
        <Link className="btn btn-primary" to={HOME_PATH}>回到工作台</Link>
      </div>
    </div>
  );
}

/** P2 notfound：404，找不到页面。 */
export function NotFoundPage() {
  return (
    <div className="center-page">
      <div className="center-box" data-http="404">
        <div className="code">404</div>
        <h2>没有找到这个页面</h2>
        <p>地址可能输错了，或页面已经调整。请从左侧导航进入。</p>
        <Link className="btn btn-primary" to={HOME_PATH}>回到工作台</Link>
      </div>
    </div>
  );
}

/** 通用错误卡片（P3–P8 error）。 */
export function ErrorCard({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div className="card">
      <div className="empty">
        <div className="t">{`${what}没有加载出来`}</div>
        <div>网络或服务暂时不可用，请稍后重试。问题持续时请联系本单位的系统管理人员。</div>
        <div style={{ marginTop: 14 }}>
          <button type="button" className="btn btn-primary" onClick={onRetry}>重新加载</button>
        </div>
      </div>
    </div>
  );
}

/** 通用无权限卡片（P3、P4、P7、P8 denied）。 */
export function DeniedCard({ what }: { what: string }) {
  return (
    <div className="card">
      <div className="empty">
        <div className="t">{`你没有查看${what}的权限`}</div>
        <div>如工作需要，请联系本单位的系统管理人员调整角色。</div>
        <div style={{ marginTop: 14 }}>
          <Link className="btn" to={HOME_PATH}>回到工作台</Link>
        </div>
      </div>
    </div>
  );
}

/**
 * 错误携带的 HTTP 状态。loader 直接抛出的 data()/Response 会被路由换成错误响应；
 * 延迟数据（Await）里拒绝的 data() 保持原样，这里两种都认。
 */
export function errorStatus(error: unknown): number | null {
  if (isRouteErrorResponse(error)) return error.status;
  if (error && typeof error === 'object' && 'init' in error) {
    const init = (error as { init?: { status?: unknown } | null }).init;
    if (init && typeof init.status === 'number') return init.status;
  }
  return null;
}

/** 壳内页面的路由错误：403 显示无权限页，404 显示找不到页，其余显示可重试的错误卡片。 */
export function ShellRouteError() {
  const error = useRouteError();
  const revalidator = useRevalidator();
  const status = errorStatus(error);
  if (status === 403) return <ForbiddenPage />;
  if (status === 404) return <NotFoundPage />;
  return <ErrorCard what="页面" onRetry={() => void revalidator.revalidate()} />;
}
