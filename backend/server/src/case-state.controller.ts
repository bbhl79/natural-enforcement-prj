// 用途：案件视图读取、状态迁移与审批链开启的 HTTP 接口。
// 案件状态机 HTTP 入口（#235）。

import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { ActorRef } from '@natural-enforcement/identity';

import { readConfirmation } from './case-rule-confirmation.ts';
import { CaseStateService } from './case-state.service.ts';
import { SameOriginReadGuard } from './same-origin-read.guard.ts';
import type { AuthenticatedRequest } from './session.guard.ts';

interface HttpReply {
  status(code: number): HttpReply;
  json(body: unknown): void;
}

/** 案件状态机接口的 HTTP 适配层。 */
@Controller()
export class CaseStateController {
  constructor(private readonly states: CaseStateService) {}

  // 读取案件主视图；操作码 case.read；对象级按案件承办机构校验。
  @Get('api/cases/:id')
  @UseGuards(SameOriginReadGuard)
  async read(@Req() req: AuthenticatedRequest, @Res() res: HttpReply, @Param('id') id: string): Promise<void> {
    const outcome = await this.states.read(req.actor as ActorRef, id);
    res.status(outcome.status).json(outcome.body);
  }

  // 读取案件环节标记；操作码 case.read；对象级按案件承办机构校验。
  @Get('api/cases/:id/markers')
  @UseGuards(SameOriginReadGuard)
  async markers(@Req() req: AuthenticatedRequest, @Res() res: HttpReply, @Param('id') id: string): Promise<void> {
    const outcome = await this.states.readMarkers(req.actor as ActorRef, id);
    res.status(outcome.status).json(outcome.body);
  }

  // 推进案件状态迁移；操作码 doc.approve；对象级按案件承办机构校验。
  @Post('api/cases/:id/transitions')
  @UseGuards(SameOriginReadGuard)
  async transition(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: {
      readonly transitionId?: unknown;
      readonly handlingOrgId?: unknown;
      readonly confirmedRuleKeys?: unknown;
      readonly confirmReasons?: unknown;
    },
  ): Promise<void> {
    const confirmation = readConfirmation(body);
    const outcome = await this.states.transition(req.actor as ActorRef, id, {
      transitionId: typeof body.transitionId === 'string' ? body.transitionId : '',
      handlingOrgId: typeof body.handlingOrgId === 'string' ? body.handlingOrgId : null,
      confirmedRuleKeys: confirmation.confirmedRuleKeys,
      confirmReasons: confirmation.confirmReasons,
    });
    res.status(outcome.status).json(outcome.body);
  }

  // 开启审批链；操作码 doc.submit；对象级按案件承办机构校验。
  @Post('api/cases/:id/approval-chains')
  @UseGuards(SameOriginReadGuard)
  async openChain(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: {
      readonly kind?: unknown;
      readonly confirmedRuleKeys?: unknown;
      readonly confirmReasons?: unknown;
    },
  ): Promise<void> {
    const confirmation = readConfirmation(body);
    const outcome = await this.states.openApprovalChain(req.actor as ActorRef, id, {
      kind: typeof body.kind === 'string' ? body.kind : '',
      confirmedRuleKeys: confirmation.confirmedRuleKeys,
      confirmReasons: confirmation.confirmReasons,
    });
    res.status(outcome.status).json(outcome.body);
  }
}
