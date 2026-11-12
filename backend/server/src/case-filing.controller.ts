// 用途：立案呈批的保存、读取、待办与提交、审核、批准、退回、撤回 HTTP 接口。
// 立案呈批 HTTP 入口（#234）。

import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { ActorRef } from '@natural-enforcement/identity';

import { readConfirmation } from './case-rule-confirmation.ts';
import { CaseFilingService } from './case-filing.service.ts';
import { SameOriginReadGuard } from './same-origin-read.guard.ts';
import type { AuthenticatedRequest } from './session.guard.ts';

interface HttpReply {
  status(code: number): HttpReply;
  json(body: unknown): void;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** 立案呈批接口的 HTTP 适配层。 */
@Controller()
export class CaseFilingController {
  constructor(private readonly filing: CaseFilingService) {}

  // 保存立案呈批草稿；操作码 doc.draft；对象级按线索承办机构校验。
  @Post('api/clues/:id/filing-approval')
  @UseGuards(SameOriginReadGuard)
  async saveDraft(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: { readonly content?: unknown },
  ): Promise<void> {
    const outcome = await this.filing.saveDraft(req.actor as ActorRef, id, { content: body.content });
    res.status(outcome.status).json(outcome.body);
  }

  // 按线索读取当前立案呈批；操作码 doc.read；对象级按线索承办机构校验。
  @Get('api/clues/:id/filing-approval')
  @UseGuards(SameOriginReadGuard)
  async readByClue(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
  ): Promise<void> {
    const outcome = await this.filing.readByClue(req.actor as ActorRef, id);
    res.status(outcome.status).json(outcome.body);
  }

  // 列出操作者角色对应的立案呈批待办；无操作码（按登录角色与所属机构直接过滤待办）。
  @Get('api/filing-approvals/todo')
  @UseGuards(SameOriginReadGuard)
  async listTodos(@Req() req: AuthenticatedRequest, @Res() res: HttpReply): Promise<void> {
    const outcome = await this.filing.listTodos(req.actor as ActorRef);
    res.status(outcome.status).json(outcome.body);
  }

  // 提交立案呈批；操作码 doc.submit；对象级按线索承办机构校验。
  @Post('api/filing-approvals/:id/submit')
  @UseGuards(SameOriginReadGuard)
  async submit(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: {
      readonly confirmedRuleKeys?: unknown;
      readonly confirmReasons?: unknown;
    },
  ): Promise<void> {
    const confirmation = readConfirmation(body);
    const outcome = await this.filing.submit(req.actor as ActorRef, id, confirmation);
    res.status(outcome.status).json(outcome.body);
  }

  // 行政审核立案呈批；操作码 doc.admin.review；对象级按线索承办机构校验。
  @Post('api/filing-approvals/:id/review')
  @UseGuards(SameOriginReadGuard)
  async review(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: { readonly opinion?: unknown },
  ): Promise<void> {
    const outcome = await this.filing.review(req.actor as ActorRef, id, {
      opinion: typeof body.opinion === 'string' ? body.opinion : null,
    });
    res.status(outcome.status).json(outcome.body);
  }

  // 行政审批立案呈批；操作码 doc.approve；对象级按线索承办机构校验。
  @Post('api/filing-approvals/:id/approve')
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
    const outcome = await this.filing.approve(req.actor as ActorRef, id, {
      opinion: typeof body.opinion === 'string' ? body.opinion : null,
      confirmedRuleKeys: confirmation.confirmedRuleKeys,
      confirmReasons: confirmation.confirmReasons,
    });
    res.status(outcome.status).json(outcome.body);
  }

  // 退回立案呈批为草稿；操作码 doc.admin.review（审批阶段退回改用 doc.approve）；对象级按线索承办机构校验。
  @Post('api/filing-approvals/:id/return')
  @UseGuards(SameOriginReadGuard)
  async returnToDraft(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body()
    body: {
      readonly reasonCode?: unknown;
      readonly note?: unknown;
      readonly receiverId?: unknown;
      readonly inheritedCode?: unknown;
    },
  ): Promise<void> {
    const outcome = await this.filing.returnToDraft(req.actor as ActorRef, id, {
      reasonCode: text(body.reasonCode),
      note: text(body.note),
      receiverId: text(body.receiverId),
      inheritedCode: typeof body.inheritedCode === 'string' && body.inheritedCode.trim() !== '' ? body.inheritedCode : null,
    });
    res.status(outcome.status).json(outcome.body);
  }

  // 撤回已提交的立案呈批；操作码 doc.submit；对象级按线索承办机构校验。
  @Post('api/filing-approvals/:id/withdraw')
  @UseGuards(SameOriginReadGuard)
  async withdraw(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: { readonly opinion?: unknown },
  ): Promise<void> {
    const outcome = await this.filing.withdraw(req.actor as ActorRef, id, {
      opinion: text(body.opinion),
    });
    res.status(outcome.status).json(outcome.body);
  }
}
