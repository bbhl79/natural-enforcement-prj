import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Res,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'
import { EVIDENCE_ROUTES } from '@ne/contracts'
import { EvidenceService } from './evidence.service.js'

@ApiTags('evidence')
@Controller(EVIDENCE_ROUTES.base)
export class EvidenceController {
  constructor(private readonly svc: EvidenceService) {}

  /** 原始字节上传：Content-Type: application/octet-stream（express.raw 装配见 bootstrap） */
  @Post()
  @HttpCode(201)
  async upload(
    @Headers('x-original-name') originalName: string | undefined,
    @Headers('x-point-id') pointId: string | undefined,
    @Body() body: Buffer,
  ) {
    return this.svc.upload({ originalName, pointId }, body)
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return this.svc.getRecord(id)
  }

  @Get(':id/content')
  async content(@Param('id') id: string, @Res() res: Response) {
    const { bytes, contentType } = await this.svc.getContent(id)
    res.setHeader('content-type', contentType)
    res.setHeader('content-length', String(bytes.byteLength))
    res.end(Buffer.from(bytes))
  }

  @Get(':id/url')
  async url(@Param('id') id: string) {
    return this.svc.getPresignedUrl(id)
  }
}
