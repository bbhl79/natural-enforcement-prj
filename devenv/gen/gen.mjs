#!/usr/bin/env node
// PROTOTYPE（#12）— 脚手架生成器初版。容器内运行：
//   node devenv/gen/gen.mjs <kind> <name>
//   kind = app | package | nest-module | page
//
// 约定（AI-native）：
//   - stdin  = 宿主锚点文件 tar 流（devenv 打包 devenv/workspace.Dockerfile、apps/api/src/app.module.ts、
//              apps/web/src/App.tsx）——补丁以宿主当前内容为基准，镜像烘焙件可能滞后（#12 实测踩坑）
//   - stdout = tar 流（devenv 侧 `tar -x` 解包落盘——无 bind 架构下容器→宿主的文件回传通道）
//   - stderr = 人读进度；失败非零退出且不输出 tar（全有或全无）
//   - 幂等保护：目标已存在 / 已注入过 → 退出 4，全有或全无（先全部校验再写盘）
//   - 零第三方依赖（node:fs + 系统 tar）
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const WS = '/workspace'
const HOST = '/tmp/host-state' // 宿主锚点文件解包区（补丁基准）
const [, , kind, name] = process.argv

const note = (m) => process.stderr.write(`[gen] ${m}\n`)
const die = (m, code = 2) => {
  process.stderr.write(`[gen] ERROR: ${m}\n`)
  process.exit(code)
}

if (!['app', 'package', 'nest-module', 'page'].includes(kind)) {
  die(`未知 kind：${kind}（app | package | nest-module | page）`)
}
if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name ?? '')) {
  die(`名称须为 kebab-case（小写字母数字+连字符）：${name}`)
}

const pascal = name.split('-').map((s) => s[0].toUpperCase() + s.slice(1)).join('')

// ---------------------------------------------------------------------------
// 模板（内容与 slice-1 手写包逐字对齐：生成物开箱即过 lint/typecheck/test 的关键）
// ---------------------------------------------------------------------------
const PKG_JSON = (scope, extraScripts = '', extraDeps = '') => `{
  "name": "@ne/${name}",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "devenv gen ${kind} 生成（PROTOTYPE #12）",
  "scripts": {
    "build": "tsc -p tsconfig.build.json",${extraScripts}
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:unit": "vitest run src"
  }${extraDeps}
}
`

const TSCONFIG = (base) => `{
  "extends": "@ne/tsconfig/${base}",
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

const HELLO = (title) => `// ${title}
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

const APP_MAIN = `import { hello } from './hello.js'

function main(): void {
  console.log(hello('app'))
}

main()
`

// --- nest-module 模板（对齐 apps/api 手写风格：值导入 + .js 后缀 + ApiTags）---
const NEST_MODULE = `import { Module } from '@nestjs/common'
import { ${pascal}Controller } from './${name}.controller.js'
import { ${pascal}Service } from './${name}.service.js'

@Module({
  controllers: [${pascal}Controller],
  providers: [${pascal}Service],
})
export class ${pascal}Module {}
`

const NEST_CONTROLLER = `import { Controller, Get } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { ${pascal}Service } from './${name}.service.js'

@ApiTags('${name}')
@Controller('/${name}s')
export class ${pascal}Controller {
  constructor(private readonly svc: ${pascal}Service) {}

  @Get()
  async list(): Promise<{ items: string[] }> {
    return this.svc.list()
  }
}
`

const NEST_SERVICE = `import { Injectable } from '@nestjs/common'

@Injectable()
export class ${pascal}Service {
  async list(): Promise<{ items: string[] }> {
    return { items: [] }
  }
}
`

const NEST_SERVICE_SPEC = `import { describe, expect, it } from 'vitest'
import { Test } from '@nestjs/testing'
import { ${pascal}Controller } from './${name}.controller.js'
import { ${pascal}Service } from './${name}.service.js'

describe('${name} module（生成物开箱即测）', () => {
  it('GET /${name}s 经 controller→service 返回', async () => {
    const ref = await Test.createTestingModule({
      controllers: [${pascal}Controller],
      providers: [${pascal}Service],
    }).compile()
    const ctrl = ref.get(${pascal}Controller)
    expect(await ctrl.list()).toEqual({ items: [] })
  })
})
`

// --- page 模板（对齐 apps/web 手写风格）---
const PAGE_TSX = `import { Card } from 'antd'

export default function ${pascal}Page() {
  return (
    <Card size="small" title="${pascal}（devenv gen page 生成）">
      <p>开箱页面：接入真实数据时在此挂 RTK Query hook。</p>
    </Card>
  )
}
`

const PAGE_SPEC = `import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import ${pascal}Page from './${pascal}Page.js'

afterEach(cleanup)

describe('${pascal}Page（生成物开箱即测）', () => {
  it('渲染卡片标题', () => {
    render(<${pascal}Page />)
    expect(screen.getByText('${pascal}（devenv gen page 生成）')).toBeInTheDocument()
  })
})
`

// 行级标记插入：在以 marker 开头的每个注释行之后插入 line（标记行可带尾注；#12 实测：
// 字符串替换会把插入点砸进注释行内部，产出畸形指令——必须按整行处理）
function insertAfterMarkerLines(src, marker, line) {
  const out = []
  let hits = 0
  for (const l of src.split('\n')) {
    out.push(l)
    if (l.trimStart().startsWith(marker)) {
      out.push(line)
      hits++
    }
  }
  return { src: out.join('\n'), hits }
}

// ---------------------------------------------------------------------------
// 文件装配 + 既有文件补丁
// ---------------------------------------------------------------------------
/** @type {Map<string, string>} 新文件（相对路径 → 内容） */
const files = new Map()
/** @type {Array<{file: string, apply: (src: string) => string}>} 既有文件补丁 */
const patches = []

const rel = (...p) => path.join(...p)
const put = (p, content) => files.set(rel(...p.split('/')), content)

if (kind === 'package') {
  put(`packages/${name}/package.json`, PKG_JSON('package', '', `,
  "devDependencies": {
    "@ne/tsconfig": "workspace:*",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }`))
  put(`packages/${name}/tsconfig.json`, TSCONFIG('base.json'))
  put(`packages/${name}/tsconfig.build.json`, TSCONFIG_BUILD)
  put(`packages/${name}/vitest.config.ts`, VITEST_CONFIG)
  put(`packages/${name}/src/hello.ts`, HELLO(`共享包 @ne/${name}：示例纯函数`))
  put(`packages/${name}/src/index.ts`, INDEX_REEXPORT)
  put(`packages/${name}/src/hello.spec.ts`, HELLO_SPEC)
} else if (kind === 'app') {
  put(`apps/${name}/package.json`, PKG_JSON('app', `
    "start": "node dist/main.js",`, `,
  "devDependencies": {
    "@ne/tsconfig": "workspace:*",
    "@types/node": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }`))
  put(`apps/${name}/tsconfig.json`, TSCONFIG('node.json'))
  put(`apps/${name}/tsconfig.build.json`, TSCONFIG_BUILD)
  put(`apps/${name}/vitest.config.ts`, VITEST_CONFIG)
  put(`apps/${name}/src/hello.ts`, HELLO(`应用 @ne/${name}：示例纯函数`))
  put(`apps/${name}/src/main.ts`, APP_MAIN)
  put(`apps/${name}/src/hello.spec.ts`, HELLO_SPEC)
}

if (kind === 'app' || kind === 'package') {
  // 无 bind 烘焙架构的隐藏耦合：workspace.Dockerfile 的 lockgen/deps 靶按显式清单 COPY 各包
  // package.json——新包不进清单则 lockfile 解析不到、deps 靶 --frozen-lockfile 直接断（#12 实测踩坑）。
  // 生成器自动补 COPY 行（两靶各一，@gen:pkg-copy 标记锚定）。
  const dir = kind === 'app' ? 'apps' : 'packages'
  const copyLine = `COPY ${dir}/${name}/package.json ${dir}/${name}/package.json`
  patches.push({
    file: 'devenv/workspace.Dockerfile',
    apply: (src) => {
      if (src.includes(copyLine)) die(`workspace.Dockerfile 已注入过 ${name} 的 COPY 行（幂等保护）`, 4)
      const r = insertAfterMarkerLines(src, '# @gen:pkg-copy', copyLine)
      if (r.hits < 2) die(`workspace.Dockerfile 的 @gen:pkg-copy 标记少于 2 处（lockgen/deps 两靶各一）`, 4)
      return r.src
    },
  })
}

if (kind === 'nest-module') {
  put(`apps/api/src/${name}/${name}.module.ts`, NEST_MODULE)
  put(`apps/api/src/${name}/${name}.controller.ts`, NEST_CONTROLLER)
  put(`apps/api/src/${name}/${name}.service.ts`, NEST_SERVICE)
  put(`apps/api/src/${name}/${name}.service.spec.ts`, NEST_SERVICE_SPEC)
  patches.push({
    file: 'apps/api/src/app.module.ts',
    apply: (src) => {
      const importLine = `import { ${pascal}Module } from './${name}/${name}.module.js'`
      if (src.includes(importLine)) die(`app.module.ts 已注入过 ${pascal}Module（幂等保护）`, 4)
      // 插在最后一个 import 之后
      const lastImport = [...src.matchAll(/^import .*$/gm)].pop()
      if (!lastImport) die('app.module.ts 找不到 import 区（锚点失效）', 4)
      src = src.slice(0, lastImport.index + lastImport[0].length) + '\n' + importLine + src.slice(lastImport.index + lastImport[0].length)
      // 追加进 @Module imports 数组
      if (!/imports: \[/.test(src)) die('app.module.ts 找不到 imports: [ 锚点', 4)
      src = src.replace(/imports: \[/, `imports: [${pascal}Module, `)
      return src
    },
  })
} else if (kind === 'page') {
  put(`apps/web/src/pages/${pascal}/${pascal}Page.tsx`, PAGE_TSX)
  put(`apps/web/src/pages/${pascal}/${pascal}Page.spec.tsx`, PAGE_SPEC)
  patches.push({
    file: 'apps/web/src/App.tsx',
    apply: (src) => {
      const importLine = `import ${pascal}Page from './pages/${pascal}/${pascal}Page.js'`
      const itemLine = `    { key: '${name}', label: '${pascal}', children: <${pascal}Page /> },`
      if (src.includes(importLine)) die(`App.tsx 已注入过 ${pascal}Page（幂等保护）`, 4)
      const imports = insertAfterMarkerLines(src, '// @gen:page-import', importLine)
      if (imports.hits < 1) die('App.tsx 缺少 @gen:page-import 标记（锚点失效）', 4)
      const items = insertAfterMarkerLines(imports.src, '// @gen:page-item', itemLine)
      if (items.hits < 1) die('App.tsx 缺少 @gen:page-item 标记（锚点失效）', 4)
      return items.src
    },
  })
}

// ---------------------------------------------------------------------------
// 宿主锚点文件解包（stdin tar → /tmp/host-state）：补丁基准 = 宿主当前内容
// ---------------------------------------------------------------------------
fs.mkdirSync(HOST, { recursive: true })
const untar = spawnSync('tar', ['-xf', '-', '-C', HOST], { stdio: ['inherit', 'ignore', 'inherit'] })
if (untar.status !== 0) die('宿主锚点 tar 解包失败（stdin）', 4)

// ---------------------------------------------------------------------------
// 校验（全有或全无）：目标不存在 + 生成内容自检 + 补丁锚点可用（基于宿主内容）
// ---------------------------------------------------------------------------
for (const p of files.keys()) {
  if (fs.existsSync(path.join(WS, p)) || fs.existsSync(path.join(HOST, p))) {
    die(`目标已存在：${p}（幂等保护，先删除再生成）`, 4)
  }
}
// 生成内容自检：JSON 必须可解析（#12 实测踩坑——模板拼装双逗号产出畸形 package.json，
// 且静默通过 lockgen 出口污染下游 frozen-lockfile）
for (const [p, content] of files) {
  if (p.endsWith('.json')) {
    try {
      JSON.parse(content)
    } catch (e) {
      die(`生成物 JSON 自检失败：${p}（${e.message}）`, 4)
    }
  }
}
const patched = new Map()
for (const { file, apply } of patches) {
  const abs = path.join(HOST, file)
  if (!fs.existsSync(abs)) die(`待补丁文件缺失（宿主锚点 tar 未含）：${file}`, 4)
  patched.set(file, apply(fs.readFileSync(abs, 'utf8')))
}

// ---------------------------------------------------------------------------
// 落盘 + tar 流输出（stdout）
// ---------------------------------------------------------------------------
for (const [p, content] of files) {
  fs.mkdirSync(path.dirname(path.join(WS, p)), { recursive: true })
  fs.writeFileSync(path.join(WS, p), content)
  note(`+ ${p}`)
}
for (const [file, content] of patched) {
  fs.writeFileSync(path.join(WS, file), content)
  note(`~ ${file}（补丁）`)
}

const tarPaths = [...files.keys(), ...patched.keys()]
const tar = spawnSync('tar', ['-cf', '-', '-C', WS, ...tarPaths], { stdio: ['ignore', 'inherit', 'inherit'] })
if (tar.status !== 0) die(`tar 打包失败（退出码 ${tar.status}）`, 4)
note(`完成：${tarPaths.length} 个文件已输出（tar 流）`)
