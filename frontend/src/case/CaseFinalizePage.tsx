// 用途：案件定型页，发起与保存定型拟制，提交、审核、批准归档审批。
// 调用方：frontend/src/router.tsx 的 case-finalize 路由，路径 case/:caseId/finalize。
// 接口：GET /api/cases/:id/finalize（经定型页 loader）；POST /api/cases/:id/finalize、POST /api/finalize-approvals/:approvalId/submit、POST /api/finalize-approvals/:approvalId/review、POST /api/finalize-approvals/:approvalId/approve。
// 操作码：读取 case.read；拟制 doc.draft；提交 doc.submit；审核 doc.admin.review；批准 doc.approve。
// 定型页（#243）：查看定型状态与缺件，发起、提交、审核、批准归档审批。
import { useState } from 'react';
import { useLoaderData, useRevalidator } from 'react-router';

import { apiFetch } from '../api';
import { useAppDispatch } from '../hooks';
import { CaseFinalizeSection } from './CaseFinalizeSection';
import type { FinalizeView } from './finalize';

/** 定型页：无视图时展示不可查看提示，否则把拟制与审批动作接到定型面板。 */
export default function CaseFinalizePage() {
  const data = useLoaderData() as { view: FinalizeView | null };
  const dispatch = useAppDispatch();
  const revalidator = useRevalidator();
  const [message, setMessage] = useState<string | null>(null);
  if (!data.view) return <p>当前不能查看这个案件的定型。</p>;
  const view = data.view;
  const approvalId = view.approval?.id ?? '';

  async function send(path: string, init: RequestInit): Promise<void> {
    const response = await apiFetch(dispatch, path, init);
    const payload = (await response.json().catch(() => ({}))) as { message?: string; reason?: string };
    setMessage(payload.message ?? payload.reason ?? (response.ok ? '已提交' : '未能提交'));
    if (response.ok) revalidator.revalidate();
  }

  return (
    <CaseFinalizeSection
      view={view}
      message={message}
      onSaveDraft={(input) => {
        void send(`/api/cases/${view.caseId}/finalize`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ missingReason: input.missingReason }),
        });
      }}
      onSubmit={() => {
        void send(`/api/finalize-approvals/${approvalId}/submit`, { method: 'POST' });
      }}
      onReview={() => {
        void send(`/api/finalize-approvals/${approvalId}/review`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ opinion: '同意' }),
        });
      }}
      onApprove={() => {
        void send(`/api/finalize-approvals/${approvalId}/approve`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ opinion: '同意' }),
        });
      }}
    />
  );
}