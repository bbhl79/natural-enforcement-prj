#!/usr/bin/env node
// ============================================================================
// 脚手架生成器（#64 package / #65 app / #67 nest-module / #68 page；Spec-工程基座 §5）
//
// 调用形态（容器内）：
//   node /tmp/ne-gen/input/devenv/gen/gen.mjs <kind> <kebab-case-name>
//   环境：NE_GEN_VARIANT=http|internal（nest-module 必填）
//         NE_GEN_CONTRACT=<kebab-case 契约名>（page 必填，默认与 name 同名）
//         NE_GEN_SPEC_REL=<仓库相对路径>（nest-module / page 必填；随输入 tar 传入）
//
// 输入 channel（由 devenv 经 stdin tar 传入，解包到 $NE_GEN_SOURCE）：
//   - 本次调用当前工作树的完整 `devenv/gen/` 集合（生成器自身，零第三方依赖）；
//   - 锚点文件（补丁以宿主当前内容为基准，镜像内没有可静默 fallback 的烘焙副本）：
//       package/app：`devenv/workspace.Dockerfile`；
//       nest-module：`apps/api/src/app.module.ts`（HTTP 另加
//       `packages/contracts/src/api-registry.ts`）与业务 spec 文件；
//       page：`apps/web/src/App.tsx`、契约文件 `packages/contracts/src/<contract>.ts`、
//       `packages/contracts/src/api-registry.ts`、`packages/contracts/src/index.ts` 与业务 spec 文件。
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

const KINDS = ['package', 'app', 'nest-module', 'page']
const SOURCE = process.env.NE_GEN_SOURCE || '/tmp/ne-gen/input'
const OUTPUT = process.env.NE_GEN_OUTPUT || '/tmp/ne-gen/output'
const MANIFEST_NAME = '.ne-gen-manifest.json'
const VARIANT = process.env.NE_GEN_VARIANT || ''
const CONTRACT = process.env.NE_GEN_CONTRACT || ''
const SPEC_REL = process.env.NE_GEN_SPEC_REL || ''

const note = (m) => process.stderr.write(`[gen] ${m}\n`)
const die = (m, code = 4) => {
  process.stderr.write(`[gen] ERROR: ${m}\n`)
  process.exit(code)
}

const [, , kind, name] = process.argv
if (!KINDS.includes(kind)) {
  die(`未知 kind：${kind ?? '(缺)'}（可选：package / app / nest-module / page）`, 2)
}
if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name ?? '')) {
  die(`名称须为 kebab-case（小写字母数字+连字符）：${name ?? '(缺)'}`, 2)
}
if (name.length > 64) die(`名称过长（≤64 字符）：${name}`, 2)

const toPascal = (kebab) => kebab.split('-').map((s) => s[0].toUpperCase() + s.slice(1)).join('')
const toCamel = (kebab) => {
  const p = toPascal(kebab)
  return p[0].toLowerCase() + p.slice(1)
}
const toUpper = (kebab) => kebab.replace(/-/g, '_').toUpperCase()

const src = (...p) => path.join(SOURCE, ...p)
const pascal = toPascal(name)
const camel = toCamel(name)
const upper = toUpper(name)
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
  const allowed = new Set(['type', 'optional', 'label'])
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
  if (def.label !== undefined) {
    if (typeof def.label !== 'string') {
      failSpec(`字段 ${fieldName}.label 必须是非空字符串`)
    }
    const normalized = normalizeLabel(def.label)
    if (normalized.length === 0) {
      failSpec(`字段 ${fieldName}.label 必须是非空字符串`)
    }
    if (normalized.length > 80) {
      failSpec(`字段 ${fieldName}.label 过长（≤80 字符）`)
    }
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
    failSpec(`${kind} 需要 --spec <仓库相对路径>（JSON：fields 非空，可选 title/basePath/description）`)
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
  const allowedTop = new Set(['description', 'basePath', 'title', 'fields'])
  for (const key of Object.keys(spec)) {
    if (!allowedTop.has(key)) failSpec(`spec 顶层含不支持的键 ${key}（允许：description / basePath / title / fields）`)
  }
  if (spec.description !== undefined && typeof spec.description !== 'string') {
    failSpec('spec.description 必须是字符串')
  }
  if (spec.title !== undefined) {
    if (typeof spec.title !== 'string' || spec.title.trim().length === 0) {
      failSpec('spec.title 必须是非空字符串')
    }
    if (spec.title.trim().length > 40) failSpec('spec.title 过长（≤40 字符）')
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
  const seenLabels = new Set()
  for (const [fieldName, def] of Object.entries(spec.fields)) {
    validateField(fieldName, def)
    if (kind !== 'page') continue
    const resolvedLabel = normalizeLabel(def.label ?? fieldName)
    if (seenLabels.has(resolvedLabel)) {
      failSpec(
        `spec.fields 含重复 label（规范化空白后）：${resolvedLabel}（表单标签须唯一以确保可访问性与测试定位）`,
      )
    }
    seenLabels.add(resolvedLabel)
  }
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

function sanitizeLineText(text) {
  let out = text
  for (const code of [0x0a, 0x0d, 0x2028, 0x2029]) {
    out = out.split(String.fromCharCode(code)).join(' ')
  }
  return out.trim()
}

// label 规范化：空白（含换行、制表、NBSP、U+2028/U+2029）折叠为单个空格再 trim。
// 重复 label 必须在规范化之后判定——否则「相同 标签」与「相同\n标签」会通过查重，
// 生成后却变成同一个可见标签，getByLabelText 产生歧义（#68 review 实测）。
const LABEL_WHITESPACE_CODES = [0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0x2028, 0x2029]

function normalizeLabel(text) {
  let out = text
  for (const code of LABEL_WHITESPACE_CODES) {
    out = out.split(String.fromCharCode(code)).join(' ')
  }
  return out.replace(/ +/g, ' ').trim()
}

// 生成 TS/TSX 字符串字面量（JSON.stringify 自动转义双引号、反斜杠与控制字符；
// 配合 JSX 表达式属性 label={...} / title={...}，避免引号/反斜杠/模板字符破坏语法或 DOM 文本）。
const jsStr = (text) => JSON.stringify(sanitizeLineText(text))

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
// page 模板（#68）：自动注册 App.tsx + 消费 @ne/contracts（validated 统一封装）
// + Form React useId 实例唯一 + 多 React 根前缀组件测试 + 页面→API→回显测试
// ---------------------------------------------------------------------------
function verifyPageContract(contract, fields) {
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(contract) || contract.length > 64) {
    failSpec(`--contract 须为 kebab-case（≤64 字符）：${contract || '(缺)'}`)
  }
  const contractRel = `packages/contracts/src/${contract}.ts`
  const contractAbs = src(contractRel)
  if (!fs.existsSync(contractAbs) || !fs.statSync(contractAbs).isFile()) {
    failSpec(
      `缺少契约模块：${contractRel} 不存在（请先运行 devenv gen nest-module ${contract} --http --spec ${SPEC_REL}，或用 --contract 指定已有 HTTP 契约）`,
    )
  }
  const contractText = fs.readFileSync(contractAbs, 'utf8')
  const contractPascal = toPascal(contract)
  const contractUpper = toUpper(contract)
  const requiredExports = [
    `export const ${contractUpper}_ROUTES`,
    `export const Create${contractPascal}Schema`,
    `export const Create${contractPascal}ResultSchema`,
    `export const ${contractPascal}DtoSchema`,
    `export const ${contractPascal}ListResultSchema`,
  ]
  for (const sym of requiredExports) {
    if (!contractText.includes(sym)) {
      failSpec(
        `契约 ${contractRel} 缺少 create/list 导出（${sym}）；page 只能消费带 create/list 端点的 HTTP 契约`,
      )
    }
  }
  const routesBlockRe = new RegExp(
    `export\\s+const\\s+${contractUpper}_ROUTES\\s*=\\s*\\{([\\s\\S]*?)\\}`,
  )
  const routesMatch = routesBlockRe.exec(contractText)
  if (!routesMatch || !/\bcreate\s*:/.test(routesMatch[1]) || !/\blist\s*:/.test(routesMatch[1])) {
    failSpec(`契约 ${contractRel} 的 ${contractUpper}_ROUTES 缺少 create/list 路由常量`)
  }
  // 精确核对 Create<ContractPascal>Schema 的 z.object({...}) 字段集合与 zod 表达式，
  // 防止 spec 漏掉契约必填字段、字段类型/可选性漂移，或误命中文件内其它键名。
  const createSchemaRe = new RegExp(
    `export\\s+const\\s+Create${contractPascal}Schema\\s*=\\s*z\\s*\\.object\\(\\s*\\{([\\s\\S]*?)\\}\\s*\\)`,
  )
  const createSchemaMatch = createSchemaRe.exec(contractText)
  if (!createSchemaMatch) {
    failSpec(`契约 ${contractRel} 的 Create${contractPascal}Schema 不是可核对的 z.object({...}) 声明`)
  }
  const contractFields = new Map()
  for (const rawLine of createSchemaMatch[1].split('\n')) {
    const trimmed = rawLine.trim()
    if (!trimmed || trimmed.startsWith('//')) continue
    const m = /^([a-z][A-Za-z0-9]*)\s*:\s*(.+?)\s*,?$/.exec(trimmed)
    if (!m) {
      failSpec(`契约 ${contractRel} 的 Create${contractPascal}Schema 含无法解析的字段行：${trimmed}`)
    }
    contractFields.set(m[1], m[2].replace(/\s+/g, ''))
  }
  if (contractFields.size === 0) {
    failSpec(`契约 ${contractRel} 的 Create${contractPascal}Schema 字段集合为空`)
  }
  for (const [fieldName, def] of Object.entries(fields)) {
    if (!contractFields.has(fieldName)) {
      failSpec(`spec 字段 ${fieldName} 未在契约 ${contractRel} 的 Create${contractPascal}Schema 中声明`)
    }
    const expectedExpr = zodExpr(def).replace(/\s+/g, '')
    const actualExpr = contractFields.get(fieldName)
    if (actualExpr !== expectedExpr) {
      failSpec(
        `spec 字段 ${fieldName} 与契约 ${contractRel} 定义不一致（期望 ${expectedExpr}，契约为 ${actualExpr}）`,
      )
    }
  }
  for (const contractField of contractFields.keys()) {
    if (!Object.prototype.hasOwnProperty.call(fields, contractField)) {
      failSpec(
        `spec 缺少契约 ${contractRel} 中 Create${contractPascal}Schema 已声明的字段：${contractField}`,
      )
    }
  }
  const registryRel = 'packages/contracts/src/api-registry.ts'
  const registryAbs = src(registryRel)
  if (!fs.existsSync(registryAbs)) {
    failSpec(`缺少契约注册表：${registryRel}（page 的 vite 代理由 API_CONTRACT_ENDPOINTS 派生）`)
  }
  const registryText = fs.readFileSync(registryAbs, 'utf8')
  const indexText = fs.existsSync(src('packages/contracts/src/index.ts'))
    ? fs.readFileSync(src('packages/contracts/src/index.ts'), 'utf8')
    : ''
  const reexportLine = `export * from './${contract}.js'`
  if (!hasTrimmedLine(registryText, reexportLine) && !hasTrimmedLine(indexText, reexportLine)) {
    failSpec(`契约 ${contractRel} 未从 @ne/contracts 导出（缺少 ${reexportLine}）`)
  }
  // page 运行期经同源 vite preview 代理访问 API，代理路由直接取自 API_CONTRACT_ENDPOINTS。
  // 契约仅从 index.ts 再导出、未登记端点时，页面虽能通过类型检查，真实请求却没有代理
  // 路由（#68 review 实测）。因此要求契约端点已整行导入并展开进 API_CONTRACT_ENDPOINTS。
  const endpointsImport = `import { ${contractUpper}_ENDPOINTS } from './${contract}.js'`
  const endpointsSpread = `...${contractUpper}_ENDPOINTS,`
  if (!hasTrimmedLine(registryText, endpointsImport) || !hasTrimmedLine(registryText, endpointsSpread)) {
    failSpec(
      `契约 ${contractRel} 未登记到 API_CONTRACT_ENDPOINTS（${registryRel} 需含整行 ${endpointsImport} 与 ${endpointsSpread}）；page 的 vite 代理由端点清单派生，未登记则真实 API 不可达`,
    )
  }
  return { contractPascal, contractUpper }
}

function pageFiles({ spec, contract, contractPascal, contractUpper, fields }) {
  const entries = Object.entries(fields)
  const rawLabel = (fieldName, def) => normalizeLabel(def.label ?? fieldName)
  const rawCardTitle = normalizeLabel(spec.title ?? spec.description ?? pascal)
  const hint = safeComment(spec.description ?? `${name}（消费 @ne/contracts ${contract}）`)

  const hasString = entries.some(([, def]) => def.type === 'string')
  const hasNumber = entries.some(([, def]) => def.type === 'integer' || def.type === 'number')
  const hasBoolean = entries.some(([, def]) => def.type === 'boolean')

  const antdImports = ['Alert', 'Button', 'Form']
  if (hasString) antdImports.push('Input')
  if (hasNumber) antdImports.push('InputNumber')
  if (hasBoolean) antdImports.push('Switch')

  const requiredBooleans = entries.filter(([, def]) => def.type === 'boolean' && !def.optional)
  const initialValuesDecl =
    requiredBooleans.length > 0
      ? `\nconst INITIAL_VALUES: Partial<FormDraft> = {\n${requiredBooleans
          .map(([fieldName]) => `  ${fieldName}: false,`)
          .join('\n')}\n}\n`
      : ''

  const draftLines = entries
    .map(([fieldName, def]) => {
      if (def.type === 'string') return `  ${fieldName}?: string`
      if (def.type === 'boolean') return `  ${fieldName}?: boolean`
      return `  ${fieldName}?: number | null`
    })
    .join('\n')

  const payloadBuildLines = entries
    .map(([fieldName, def]) => {
      if (def.type === 'string') {
        return def.optional
          ? `    if (typeof raw.${fieldName} === 'string' && raw.${fieldName}.length > 0) payload.${fieldName} = raw.${fieldName}`
          : // 契约 z.string()（无 minLength / minLength=0，如 maxLength:0）接受空串但拒绝
            // undefined；未触碰的输入框不得被序列化成 undefined（#68 review 实测）。
            `    payload.${fieldName} = typeof raw.${fieldName} === 'string' ? raw.${fieldName} : ''`
      }
      if (def.type === 'boolean') {
        return def.optional
          ? `    if (typeof raw.${fieldName} === 'boolean') payload.${fieldName} = raw.${fieldName}`
          : `    payload.${fieldName} = Boolean(raw.${fieldName})`
      }
      return def.optional
        ? `    if (typeof raw.${fieldName} === 'number') payload.${fieldName} = raw.${fieldName}`
        : `    payload.${fieldName} = raw.${fieldName}`
    })
    .join('\n')

  const formItems = entries
    .map(([fieldName, def]) => {
      const label = rawLabel(fieldName, def)
      const labelExpr = jsStr(label)
      if (def.type === 'boolean') {
        return `      <Form.Item name="${fieldName}" label={${labelExpr}} valuePropName="checked">\n        <Switch />\n      </Form.Item>`
      }
      const rules = []
      // UI 规则必须与 zod 语义一致：字符串未声明 minLength（或 minLength=0）时
      // z.string() 接受空串，Ant Design 的 required 却把空串当缺失——加了就永远无法提交
      // （maxLength: 0 的合法契约即典型；#68 review 实测）。仅当必填且 minLength>0 才加
      // required；可选字段的空值由 payload 构建器省略，长度规则对空值放行。
      if (!def.optional) {
        if (def.type !== 'string' || (def.minLength ?? 0) > 0) {
          rules.push(
            def.type === 'string'
              ? `{ required: true, message: ${jsStr(`请输入${label}`)} }`
              : `{ required: true, type: 'number', message: ${jsStr(`请输入${label}`)} }`,
          )
        }
      }
      if (def.type === 'string') {
        if (def.minLength !== undefined && def.minLength > 0) {
          if (def.optional) {
            rules.push(
              `{ validator: (_, value) => (value === undefined || value === '' || String(value).length >= ${def.minLength} ? Promise.resolve() : Promise.reject(new Error(${jsStr(`至少 ${def.minLength} 个字符`)}))) }`,
            )
          } else {
            rules.push(`{ min: ${def.minLength}, message: ${jsStr(`至少 ${def.minLength} 个字符`)} }`)
          }
        }
        if (def.maxLength !== undefined) rules.push(`{ max: ${def.maxLength}, message: ${jsStr(`最多 ${def.maxLength} 个字符`)} }`)
      } else {
        if (def.minimum !== undefined) rules.push(`{ type: 'number', min: ${def.minimum}, message: ${jsStr(`最小为 ${def.minimum}`)} }`)
        if (def.maximum !== undefined) rules.push(`{ type: 'number', max: ${def.maximum}, message: ${jsStr(`最大为 ${def.maximum}`)} }`)
      }
      const rulesAttr = rules.length > 0 ? ` rules={[${rules.join(', ')}]}` : ''
      if (def.type === 'string') {
        return `      <Form.Item name="${fieldName}" label={${labelExpr}}${rulesAttr}>\n        <Input />\n      </Form.Item>`
      }
      const numProps = []
      if (def.type === 'integer') {
        numProps.push('precision={0}', 'step={1}')
      }
      if (def.minimum !== undefined) numProps.push(`min={${def.minimum}}`)
      if (def.maximum !== undefined) numProps.push(`max={${def.maximum}}`)
      numProps.push("style={{ width: '100%' }}")
      return `      <Form.Item name="${fieldName}" label={${labelExpr}}${rulesAttr}>\n        <InputNumber ${numProps.join(' ')} />\n      </Form.Item>`
    })
    .join('\n')

  const tableColumns = [
    `  { title: 'ID', dataIndex: 'id', key: 'id', width: 80 },`,
    ...entries.map(([fieldName, def]) => {
      const labelExpr = jsStr(rawLabel(fieldName, def))
      if (def.type === 'boolean') {
        return `  {\n    title: ${labelExpr},\n    dataIndex: '${fieldName}',\n    key: '${fieldName}',\n    render: (value: boolean | undefined) => (value === undefined ? '—' : value ? '是' : '否'),\n  },`
      }
      if (def.optional) {
        return `  {\n    title: ${labelExpr},\n    dataIndex: '${fieldName}',\n    key: '${fieldName}',\n    render: (value: string | number | undefined) => (value === undefined ? '—' : String(value)),\n  },`
      }
      return `  { title: ${labelExpr}, dataIndex: '${fieldName}', key: '${fieldName}' },`
    }),
    `  { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt' },`,
  ].join('\n')

  const sample = sampleObject(fields)
  const expectedLabelsLiteral = JSON.stringify(entries.map(([fieldName, def]) => rawLabel(fieldName, def)))
  const fillSteps = entries
    .map(([fieldName, def]) => {
      const labelExpr = jsStr(rawLabel(fieldName, def))
      const val = sample[fieldName]
      if (def.type === 'boolean') {
        return val
          ? `    fireEvent.click(within(form).getByLabelText(${labelExpr}))`
          : `    // ${fieldName} 示例值为 false（初始态即匹配）`
      }
      return `    const input_${fieldName} = within(form).getByLabelText(${labelExpr})\n    fireEvent.change(input_${fieldName}, { target: { value: ${JSON.stringify(String(val))} } })\n    fireEvent.blur(input_${fieldName})`
    })
    .join('\n')

  const echoAssertions = entries
    .map(([fieldName, def], index) => {
      const val = sample[fieldName]
      const expectedText = def.type === 'boolean' ? (val ? '是' : '否') : String(val)
      return `    expect(cells[${index + 1}]).toBe(${JSON.stringify(expectedText)})`
    })
    .join('\n')

  return {
    api: `// ${hint}：前端 RTK Query 端点（devenv gen page 生成；#68）
// 路由常量 + 推断类型来自 @ne/contracts，响应一律经统一校验封装 validated(...)。
import {
  Create${contractPascal}ResultSchema,
  ${contractUpper}_ROUTES,
  ${contractPascal}ListResultSchema,
  type Create${contractPascal}Dto,
  type Create${contractPascal}Result,
  type ${contractPascal}ListResult,
} from '@ne/contracts'
import { neApi } from '../../api.js'
import { validated } from '../../lib/validate.js'

const CONTRACT_TAG = '${contractPascal}' as const

// 端点名带 Page 后缀，避免与基础 api.ts 的 createPoint/nearby/health 命名冲突
export const ${camel}Api = neApi
  .enhanceEndpoints({ addTagTypes: [CONTRACT_TAG] })
  .injectEndpoints({
    endpoints: (b) => ({
      list${pascal}Page: b.query<${contractPascal}ListResult, void>({
        query: () => ${contractUpper}_ROUTES.list,
        transformResponse: validated(${contractPascal}ListResultSchema),
        providesTags: [CONTRACT_TAG],
      }),
      create${pascal}Page: b.mutation<Create${contractPascal}Result, Create${contractPascal}Dto>({
        query: (body) => ({
          url: ${contractUpper}_ROUTES.create,
          method: 'POST',
          body,
        }),
        transformResponse: validated(Create${contractPascal}ResultSchema),
        invalidatesTags: [CONTRACT_TAG],
      }),
    }),
  })

export const { useList${pascal}PageQuery, useCreate${pascal}PageMutation } = ${camel}Api
`,
    form: `// ${hint}：可复用表单组件（devenv gen page 生成；#68）
// 使用 React useId 为 Ant Design Form 提供实例级唯一 name/id；配合 createWebRoot 的
// identifierPrefix，在同页重复表单与多 React 根场景下均保证 DOM id 唯一与 label 关联正确。
import { useId, useState } from 'react'
import { ${antdImports.join(', ')} } from 'antd'
import { Create${contractPascal}Schema, type Create${contractPascal}Dto } from '@ne/contracts'

interface FormDraft {
${draftLines}
}
${initialValuesDecl}
export interface ${pascal}FormProps {
  /** 返回 false 表示提交失败（保留用户输入）；返回 true/void 表示成功并清空表单 */
  onSubmit: (values: Create${contractPascal}Dto) => Promise<boolean | void> | boolean | void
  submitting?: boolean
}

export default function ${pascal}Form({ onSubmit, submitting = false }: ${pascal}FormProps) {
  const formId = useId()
  const [form] = Form.useForm<FormDraft>()
  const [validationError, setValidationError] = useState<string | null>(null)

  const handleFinish = async (raw: FormDraft): Promise<void> => {
    setValidationError(null)
    const payload: Record<string, unknown> = {}
${payloadBuildLines}
    const parsed = Create${contractPascal}Schema.safeParse(payload)
    if (!parsed.success) {
      setValidationError(parsed.error.issues.map((i) => i.message).join('；'))
      return
    }
    const result = await onSubmit(parsed.data)
    if (result !== false) {
      form.resetFields()
    }
  }

  return (
    <Form
      form={form}
      name={formId}
      layout="vertical"${requiredBooleans.length > 0 ? '\n      initialValues={INITIAL_VALUES}' : ''}
      onFinish={handleFinish}
    >
      {validationError && <Alert type="error" showIcon title={validationError} className="mb-4" />}
${formItems}
      <Form.Item>
        <Button type="primary" htmlType="submit" loading={submitting}>
          提交记录
        </Button>
      </Form.Item>
    </Form>
  )
}
`,
    page: `// ${hint}：自动注册页面（devenv gen page 生成；#68）
// 通过 RTK Query + validated(...) 消费 @ne/contracts 契约路由与推断类型，提交后自动刷新列表回显。
import { useState } from 'react'
import { Alert, Card, Flex, Table } from 'antd'
import type { TableProps } from 'antd'
import type { Create${contractPascal}Dto, ${contractPascal}Dto } from '@ne/contracts'
import { useCreate${pascal}PageMutation, useList${pascal}PageQuery } from './${name}.api.js'
import ${pascal}Form from './${pascal}Form.js'

const COLUMNS: NonNullable<TableProps<${contractPascal}Dto>['columns']> = [
${tableColumns}
]

function formatApiError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'object' && err !== null) {
    const rec = err as Record<string, unknown>
    if (typeof rec.message === 'string' && rec.message.length > 0) return rec.message
    if ('status' in rec) return \`请求失败（\${String(rec.status)}）：\${JSON.stringify(rec.data ?? rec)}\`
  }
  return String(err)
}

export default function ${pascal}Page() {
  const [submitError, setSubmitError] = useState<string | null>(null)
  const { data, isFetching, error: listError } = useList${pascal}PageQuery()
  const [createItem, { isLoading: isCreating }] = useCreate${pascal}PageMutation()

  const handleSubmit = async (values: Create${contractPascal}Dto): Promise<boolean> => {
    setSubmitError(null)
    try {
      await createItem(values).unwrap()
      return true
    } catch (err) {
      setSubmitError(formatApiError(err))
      return false
    }
  }

  const errorMessage = submitError ?? (listError ? formatApiError(listError) : null)

  return (
    <Flex vertical gap={16}>
      <Card size="small" title={${jsStr(`${rawCardTitle} · 新增`)}}>
        <${pascal}Form onSubmit={handleSubmit} submitting={isCreating} />
      </Card>

      {errorMessage && <Alert type="error" showIcon title={errorMessage} />}

      <Card
        size="small"
        data-list-loaded={!isFetching && data !== undefined ? 'true' : 'false'}
        title={${jsStr(`${rawCardTitle} · 列表（`)} + String(data?.items.length ?? 0) + ' 条）'}
      >
        <Table<${contractPascal}Dto>
          rowKey="id"
          size="small"
          pagination={false}
          loading={isFetching}
          dataSource={data?.items ?? []}
          columns={COLUMNS}
        />
      </Card>
    </Flex>
  )
}
`,
    spec: `// ${hint}：生成页面组件测试（devenv gen page 生成；#68）
// 覆盖：同页双相同 Form / 多 React 根前缀（真实 DOM id 唯一 + label 关联）+
// 页面 → API → 数据回显 + 统一响应校验封装失配拒绝。
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import {
  Create${contractPascal}Schema,
  ${contractUpper}_ROUTES,
  type ${contractPascal}Dto,
} from '@ne/contracts'
import App from '../../App.js'
import { setApiBaseUrlOverride } from '../../api.js'
import { createWebRoot, WebProviders, type WebRootHandle } from '../../lib/root.js'
import { createAppStore } from '../../store.js'
import { assertFormIdsAndLabels, collectDomIds } from '../../../test/form-assertions.js'
import ${pascal}Form from './${pascal}Form.js'
import ${pascal}Page from './${pascal}Page.js'

const LIVE_WEB_URL = (import.meta.env as Record<string, string | undefined>).VITE_LIVE_WEB_URL
const EXPECTED_LABELS = ${expectedLabelsLiteral} as const
const SAMPLE_INPUT = ${sampleLiteral(sample)}
const mountedRoots: Array<{ root: WebRootHandle; host: HTMLDivElement }> = []

afterEach(() => {
  for (const item of mountedRoots.splice(0)) {
    act(() => {
      item.root.unmount()
    })
    item.host.remove()
  }
  setApiBaseUrlOverride(undefined)
  window.history.replaceState({}, '', '/')
  vi.restoreAllMocks()
  cleanup()
})

describe('${pascal}Page（生成物）', () => {
  it('同页渲染两个相同 ${pascal}Form：DOM id 唯一且 label 正确关联各自控件', () => {
    const { container } = render(
      <WebProviders store={createAppStore()}>
        <${pascal}Form onSubmit={vi.fn()} />
        <${pascal}Form onSubmit={vi.fn()} />
      </WebProviders>,
    )

    const forms = Array.from(container.querySelectorAll<HTMLFormElement>('form'))
    expect(forms).toHaveLength(2)
    assertFormIdsAndLabels(forms, EXPECTED_LABELS)
  })

  it('多 React 根（identifierPrefix）：跨根 DOM id 带根级前缀且全局唯一、无串扰', () => {
    const hostA = document.createElement('div')
    const hostB = document.createElement('div')
    document.body.append(hostA, hostB)

    const rootA = createWebRoot(hostA, { identifierPrefix: 'root-a-', store: createAppStore() })
    const rootB = createWebRoot(hostB, { identifierPrefix: 'root-b-', store: createAppStore() })
    mountedRoots.push({ root: rootA, host: hostA }, { root: rootB, host: hostB })

    act(() => {
      rootA.render(<${pascal}Form onSubmit={vi.fn()} />)
      rootB.render(<${pascal}Form onSubmit={vi.fn()} />)
    })

    const formA = hostA.querySelector<HTMLFormElement>('form')!
    const formB = hostB.querySelector<HTMLFormElement>('form')!
    expect([formA.id, ...collectDomIds(formA)].every((id) => id.includes('root-a-'))).toBe(true)
    expect([formB.id, ...collectDomIds(formB)].every((id) => id.includes('root-b-'))).toBe(true)
    assertFormIdsAndLabels([formA, formB], EXPECTED_LABELS)
  })

  it('页面 → API → 数据回显：提交表单命中契约路由并经统一校验封装渲染回显', async () => {
    const items: ${contractPascal}Dto[] = []
    const posted: unknown[] = []

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const req = input instanceof Request ? input : new Request(String(input), init)
      const pathname = new URL(req.url).pathname
      const method = req.method.toUpperCase()

      if (method === 'GET' && pathname === ${contractUpper}_ROUTES.list) {
        return new Response(JSON.stringify({ items }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (method === 'POST' && pathname === ${contractUpper}_ROUTES.create) {
        const body = Create${contractPascal}Schema.parse(JSON.parse(await req.text()))
        posted.push(body)
        const id = items.length + 1
        items.push({ ...body, id, createdAt: '2026-11-28T00:00:00.000Z' })
        return new Response(JSON.stringify({ id }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ message: 'Not Found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })
    })

    const { container } = render(
      <WebProviders store={createAppStore()}>
        <${pascal}Page />
      </WebProviders>,
    )

    const form = container.querySelector<HTMLFormElement>('form')!
${fillSteps}
    fireEvent.click(within(form).getByRole('button', { name: '提交记录' }))

    await waitFor(() => {
      expect(posted).toEqual([SAMPLE_INPUT])
      expect(container.querySelector('tr[data-row-key="1"]')).not.toBeNull()
    })

    const row = container.querySelector<HTMLElement>('tr[data-row-key="1"]')!
    const cells = Array.from(row.querySelectorAll('td')).map((td) => td.textContent)
    expect(cells[0]).toBe('1')
${echoAssertions}
  })

  it('统一响应校验封装（validated）：响应契约失配即刻暴露错误而非静默渲染', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify({ items: 'not-an-array' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    const { container } = render(
      <WebProviders store={createAppStore()}>
        <${pascal}Page />
      </WebProviders>,
    )

    await waitFor(() => {
      expect(container.querySelector('[role="alert"]')).not.toBeNull()
    })
    expect(container.querySelector('tr[data-row-key]')).toBeNull()
  })

  it.skipIf(!LIVE_WEB_URL)(
    '真实栈 UI 旅程（App 自动注册标签 → web proxy → 真实 API → 数据回显）',
    async () => {
      setApiBaseUrlOverride(LIVE_WEB_URL)
      window.history.replaceState({}, '', '/?tab=${name}')
      const host = document.createElement('div')
      document.body.append(host)
      const root = createWebRoot(host, {
        identifierPrefix: 'live-journey-',
        store: createAppStore(),
      })
      mountedRoots.push({ root, host })

      act(() => {
        root.render(<App />)
      })

      // 等待 /health 与初始列表 GET 均落定，避免非空库场景下读取 beforeMaxId 竞态
      await waitFor(
        () => {
          expect(within(host).getByText('api 在线')).toBeInTheDocument()
          expect(host.querySelector('[data-list-loaded="true"]')).not.toBeNull()
          expect(host.querySelector('form')).not.toBeNull()
        },
        { timeout: 10_000 },
      )

      const form = host.querySelector<HTMLFormElement>('form')!
      expect(form.id).toContain('live-journey-')
      const beforeMaxId = Math.max(
        0,
        ...Array.from(host.querySelectorAll<HTMLElement>('tr[data-row-key]')).map((r) =>
          Number(r.dataset.rowKey ?? 0),
        ),
      )
${fillSteps}
      fireEvent.click(within(form).getByRole('button', { name: '提交记录' }))

      await waitFor(
        () => {
          const rows = Array.from(host.querySelectorAll<HTMLElement>('tr[data-row-key]'))
          expect(rows.some((r) => Number(r.dataset.rowKey ?? 0) > beforeMaxId)).toBe(true)
        },
        { timeout: 10_000 },
      )

      const createdRow = Array.from(host.querySelectorAll<HTMLElement>('tr[data-row-key]')).find(
        (r) => Number(r.dataset.rowKey ?? 0) > beforeMaxId,
      )!
      const cells = Array.from(createdRow.querySelectorAll('td')).map((td) => td.textContent)
      expect(Number(cells[0])).toBeGreaterThan(beforeMaxId)
${echoAssertions}
    },
    15_000,
  )
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
/** nest-module / page 的 spec 内容哈希（写入 manifest，供宿主与输入快照比对） */
let specSha = ''
/** page 消费的契约模块名（写入 manifest，供宿主核对） */
let effectiveContract = ''

const put = (rel, content, mode = 0o644) => files.set(rel, { content, mode })

function linesOf(text) {
  return text.split('\n')
}

function hasLine(text, line) {
  return linesOf(text).includes(line)
}

// 去首尾空白后判定整行（与宿主 gen_has_line 同口径：契约注册表允许不同缩进）。
function hasTrimmedLine(text, line) {
  const want = line.trim()
  return linesOf(text).some((candidate) => candidate.trim() === want)
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
  if (VARIANT || SPEC_REL || CONTRACT) die('package/app 不接受 --http/--internal/--spec/--contract', 2)
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
} else if (kind === 'nest-module') {
  // -------------------------------------------------------------------------
  // nest-module：HTTP 生成完整契约联动；internal 只生成 module/service
  // -------------------------------------------------------------------------
  if (CONTRACT) die('nest-module 不接受 --contract（仅 page 使用）', 2)
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
} else {
  // -------------------------------------------------------------------------
  // page：消费 @ne/contracts（RTK Query + validated）+ useId 表单 + 自动注册 App.tsx
  // -------------------------------------------------------------------------
  if (VARIANT) die('page 不接受 --http/--internal（仅 nest-module 使用）', 2)
  const loaded = loadSpec()
  specSha = loaded.specSha
  const spec = loaded.spec
  const fields = spec.fields
  effectiveContract = CONTRACT || name
  const { contractPascal, contractUpper } = verifyPageContract(effectiveContract, fields)

  const root = `apps/web/src/pages/${name}`
  const tpl = pageFiles({ spec, contract: effectiveContract, contractPascal, contractUpper, fields })
  put(`${root}/${name}.api.ts`, tpl.api)
  put(`${root}/${pascal}Form.tsx`, tpl.form)
  put(`${root}/${pascal}Page.tsx`, tpl.page)
  put(`${root}/${pascal}Page.spec.tsx`, tpl.spec)

  const tabLabelExpr = jsStr(spec.title ?? pascal)
  const importLine = `import ${pascal}Page from './pages/${name}/${pascal}Page.js'`
  const itemLine = `    { key: '${name}', label: ${tabLabelExpr}, children: <${pascal}Page /> },`
  patches.push({
    file: 'apps/web/src/App.tsx',
    apply: (text) => {
      if (hasLine(text, importLine) || text.includes(`key: '${name}',`)) {
        die(`App.tsx 已注入过 ${pascal}Page（幂等保护，未写入任何文件）`)
      }
      let next = requireSingleMarker(text, '// @gen:page-import', [importLine])
      next = requireSingleMarker(next, '// @gen:page-item', [itemLine])
      return { text: next, addedLines: [importLine, itemLine] }
    },
  })
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
  kind === 'nest-module'
    ? [`apps/api/src/${name}`]
    : kind === 'page'
      ? [`apps/web/src/pages/${name}`]
      : [`${KIND_SPEC[kind].targetRoot}/${name}`]
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
  contract: kind === 'page' ? effectiveContract : '',
  manifestVersion: 2,
  spec: kind === 'nest-module' || kind === 'page' ? { path: SPEC_REL, sha256: specSha } : null,
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