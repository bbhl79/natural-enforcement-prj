// 契约响应组合装饰器：把运行时响应校验（NestJS 12 StandardSchemaSerializerInterceptor）
// 与 OpenAPI 响应 schema（@nestjs/swagger 12 standardSchema）绑定到同一份 zod schema，
// 避免运行时与文档漂移（#66）。
import { applyDecorators, SerializeOptions } from '@nestjs/common'
import { ApiResponse } from '@nestjs/swagger'
import type { ZodType } from 'zod'

export function ApiContractResponse(options: {
  status: number
  description: string
  schema: ZodType
}): MethodDecorator {
  return applyDecorators(
    SerializeOptions({ schema: options.schema }),
    ApiResponse({
      status: options.status,
      description: options.description,
      standardSchema: options.schema,
    }),
  )
}
