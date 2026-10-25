// 内业核查接口（#213；规格 C 节）。
//
// GET  /api/clues/:id/verification            当前与历史运行、报告摘要、能否手动重跑
// POST /api/clues/:id/verification/retry      手动重跑（每次新运行，只跑 1 次）
// GET  /api/clues/:id/verification/report     下载核查报告（JSON）
// GET  /api/clues/:id/verification/analysis   下载分析图（EPSG:4490 GeoJSON）
//
// 核查状态是线索的正交属性：本组接口既不拦分派，也不改线索主状态。
// 下载接口不回缓存、不许浏览器猜内容类型。

import { Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';

import type { ActorRef } from '@natural-enforcement/identity';

import { ClueVerificationService } from './clue-verification.service.ts';
import { SameOriginReadGuard } from './same-origin-read.guard.ts';
import type { AuthenticatedRequest } from './session.guard.ts';

interface HttpReply {
  status(code: number): HttpReply;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
  send(body: Buffer): void;
}

@Controller('api')
export class ClueVerificationController {
  constructor(private readonly verification: ClueVerificationService) {}

  @Get('clues/:id/verification')
  @UseGuards(SameOriginReadGuard)
  async read(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') clueId: string,
  ): Promise<void> {
    const outcome = await this.verification.read(req.actor as ActorRef, clueId);
    res.status(outcome.status).json(outcome.body);
  }

  @Post('clues/:id/verification/retry')
  async retry(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') clueId: string,
  ): Promise<void> {
    const outcome = await this.verification.retry(req.actor as ActorRef, clueId);
    res.status(outcome.status).json(outcome.body);
  }

  @Get('clues/:id/verification/report')
  @UseGuards(SameOriginReadGuard)
  async report(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') clueId: string,
  ): Promise<void> {
    await this.sendArtifact(req, res, clueId, 'report');
  }

  @Get('clues/:id/verification/analysis')
  @UseGuards(SameOriginReadGuard)
  async analysis(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') clueId: string,
  ): Promise<void> {
    await this.sendArtifact(req, res, clueId, 'analysis');
  }

  /** 产物下载：鉴权后按版本引用读内容，不回缓存、不许猜类型。 */
  private async sendArtifact(
    req: AuthenticatedRequest,
    res: HttpReply,
    clueId: string,
    kind: 'report' | 'analysis',
  ): Promise<void> {
    const outcome = await this.verification.readArtifact(req.actor as ActorRef, clueId, kind);
    if (outcome.status !== 200) {
      res.status(outcome.status).json(outcome.body);
      return;
    }
    res.setHeader('content-type', outcome.contentType);
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.status(200).send(Buffer.from(outcome.body));
  }
}
