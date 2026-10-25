// 撤回不派与结案的领域规则（#217；规格 B/D 节、GLOSSARY）。
//
// 纯规则、不依赖 Nest 与存储：撤回不派的四项原因与补充说明校验、
// 不予立案登记的状态门槛与字段校验、结案提醒的类型口径都在这里判，
// 接口层只负责把事实喂进来、把判别联合映射成 HTTP。

/** 撤回不派与结案登记的校验规则码（400 non-compliant 的 rules 列取值）。 */
export const CLUE_CLOSURE_RULE_CODES = [
  /** 撤回不派至少勾一项原因。 */
  'missing-withdraw-reason',
  /** 撤回不派的补充说明必填。 */
  'missing-withdraw-note',
  /** 勾选的撤回原因不在四项常用原因之内。 */
  'invalid-withdraw-reason',
  /** 不予立案／随旧线索办结的说明必填。 */
  'missing-disposition-fields',
  /** 本期不支持的处置类型（移送归 #216 接口）。 */
  'unsupported-disposition',
] as const;

/** 撤回不派四项常用原因（逐字采用原型，可多选、至少一项，每个原因单独一行）。 */
export const WITHDRAW_REASONS = [
  '同一地点不同违法',
  '新增情况',
  '原线索核查不属实需重派',
  '误判重复',
] as const;

/** 撤回不派线索的状态（从「不派」撤回，成功后回待分派池）。 */
export const WITHDRAW_FROM_STATUS = 'held';

/** 撤回不派结果。 */
export type WithdrawCheckOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly rule: 'missing-withdraw-reason' | 'missing-withdraw-note' | 'invalid-withdraw-reason';
    };

/**
 * 撤回不派输入校验（规格 D 节）：原因至少一项、逐项属四项常用原因、补充说明必填。
 * 缺原因与缺说明分两个规则码报，供界面分别提示。
 */
export function checkWithdrawInput(input: {
  readonly reasonCodes: readonly string[];
  readonly note: string;
}): WithdrawCheckOutcome {
  const reasons = input.reasonCodes.map((code) => code.trim()).filter((code) => code !== '');
  if (reasons.length === 0) return { ok: false, rule: 'missing-withdraw-reason' };
  if (reasons.some((code) => !(WITHDRAW_REASONS as readonly string[]).includes(code))) {
    return { ok: false, rule: 'invalid-withdraw-reason' };
  }
  if (input.note.trim() === '') return { ok: false, rule: 'missing-withdraw-note' };
  return { ok: true };
}

/** 不予立案登记的线索状态（仅已派承办人可登记；核查运行或失败不阻止）。 */
export const DISPOSITION_RECORD_FROM_STATUS = 'handler_assigned';

/** 处置类型：不予立案 | 随旧线索办结 | 移送（移送的发起归 #216）。 */
export const DISPOSITION_KINDS = ['no-case', 'with-old', 'transfer'] as const;

/** 结案提醒类型：不予立案 | 移送 | 立案。 */
export const REMINDER_KINDS = ['no-case', 'transfer', 'case'] as const;

/** 结案提醒的处理结果：撤回不派再办 | 随旧线索办结。 */
export const REMINDER_RESOLUTIONS = ['withdraw', 'close-with-old'] as const;

/** 不予立案／随旧线索办结的说明校验结果。 */
export type DispositionNoteCheckOutcome = { readonly ok: true } | { readonly ok: false };

/** 不予立案与随旧线索办结：处置说明必填（自由文本留业务行，不进留痕）。 */
export function checkDispositionNote(note: string): DispositionNoteCheckOutcome {
  return note.trim() === '' ? { ok: false } : { ok: true };
}
