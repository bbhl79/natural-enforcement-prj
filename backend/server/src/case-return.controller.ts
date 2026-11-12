// 用途：案件退回、签名复用与文书重拟的 HTTP 接口。
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

/** 案件退回接口的 HTTP 适配层。 */
@Controller()
export class CaseReturnController {
  constructor(private readonly returns: CaseReturnService) {}

  // 退回案件到指定环节；操作码 doc.admin.review（操作者持行政审批角色时改用 doc.approve）；对象级按案件承办机构校验。
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

  // 复用既有签名；操作码 doc.admin.review（操作者持行政审批角色时改用 doc.approve）；对象级按案件承办机构校验。
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

  // 重新拟制案件文书；操作码 doc.draft；对象级按案件承办机构校验。
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
