// 前端取用操作码契约的入口。
//
// 契约的唯一事实源在 packages/shield（操作码名册，#71/#96）。前端不另存一份名册：界面上的
// 操作码按契约包的字面量联合 OpcodeName 标注，后端改名或废码时前端编译即报错，不必等到
// 运行到某个页面才发现按钮永远不出现。
import type { OpcodeName } from '@natural-enforcement/shield';

/** 会话操作码清单里是否有该码。码按契约收窄——写错的码编译期即报错。 */
export function hasOpcode(opcodes: readonly string[], code: OpcodeName): boolean {
  return opcodes.includes(code);
}
