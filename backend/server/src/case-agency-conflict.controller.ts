// 机关层利害关系 HTTP 入口（#263）。
// 勾选走 doc.draft。不新增操作码。取消勾选由服务拒绝。

import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { ActorRef } from '@natural-enforcement/identity';

import { CaseAgencyConflictService } from './case-agency-conflict.service.ts';
import { SameOriginReadGuard } from './same-origin-read.guard.ts';
import type { AuthenticatedRequest } from './session.guard.ts';

interface HttpReply {
  status(code: number): HttpReply;
  json(body: unknown): void;
}

@Controller()
export class CaseAgencyConflictController {
  constructor(private readonly agency: CaseAgencyConflictService) {}

  @Get('api/cases/:id/agency-conflict')
  @UseGuards(SameOriginReadGuard)
  async read(@Req() req: AuthenticatedRequest, @Res() res: HttpReply, @Param('id') id: string): Promise<void> {
    const outcome = await this.agency.read(req.actor as ActorRef, id);
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/cases/:id/agency-conflict')
  @UseGuards(SameOriginReadGuard)
  async setChecked(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: { readonly checked?: unknown },
  ): Promise<void> {
    const outcome = await this.agency.setChecked(req.actor as ActorRef, id, body.checked);
    res.status(outcome.status).json(outcome.body);
  }
}
