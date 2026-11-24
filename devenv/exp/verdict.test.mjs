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
