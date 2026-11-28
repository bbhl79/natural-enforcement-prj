// 探索 charter（#70）：被测 API/worker 本身绑定本 run 资源，而不是测试脚本自己换名字。
// 本文件是 #70 的隔离/服务绑定自检（不是业务探索 charter；业务规则 charter 五要素
// 归 Spec-e2e 后续票）。断言面全部是黑盒：API 写入 → PostGIS 读回（DB 绑定）、上传 →
// 本 run worker 回写 ready（队列前缀 + worker 绑定）、同源下载字节一致。并行演练时用
// 共享组标记互查对方数据。
import { expect, test } from '@playwright/test'
import {
  EVIDENCE_CONTENT_TYPE,
  EVIDENCE_ROUTES,
  encodeOriginalName,
  ENFORCEMENT_POINT_ROUTES,
  ORIGINAL_NAME_HEADER,
  type EvidenceRecordDto,
  type NearbyResult,
} from '@ne/contracts'
import {
  API_BASE,
  PARALLEL_SOAK_MS,
  RUN_ID,
  foreignPointNames,
  pointName,
  sha256Hex,
  waitForEvidenceTerminal,
} from '../common.js'

// 地理背景：广州市中心（项目为广州市自然资源部门开发，种子/测试用广州坐标）
const CENTER = { lat: 23.1291, lng: 113.2644 }

async function nearby(
  request: import('@playwright/test').APIRequestContext,
): Promise<NearbyResult> {
  const params = new URLSearchParams({
    lat: String(CENTER.lat),
    lng: String(CENTER.lng),
    radiusM: '5000',
  })
  const res = await request.get(`${API_BASE}${ENFORCEMENT_POINT_ROUTES.nearby}?${params.toString()}`)
  expect(res.status(), 'nearby 查询应成功（本 run API/DB 可用）').toBe(200)
  return (await res.json()) as NearbyResult
}

test('本 run 的 DB 与队列/worker 绑定：点位读回 + 证据 ready + 同源字节一致', async ({
  request,
}, testInfo) => {
  const name = pointName(testInfo)

  // 1) DB 绑定：写入经 API → PostGIS，读路径必须在本 run 数据库里看到自己的点位。
  const created = await request.post(`${API_BASE}${ENFORCEMENT_POINT_ROUTES.base}`, {
    data: { name, ...CENTER },
  })
  expect(created.status(), '创建点位应 201').toBe(201)

  const first = await nearby(request)
  expect(
    first.points.some((p) => p.name === name),
    '本 run 写入的点位未在本 run 读路径出现（API 未绑定本 run 数据库）',
  ).toBe(true)

  // 2) 队列/worker 绑定：上传后必须由本 run 的 worker 回写 ready；若队列键空间被别的
  //    run 的 worker 消费，别的 worker 只会写它自己的数据库，本记录将永远停在 pending。
  const payload = new TextEncoder().encode(`run-binding-${RUN_ID}-${name}`)
  const uploaded = await request.post(`${API_BASE}${EVIDENCE_ROUTES.base}`, {
    headers: {
      'content-type': EVIDENCE_CONTENT_TYPE,
      [ORIGINAL_NAME_HEADER]: encodeOriginalName(`证据-${RUN_ID}.bin`),
    },
    data: Buffer.from(payload),
  })
  expect(uploaded.status(), '证据上传应 201').toBe(201)
  const record = (await uploaded.json()) as EvidenceRecordDto
  expect(record.status).toBe('pending')

  const terminal = await waitForEvidenceTerminal(request, record.id)
  expect(
    terminal.status,
    '证据未被本 run worker 处理（队列前缀/worker 绑定被破坏或被别的 run 消费）',
  ).toBe('ready')
  expect(terminal.sha256).toBe(sha256Hex(payload))

  // 3) 同源下载：字节与上传一致（对象存储绑定在本 run bucket 上也能经 HTTP 面闭环）。
  const content = await request.get(`${API_BASE}${terminal.contentPath}`)
  expect(content.status()).toBe(200)
  expect(Buffer.from(await content.body()).equals(Buffer.from(payload))).toBe(true)

  // 4) 并行隔离（证据演练窗口）：反复读本 run 的 DB，任何同组其它 run 的点位出现
  //    都说明两个 run 共用了数据库。PARALLEL_SOAK_MS=0 时只做一次快照检查。
  const deadline = Date.now() + PARALLEL_SOAK_MS
  for (;;) {
    const current = await nearby(request)
    const foreign = foreignPointNames(current.points)
    expect(
      foreign,
      `同组其它 run 的点位出现在本 run 读路径（DB 隔离破坏）：${foreign.join(', ')}`,
    ).toEqual([])
    if (Date.now() >= deadline) break
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
})