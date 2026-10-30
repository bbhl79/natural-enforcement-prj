// 有效性确认与重新告知的最小入口（#248）。页面只展示服务端给出的差异、闸口与可办项。

export interface ValidityHitView {
  code: string;
  message: string;
  violationRecordId: string | null;
}

export interface ValidityDifferenceView {
  violationRecordId: string | null;
  field: string;
  change: string;
  before: unknown;
  after: unknown;
}

export interface ValidityGroupView {
  violationRecordId: string | null;
  items: ValidityDifferenceView[];
}

export interface ValidityConfirmationView {
  id: string;
  noticeId: string;
  conclusion: string;
  reason: string;
  reasonChanged: boolean;
  structured?: unknown;
  aggravation: { source: string; reference: string; reason: string } | null;
  review: { conclusion: string; opinion: string | null } | null;
}

export interface ValidityView {
  caseId: string;
  currentStage: string;
  stageEntrySeq: number;
  notice: { id: string; entrySeq: number; kind: string; servedOn: string | null } | null;
  baseline: { noticeId: string; entrySeq: number; digest: string } | null;
  current: { digest: string; parties: string[] } | null;
  systemHits: ValidityHitView[];
  groups: ValidityGroupView[];
  q14: Array<{ noticeId: string; hitCodes: string[]; satisfied: boolean }>;
  confirmation: ValidityConfirmationView | null;
  confirmations: ValidityConfirmationView[];
  gate: { ok: true } | { ok: false; block: { code: string; message: string; outlet: string } };
  entries: { confirm: boolean; review: boolean; aggravation: boolean; reissue: boolean };
}

export const VALIDITY_REISSUE_OPTIONS = [
  { code: 'A1', label: 'A1 当事人变更或增加' },
  { code: 'A2', label: 'A2 违法记录增加' },
  { code: 'A3', label: 'A3 依据条款变更' },
  { code: 'A4', label: 'A4 罚种增加或加重' },
  { code: 'A5', label: 'A5 罚款金额上调' },
  { code: 'A6', label: 'A6 新命中应听证' },
  { code: 'B1b', label: 'B1b 同一违法记录内事实收窄' },
  { code: 'reason-changed', label: '理由已变化' },
  { code: 'R7', label: 'R7 法律依据变化' },
] as const;

export const AGRAVATION_OPTIONS = [
  { code: 'reflow-new-evidence', label: '回流取得的新事实、新证据' },
  { code: 'r4-qualification-correction', label: 'R4 定性或法律适用纠正' },
] as const;

export function ValidityPanel({ view }: { view: ValidityView }) {
  const unreviewed = view.confirmations.find((row) => row.review === null) ?? null;
  return (
    <section data-role="case-validity">
      <p data-role="validity-stage">
        当前环节 {view.currentStage}（第 {view.stageEntrySeq} 次进入）
      </p>
      {view.notice ? (
        <p data-role="validity-notice">
          原告知第 {view.notice.entrySeq} 次，送达日 {view.notice.servedOn ?? '未记录'}
        </p>
      ) : null}
      {view.gate.ok ? (
        <p data-role="validity-gate-status">有效性闸口当前可通过。</p>
      ) : (
        <p data-role="validity-gate-status">
          {view.gate.block.message}；{view.gate.block.outlet}
        </p>
      )}
      {view.systemHits.length > 0 ? (
        <ul data-role="validity-hits">
          {view.systemHits.map((row) => (
            <li key={`${row.code}-${row.violationRecordId ?? 'case'}`}>
              {row.code} {row.message}
            </li>
          ))}
        </ul>
      ) : null}
      {view.groups.length > 0 ? (
        <div data-role="validity-differences">
          <h2>差异清单</h2>
          {view.groups.map((group) => (
            <section key={group.violationRecordId ?? 'case'} data-role="validity-difference-group">
              <h3>{group.violationRecordId ?? '整体'}</h3>
              <ul>
                {group.items.map((item, index) => (
                  <li key={`${item.field}-${item.change}-${index}`}>
                    {item.field} {item.change}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
      {view.q14.length > 0 ? (
        <ul data-role="validity-q14">
          {view.q14.map((row) => (
            <li key={row.noticeId}>
              {row.hitCodes.join('、')}；加重来源{row.satisfied ? '已填' : '未填'}
            </li>
          ))}
        </ul>
      ) : null}
      {view.entries.confirm ? (
        <form data-role="validity-confirmation">
          <h2>有效性确认</h2>
          <label>
            结论
            <select name="conclusion" data-role="confirm-conclusion">
              <option value="valid">有效</option>
              <option value="invalid">失效</option>
            </select>
          </label>
          <label>
            理由
            <textarea name="reason" data-role="confirm-reason" />
          </label>
          <label>
            <input type="checkbox" name="reasonChanged" data-role="confirm-reason-changed" />
            理由已变化（系统判失效）
          </label>
          {view.entries.aggravation ? (
            <div data-role="aggravation-source">
              <label>
                加重来源
                <select name="aggravationSource" data-role="aggravation-kind">
                  {AGRAVATION_OPTIONS.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                回流或退回记录标识
                <input name="aggravationReference" data-role="aggravation-reference" />
              </label>
              <label>
                加重理由
                <textarea name="aggravationReason" data-role="aggravation-reason" />
              </label>
            </div>
          ) : null}
        </form>
      ) : null}
      {view.entries.review && unreviewed ? (
        <form data-role="validity-review">
          <h2>复核有效性确认</h2>
          <p data-role="review-confirmation-id">{unreviewed.id}</p>
          <label>
            复核结论
            <select name="conclusion" data-role="review-conclusion">
              <option value="pass">通过</option>
              <option value="fail">不通过</option>
            </select>
          </label>
          <label>
            复核意见
            <textarea name="opinion" data-role="review-opinion" />
          </label>
        </form>
      ) : null}
      {view.entries.reissue ? (
        <form data-role="notice-reissue">
          <h2>重新告知</h2>
          <label>
            原因
            <select name="reason" data-role="reissue-reason">
              {VALIDITY_REISSUE_OPTIONS.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            说明
            <textarea name="note" data-role="reissue-note" />
          </label>
          <p data-role="reissue-notice">撤销原告知书，E05 再进入一次；90 日办案期限不重置。</p>
        </form>
      ) : null}
      <form data-role="validity-gate">
        <h2>决定呈批前有效性闸口</h2>
        <p>供决定审批链在领导审批前调用。</p>
      </form>
    </section>
  );
}