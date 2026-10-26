// 保密报告工单接口（#225）。
//
// POST /api/storage/materials/:materialId/secrecy-report   对已隔离对象生成工单（待报）
// GET  /api/storage/materials/:materialId/secrecy-report   对象 → 工单
// GET  /api/storage/secrecy-reports/reminders              本人名下待报工单的时限提醒（默认 24h）
// GET  /api/storage/secrecy-reports/:id                    工单 → 对象
// POST /api/storage/secrecy-reports/:id/reported           登记已报（报告说明必填）
// POST /api/storage/secrecy-reports/:id/receipt            录入指令摘要＋回执附件 → 已回执（multipart）
//
// 只提醒不代发；不提供删除／销毁接口。

import { Body, Controller, Get, Param, Post, Req, Res, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';

import { MAX_ATTACHMENT_BYTES } from '@natural-enforcement/case';
import type { ActorRef } from '@natural-enforcement/identity';

import { decodeMultipartFileName } from './multipart-file-name.ts';
import { SameOriginReadGuard } from './same-origin-read.guard.ts';
import { SecrecyReportService } from './secrecy-report.service.ts';
import type { AuthenticatedRequest } from './session.guard.ts';

interface HttpReply {
  status(code: number): HttpReply;
  json(body: unknown): void;
}

interface UploadedFile {
  readonly originalname: string;
  readonly mimetype: string;
  readonly size: number;
  readonly buffer: Buffer;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

@Controller('api/storage')
export class SecrecyReportController {
  constructor(private readonly reports: SecrecyReportService) {}

  @Post('materials/:materialId/secrecy-report')
  async create(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('materialId') materialId: string,
  ): Promise<void> {
    const outcome = await this.reports.createForMaterial(req.actor as ActorRef, materialId);
    res.status(outcome.status).json(outcome.body);
  }

  @Get('materials/:materialId/secrecy-report')
  @UseGuards(SameOriginReadGuard)
  async readByMaterial(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('materialId') materialId: string,
  ): Promise<void> {
    const outcome = await this.reports.readByMaterial(req.actor as ActorRef, materialId);
    res.status(outcome.status).json(outcome.body);
  }

  @Get('secrecy-reports/reminders')
  @UseGuards(SameOriginReadGuard)
  async reminders(@Req() req: AuthenticatedRequest, @Res() res: HttpReply): Promise<void> {
    const outcome = await this.reports.listReminders(req.actor as ActorRef);
    res.status(outcome.status).json(outcome.body);
  }

  @Get('secrecy-reports/:id')
  @UseGuards(SameOriginReadGuard)
  async read(@Req() req: AuthenticatedRequest, @Res() res: HttpReply, @Param('id') id: string): Promise<void> {
    const outcome = await this.reports.read(req.actor as ActorRef, id);
    res.status(outcome.status).json(outcome.body);
  }

  @Post('secrecy-reports/:id/reported')
  async reported(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: { readonly reportNote?: unknown },
  ): Promise<void> {
    const outcome = await this.reports.markReported(req.actor as ActorRef, id, text(body?.reportNote));
    res.status(outcome.status).json(outcome.body);
  }

  @Post('secrecy-reports/:id/receipt')
  @UseInterceptors(
    FileFieldsInterceptor([{ name: 'attachment', maxCount: 1 }], {
      limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 },
    }),
  )
  async receipt(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @UploadedFiles() files: Record<string, UploadedFile[]> | undefined,
  ): Promise<void> {
    const file = files?.['attachment']?.[0];
    const outcome = await this.reports.recordReceipt(req.actor as ActorRef, id, {
      instructionSummary: text(body?.['instructionSummary']),
      attachment: file
        ? {
            fileName: decodeMultipartFileName(file.originalname),
            contentType: file.mimetype,
            byteSize: file.size,
            content: new Uint8Array(file.buffer),
          }
        : null,
    });
    res.status(outcome.status).json(outcome.body);
  }
}
