// 公开 API 端点契约注册表：API_CONTRACT_ENDPOINTS 的唯一装配点。
// OpenAPI 完整性检查（#66）把产出文档与本清单双向核对，遗漏或未登记端点都会报错。
//
// 生成器（devenv gen nest-module --http，#67）按整行锚点追加生成契约：
//   - `// @gen:endpoint-import` 之后插入 `export * from './<name>.js'` 与
//     生成端点清单 `import { <UPPER>_ENDPOINTS } from './<name>.js'`；
//   - `// @gen:endpoint-spread` 之后插入 `...<UPPER>_ENDPOINTS,`。
// 因此生成端点无需事后手工补注册表，OpenAPI 文档与运行时共享同一契约。
import type { ApiContractEndpoint } from './api-contract.js'
import { ENFORCEMENT_POINT_ENDPOINTS } from './enforcement-point.js'
import { EVIDENCE_ENDPOINTS } from './evidence.js'
// @gen:endpoint-import

export const API_CONTRACT_ENDPOINTS: readonly ApiContractEndpoint[] = [
  ...ENFORCEMENT_POINT_ENDPOINTS,
  ...EVIDENCE_ENDPOINTS,
  // @gen:endpoint-spread
]
