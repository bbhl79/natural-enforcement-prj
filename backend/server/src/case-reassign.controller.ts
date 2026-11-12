// 用途：改派呈批的提交、批准、不批、撤回与材料效力认定 HTTP 接口。
// 改派呈批与材料效力认定 HTTP 入口（#239）。

import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { ActorRef } from '@natural-enforcement/identity';

import { CaseReassignService } from './case-reassign.service.ts';
import { CaseReturnService } from './case-return.service.ts';
import { SameOriginReadGuard } from './same-origin-read.guard.ts';
import type { AuthenticatedRequest } from './session.guard.ts';

interface HttpReply {
  status(code: number): HttpReply;
  json(body: unknown): void;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const optional = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;
const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/** 改派呈批与材料效力认定接口的 HTTP 适配层。 */
@Controller()
export class CaseReassignController {
  constructor(
    private readonly reassignments: CaseReassignService,
    private readonly returns: CaseReturnService,
  ) {}

  // 读取案件的改派呈批列表；操作码 case.read；对象级按案件承办机构校验。
  @Get('api/cases/:id/reassignments')
  @UseGuards(SameOriginReadGuard)
  async list(@Req() req: AuthenticatedRequest, @Res() res: HttpReply, @Param('id') id: string): Promise<void> {
    const outcome = await this.reassignments.list(req.actor as ActorRef, id);
    res.status(outcome.status).json(outcome.body);
  }

  // 提交改派呈批；操作码 case.reassign.submit；对象级按案件承办机构校验。
  @Post('api/cases/:id/reassignments')
  @UseGuards(SameOriginReadGuard)
  async submit(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: {
      readonly mainId?: unknown;
      readonly assistIds?: unknown;
      readonly reasonCode?: unknown;
      readonly note?: unknown;
      readonly conflictLineageId?: unknown;
    },
  ): Promise<void> {
    const outcome = await this.reassignments.submit(req.actor as ActorRef, id, {
      mainId: text(body.mainId),
      assistIds: stringList(body.assistIds),
      reasonCode: text(body.reasonCode),
      note: text(body.note),
      conflictLineageId: optional(body.conflictLineageId),
    });
    res.status(outcome.status).json(outcome.body);
  }

  // 批准改派呈批；操作码 doc.approve；对象级按案件承办机构校验。
  @Post('api/cases/:id/reassignments/:reassignmentId/approve')
  @UseGuards(SameOriginReadGuard)
  async approve(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Param('reassignmentId') reassignmentId: string,
    @Body() body: { readonly opinion?: unknown },
  ): Promise<void> {
    const outcome = await this.reassignments.approve(req.actor as ActorRef, id, reassignmentId, {
      opinion: optional(body.opinion),
    });
    res.status(outcome.status).json(outcome.body);
  }

  /** 不批（#279）：走 #238 退回，R10 须写明意见。 */
  // 操作码 doc.admin.review（操作者持行政审批角色时改用 doc.approve）；对象级按案件承办机构校验。
  @Post('api/cases/:id/reassignments/:reassignmentId/reject')
  @UseGuards(SameOriginReadGuard)
  async reject(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Param('reassignmentId') reassignmentId: string,
    @Body() body: { readonly opinion?: unknown },
  ): Promise<void> {
    const outcome = await this.returns.rejectReassignment(req.actor as ActorRef, id, reassignmentId, {
      opinion: text(body.opinion),
    });
    res.status(outcome.status).json(outcome.body);
  }

  /** 发起人批准前撤回（#279）。 */
  // 操作码 case.reassign.submit；对象级按案件承办机构校验。
  @Post('api/cases/:id/reassignments/:reassignmentId/withdraw')
  @UseGuards(SameOriginReadGuard)
  async withdraw(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Param('reassignmentId') reassignmentId: string,
    @Body() body: { readonly note?: unknown },
  ): Promise<void> {
    const outcome = await this.reassignments.withdraw(req.actor as ActorRef, id, reassignmentId, {
      note: optional(body.note),
    });
    res.status(outcome.status).json(outcome.body);
  }

  // 认定改派材料的效力；操作码 doc.draft；对象级按案件承办机构校验。
  @Post('api/cases/:id/material-effectivities')
  @UseGuards(SameOriginReadGuard)
  async determine(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: {
      readonly materialId?: unknown;
      readonly conclusion?: unknown;
      readonly reason?: unknown;
    },
  ): Promise<void> {
    const outcome = await this.reassignments.determineMaterial(req.actor as ActorRef, id, {
      materialId: text(body.materialId),
      conclusion: text(body.conclusion),
      reason: text(body.reason),
    });
    res.status(outcome.status).json(outcome.body);
  }
}