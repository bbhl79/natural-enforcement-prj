// NestJS provider 形态（#55：队列接口可注入）。装饰器只许存在于本文件——
// dev health 探测进程以 node 原生 type-stripping 运行（src/probe.ts），
// 其传递闭包内任何文件出现装饰器语法即运行失败。
//
// #213：队列名可指定（业务队列与系统队列分名），并把队列名作为令牌出，
// 供同进程的消费端（Worker）与投递端取同一个名字。
import { Module, type DynamicModule } from '@nestjs/common';

import { DEFAULT_QUEUE_NAME, createQueuePort } from './queue-port.ts';
import { QUEUE_NAME, QUEUE_PORT } from './tokens.ts';

/** 队列模块的装配参数。 */
export interface QueueModuleOptions {
  /** 队列名，默认 ne.system。 */
  readonly queueName?: string;
  /** Redis 地址，默认取环境变量 REDIS_URL。 */
  readonly redisUrl?: string;
}

@Module({})
export class QueueModule {
  /** 装配队列端口。队列名与 Redis 地址不给时取默认值。 */
  static register(options: QueueModuleOptions = {}): DynamicModule {
    const queueName = options.queueName ?? DEFAULT_QUEUE_NAME;
    return {
      module: QueueModule,
      providers: [
        { provide: QUEUE_NAME, useValue: queueName },
        {
          provide: QUEUE_PORT,
          useFactory: () => createQueuePort({ queueName, redisUrl: options.redisUrl }),
        },
      ],
      exports: [QUEUE_PORT, QUEUE_NAME],
    };
  }
}
