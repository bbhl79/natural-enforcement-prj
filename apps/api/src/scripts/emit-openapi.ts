// OpenAPI 文档导出脚本（#66）：
// 从当前装配的应用经 @nestjs/swagger 12 StandardSchemaOpenApiConverter 派生 OpenAPI 3.0，
// 导出前强制运行 verifyOpenApiCompleteness（契约端点/请求体/参数/响应任一遗漏即非零退出）。
import { writeFileSync } from 'node:fs'
import { createApp } from '../bootstrap.js'
import { buildOpenApiDocument, verifyOpenApiCompleteness } from '../openapi.js'

async function main(): Promise<void> {
  const outIdx = process.argv.indexOf('--out')
  const outPath = outIdx >= 0 ? process.argv[outIdx + 1] : undefined

  const app = await createApp({ logger: false })
  try {
    const doc = buildOpenApiDocument(app)
    const check = verifyOpenApiCompleteness(doc)
    if (!check.ok) {
      for (const err of check.errors) {
        process.stderr.write(`ERROR: ${err}\n`)
      }
      process.exitCode = 1
      return
    }
    const json = JSON.stringify(doc, null, 2) + '\n'
    if (outPath) {
      writeFileSync(outPath, json, 'utf8')
    } else {
      process.stdout.write(json)
    }
  } finally {
    await app.close()
  }
}

void main()
