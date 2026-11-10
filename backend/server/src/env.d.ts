// 启动包来源地址闸读取的 process 环境（#317）。
// 纪律与 packages/queue/src/env.d.ts 相同：仓库不引 @types/node，只声明本包实际读取的成员。
interface ProcessEnv {
  NODE_ENV?: string | undefined;
  NE_DEPLOYMENT?: string | undefined;
  NE_SOURCE_GATE_ALLOWED_SOURCES?: string | undefined;
  /** 仅 activeVerifyFault 读取。不是 verify 隔离时忽略，不改变来源地址闸。 */
  VERIFY_FAULT?: string | undefined;
  VERIFY_ISOLATION?: string | undefined;
  COMPOSE_PROJECT_NAME?: string | undefined;
}
