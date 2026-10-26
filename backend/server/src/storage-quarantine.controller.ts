// 涉密误传标记与材料读路径（#224）。
//
// POST /api/storage/materials/:materialId/quarantine   标记涉密误传（根机构系统管理）
// GET  /api/storage/materials/:materialId/content      业务读／下载（已隔离 403）

import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';

import type { ActorRef } from '@natural-enforcement/identity';

import { SameOriginReadGuard } from './same-origin-read.guard.ts';
import type { AuthenticatedRequest } from './session.guard.ts';
import { StorageQuarantineService } from './storage-quarantine.service.ts';

interface HttpReply {
  status(code: number): HttpReply;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
  send(body: Buffer): void;
}

interface QuarantineBody {
  readonly summary?: unknown;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

@Controller('api/storage/materials')
export class StorageQuarantineController {
  constructor(private readonly quarantine: StorageQuarantineService) {}

  /** 标记涉密误传：对象标 quarantined＋留痕。 */
  @Post(':materialId/quarantine')
  async mark(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('materialId') materialId: string,
    @Body() body: QuarantineBody,
  ): Promise<void> {
    const outcome = await this.quarantine.markMaterial(
      req.actor as ActorRef,
      materialId,
      text(body?.summary),
    );
    res.status(outcome.status).json(outcome.body);
  }

  /** 业务读材料内容：已隔离返回 403 object-quarantined。 */
  @Get(':materialId/content')
  @UseGuards(SameOriginReadGuard)
  async content(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('materialId') materialId: string,
  ): Promise<void> {
    const outcome = await this.quarantine.readMaterialContent(req.actor as ActorRef, materialId);
    if (outcome.status !== 200) {
      res.status(outcome.status).json(outcome.body);
      return;
    }
    res.setHeader('Content-Type', outcome.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(outcome.fileName)}`,
    );
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.status(200).send(Buffer.from(outcome.body));
  }
}
