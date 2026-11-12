// 用途：服务端进程入口，校验必需环境变量后装配应用并监听 3000 端口。
// 调用方：容器或 dev 脚本启动的 Node 进程入口。
// 边界：缺少必需环境变量时打印错误并以退出码 1 结束；同进程起内业核查 worker。
//
import 'reflect-metadata';

import { createApplication } from './persistence.module.ts';
import { MissingRuntimeEnvError, readRequiredEnv, SERVER_REQUIRED_ENV } from './runtime-env.ts';

async function bootstrap(): Promise<void> {
  const { DATABASE_URL } = readRequiredEnv(process.env, SERVER_REQUIRED_ENV);
  // 生产引导：同进程起内业核查 worker（业务 worker 自带，不另立 worker 服务）。
  const app = await createApplication(DATABASE_URL, undefined, undefined, { verificationWorker: true });
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
