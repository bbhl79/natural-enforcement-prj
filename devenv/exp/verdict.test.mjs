// 接缝 2（SPEC §接缝）：验证器单测，零基础设施。
// 夹具 = 真实 pnpm 12.21.0 --reporter=ndjson 输出（devenv/exp/fixtures/，容器内捕获）。
// 期望值是从夹具用 jq 读出的字面量（独立于被测实现），不是实现逻辑重算。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { summarize } from './summarize-pnpm.mjs'

const fx = (name) => fs.readFileSync(new URL(`./fixtures/${name}.ndjson`, import.meta.url), 'utf8')

test('真实冷安装：下载 2 个包、6248 字节 → verdict=downloaded', () => {
  const s = summarize(fx('cold'))
  assert.equal(s.verdict, 'downloaded')
  assert.equal(s.fetchedPackages, 2)
  assert.equal(s.fetchedBytes, 6248)
})

test('真实热安装：安装完成且零下载 → verdict=zero-download（唯一的“通过”形态）', () => {
  const s = summarize(fx('warm'))
  assert.equal(s.verdict, 'zero-download')
  assert.equal(s.fetchedPackages, 0)
})

test('真实失败安装（ERR_PNPM_NO_OFFLINE_META）：fetchedPackages=0 但绝不能算零下载 → verdict=failed', () => {
  const s = summarize(fx('failed-offline'))
  assert.equal(s.fetchedPackages, 0)
  assert.equal(s.verdict, 'failed')
  assert.deepEqual(s.errors, ['ERR_PNPM_NO_OFFLINE_META'])
})

test('空输入 / 无 pnpm 事件：无证据 → verdict=no-evidence，不是 zero-download', () => {
  assert.equal(summarize('').verdict, 'no-evidence')
  assert.equal(summarize('plain text, not ndjson\n').verdict, 'no-evidence')
})

test('被截断的流（有进度事件但没有 summary/execution-time）→ verdict=incomplete', () => {
  const truncated = fx('warm')
    .split('\n')
    .filter((l) => l && !l.includes('"pnpm:summary"') && !l.includes('"pnpm:execution-time"'))
    .join('\n')
  const s = summarize(truncated)
  assert.equal(s.fetchedPackages, 0)
  assert.equal(s.verdict, 'incomplete')
})
// ---- 切片 2：lifecycle 脚本盲区（#54 实测：@prisma/engines postinstall 178s，下载引擎二进制，
// 不产生 pnpm:fetching-progress）。零下载 + 脚本执行 ≠ 已证明零网络。
test('真实“热 store 但脚本照跑”的流：fetchedPackages=0 且完整无错，但有脚本执行 → verdict=zero-fetch-scripts-ran（不得通过）', () => {
  const s = summarize(fx('warm-scripts'))
  assert.equal(s.fetchedPackages, 0)
  assert.equal(s.verdict, 'zero-fetch-scripts-ran')
  assert.deepEqual(s.lifecycleScripts, [{ dep: 'msgpackr-extract@3.0.7', stage: 'install', exitCode: 0 }])
})

test('真实冷安装含脚本：verdict 仍是 downloaded（有下载时脚本不改变判定），脚本照实列出', () => {
  const s = summarize(fx('cold-lifecycle'))
  assert.equal(s.verdict, 'downloaded')
  assert.deepEqual(s.lifecycleScripts, [{ dep: 'msgpackr-extract@3.0.7', stage: 'install', exitCode: 0 }])
})

test('真实 side-effects 缓存命中的热安装（脚本被缓存跳过）→ 仍是 zero-download，lifecycleScripts 为空', () => {
  const s = summarize(fx('warm-lifecycle'))
  assert.equal(s.verdict, 'zero-download')
  assert.deepEqual(s.lifecycleScripts, [])
})

// ---- 切片 3：CLI 契约。--target deps 构建时 lockgen 阶段也会打印 EVIDENCE 行；
// 取“最后一行”会在 deps 层命中缓存、lockgen 重跑时把 lockgen 的行误当安装证据。
import { spawnSync } from 'node:child_process'

const runCli = (input, ...args) =>
  spawnSync(process.execPath, [new URL('./summarize-pnpm.mjs', import.meta.url).pathname, ...args], {
    input,
    encoding: 'utf8',
  })

test('CLI：带 stage 参数 → 恰好一行 EVIDENCE，JSON 内含 stage 与 verdict', () => {
  const r = runCli(fx('warm'), 'deps')
  assert.equal(r.status, 0)
  const lines = r.stdout.trim().split('\n')
  assert.equal(lines.length, 1)
  assert.ok(lines[0].startsWith('EVIDENCE {'), lines[0])
  const j = JSON.parse(lines[0].slice('EVIDENCE '.length))
  assert.equal(j.stage, 'deps')
  assert.equal(j.verdict, 'zero-download')
})

test('CLI：不带 stage 参数 → 不含 stage 字段（保持旧输出形态）', () => {
  const j = JSON.parse(runCli(fx('cold')).stdout.trim().slice('EVIDENCE '.length))
  assert.equal('stage' in j, false)
  assert.equal(j.verdict, 'downloaded')
})

// ---- 切片 4：证据带 pnpm 自报的起止时刻（epoch ms），供并发构建的区间重叠判定（sharing=locked 是否串行）。
// 期望值是 jq 从夹具 pnpm:execution-time 事件读出的字面量。
test('冷安装证据含 startedAt/endedAt（pnpm 自报）', () => {
  const s = summarize(fx('cold'))
  assert.equal(s.startedAt, 1795532810254)
  assert.equal(s.endedAt, 1795532811366)
  assert.equal(s.executionMs, 1112)
})

test('无 execution-time 的流（失败安装）→ startedAt/endedAt 为 null，不是 0', () => {
  const s = summarize(fx('failed-offline'))
  assert.equal(s.startedAt, null)
  assert.equal(s.endedAt, null)
})
