// 用途：移送与停用机构池重新指定领域规则的公共出口，本文件只做再导出。
// 调用方：backend/case/src/index.ts；backend/server/src/clue-disposition.service.ts 经包名 @natural-enforcement/case 导入。
// 边界：只做再导出，不写库、不写留痕。
// 依据：#216。
// 移送与停用机构池重新指定（#216）。公共出口。
export {
  CLUE_DISPOSITION_RULE_CODES,
  POOL_REASSIGN_FROM_STATUSES,
  TRANSFER_FROM_STATUSES,
  TRANSFERRED_OUT_STATUS,
  assessTransfer,
  beijingDateOf,
  parseLetterDate,
} from './rules.ts';
export type { TransferAssessment } from './rules.ts';
