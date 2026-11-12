// 用途：案件定型页的路由 loader、视图类型与状态名称常量。
// 调用方：frontend/src/router.tsx 的 case-finalize 路由；CaseFinalizeSection.tsx 使用常量与状态判定。
// 边界：只读；响应非 2xx 时返回 view 为 null，由页面展示空态。
// 接口：GET /api/cases/:id/finalize；操作码 case.read。
// 定型页取数（#243）。页面只展示服务端给出的必需材料、缺件与定型状态。

import { apiFetch } from '../api';
import type { SessionStore } from '../session';

/** 定型材料清单行：一项材料的必需、豁免、在卷与缺件状态。 */
export interface FinalizeChecklistRow {
  readonly itemCode: number;
  readonly itemName: string;
  readonly required: boolean;
  readonly exempt: boolean;
  readonly present: boolean;
  readonly current: boolean;
  readonly missing: boolean;
}

/** 定型呈批视图：审批状态、版本号、拟制人与缺件说明。 */
export interface FinalizeApprovalView {
  readonly id: string;
  readonly status: string;
  readonly currentVersionNo: number;
  readonly drafterId: string;
  readonly missingReason: string | null;
  readonly note: string | null;
}

/** 定型记录视图：结论、缺件原因、清单快照与定型时间。 */
export interface FinalizeRecordView {
  readonly id: string;
  readonly generationNo: number;
  readonly conclusion: string;
  readonly conclusionName: string;
  readonly missingReason: string | null;
  readonly receiptDeficient: boolean;
  readonly checklist: readonly FinalizeChecklistRow[];
  readonly finalizedAt: string;
}

/** 定型页整页视图：材料规则、清单、缺件、回证齐全与就绪判定。 */
export interface FinalizeView {
  readonly caseId: string;
  readonly status: string;
  readonly currentStage: string;
  readonly materialsRule: { readonly ruleId: string; readonly version: string; readonly basis: string };
  readonly requirement: {
    readonly requiredItems: readonly number[];
    readonly exemptItems: readonly number[];
    readonly deliveryRequired: boolean;
  };
  readonly checklist: readonly FinalizeChecklistRow[];
  readonly missingItems: readonly number[];
  readonly receipt: {
    readonly complete: boolean;
    readonly transfers: readonly { readonly id: string; readonly kind: string; readonly documentNo: string }[];
  };
  readonly readiness: {
    readonly reasonRequired: boolean;
    readonly blocked: boolean;
    readonly conclusion: string | null;
    readonly conclusionName: string | null;
  };
  readonly approval: FinalizeApprovalView | null;
  readonly finalize: FinalizeRecordView | null;
}

/** 定型呈批状态的中文名称，按后端返回的 status 键取值。 */
export const FINALIZE_APPROVAL_STATUS_NAMES: Readonly<Record<string, string>> = {
  drafting: '拟制中',
  pending_review: '待审核',
  pending_approval: '待批准',
  approved: '已批准',
};

/** 案件状态的中文名称，按后端返回的 status 键取值。 */
export const FINALIZE_CASE_STATUS_NAMES: Readonly<Record<string, string>> = {
  closed: '已结案',
  withdrawn: '已撤案',
  finalized: '已定型',
};

/** 判断案件状态是否允许发起定型：仅已结案或已撤案返回 true。 */
export function canStartFinalize(status: string): boolean {
  return status === 'closed' || status === 'withdrawn';
}

/** 定型页 loader：按路由参数 caseId 请求定型视图；请求失败时返回空视图，不抛错。 */
export function finalizeLoader(store: SessionStore) {
  return async ({ params }: { params: { caseId?: string } }) => {
    const caseId = params.caseId ?? '';
    const response = await apiFetch(store.dispatch, `/api/cases/${caseId}/finalize`);
    if (!response.ok) return { view: null as FinalizeView | null };
    return { view: (await response.json()) as FinalizeView };
  };
}