// 请求校验管道（Spec-工程基座 §1 / #66）：
// NestJS 12 原生支持 @Body({ schema, pipes }) / @Query({ schema, pipes })，把 zod
// Standard Schema 同时透传给 ArgumentMetadata.schema 与 @nestjs/swagger 12 OpenAPI 派生；
// 本管道优先使用构造参数 schema，缺省时读取 metadata.schema，保证运行时校验与 OpenAPI 同源。
import { BadRequestException, type ArgumentMetadata, type PipeTransform } from '@nestjs/common'
import type { ZodType } from 'zod'

function isZodSchema(value: unknown): value is ZodType {
  return typeof value === 'object' && value !== null && 'safeParse' in value
}

export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema?: ZodType) {}

  transform(value: unknown, metadata?: ArgumentMetadata): unknown {
    const active = this.schema ?? (isZodSchema(metadata?.schema) ? metadata.schema : undefined)
    if (!active) {
      return value
    }
    const parsed = active.safeParse(value)
    if (!parsed.success) {
      throw new BadRequestException({
        message: '契约校验失败',
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          code: i.code,
          message: i.message,
        })),
      })
    }
    return parsed.data
  }
}
