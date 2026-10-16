import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ActorRef } from '@natural-enforcement/identity';

import { AuthService } from './auth.service.ts';
import { IS_PUBLIC } from './public.decorator.ts';
import { sourceAddress } from './session-cookie.ts';

export interface AuthenticatedRequest {
  headers: { cookie?: string };
  socket?: { remoteAddress?: string | null };
  method?: string;
  path?: string;
  url?: string;
  actor?: ActorRef;
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
    const active = await this.auth.loadActive(req.headers.cookie, sourceAddress(req), !isPublic);
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
