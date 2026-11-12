// 用途：调查终结报告与审理流程的 HTTP 接口，含报告呈批、审理人指定、审理意见与异议处理。
// 调查终结与审理的 HTTP 入口（#240）。
// 呈批走 doc.*；审理意见用 case.review.record；审理人指定复用行政审核一级的码（过渡，待 #230 回写 #71）。
// 明示放弃异议复用 doc.submit（过渡，待 #230 回写 #71）。

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

/** 调查终结与审理接口的 HTTP 适配层。 */
@Controller()
export class CaseReviewController {
  constructor(private readonly review: CaseReviewService) {}

  // 读取案件的调查终结与审理视图；操作码 case.read；对象级按案件承办机构校验。
  @Get('api/cases/:id/review')
  @UseGuards(SameOriginReadGuard)
  async read(@Req() req: AuthenticatedRequest, @Res() res: HttpReply, @Param('id') id: string): Promise<void> {
    const outcome = await this.review.read(req.actor as ActorRef, id);
    res.status(outcome.status).json(outcome.body);
  }

  // 保存调查终结报告草稿；操作码 doc.draft；对象级按案件承办机构校验，且须为本案主办或协办。
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

  // 提交调查终结报告呈批；操作码 doc.submit；对象级按案件承办机构校验，且须为本案主办或协办。
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

  // 审核调查终结报告并写入审核意见；操作码 doc.admin.review；对象级按案件承办机构校验。
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

  // 批准调查终结报告并指定审理人；操作码 doc.approve；对象级按案件承办机构校验。
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

  // 指定审理人；操作码 doc.admin.review（操作者持行政审批角色时改用 doc.approve）；对象级按案件承办机构校验，且操作者须为承办机构负责人。
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

  // 签出审理意见；操作码 case.review.record；对象级按案件承办机构校验，且操作者须持行政审核角色。
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

  // 保存异议草稿；操作码 doc.draft；对象级按案件承办机构校验，且须为本案主办或协办。
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

  // 提交异议；操作码 doc.submit；对象级按案件承办机构校验，且须为本案主办或协办。
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

  // 明示放弃异议；操作码 doc.submit；对象级按案件承办机构校验，且须为本案主办或协办。
  @Post('api/cases/:id/review-objection-waivers')
  @UseGuards(SameOriginReadGuard)
  async waiveObjection(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: { readonly note?: unknown },
  ): Promise<void> {
    const outcome = await this.review.waiveObjection(req.actor as ActorRef, id, { note: body.note });
    res.status(outcome.status).json(outcome.body);
  }

  // 对异议作出决定；操作码 doc.approve；对象级按案件承办机构校验。
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