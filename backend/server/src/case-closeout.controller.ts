// 送达（T24）、执行记载（T25）与结案（T26）的 HTTP 入口（#270）。
// 送达用 doc.submit；执行记载用 case.execution.record；结案拟制用 doc.draft，提交／审核／批准用 doc.*。

import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { ActorRef } from '@natural-enforcement/identity';

import { CaseCloseoutService } from './case-closeout.service.ts';
import { readConfirmation } from './case-rule-confirmation.ts';
import { SameOriginReadGuard } from './same-origin-read.guard.ts';
import type { AuthenticatedRequest } from './session.guard.ts';

interface HttpReply {
  status(code: number): HttpReply;
  json(body: unknown): void;
}

@Controller()
export class CaseCloseoutController {
  constructor(private readonly closeout: CaseCloseoutService) {}

  @Get('api/cases/:id/closeout')
  @UseGuards(SameOriginReadGuard)
  async read(@Req() req: AuthenticatedRequest, @Res() res: HttpReply, @Param('id') id: string): Promise<void> {
    const outcome = await this.closeout.read(req.actor as ActorRef, id);
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/cases/:id/delivery')
  async recordDelivery(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: {
      readonly kind?: unknown;
      readonly deliveredOn?: unknown;
      readonly deliverers?: unknown;
      readonly reasonRecord?: unknown;
      readonly announcementMaterials?: unknown;
      readonly note?: unknown;
      readonly confirmedRuleKeys?: unknown;
      readonly confirmReasons?: unknown;
    },
  ): Promise<void> {
    const outcome = await this.closeout.recordDelivery(req.actor as ActorRef, id, {
      content: {
        kind: body?.kind,
        deliveredOn: body?.deliveredOn,
        deliverers: body?.deliverers,
        reasonRecord: body?.reasonRecord,
        announcementMaterials: body?.announcementMaterials,
        note: body?.note,
      },
      ...readConfirmation(body),
    });
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/cases/:id/execution-records')
  async recordExecution(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: {
      readonly kind?: unknown;
      readonly note?: unknown;
      readonly attachments?: unknown;
      readonly confirmedRuleKeys?: unknown;
      readonly confirmReasons?: unknown;
    },
  ): Promise<void> {
    const outcome = await this.closeout.recordExecution(req.actor as ActorRef, id, {
      content: { kind: body?.kind, note: body?.note, attachments: body?.attachments },
      ...readConfirmation(body),
    });
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/cases/:id/closure')
  async draftClosure(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: {
      readonly note?: unknown;
      readonly confirmedRuleKeys?: unknown;
      readonly confirmReasons?: unknown;
    },
  ): Promise<void> {
    const outcome = await this.closeout.draftClosure(req.actor as ActorRef, id, {
      content: { note: body?.note },
      ...readConfirmation(body),
    });
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/closure-approvals/:approvalId/submit')
  async submitClosure(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('approvalId') approvalId: string,
  ): Promise<void> {
    const outcome = await this.closeout.submitClosure(req.actor as ActorRef, approvalId);
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/closure-approvals/:approvalId/review')
  async reviewClosure(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('approvalId') approvalId: string,
    @Body() body: { readonly opinion?: unknown },
  ): Promise<void> {
    const outcome = await this.closeout.reviewClosure(req.actor as ActorRef, approvalId, {
      opinion: typeof body?.opinion === 'string' ? body.opinion : null,
    });
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/closure-approvals/:approvalId/approve')
  async approveClosure(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('approvalId') approvalId: string,
    @Body() body: { readonly opinion?: unknown; readonly confirmedRuleKeys?: unknown; readonly confirmReasons?: unknown },
  ): Promise<void> {
    const outcome = await this.closeout.approveClosure(req.actor as ActorRef, approvalId, {
      opinion: typeof body?.opinion === 'string' ? body.opinion : null,
      ...readConfirmation(body),
    });
    res.status(outcome.status).json(outcome.body);
  }
}