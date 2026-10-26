// 疑似重复的绘斑重绘接口（#212；规格 B）。
//
// POST /api/clues/:id/geometry   重绘（新空间版本，写事务内同步重算疑似重复）
//
// 重绘是写操作：只许录入人本人，在待分派决定／待分派池、未派机构且无活动核查时进行。
// 正文为 JSON：{ srid, geojson }。

import { Body, Controller, Param, Post, Req, Res } from '@nestjs/common';

import type { ActorRef } from '@natural-enforcement/identity';

import { ClueGeometryService } from './clue-geometry.service.ts';
import type { AuthenticatedRequest } from './session.guard.ts';

interface HttpReply {
  status(code: number): HttpReply;
  json(body: unknown): void;
}

interface ClueGeometryPayload {
  readonly srid?: unknown;
  readonly geojson?: unknown;
}

@Controller('api')
export class ClueGeometryController {
  constructor(private readonly geometry: ClueGeometryService) {}

  @Post('clues/:id/geometry')
  async redraw(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') clueId: string,
    @Body() payload: ClueGeometryPayload,
  ): Promise<void> {
    const srid = typeof payload?.srid === 'number' ? payload.srid : Number.NaN;
    const geojson = typeof payload?.geojson === 'string' ? payload.geojson : '';
    const outcome = await this.geometry.redraw(req.actor as ActorRef, clueId, { srid, geojson });
    res.status(outcome.status).json(outcome.body);
  }
}
