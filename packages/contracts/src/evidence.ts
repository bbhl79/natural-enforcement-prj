// 取证证据：传输契约（上传头 / 记录 DTO）
import { z } from 'zod'

export const EVIDENCE_ROUTES = {
  base: '/evidence',
} as const

export const EvidenceStatusSchema = z.enum(['pending', 'ready', 'failed'])
export type EvidenceStatus = z.infer<typeof EvidenceStatusSchema>

export const EvidenceRecordDtoSchema = z.object({
  id: z.string(),
  pointId: z.number().int().nullable(),
  originalName: z.string(),
  contentType: z.string(),
  bytes: z.number().int().nullable(),
  sha256: z.string().nullable(),
  status: EvidenceStatusSchema,
  error: z.string().nullable(),
  createdAt: z.string(),
})
export type EvidenceRecordDto = z.infer<typeof EvidenceRecordDtoSchema>
