// 队列任务负载 schema（内部契约，非传输契约，故不入 @ne/contracts）
import { z } from 'zod'

export const ProcessEvidenceJobSchema = z
  .object({
    recordId: z.string().min(1),
  })
  .strict()
export type ProcessEvidenceJob = z.infer<typeof ProcessEvidenceJobSchema>

export function parseJob(data: unknown): ProcessEvidenceJob {
  const parsed = ProcessEvidenceJobSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error(`非法任务负载：${JSON.stringify(parsed.error.issues)}`)
  }
  return parsed.data
}
