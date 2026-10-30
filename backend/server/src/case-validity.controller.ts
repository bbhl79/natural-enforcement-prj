// 有效性确认、复核、重新告知与决定闸口的 HTTP 入口（#248）。
// 确认与重新告知复用 doc.submit；复核复用 doc.admin.review／legal.opinion.submit；
// 决定闸口复用 doc.approve（#270 在决定审批链调用服务方法）。

import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { ActorRef } from '@natural-enforcement/identity';

import { CaseValidityService } from './case-validity.service.ts';
import { readConfirmation } from './case-rule-confirmation.ts';
import { SameOriginReadGuard } from './same-origin-read.guard.ts';
import type { AuthenticatedRequest } from './session.guard.ts';

interface HttpReply {
  status(code: number): HttpReply;
  json(body: unknown): void;
}

@Controller()
export class CaseValidityController {
  constructor(private readonly validity: CaseValidityService) {}

  @Get('api/cases/:id/validity')
  @UseGuards(SameOriginReadGuard)
  async read(@Req() req: AuthenticatedRequest, @Res() res: HttpReply, @Param('id') id: string): Promise<void> {
    const outcome = await this.validity.read(req.actor as ActorRef, id);
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/cases/:id/validity-confirmations')
  @UseGuards(SameOriginReadGuard)
  async confirm(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: {
      readonly noticeId?: unknown;
      readonly conclusion?: unknown;
      readonly reason?: unknown;
      readonly reasonChanged?: unknown;
      readonly aggravationSource?: unknown;
      readonly aggravationReference?: unknown;
      readonly aggravationReason?: unknown;
    },
  ): Promise<void> {
    const outcome = await this.validity.confirm(req.actor as ActorRef, id, body);
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/validity-confirmations/:confirmationId/review')
  @UseGuards(SameOriginReadGuard)
  async review(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('confirmationId') confirmationId: string,
    @Body() body: { readonly conclusion?: unknown; readonly opinion?: unknown },
  ): Promise<void> {
    const outcome = await this.validity.review(req.actor as ActorRef, confirmationId, {
      conclusion: body.conclusion,
      opinion: body.opinion,
    });
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/cases/:id/notice-reissues')
  @UseGuards(SameOriginReadGuard)
  async reissue(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: {
      readonly reason?: unknown;
      readonly note?: unknown;
      readonly confirmedRuleKeys?: unknown;
      readonly confirmReasons?: unknown;
    },
  ): Promise<void> {
    const outcome = await this.validity.reissue(req.actor as ActorRef, id, {
      reason: body.reason,
      note: body.note,
      ...readConfirmation(body),
    });
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/cases/:id/validity-gate')
  @UseGuards(SameOriginReadGuard)
  async gate(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: { readonly summary?: unknown },
  ): Promise<void> {
    const outcome = await this.validity.assertValidityGate(req.actor as ActorRef, id, { summary: body.summary });
    res.status(outcome.status).json(outcome.body);
  }
}