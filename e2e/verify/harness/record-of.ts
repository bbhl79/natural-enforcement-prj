// 用途：把 unknown 窄化为对象记录，非对象返回 null，供运行器与发现器共用。
// unknown → 记录对象窄化。runner 与 discoverer 共用，单一来源消除逐字重复。
// 零依赖纯函数模块；消费方一律从这里 import。

/** object 且非 null、非数组时窄化为记录；其余返回 null。 */
export function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
