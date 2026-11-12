// 用途：认证会话的 HTTP 接口，提供登录、会话视图、修改口令与登出。
// 调用方：前端登录页与前端外壳的会话查询。
// 边界：只做请求解析与 Cookie 响应头；认证判定、会话与留痕在 AuthService。
// 依据：ADR 0002；ADR 0010。
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

/** 认证会话接口的 HTTP 适配层。 */
@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly access: AccessControlService,
  ) {}

  // 校验手机号与口令并签发会话 Cookie；无操作码（登录前）。
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

  // 返回当前会话与可用操作码，未登录时返回空会话；无操作码（登录前）。
  @Public()
  @Get('session')
  async session(@Req() req: AuthenticatedRequest, @Res() res: HttpReply): Promise<void> {
    const active = req.resolution?.active ?? null;
    // 强制改密期间其余接口一律 403，清单为空；不另查。
    const opcodes = active && !this.auth.passwordChangeState(active.account)
      ? await this.access.listPermittedOpcodes(active.account.id)
      : [];
    res.status(200).json(await this.auth.describe(active, opcodes));
  }

  // 校验当前口令后改为新口令并结束其他会话；无操作码（仅需登录会话）。
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

  // 结束当前会话与记住我并清 Cookie；无操作码（仅需登录会话）。
  @Post('logout')
  async logout(@Req() req: AuthenticatedRequest, @Res() res: HttpReply): Promise<void> {
    const outcome = await this.auth.logout(req.resolution?.active ?? null, req.headers.cookie, sourceAddress(req));
    res.setHeader('Set-Cookie', [clearSessionCookie(), clearRememberCookie()]);
    res.status(200).json(outcome);
  }
}
