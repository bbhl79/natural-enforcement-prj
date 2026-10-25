// 队列设施包公共出口（#55）：QueuePort 抽象 + 健康检查任务契约 + NestJS 注入形态。
// BullMQ/ioredis 实现细节不出本包（结构测试 queue-facility-entry 机器兜底，
// 业务侧经 QUEUE_PORT 注入，禁止裸依赖 bullmq/ioredis）。
//
// #213：投递参数（attempts／backoff）、不可重试错误类型、业务 worker 工厂。
export {
  HEALTH_CHECK_JOB,
  createHealthCheckProcessor,
  runHealthCheckJob,
} from './health-check.ts';
export type { HealthCheckPayload, HealthCheckResult } from './health-check.ts';
export type { EnqueueOptions, JobRef, QueuePort } from './port.ts';
export { QUEUE_NAME, QUEUE_PORT } from './tokens.ts';
export { QueueModule } from './queue.module.ts';
export type { QueueModuleOptions } from './queue.module.ts';
export { NonRetryableError, isNonRetryableError } from './non-retryable.ts';
export { DEFAULT_QUEUE_NAME, createQueuePort } from './queue-port.ts';
export type { QueuePortOptions } from './queue-port.ts';
export { createQueueWorker } from './worker.ts';
export type { WorkerHandle, WorkerJobContext, WorkerOptions, WorkerProcessor } from './worker.ts';
