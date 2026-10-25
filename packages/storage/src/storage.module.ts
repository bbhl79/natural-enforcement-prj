// NestJS provider 形态（#53：存储接口可注入）。装饰器只许存在于本文件——
// E3 驱动以 node 原生 type-stripping 运行（packages/storage/src/e3-driver.ts），
// 其传递闭包内任何文件出现装饰器语法即运行失败。
import { Module } from '@nestjs/common';

import { createDefaultStoragePort } from './default-port.ts';
import { STORAGE_PORT } from './tokens.ts';

@Module({
  providers: [
    {
      provide: STORAGE_PORT,
      useFactory: () => createDefaultStoragePort(),
    },
  ],
  exports: [STORAGE_PORT],
})
export class StorageModule {}
