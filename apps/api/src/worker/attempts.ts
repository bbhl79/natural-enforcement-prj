// BullMQ 重试语义的纯函数判定（#69 复审修复）：
// 入参是当前尝试序号（1-based）与队列配置的 attempts；达到 attempts 才是最终失败。
export function isFinalAttempt(attemptNumber: number, attempts: number | undefined): boolean {
  return attemptNumber >= Math.max(1, attempts ?? 1)
}
