import 'reflect-metadata';

import { createApplication } from './persistence.module.ts';
import { MissingRuntimeEnvError, readRequiredEnv, SERVER_REQUIRED_ENV } from './runtime-env.ts';

async function bootstrap(): Promise<void> {
  const { DATABASE_URL } = readRequiredEnv(process.env, SERVER_REQUIRED_ENV);
  const app = await createApplication(DATABASE_URL);
  await app.listen(3000, '0.0.0.0');
}

bootstrap().catch((error: unknown) => {
  if (error instanceof MissingRuntimeEnvError) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exit(1);
});
