// PROTOTYPE（#11）— #9 决议兜底实现：NestJS 12 原生 Standard Schema 支持实测后决定去留。
// zod 4 自身实现 Standard Schema（~standard），此管道只做 safeParse → BadRequestException。
import { BadRequestException, type PipeTransform } from '@nestjs/common'
import type { ZodType } from 'zod'

export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodType) {}

  transform(value: unknown): unknown {
    const parsed = this.schema.safeParse(value)
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
