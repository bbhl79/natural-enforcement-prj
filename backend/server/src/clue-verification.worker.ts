// 内业核查 worker（#213）：同进程消费核查任务，不另立 worker 服务。
//
// 队列设施包给的是不暴露 BullMQ 类型的 worker 工厂；本文件只把处理器接到
// 编排服务的执行入口上。确定性错误由编排侧抛「不可重试错误」，队列据此不再重试。
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import { createQueueWorker, type WorkerHandle } from '@natural-enforcement/queue';

import {
  ClueVerificationService,
  VERIFICATION_JOB,
  type VerificationJobPayload,
} from './clue-verification.service.ts';
import {
  CLUE_VERIFICATION_QUEUE_NAME,
  VERIFICATION_WORKER_ENABLED,
} from './clue-verification.tokens.ts';

@Injectable()
export class ClueVerificationWorker implements OnModuleInit, OnModuleDestroy {
  private handle: WorkerHandle | null = null;

  constructor(
    private readonly verification: ClueVerificationService,
    @Inject(VERIFICATION_WORKER_ENABLED) private readonly enabled: boolean,
  ) {}

  onModuleInit(): void {
    if (!this.enabled) return;
    this.handle = createQueueWorker({
      queueName: CLUE_VERIFICATION_QUEUE_NAME,
      redisUrl: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
      processor: async (payload, context) => {
        if (context.jobName !== VERIFICATION_JOB) return null;
        const job = payload as VerificationJobPayload;
        await this.verification.execute(job, context.attempt);
        return { ok: true };
      },
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.handle?.close();
    this.handle = null;
  }
}
