// 案件阶段三类移送的 HTTP 入口（#242）。
// 拟制、回证上传用 doc.draft；提交用 doc.submit；审核用 doc.admin.review；批准用 doc.approve。
// 移送呈批单独发起，不并入立案呈批；批准后写记载，不直送对方待分派池。
// 外部决定记载（T30）只追加；人工出口 A／B 经 doc.* 呈批，互斥。

import { Body, Controller, Get, Param, Post, Req, Res, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';

import { MAX_ATTACHMENT_BYTES } from '@natural-enforcement/case';
import type { ActorRef } from '@natural-enforcement/identity';

import { readConfirmation } from './case-rule-confirmation.ts';
import { CaseTransferService, type TransferUploadedFile } from './case-transfer.service.ts';
import { decodeMultipartFileName } from './multipart-file-name.ts';
import { SameOriginReadGuard } from './same-origin-read.guard.ts';
import type { AuthenticatedRequest } from './session.guard.ts';

interface HttpReply {
  status(code: number): HttpReply;
  json(body: unknown): void;
}

interface UploadedFile {
  readonly fieldname: string;
  readonly originalname: string;
  readonly mimetype: string;
  readonly size: number;
  readonly buffer: Buffer;
}

interface TransferBody {
  readonly kind?: unknown;
  readonly receivingOrg?: unknown;
  readonly documentNo?: unknown;
  readonly letterDate?: unknown;
  readonly reason?: unknown;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

function uploaded(files: Record<string, UploadedFile[]> | undefined, field: string): TransferUploadedFile[] {
  return (files?.[field] ?? []).map(toUploadedFile);
}

@Controller()
export class CaseTransferController {
  constructor(private readonly transfers: CaseTransferService) {}

  @Get('api/cases/:id/transfers')
  @UseGuards(SameOriginReadGuard)
  async read(@Req() req: AuthenticatedRequest, @Res() res: HttpReply, @Param('id') id: string): Promise<void> {
    const outcome = await this.transfers.read(req.actor as ActorRef, id);
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/cases/:id/transfers')
  @UseInterceptors(
    FileFieldsInterceptor([{ name: 'attachment', maxCount: 20 }], {
      limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 20 },
    }),
  )
  async draft(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: TransferBody,
    @UploadedFiles() files: Record<string, UploadedFile[]> | undefined,
  ): Promise<void> {
    const outcome = await this.transfers.draft(req.actor as ActorRef, id, {
      content: {
        kind: text(body?.kind),
        receivingOrg: text(body?.receivingOrg),
        documentNo: text(body?.documentNo),
        letterDate: text(body?.letterDate),
        reason: text(body?.reason),
      },
      attachments: uploaded(files, 'attachment'),
    });
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/transfers/:approvalId/submit')
  async submit(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('approvalId') approvalId: string,
    @Body() body: { readonly confirmedRuleKeys?: unknown; readonly confirmReasons?: unknown },
  ): Promise<void> {
    const outcome = await this.transfers.submit(req.actor as ActorRef, approvalId, readConfirmation(body));
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/transfers/:approvalId/review')
  async review(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('approvalId') approvalId: string,
    @Body() body: { readonly opinion?: unknown },
  ): Promise<void> {
    const outcome = await this.transfers.review(req.actor as ActorRef, approvalId, {
      opinion: typeof body?.opinion === 'string' ? body.opinion : null,
    });
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/transfers/:approvalId/approve')
  async approve(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('approvalId') approvalId: string,
    @Body() body: { readonly opinion?: unknown; readonly confirmedRuleKeys?: unknown; readonly confirmReasons?: unknown },
  ): Promise<void> {
    const outcome = await this.transfers.approve(req.actor as ActorRef, approvalId, {
      opinion: typeof body?.opinion === 'string' ? body.opinion : null,
      ...readConfirmation(body),
    });
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/cases/:id/transfers/:transferId/receipts')
  @UseInterceptors(
    FileFieldsInterceptor([{ name: 'receipt', maxCount: 20 }], {
      limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 20 },
    }),
  )
  async uploadReceipt(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Param('transferId') transferId: string,
    @UploadedFiles() files: Record<string, UploadedFile[]> | undefined,
  ): Promise<void> {
    const outcome = await this.transfers.uploadReceipt(req.actor as ActorRef, id, transferId, uploaded(files, 'receipt'));
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/cases/:id/criminal-decisions')
  async recordCriminalDecision(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<void> {
    const outcome = await this.transfers.recordCriminalDecision(req.actor as ActorRef, id, body ?? {});
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/cases/:id/criminal-decisions/:decisionId/outlets')
  async draftOutlet(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Param('decisionId') decisionId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<void> {
    const outcome = await this.transfers.draftOutlet(req.actor as ActorRef, id, decisionId, body ?? {});
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/criminal-outlets/:outletId/submit')
  async submitOutlet(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('outletId') outletId: string,
  ): Promise<void> {
    const outcome = await this.transfers.submitOutlet(req.actor as ActorRef, outletId);
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/criminal-outlets/:outletId/approve')
  async approveOutlet(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('outletId') outletId: string,
    @Body() body: { readonly opinion?: unknown; readonly confirmedRuleKeys?: unknown; readonly confirmReasons?: unknown },
  ): Promise<void> {
    const outcome = await this.transfers.approveOutlet(req.actor as ActorRef, outletId, {
      opinion: typeof body?.opinion === 'string' ? body.opinion : null,
      ...readConfirmation(body),
    });
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/cases/:id/closeout-gate')
  async closeoutGate(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
  ): Promise<void> {
    const outcome = await this.transfers.closeoutGate(req.actor as ActorRef, id);
    res.status(outcome.status).json(outcome.body);
  }
}

function toUploadedFile(file: UploadedFile): TransferUploadedFile {
  return {
    fileName: decodeMultipartFileName(file.originalname),
    contentType: file.mimetype,
    byteSize: file.size,
    content: new Uint8Array(file.buffer.buffer, file.buffer.byteOffset, file.buffer.byteLength),
  };
}