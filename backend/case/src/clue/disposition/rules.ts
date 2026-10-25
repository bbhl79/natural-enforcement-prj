// 移送与停用机构池重新指定的领域规则（#216；规格 D 节、GLOSSARY）。
//
// 纯规则、不依赖 Nest 与存储：移送的必填校验、发函日期缺省与补录、
// 两类动作的状态门槛都在这里判，接口层只负责把事实喂进来、把判别联合映射成 HTTP。

/** 移送的校验规则码（400 non-compliant 的 rules 列取值）。 */
export const CLUE_DISPOSITION_RULE_CODES = [
  /** 移送机关、文书编号、原因必填（发函日期缺省由北京当日补齐，不缺失）。 */
  'missing-disposition-fields',
  /** 发函日期补录值不合规（须为真实存在的 YYYY-MM-DD 日历日）。 */
  'invalid-letter-date',
  /** 停用机构池重新指定的理由必填。 */
  'missing-reassign-reason',
] as const;

/** 移送登记后即达终态。 */
export const TRANSFERRED_OUT_STATUS = 'transferred_out';

/** 移送允许的来源状态：待分派池（池所属机构内勤）、已派机构与已派承办人（承办机构内勤）。 */
export const TRANSFER_FROM_STATUSES = ['in_pool', 'org_assigned', 'handler_assigned'] as const;

/** 停用机构池重新指定允许的线索状态：待分派池、待分派决定、不派（均未派出）。 */
export const POOL_REASSIGN_FROM_STATUSES = ['in_pool', 'pending_decision', 'held'] as const;

/** 北京时区偏移（UTC+8，规格：发函日期默认北京当日）。 */
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 北京当日（UTC+8 的日历日），发函日期缺省值。 */
export function beijingDateOf(now: Date): string {
  return new Date(now.getTime() + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}

/** 解析发函日期补录值：只收 YYYY-MM-DD，且必须是真实存在的日历日。 */
export function parseLetterDate(raw: string): string | null {
  const text = raw.trim();
  if (text === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const at = new Date(`${text}T00:00:00.000+08:00`);
  if (Number.isNaN(at.getTime())) return null;
  // 日历日回卷校验（如 2 月 30 日会滚到 3 月）：按北京日历日比对。
  if (new Date(at.getTime() + BEIJING_OFFSET_MS).toISOString().slice(0, 10) !== text) return null;
  return text;
}

/** 移送登记判别结果。 */
export type TransferAssessment =
  | { readonly ok: true; readonly letterDate: string }
  | {
      readonly ok: false;
      readonly rule: 'missing-disposition-fields' | 'invalid-letter-date';
    };

/**
 * 移送登记校验（规格 D）：移送机关、文书编号、原因必填；发函日期缺省取北京当日，
 * 允许补录（只收真实日历日，回卷即不合规）。不区分管辖、涉刑、党纪政务三类，
 * 系统不按违法类型限制移送。
 */
export function assessTransfer(input: {
  /** 必填项可为缺省：缺字段与空串一律算「必填未填」。 */
  readonly transferOrg?: string;
  readonly documentNo?: string;
  readonly reason?: string;
  /** 发函日期补录值（空串＝缺省北京当日）。 */
  readonly letterDateRaw?: string;
  /** 北京当日（由时钟算出后传入，纯函数不自取时间）。 */
  readonly today: string;
}): TransferAssessment {
  // 字段缺失与空串同样算「必填未填」：缺字段要报规则码，不能抛异常。
  if (
    !isFilled(input.transferOrg) ||
    !isFilled(input.documentNo) ||
    !isFilled(input.reason)
  ) {
    return { ok: false, rule: 'missing-disposition-fields' };
  }
  const raw = (input.letterDateRaw ?? '').trim();
  if (raw === '') return { ok: true, letterDate: input.today };
  const parsed = parseLetterDate(raw);
  if (parsed === null) return { ok: false, rule: 'invalid-letter-date' };
  return { ok: true, letterDate: parsed };
}

/** 必填字段是否已填：非字符串（缺失）与空白串都算未填。 */
function isFilled(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim() !== '';
}
