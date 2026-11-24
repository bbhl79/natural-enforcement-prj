import test from 'node:test'
import assert from 'node:assert/strict'
import { summarize } from './summarize-pnpm.mjs'

const line = (obj) => JSON.stringify({ time: 1, hostname: 'h', pid: 1, level: 'debug', ...obj })

test('冷 store：每个包一条 fetching-progress，按 packageId 去重并累计 size', () => {
  const raw = [
    line({ name: 'pnpm:fetching-progress', status: 'started', packageId: 'is-odd@3.0.1', size: 2774 }),
    line({ name: 'pnpm:progress', status: 'fetched', packageId: 'is-odd@3.0.1' }),
    line({ name: 'pnpm:fetching-progress', status: 'started', packageId: 'is-number@6.0.0', size: 3474 }),
    line({ name: 'pnpm:progress', status: 'fetched', packageId: 'is-number@6.0.0' }),
    line({ name: 'pnpm:progress', status: 'resolved', packageId: 'is-odd@3.0.1' }),
    line({ name: 'pnpm:progress', status: 'imported', method: 'hardlink', to: '/x/is-odd' }),
    line({ name: 'pnpm:progress', status: 'imported', method: 'hardlink', to: '/x/is-number' }),
    line({ name: 'pnpm:execution-time', startedAt: 1000, endedAt: 1500 }),
  ].join('\n')
  const s = summarize(raw)
  assert.equal(s.fetchedPackages, 2)
  assert.equal(s.fetchedBytes, 6248)
  assert.deepEqual(s.fetchedIds, ['is-odd@3.0.1', 'is-number@6.0.0'])
  assert.deepEqual(s.imported, { hardlink: 2 })
  assert.equal(s.resolved, 1)
  assert.equal(s.executionMs, 500)
})

test('热 store：仅 resolved/imported，无 fetching-progress ⇒ fetchedPackages=0', () => {
  const raw = [
    line({ name: 'pnpm:progress', status: 'resolved', packageId: 'is-odd@3.0.1' }),
    line({ name: 'pnpm:progress', status: 'resolved', packageId: 'is-number@6.0.0' }),
    line({ name: 'pnpm:progress', status: 'imported', method: 'hardlink', to: '/x/is-odd' }),
    line({ name: 'pnpm:progress', status: 'imported', method: 'hardlink', to: '/x/is-number' }),
    line({ name: 'pnpm:execution-time', startedAt: 2000, endedAt: 2100 }),
  ].join('\n')
  const s = summarize(raw)
  assert.equal(s.fetchedPackages, 0)
  assert.equal(s.fetchedBytes, 0)
  assert.deepEqual(s.imported, { hardlink: 2 })
})

test('重试同一包只计一次；非 JSON 行只计 parseErrors', () => {
  const raw = [
    'plain text line from pnpm',
    line({ name: 'pnpm:fetching-progress', status: 'started', packageId: 'a@1.0.0', size: 10 }),
    line({ name: 'pnpm:fetching-progress', status: 'started', packageId: 'a@1.0.0', size: 10 }),
    line({ name: 'pnpm:progress', status: 'imported', method: 'copy', to: '/x/a' }),
  ].join('\n')
  const s = summarize(raw)
  assert.equal(s.fetchedPackages, 1)
  assert.equal(s.fetchedBytes, 10)
  assert.equal(s.parseErrors, 1)
  assert.equal(s.events, 3)
  assert.deepEqual(s.imported, { copy: 1 })
})

test('空输入不抛错', () => {
  const s = summarize('')
  assert.equal(s.fetchedPackages, 0)
  assert.equal(s.events, 0)
})