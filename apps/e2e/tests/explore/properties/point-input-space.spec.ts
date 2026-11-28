// P0 业务规则属性（#107）：创建点位契约输入空间全量安全（PT-NAME-01，DEF-0001 同类）。
// 原型直接先例（prototype/e2e-dualtrack charter-create-input-space）：危险字典 prelude +
// fast-check 属性——契约输入不得引发服务器错误（5xx = 未处理异常 = 缺陷；400 是合法拒绝）。
// dev 现状：NUL 已在契约入口拒绝（#66 regex 进 OpenAPI pattern）——本属性编码的是
// 已实现的不变量（契约↔运行时一致），默认绿。
// oracle：契约包导出 schema（zod 唯一事实源，白盒合法）；被测面是 API 运行时行为。
// 名称唯一约束 → 重复名 409 是合法实现行为（生成域内偶发撞名不判红）。
import { expect, test } from '@playwright/test'
import fc from 'fast-check'
import { CreateEnforcementPointSchema, ENFORCEMENT_POINT_ROUTES } from '@ne/contracts'
import { API_BASE } from '../../common.js'
import { runProperty } from './harness.js'

const GZ = { lat: 23.1291, lng: 113.2644 }
const NUL = String.fromCharCode(0)
// 已知危险输入字典（确定性 prelude，证据友好）：NUL/内嵌 NUL/控制符/DEL/孤立代理对
const DANGEROUS_NAMES = [NUL, 'a' + NUL + 'b', String.fromCharCode(0x1f), String.fromCharCode(0x7f), 'a' + String.fromCharCode(0xd83d)]

const REF = {
  property: 'P0/PT-NAME-01/create-point-input-space-no-5xx',
  rule: 'PT-NAME-01',
  charter: 'point-input-safety',
} as const

test('PT-NAME-01 创建点位输入空间：契约判定一致 + 全量无 5xx（DEF-0001 类）', async ({ request }, testInfo) => {
  // 危险字典先行：任何一个引发 5xx 即产出（字典反例，不依赖随机域命中）
  for (const name of DANGEROUS_NAMES) {
    const res = await request.post(`${API_BASE}${ENFORCEMENT_POINT_ROUTES.base}`, {
      data: { name, lat: GZ.lat, lng: GZ.lng },
    })
    expect(res.status(), `字典输入 ${JSON.stringify(name)} 不得引发 5xx`).toBeLessThan(500)
  }

  await runProperty(
    testInfo,
    REF,
    fc.asyncProperty(fc.string({ minLength: 0, maxLength: 250 }), async (name) => {
      const body = { name, lat: GZ.lat, lng: GZ.lng }
      const accepted = CreateEnforcementPointSchema.safeParse(body).success
      const res = await request.post(`${API_BASE}${ENFORCEMENT_POINT_ROUTES.base}`, { data: body })
      expect(res.status(), '契约输入空间的任何输入不得引发服务器错误（5xx）').toBeLessThan(500)
      if (!accepted) {
        // 契约拒绝（NUL/空/超长）必须在入口 400，而不是落库阶段炸 500（DEF-0001 根因面）
        expect(res.status()).toBe(400)
      } else {
        expect([201, 409]).toContain(res.status())
      }
    }),
    {
      numRuns: 30,
      requestOf: (counterexample) => {
        const [name] = counterexample as [string]
        return { method: 'post', path: ENFORCEMENT_POINT_ROUTES.base, body: { name, lat: GZ.lat, lng: GZ.lng } }
      },
    },
  )
})