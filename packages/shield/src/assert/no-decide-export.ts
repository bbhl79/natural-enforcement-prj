/** 副驾驶命名空间。不得出现定案可调用出口。 */
export const COPILOT = {
  role: "hint-warn-block",
} as const;

const DECIDE_EXPORT = /decide|定案|applyPenalty|issueDecision/i;

export function assertNoCopilotDecideExport(
  keys: readonly string[],
): void {
  for (const key of keys) {
    if (DECIDE_EXPORT.test(key)) {
      throw new Error(`副驾驶命名空间不得导出定案符号：${key}`);
    }
  }
}
