// 通用 HTTP 错误载荷契约（手写契约与生成契约共用；#66 / #67）。
// 与 NestJS HttpException 默认载荷同构。
import { z } from 'zod'

export const HttpErrorSchema = z.object({
  message: z.string(),
  error: z.string().optional(),
  statusCode: z.number().int().optional(),
})
export type HttpError = z.infer<typeof HttpErrorSchema>

// 400 请求契约校验错误载荷（兼容 ZodValidationPipe 与框架层非法 JSON 400）
export const ValidationIssueSchema = z.object({
  path: z.string(),
  code: z.string(),
  message: z.string(),
})
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>

export const ValidationErrorSchema = HttpErrorSchema.extend({
  issues: z.array(ValidationIssueSchema).optional(),
})
export type ValidationError = z.infer<typeof ValidationErrorSchema>

// 409 冲突错误载荷（如执法点位唯一名称冲突）
export const ConflictErrorSchema = HttpErrorSchema
export type ConflictError = z.infer<typeof ConflictErrorSchema>
