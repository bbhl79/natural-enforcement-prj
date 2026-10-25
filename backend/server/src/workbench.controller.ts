// 工作台卡片计数接口（#207）。
//
// GET /api/workbench/card-counts  返回按身份分类的卡片数字。

import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import type { ActorRef } from '@natural-enforcement/identity';

import { SameOriginReadGuard } from './same-origin-read.guard.ts';
import type { AuthenticatedRequest } from './session.guard.ts';
import { WorkbenchService } from './workbench.service.ts';

interface HttpReply {
  status(code: number): HttpReply;
  json(body: unknown): void;
}

@Controller('api/workbench')
export class WorkbenchController {
  constructor(private readonly workbench: WorkbenchService) {}

  @Get('card-counts')
  @UseGuards(SameOriginReadGuard)
  async cardCounts(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
  ): Promise<void> {
    const outcome = await this.workbench.loadCardCounts(req.actor as ActorRef);
    res.status(outcome.status).json(outcome.body);
  }
}