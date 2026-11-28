// OpenAPI 3.0 JSON Schema 派生（单一实现；openapi 完整性检查与契约装饰器共用）。
// zod 是唯一事实源：这里只负责去 `$schema` 等 OpenAPI 不需要的元数据。
import { z, type ZodType } from 'zod'

export function openApiSchemaOf(
  schema: ZodType,
  io: 'input' | 'output' = 'input',
): Record<string, unknown> {
  const raw = z.toJSONSchema(schema, { target: 'openapi-3.0', io }) as Record<string, unknown>
  const rest = { ...raw }
  delete rest['$schema']
  return rest
}
