// 用途：dev health 的队列探测进程：投递一条健康检查任务，在同进程起 Worker 消费并等待确认；任一环节失败即置退出码 1。
// 调用方：dev 脚本的 run_queue_probe（dev health 经 check_queue 调用），在工具链容器内以 node 直接运行本文件。
// 边界：只做队列连通性探测，不处理业务任务；直接使用 bullmq 与 ioredis，属 queue-facility-entry 规则对本设施包的豁免范围。
// dev health 队列探测入口（#55）：经队列接口（QueuePort）真实投递健康检查任务，
// 并经消费确认通道等待该任务被消费完成——不是裸 redis ping。
// 运行方式：node packages/queue/src/probe.ts（node 24 原生 type-stripping），
// 故本文件及其传递闭包（port/health-check/bullmq-queue/env.d.ts）只许含可擦除
// TS 语法，不得出现装饰器；Worker 消费侧与投递同进程（探测的最小形态）。
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';

import { createBullMqQueue } from './bullmq-queue.ts';
import {
  HEALTH_CHECK_JOB,
  createHealthCheckProcessor,
  type HealthCheckResult,
} from './health-check.ts';

// 探测专用队列名（字符串）；与 packages/queue/src/tokens.ts 导出的 QUEUE_NAME 令牌（Symbol）无关。
const QUEUE_NAME = 'system.health';
const PROBE_TIMEOUT_MS = 10_000;

const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
// maxRetriesPerRequest: null 为 BullMQ 阻塞型连接（Worker/QueueEvents）的硬性要求
const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });

const port = createBullMqQueue(QUEUE_NAME, redis);
const worker = new Worker(QUEUE_NAME, createHealthCheckProcessor(() => redis.ping()), {
  connection: redis,
});

try {
  const payload = { probeId: crypto.randomUUID(), issuedAt: new Date().toISOString() };
  const ref = await port.enqueue(HEALTH_CHECK_JOB, payload);
  const result = (await port.waitForCompletion(ref, PROBE_TIMEOUT_MS)) as HealthCheckResult;
  if (result?.ok !== true || result.probeId !== payload.probeId) {
    throw new Error(`消费结果回执不匹配：${JSON.stringify(result)}`);
  }
  console.log(`健康检查任务已投递并消费确认（job=${ref.id} pong=${result.pong}）`);
} catch (err) {
  console.error(`队列健康检查失败：${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  try {
    await worker.close();
    await port.close();
  } finally {
    redis.disconnect();
  }
}
