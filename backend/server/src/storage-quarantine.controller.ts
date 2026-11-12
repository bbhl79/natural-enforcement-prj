// 用途：提供涉密误传标记与材料内容读取两个 HTTP 接口，委托 StorageQuarantineService。
// 调用方：backend/server/src/app.module.ts 注册为控制器。
// 依据：backend/server/src/storage-quarantine.service.ts（#224）。
//
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

// 涉密误传标记与材料读路径的 HTTP 入口，请求处理全部委托 StorageQuarantineService。
@Controller('api/storage/materials')
export class StorageQuarantineController {
  constructor(private readonly quarantine: StorageQuarantineService) {}

  /** 标记涉密误传：对象标 quarantined＋留痕。 */
  // 标记涉密误传；操作码 storage.quarantine.mark；对象级限操作者所属机构为目标所属根机构的系统管理。
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
  // 业务读材料内容，已隔离返回 403；操作码 clue.read；对象级按材料所属机构授权。
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
