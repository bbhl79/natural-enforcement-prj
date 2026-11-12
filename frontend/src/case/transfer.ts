// 用途：案件移送页的路由 loader 与视图类型、移送种类与层级名称。
// 调用方：frontend/src/router.tsx 的 case-transfer 路由；CaseTransferSection.tsx 使用两个名称常量。
// 边界：只读；响应非 2xx 时返回 view 为 null，由页面展示空态。
// 接口：GET /api/cases/:id/transfers；操作码 case.read。
// 移送页取数（#242）。页面只展示服务端给出的记载、回证与外部决定。

import { apiFetch } from '../api';
import type { SessionStore } from '../session';

/** 移送记载视图：一次移送的受移送机构、文号与回证齐全情况。 */
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

/** 移送呈批视图：审批状态、决定期限与附件。 */
export interface TransferApprovalView {
  readonly id: string;
  readonly kind: string;
  readonly kindName: string;
  readonly status: string;
  readonly decisionDueOn: string | null;
  readonly attachments: readonly string[];
}

/** 涉刑决定视图：来源、通知日期、是否退回与倒计时。 */
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

/** 涉刑移送出口视图：关联决定、出口类型与状态。 */
export interface CriminalOutletView {
  readonly id: string;
  readonly decisionId: string;
  readonly outlet: string;
  readonly outletName: string;
  readonly status: string;
}

/** 移送页整页视图：移送链、记载、呈批、涉刑决定与出口。 */
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

/** 移送页 loader：按路由参数 caseId 请求移送视图；请求失败时返回空视图，不抛错。 */
export function transferLoader(store: SessionStore) {
  return async ({ params }: { params: { caseId?: string } }) => {
    const caseId = params.caseId ?? '';
    const response = await apiFetch(store.dispatch, `/api/cases/${caseId}/transfers`);
    if (!response.ok) return { view: null as TransferView | null };
    return { view: (await response.json()) as TransferView };
  };
}

/** 移送种类下拉选项：值对应后端移送 kind，标签为中文名称。 */
export const TRANSFER_KIND_OPTIONS = [
  { value: 'jurisdiction', label: '管辖移送' },
  { value: 'criminal', label: '涉刑移送' },
  { value: 'party-discipline', label: '党纪政务移送' },
] as const;

/** 移送审批层级的中文名称，按后端返回的 level 键取值。 */
export const TRANSFER_LEVEL_NAMES: Readonly<Record<string, string>> = {
  review: '承办机构负责人审核',
  approve: '部门负责人批准',
};