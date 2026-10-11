// 存储接口（StoragePort，#53）：业务与设施代码对文件版本存储的唯一面向。
// 可注入：经 StorageModule 的 STORAGE_PORT provider 注入本接口，不面向 S3/RustFS 编程。
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

export interface StoragePort {
  /** 写入一个新版本（追加式；适配器强制对象锁 COMPLIANCE 保留，绝不原地改写） */
  putVersion(fileKey: string, content: Uint8Array): Promise<FileVersionRef>;
  /** 读取指定版本的内容；版本不存在即拒绝 */
  readVersion(ref: FileVersionRef): Promise<Uint8Array>;
}
// 刻意不开放版本列举/最新版解析：首个真实调用方（E3 用例）只需「写版本 + 按版本读」，
// 其余操作待真实调用方出现再加宽（#47 深度纪律——凡凭猜想的扩充不建）。
