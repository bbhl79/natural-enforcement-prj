// OpenAPI 文档装配与契约完整性自动检查（Spec-工程基座 §9 / #66 / #69）
// 唯一事实源是 @ne/contracts 中的 zod schema：
// - 文档装配完全经 @nestjs/swagger 12 原生 StandardSchemaOpenApiConverter 从控制器的
//   @Body/@Query({ schema }) 与 @ApiResponse({ standardSchema }) 派生，零手写重复 schema；
// - verifyOpenApiCompleteness 把产出文档与 API_CONTRACT_ENDPOINTS 双向核对，任何契约端点、
//   请求体（含非 JSON 媒体类型）、查询/请求头/路径参数、响应 schema 遗漏或未登记端点都会被检出。
import { isDeepStrictEqual } from 'node:util'
import type { INestApplication } from '@nestjs/common'
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
  type OperationObject,
  type ParameterObject,
} from '@nestjs/swagger'
import { z } from 'zod'
import {
  API_CONTRACT_ENDPOINTS,
  isMediaType,
  type ApiContractEndpoint,
  type ApiContractRequestBody,
  type ApiContractResponseBody,
  type HttpMethod,
} from '@ne/contracts'

const HTTP_METHODS: readonly HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete']

/**
 * 契约路径使用 Express 风格（`:id`，与 Nest 控制器一致），OpenAPI 文档使用
 * `{id}` 模板。核对前统一归一化，避免两种写法互相判为「缺少/未登记」。
 */
export function openApiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}')
}

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('natural-enforcement API')
    .setDescription('自然执法系统 API（zod 契约唯一事实源派生）')
    .setVersion('0.1.0')
    .build()
  return SwaggerModule.createDocument(app, config)
}

export function expectedOpenApiSchema(
  schema: z.ZodType,
  io: 'input' | 'output',
): Record<string, unknown> {
  const raw = z.toJSONSchema(schema, { target: 'openapi-3.0', io }) as Record<string, unknown>
  const rest = { ...raw }
  delete rest['$schema']
  return rest
}

interface ResolvedMedia {
  readonly contentType: string
  readonly schema: Record<string, unknown>
}

/** 把契约请求/响应体归一为「媒体类型 + 期望 JSON Schema」 */
function resolveMedia(
  value: ApiContractRequestBody | ApiContractResponseBody,
  io: 'input' | 'output',
): ResolvedMedia {
  if (isMediaType(value)) {
    return { contentType: value.contentType, schema: expectedOpenApiSchema(value.schema, io) }
  }
  return { contentType: 'application/json', schema: expectedOpenApiSchema(value, io) }
}

function getContentMap(
  holder: unknown,
): Record<string, { schema?: Record<string, unknown> }> | undefined {
  return (holder as { content?: Record<string, { schema?: Record<string, unknown> }> } | undefined)
    ?.content
}

function getContentSchema(holder: unknown, contentType: string): Record<string, unknown> | undefined {
  return getContentMap(holder)?.[contentType]?.schema
}

interface ExpectedParam {
  readonly name: string
  readonly schema: Record<string, unknown>
  readonly required: boolean
}

function expectedParams(schema: z.ZodObject): Map<string, ExpectedParam> {
  const json = expectedOpenApiSchema(schema, 'input')
  const properties = (json['properties'] ?? {}) as Record<string, Record<string, unknown>>
  const required = new Set(Array.isArray(json['required']) ? (json['required'] as string[]) : [])
  return new Map(
    Object.entries(properties).map(([name, propSchema]) => [
      name,
      { name, schema: propSchema, required: required.has(name) },
    ]),
  )
}

/**
 * 逐项核对某类参数（query/header/path）：存在性、required、schema 完全一致，
 * 且不允许 OpenAPI 出现契约未定义的多余参数。
 */
function verifyParams(
  op: OperationObject,
  kind: 'query' | 'header' | 'path',
  contract: z.ZodObject | undefined,
  label: string,
  errors: string[],
): void {
  const actualParams = (op.parameters ?? []).filter(
    (p): p is ParameterObject => 'in' in p && p.in === kind,
  )
  const kindLabel = kind === 'header' ? '请求头' : kind === 'path' ? '路径参数' : 'query 参数'
  if (!contract) {
    if (actualParams.length > 0) {
      errors.push(`${label}: 契约未定义${kindLabel}，但 OpenAPI 存在 ${kindLabel}`)
    }
    return
  }
  const expected = expectedParams(contract)
  const byName = new Map(actualParams.map((p) => [String(p.name).toLowerCase(), p]))

  for (const [name, exp] of expected) {
    const actual = byName.get(name.toLowerCase())
    if (!actual) {
      errors.push(`${label}: 缺少${kindLabel} ${name}`)
      continue
    }
    if (Boolean(actual.required) !== exp.required) {
      errors.push(`${label}: ${kindLabel} ${name} 的 required 与契约不一致`)
    }
    if (!isDeepStrictEqual(actual.schema, exp.schema)) {
      errors.push(`${label}: ${kindLabel} ${name} 的 schema 与 zod 契约不一致`)
    }
  }
  const expectedNames = new Set([...expected.keys()].map((n) => n.toLowerCase()))
  for (const actual of actualParams) {
    if (!expectedNames.has(String(actual.name).toLowerCase())) {
      errors.push(`${label}: OpenAPI 存在契约未定义的${kindLabel} ${String(actual.name)}`)
    }
  }
}

export interface OpenApiCompletenessResult {
  readonly ok: boolean
  readonly errors: readonly string[]
}

export function verifyOpenApiCompleteness(
  doc: OpenAPIObject,
  endpoints: readonly ApiContractEndpoint[] = API_CONTRACT_ENDPOINTS,
): OpenApiCompletenessResult {
  const errors: string[] = []
  const expectedKeys = new Set<string>()

  for (const ep of endpoints) {
    const label = `${ep.method.toUpperCase()} ${ep.path}`
    const docPath = openApiPath(ep.path)
    expectedKeys.add(`${ep.method.toUpperCase()} ${docPath}`)

    const pathItem = doc.paths?.[docPath]
    const op = pathItem?.[ep.method] as OperationObject | undefined
    if (!op) {
      errors.push(`${label}: OpenAPI 缺少该契约端点`)
      continue
    }

    // 1. 请求体：有契约定义则媒体类型/schema 必须完整匹配且 required=true；
    //    无契约定义则不得出现。
    if (ep.requestBody) {
      const expected = resolveMedia(ep.requestBody, 'input')
      const actualContent = getContentMap(op.requestBody)
      const actualKeys = Object.keys(actualContent ?? {})
      const isRequired =
        typeof op.requestBody === 'object' &&
        op.requestBody !== null &&
        'required' in op.requestBody &&
        op.requestBody.required === true
      if (!actualContent) {
        errors.push(`${label}: 缺少 requestBody（${expected.contentType} schema）`)
      } else {
        if (!isRequired) {
          errors.push(`${label}: requestBody 缺少 required: true`)
        }
        if (actualKeys.length !== 1 || actualKeys[0] !== expected.contentType) {
          errors.push(
            `${label}: requestBody 媒体类型应为 ${expected.contentType}（实际：${actualKeys.join(',') || '无'}）`,
          )
        }
        const actualSchema = getContentSchema(op.requestBody, expected.contentType)
        if (!actualSchema) {
          errors.push(`${label}: requestBody 缺少 ${expected.contentType} schema`)
        } else if (!isDeepStrictEqual(actualSchema, expected.schema)) {
          errors.push(`${label}: requestBody schema 与 zod 契约不一致`)
        }
      }
    } else if (op.requestBody !== undefined) {
      errors.push(`${label}: 契约未定义 requestBody，但 OpenAPI 存在 requestBody`)
    }

    // 2. 查询参数、请求头、路径参数（逐类核对，含多余参数检出）
    verifyParams(op, 'query', ep.query, label, errors)
    verifyParams(op, 'header', ep.headers, label, errors)
    verifyParams(op, 'path', ep.pathParams, label, errors)

    // 3. 响应：逐状态码核对媒体类型与 schema
    for (const [statusStr, resContract] of Object.entries(ep.responses)) {
      const expected = resolveMedia(resContract, 'output')
      const actualContent = getContentMap(op.responses?.[statusStr])
      const actualKeys = Object.keys(actualContent ?? {})
      if (!actualContent) {
        errors.push(`${label}: 缺少 ${statusStr} 响应（${expected.contentType}）`)
        continue
      }
      if (actualKeys.length !== 1 || actualKeys[0] !== expected.contentType) {
        errors.push(
          `${label}: ${statusStr} 响应媒体类型应为 ${expected.contentType}（实际：${actualKeys.join(',') || '无'}）`,
        )
      }
      const actualSchema = getContentSchema(op.responses?.[statusStr], expected.contentType)
      if (!actualSchema) {
        errors.push(`${label}: 缺少 ${statusStr} 响应 ${expected.contentType} schema`)
      } else if (!isDeepStrictEqual(actualSchema, expected.schema)) {
        errors.push(`${label}: ${statusStr} 响应 schema 与 zod 契约不一致`)
      }
    }
  }

  // 4. 反向检查：OpenAPI 中不得出现未纳入契约清单的公开端点
  for (const [path, pathItem] of Object.entries(doc.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      if (pathItem?.[method]) {
        const label = `${method.toUpperCase()} ${path}`
        if (!expectedKeys.has(label)) {
          errors.push(`${label}: OpenAPI 存在未纳入 API_CONTRACT_ENDPOINTS 的端点`)
        }
      }
    }
  }

  return { ok: errors.length === 0, errors }
}