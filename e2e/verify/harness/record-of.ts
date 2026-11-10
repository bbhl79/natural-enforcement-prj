// unknown → 记录对象窄化。runner 与 discoverer 共用，单一来源消除逐字重复。
// 零依赖纯函数模块；消费方一律从这里 import。

/** object 且非 null、非数组时窄化为记录；其余返回 null。 */
export function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
