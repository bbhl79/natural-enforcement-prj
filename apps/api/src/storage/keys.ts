// 对象键构造（纯函数，单元测试覆盖）
export function buildObjectKey(input: { uuid: string; originalName: string }): string {
  const safe = input.originalName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80)
  return `evidence/${input.uuid}/${safe}`
}
