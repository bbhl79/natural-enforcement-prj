import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ActorRef } from '@natural-enforcement/identity';

import { AuthService, type AuthResolution } from './auth.service.ts';
import { IS_PUBLIC } from './public.decorator.ts';
import { sourceAddress } from './session-cookie.ts';

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
  if (method === 'POST' && path === '/api/auth/login') return true;
  return false;
}

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
      throw new HttpException({ reason: 'not-authenticated' }, HttpStatus.UNAUTHORIZED);
    }
    req.actor = { personnelId: active.account.id, authenticated: true };
    return true;
  }
}
