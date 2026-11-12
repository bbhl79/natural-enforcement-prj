// 用途：把 StoragePort 落到 RustFS：写入时强制附加 COMPLIANCE 对象锁，读取时按版本 id 取回内容。
// 调用方：packages/storage/src/default-port.ts（运行时默认装配）、packages/storage/src/e3-driver.ts（E3 驱动）、
//   packages/storage/test/rustfs-storage.test.ts（单测）。
//   packages/storage/src/index.ts 把本适配器再导出到包公共出口，但包外当前无直接调用方；
//   backend/server/src/persistence.module.ts 经 createDefaultStoragePort 间接取得本适配器。
// 边界：只实现 putVersion 与 readVersion，不实现改写与删除；不重试，不翻译 S3Error。失败语义见 packages/storage/src/port.ts。
//   不建桶，不启用版本控制，不设桶级默认保留。这些动作由 dev 的 ensure_files_bucket、
//   e2e/verify/harness/layers/apply-layer-overlay.sh 的 ensure_bucket、
//   e2e/verify/harness/ui/run-ui-full-loop-local.sh 与 packages/storage/src/e3-driver.ts 各自经 S3 客户端完成。
// 依据：#53；RustFS 可承载 append-only 的判定见 docs/research/stack-data-compat.md。
//
// RustFS 适配器（#53）：StoragePort 的唯一存储实现，只在本设施包内被引用。
// 写入侧强制对象锁（COMPLIANCE 保留期，默认 now + 100 年）：即使桶级默认保留
// 未配置，单次写入自身亦带 WORM 保留——append-only 最保守语义的写入侧落实。
// 接口不含原地修改/删除成员（见 port.ts），本适配器亦不实现此类通道。
// 本文件不含装饰器——E3 驱动以 node 原生 type-stripping 运行，传递闭包内禁止装饰器。

import type { S3Client } from './s3-client.ts';
import type { StoragePort } from './port.ts';

/**
 * 适配器构造参数：client 是 S3 兼容客户端，bucket 是文件桶名。
 * packages/storage/src/default-port.ts 与 packages/storage/src/e3-driver.ts 只传这两项；
 * retentionMs 与 now 当前只有 packages/storage/test/rustfs-storage.test.ts 传入。
 */
export interface RustFsStorageConfig {
  client: S3Client;
  bucket: string;
  /** 写入保留期（毫秒）；默认 100 年 */
  retentionMs?: number;
  now?: () => Date;
}

const DEFAULT_RETENTION_MS = 100 * 365 * 24 * 60 * 60 * 1000;

/** 建立追加式存储接口：经 S3 兼容客户端落 RustFS，写即锁（COMPLIANCE WORM） */
export function createRustFsStorage(config: RustFsStorageConfig): StoragePort {
  const retentionMs = config.retentionMs ?? DEFAULT_RETENTION_MS;
  const now = config.now ?? (() => new Date());

  const retainUntilOf = (): string =>
    new Date(now().getTime() + retentionMs).toISOString().replace(/\.\d{3}Z$/, 'Z');

  return {
    async putVersion(fileKey, content) {
      const { versionId } = await config.client.putObject(config.bucket, fileKey, content, {
        retention: { mode: 'COMPLIANCE', retainUntil: retainUntilOf() },
      });
      if (versionId === null) {
        throw new Error('存储端未返回版本 id（versioning 未启用？），追加式世代信息缺失');
      }
      return { fileKey, versionId };
    },

    async readVersion(ref) {
      return config.client.getObject(config.bucket, ref.fileKey, ref.versionId);
    },
  };
}
