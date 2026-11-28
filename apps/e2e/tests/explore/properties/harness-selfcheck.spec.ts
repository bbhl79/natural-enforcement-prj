// P0 属性探索 harness 自检（#107）——零基础设施，探索轨道内运行。
// 1) 归因不变量（示例式单测，独立字面量 oracle）：finding 载荷必须无损保留
//    property/rule/charter/seed/counterexample/counterexamplePath/numRuns/numShrinks，
//    JSON 往返无损（results.json 附件 body 是 base64(JSON)，report 机械提取的前提）。
// 2) 故意反例夹具（E2E_FORCE_FINDING=1 时启用，复用 #70 验收演练钩子）：
//    一条必然违反的属性证明「属性违规 → 结构化 counterexample 附件 → 用例失败 →
//    explore exit 4 + 产物路径」全链语义。默认 skip，不参与常规探索发现统计。
import { expect, test } from '@playwright/test'
import fc from 'fast-check'
import {
  PROPERTY_FINDING_ATTACHMENT,
  buildPropertyFinding,
  runProperty,
  type PropertyFindingRequest,
} from './harness.js'

const NUL = String.fromCharCode(0)

test('harness 自检：finding 载荷归因无损（seed/反例/标识 + JSON 往返）', () => {
  const ref = {
    property: 'P0/SELF-01/attribution-payload',
    rule: 'SELF-01',
    charter: 'harness-selfcheck',
  } as const
  const details = {
    seed: 12345,
    counterexample: [{ name: 'a' + NUL + 'b', lat: 23.1291, lng: 113.2644 }],
    counterexamplePath: '0:0:1',
    numRuns: 7,
    numShrinks: 3,
  }
  const finding = buildPropertyFinding(ref, details)
  expect(finding.schemaVersion).toBe(1)
  expect(finding.engine).toBe('fast-check')
  expect(finding.property).toBe('P0/SELF-01/attribution-payload')
  expect(finding.rule).toBe('SELF-01')
  expect(finding.charter).toBe('harness-selfcheck')
  expect(finding.seed).toBe(12345)
  expect(finding.counterexample).toEqual([{ name: 'a' + NUL + 'b', lat: 23.1291, lng: 113.2644 }])
  expect(finding.counterexamplePath).toBe('0:0:1')
  expect(finding.numRuns).toBe(7)
  expect(finding.numShrinks).toBe(3)
  expect(finding.request).toBeUndefined()
  // 附件 body 走 JSON.stringify → base64；往返必须无损（含 NUL 码点）
  expect(JSON.parse(JSON.stringify(finding))).toEqual(finding)

  const request: PropertyFindingRequest = {
    method: 'post',
    path: '/enforcement-points',
    body: { name: 'x', lat: 23.1291, lng: 113.2644 },
  }
  expect(buildPropertyFinding(ref, details, request).request).toEqual(request)
  expect(PROPERTY_FINDING_ATTACHMENT).toBe('property-finding')
})

test('属性失败语义夹具（E2E_FORCE_FINDING=1 故意反例；验收演练专用）', async (_fixtures, testInfo) => {
  test.skip(process.env.E2E_FORCE_FINDING !== '1', '仅在验收演练时启用（E2E_FORCE_FINDING=1）')
  const ref = {
    property: 'P0/FORCE-01/intentional-counterexample',
    rule: 'FORCE-01',
    charter: 'harness-selfcheck',
  } as const
  // 必然违反的整数属性（固定 seed → 可复现的反例与收缩路径）
  await runProperty(
    testInfo,
    ref,
    fc.asyncProperty(fc.integer({ min: -1000, max: 1000 }), async (n) => n === 0),
    { numRuns: 50, seed: 42 },
  )
})