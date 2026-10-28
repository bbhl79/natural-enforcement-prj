// 调查终结与审理的 HTTP 入口（#240）。
// 呈批走 doc.*；审理意见用 case.review.record；审理人指定复用行政审核一级的码（过渡，待 #230 回写 #71）。

import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { ActorRef } from '@natural-enforcement/identity';

import { readConfirmation } from './case-rule-confirmation.ts';
import { CaseReviewService } from './case-review.service.ts';
import { SameOriginReadGuard } from './same-origin-read.guard.ts';
import type { AuthenticatedRequest } from './session.guard.ts';

interface HttpReply {
  status(code: number): HttpReply;
  json(body: unknown): void;
}

@Controller()
export class CaseReviewController {
  constructor(private readonly review: CaseReviewService) {}

  @Get('api/cases/:id/review')
  @UseGuards(SameOriginReadGuard)
  async read(@Req() req: AuthenticatedRequest, @Res() res: HttpReply, @Param('id') id: string): Promise<void> {
    const outcome = await this.review.read(req.actor as ActorRef, id);
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/cases/:id/review-reports')
  @UseGuards(SameOriginReadGuard)
  async saveReport(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: { readonly content?: unknown; readonly reviewerId?: unknown },
  ): Promise<void> {
    const outcome = await this.review.saveReport(req.actor as ActorRef, id, body);
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/review-reports/:reportId/submit')
  @UseGuards(SameOriginReadGuard)
  async submitReport(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('reportId') reportId: string,
  ): Promise<void> {
    const outcome = await this.review.submitReport(req.actor as ActorRef, reportId);
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/review-reports/:reportId/review')
  @UseGuards(SameOriginReadGuard)
  async reviewReport(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('reportId') reportId: string,
    @Body() body: { readonly opinion?: unknown },
  ): Promise<void> {
    const outcome = await this.review.reviewReport(req.actor as ActorRef, reportId, {
      opinion: typeof body.opinion === 'string' ? body.opinion : null,
    });
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/review-reports/:reportId/approve')
  @UseGuards(SameOriginReadGuard)
  async approveReport(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('reportId') reportId: string,
    @Body() body: {
      readonly opinion?: unknown;
      readonly reviewerId?: unknown;
      readonly reviewerReason?: unknown;
      readonly confirmedRuleKeys?: unknown;
      readonly confirmReasons?: unknown;
    },
  ): Promise<void> {
    const outcome = await this.review.approveReport(req.actor as ActorRef, reportId, {
      opinion: typeof body.opinion === 'string' ? body.opinion : null,
      reviewerId: body.reviewerId,
      reviewerReason: body.reviewerReason,
      ...readConfirmation(body),
    });
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/cases/:id/reviewer-designations')
  @UseGuards(SameOriginReadGuard)
  async designate(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: {
      readonly personnelId?: unknown;
      readonly reason?: unknown;
      readonly confirmedRuleKeys?: unknown;
      readonly confirmReasons?: unknown;
    },
  ): Promise<void> {
    const outcome = await this.review.designate(req.actor as ActorRef, id, {
      personnelId: body.personnelId,
      reason: body.reason,
      ...readConfirmation(body),
    });
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/cases/:id/review-opinions')
  @UseGuards(SameOriginReadGuard)
  async recordOpinion(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: {
      readonly kind?: unknown;
      readonly content?: unknown;
      readonly confirmedRuleKeys?: unknown;
      readonly confirmReasons?: unknown;
    },
  ): Promise<void> {
    const outcome = await this.review.recordOpinion(req.actor as ActorRef, id, {
      kind: body.kind,
      content: body.content,
      ...readConfirmation(body),
    });
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/cases/:id/review-objections')
  @UseGuards(SameOriginReadGuard)
  async saveObjection(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: { readonly note?: unknown; readonly evidenceRefs?: unknown },
  ): Promise<void> {
    const outcome = await this.review.saveObjection(req.actor as ActorRef, id, body);
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/review-objections/:objectionId/submit')
  @UseGuards(SameOriginReadGuard)
  async submitObjection(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('objectionId') objectionId: string,
  ): Promise<void> {
    const outcome = await this.review.submitObjection(req.actor as ActorRef, objectionId);
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/review-objections/:objectionId/decide')
  @UseGuards(SameOriginReadGuard)
  async decideObjection(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('objectionId') objectionId: string,
    @Body() body: {
      readonly decision?: unknown;
      readonly note?: unknown;
      readonly decisionTransition?: unknown;
      readonly confirmedRuleKeys?: unknown;
      readonly confirmReasons?: unknown;
    },
  ): Promise<void> {
    const outcome = await this.review.decideObjection(req.actor as ActorRef, objectionId, {
      decision: body.decision,
      note: body.note,
      decisionTransition: body.decisionTransition,
      ...readConfirmation(body),
    });
    res.status(outcome.status).json(outcome.body);
  }
}