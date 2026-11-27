// OpenAPI 文档装配与契约完整性自动检查（Spec-工程基座 §9 / #66）
// 唯一事实源是 @ne/contracts 中的 zod schema：
// - 文档装配完全经 @nestjs/swagger 12 原生 StandardSchemaOpenApiConverter 从控制器的
//   @Body/@Query({ schema }) 与 @ApiResponse({ standardSchema }) 派生，零手写重复 schema；
// - verifyOpenApiCompleteness 把产出文档与 API_CONTRACT_ENDPOINTS 双向核对，任何契约端点、
//   请求体、查询参数、响应 schema 遗漏或未登记端点都会被检出。
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
import { API_CONTRACT_ENDPOINTS, type ApiContractEndpoint, type HttpMethod } from '@ne/contracts'

const HTTP_METHODS: readonly HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete']

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('natural-enforcement API')
    .setDescription('自然执法系统 API（zod 契约唯一事实源派生）')
    .setVersion('0.1.0')
    .build()
  return SwaggerModule.createDocument(app, config)
}

function expectedOpenApiSchema(schema: z.ZodType, io: 'input' | 'output'): Record<string, unknown> {
  const raw = z.toJSONSchema(schema, { target: 'openapi-3.0', io }) as Record<string, unknown>
  const rest = { ...raw }
  delete rest['$schema']
  return rest
}

function getJsonSchema(
  holder: unknown,
): Record<string, unknown> | undefined {
  if (!holder || typeof holder !== 'object') return undefined
  const content = (holder as { content?: Record<string, { schema?: Record<string, unknown> }> }).content
  return content?.['application/json']?.schema
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
    expectedKeys.add(label)

    const pathItem = doc.paths?.[ep.path]
    const op = pathItem?.[ep.method] as OperationObject | undefined
    if (!op) {
      errors.push(`${label}: OpenAPI 缺少该契约端点`)
      continue
    }

    // 1. 请求体：有契约定义则必须完整匹配且 required=true，无契约定义则不得出现
    if (ep.requestBody) {
      const actualBody = getJsonSchema(op.requestBody)
      const isRequired =
        typeof op.requestBody === 'object' &&
        op.requestBody !== null &&
        'required' in op.requestBody &&
        op.requestBody.required === true
      if (!actualBody) {
        errors.push(`${label}: 缺少 requestBody（application/json schema）`)
      } else {
        if (!isRequired) {
          errors.push(`${label}: requestBody 缺少 required: true`)
        }
        const expectedBody = expectedOpenApiSchema(ep.requestBody, 'input')
        if (!isDeepStrictEqual(actualBody, expectedBody)) {
          errors.push(`${label}: requestBody schema 与 zod 契约不一致`)
        }
      }
    } else if (op.requestBody !== undefined) {
      errors.push(`${label}: 契约未定义 requestBody，但 OpenAPI 存在 requestBody`)
    }

    // 2. 查询参数：逐项核对存在性、required、schema，并检出契约外多余 query 参数
    const actualQueryParams = (op.parameters ?? []).filter(
      (p): p is ParameterObject => 'in' in p && p.in === 'query',
    )
    if (ep.query) {
      const expectedQuery = expectedOpenApiSchema(ep.query, 'input')
      const expectedProps = (expectedQuery['properties'] ?? {}) as Record<string, Record<string, unknown>>
      const expectedRequired = new Set(
        Array.isArray(expectedQuery['required']) ? (expectedQuery['required'] as string[]) : [],
      )
      const byName = new Map(actualQueryParams.map((p) => [p.name, p]))

      for (const [name, propSchema] of Object.entries(expectedProps)) {
        const actual = byName.get(name)
        if (!actual) {
          errors.push(`${label}: 缺少 query 参数 ${name}`)
          continue
        }
        if (Boolean(actual.required) !== expectedRequired.has(name)) {
          errors.push(`${label}: query 参数 ${name} 的 required 与契约不一致`)
        }
        if (!isDeepStrictEqual(actual.schema, propSchema)) {
          errors.push(`${label}: query 参数 ${name} 的 schema 与 zod 契约不一致`)
        }
      }
      for (const actual of actualQueryParams) {
        if (!(actual.name in expectedProps)) {
          errors.push(`${label}: OpenAPI 存在契约未定义的 query 参数 ${actual.name}`)
        }
      }
    } else if (actualQueryParams.length > 0) {
      errors.push(`${label}: 契约未定义 query 参数，但 OpenAPI 存在 query 参数`)
    }

    // 3. 响应：逐状态码核对存在性与 schema
    for (const [statusStr, resSchema] of Object.entries(ep.responses)) {
      const actualRes = getJsonSchema(op.responses?.[statusStr])
      if (!actualRes) {
        errors.push(`${label}: 缺少 ${statusStr} 响应 schema`)
        continue
      }
      const expectedRes = expectedOpenApiSchema(resSchema, 'output')
      if (!isDeepStrictEqual(actualRes, expectedRes)) {
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
