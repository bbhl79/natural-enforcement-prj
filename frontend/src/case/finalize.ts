// 定型页取数（#243）。页面只展示服务端给出的必需材料、缺件与定型状态。

import { apiFetch } from '../api';
import type { SessionStore } from '../session';

export interface FinalizeChecklistRow {
  readonly itemCode: number;
  readonly itemName: string;
  readonly required: boolean;
  readonly exempt: boolean;
  readonly present: boolean;
  readonly current: boolean;
  readonly missing: boolean;
}

export interface FinalizeApprovalView {
  readonly id: string;
  readonly status: string;
  readonly currentVersionNo: number;
  readonly drafterId: string;
  readonly missingReason: string | null;
  readonly note: string | null;
}

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

export const FINALIZE_APPROVAL_STATUS_NAMES: Readonly<Record<string, string>> = {
  drafting: '拟制中',
  pending_review: '待审核',
  pending_approval: '待批准',
  approved: '已批准',
};

export const FINALIZE_CASE_STATUS_NAMES: Readonly<Record<string, string>> = {
  closed: '已结案',
  withdrawn: '已撤案',
  finalized: '已定型',
};

export function canStartFinalize(status: string): boolean {
  return status === 'closed' || status === 'withdrawn';
}

export function finalizeLoader(store: SessionStore) {
  return async ({ params }: { params: { caseId?: string } }) => {
    const caseId = params.caseId ?? '';
    const response = await apiFetch(store.dispatch, `/api/cases/${caseId}/finalize`);
    if (!response.ok) return { view: null as FinalizeView | null };
    return { view: (await response.json()) as FinalizeView };
  };
}