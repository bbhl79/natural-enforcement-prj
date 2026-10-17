import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import { AccessControlService } from '@natural-enforcement/identity';

import { AuthService, type LoginOutcome } from './auth.service.ts';
import { Public } from './public.decorator.ts';
import { clearRememberCookie, clearSessionCookie, sourceAddress } from './session-cookie.ts';
import type { AuthenticatedRequest } from './session.guard.ts';

interface HttpReply {
  status(code: number): HttpReply;
  setHeader(name: string, value: string | string[]): void;
  json(body: unknown): void;
}

interface LoginBody {
  mobilePhone?: unknown;
  password?: unknown;
  rememberMe?: unknown;
}

interface PasswordBody {
  currentPassword?: unknown;
  newPassword?: unknown;
}

@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly access: AccessControlService,
  ) {}

  @Public()
  @Post('login')
  async login(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Body() body: LoginBody,
  ): Promise<void> {
    const outcome: LoginOutcome = await this.auth.login({
      mobilePhone: typeof body?.mobilePhone === 'string' ? body.mobilePhone.trim() : '',
      password: typeof body?.password === 'string' ? body.password : '',
      rememberMe: body?.rememberMe === true,
      cookieHeader: req.headers.cookie,
      sourceIp: sourceAddress(req),
    });
    if (outcome.setCookies && outcome.setCookies.length > 0) {
      res.setHeader('Set-Cookie', outcome.setCookies);
    }
    res.status(outcome.status).json(outcome.body);
  }

  @Public()
  @Get('session')
  async session(@Req() req: AuthenticatedRequest, @Res() res: HttpReply): Promise<void> {
    const active = req.resolution?.active ?? null;
    // 强制改密期间其余接口一律 403，清单为空；不另查。
    const opcodes = active && !this.auth.passwordChangeState(active.account)
      ? await this.access.listPermittedOpcodes(active.account.id)
      : [];
    res.status(200).json(this.auth.describe(active, opcodes));
  }

  @Post('password')
  async password(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Body() body: PasswordBody,
  ): Promise<void> {
    const outcome = await this.auth.changePassword({
      currentPassword: typeof body?.currentPassword === 'string' ? body.currentPassword : '',
      newPassword: typeof body?.newPassword === 'string' ? body.newPassword : '',
      active: req.resolution?.active ?? null,
      sourceIp: sourceAddress(req),
    });
    res.status(outcome.status).json(outcome.body);
  }

  @Post('logout')
  async logout(@Req() req: AuthenticatedRequest, @Res() res: HttpReply): Promise<void> {
    const outcome = await this.auth.logout(req.resolution?.active ?? null, req.headers.cookie, sourceAddress(req));
    res.setHeader('Set-Cookie', [clearSessionCookie(), clearRememberCookie()]);
    res.status(200).json(outcome);
  }
}
