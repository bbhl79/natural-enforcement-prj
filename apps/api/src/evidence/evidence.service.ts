import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { EvidenceRecordDto } from '@ne/contracts'
import { PrismaService } from '../prisma/prisma.service.js'
import { EvidenceQueueService } from '../queue/evidence-queue.service.js'
import { StorageService } from '../storage/storage.service.js'
import { buildObjectKey } from '../storage/keys.js'

// 上传头契约（内部装配后校验；正式传输契约在 @ne/contracts/evidence）
export const UploadEvidenceInputSchema = z.object({
  originalName: z.string().min(1).max(200),
  pointId: z.number().int().positive().nullable(),
})
export type UploadEvidenceInput = z.infer<typeof UploadEvidenceInputSchema>

@Injectable()
export class EvidenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly queue: EvidenceQueueService,
  ) {}

  async upload(input: { originalName?: string; pointId?: string }, body: unknown): Promise<EvidenceRecordDto> {
    const parsed = UploadEvidenceInputSchema.safeParse({
      originalName: input.originalName,
      pointId: input.pointId ? Number(input.pointId) : null,
    })
    if (!parsed.success) {
      throw new BadRequestException({
        message: '上传头不合法（需 x-original-name，可选 x-point-id）',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      })
    }
    const bytes = body instanceof Uint8Array ? body : Buffer.from(body as string, 'utf8')
    if (bytes.byteLength === 0) throw new BadRequestException('证据内容为空')

    const key = buildObjectKey({ uuid: randomUUID(), originalName: parsed.data.originalName })
    await this.storage.put(key, bytes, 'application/octet-stream')
    const record = await this.prisma.evidenceRecord.create({
      data: {
        pointId: parsed.data.pointId,
        bucket: this.storage.bucket,
        objectKey: key,
        originalName: parsed.data.originalName,
        contentType: 'application/octet-stream',
        status: 'pending',
      },
    })
    await this.queue.enqueueProcessEvidence(record.id)
    return this.toDto(record)
  }

  private async fetchRaw(id: string) {
    const record = await this.prisma.evidenceRecord.findUnique({ where: { id } })
    if (!record) throw new NotFoundException(`证据记录不存在：${id}`)
    return record
  }

  async getRecord(id: string): Promise<EvidenceRecordDto> {
    return this.toDto(await this.fetchRaw(id))
  }

  async getContent(id: string): Promise<{ bytes: Uint8Array; contentType: string }> {
    const record = await this.fetchRaw(id)
    return {
      bytes: await this.storage.get(record.objectKey),
      contentType: record.contentType,
    }
  }

  async getPresignedUrl(id: string, ttlSeconds = 300): Promise<{ url: string }> {
    const record = await this.fetchRaw(id)
    return { url: await this.storage.presignGet(record.objectKey, ttlSeconds) }
  }

  private toDto(r: {
    id: string
    pointId: number | null
    originalName: string
    contentType: string
    bytes: number | null
    sha256: string | null
    status: string
    error: string | null
    createdAt: Date
  }): EvidenceRecordDto {
    return {
      id: r.id,
      pointId: r.pointId,
      originalName: r.originalName,
      contentType: r.contentType,
      bytes: r.bytes,
      sha256: r.sha256,
      status: r.status as EvidenceRecordDto['status'],
      error: r.error,
      createdAt: r.createdAt.toISOString(),
    }
  }
}
