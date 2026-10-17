import 'reflect-metadata';

import { createApplication } from './persistence.module.ts';

async function bootstrap(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL 未注入');
  const app = await createApplication(databaseUrl);
  await app.listen(3000, '0.0.0.0');
}

void bootstrap();
