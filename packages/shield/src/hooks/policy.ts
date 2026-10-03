import type { HookLevel } from "./catalog";

export type HookLevelChange = HookLevel | "off";

/** block 不可降为 warn／hint，也不可关闭。 */
export function assertHookLevelChange(
  prev: HookLevel,
  next: HookLevelChange,
): void {
  if (prev === "block" && next !== "block") {
    throw new Error("block 挂点不可降档或关闭");
  }
}
