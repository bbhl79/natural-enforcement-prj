import { Logger } from '@nestjs/common'
import { createApp } from './bootstrap.js'

async function main(): Promise<void> {
  const app = await createApp()
  const port = process.env.PORT ?? 3000
  await app.listen(port)
  new Logger('api').log(`listening on ${port}`)
}

// ESM 顶层直跑（node dist/main.js）
void main()
