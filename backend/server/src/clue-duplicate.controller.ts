// 用途：提供疑似重复比对视图与实名查阅两个 HTTP 接口，委托 ClueDuplicateService；实名查阅的明文响应禁止缓存。
// 调用方：backend/server/src/app.module.ts 注册为控制器。
// 依据：backend/server/src/clue-duplicate.service.ts（#212；规格 B、规格 G）。
//
// 疑似重复比对与实名查阅接口（#212；规格 B、规格 G）。
//
// GET  /api/clues/:id/duplicates       疑似重复比对视图（按对方线索分组）
// POST /api/clues/:id/reporter-read    实名查阅（明文唯一出口；no-store）
//
// 实名查阅是写语义（留查阅留痕），所以走 POST；响应不回缓存。

import { Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';

import type { ActorRef } from '@natural-enforcement/identity';

import { ClueDuplicateService } from './clue-duplicate.service.ts';
import { SameOriginReadGuard } from './same-origin-read.guard.ts';
import type { AuthenticatedRequest } from './session.guard.ts';

interface HttpReply {
  status(code: number): HttpReply;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
}

// 疑似重复比对与实名查阅的 HTTP 入口，请求处理全部委托 ClueDuplicateService。
@Controller('api')
export class ClueDuplicateController {
  constructor(private readonly duplicates: ClueDuplicateService) {}

  // 疑似重复比对视图：命中按对方线索分组展示；操作码 clue.read；对象级按线索录入机构授权。
  @Get('clues/:id/duplicates')
  @UseGuards(SameOriginReadGuard)
  async read(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') clueId: string,
  ): Promise<void> {
    const outcome = await this.duplicates.read(req.actor as ActorRef, clueId);
    res.status(outcome.status).json(outcome.body);
  }

  // 实名查阅，返回反映人明文并写查阅留痕；操作码 clue.reference.read；对象级按线索录入机构授权。
  @Post('clues/:id/reporter-read')
  async readReporter(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') clueId: string,
  ): Promise<void> {
    const outcome = await this.duplicates.readReporter(req.actor as ActorRef, clueId);
    if (outcome.status === 200) {
      // 明文响应：不回缓存、不许浏览器猜内容类型。
      res.setHeader('cache-control', 'no-store');
      res.setHeader('x-content-type-options', 'nosniff');
    }
    res.status(outcome.status).json(outcome.body);
  }
}
