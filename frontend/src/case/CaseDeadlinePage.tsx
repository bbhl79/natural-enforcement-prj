import { useState } from 'react';
import { useLoaderData, useRevalidator } from 'react-router';

import { apiFetch } from '../api';
import { useAppDispatch } from '../hooks';
import { DeadlinePanel, type DeadlineView, type PeriodDraftInput } from './DeadlinePanel';

export default function CaseDeadlinePage() {
  const data = useLoaderData() as { view: DeadlineView | null };
  const dispatch = useAppDispatch();
  const revalidator = useRevalidator();
  const [message, setMessage] = useState<string | null>(null);
  if (!data.view) return <p>当前不能查看这个案件的期限。</p>;
  const view = data.view;

  async function send(path: string, body: unknown): Promise<void> {
    const response = await apiFetch(dispatch, path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as { message?: string };
    setMessage(payload.message ?? (response.ok ? '已提交' : '未能提交'));
    if (response.ok) revalidator.revalidate();
  }

  return (
    <DeadlinePanel
      view={view}
      message={message}
      onExtend={(days, reason) => {
        void send(`/api/cases/${view.caseId}/deadline-extensions`, { days, reason });
      }}
      onPeriod={(input: PeriodDraftInput) => {
        void send(`/api/cases/${view.caseId}/period-events`, input);
      }}
    />
  );
}
