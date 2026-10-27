// 撤回不派与结案的领域规则（#217／#226／#229；规格 B/D 节、GLOSSARY）。
//
// 纯规则、不依赖 Nest 与存储：撤回不派的四项原因与补充说明校验、
// 不予立案落点（经立案呈批）的理由两类互斥校验、结案提醒的类型口径都在这里判，
// 接口层只负责把事实喂进来、把判别联合映射成 HTTP。

/** 撤回不派与结案登记的校验规则码（400 non-compliant 的 rules 列取值）。 */
export const CLUE_CLOSURE_RULE_CODES = [
  /** 撤回不派至少勾一项原因。 */
  'missing-withdraw-reason',
  /** 撤回不派的补充说明必填。 */
  'missing-withdraw-note',
  /** 勾选的撤回原因不在四项常用原因之内。 */
  'invalid-withdraw-reason',
  /** 不予立案／随旧线索办结／其他的说明必填。 */
  'missing-disposition-fields',
  /** 本期不支持的处置类型（移送归 #216 接口）。 */
  'unsupported-disposition',
  /** HTTP 直接登记不予立案被拒：须经立案呈批批准（#226）。 */
  'filing-approval-required',
  /** 不予立案理由皆空、混选、条款非法或第十六条末款三项未全确认（#226）。 */
  'invalid-no-case-reason',
  /** 落点服务缺呈批引用主键（#226）。 */
  'missing-filing-approval-ref',
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

/** 处置类型：不予立案 | 随旧线索办结 | 移送（#216）| 其他（#229）。 */
export const DISPOSITION_KINDS = ['no-case', 'with-old', 'transfer', 'other'] as const;

/** 结案提醒类型：不予立案 | 移送 | 立案 | 其他（#229）。 */
export const REMINDER_KINDS = ['no-case', 'transfer', 'case', 'other'] as const;

/** 结案提醒的处理结果：撤回不派再办 | 随旧线索办结。 */
export const REMINDER_RESOLUTIONS = ['withdraw', 'close-with-old'] as const;

/** 不予立案／随旧线索办结的说明校验结果。 */
export type DispositionNoteCheckOutcome = { readonly ok: true } | { readonly ok: false };

/** 不予立案与随旧线索办结：处置说明必填（自由文本留业务行，不进留痕）。 */
export function checkDispositionNote(note: string): DispositionNoteCheckOutcome {
  return note.trim() === '' ? { ok: false } : { ok: true };
}

/**
 * 处罚办法第十六条（一）–（五）固定编码（#226）：勾选表示该项立案条件未满足。
 * 标签逐字取第十六条（一）–（五）原文（立案条件本身），不改写为否定句。
 * 不自由文本替代条款本身；标签仅供展示；快照只存编码。
 */
export const NON_FILING_GROUND_CODES = [
  'art16-1-no-clear-actor',
  'art16-2-no-violation-fact',
  // 对应第十六条（三）「依照自然资源管理法律法规应当追究法律责任」：键名字面是「没有法律责任」，
  // 语义即（三）不成立；键名已作为编码落库，不改名。
  'art16-3-no-legal-liability',
  'art16-4-not-our-jurisdiction',
  'art16-5-beyond-limitation',
] as const;

export type NonFilingGroundCode = (typeof NON_FILING_GROUND_CODES)[number];

export const NON_FILING_GROUND_LABELS: Readonly<Record<NonFilingGroundCode, string>> = {
  'art16-1-no-clear-actor': '有明确的行为人',
  'art16-2-no-violation-fact': '有违反自然资源管理法律法规的事实',
  'art16-3-no-legal-liability': '依照自然资源管理法律法规应当追究法律责任',
  'art16-4-not-our-jurisdiction': '属于本部门管辖',
  'art16-5-beyond-limitation': '违法行为没有超过追诉时效',
};

/** 第十六条末款三项（违法行为轻微／及时纠正／没有造成危害后果）字段名。 */
export const MINOR_ELEMENT_KEYS = ['minor', 'timelyCorrection', 'noHarm'] as const;
export type MinorElementKey = (typeof MINOR_ELEMENT_KEYS)[number];

export const MINOR_ELEMENT_LABELS: Readonly<Record<MinorElementKey, string>> = {
  minor: '违法行为轻微',
  timelyCorrection: '及时纠正',
  noHarm: '没有造成危害后果',
};

/** 末款三项中一项：须确认且附说明。 */
export interface MinorElementConfirmation {
  readonly confirmed: true;
  readonly note: string;
}

/**
 * 不予立案理由快照（#226 评论 6410041963）：两类互斥必选其一。
 * (a) non-filing-grounds＝不符合立案条件，勾选第十六条（一）–（五）中未满足的项（至少一项）；
 * (b) minor-corrected-no-harm＝第十六条末款「违法行为轻微并及时纠正，没有造成危害后果」（三项全确认且每项有说明）。
 */
export type NoCaseReason =
  | {
      readonly kind: 'non-filing-grounds';
      readonly grounds: readonly NonFilingGroundCode[];
      /** 可另附说明。 */
      readonly note?: string;
    }
  | {
      readonly kind: 'minor-corrected-no-harm';
      readonly minor: MinorElementConfirmation;
      readonly timelyCorrection: MinorElementConfirmation;
      readonly noHarm: MinorElementConfirmation;
    };

export type NoCaseReasonCheckOutcome =
  | { readonly ok: true; readonly reason: NoCaseReason }
  | { readonly ok: false; readonly rule: 'invalid-no-case-reason' };

function isFilledNote(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isGroundCode(value: unknown): value is NonFilingGroundCode {
  return typeof value === 'string' && (NON_FILING_GROUND_CODES as readonly string[]).includes(value);
}

/**
 * 校验不予立案理由（#226）：两类互斥；皆空或混选拒绝；末款三项仅确认部分拒绝。
 * 接受未知结构的入参，解析为规范快照或拒绝。
 */
export function checkNoCaseReason(input: unknown): NoCaseReasonCheckOutcome {
  if (input === null || typeof input !== 'object') {
    return { ok: false, rule: 'invalid-no-case-reason' };
  }
  const raw = input as Record<string, unknown>;
  const kind = raw.kind;

  if (kind === 'non-filing-grounds') {
    if (raw.minor != null || raw.timelyCorrection != null || raw.noHarm != null) {
      return { ok: false, rule: 'invalid-no-case-reason' };
    }
    const list = Array.isArray(raw.grounds) ? raw.grounds : null;
    if (list === null || list.length === 0) return { ok: false, rule: 'invalid-no-case-reason' };
    if (!list.every(isGroundCode)) return { ok: false, rule: 'invalid-no-case-reason' };
    const grounds = [...new Set(list as NonFilingGroundCode[])];
    const note = isFilledNote(raw.note) ? raw.note.trim() : undefined;
    return {
      ok: true,
      reason:
        note === undefined
          ? { kind: 'non-filing-grounds', grounds }
          : { kind: 'non-filing-grounds', grounds, note },
    };
  }

  if (kind === 'minor-corrected-no-harm') {
    if (Array.isArray(raw.grounds) && raw.grounds.length > 0) {
      return { ok: false, rule: 'invalid-no-case-reason' };
    }
    const elements: Partial<Record<MinorElementKey, MinorElementConfirmation>> = {};
    for (const key of MINOR_ELEMENT_KEYS) {
      const item = raw[key];
      if (item === null || typeof item !== 'object') {
        return { ok: false, rule: 'invalid-no-case-reason' };
      }
      const row = item as Record<string, unknown>;
      if (row.confirmed !== true || !isFilledNote(row.note)) {
        return { ok: false, rule: 'invalid-no-case-reason' };
      }
      elements[key] = { confirmed: true, note: (row.note as string).trim() };
    }
    return {
      ok: true,
      reason: {
        kind: 'minor-corrected-no-harm',
        minor: elements.minor!,
        timelyCorrection: elements.timelyCorrection!,
        noHarm: elements.noHarm!,
      },
    };
  }

  // kind 缺失：两类字段并存＝混选；只带一类则按该类解析；皆空拒绝。
  if (kind === undefined || kind === null || kind === '') {
    const groundsList = Array.isArray(raw.grounds) ? raw.grounds : [];
    const minorPresent = MINOR_ELEMENT_KEYS.some((key) => raw[key] != null);
    if (groundsList.length > 0 && minorPresent) {
      return { ok: false, rule: 'invalid-no-case-reason' };
    }
    if (groundsList.length > 0) {
      return checkNoCaseReason({ ...raw, kind: 'non-filing-grounds' });
    }
    if (minorPresent) {
      return checkNoCaseReason({ ...raw, kind: 'minor-corrected-no-harm' });
    }
    return { ok: false, rule: 'invalid-no-case-reason' };
  }

  return { ok: false, rule: 'invalid-no-case-reason' };
}

/** 处置类型对应的终态：不予立案／随旧线索办结／其他进 closed；移送进 transferred_out。 */

export const DISPOSITION_TERMINAL_STATUS: Readonly<Record<string, string>> = {
  'no-case': 'closed',
  'with-old': 'closed',
  other: 'closed',
  transfer: 'transferred_out',
};

/**
 * 处置登记可用的起始状态：不予立案／其他仅已派承办人；随旧线索办结仅「不派」；
 * 移送可在待分派池、已派机构与已派承办人发起（规格 D 节）。
 */
export const DISPOSITION_FROM_STATUSES: Readonly<Record<string, readonly string[]>> = {
  'no-case': [DISPOSITION_RECORD_FROM_STATUS],
  'with-old': [WITHDRAW_FROM_STATUS],
  other: [DISPOSITION_RECORD_FROM_STATUS],
  transfer: ['in_pool', 'org_assigned', 'handler_assigned'],
};

/** 提醒处理的输入校验结果。 */
export type ReminderResolveCheckOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly rule:
        | 'missing-withdraw-reason'
        | 'missing-withdraw-note'
        | 'invalid-withdraw-reason'
        | 'missing-disposition-fields'
        | 'unsupported-disposition';
    };

/**
 * 提醒处理校验（规格 D 节）：处理人二选一。
 * 选「撤回不派再办」走撤回的四项原因与补充说明校验；
 * 选「写明原因随旧线索办结」只要求说明必填。
 */
export function checkReminderResolve(input: {
  readonly resolution: string;
  readonly reasonCodes: readonly string[];
  readonly note: string;
}): ReminderResolveCheckOutcome {
  if (input.resolution === 'withdraw') {
    const checked = checkWithdrawInput({ reasonCodes: input.reasonCodes, note: input.note });
    return checked.ok ? { ok: true } : { ok: false, rule: checked.rule };
  }
  if (input.resolution === 'close-with-old') {
    return checkDispositionNote(input.note).ok
      ? { ok: true }
      : { ok: false, rule: 'missing-disposition-fields' };
  }
  return { ok: false, rule: 'unsupported-disposition' };
}
