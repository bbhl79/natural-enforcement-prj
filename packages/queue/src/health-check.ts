// 健康检查任务（#55）：对队列基础设施本身的系统级探测任务。
// 属系统设施任务，非业务 worker（G5 不可扩大条件）；任务名固定 system.* 命名空间，
// 业务 worker 不得占用该命名空间。

export const HEALTH_CHECK_JOB = 'system.health-check';

export interface HealthCheckPayload {
  probeId: string;
  issuedAt: string;
}

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
