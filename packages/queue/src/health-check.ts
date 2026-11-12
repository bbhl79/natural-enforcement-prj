// 用途：定义系统级健康检查任务的任务名、载荷、结果类型与消费逻辑，用来探测队列设施本身能否投递、能否被消费。
// 调用方：packages/queue/src/probe.ts（dev health 探测进程）；经 packages/queue/src/index.ts 对外导出，包外当前无调用方。
// 健康检查任务（#55）：对队列基础设施本身的系统级探测任务。
// 属系统设施任务，非业务 worker（G5 不可扩大条件）；任务名固定 system.* 命名空间，
// 业务 worker 不得占用该命名空间。

/** 健康检查任务名，固定落在 system.* 命名空间；探测进程 packages/queue/src/probe.ts 用它投递。 */
export const HEALTH_CHECK_JOB = 'system.health-check';

/** 健康检查任务载荷：probeId 是本次探测的唯一标识，issuedAt 是投递时刻（ISO 字符串）。 */
export interface HealthCheckPayload {
  probeId: string;
  issuedAt: string;
}

/** 健康检查任务的消费结果：回显 probeId，pong 是探针原始输出，consumedAt 是消费时刻（ISO 字符串）。 */
export interface HealthCheckResult {
  ok: true;
  probeId: string;
  pong: string;
  consumedAt: string;
}

/**
 * 健康检查任务的消费逻辑。连通探针经参数注入（生产 = redis ping），
 * 消费结果回显 probeId 并携带探针原始输出；探针抛错原样透出——探测不得吞错报绿。
 */
export async function runHealthCheckJob(
  payload: HealthCheckPayload,
  ping: () => Promise<string>,
): Promise<HealthCheckResult> {
  const pong = await ping();
  return { ok: true, probeId: payload.probeId, pong, consumedAt: new Date().toISOString() };
}

/** BullMQ Worker 处理器形态（消费侧入口，探测进程与后续设施消费方共用） */
export function createHealthCheckProcessor(ping: () => Promise<string>) {
  return async (job: { data: HealthCheckPayload }): Promise<HealthCheckResult> =>
    runHealthCheckJob(job.data, ping);
}
