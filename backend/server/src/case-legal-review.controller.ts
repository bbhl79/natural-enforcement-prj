// 用途：法制审核与集体讨论的 HTTP 接口，含发起、意见签出、负责人签出、接收人改派、决定闸口与讨论记录。
// 法制审核与集体讨论的 HTTP 入口（#269）。
// 发起用 legal.review.request；审核人签出用 legal.opinion.submit；负责人签出用 doc.admin.review。
// 接收人改派复用 case.reassign.submit（G5）；集体讨论记录用 case.discussion.record。
// 决定闸口供决定审批链在领导审批前调用（#270 接线）。

import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { ActorRef } from '@natural-enforcement/identity';

import { readConfirmation } from './case-rule-confirmation.ts';
import { CaseLegalReviewService } from './case-legal-review.service.ts';
import { SameOriginReadGuard } from './same-origin-read.guard.ts';
import type { AuthenticatedRequest } from './session.guard.ts';

interface HttpReply {
  status(code: number): HttpReply;
  json(body: unknown): void;
}

/** 法制审核与集体讨论接口的 HTTP 适配层。 */
@Controller()
export class CaseLegalReviewController {
  constructor(private readonly legalReview: CaseLegalReviewService) {}

  // 读取案件的法制审核视图；操作码 case.read；对象级按案件承办机构校验。
  @Get('api/cases/:id/legal-review')
  @UseGuards(SameOriginReadGuard)
  async read(@Req() req: AuthenticatedRequest, @Res() res: HttpReply, @Param('id') id: string): Promise<void> {
    const outcome = await this.legalReview.read(req.actor as ActorRef, id);
    res.status(outcome.status).json(outcome.body);
  }

  // 发起法制审核并指定接收人；操作码 legal.review.request；对象级按案件承办机构校验。
  @Post('api/cases/:id/legal-review')
  @UseGuards(SameOriginReadGuard)
  async start(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: {
      readonly receiverId?: unknown;
      readonly manualItems?: unknown;
      readonly criminalTransfer?: unknown;
      readonly listId?: unknown;
      readonly listVersion?: unknown;
      readonly listLevel?: unknown;
    },
  ): Promise<void> {
    const outcome = await this.legalReview.start(req.actor as ActorRef, id, body);
    res.status(outcome.status).json(outcome.body);
  }

  // 法制审核人签出意见；操作码 legal.opinion.submit；对象级按案件承办机构校验。
  @Post('api/legal-reviews/:legalReviewId/opinions')
  @UseGuards(SameOriginReadGuard)
  async signOpinion(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('legalReviewId') legalReviewId: string,
    @Body() body: {
      readonly conclusion?: unknown;
      readonly content?: unknown;
      readonly failRoute?: unknown;
      readonly discussionRecordId?: unknown;
      readonly confirmedRuleKeys?: unknown;
      readonly confirmReasons?: unknown;
    },
  ): Promise<void> {
    const outcome = await this.legalReview.signOpinion(req.actor as ActorRef, legalReviewId, {
      conclusion: body.conclusion,
      content: body.content,
      failRoute: body.failRoute,
      discussionRecordId: body.discussionRecordId,
      ...readConfirmation(body),
    });
    res.status(outcome.status).json(outcome.body);
  }

  // 法制审核负责人签出结论；操作码 doc.admin.review；对象级按案件承办机构校验。
  @Post('api/legal-reviews/:legalReviewId/sign')
  @UseGuards(SameOriginReadGuard)
  async signConclusion(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('legalReviewId') legalReviewId: string,
    @Body() body: { readonly opinion?: unknown },
  ): Promise<void> {
    const outcome = await this.legalReview.signConclusion(req.actor as ActorRef, legalReviewId, {
      opinion: body.opinion,
    });
    res.status(outcome.status).json(outcome.body);
  }

  // 改派法制审核接收人；操作码 case.reassign.submit；对象级按案件承办机构校验。
  @Post('api/legal-reviews/:legalReviewId/reassign')
  @UseGuards(SameOriginReadGuard)
  async reassign(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('legalReviewId') legalReviewId: string,
    @Body() body: { readonly receiverId?: unknown; readonly reason?: unknown },
  ): Promise<void> {
    const outcome = await this.legalReview.reassignReceiver(req.actor as ActorRef, legalReviewId, body);
    res.status(outcome.status).json(outcome.body);
  }

  // 检查法制审核是否满足决定审批的前置条件；操作码 doc.approve；对象级按案件承办机构校验。
  @Post('api/cases/:id/legal-review-decision-gate')
  @UseGuards(SameOriginReadGuard)
  async decisionGate(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
  ): Promise<void> {
    const outcome = await this.legalReview.assertDecisionGate(req.actor as ActorRef, id);
    res.status(outcome.status).json(outcome.body);
  }

  // 标记案件需要集体讨论；操作码 doc.draft；对象级按案件承办机构校验，且须为本案主办或协办。
  @Post('api/cases/:id/discussion-marks')
  @UseGuards(SameOriginReadGuard)
  async markDiscussion(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: { readonly criteriaCodes?: unknown; readonly reason?: unknown },
  ): Promise<void> {
    const outcome = await this.legalReview.markDiscussion(req.actor as ActorRef, id, body);
    res.status(outcome.status).json(outcome.body);
  }

  // 录入集体讨论记录；操作码 case.discussion.record；对象级按案件承办机构校验，且须为本案主办或协办。
  @Post('api/cases/:id/discussion-records')
  @UseGuards(SameOriginReadGuard)
  async recordDiscussion(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: { readonly purposes?: unknown; readonly criteriaCodes?: unknown; readonly note?: unknown },
  ): Promise<void> {
    const outcome = await this.legalReview.recordDiscussion(req.actor as ActorRef, id, body);
    res.status(outcome.status).json(outcome.body);
  }
}