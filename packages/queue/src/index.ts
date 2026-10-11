// 队列设施包公共出口（#55）：QueuePort 抽象 + 健康检查任务契约 + NestJS 注入形态。
// BullMQ/ioredis 实现细节不出本包（结构测试 queue-facility-entry 机器兜底，
// 业务侧经 QUEUE_PORT 注入，禁止裸依赖 bullmq/ioredis）。
export {
  HEALTH_CHECK_JOB,
  createHealthCheckProcessor,
  runHealthCheckJob,
} from './health-check.ts';
export type { HealthCheckPayload, HealthCheckResult } from './health-check.ts';
export type { JobRef, QueuePort } from './port.ts';
export { QUEUE_PORT } from './tokens.ts';
export { QueueModule } from './queue.module.ts';
