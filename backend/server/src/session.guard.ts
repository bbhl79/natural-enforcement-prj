// 用途：全局会话守卫，解析会话与「记住我」Cookie 并决定请求放行或拒绝。
// 调用方：backend/server/src/app.module.ts 以 APP_GUARD 注册为全局守卫；各控制器经 AuthenticatedRequest 读取 req.actor。
// 边界：@Public 接口跳过登录要求；声明 SameOriginReadGuard 的读接口先做跨站判定；强制改密期间只放行改密、退出与会话查询。
// 依据：ADR 0002。
//
import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import type { ActorRef } from '@natural-enforcement/identity';

import { AuthService, type AuthResolution } from './auth.service.ts';
import { IS_PUBLIC } from './public.decorator.ts';
import { isCrossSiteRequest, SameOriginReadGuard } from './same-origin-read.guard.ts';
import { clearRememberCookie, clearSessionCookie, sourceAddress } from './session-cookie.ts';

/** 守卫放行后挂在请求上的身份与解析结果。 */
export interface AuthenticatedRequest {
  headers: { cookie?: string; 'x-forwarded-for'?: string | string[] };
  socket?: { remoteAddress?: string | null };
  method?: string;
  path?: string;
  url?: string;
  actor?: ActorRef;
  resolution?: AuthResolution;
}

function allowedDuringPasswordChange(req: AuthenticatedRequest): boolean {
  const method = (req.method ?? '').toUpperCase();
  const path = (req.path ?? req.url ?? '').split('?')[0];
  if (method === 'POST' && path === '/api/auth/password') return true;
  if (method === 'POST' && path === '/api/auth/logout') return true;
  if (method === 'GET' && path === '/api/auth/session') return true;
  return false;
}

/**
 * 全局会话守卫：先做声明式跨站判定，再解析会话与「记住我」并写回 Set-Cookie。
 * 放行条件：公开接口，或会话有效且不处于强制改密受限路径。
 * 拒绝结果：跨站 403 cross-site；未登录 401 not-authenticated；强制改密受限 403 带原因词。
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    // 声明了 SameOriginReadGuard 的读接口：跨站请求在识别身份之前就拒绝。
    // 全局守卫先于方法守卫执行，等到方法守卫再拒，openRequest 已经写了拒绝留痕、推进了活动时间或换发了记住我凭据。
    const guards = this.reflector.getAllAndMerge<unknown[]>(GUARDS_METADATA, [context.getHandler(), context.getClass()]);
    if (guards.includes(SameOriginReadGuard) && isCrossSiteRequest(req.headers as Record<string, string | string[] | undefined>)) {
      throw new HttpException({ result: 'cross-site' }, HttpStatus.FORBIDDEN);
    }
    const method = (req.method ?? '').toUpperCase();
    const path = (req.path ?? req.url ?? '').split('?')[0];
    const skipEntry = method === 'POST' && (path === '/api/auth/login' || path === '/api/auth/logout');
    const resolution = await this.auth.openRequest(
      req.headers.cookie,
      sourceAddress(req),
      !isPublic,
      !skipEntry,
    );
    req.resolution = resolution;
    if (resolution.setCookies.length > 0) {
      const res = context.switchToHttp().getResponse<{ setHeader(name: string, value: string | string[]): void }>();
      res.setHeader('Set-Cookie', resolution.setCookies);
    }
    const active = resolution.active;
    const gate = active ? this.auth.passwordChangeState(active.account) : null;
    if (active && gate && !allowedDuringPasswordChange(req)) {
      throw new HttpException({ result: gate }, HttpStatus.FORBIDDEN);
    }
    if (isPublic) return true;
    if (!active) {
      if (method === 'POST' && path === '/api/auth/logout') {
        await this.auth.dropPresentedRememberMe(req.headers.cookie);
        const res = context.switchToHttp().getResponse<{ setHeader(name: string, value: string | string[]): void }>();
        res.setHeader('Set-Cookie', [clearSessionCookie(), clearRememberCookie()]);
      }
      throw new HttpException({ reason: 'not-authenticated' }, HttpStatus.UNAUTHORIZED);
    }
    req.actor = { personnelId: active.account.id, authenticated: true };
    return true;
  }
}
