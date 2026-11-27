// OpenAPI 契约派生与完整性检查单元测试（零 DB 基础设施，#66）
// 正反样例覆盖：有请求体（POST /enforcement-points）、无请求体（GET /health、GET /enforcement-points/nearby）、
// create 类响应（201 {id}）以及自动检查对契约遗漏/漂移的检出能力。
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Controller, Module, Post, StandardSchemaSerializerInterceptor, type INestApplication } from '@nestjs/common'
import { NestFactory, Reflector } from '@nestjs/core'
import type { OpenAPIObject, OperationObject } from '@nestjs/swagger'
import {
  CreateEnforcementPointResultSchema,
  ENFORCEMENT_POINT_ROUTES,
  HEALTH_ROUTES,
} from '@ne/contracts'
import { createApp } from './bootstrap.js'
import { ApiContractResponse } from './common/api-contract.decorator.js'
import { buildOpenApiDocument, verifyOpenApiCompleteness } from './openapi.js'

const ctx: { app?: INestApplication; doc?: OpenAPIObject } = {}

beforeAll(async () => {
  ctx.app = await createApp({ logger: false })
  ctx.doc = buildOpenApiDocument(ctx.app)
})

afterAll(async () => {
  await ctx.app?.close()
})

function cloneDoc(): OpenAPIObject {
  return structuredClone(ctx.doc!)
}

function jsonSchemaOf(holder: unknown): Record<string, unknown> | undefined {
  return (holder as { content?: Record<string, { schema?: Record<string, unknown> }> } | undefined)
    ?.content?.['application/json']?.schema
}

describe('OpenAPI 契约派生（zod 唯一事实源）', () => {
  it('有请求体端点：POST /enforcement-points 准确派生 requestBody、201 create 响应与 400 错误响应', () => {
    const op = ctx.doc!.paths[ENFORCEMENT_POINT_ROUTES.base]?.post
    expect(op).toBeDefined()

    const reqBody = op!.requestBody as { required?: boolean } | undefined
    expect(reqBody?.required).toBe(true)
    expect(jsonSchemaOf(op!.requestBody)).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 200, pattern: '^[^\\u0000]*$' },
        lat: { type: 'number', minimum: -90, maximum: 90 },
        lng: { type: 'number', minimum: -180, maximum: 180 },
      },
      required: ['name', 'lat', 'lng'],
      additionalProperties: false,
    })

    expect(jsonSchemaOf(op!.responses?.['201'])).toMatchObject({
      type: 'object',
      properties: {
        id: { type: 'integer' },
      },
      required: ['id'],
      additionalProperties: false,
    })

    expect(jsonSchemaOf(op!.responses?.['400'])).toMatchObject({
      type: 'object',
      required: ['message'],
    })
  })

  it('无请求体端点：GET /enforcement-points/nearby 派生全部 query 参数与响应，且无 requestBody', () => {
    const op = ctx.doc!.paths[ENFORCEMENT_POINT_ROUTES.nearby]?.get
    expect(op).toBeDefined()
    expect(op!.requestBody).toBeUndefined()

    const params = (op!.parameters ?? []) as Array<{
      name: string
      in: string
      required?: boolean
      schema?: Record<string, unknown>
    }>
    const byName = Object.fromEntries(params.map((p) => [p.name, p]))
    expect(Object.keys(byName).sort()).toEqual(['lat', 'lng', 'radiusM'])
    expect(byName['lat']).toMatchObject({
      in: 'query',
      required: true,
      schema: { type: 'number', minimum: -90, maximum: 90 },
    })
    expect(byName['lng']).toMatchObject({
      in: 'query',
      required: true,
      schema: { type: 'number', minimum: -180, maximum: 180 },
    })
    expect(byName['radiusM']).toMatchObject({
      in: 'query',
      required: true,
      schema: { type: 'integer', minimum: 1, maximum: 100_000 },
    })

    expect(jsonSchemaOf(op!.responses?.['200'])).toMatchObject({
      type: 'object',
      required: ['center', 'radiusM', 'points'],
    })
  })

  it('无请求体端点：GET /health 无 requestBody，有 200 HealthResultSchema', () => {
    const op = ctx.doc!.paths[HEALTH_ROUTES.base]?.get
    expect(op).toBeDefined()
    expect(op!.requestBody).toBeUndefined()

    expect(jsonSchemaOf(op!.responses?.['200'])).toEqual({
      type: 'object',
      properties: {
        status: { type: 'string' },
        uptime: { type: 'number' },
      },
      required: ['status', 'uptime'],
      additionalProperties: false,
    })
  })
})

describe('verifyOpenApiCompleteness（自动检查正反测试）', () => {
  it('正例：当前装配产出的 OpenAPI 通过完整性检查', () => {
    expect(verifyOpenApiCompleteness(ctx.doc!)).toEqual({ ok: true, errors: [] })
  })

  it('反例：遗漏契约端点时检出', () => {
    const doc = cloneDoc()
    delete doc.paths[ENFORCEMENT_POINT_ROUTES.base]
    const result = verifyOpenApiCompleteness(doc)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes(`POST ${ENFORCEMENT_POINT_ROUTES.base}`))).toBe(true)
  })

  it('反例：有请求体端点丢失 requestBody 时检出', () => {
    const doc = cloneDoc()
    delete (doc.paths[ENFORCEMENT_POINT_ROUTES.base]!.post as OperationObject).requestBody
    const result = verifyOpenApiCompleteness(doc)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('requestBody'))).toBe(true)
  })

  it('反例：查询参数遗漏时检出', () => {
    const doc = cloneDoc()
    const op = doc.paths[ENFORCEMENT_POINT_ROUTES.nearby]!.get as OperationObject
    op.parameters = (op.parameters ?? []).filter((p) => !('name' in p) || p.name !== 'radiusM')
    const result = verifyOpenApiCompleteness(doc)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('radiusM'))).toBe(true)
  })

  it('反例：create 端点 201 响应 schema 丢失时检出', () => {
    const doc = cloneDoc()
    const op = doc.paths[ENFORCEMENT_POINT_ROUTES.base]!.post as OperationObject
    delete op.responses!['201']
    const result = verifyOpenApiCompleteness(doc)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('201'))).toBe(true)
  })

  it('反例：无请求体端点意外携带 requestBody 时检出', () => {
    const doc = cloneDoc()
    const op = doc.paths[HEALTH_ROUTES.base]!.get as OperationObject
    op.requestBody = { content: { 'application/json': { schema: { type: 'object' } } } }
    const result = verifyOpenApiCompleteness(doc)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('requestBody'))).toBe(true)
  })

  it('反例：OpenAPI 出现契约清单外未登记端点时检出', () => {
    const doc = cloneDoc()
    doc.paths['/undocumented'] = {
      delete: { responses: { '204': { description: 'ok' } } },
    }
    const result = verifyOpenApiCompleteness(doc)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('DELETE /undocumented'))).toBe(true)
  })
})

describe('create 类响应运行时 schema 校验（StandardSchemaSerializerInterceptor）', () => {
  let mode: 'valid' | 'bad-type' | 'extra-field' = 'valid'

  @Controller('/_test-create')
  class TestCreateController {
    @Post()
    @ApiContractResponse({
      status: 201,
      description: '测试 create 响应',
      schema: CreateEnforcementPointResultSchema,
    })
    create(): unknown {
      if (mode === 'valid') return { id: 42 }
      if (mode === 'bad-type') return { id: 'not-an-int' }
      return { id: 42, extra: 'unexpected' }
    }
  }

  @Module({ controllers: [TestCreateController] })
  class TestCreateModule {}

  let testApp: INestApplication
  let baseUrl: string

  beforeAll(async () => {
    testApp = await NestFactory.create(TestCreateModule, { logger: false })
    testApp.useGlobalInterceptors(new StandardSchemaSerializerInterceptor(testApp.get(Reflector)))
    await testApp.listen(0)
    baseUrl = await testApp.getUrl()
  })

  afterAll(async () => {
    await testApp.close()
  })

  it('正例：合法 {id} 响应经运行时 schema 校验后返回 201', async () => {
    mode = 'valid'
    const res = await fetch(`${baseUrl}/_test-create`, { method: 'POST' })
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ id: 42 })
  })

  it('反例：违反 CreateEnforcementPointResultSchema 的响应（类型错/多余字段）在运行时被拦截', async () => {
    mode = 'bad-type'
    const badType = await fetch(`${baseUrl}/_test-create`, { method: 'POST' })
    expect(badType.status).toBe(500)

    mode = 'extra-field'
    const extraField = await fetch(`${baseUrl}/_test-create`, { method: 'POST' })
    expect(extraField.status).toBe(500)
  })
})
