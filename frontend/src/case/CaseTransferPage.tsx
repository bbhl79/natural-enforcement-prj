// 移送页（#242）：发起移送呈批、上传或补传回证、登记外部决定与出口、结案前移送检查。
import { useState } from 'react';
import { useLoaderData, useRevalidator } from 'react-router';

import { apiFetch } from '../api';
import { useAppDispatch } from '../hooks';
import { CaseTransferSection } from './CaseTransferSection';
import type { TransferView } from './transfer';

export default function CaseTransferPage() {
  const data = useLoaderData() as { view: TransferView | null };
  const dispatch = useAppDispatch();
  const revalidator = useRevalidator();
  const [message, setMessage] = useState<string | null>(null);
  if (!data.view) return <p>当前不能查看这个案件的移送。</p>;
  const view = data.view;

  async function send(path: string, init: RequestInit): Promise<void> {
    const response = await apiFetch(dispatch, path, init);
    const payload = (await response.json().catch(() => ({}))) as { message?: string; reason?: string };
    setMessage(
      payload.message
        ?? payload.reason
        ?? (response.ok ? '已提交' : '未能提交'),
    );
    if (response.ok) revalidator.revalidate();
  }

  return (
    <CaseTransferSection
      view={view}
      message={message}
      canDraft
      onDraftTransfer={(input) => {
        const form = new FormData();
        form.set('kind', input.kind);
        form.set('receivingOrg', input.receivingOrg);
        form.set('documentNo', input.documentNo);
        form.set('letterDate', input.letterDate);
        form.set('reason', input.reason);
        for (const file of input.files) form.append('attachment', file, file.name);
        void send(`/api/cases/${view.caseId}/transfers`, { method: 'POST', body: form });
      }}
      onUploadReceipt={(transferId, files) => {
        const form = new FormData();
        for (const file of files) form.append('receipt', file, file.name);
        void send(`/api/cases/${view.caseId}/transfers/${transferId}/receipts`, { method: 'POST', body: form });
      }}
      onRecordDecision={(input) => {
        void send(`/api/cases/${view.caseId}/criminal-decisions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        });
      }}
      onDraftOutlet={(decisionId, input) => {
        void send(`/api/cases/${view.caseId}/criminal-decisions/${decisionId}/outlets`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        });
      }}
      onCloseoutGate={() => {
        void send(`/api/cases/${view.caseId}/closeout-gate`, { method: 'POST' });
      }}
    />
  );
}