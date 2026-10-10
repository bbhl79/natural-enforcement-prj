// NestJS provider 形态（#55：队列接口可注入）。装饰器只许存在于本文件——
// dev health 探测进程以 node 原生 type-stripping 运行（src/probe.ts），
// 其传递闭包内任何文件出现装饰器语法即运行失败。
import { Module } from '@nestjs/common';
import { Redis } from 'ioredis';

import { createBullMqQueue } from './bullmq-queue.ts';
import { QUEUE_PORT } from './tokens.ts';

@Module({
  providers: [
    {
      provide: QUEUE_PORT,
      useFactory: () =>
        createBullMqQueue(
          'ne.system',
          new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
            maxRetriesPerRequest: null,
          }),
        ),
    },
  ],
  exports: [QUEUE_PORT],
})
export class QueueModule {}
