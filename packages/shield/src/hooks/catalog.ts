export const HOOK_LEVELS = ["block", "warn", "hint"] as const;

export type HookLevel = (typeof HOOK_LEVELS)[number];

/**
 * 挂点默认档。只收录 D3 正文写明不可降的 block。
 * §5 总表其余行在 M0b 按表填入。
 */
export const HOOKS = {
  "gate.evidence.cite_unfiled_in_decision": "block",
  "gate.hearing.notice_7d": "block",
  "gate.hearing.host_not_investigator": "block",
  "gate.serve.receipt": "block",
} as const satisfies Record<string, HookLevel>;

export type HookId = keyof typeof HOOKS;
