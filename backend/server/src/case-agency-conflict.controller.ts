// 用途：机关层利害关系的读取与勾选 HTTP 接口，只提示，不改案件流转。
// 机关层利害关系 HTTP 入口（#263）。
// 勾选走 doc.draft。不新增操作码。取消勾选由服务拒绝。

import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { ActorRef } from '@natural-enforcement/identity';

import { CaseAgencyConflictService } from './case-agency-conflict.service.ts';
import { SameOriginReadGuard } from './same-origin-read.guard.ts';
import type { AuthenticatedRequest } from './session.guard.ts';

interface HttpReply {
  status(code: number): HttpReply;
  json(body: unknown): void;
}

/** 机关层利害关系接口的 HTTP 适配层。 */
@Controller()
export class CaseAgencyConflictController {
  constructor(private readonly agency: CaseAgencyConflictService) {}

  // 读取案件的机关层利害关系勾选；操作码 case.read；对象级按案件承办机构校验。
  @Get('api/cases/:id/agency-conflict')
  @UseGuards(SameOriginReadGuard)
  async read(@Req() req: AuthenticatedRequest, @Res() res: HttpReply, @Param('id') id: string): Promise<void> {
    const outcome = await this.agency.read(req.actor as ActorRef, id);
    res.status(outcome.status).json(outcome.body);
  }

  // 勾选机关层利害关系，取消勾选由服务拒绝；操作码 doc.draft；对象级按案件承办机构校验，且须为本案主办或协办。
  @Post('api/cases/:id/agency-conflict')
  @UseGuards(SameOriginReadGuard)
  async setChecked(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: { readonly checked?: unknown },
  ): Promise<void> {
    const outcome = await this.agency.setChecked(req.actor as ActorRef, id, body.checked);
    res.status(outcome.status).json(outcome.body);
  }
}
