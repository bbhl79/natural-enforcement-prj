// BullMQ 适配器（#55）：QueuePort 的唯一 BullMQ 实现，只在本设施包内被引用。
// 本文件不含装饰器——dev health 的探测进程以 node 原生 type-stripping 直接运行
//（packages/queue/src/probe.ts），其传递闭包内任何文件都不得出现装饰器语法。
// 连接经调用方构造的 ioredis 实例注入（Worker 侧要求 maxRetriesPerRequest: null，
// 由调用方设置；BullMQ 内部按角色 duplicate）。
import { Queue, QueueEvents, type ConnectionOptions, type Job, type JobsOptions } from 'bullmq';

import type { EnqueueOptions, JobRef, QueuePort } from './port.ts';

/**
 * 投递参数到 BullMQ 作业参数的映射。
 * attempts 是总尝试次数（含首次执行）；backoff 的 exponential 依次取 delay、delay×2、delay×4。
 * 不给投递参数时不传第三参，保持既有调用形态。
 */
function toJobOptions(options: EnqueueOptions): JobsOptions {
  const jobOptions: JobsOptions = {};
  if (options.attempts !== undefined) jobOptions.attempts = options.attempts;
  if (options.backoff !== undefined) {
    jobOptions.backoff = { type: options.backoff.type, delay: options.backoff.delay };
  }
  return jobOptions;
}

/** 建立 QueuePort：持有投递队列与消费确认通道（QueueEvents），不持有消费 Worker */
export function createBullMqQueue(queueName: string, connection: ConnectionOptions): QueuePort {
  const queue = new Queue(queueName, { connection });
  const events = new QueueEvents(queueName, { connection });
  const jobs = new Map<string, Job>();

  return {
    async enqueue(jobName, payload, options) {
      const job =
        options === undefined
          ? await queue.add(jobName, payload)
          : await queue.add(jobName, payload, toJobOptions(options));
      const ref: JobRef = { id: String(job.id) };
      jobs.set(ref.id, job);
      return ref;
    },
    async waitForCompletion(ref, timeoutMs) {
      const job = jobs.get(ref.id);
      if (!job) {
        throw new Error(`未知任务引用：${ref.id}`);
      }
      try {
        return await job.waitUntilFinished(events, timeoutMs);
      } finally {
        jobs.delete(ref.id);
      }
    },
    async close() {
      jobs.clear();
      await Promise.all([queue.close(), events.close()]);
    },
  };
}
