// 用途：提供调查环节记录与程序呈批的读取、保存、提交、审核、批准、退回 HTTP 接口，委托 InvestigationService。
// 调用方：backend/server/src/app.module.ts 注册为控制器。
// 依据：backend/server/src/investigation.service.ts（#236）。
//
// 调查环节与收尾的 HTTP 入口（#236）。

import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { ActorRef } from '@natural-enforcement/identity';

import { readConfirmation } from './case-rule-confirmation.ts';
import { InvestigationService } from './investigation.service.ts';
import { SameOriginReadGuard } from './same-origin-read.guard.ts';
import type { AuthenticatedRequest } from './session.guard.ts';

interface HttpReply {
  status(code: number): HttpReply;
  json(body: unknown): void;
}

// 调查与程序接口的 HTTP 入口，请求处理全部委托 InvestigationService。
@Controller()
export class InvestigationController {
  constructor(private readonly investigation: InvestigationService) {}

  // 读取案件调查环节视图；操作码 case.read；对象级按案件承办机构授权。
  @Get('api/cases/:id/investigation')
  @UseGuards(SameOriginReadGuard)
  async read(@Req() req: AuthenticatedRequest, @Res() res: HttpReply, @Param('id') id: string): Promise<void> {
    const outcome = await this.investigation.read(req.actor as ActorRef, id);
    res.status(outcome.status).json(outcome.body);
  }

  // 保存违法记录；操作码 doc.draft；对象级须本案主办或协办。
  @Post('api/cases/:id/violations')
  @UseGuards(SameOriginReadGuard)
  async saveViolation(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: {
      readonly behaviorDescription?: unknown;
      readonly parties?: unknown;
      readonly startedOn?: unknown;
      readonly endedOn?: unknown;
      readonly recognition?: unknown;
      readonly confirmedRuleKeys?: unknown;
      readonly confirmReasons?: unknown;
    },
  ): Promise<void> {
    const confirmation = readConfirmation(body);
    const outcome = await this.investigation.saveViolation(req.actor as ActorRef, id, {
      behaviorDescription: body.behaviorDescription,
      parties: body.parties,
      startedOn: body.startedOn,
      endedOn: body.endedOn,
      recognition: body.recognition,
      confirmedRuleKeys: confirmation.confirmedRuleKeys,
      confirmReasons: confirmation.confirmReasons,
    });
    res.status(outcome.status).json(outcome.body);
  }

  // 作废违法记录；操作码 doc.draft；名册层按角色授权，作废条件另由规则判定。
  @Post('api/cases/:id/violations/:recordId/void')
  @UseGuards(SameOriginReadGuard)
  async voidViolation(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Param('recordId') recordId: string,
    @Body() body: { readonly reason?: unknown },
  ): Promise<void> {
    const outcome = await this.investigation.voidViolation(req.actor as ActorRef, id, recordId, {
      reason: body.reason,
    });
    res.status(outcome.status).json(outcome.body);
  }

  // 保存询问记录；操作码 doc.draft；对象级须本案主办或协办。
  @Post('api/cases/:id/inquiries')
  @UseGuards(SameOriginReadGuard)
  async saveInquiry(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: {
      readonly occurredAt?: unknown;
      readonly place?: unknown;
      readonly interviewee?: unknown;
      readonly officerIds?: unknown;
      readonly attachmentName?: unknown;
      readonly confirmedRuleKeys?: unknown;
      readonly confirmReasons?: unknown;
    },
  ): Promise<void> {
    const confirmation = readConfirmation(body);
    const outcome = await this.investigation.saveInquiry(req.actor as ActorRef, id, {
      occurredAt: body.occurredAt,
      place: body.place,
      interviewee: body.interviewee,
      officerIds: body.officerIds,
      attachmentName: body.attachmentName,
      confirmedRuleKeys: confirmation.confirmedRuleKeys,
      confirmReasons: confirmation.confirmReasons,
    });
    res.status(outcome.status).json(outcome.body);
  }

  // 保存当事人告知记录；操作码 doc.draft；对象级须本案主办或协办。
  @Post('api/cases/:id/party-notices')
  @UseGuards(SameOriginReadGuard)
  async saveNotice(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: {
      readonly occasion?: unknown;
      readonly note?: unknown;
      readonly confirmedRuleKeys?: unknown;
      readonly confirmReasons?: unknown;
    },
  ): Promise<void> {
    const confirmation = readConfirmation(body);
    const outcome = await this.investigation.saveNotice(req.actor as ActorRef, id, {
      occasion: body.occasion,
      note: body.note,
      confirmedRuleKeys: confirmation.confirmedRuleKeys,
      confirmReasons: confirmation.confirmReasons,
    });
    res.status(outcome.status).json(outcome.body);
  }

  // 保存程序草稿；操作码 doc.draft；对象级须本案主办或协办。
  @Post('api/cases/:id/procedures')
  @UseGuards(SameOriginReadGuard)
  async saveDraft(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: {
      readonly kind?: unknown;
      readonly reason?: unknown;
      readonly extendTogether?: unknown;
      readonly confirmedRuleKeys?: unknown;
      readonly confirmReasons?: unknown;
    },
  ): Promise<void> {
    const confirmation = readConfirmation(body);
    const outcome = await this.investigation.saveDraft(req.actor as ActorRef, id, {
      kind: body.kind,
      reason: body.reason,
      extendTogether: body.extendTogether,
      confirmedRuleKeys: confirmation.confirmedRuleKeys,
      confirmReasons: confirmation.confirmReasons,
    });
    res.status(outcome.status).json(outcome.body);
  }

  // 提交程序呈批；操作码 doc.submit；对象级须本案主办或协办。
  @Post('api/procedures/:id/submit')
  @UseGuards(SameOriginReadGuard)
  async submit(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: { readonly confirmedRuleKeys?: unknown; readonly confirmReasons?: unknown },
  ): Promise<void> {
    const confirmation = readConfirmation(body);
    const outcome = await this.investigation.submit(req.actor as ActorRef, id, confirmation);
    res.status(outcome.status).json(outcome.body);
  }

  // 审核程序呈批；操作码 doc.admin.review；名册层按角色授权，不另限本案主办或协办。
  @Post('api/procedures/:id/review')
  @UseGuards(SameOriginReadGuard)
  async review(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: { readonly opinion?: unknown },
  ): Promise<void> {
    const outcome = await this.investigation.review(req.actor as ActorRef, id, {
      opinion: typeof body.opinion === 'string' ? body.opinion : null,
    });
    res.status(outcome.status).json(outcome.body);
  }

  // 批准程序呈批；操作码 doc.approve；名册层按角色授权，不另限本案主办或协办。
  @Post('api/procedures/:id/approve')
  @UseGuards(SameOriginReadGuard)
  async approve(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: {
      readonly opinion?: unknown;
      readonly confirmedRuleKeys?: unknown;
      readonly confirmReasons?: unknown;
    },
  ): Promise<void> {
    const confirmation = readConfirmation(body);
    const outcome = await this.investigation.approve(req.actor as ActorRef, id, {
      opinion: typeof body.opinion === 'string' ? body.opinion : null,
      confirmedRuleKeys: confirmation.confirmedRuleKeys,
      confirmReasons: confirmation.confirmReasons,
    });
    res.status(outcome.status).json(outcome.body);
  }

  // 退回程序呈批；操作码 doc.admin.review；待审批状态改走 doc.approve，名册层按角色授权。
  @Post('api/procedures/:id/return')
  @UseGuards(SameOriginReadGuard)
  async returnToDraft(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: { readonly opinion?: unknown },
  ): Promise<void> {
    const outcome = await this.investigation.returnToDraft(req.actor as ActorRef, id, {
      opinion: typeof body.opinion === 'string' ? body.opinion : null,
    });
    res.status(outcome.status).json(outcome.body);
  }
}
