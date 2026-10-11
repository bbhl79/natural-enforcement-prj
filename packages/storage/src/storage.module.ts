// NestJS provider 形态（#53：存储接口可注入）。装饰器只许存在于本文件——
// E3 驱动以 node 原生 type-stripping 运行（packages/storage/src/e3-driver.ts），
// 其传递闭包内任何文件出现装饰器语法即运行失败。
import { Module } from '@nestjs/common';

import { createRustFsStorage } from './rustfs-storage.ts';
import { createS3Client } from './s3-client.ts';
import { STORAGE_PORT } from './tokens.ts';

@Module({
  providers: [
    {
      provide: STORAGE_PORT,
      useFactory: () =>
        createRustFsStorage({
          client: createS3Client({
            endpoint: process.env.RUSTFS_ENDPOINT ?? 'http://127.0.0.1:9000',
            region: process.env.RUSTFS_REGION ?? 'us-east-1',
            accessKey: process.env.RUSTFS_ACCESS_KEY ?? 'rustfsdev',
            secretKey: process.env.RUSTFS_SECRET_KEY ?? 'rustfsdev-secret',
          }),
          bucket: process.env.RUSTFS_BUCKET ?? 'ne-files',
        }),
    },
  ],
  exports: [STORAGE_PORT],
})
export class StorageModule {}
