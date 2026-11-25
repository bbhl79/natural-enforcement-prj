// 统一校验封装（Spec-工程基座 §1/§9）：web 响应经契约 zod schema 运行时校验的
// 唯一入口——RTK Query transformResponse 一律经此包装，不要求每端点手写校验逻辑；
// 传输层失配即刻暴露（fail fast）。
import type { ZodType } from 'zod'

export function validated<T>(schema: ZodType<T>): (raw: unknown) => T {
  return (raw: unknown): T => schema.parse(raw)
}
