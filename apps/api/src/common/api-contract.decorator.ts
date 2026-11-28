// 契约装饰器组合（#66 / #69）：把运行时校验/OpenAPI 文档绑定到同一份 zod schema，
// 避免运行时与文档漂移。JSON 端点继续用 @Body({ schema }) / @ApiContractResponse；
// 非 JSON 媒体类型（原始字节上传/下载、文件名 header）在此派生。
import { applyDecorators, SerializeOptions } from '@nestjs/common'
import {
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiResponse,
  type SchemaObject,
} from '@nestjs/swagger'
import { z, type ZodObject, type ZodType } from 'zod'

/** 由 zod schema 派生 OpenAPI 3.0 JSON Schema（去 $schema；与完整性检查同一派生） */
export function openApiSchemaOf(schema: ZodType, io: 'input' | 'output' = 'input'): SchemaObject {
  const raw = z.toJSONSchema(schema, { target: 'openapi-3.0', io }) as Record<string, unknown>
  delete raw['$schema']
  return raw as SchemaObject
}

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

/** 非 JSON 响应体（如 application/octet-stream）：契约声明 contentType + schema */
export function ApiContractMediaResponse(options: {
  status: number
  description: string
  contentType: string
  schema: ZodType
}): MethodDecorator {
  return ApiResponse({
    status: options.status,
    description: options.description,
    content: {
      [options.contentType]: { schema: openApiSchemaOf(options.schema, 'output') },
    },
  })
}

/** 非 JSON 请求体：@ApiConsumes 决定 content key，@ApiBody 提供派生 schema */
export function ApiContractMediaBody(options: {
  description?: string
  contentType: string
  schema: ZodType
}): MethodDecorator {
  return applyDecorators(
    ApiConsumes(options.contentType),
    ApiBody({
      required: true,
      description: options.description,
      schema: openApiSchemaOf(options.schema, 'input'),
    }),
  )
}

/**
 * 请求头契约：逐项生成 OpenAPI in: header 参数（名称/required/schema 与 zod 契约同源）。
 * 注意：@Headers() 本身不会让 swagger 生成参数——这正是需要本装饰器的地方。
 */
export function ApiContractHeaders(schema: ZodObject): MethodDecorator {
  const json = openApiSchemaOf(schema, 'input')
  const properties = (json.properties ?? {}) as Record<string, SchemaObject>
  const required = new Set(Array.isArray(json.required) ? (json.required as string[]) : [])
  const decorators = Object.entries(properties).map(([name, propSchema]) =>
    ApiHeader({ name, required: required.has(name), schema: propSchema }),
  )
  return applyDecorators(...decorators)
}