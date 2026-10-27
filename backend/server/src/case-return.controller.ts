// 案件退回 HTTP 入口（#238）。

import { Body, Controller, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { ActorRef } from '@natural-enforcement/identity';

import { CaseReturnService } from './case-return.service.ts';
import { SameOriginReadGuard } from './same-origin-read.guard.ts';
import type { AuthenticatedRequest } from './session.guard.ts';

interface HttpReply {
  status(code: number): HttpReply;
  json(body: unknown): void;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const optional = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null);

@Controller()
export class CaseReturnController {
  constructor(private readonly returns: CaseReturnService) {}

  @Post('api/cases/:id/returns')
  @UseGuards(SameOriginReadGuard)
  async returnCase(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: {
      readonly reasonCode?: unknown;
      readonly note?: unknown;
      readonly targetKey?: unknown;
      readonly receiverId?: unknown;
      readonly inheritedCode?: unknown;
      readonly defectiveStage?: unknown;
      readonly earlierChainLevel?: unknown;
    },
  ): Promise<void> {
    const outcome = await this.returns.returnCase(req.actor as ActorRef, id, {
      reasonCode: text(body.reasonCode),
      note: text(body.note),
      targetKey: text(body.targetKey),
      receiverId: text(body.receiverId),
      inheritedCode: optional(body.inheritedCode),
      defectiveStage: optional(body.defectiveStage),
      earlierChainLevel: optional(body.earlierChainLevel),
    });
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/cases/:id/signatures/:signatureId/reuse')
  @UseGuards(SameOriginReadGuard)
  async reuseSignature(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Param('signatureId') signatureId: string,
  ): Promise<void> {
    const outcome = await this.returns.reuseSignature(req.actor as ActorRef, id, signatureId);
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/cases/:id/document-drafts')
  @UseGuards(SameOriginReadGuard)
  async draftDocument(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
  ): Promise<void> {
    const outcome = await this.returns.draftDocument(req.actor as ActorRef, id);
    res.status(outcome.status).json(outcome.body);
  }
}
