#!/usr/bin/env node
// ============================================================================
// 脚手架生成器（#64 package / #65 app；Spec-工程基座 §5）
//
// 调用形态（容器内）：
//   node /tmp/ne-gen/input/devenv/gen/gen.mjs <kind> <kebab-case-name>
//
// 输入 channel（由 devenv 经 stdin tar 传入，解包到 $NE_GEN_SOURCE）：
//   - 本次调用当前工作树的完整 `devenv/gen/` 集合（生成器自身，零第三方依赖）；
//   - 锚点文件（package/app 类：`devenv/workspace.Dockerfile`）——补丁以宿主当前内容
//     为基准，镜像内没有可静默 fallback 的烘焙副本。
//
// 输出 channel（devenv 侧 tar 回宿主，先解包到暂存目录再原子落盘）：
//   - 新文件 + 被补丁文件的完整内容；
//   - `.ne-gen-manifest.json`：文件清单 + 每文件 sha256 + 补丁基准 sha256，
//     供宿主核对「传输/生成全有或全无」并做事务式落盘。
//
// 约定：
//   - stderr = 人读进度（从不写 stdout）；
//   - 任何校验失败都在写盘前退出（非零），不产生部分输出；
//   - 目标已存在 / 补丁已注入 → 退出码 4（命令面枚举：任务失败），重复执行无部分写入。
// ============================================================================
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const KINDS = ['package', 'app']
const SOURCE = process.env.NE_GEN_SOURCE || '/tmp/ne-gen/input'
const OUTPUT = process.env.NE_GEN_OUTPUT || '/tmp/ne-gen/output'
const MANIFEST_NAME = '.ne-gen-manifest.json'

const note = (m) => process.stderr.write(`[gen] ${m}\n`)
const die = (m, code = 4) => {
  process.stderr.write(`[gen] ERROR: ${m}\n`)
  process.exit(code)
}

const [, , kind, name] = process.argv
if (!KINDS.includes(kind)) {
  die(`kind 尚未实现：${kind ?? '(缺)'}（已交付 package/app；nest-module/page 归 #67/#68）`, 2)
}
if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name ?? '')) {
  die(`名称须为 kebab-case（小写字母数字+连字符）：${name ?? '(缺)'}`, 2)
}
if (name.length > 64) die(`名称过长（≤64 字符）：${name}`, 2)

const src = (...p) => path.join(SOURCE, ...p)
const pascal = name.split('-').map((s) => s[0].toUpperCase() + s.slice(1)).join('')
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

// ---------------------------------------------------------------------------
// 模板：与仓库既有 packages/* 逐字对齐（开箱即过 lint/typecheck/test 的关键）
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
/** @type {Array<{file: string, apply: (src: string) => string}>} */
const patches = []

const put = (rel, content, mode = 0o644) => files.set(rel, { content, mode })
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
    if (text.split('\n').some((l) => l.trim() === copyLine)) {
      die(`workspace.Dockerfile 已注入过 ${name} 的 manifest COPY 行（幂等保护，未写入任何文件）`)
    }
    const out = []
    let hits = 0
    for (const line of text.split('\n')) {
      out.push(line)
      if (line.trimStart().startsWith('# @gen:pkg-copy')) {
        out.push(copyLine)
        hits++
      }
    }
    if (hits !== 2) {
      die(`workspace.Dockerfile 的 @gen:pkg-copy 标记应恰好 2 处（lockgen-base/deps 两靶各一），实际 ${hits} 处（锚点失效，未写入任何文件）`)
    }
    return out.join('\n')
  },
})

// ---------------------------------------------------------------------------
// 预检（全部在写盘前）：目标不存在 + 补丁基准可读 + JSON 自检
// ---------------------------------------------------------------------------
for (const rel of files.keys()) {
  if (fs.existsSync(src(rel))) {
    die(`目标已存在：${rel}（幂等保护，未写入任何文件；先删除再生成）`)
  }
}
// 目标目录也必须不存在（避免只检查文件漏掉空目录/遗留文件）
if (fs.existsSync(src(spec.targetRoot, name))) {
  die(`目标已存在：${base}/（幂等保护，未写入任何文件；先删除再生成）`)
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
  manifestVersion: 1,
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
for (const [file, content] of patched) {
  const abs = path.join(OUTPUT, file)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
  const base = fs.readFileSync(src(file))
  manifest.patches.push({
    path: file,
    baseSha256: sha256(base),
    sha256: sha256(Buffer.from(content)),
  })
  note(`~ ${file}（补丁）`)
}

fs.writeFileSync(path.join(OUTPUT, MANIFEST_NAME), JSON.stringify(manifest, null, 2) + '\n')
note(`完成：${manifest.files.length} 个新文件 + ${manifest.patches.length} 个补丁（输出 channel 为 tar 流）`)