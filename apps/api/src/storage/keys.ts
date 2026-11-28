// 对象键构造（纯函数，单元测试覆盖；#69）。
// 文件名绝不进入对象键：键只由服务端生成的证据记录 id 构成——这是
// 「文件名仅展示元数据，不作路径或存储键」的代码落点。
export function buildEvidenceObjectKey(recordId: string): string {
  return `evidence/${recordId}`
}