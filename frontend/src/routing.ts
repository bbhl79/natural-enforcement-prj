// 页面路径与跳转规则（#91「页面路径约定」，经 #79 约束评论落到路由）。
// 纯函数：根路由 loader 与根布局共用同一套判定，不做授权判断。

import type { AuthPhase } from './login/loginSlice';

export const LOGIN_PATH = '/auth/login';
export const PASSWORD_PATH = '/auth/password';
/** 落地页：统一工作台（「/」是它的别名，路由表里重定向到本页）。 */
export const HOME_PATH = '/workbench';
/** 落地页的别名：「/」与 HOME_PATH 同义，都不带 next。 */
const HOME_ALIASES = ['/', HOME_PATH];

const PROBE_ORIGIN = 'http://next.invalid';

/**
 * 只接受以单个 `/` 开头的站内路径。以 `//` 开头、带协议或主机、
 * 以 `/auth/` 开头的值一律丢弃，返回 null。
 */
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  if (raw.includes('\\')) return null;
  if (raw === '/auth' || raw.startsWith('/auth/') || raw.startsWith('/auth?')) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw, PROBE_ORIGIN);
  } catch {
    return null;
  }
  if (parsed.origin !== PROBE_ORIGIN) return null;
  const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  // 归一化后可能重新出现 `//`（如 `/x/..//evil.example/path`），交给 redirect 会变成站外地址
  if (!path.startsWith('/') || path.startsWith('//')) return null;
  if (path === '/auth' || path.startsWith('/auth/')) return null;
  return path;
}

/** 认证页地址。原路径合规且不是首页时带上 next。 */
export function withNext(authPath: string, target: string | null | undefined): string {
  const next = safeNext(target);
  if (!next || HOME_ALIASES.includes(next)) return authPath;
  return `${authPath}?next=${encodeURIComponent(next)}`;
}

export interface RouteLocation {
  pathname: string;
  search: string;
}

function nextParam(location: RouteLocation): string | null {
  return new URLSearchParams(location.search).get('next');
}

/**
 * 按认证状态改写地址（#91 约定第 2、3 条）。不需要改写时返回 null。
 * - 认证状态未知、会话查询失败、会话已结束：不改写。
 * - 未登录：除登录页外改写到登录页，记下原路径；主动退出时不记。
 * - 强制改密：除改口令页外改写到改口令页，记下原路径。
 * - 已登录：访问登录页或改口令页时回到 next，没有或不合规时到首页。
 */
export function authRedirect(
  phase: AuthPhase,
  location: RouteLocation,
  options: { keepPath?: boolean } = {},
): string | null {
  const here = `${location.pathname}${location.search}`;
  const onLogin = location.pathname === LOGIN_PATH;
  const onPassword = location.pathname === PASSWORD_PATH;
  switch (phase) {
    case 'anonymous': {
      if (onLogin) return null;
      if (options.keepPath === false) return LOGIN_PATH;
      return withNext(LOGIN_PATH, onPassword ? nextParam(location) : here);
    }
    case 'password-change-required': {
      if (onPassword) return null;
      return withNext(PASSWORD_PATH, onLogin ? nextParam(location) : here);
    }
    case 'authenticated': {
      if (!onLogin && !onPassword) return null;
      const next = safeNext(nextParam(location));
      if (!next) return HOME_PATH;
      return HOME_ALIASES.includes(next) ? HOME_PATH : next;
    }
    default:
      return null;
  }
}
