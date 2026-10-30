// 决定（E09／T23）的 HTTP 入口（#270）。
// 拟制用 doc.draft；提交用 doc.submit；审核用 doc.admin.review；批准用 doc.approve。

import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { ActorRef } from '@natural-enforcement/identity';

import { CaseDecisionService } from './case-decision.service.ts';
import { readConfirmation } from './case-rule-confirmation.ts';
import { SameOriginReadGuard } from './same-origin-read.guard.ts';
import type { AuthenticatedRequest } from './session.guard.ts';

interface HttpReply {
  status(code: number): HttpReply;
  json(body: unknown): void;
}

@Controller()
export class CaseDecisionController {
  constructor(private readonly decisions: CaseDecisionService) {}

  @Get('api/cases/:id/decision')
  @UseGuards(SameOriginReadGuard)
  async read(@Req() req: AuthenticatedRequest, @Res() res: HttpReply, @Param('id') id: string): Promise<void> {
    const outcome = await this.decisions.read(req.actor as ActorRef, id);
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/cases/:id/decision')
  async draft(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: {
      readonly correctionOrdered?: unknown;
      readonly evidenceRefs?: unknown;
      readonly note?: unknown;
      readonly confirmedRuleKeys?: unknown;
      readonly confirmReasons?: unknown;
    },
  ): Promise<void> {
    const outcome = await this.decisions.draft(req.actor as ActorRef, id, {
      content: {
        correctionOrdered: body?.correctionOrdered,
        evidenceRefs: body?.evidenceRefs,
        note: body?.note,
      },
      ...readConfirmation(body),
    });
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/decision-approvals/:approvalId/submit')
  async submit(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('approvalId') approvalId: string,
  ): Promise<void> {
    const outcome = await this.decisions.submit(req.actor as ActorRef, approvalId);
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/decision-approvals/:approvalId/review')
  async review(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('approvalId') approvalId: string,
    @Body() body: { readonly opinion?: unknown },
  ): Promise<void> {
    const outcome = await this.decisions.review(req.actor as ActorRef, approvalId, {
      opinion: typeof body?.opinion === 'string' ? body.opinion : null,
    });
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/decision-approvals/:approvalId/approve')
  async approve(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('approvalId') approvalId: string,
    @Body() body: { readonly opinion?: unknown; readonly confirmedRuleKeys?: unknown; readonly confirmReasons?: unknown },
  ): Promise<void> {
    const outcome = await this.decisions.approve(req.actor as ActorRef, approvalId, {
      opinion: typeof body?.opinion === 'string' ? body.opinion : null,
      ...readConfirmation(body),
    });
    res.status(outcome.status).json(outcome.body);
  }
}