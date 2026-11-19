// OpenAPI 派生（#9 决议：@nestjs/swagger 12 从 zod Standard Schema 派生——本脚本输出即验证物）
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { createApp } from '../bootstrap.js'

async function main(): Promise<void> {
  const app = await createApp({ logger: false })
  const config = new DocumentBuilder()
    .setTitle('natural-enforcement API')
    .setDescription('工程基座纵切一（PROTOTYPE #11）')
    .setVersion('0.1.0')
    .build()
  const doc = SwaggerModule.createDocument(app, config)
  process.stdout.write(JSON.stringify(doc, null, 2))
  await app.close()
}

void main()
