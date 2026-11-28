import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
} from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import {
  decodeOriginalName,
  EVIDENCE_CONTENT_TYPE,
  evidenceContentPath,
  MAX_EVIDENCE_BYTES,
  ORIGINAL_NAME_HEADER,
  POINT_ID_HEADER,
  PointIdHeaderSchema,
  type EvidenceRecordDto,
} from '@ne/contracts'
import { EvidenceRepo, type EvidenceRecordRow } from './evidence.repo.js'
import { EvidenceQueueService } from '../queue/evidence-queue.service.js'
import { EVIDENCE_PROCESSING_FAILED_MESSAGE } from '../queue/evidence-queue.constants.js'
import { StorageService } from '../storage/storage.service.js'
import { buildEvidenceObjectKey } from '../storage/keys.js'

interface UploadInput {
  readonly originalName: string | undefined
  readonly pointId: string | undefined
  readonly contentType: string | undefined
  readonly body: unknown
}

interface ValidationIssue {
  readonly path: string
  readonly code: string
  readonly message: string
}

@Injectable()
export class EvidenceService {
  private readonly logger = new Logger(EvidenceService.name)

  constructor(
    private readonly repo: EvidenceRepo,
    private readonly storage: StorageService,
    private readonly queue: EvidenceQueueService,
  ) {}

  /**
   * 同源上传：原始字节 → 对象存储 → 记录 pending → 入队。
   * 文件名只落展示字段；对象键只由服务端生成的 id 构成。
   */
  async upload(input: UploadInput): Promise<EvidenceRecordDto> {
    if (!isOctetStream(input.contentType)) {
      throw new UnsupportedMediaTypeException(`证据上传必须使用 ${EVIDENCE_CONTENT_TYPE}`)
    }

    const name = decodeOriginalName(input.originalName)
    if (!name.ok) {
      throw validationError(name.message, [
        { path: ORIGINAL_NAME_HEADER, code: name.reason, message: name.message },
      ])
    }

    let pointId: number | null = null
    if (input.pointId !== undefined) {
      const parsed = PointIdHeaderSchema.safeParse(input.pointId)
      if (!parsed.success) {
        throw validationError('关联点位 id 不合法', [
          { path: POINT_ID_HEADER, code: 'invalid_point_id', message: '点位 id 必须是正整数' },
        ])
      }
      pointId = Number(parsed.data)
      if (!Number.isSafeInteger(pointId) || pointId <= 0 || pointId > 2_147_483_647) {
        throw validationError('关联点位 id 不合法', [
          { path: POINT_ID_HEADER, code: 'invalid_point_id', message: '点位 id 超出范围' },
        ])
      }
      if (!(await this.repo.pointExists(pointId))) {
        throw validationError('关联点位不存在', [
          { path: POINT_ID_HEADER, code: 'point_not_found', message: `点位 ${pointId} 不存在` },
        ])
      }
    }

    const bytes = toBytes(input.body)
    if (bytes.byteLength === 0) {
      throw validationError('证据内容为空', [
        { path: 'body', code: 'empty_body', message: '证据内容不能为空' },
      ])
    }
    if (bytes.byteLength > MAX_EVIDENCE_BYTES) {
      throw new PayloadTooLargeException({
        message: `证据内容超过上传上限（${MAX_EVIDENCE_BYTES} 字节）`,
        statusCode: 413,
      })
    }

    const id = randomUUID()
    const objectKey = buildEvidenceObjectKey(id)
    try {
      await this.storage.put(objectKey, bytes, EVIDENCE_CONTENT_TYPE)
    } catch (err) {
      this.logger.error(`证据对象写入失败（record=${id}）：${err instanceof Error ? err.message : String(err)}`)
      throw new ServiceUnavailableException('证据存储暂不可用')
    }

    let row: EvidenceRecordRow
    try {
      row = await this.repo.create({
        id,
        pointId,
        bucket: this.storage.bucket,
        objectKey,
        originalName: name.name,
        contentType: EVIDENCE_CONTENT_TYPE,
      })
    } catch (err) {
      await this.storage.delete(objectKey).catch(() => undefined)
      throw err
    }

    try {
      await this.queue.enqueueProcessEvidence(row.id)
    } catch (err) {
      this.logger.error(`证据入队失败（record=${row.id}）：${err instanceof Error ? err.message : String(err)}`)
      await this.repo.markFailed(row.id, EVIDENCE_PROCESSING_FAILED_MESSAGE).catch(() => undefined)
      // 入队失败即无消费者：删除已写对象，避免孤儿（记录保留 failed 供观察）
      await this.storage.delete(objectKey).catch(() => undefined)
      throw new ServiceUnavailableException('证据处理队列暂不可用')
    }

    return toDto(row)
  }

  async getRecord(id: string): Promise<EvidenceRecordDto> {
    return toDto(await this.fetchRaw(id))
  }

  async getContent(id: string): Promise<{
    readonly bytes: Uint8Array
    readonly contentType: string
    readonly originalName: string
  }> {
    const row = await this.fetchRaw(id)
    try {
      return {
        bytes: await this.storage.get(row.objectKey),
        contentType: EVIDENCE_CONTENT_TYPE,
        originalName: row.originalName,
      }
    } catch (err) {
      this.logger.error(`证据对象读取失败（record=${id}）：${err instanceof Error ? err.message : String(err)}`)
      throw new ServiceUnavailableException('证据存储暂不可用')
    }
  }

  private async fetchRaw(id: string): Promise<EvidenceRecordRow> {
    const row = await this.repo.findById(id)
    if (!row) throw new NotFoundException(`证据记录不存在：${id}`)
    return row
  }
}

function isOctetStream(contentType: string | undefined): boolean {
  if (!contentType) return false
  return contentType.split(';')[0]?.trim().toLowerCase() === EVIDENCE_CONTENT_TYPE
}

function toBytes(body: unknown): Uint8Array {
  if (Buffer.isBuffer(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
  if (body instanceof Uint8Array) return body
  return new Uint8Array(0)
}

function validationError(message: string, issues: readonly ValidationIssue[]): BadRequestException {
  return new BadRequestException({ message, issues })
}

function toDto(row: EvidenceRecordRow): EvidenceRecordDto {
  return {
    id: row.id,
    pointId: row.pointId,
    originalName: row.originalName,
    contentType: row.contentType,
    bytes: row.bytes,
    sha256: row.sha256,
    status: row.status,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    contentPath: evidenceContentPath(row.id),
  }
}
