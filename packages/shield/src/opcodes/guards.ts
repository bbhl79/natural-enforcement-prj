import { OPCODES, type Opcode } from "./catalog";

/** 写操作。监督角色调用这些码必须被拒。 */
export const WRITE_OPCODES = [
  OPCODES.dossierIngest,
  OPCODES.investDecide,
] as const satisfies readonly Opcode[];

/** 办案写集。监督禁写办案主状态／定案结论时消费这一集。 */
export const CASE_WRITE_OPCODES = [
  OPCODES.investDecide,
] as const satisfies readonly Opcode[];
