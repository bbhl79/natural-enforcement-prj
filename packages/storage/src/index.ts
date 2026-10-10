// 存储设施包公共出口（#53）：StoragePort 追加式抽象 + RustFS 适配 + NestJS 注入形态。
// 协议层（S3 REST 客户端/SigV4 签名）刻意不出公共出口——业务侧只面向 StoragePort，
// 「原地修改/删除」在包外无表达通道；S3Client 仅设施包内部（适配器/E3 驱动）使用。
// 结构测试 storage-facility-entry 机器兜底 SDK 漂移；本包零新增第三方依赖。
// 追加式最保守语义，衔接 #18；不宣称任何「封存」语义（G4 归后续切片）。
export type { FileVersionRef, StoragePort } from './port.ts';
export { STORAGE_PORT } from './tokens.ts';
export { StorageModule } from './storage.module.ts';
export { createRustFsStorage } from './rustfs-storage.ts';
export type { RustFsStorageConfig } from './rustfs-storage.ts';
