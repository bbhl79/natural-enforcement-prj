// 定型（E13／T27）的 HTTP 入口（#243）。
// 材料入卷与归档审批拟制用 doc.draft；提交用 doc.submit；审核用 doc.admin.review；批准用 doc.approve。

import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { ActorRef } from '@natural-enforcement/identity';

import { readConfirmation } from './case-rule-confirmation.ts';
import { CaseFinalizeService } from './case-finalize.service.ts';
import { SameOriginReadGuard } from './same-origin-read.guard.ts';
import type { AuthenticatedRequest } from './session.guard.ts';

interface HttpReply {
  status(code: number): HttpReply;
  json(body: unknown): void;
}

@Controller()
export class CaseFinalizeController {
  constructor(private readonly finalizes: CaseFinalizeService) {}

  @Get('api/cases/:id/finalize')
  @UseGuards(SameOriginReadGuard)
  async read(@Req() req: AuthenticatedRequest, @Res() res: HttpReply, @Param('id') id: string): Promise<void> {
    const outcome = await this.finalizes.read(req.actor as ActorRef, id);
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/cases/:id/dossier-materials')
  async addMaterial(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: {
      readonly itemCode?: unknown;
      readonly title?: unknown;
      readonly note?: unknown;
      readonly delivery?: unknown;
    },
  ): Promise<void> {
    const outcome = await this.finalizes.addMaterial(req.actor as ActorRef, id, {
      itemCode: body?.itemCode,
      title: body?.title,
      note: body?.note,
      delivery: body?.delivery,
    });
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/cases/:id/finalize')
  async draft(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: {
      readonly missingReason?: unknown;
      readonly note?: unknown;
      readonly confirmedRuleKeys?: unknown;
      readonly confirmReasons?: unknown;
    },
  ): Promise<void> {
    const outcome = await this.finalizes.draft(req.actor as ActorRef, id, {
      content: { missingReason: body?.missingReason, note: body?.note },
      ...readConfirmation(body),
    });
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/finalize-approvals/:approvalId/submit')
  async submit(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('approvalId') approvalId: string,
    @Body() body: { readonly confirmedRuleKeys?: unknown; readonly confirmReasons?: unknown },
  ): Promise<void> {
    const outcome = await this.finalizes.submit(req.actor as ActorRef, approvalId, readConfirmation(body));
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/finalize-approvals/:approvalId/review')
  async review(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('approvalId') approvalId: string,
    @Body() body: { readonly opinion?: unknown },
  ): Promise<void> {
    const outcome = await this.finalizes.review(req.actor as ActorRef, approvalId, {
      opinion: typeof body?.opinion === 'string' ? body.opinion : null,
    });
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/finalize-approvals/:approvalId/approve')
  async approve(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('approvalId') approvalId: string,
    @Body() body: { readonly opinion?: unknown; readonly confirmedRuleKeys?: unknown; readonly confirmReasons?: unknown },
  ): Promise<void> {
    const outcome = await this.finalizes.approve(req.actor as ActorRef, approvalId, {
      opinion: typeof body?.opinion === 'string' ? body.opinion : null,
      ...readConfirmation(body),
    });
    res.status(outcome.status).json(outcome.body);
  }
}