import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service.js'

export interface CreateEvidenceRecordInput {
  readonly id: string
  readonly pointId: number | null
  readonly bucket: string
  readonly objectKey: string
  readonly originalName: string
  readonly contentType: string
}

export type EvidenceRecordRow = {
  id: string
  pointId: number | null
  bucket: string
  objectKey: string
  originalName: string
  contentType: string
  bytes: number | null
  sha256: string | null
  status: string
  error: string | null
  createdAt: Date
}

@Injectable()
export class EvidenceRepo {
  constructor(private readonly db: PrismaService) {}

  async pointExists(id: number): Promise<boolean> {
    const point = await this.db.enforcementPoint.findUnique({
      where: { id },
      select: { id: true },
    })
    return point !== null
  }

  async create(input: CreateEvidenceRecordInput): Promise<EvidenceRecordRow> {
    return this.db.evidenceRecord.create({
      data: {
        id: input.id,
        pointId: input.pointId,
        bucket: input.bucket,
        objectKey: input.objectKey,
        originalName: input.originalName,
        contentType: input.contentType,
        status: 'pending',
      },
    })
  }

  async findById(id: string): Promise<EvidenceRecordRow | null> {
    return this.db.evidenceRecord.findUnique({ where: { id } })
  }

  async markFailed(id: string, message: string): Promise<void> {
    await this.db.evidenceRecord.update({
      where: { id },
      data: { status: 'failed', error: message },
    })
  }

  /** 测试自清理：按记录 id 批量删除 */
  async deleteManyByIds(ids: readonly string[]): Promise<number> {
    if (ids.length === 0) return 0
    const result = await this.db.evidenceRecord.deleteMany({ where: { id: { in: [...ids] } } })
    return result.count
  }
}