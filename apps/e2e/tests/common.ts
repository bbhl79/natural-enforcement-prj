// PROTOTYPE（#13）— e2e 公共装配：隔离参数只经环境变量注入（数据隔离收敛在 devenv 编排层，
// 测试代码零耦合——playwright-e2e.md §2.3 层 1）；测试级数据一律唯一命名免重置（层 3）。
import { randomUUID } from 'node:crypto'

export const API_BASE = process.env.E2E_API_BASE_URL ?? 'http://e2e-api:3000'
export const WEB_BASE = process.env.E2E_WEB_BASE_URL ?? 'http://e2e-web:4173'
export const RUN_ID = process.env.E2E_RUN_ID ?? 'local'

/** 唯一命名（层 3）：断言只匹配自己的后缀，测试天然无序可并行、失败不传染 */
export function uniq(prefix: string): string {
  return `${prefix}-${RUN_ID}-${randomUUID().slice(0, 8)}`
}
