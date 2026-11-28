// 队列任务载荷契约（进程内传输；不进入 HTTP 契约）。
import { z } from 'zod'

export const ProcessEvidenceJobSchema = z.object({ recordId: z.string().min(1).max(64) }).strict()
export type ProcessEvidenceJob = z.infer<typeof ProcessEvidenceJobSchema>

export function parseProcessEvidenceJob(data: unknown): ProcessEvidenceJob {
  return ProcessEvidenceJobSchema.parse(data)
}