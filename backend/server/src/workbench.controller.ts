// 用途：提供工作台卡片计数的 HTTP 接口，委托 WorkbenchService 按操作者可见机构范围取数。
// 调用方：backend/server/src/app.module.ts 注册为控制器。
// 依据：backend/server/src/workbench.service.ts（#207）。
//
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

// 工作台卡片计数的 HTTP 入口，请求处理全部委托 WorkbenchService。
@Controller('api/workbench')
export class WorkbenchController {
  constructor(private readonly workbench: WorkbenchService) {}

  // 返回按身份分类的卡片数字；操作码 clue.read；对象级按操作者所属机构及其子树授权。
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