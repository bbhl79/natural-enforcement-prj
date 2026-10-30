// 移送页取数（#242）。页面只展示服务端给出的记载、回证与外部决定。

import { apiFetch } from '../api';
import type { SessionStore } from '../session';

export interface TransferRecordView {
  readonly id: string;
  readonly kind: string;
  readonly kindName: string;
  readonly receivingOrg: string;
  readonly documentNo: string;
  readonly letterDate: string;
  readonly reason: string;
  readonly recordedAt: string;
  readonly receiptCount: number;
  readonly receiptsComplete: boolean;
}

export interface TransferApprovalView {
  readonly id: string;
  readonly kind: string;
  readonly kindName: string;
  readonly status: string;
  readonly decisionDueOn: string | null;
  readonly attachments: readonly string[];
}

export interface CriminalDecisionView {
  readonly id: string;
  readonly source: string;
  readonly sourceName: string;
  readonly notifiedOn: string;
  readonly reason: string;
  readonly caseReturned: boolean;
  readonly returnedList: readonly string[];
  readonly countdown: {
    readonly dueOn: string | null;
    readonly expired: boolean;
    readonly warning: { readonly level: string; readonly code: string; readonly message: string };
  };
}

export interface CriminalOutletView {
  readonly id: string;
  readonly decisionId: string;
  readonly outlet: string;
  readonly outletName: string;
  readonly status: string;
}

export interface TransferView {
  readonly caseId: string;
  readonly chain: {
    readonly ruleId: string;
    readonly version: string;
    readonly basis: string;
    readonly levels: readonly string[];
  };
  readonly transfers: readonly TransferRecordView[];
  readonly receiptsComplete: boolean;
  readonly approvals: readonly TransferApprovalView[];
  readonly criminalTransferReviewPass: string | null;
  readonly criminalDecisions: readonly CriminalDecisionView[];
  readonly outlets: readonly CriminalOutletView[];
}

export function transferLoader(store: SessionStore) {
  return async ({ params }: { params: { caseId?: string } }) => {
    const caseId = params.caseId ?? '';
    const response = await apiFetch(store.dispatch, `/api/cases/${caseId}/transfers`);
    if (!response.ok) return { view: null as TransferView | null };
    return { view: (await response.json()) as TransferView };
  };
}

export const TRANSFER_KIND_OPTIONS = [
  { value: 'jurisdiction', label: '管辖移送' },
  { value: 'criminal', label: '涉刑移送' },
  { value: 'party-discipline', label: '党纪政务移送' },
] as const;

export const TRANSFER_LEVEL_NAMES: Readonly<Record<string, string>> = {
  review: '承办机构负责人审核',
  approve: '部门负责人批准',
};