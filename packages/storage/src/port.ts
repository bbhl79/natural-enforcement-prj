// 用途：声明业务对文件版本存储的唯一接口 StoragePort：只能追加写入新版本、按版本引用读取，没有改写与删除成员。
// 调用方：经 STORAGE_PORT 令牌注入本接口并调用 putVersion 或 readVersion 的服务：
//   backend/server/src/clue-registration.service.ts、backend/server/src/clue-disposition.service.ts、
//   backend/server/src/clue-verification.service.ts、backend/server/src/secrecy-report.service.ts、
//   backend/server/src/case-transfer.service.ts、backend/server/src/storage-quarantine.service.ts。
//   令牌装配在 backend/server/src/persistence.module.ts。
//   E3 驱动 packages/storage/src/e3-driver.ts 经适配器调用。
// 边界：本文件只声明类型，不含实现；唯一实现是 packages/storage/src/rustfs-storage.ts。
//   接口成员以下方声明为准：当前只有 putVersion 与 readVersion 两个方法，
//   不含列举版本、解析最新版、改写、删除。失败语义见 StoragePort 的注释。
//   packages/storage/test/rustfs-storage.test.ts 在类型层断言接口上不出现
//   update、overwrite、delete、deleteVersion、put、restore 这六个成员名。
// 依据：#53、#47、#18；语义原文见下方原有注释。
//
// 存储接口（StoragePort，#53）：业务与设施代码对文件版本存储的唯一面向。
// 可注入：经 STORAGE_PORT 令牌注入本接口（组合根手工装配），不面向 S3/RustFS 编程。
//
// 追加式（append-only）最保守语义（#47 / #53，衔接 #18）：
// - 接口只含「写入新版本 / 读指定版本 / 列举版本」三个操作，刻意不存在
//   update/overwrite/delete 成员——「原地修改/删除」在接口层即无表达，而非靠自觉不调用；
// - 写入新版本时由适配器强制附加对象锁（COMPLIANCE 保留期），存储层 WORM 兜底；
// - #18（全局不可篡改与追加式记录保证策略）定案后，其纪律在本接口之上叠加，
//   本接口不为预留宽松语义（宁可现在保守、后续加纪律，不先宽松再收紧）。

/** 已写入文件版本的引用；一切读取只认版本引用，调用方无需也无法指向「当前版本」 */
export interface FileVersionRef {
  fileKey: string;
  versionId: string;
}

/**
 * 追加式存储接口：同一 fileKey 再次写入得到新的 versionId，不改动已写入的版本。
 * versionId 由存储端的版本控制生成；适配器要求存储端必须返回它。
 * putVersion 不判重：适配器每次调用都向存储端发起一次新的写入。
 * 失败语义：两个方法失败时都让 Promise 拒绝，不返回 null 或空内容。
 * 适配器 createRustFsStorage 的拒绝原因如下：
 * - 存储端返回非 2xx 时，拒绝为 S3Error，带 HTTP 状态与 S3 错误码（如 AccessDenied、NoSuchBucket）。
 * - putVersion 收到 2xx 但响应不含版本 id 时，拒绝为普通 Error；此时存储端已接受该次写入，调用方拿不到引用。
 * - 网络层失败时，fetch 的原始错误原样拒绝。
 * 适配器不重试，也不翻译错误。
 * 待确认：readVersion 读取不存在的版本时，存储端返回的 HTTP 状态与 S3 错误码，
 * 来源 packages/storage/src/s3-client.ts（request 原样转成 S3Error，不判定具体码）。
 */
export interface StoragePort {
  /** 写入一个新版本（追加式；适配器强制对象锁 COMPLIANCE 保留，绝不原地改写） */
  putVersion(fileKey: string, content: Uint8Array): Promise<FileVersionRef>;
  /** 读取指定版本的内容；版本不存在即拒绝 */
  readVersion(ref: FileVersionRef): Promise<Uint8Array>;
}
// 刻意不开放版本列举/最新版解析：首个真实调用方（E3 用例）只需「写版本 + 按版本读」，
// 其余操作待真实调用方出现再加宽（#47 深度纪律——凡凭猜想的扩充不建）。
