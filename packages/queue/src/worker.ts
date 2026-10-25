// 业务 worker 工厂（#213）：消费侧入口，不暴露 BullMQ 类型。
//
// 业务 worker 归业务切片自带（G5），任务名不得占用 system.* 命名空间；
// 本工厂只负责「起一个消费端、把处理器接上、把不可重试错误翻译成队列语义」。
// 连接由本包内部构造（ioredis 只许出现在队列设施包内），调用方只给地址。
import { UnrecoverableError, Worker } from 'bullmq';
import { Redis } from 'ioredis';

import { isNonRetryableError } from './non-retryable.ts';

/** 一次消费 attempt 的上下文。 */
export interface WorkerJobContext {
  /** 任务名（消费方据此分辨是不是自己的任务）。 */
  readonly jobName: string;
  /** 第几次尝试，首次执行为 1。 */
  readonly attempt: number;
}

/** 处理器：拿载荷与上下文，返回处理结果。抛错即本次 attempt 失败。 */
export type WorkerProcessor = (payload: unknown, context: WorkerJobContext) => Promise<unknown>;

/** 起 worker 所需的参数。 */
export interface WorkerOptions {
  /** 队列名。投递端与消费端必须同名。 */
  readonly queueName: string;
  /** Redis 地址。 */
  readonly redisUrl: string;
  /** 处理器。 */
  readonly processor: WorkerProcessor;
  /** 并发数，默认 1。 */
  readonly concurrency?: number;
}

/** 已起的 worker。进程退出前调用 close。 */
export interface WorkerHandle {
  close(): Promise<void>;
}

/**
 * 起一个消费 worker。
 *
 * 不可重试错误（NonRetryableError）翻译成队列的「不再重试」语义：任务当次即失败，
 * 不再自动重试；其余错误照旧抛给队列，由队列按投递参数决定是否重试。
 */
export function createQueueWorker(options: WorkerOptions): WorkerHandle {
  const connection = new Redis(options.redisUrl, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });
  connection.on('error', (error: Error) => {
    console.error(`队列连接错误：${error.message}`);
  });
  const worker = new Worker(
    options.queueName,
    async (job: { name: string; data: unknown; attemptsMade: number }) => {
      try {
        return await options.processor(job.data, {
          jobName: job.name,
          attempt: job.attemptsMade + 1,
        });
      } catch (error) {
        if (isNonRetryableError(error)) throw new UnrecoverableError(error.message);
        throw error;
      }
    },
    { connection, concurrency: options.concurrency ?? 1 },
  );
  return {
    async close() {
      await worker.close();
      connection.disconnect();
    },
  };
}
