import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { ActorRef } from '@natural-enforcement/identity';

import { PersonnelProfilesService } from './personnel-profiles.service.ts';
import { SameOriginReadGuard } from './same-origin-read.guard.ts';
import { sourceAddress } from './session-cookie.ts';
import type { AuthenticatedRequest } from './session.guard.ts';

interface HttpReply {
  status(code: number): HttpReply;
  json(body: unknown): void;
}

interface RegisterBody {
  code?: unknown;
  name?: unknown;
  orgUnitId?: unknown;
  mobilePhone?: unknown;
  initialPassword?: unknown;
  roles?: unknown;
  posts?: unknown;
  certNo?: unknown;
  certExpiresOn?: unknown;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const texts = (value: unknown): string[] =>
  (Array.isArray(value) ? value.map((item) => (typeof item === 'string' ? item : '')) : []);

/**
 * 管理台人员（#128）：列表、卡片、登记。
 * 跨站写请求由框架 CSRF 拒绝，跨站读请求由 SameOriginReadGuard 拒绝。
 */
@Controller('api/admin')
export class PersonnelController {
  constructor(private readonly personnel: PersonnelProfilesService) {}

  @Get('personnel')
  @UseGuards(SameOriginReadGuard)
  async list(@Req() req: AuthenticatedRequest, @Res() res: HttpReply): Promise<void> {
    const outcome = await this.personnel.list(req.actor as ActorRef);
    res.status(outcome.status).json(outcome.body);
  }

  @Get('personnel/:id')
  @UseGuards(SameOriginReadGuard)
  async card(@Req() req: AuthenticatedRequest, @Res() res: HttpReply, @Param('id') id: string): Promise<void> {
    const outcome = await this.personnel.card(req.actor as ActorRef, id, sourceAddress(req));
    res.status(outcome.status).json(outcome.body);
  }

  @Post('personnel')
  async register(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Body() body: RegisterBody,
  ): Promise<void> {
    const outcome = await this.personnel.register(
      req.actor as ActorRef,
      {
        code: text(body?.code),
        name: text(body?.name),
        orgUnitId: text(body?.orgUnitId),
        mobilePhone: text(body?.mobilePhone),
        initialPassword: text(body?.initialPassword),
        roles: texts(body?.roles),
        posts: texts(body?.posts),
        certNo: text(body?.certNo),
        certExpiresOn: text(body?.certExpiresOn),
      },
      sourceAddress(req),
    );
    res.status(outcome.status).json(outcome.body);
  }
}
