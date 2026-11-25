// 请求校验管道（Spec-工程基座 §1）：NestJS 12 的 Standard Schema 原生支持是
// 响应序列化拦截器，非请求管道（原型 #11 实证）——请求校验用自写 zod 管道。
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
