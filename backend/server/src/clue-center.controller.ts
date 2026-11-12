// 用途：线索中心列表、线索详情与流转留痕的 HTTP 接口。
// 线索中心列表与详情接口（#207/#218）。
//
// GET /api/clues                        列表（视图筛选分页）
// GET /api/clues/:id/detail             线索基本信息与要件
// GET /api/clues/:id/trail              流转与留痕（不含 detail）
//
// 缺件补齐走已有的 POST /api/clues/:id/gaps/fill（ClueItemSupplementController）。

import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';

import type { ActorRef } from '@natural-enforcement/identity';

import {
  ClueCenterService,
  type ClueCenterListQuery,
} from './clue-center.service.ts';
import type { AuthenticatedRequest } from './session.guard.ts';

interface HttpReply {
  status(code: number): HttpReply;
  json(body: unknown): void;
}

/** 线索中心接口的 HTTP 适配层。 */
@Controller('api')
export class ClueCenterController {
  constructor(private readonly center: ClueCenterService) {}

  // 按视图与筛选条件分页列出操作者数据范围内的线索；无操作码（按数据范围查询，不做操作码授权）。
  @Get('clues')
  async list(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Query() query: ClueCenterListQuery,
  ): Promise<void> {
    const outcome = await this.center.list(req.actor as ActorRef, query);
    res.status(outcome.status).json(outcome.body);
  }

  // 读取线索详情与要件快照；操作码 clue.read；对象级按线索录入机构校验。
  @Get('clues/:id/detail')
  async readDetail(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') clueId: string,
  ): Promise<void> {
    const outcome = await this.center.readDetail(req.actor as ActorRef, clueId);
    res.status(outcome.status).json(outcome.body);
  }

  // 读取线索流转与留痕；操作码 clue.read；对象级按线索录入机构校验。
  @Get('clues/:id/trail')
  async listTrail(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') clueId: string,
  ): Promise<void> {
    const outcome = await this.center.listTrail(req.actor as ActorRef, clueId);
    res.status(outcome.status).json(outcome.body);
  }
}