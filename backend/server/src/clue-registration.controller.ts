// 线索登记接口（#211；规格 E「上传方式」）。
//
// 一次登记 = 一个 multipart/form-data 请求：表单字段与全部文件一次提交。
// 表单字段：sourceCode、domain、types（初步涉嫌违法类型，逗号分隔）、tags（逗号分隔）、
// subjectUnknown、confirm、anonymityConfirmed、srid、values（要件取值 JSON）。
// 文件项：attachment（普通附件，多件）与 spatial-source（几何来源文件，一件）。
// 头：Idempotency-Key（必填）。
//
// 校验不通过返回 400 non-compliant（rules 列校验码），单件或合计超限返回 413，
// 同一 Idempotency-Key 异报文返回 409 already-exists。

import { Body, Controller, Headers, Post, Req, Res, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';

import { MAX_ATTACHMENT_BYTES, type ClueFormValues } from '@natural-enforcement/case';
import type { ActorRef } from '@natural-enforcement/identity';

import { ClueRegistrationService, type ClueUploadedFile } from './clue-registration.service.ts';
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

@Controller('api')
export class ClueRegistrationController {
  constructor(private readonly registration: ClueRegistrationService) {}

  @Post('clues')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'attachment', maxCount: 20 },
        { name: 'spatial-source', maxCount: 1 },
      ],
      { limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 21 } },
    ),
  )
  async register(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Body() body: Record<string, unknown>,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @UploadedFiles() files: Record<string, UploadedFile[]> | undefined,
  ): Promise<void> {
    const actor = req.actor as ActorRef;
    const outcome = await this.registration.register(actor, {
      idempotencyKey: idempotencyKey ?? '',
      sourceCode: readString(body['sourceCode']),
      domain: readString(body['domain']),
      types: readList(body['types']),
      tags: readList(body['tags']),
      subjectUnknown: readBoolean(body['subjectUnknown']),
      confirm: readBoolean(body['confirm']),
      anonymityConfirmed: readBoolean(body['anonymityConfirmed']),
      srid: readSrid(body['srid']),
      values: readValues(body['values']),
      attachments: (files?.['attachment'] ?? []).map(toUploadedFile),
      spatialSource:
        files?.['spatial-source']?.[0] === undefined ? null : toUploadedFile(files['spatial-source'][0]),
      sessionId: req.resolution?.active?.row.id ?? '',
    });
    res.status(outcome.status).json(outcome.body);
  }
}

function readString(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

/** 多值字段：接受逗号分隔串或重复字段。 */
function readList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .filter((value): value is string => typeof value === 'string')
      .flatMap((value) => value.split(','))
      .map((value) => value.trim())
      .filter((value) => value !== '');
  }
  return readString(raw)
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '');
}

function readBoolean(raw: unknown): boolean {
  const value = readString(raw).toLowerCase();
  return value === 'true' || value === '1' || value === '是';
}

/** 输入坐标系：只收整数，缺省 4326（EPSG:4326）。 */
function readSrid(raw: unknown): number {
  const value = readString(raw);
  if (value === '') return 4326;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** 要件取值：JSON 文本，取值一律按字符串读。 */
function readValues(raw: unknown): ClueFormValues {
  if (raw === undefined || raw === null) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const entries = Object.entries(raw as Record<string, unknown>)
      .filter(([, value]) => typeof value === 'string')
      .map(([key, value]) => [key, value as string] as const);
    return Object.fromEntries(entries);
  }
  const text = readString(raw);
  if (text === '') return {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const entries = Object.entries(parsed as Record<string, unknown>)
      .filter(([, value]) => typeof value === 'string')
      .map(([key, value]) => [key, value as string] as const);
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

function toUploadedFile(file: UploadedFile): ClueUploadedFile {
  return {
    fileName: file.originalname,
    contentType: file.mimetype,
    byteSize: file.size,
    content: new Uint8Array(file.buffer),
  };
}
