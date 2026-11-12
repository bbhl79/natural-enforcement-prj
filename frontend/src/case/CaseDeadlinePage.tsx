// 用途：案件期限页，展示服务端算出的到期日，提交期限延长与期间事件。
// 调用方：frontend/src/router.tsx 的 case-deadline 路由，路径 case/:caseId/deadline。
// 接口：GET /api/cases/:id/deadlines（经期限页 loader）；POST /api/cases/:id/deadline-extensions；POST /api/cases/:id/period-events。
// 操作码：读取 case.read；延长与期间事件 doc.draft。
import { useState } from 'react';
import { useLoaderData, useRevalidator } from 'react-router';

import { apiFetch } from '../api';
import { useAppDispatch } from '../hooks';
import { DeadlinePanel, type DeadlineView, type PeriodDraftInput } from './DeadlinePanel';

/** 期限页：无视图时展示不可查看提示，否则交给期限面板提交延长与期间事件。 */
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
