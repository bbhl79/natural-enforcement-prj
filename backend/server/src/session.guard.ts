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
  actor?: ActorRef;
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
    if (isPublic) return true;
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const active = await this.auth.requireSession(req.headers.cookie, sourceAddress(req));
    if (!active) {
      throw new HttpException({ reason: 'not-authenticated' }, HttpStatus.UNAUTHORIZED);
    }
    req.actor = { personnelId: active.account.id, authenticated: true };
    return true;
  }
}
