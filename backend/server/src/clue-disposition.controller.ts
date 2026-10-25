// 移送与停用机构池重新指定接口（#216；规格 D 节、GLOSSARY）。
//
// POST /api/clues/:id/transfer        移送登记（multipart：表单字段 + 选填附件 0..n）
// POST /api/clues/:id/pool-reassign   停用机构池重新指定（系统管理员）
//
// 移送表单字段：transferOrg（移送机关）、documentNo（文书编号）、letterDate（发函日期，
// 空＝缺省北京当日）、reason（原因）、expectedStatus。文件项：attachment（选填 0..n）。
// 校验不通过返回 400 non-compliant（rules 列校验码）＋失败留痕，附件校验失败存储零写入。

import { Body, Controller, Param, Post, Req, Res, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';

import { MAX_ATTACHMENT_BYTES } from '@natural-enforcement/case';
import type { ActorRef } from '@natural-enforcement/identity';

import { ClueDispositionService, type TransferUploadedFile } from './clue-disposition.service.ts';
import type { AuthenticatedRequest } from './session.guard.ts';

interface HttpReply {
  status(code: number): HttpReply;
  json(body: unknown): void;
}

/** 上传文件在框架侧的形状。 */
interface UploadedFile {
  readonly fieldname: string;
  readonly originalname: string;
  readonly mimetype: string;
  readonly size: number;
  readonly buffer: Buffer;
}

interface TransferBody {
  readonly transferOrg?: unknown;
  readonly documentNo?: unknown;
  readonly letterDate?: unknown;
  readonly reason?: unknown;
  readonly expectedStatus?: unknown;
}

interface PoolReassignBody {
  readonly orgUnitId?: unknown;
  readonly reason?: unknown;
  readonly expectedStatus?: unknown;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

@Controller('api/clues')
export class ClueDispositionController {
  constructor(private readonly disposition: ClueDispositionService) {}

  /** 移送登记（自然资源部门以外的机关；登记后进 transferred_out 终态）。 */
  @Post(':id/transfer')
  @UseInterceptors(
    FileFieldsInterceptor([{ name: 'attachment', maxCount: 20 }], {
      limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 20 },
    }),
  )
  async transfer(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: TransferBody,
    @UploadedFiles() files: Record<string, UploadedFile[]> | undefined,
  ): Promise<void> {
    const outcome = await this.disposition.recordTransfer(req.actor as ActorRef, id, {
      transferOrg: text(body?.transferOrg),
      documentNo: text(body?.documentNo),
      letterDate: text(body?.letterDate),
      reason: text(body?.reason),
      attachments: (files?.['attachment'] ?? []).map(toUploadedFile),
      expectedStatus: text(body?.expectedStatus),
    });
    res.status(outcome.status).json(outcome.body);
  }

  /** 停用机构池重新指定（只授系统管理；不构成指定管辖、不加锁）。 */
  @Post(':id/pool-reassign')
  async poolReassign(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: PoolReassignBody,
  ): Promise<void> {
    const outcome = await this.disposition.reassignPool(req.actor as ActorRef, id, {
      orgUnitId: text(body?.orgUnitId),
      reason: text(body?.reason),
      expectedStatus: text(body?.expectedStatus),
    });
    res.status(outcome.status).json(outcome.body);
  }
}

function toUploadedFile(file: UploadedFile): TransferUploadedFile {
  return {
    fileName: file.originalname,
    contentType: file.mimetype,
    byteSize: file.size,
    content: new Uint8Array(file.buffer.buffer, file.buffer.byteOffset, file.buffer.byteLength),
  };
}
