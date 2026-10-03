/**
 * 操作码常量表。M0a 只收录 D3 v0.1.8-r12 正文已点名的键。
 * §2.3 全表在 M0b 按种子填满，不在本包另造。
 */
export const OPCODES = {
  dossierIngest: "dossier.ingest",
  investDecide: "invest.decide",
} as const;

export type Opcode = (typeof OPCODES)[keyof typeof OPCODES];
