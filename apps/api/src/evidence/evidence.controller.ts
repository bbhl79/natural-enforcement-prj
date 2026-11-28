import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  StreamableFile,
} from '@nestjs/common'
import { ApiBadRequestResponse, ApiResponse, ApiTags } from '@nestjs/swagger'
import {
  contentDispositionHeader,
  EVIDENCE_ROUTES,
  EvidenceContentResponseHeadersSchema,
  EvidenceFileMediaContract,
  EvidenceRecordDtoSchema,
  EvidenceUploadHeadersSchema,
  HttpErrorSchema,
  ORIGINAL_NAME_HEADER,
  POINT_ID_HEADER,
  ValidationErrorSchema,
} from '@ne/contracts'
import type { EvidenceRecordDto } from '@ne/contracts'
import {
  ApiContractHeaders,
  ApiContractMediaBody,
  ApiContractMediaResponse,
  ApiContractResponse,
} from '../common/api-contract.decorator.js'
import { EvidenceService } from './evidence.service.js'

@ApiTags('evidence')
@Controller(EVIDENCE_ROUTES.base)
export class EvidenceController {
  constructor(private readonly svc: EvidenceService) {}

  /**
   * 同源原始字节上传（Content-Type: application/octet-stream）。
   * 文件名只经 x-original-name（encodeURIComponent）传入；响应不含任何内部存储地址。
   */
  @Post()
  @ApiContractHeaders(EvidenceUploadHeadersSchema)
  @ApiContractMediaBody({
    description: '证据原始字节（文件名见 x-original-name 头）',
    ...EvidenceFileMediaContract,
  })
  @ApiContractResponse({
    status: 201,
    description: '证据已接收并入队（status=pending）',
    schema: EvidenceRecordDtoSchema,
  })
  @ApiBadRequestResponse({
    description: '上传头/文件名/关联点位不合契约',
    standardSchema: ValidationErrorSchema,
  })
  @ApiResponse({ status: 413, description: '证据内容超过上限', standardSchema: HttpErrorSchema })
  @ApiResponse({ status: 415, description: '非 application/octet-stream 上传', standardSchema: HttpErrorSchema })
  @ApiResponse({ status: 503, description: '对象存储或队列暂不可用', standardSchema: HttpErrorSchema })
  async upload(
    @Headers(ORIGINAL_NAME_HEADER) originalName: string | undefined,
    @Headers(POINT_ID_HEADER) pointId: string | undefined,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: Buffer,
  ): Promise<EvidenceRecordDto> {
    return this.svc.upload({ originalName, pointId, contentType, body })
  }

  @Get(':id')
  @ApiContractResponse({
    status: 200,
    description: '证据记录（后台处理状态与校验和）',
    schema: EvidenceRecordDtoSchema,
  })
  @ApiResponse({ status: 404, description: '证据记录不存在', standardSchema: HttpErrorSchema })
  async get(@Param('id') id: string): Promise<EvidenceRecordDto> {
    return this.svc.getRecord(id)
  }

  /** 同源下载：字节与上传内容一致；浏览器从此路径取文件，拿不到 presigned/内部地址 */
  @Get(':id/content')
  @ApiContractMediaResponse({
    status: 200,
    description: '证据原始字节（application/octet-stream）',
    ...EvidenceFileMediaContract,
    responseHeaders: EvidenceContentResponseHeadersSchema,
  })
  @ApiResponse({ status: 404, description: '证据记录不存在', standardSchema: HttpErrorSchema })
  @ApiResponse({ status: 503, description: '对象存储暂不可用', standardSchema: HttpErrorSchema })
  async content(@Param('id') id: string): Promise<StreamableFile> {
    const { bytes, contentType, originalName } = await this.svc.getContent(id)
    // Content-Disposition 由契约 helper 生成（RFC 5987；名称入口已拒绝 CR/LF）
    return new StreamableFile(Buffer.from(bytes), {
      type: contentType,
      disposition: contentDispositionHeader(originalName),
      length: bytes.byteLength,
    })
  }
}
