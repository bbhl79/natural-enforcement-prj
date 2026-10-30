// 定型（E13／T27）的纯规则（#243）。判定在这里，服务层只喂事实与落库。
// 归档审批走既有 doc.* 呈批链：拟制、提交、审核、批准，不新增操作码。
// 缺件或移送回证缺失时，主办须写明理由；呈批批准后结论记「经批准缺项」，理由随卷保存。

import type { DossierCompleteness } from './materials.ts';

export const FINALIZE_APPROVAL_STATUSES = [
  'drafting',
  'pending_review',
  'pending_approval',
  'approved',
] as const;
export type FinalizeApprovalStatus = (typeof FINALIZE_APPROVAL_STATUSES)[number];

export const FINALIZE_CONTENT_RULE_ID = 'cfg.rule.finalize-content.v1';
export const FINALIZE_CONTENT_VERSION = '1';

export interface FinalizeContent {
  /** 缺件或回证缺失时的理由。无缺件时为空。 */
  readonly missingReason: string | null;
  readonly note: string | null;
}

export interface FinalizeContentHit {
  readonly httpStatus: 400;
  readonly reason: 'invalid-content' | 'invalid-missing-reason';
  readonly message: string;
  readonly outlet: string;
}

export type FinalizeContentRead =
  | { readonly ok: true; readonly content: FinalizeContent }
  | { readonly ok: false; readonly hit: FinalizeContentHit };

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalText(value: unknown): string | null {
  const parsed = text(value);
  return parsed === '' ? null : parsed;
}

/** 归档审批正文校验。理由与说明都按空串视同未填。 */
export function readFinalizeContent(raw: unknown): FinalizeContentRead {
  if (raw == null) {
    return {
      ok: true,
      content: { missingReason: null, note: null },
    };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      hit: {
        httpStatus: 400,
        reason: 'invalid-content',
        message: '归档审批正文不合规',
        outlet: '按归档审批表填写',
      },
    };
  }
  const body = raw as Record<string, unknown>;
  if (body.missingReason != null && typeof body.missingReason !== 'string') {
    return {
      ok: false,
      hit: {
        httpStatus: 400,
        reason: 'invalid-missing-reason',
        message: '缺件理由只能是文字',
        outlet: '改写缺件理由',
      },
    };
  }
  if (body.note != null && typeof body.note !== 'string') {
    return {
      ok: false,
      hit: {
        httpStatus: 400,
        reason: 'invalid-content',
        message: '归档审批说明只能是文字',
        outlet: '改写说明',
      },
    };
  }
  return {
    ok: true,
    content: { missingReason: optionalText(body.missingReason), note: optionalText(body.note) },
  };
}

export const FINALIZE_MISSING_REASON_MESSAGE = '卷宗缺件须写明理由，经归档审批批准后才可定型';
export const FINALIZE_MISSING_REASON_OUTLET = '补齐缺件，或写明缺件理由后提交归档审批';
export const FINALIZE_RECEIPT_MISSING_MESSAGE = '移送回证缺失须写明理由，经归档审批批准后才可定型';
export const FINALIZE_RECEIPT_MISSING_OUTLET = '补传回证，或写明回证缺失理由后提交归档审批';
export const FINALIZE_INVALID_CONTENT_MESSAGE = '归档审批稿不合规';
export const FINALIZE_INVALID_CONTENT_OUTLET = '重新保存归档审批稿';

export interface FinalizeBlock {
  readonly reason: 'materials-incomplete' | 'receipt-missing';
  readonly message: string;
  readonly outlet: string;
}

/** 缺件或回证缺失且没有理由时的阻断。有理由时返回 null。 */
export function finalizeBlockOf(completeness: DossierCompleteness): FinalizeBlock | null {
  if (!completeness.blocked) return null;
  if (completeness.missingItems.length > 0) {
    return {
      reason: 'materials-incomplete',
      message: FINALIZE_MISSING_REASON_MESSAGE,
      outlet: FINALIZE_MISSING_REASON_OUTLET,
    };
  }
  return {
    reason: 'receipt-missing',
    message: FINALIZE_RECEIPT_MISSING_MESSAGE,
    outlet: FINALIZE_RECEIPT_MISSING_OUTLET,
  };
}