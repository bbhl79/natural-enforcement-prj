// 队列接口的进程内装配（#213）：起 QueuePort，连接由本包内部构造。
//
// 调用方只给队列名与 Redis 地址；ioredis 只出现在本设施包内。
// 连接用 lazyConnect：进程不投递任务就不连 Redis，测试与只读部署不受影响。
import { Redis } from 'ioredis';

import { createBullMqQueue } from './bullmq-queue.ts';
import type { QueuePort } from './port.ts';

/** 默认队列名（系统设施队列）。业务队列由调用方另起一名，不共用。 */
export const DEFAULT_QUEUE_NAME = 'ne.system';

/** 起 QueuePort 所需的参数。 */
export interface QueuePortOptions {
  /** 队列名，默认 ne.system。 */
  readonly queueName?: string;
  /** Redis 地址，默认取环境变量 REDIS_URL。 */
  readonly redisUrl?: string;
}

/** 起一个 QueuePort。close 时连 Redis 一并断开。 */
export function createQueuePort(options: QueuePortOptions = {}): QueuePort {
  const queueName = options.queueName ?? DEFAULT_QUEUE_NAME;
  const redisUrl = options.redisUrl ?? process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
  const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });
  connection.on('error', (error: Error) => {
    console.error(`队列连接错误：${error.message}`);
  });
  const port = createBullMqQueue(queueName, connection);
  return {
    enqueue: (jobName, payload, enqueueOptions) => port.enqueue(jobName, payload, enqueueOptions),
    waitForCompletion: (ref, timeoutMs) => port.waitForCompletion(ref, timeoutMs),
    close: async () => {
      await port.close();
      connection.disconnect();
    },
  };
}
