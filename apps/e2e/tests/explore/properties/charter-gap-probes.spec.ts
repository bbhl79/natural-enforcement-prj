// 非默认 charter 缺口探针（#107）——编码「缺席的业务规则」，是真缺陷素材而非常绿不变量。
//
// 纪律（票面口径）：
// - 默认 skip（E2E_CHARTER_GAPS != 1），不参与默认探索绿跑；仅 charter 会话显式启用。
// - 本票不修 api 规则；探针失败 = 探索产出（exit 4 + 结构化反例），登记/修复归
//   charter 票（#114 认领）与后续修复票（#117 演练素材）。
//
// GAP-PT-NAME-01（DEF-0002 同类 spec 债务）：点位名称应非空白。
//   现状：nameSchema 只有 min(1)/max(200)/regex-NUL，无 trim/nonblank——纯空白名
//   过契约并入库（201）。对照：证据展示名 validateOriginalName 有纯空白拒绝，
//   两模块口径不一致。是否收紧契约属业务决策，不在 e2e 票顺手改。
//
// 已知缺口（无公开 API 探测路径，仅记录不编码）：终态吸收——
//   evidence.repo markReady/markFailed 仅按 id UPDATE、无 WHERE status 守卫，
//   重复/乱序 job 理论上可改写终态（worker 注释明确想避免 failed→ready，靠时序
//   而非守卫）。公开 API 无再触发处理路径，构造重复 job 需队列级访问（charter
//   会话特权面，归 #114）；届时以独立键空间重放验证。
import { expect, test } from '@playwright/test'
import fc from 'fast-check'
import { ENFORCEMENT_POINT_ROUTES } from '@ne/contracts'
import { API_BASE } from '../../common.js'
import { whitespaceNameArb } from './arbitraries.js'
import { runProperty } from './harness.js'

const GZ = { lat: 23.1291, lng: 113.2644 }
const REF = {
  property: 'P0/GAP-PT-NAME-01/point-name-nonblank',
  rule: 'GAP-PT-NAME-01',
  charter: 'point-input-safety',
} as const

test('GAP-PT-NAME-01 点位名称非空白规则（缺席——charter 发现素材，非默认）', async ({ request }, testInfo) => {
  test.skip(process.env.E2E_CHARTER_GAPS !== '1', '非默认缺口探针：仅 charter 会话启用（E2E_CHARTER_GAPS=1）')
  await runProperty(
    testInfo,
    REF,
    fc.asyncProperty(whitespaceNameArb, async (name) => {
      const res = await request.post(`${API_BASE}${ENFORCEMENT_POINT_ROUTES.base}`, {
        data: { name, lat: GZ.lat, lng: GZ.lng },
      })
      expect(res.status(), '纯空白名称应被契约拒绝（规则缺席：当前 201 入库）').toBe(400)
    }),
    {
      numRuns: 10,
      requestOf: (counterexample) => {
        const [name] = counterexample as [string]
        return { method: 'post', path: ENFORCEMENT_POINT_ROUTES.base, body: { name, lat: GZ.lat, lng: GZ.lng } }
      },
    },
  )
})