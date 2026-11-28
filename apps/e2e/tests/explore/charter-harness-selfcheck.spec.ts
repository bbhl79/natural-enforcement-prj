// 探索轨道失败语义自检（#70 AC5）：默认 skipped；验收演练设 E2E_FORCE_FINDING=1
// 时故意失败，用于可复现地核对「失败=产出/任务失败 + 先判读再动手」的报告语义，
// 以及产物导出与运行登记册的失败路径。不参与常规探索发现统计。
import { expect, test } from '@playwright/test'

test('探索失败报告语义（验收演练夹具；E2E_FORCE_FINDING=1 时故意失败）', async () => {
  test.skip(process.env.E2E_FORCE_FINDING !== '1', '仅在验收演练时启用（E2E_FORCE_FINDING=1）')
  expect(1 + 1).toBe(3)
})