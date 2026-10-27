// 案件状态机 HTTP 入口（#235）。

import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { ActorRef } from '@natural-enforcement/identity';

import { CaseStateService } from './case-state.service.ts';
import { SameOriginReadGuard } from './same-origin-read.guard.ts';
import type { AuthenticatedRequest } from './session.guard.ts';

interface HttpReply {
  status(code: number): HttpReply;
  json(body: unknown): void;
}

@Controller()
export class CaseStateController {
  constructor(private readonly states: CaseStateService) {}

  @Get('api/cases/:id')
  @UseGuards(SameOriginReadGuard)
  async read(@Req() req: AuthenticatedRequest, @Res() res: HttpReply, @Param('id') id: string): Promise<void> {
    const outcome = await this.states.read(req.actor as ActorRef, id);
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/cases/:id/transitions')
  @UseGuards(SameOriginReadGuard)
  async transition(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: { readonly transitionId?: unknown; readonly handlingOrgId?: unknown },
  ): Promise<void> {
    const outcome = await this.states.transition(req.actor as ActorRef, id, {
      transitionId: typeof body.transitionId === 'string' ? body.transitionId : '',
      handlingOrgId: typeof body.handlingOrgId === 'string' ? body.handlingOrgId : null,
    });
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/cases/:id/approval-chains')
  @UseGuards(SameOriginReadGuard)
  async openChain(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: { readonly kind?: unknown },
  ): Promise<void> {
    const outcome = await this.states.openApprovalChain(req.actor as ActorRef, id, {
      kind: typeof body.kind === 'string' ? body.kind : '',
    });
    res.status(outcome.status).json(outcome.body);
  }
}
