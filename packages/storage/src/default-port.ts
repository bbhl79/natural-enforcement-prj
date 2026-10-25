// 默认存储端口（#53 设施包；#211 启动包复用）。
// 按运行参数建 RustFS 适配的存储端口：参数取值与 StorageModule 的 provider 同一份，
// 两处不各写一份环境变量默认值。
// 刻意不出公共出口的仍是 S3Client 与签名层——本函数只交出 StoragePort。

import { createRustFsStorage } from './rustfs-storage.ts';
import { createS3Client } from './s3-client.ts';
import type { StoragePort } from './port.ts';

/** 按运行参数建默认存储端口（RustFS 适配）。 */
export function createDefaultStoragePort(): StoragePort {
  return createRustFsStorage({
    client: createS3Client({
      endpoint: process.env.RUSTFS_ENDPOINT ?? 'http://127.0.0.1:9000',
      region: process.env.RUSTFS_REGION ?? 'us-east-1',
      accessKey: process.env.RUSTFS_ACCESS_KEY ?? 'rustfsdev',
      secretKey: process.env.RUSTFS_SECRET_KEY ?? 'rustfsdev-secret',
    }),
    bucket: process.env.RUSTFS_BUCKET ?? 'ne-files',
  });
}
