// 期限最小入口（#246）。延长呈批、期间事件登记或补登、查看到期日。

import type { FormEvent } from 'react';

export interface DeadlineRowView {
  id: string;
  ruleKey: string;
  entrySeq: number;
  procedureNode: string;
  startingDocument: string | null;
  consumptionName: string;
  ruleVersion: string;
  dayCount: number;
  dayBasis: string;
  dueOn: string | null;
  needsManualConfirmation: boolean;
  confirmationTrace: string | null;
  rowStatus: string;
  revisionNo: number;
}

export interface DeadlineView {
  caseId: string;
  sourceUrl: string;
  asOf: string;
  blocked: boolean;
  prompts: string[];
  handling: { startedOn: string; dueOn: string | null; paused: boolean } | null;
  rows: DeadlineRowView[];
}

export interface PeriodDraftInput {
  eventKind: string;
  reason: string;
  basisLabel: string;
  startedOn: string;
  endedOn: string;
  backfill: boolean;
}

export function DeadlinePanel({
  view,
  message,
  onExtend,
  onPeriod,
}: {
  view: DeadlineView;
  message: string | null;
  onExtend: (days: number, reason: string) => void;
  onPeriod: (input: PeriodDraftInput) => void;
}) {
  return (
    <section data-role="deadline">
      <h1>办案期限</h1>
      <p data-role="calendar-source">{view.sourceUrl}</p>
      {view.handling ? (
        <p data-role="due-date">
          到期日 {view.handling.dueOn ?? '停表'}，起算日 {view.handling.startedOn}
        </p>
      ) : (
        <p data-role="due-date">尚未生成办案期限</p>
      )}
      {view.prompts.map((prompt) => (
        <p data-role="deadline-prompt" key={prompt}>
          {prompt}
        </p>
      ))}
      <ul>
        {view.rows.map((row) => (
          <li key={row.id}>
            {row.ruleKey} 第 {row.entrySeq} 次 {row.consumptionName} {row.ruleVersion}{' '}
            {row.dueOn ?? row.confirmationTrace ?? '待确认'}
          </li>
        ))}
      </ul>
      <form
        data-role="extension-draft"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          onExtend(Number(data.get('days')), String(data.get('reason') ?? ''));
        }}
      >
        <h2>延长办案期限</h2>
        <label>
          延长天数
          <input name="days" type="number" min={1} defaultValue={30} />
        </label>
        <label>
          理由
          <input name="reason" type="text" />
        </label>
        <button type="submit">提交延长呈批</button>
      </form>
      <form
        data-role="period-draft"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          onPeriod({
            eventKind: String(data.get('eventKind') ?? ''),
            reason: String(data.get('reason') ?? ''),
            basisLabel: String(data.get('basisLabel') ?? ''),
            startedOn: String(data.get('startedOn') ?? ''),
            endedOn: String(data.get('endedOn') ?? ''),
            backfill: data.get('backfill') === 'on',
          });
        }}
      >
        <h2>期间事件登记或补登</h2>
        <label>
          类别
          <select name="eventKind" defaultValue="in-transit">
            <option value="appraisal">鉴定</option>
            <option value="hearing">听证</option>
            <option value="announcement">公告</option>
            <option value="in-transit">在途</option>
            <option value="criminal-wait">涉刑等待</option>
            <option value="business-exclusion">业务排除</option>
          </select>
        </label>
        <label>
          理由
          <input name="reason" type="text" />
        </label>
        <label>
          依据
          <input name="basisLabel" type="text" />
        </label>
        <label>
          开始日
          <input name="startedOn" type="date" />
        </label>
        <label>
          结束日
          <input name="endedOn" type="date" />
        </label>
        <label>
          <input name="backfill" type="checkbox" />
          补登
        </label>
        <button type="submit">提交期间事件呈批</button>
      </form>
      {message ? <p data-role="deadline-message">{message}</p> : null}
    </section>
  );
}
