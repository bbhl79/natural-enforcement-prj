#!/usr/bin/env node
// ============================================================================
// 脚手架生成器（#64 package / #65 app / #67 nest-module；Spec-工程基座 §5）
//
// 调用形态（容器内）：
//   node /tmp/ne-gen/input/devenv/gen/gen.mjs <kind> <kebab-case-name>
//   环境：NE_GEN_VARIANT=http|internal（nest-module 必填）
//         NE_GEN_SPEC_REL=<仓库相对路径>（nest-module 必填；随输入 tar 传入）
//
// 输入 channel（由 devenv 经 stdin tar 传入，解包到 $NE_GEN_SOURCE）：
//   - 本次调用当前工作树的完整 `devenv/gen/` 集合（生成器自身，零第三方依赖）；
//   - 锚点文件（补丁以宿主当前内容为基准，镜像内没有可静默 fallback 的烘焙副本）：
//       package/app：`devenv/workspace.Dockerfile`；
//       nest-module：`apps/api/src/app.module.ts`（HTTP 另加
//       `packages/contracts/src/api-registry.ts`）与业务 spec 文件。
//
// 输出 channel（devenv 侧 tar 回宿主，先解包到暂存目录再原子落盘）：
//   - 新文件 + 被补丁文件的完整内容；
//   - `.ne-gen-manifest.json`：文件清单 + 每文件 sha256 + 补丁基准/新增整行 +
//     spec 路径/哈希，供宿主核对「传输/生成全有或全无」并做事务式落盘。
//
// 约定：
//   - stderr = 人读进度（从不写 stdout）；
//   - 任何校验失败都在写盘前退出（非零），不产生部分输出；
//   - 缺少必要业务信息 → 退出码 2（用法/输入）；目标已存在/锚点已注入 → 4。
// ============================================================================
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const KINDS = ['package', 'app', 'nest-module']
const SOURCE = process.env.NE_GEN_SOURCE || '/tmp/ne-gen/input'
const OUTPUT = process.env.NE_GEN_OUTPUT || '/tmp/ne-gen/output'
const MANIFEST_NAME = '.ne-gen-manifest.json'
const VARIANT = process.env.NE_GEN_VARIANT || ''
const SPEC_REL = process.env.NE_GEN_SPEC_REL || ''

const note = (m) => process.stderr.write(`[gen] ${m}\n`)
const die = (m, code = 4) => {
  process.stderr.write(`[gen] ERROR: ${m}\n`)
  process.exit(code)
}

const [, , kind, name] = process.argv
if (!KINDS.includes(kind)) {
  const hint = kind === 'page' ? '（page 归 #68）' : ''
  die(`kind 尚未实现：${kind ?? '(缺)'}${hint}（已交付 package/app/nest-module）`, 2)
}
if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name ?? '')) {
  die(`名称须为 kebab-case（小写字母数字+连字符）：${name ?? '(缺)'}`, 2)
}
if (name.length > 64) die(`名称过长（≤64 字符）：${name}`, 2)

const src = (...p) => path.join(SOURCE, ...p)
const pascal = name.split('-').map((s) => s[0].toUpperCase() + s.slice(1)).join('')
const upper = name.replace(/-/g, '_').toUpperCase()
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

// ---------------------------------------------------------------------------
// 模板：package/app 与仓库既有 packages/*、apps/* 逐字对齐
// ---------------------------------------------------------------------------
const PKG_JSON = `{
  "name": "@ne/${name}",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "devenv gen package 生成的共享包（#64）",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:unit": "vitest run src"
  },
  "devDependencies": {
    "@ne/tsconfig": "workspace:*",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
`

const makeTsconfig = (preset) => `{
  "extends": "@ne/tsconfig/${preset}",
  "compilerOptions": {
    "noEmit": true
  },
  "include": ["src"]
}
`

const TSCONFIG_BUILD = `{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "outDir": "dist",
    "rootDir": "src"
  },
  "exclude": ["**/*.spec.ts"]
}
`

const VITEST_CONFIG = `import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
  },
})
`

const makeHello = (label) => `// ${label} @ne/${name}：示例纯函数（生成后可直接替换）
export function hello(target: string): string {
  return \`hello \${target} from @ne/${name}\`
}
`

const HELLO_SPEC = `import { describe, expect, it } from 'vitest'
import { hello } from './hello.js'

describe('${name}', () => {
  it('开箱即绿：纯函数单测', () => {
    expect(hello('world')).toBe('hello world from @ne/${name}')
  })
})
`

const INDEX_REEXPORT = `export { hello } from './hello.js'
`

const APP_PKG_JSON = `{
  "name": "@ne/${name}",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "devenv gen app 生成的应用（#65）",
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "start": "node dist/main.js",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:unit": "vitest run src"
  },
  "devDependencies": {
    "@ne/tsconfig": "workspace:*",
    "@types/node": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
`

const APP_MAIN = `import { hello } from './hello.js'

export function main(): void {
  console.log(hello('app'))
}

main()
`

// ---------------------------------------------------------------------------
// nest-module spec：业务信息唯一来源（字段/路径/说明）；缺失或非法即停止
// ---------------------------------------------------------------------------
const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)

function failSpec(message) {
  die(`缺少必要业务信息或 spec 非法：${message}`, 2)
}

function validateField(fieldName, def) {
  if (!/^[a-z][A-Za-z0-9]*$/.test(fieldName)) {
    failSpec(`字段名须为 camelCase（小写字母开头，仅字母数字）：${fieldName}`)
  }
  if (fieldName === 'id' || fieldName === 'createdAt') {
    failSpec(`字段名 ${fieldName} 与生成响应 DTO 的保留字段冲突（id / createdAt 由生成物提供）`)
  }
  if (!isPlainObject(def)) failSpec(`字段 ${fieldName} 的定义必须是对象`)
  const type = def.type
  if (!['string', 'integer', 'number', 'boolean'].includes(type)) {
    failSpec(`字段 ${fieldName}.type 必须是 string|integer|number|boolean：${String(type)}`)
  }
  const allowed = new Set(['type', 'optional'])
  if (type === 'string') {
    allowed.add('minLength')
    allowed.add('maxLength')
  } else if (type === 'integer' || type === 'number') {
    allowed.add('minimum')
    allowed.add('maximum')
  }
  for (const key of Object.keys(def)) {
    if (!allowed.has(key)) {
      failSpec(`字段 ${fieldName} 含不支持的键 ${key}（${type} 允许：${[...allowed].join(' / ')}）`)
    }
  }
  if (def.optional !== undefined && typeof def.optional !== 'boolean') {
    failSpec(`字段 ${fieldName}.optional 必须是布尔值`)
  }
  if (type === 'string') {
    for (const key of ['minLength', 'maxLength']) {
      if (def[key] !== undefined && (!Number.isInteger(def[key]) || def[key] < 0)) {
        failSpec(`字段 ${fieldName}.${key} 必须是非负整数`)
      }
    }
    if (def.minLength !== undefined && def.maxLength !== undefined && def.minLength > def.maxLength) {
      failSpec(`字段 ${fieldName} 的 minLength 不得大于 maxLength`)
    }
  } else if (type === 'integer' || type === 'number') {
    for (const key of ['minimum', 'maximum']) {
      if (def[key] !== undefined && (typeof def[key] !== 'number' || !Number.isFinite(def[key]))) {
        failSpec(`字段 ${fieldName}.${key} 必须是有限数字`)
      }
      if (type === 'integer' && def[key] !== undefined && !Number.isInteger(def[key])) {
        failSpec(`字段 ${fieldName}.${key} 在 integer 类型下必须是整数`)
      }
    }
    if (def.minimum !== undefined && def.maximum !== undefined && def.minimum > def.maximum) {
      failSpec(`字段 ${fieldName} 的 minimum 不得大于 maximum`)
    }
  }
}

function loadSpec() {
  if (!SPEC_REL) {
    failSpec('nest-module 需要 --spec <仓库相对路径>（JSON：fields 非空，可选 basePath/description）')
  }
  const abs = src(SPEC_REL)
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    failSpec(`spec 未随输入传入：${SPEC_REL}（--spec 须为仓库相对路径）`)
  }
  const raw = fs.readFileSync(abs)
  let spec
  try {
    spec = JSON.parse(raw.toString('utf8'))
  } catch (e) {
    failSpec(`spec 不是合法 JSON（${SPEC_REL}）：${e.message}`)
  }
  if (!isPlainObject(spec)) failSpec('spec 顶层必须是 JSON 对象')
  const allowedTop = new Set(['description', 'basePath', 'fields'])
  for (const key of Object.keys(spec)) {
    if (!allowedTop.has(key)) failSpec(`spec 顶层含不支持的键 ${key}（允许：description / basePath / fields）`)
  }
  if (spec.description !== undefined && typeof spec.description !== 'string') {
    failSpec('spec.description 必须是字符串')
  }
  let basePath = `/${name}`
  if (spec.basePath !== undefined) {
    if (typeof spec.basePath !== 'string') failSpec('spec.basePath 必须是字符串')
    if (!/^\/[a-z0-9]+(-[a-z0-9]+)*(\/[a-z0-9]+(-[a-z0-9]+)*)*$/.test(spec.basePath)) {
      failSpec(`spec.basePath 非法（需以 / 开头、小写 kebab 段、无尾斜杠）：${spec.basePath}`)
    }
    if (spec.basePath.length > 120) failSpec('spec.basePath 过长（≤120 字符）')
    basePath = spec.basePath
  }
  if (!isPlainObject(spec.fields) || Object.keys(spec.fields).length === 0) {
    failSpec('spec.fields 必须是非空对象（否则无法生成完整请求/响应 schema，拒绝假完整骨架）')
  }
  for (const [fieldName, def] of Object.entries(spec.fields)) validateField(fieldName, def)
  return { spec, basePath, specSha: sha256(raw) }
}

const zodExpr = (def) => {
  let expr
  if (def.type === 'string') {
    expr = 'z.string()'
    if (def.minLength !== undefined) expr += `.min(${def.minLength})`
    if (def.maxLength !== undefined) expr += `.max(${def.maxLength})`
  } else if (def.type === 'boolean') {
    expr = 'z.boolean()'
  } else {
    expr = def.type === 'integer' ? 'z.number().int()' : 'z.number()'
    if (def.minimum !== undefined) expr += `.min(${def.minimum})`
    if (def.maximum !== undefined) expr += `.max(${def.maximum})`
  }
  if (def.optional) expr += '.optional()'
  return expr
}

const tsType = (def) => {
  if (def.type === 'string') return 'string'
  if (def.type === 'boolean') return 'boolean'
  return 'number'
}

const tsField = (fieldName, def) => `${fieldName}${def.optional ? '?' : ''}: ${tsType(def)}`

function sampleFor(def) {
  if (def.type === 'boolean') return true
  if (def.type === 'string') {
    let sample = 'sample'
    const min = def.minLength ?? 0
    if (sample.length < min) sample = sample.padEnd(min, 'x')
    if (def.maxLength !== undefined && sample.length > def.maxLength) sample = sample.slice(0, def.maxLength)
    return sample
  }
  let value = def.minimum ?? 0
  if (def.maximum !== undefined && value > def.maximum) value = def.maximum
  return def.type === 'integer' ? Math.round(value) : value
}

const sampleObject = (fields) => {
  const out = {}
  for (const [fieldName, def] of Object.entries(fields)) out[fieldName] = sampleFor(def)
  return out
}

const sampleLiteral = (sample) => JSON.stringify(sample, null, 2)

// zod 对象字段行（请求 schema 与响应 DTO 共用同一形状/缩进）
const objectFieldLines = (fields, indent) =>
  Object.entries(fields)
    .map(([fieldName, def]) => `${indent}${fieldName}: ${zodExpr(def)},`)
    .join('\n')

function safeComment(text) {
  // U+2028/U+2029 是合法 JSON 字符，但会被 JS 当作行终止符：进入 // 注释会截断注释、
  // 让生成物无法编译。按码点替换，源码里既不写这两个字符、也不写 \u 转义（裸字符会
  // 截断正则字面量；转义文本又可能被编辑工具链改写成裸字符——#67 实测踩过）。
  let out = text
  for (const code of [0x0a, 0x0d, 0x2028, 0x2029]) {
    out = out.split(String.fromCharCode(code)).join(' ')
  }
  return out.split('*/').join('* /')
}

const specHint = (spec, basePath) =>
  safeComment(spec.description ?? `${name}（${basePath}）`)

// ---------------------------------------------------------------------------
// nest-module 模板：HTTP 契约联动 / internal 仅服务（不强制 HTTP 契约）
// ---------------------------------------------------------------------------
function contractFile({ spec, basePath, fields }) {
  const fieldLines = objectFieldLines(fields, '    ')
  return `// ${specHint(spec, basePath)}：传输契约（devenv gen nest-module --http 生成；#67）
// 路由常量、请求/响应 schema 与端点清单同源；端点经 api-registry.ts 的整行锚点
// 自动进入 API_CONTRACT_ENDPOINTS（#66 OpenAPI 完整性检查据此核对）。
import { z } from 'zod'
import type { ApiContractEndpoint } from './api-contract.js'
import { ValidationErrorSchema } from './http-errors.js'

export const ${upper}_ROUTES = {
  base: '${basePath}',
  create: '${basePath}',
  list: '${basePath}',
} as const

export const Create${pascal}Schema = z
  .object({
${fieldLines}
  })
  .strict()
export type Create${pascal}Dto = z.infer<typeof Create${pascal}Schema>

export const Create${pascal}ResultSchema = z
  .object({
    id: z.number().int(),
  })
  .strict()
export type Create${pascal}Result = z.infer<typeof Create${pascal}ResultSchema>

export const ${pascal}DtoSchema = z
  .object({
    id: z.number().int(),
${fieldLines}
    createdAt: z.string(),
  })
  .strict()
export type ${pascal}Dto = z.infer<typeof ${pascal}DtoSchema>

export const ${pascal}ListResultSchema = z
  .object({
    items: z.array(${pascal}DtoSchema),
  })
  .strict()
export type ${pascal}ListResult = z.infer<typeof ${pascal}ListResultSchema>

export const ${upper}_ENDPOINTS: readonly ApiContractEndpoint[] = [
  {
    method: 'post',
    path: ${upper}_ROUTES.create,
    requestBody: Create${pascal}Schema,
    responses: {
      201: Create${pascal}ResultSchema,
      400: ValidationErrorSchema,
    },
  },
  {
    method: 'get',
    path: ${upper}_ROUTES.list,
    responses: {
      200: ${pascal}ListResultSchema,
    },
  },
] as const
`
}

function contractSpecFile({ spec, basePath, fields }) {
  const sample = sampleObject(fields)
  return `// ${specHint(spec, basePath)}：契约行为单测（devenv gen nest-module --http 生成；#67）
import { describe, expect, it } from 'vitest'
import {
  Create${pascal}ResultSchema,
  Create${pascal}Schema,
  ${pascal}DtoSchema,
  ${pascal}ListResultSchema,
  ${upper}_ENDPOINTS,
  ${upper}_ROUTES,
} from './${name}.js'

const sample = ${sampleLiteral(sample)}

describe('${name} 传输契约', () => {
  it('请求 schema 接受完整字段并拒绝契约外字段', () => {
    expect(Create${pascal}Schema.parse(sample)).toEqual(sample)
    expect(Create${pascal}Schema.safeParse({ ...sample, __unexpected: true }).success).toBe(false)
  })

  it('create/list 响应 schema 校验契约形状', () => {
    expect(Create${pascal}ResultSchema.parse({ id: 1 })).toEqual({ id: 1 })
    const item = { ...sample, id: 1, createdAt: '2026-01-01T00:00:00.000Z' }
    expect(${pascal}DtoSchema.parse(item)).toEqual(item)
    expect(${pascal}ListResultSchema.parse({ items: [item] })).toEqual({ items: [item] })
  })

  it('端点清单登记 create/list（OpenAPI 完整性检查的清单来源）', () => {
    expect(${upper}_ENDPOINTS.map((e) => e.method + ' ' + e.path)).toEqual([
      'post ' + ${upper}_ROUTES.create,
      'get ' + ${upper}_ROUTES.list,
    ])
  })
})
`
}

function httpModuleFiles(fields) {
  return {
    module: `import { Module } from '@nestjs/common'
import { ${pascal}Controller } from './${name}.controller.js'
import { ${pascal}Service } from './${name}.service.js'

@Module({
  controllers: [${pascal}Controller],
  providers: [${pascal}Service],
  exports: [${pascal}Service],
})
export class ${pascal}Module {}
`,
    controller: `import { Body, Controller, Get, Post } from '@nestjs/common'
import { ApiBadRequestResponse, ApiTags } from '@nestjs/swagger'
import {
  Create${pascal}ResultSchema,
  Create${pascal}Schema,
  ${pascal}ListResultSchema,
  ${upper}_ROUTES,
  ValidationErrorSchema,
} from '@ne/contracts'
import type {
  Create${pascal}Dto,
  Create${pascal}Result,
  ${pascal}ListResult,
} from '@ne/contracts'
import { ApiContractResponse } from '../common/api-contract.decorator.js'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { ${pascal}Service } from './${name}.service.js'

const zodPipe = new ZodValidationPipe()

// 请求校验（@Body schema + ZodValidationPipe）与响应校验（ApiContractResponse）
// 同源绑定到 @ne/contracts 的 zod schema；路由常量与契约包共享。
@ApiTags('${name}')
@Controller(${upper}_ROUTES.base)
export class ${pascal}Controller {
  constructor(private readonly svc: ${pascal}Service) {}

  @Post()
  @ApiContractResponse({
    status: 201,
    description: '创建成功',
    schema: Create${pascal}ResultSchema,
  })
  @ApiBadRequestResponse({
    description: '请求体契约校验失败',
    standardSchema: ValidationErrorSchema,
  })
  create(
    @Body({ schema: Create${pascal}Schema, pipes: [zodPipe] })
    dto: Create${pascal}Dto,
  ): Create${pascal}Result {
    return this.svc.create(dto)
  }

  @Get()
  @ApiContractResponse({
    status: 200,
    description: '列表',
    schema: ${pascal}ListResultSchema,
  })
  list(): ${pascal}ListResult {
    return this.svc.list()
  }
}
`,
    service: `import { Injectable } from '@nestjs/common'
import type {
  Create${pascal}Dto,
  Create${pascal}Result,
  ${pascal}Dto,
  ${pascal}ListResult,
} from '@ne/contracts'

// 生成物示例实现：内存存储，可直接调用/测试；接入真实持久化时替换 create/list。
@Injectable()
export class ${pascal}Service {
  private readonly items: ${pascal}Dto[] = []
  private nextId = 1

  create(dto: Create${pascal}Dto): Create${pascal}Result {
    const id = this.nextId
    this.nextId += 1
    this.items.push({ ...dto, id, createdAt: new Date().toISOString() })
    return { id }
  }

  list(): ${pascal}ListResult {
    return { items: this.items.map((item) => ({ ...item })) }
  }
}
`,
    controllerSpec: `// 生成物集成测试：真实装配（路由 → 请求校验 → service → 响应校验 → OpenAPI）
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { INestApplication } from '@nestjs/common'
import { ${upper}_ROUTES } from '@ne/contracts'
import { createApp } from '../bootstrap.js'
import { buildOpenApiDocument, verifyOpenApiCompleteness } from '../openapi.js'

const ctx: { app?: INestApplication; baseUrl?: string } = {}
const valid = ${sampleLiteral(sampleObject(fields))}

beforeAll(async () => {
  ctx.app = await createApp({ logger: false })
  await ctx.app.listen(0)
  ctx.baseUrl = await ctx.app.getUrl()
})

afterAll(async () => {
  await ctx.app?.close()
})

describe('${name} HTTP 端点（生成物）', () => {
  it('POST 创建：完整请求体经校验后返回 201 契约响应', async () => {
    const res = await fetch(ctx.baseUrl! + ${upper}_ROUTES.create, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(valid),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: number }
    expect(Number.isInteger(body.id)).toBe(true)
  })

  it('POST 拒绝契约外字段（请求校验生效）', async () => {
    const res = await fetch(ctx.baseUrl! + ${upper}_ROUTES.create, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...valid, __unexpected: true }),
    })
    expect(res.status).toBe(400)
  })

  it('GET 列表返回已创建项（响应校验通过）', async () => {
    const res = await fetch(ctx.baseUrl! + ${upper}_ROUTES.list)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<Record<string, unknown>> }
    expect(
      body.items.some((item) => Object.entries(valid).every(([key, value]) => item[key] === value)),
    ).toBe(true)
  })

  it('OpenAPI：生成端点准确表达并通过 #66 完整性检查', () => {
    const doc = buildOpenApiDocument(ctx.app!)
    expect(doc.paths[${upper}_ROUTES.base]?.post).toBeDefined()
    expect(doc.paths[${upper}_ROUTES.base]?.get).toBeDefined()
    expect(verifyOpenApiCompleteness(doc)).toEqual({ ok: true, errors: [] })
  })
})
`,
  }
}

function internalModuleFiles(fields) {
  const inputLines = Object.entries(fields)
    .map(([fieldName, def]) => `  ${tsField(fieldName, def)}`)
    .join('\n')
  return {
    module: `import { Module } from '@nestjs/common'
import { ${pascal}Service } from './${name}.service.js'

// internal kind：不生成 controller / HTTP 契约（Spec §5）；service 供其它模块注入。
@Module({
  providers: [${pascal}Service],
  exports: [${pascal}Service],
})
export class ${pascal}Module {}
`,
    service: `import { Injectable } from '@nestjs/common'

// 生成物示例实现：内存存储，可直接调用/测试；接入真实持久化时替换 create/list。
export interface Create${pascal}Input {
${inputLines}
}

export interface ${pascal}Record extends Create${pascal}Input {
  id: number
  createdAt: string
}

@Injectable()
export class ${pascal}Service {
  private readonly records: ${pascal}Record[] = []
  private nextId = 1

  create(input: Create${pascal}Input): ${pascal}Record {
    const record: ${pascal}Record = {
      ...input,
      id: this.nextId,
      createdAt: new Date().toISOString(),
    }
    this.nextId += 1
    this.records.push(record)
    return { ...record }
  }

  list(): ${pascal}Record[] {
    return this.records.map((record) => ({ ...record }))
  }
}
`,
    serviceSpec: `// 生成物单元测试：internal kind 的 service 可直接实例化 / 调用
import { describe, expect, it } from 'vitest'
import { ${pascal}Service } from './${name}.service.js'

const sample = ${sampleLiteral(sampleObject(fields))}

describe('${name} internal 服务（生成物）', () => {
  it('create/list 可用且返回完整记录', () => {
    const svc = new ${pascal}Service()
    const created = svc.create(sample)
    expect(created.id).toBe(1)
    expect(created.createdAt).toEqual(expect.any(String))
    expect(svc.list()).toEqual([created])
  })
})
`,
  }
}

// ---------------------------------------------------------------------------
// 装配：新文件 Map + 锚点补丁（全部在内存中完成，校验通过后才写盘）
// ---------------------------------------------------------------------------
const KIND_SPEC = {
  package: {
    targetRoot: 'packages',
    pkgJson: PKG_JSON,
    tsconfigPreset: 'base.json',
    helloLabel: '共享包',
    entryFile: ['src/index.ts', INDEX_REEXPORT],
  },
  app: {
    targetRoot: 'apps',
    pkgJson: APP_PKG_JSON,
    tsconfigPreset: 'node.json',
    helloLabel: '应用',
    entryFile: ['src/main.ts', APP_MAIN],
  },
}

/** @type {Map<string, {content: string, mode: number}>} */
const files = new Map()
/** @type {Array<{file: string, apply: (src: string) => {text: string, addedLines: string[]}}>} */
const patches = []
/** nest-module 的 spec 内容哈希（写入 manifest，供宿主与输入快照比对） */
let specSha = ''

const put = (rel, content, mode = 0o644) => files.set(rel, { content, mode })

function linesOf(text) {
  return text.split('\n')
}

function hasLine(text, line) {
  return linesOf(text).includes(line)
}

// 整行锚点插入：marker 为独立行（允许前置缩进；prefix 模式供注释带尾注的锚点）。
// 命中数必须恰好为 1；已存在同名整行 → 幂等拒绝。返回插入的整行供宿主核对。
function insertAfterMarker(text, marker, lines, opts = {}) {
  const prefix = opts.prefix === true
  const out = []
  let hits = 0
  for (const line of linesOf(text)) {
    out.push(line)
    const matched = prefix ? line.trimStart().startsWith(marker) : line.trim() === marker
    if (matched) {
      out.push(...lines)
      hits += 1
    }
  }
  return { text: out.join('\n'), hits }
}

function requireSingleMarker(text, marker, lines, opts = {}) {
  const result = insertAfterMarker(text, marker, lines, opts)
  if (result.hits !== 1) {
    die(`锚点失效：${marker} 应恰好 1 处，实际 ${result.hits} 处（未写入任何文件）`)
  }
  return result.text
}

if (kind === 'package' || kind === 'app') {
  if (VARIANT || SPEC_REL) die('package/app 不接受 --http/--internal/--spec', 2)
  const spec = KIND_SPEC[kind]
  const base = `${spec.targetRoot}/${name}`

  put(`${base}/package.json`, spec.pkgJson)
  put(`${base}/tsconfig.json`, makeTsconfig(spec.tsconfigPreset))
  put(`${base}/tsconfig.build.json`, TSCONFIG_BUILD)
  put(`${base}/vitest.config.ts`, VITEST_CONFIG)
  put(`${base}/src/hello.ts`, makeHello(spec.helloLabel))
  put(`${base}/${spec.entryFile[0]}`, spec.entryFile[1])
  put(`${base}/src/hello.spec.ts`, HELLO_SPEC)

  // 无 bind 烘焙架构的隐藏耦合：workspace.Dockerfile 的 lockgen-base 与 deps
  // 两靶按显式清单 COPY 各包/应用 package.json。未进清单 → lockfile 解析不到
  // （静默）且 deps 靶 --frozen-lockfile 直接断。补丁按整行插入标记行之后。
  const copyLine = `COPY ${base}/package.json ${base}/package.json`
  patches.push({
    file: 'devenv/workspace.Dockerfile',
    apply: (text) => {
      if (hasLine(text, copyLine)) {
        die(`workspace.Dockerfile 已注入过 ${name} 的 manifest COPY 行（幂等保护，未写入任何文件）`)
      }
      const out = []
      let hits = 0
      for (const line of linesOf(text)) {
        out.push(line)
        if (line.trimStart().startsWith('# @gen:pkg-copy')) {
          out.push(copyLine)
          hits++
        }
      }
      if (hits !== 2) {
        die(`workspace.Dockerfile 的 @gen:pkg-copy 标记应恰好 2 处（lockgen-base/deps 两靶各一），实际 ${hits} 处（锚点失效，未写入任何文件）`)
      }
      return { text: out.join('\n'), addedLines: [copyLine, copyLine] }
    },
  })
} else {
  // -------------------------------------------------------------------------
  // nest-module：HTTP 生成完整契约联动；internal 只生成 module/service
  // -------------------------------------------------------------------------
  if (VARIANT !== 'http' && VARIANT !== 'internal') {
    die(`nest-module 需要且只接受一个 --http|--internal（实际：${VARIANT || '(缺)'}）`, 2)
  }
  const loaded = loadSpec()
  specSha = loaded.specSha
  const spec = loaded.spec
  const basePath = loaded.basePath
  const fields = spec.fields
  const root = `apps/api/src/${name}`

  if (VARIANT === 'http') {
    const tpl = httpModuleFiles(fields)
    put(`${root}/${name}.module.ts`, tpl.module)
    put(`${root}/${name}.controller.ts`, tpl.controller)
    put(`${root}/${name}.service.ts`, tpl.service)
    put(`${root}/${name}.controller.spec.ts`, tpl.controllerSpec)
    put(`packages/contracts/src/${name}.ts`, contractFile({ spec, basePath, fields }))
    put(`packages/contracts/src/${name}.spec.ts`, contractSpecFile({ spec, basePath, fields }))
  } else {
    const tpl = internalModuleFiles(fields)
    put(`${root}/${name}.module.ts`, tpl.module)
    put(`${root}/${name}.service.ts`, tpl.service)
    put(`${root}/${name}.service.spec.ts`, tpl.serviceSpec)
  }

  const importLine = `import { ${pascal}Module } from './${name}/${name}.module.js'`
  const entryLine = `    ${pascal}Module,`
  patches.push({
    file: 'apps/api/src/app.module.ts',
    apply: (text) => {
      if (hasLine(text, importLine) || hasLine(text, entryLine)) {
        die(`app.module.ts 已注入过 ${pascal}Module（幂等保护，未写入任何文件）`)
      }
      let next = requireSingleMarker(text, '// @gen:module-import', [importLine])
      next = requireSingleMarker(next, '// @gen:module-entry', [entryLine])
      return { text: next, addedLines: [importLine, entryLine] }
    },
  })

  if (VARIANT === 'http') {
    const exportLine = `export * from './${name}.js'`
    const endpointsImport = `import { ${upper}_ENDPOINTS } from './${name}.js'`
    const spreadLine = `  ...${upper}_ENDPOINTS,`
    patches.push({
      file: 'packages/contracts/src/api-registry.ts',
      apply: (text) => {
        if (hasLine(text, exportLine) || hasLine(text, endpointsImport) || hasLine(text, spreadLine)) {
          die(`api-registry.ts 已注入过 ${name} 的契约（幂等保护，未写入任何文件）`)
        }
        let next = requireSingleMarker(text, '// @gen:endpoint-import', [exportLine, endpointsImport])
        next = requireSingleMarker(next, '// @gen:endpoint-spread', [spreadLine])
        return { text: next, addedLines: [exportLine, endpointsImport, spreadLine] }
      },
    })
  }
}

// ---------------------------------------------------------------------------
// 预检（全部在写盘前）：目标不存在 + 补丁基准可读 + JSON 自检
// ---------------------------------------------------------------------------
for (const rel of files.keys()) {
  if (fs.existsSync(src(rel))) {
    die(`目标已存在：${rel}（幂等保护，未写入任何文件；先删除再生成）`)
  }
}
// 目标目录也必须不存在（避免只检查文件漏掉空目录/遗留文件）
const targetRoots =
  kind === 'nest-module' ? [`apps/api/src/${name}`] : [`${KIND_SPEC[kind].targetRoot}/${name}`]
for (const root of targetRoots) {
  if (fs.existsSync(src(root))) {
    die(`目标已存在：${root}/（幂等保护，未写入任何文件；先删除再生成）`)
  }
}
for (const [rel, { content }] of files) {
  if (rel.endsWith('.json')) {
    try {
      JSON.parse(content)
    } catch (e) {
      die(`生成物 JSON 自检失败：${rel}（${e.message}；未写入任何文件）`)
    }
  }
}

const patched = new Map()
for (const { file, apply } of patches) {
  const abs = src(file)
  if (!fs.existsSync(abs)) die(`待补丁文件缺失（输入 tar 未含）：${file}（未写入任何文件）`)
  patched.set(file, apply(fs.readFileSync(abs, 'utf8')))
}

// ---------------------------------------------------------------------------
// 写盘（输出目录；宿主随后事务式落盘）+ manifest
// ---------------------------------------------------------------------------
fs.rmSync(OUTPUT, { recursive: true, force: true })
fs.mkdirSync(OUTPUT, { recursive: true })

const manifest = {
  kind,
  name,
  variant: kind === 'nest-module' ? VARIANT : '',
  manifestVersion: 2,
  spec: kind === 'nest-module' ? { path: SPEC_REL, sha256: specSha } : null,
  files: [],
  patches: [],
}

for (const [rel, { content, mode }] of files) {
  const abs = path.join(OUTPUT, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content, { mode })
  manifest.files.push({ path: rel, sha256: sha256(Buffer.from(content)), mode: mode.toString(8) })
  note(`+ ${rel}`)
}
for (const [file, result] of patched) {
  const abs = path.join(OUTPUT, file)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, result.text)
  const base = fs.readFileSync(src(file))
  manifest.patches.push({
    path: file,
    baseSha256: sha256(base),
    sha256: sha256(Buffer.from(result.text)),
    addedLines: result.addedLines,
  })
  note(`~ ${file}（补丁，+${result.addedLines.length} 行）`)
}

fs.writeFileSync(path.join(OUTPUT, MANIFEST_NAME), JSON.stringify(manifest, null, 2) + '\n')
note(`完成：${manifest.files.length} 个新文件 + ${manifest.patches.length} 个补丁（输出 channel 为 tar 流）`)