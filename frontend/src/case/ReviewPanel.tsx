// 调查报告呈批、指定审理人、审理意见签出、审理异议呈批的最小入口（#240）。
// 页面只展示服务端给出的入口与提示，不自行判断权限。

export interface ReviewView {
  id: string;
  status: string;
  currentStage: string;
  stageEntrySeq: number;
  suspended: boolean;
  entries: {
    report: boolean;
    designate: boolean;
    sign: boolean;
    objection: boolean;
  };
  reviewer: { personnelId: string; reason: string | null } | null;
  opinions: Array<{ id: string; kind: string; destinationCode: string }>;
  objections: Array<{ id: string; status: string; decision: string | null }>;
  prompts: { reviewer: string | null };
}

export const REVIEW_OPINION_OPTIONS = [
  { code: 'supplementary-investigation', label: '补充调查' },
  { code: 'correction', label: '修改纠正' },
  { code: 'penalty', label: '拟处罚' },
  { code: 'no-penalty', label: '拟不予处罚' },
  { code: 'fact-not-established', label: '事实不成立' },
  { code: 'limitation-expired', label: '已过追诉时效' },
] as const;

export function ReviewPanel({ view }: { view: ReviewView }) {
  return (
    <section data-role="case-review">
      <p data-role="review-stage">
        当前环节 {view.currentStage}（第 {view.stageEntrySeq} 次进入）
      </p>
      {view.prompts.reviewer ? <p data-role="reviewer-prompt">{view.prompts.reviewer}</p> : null}
      {view.entries.report ? (
        <form data-role="review-report">
          <h2>调查报告呈批</h2>
          <p>每条有效违法记录都要写处理建议；罚款竞合须写比对理由。</p>
          <label>
            可选指定审理人
            <input name="reviewerId" data-role="report-reviewer" />
          </label>
        </form>
      ) : null}
      {view.entries.designate ? (
        <form data-role="reviewer-designation">
          <h2>指定或更换审理人</h2>
          <label>
            被指定人
            <input name="personnelId" data-role="designation-person" />
          </label>
          <label>
            更换理由
            <input name="reason" data-role="designation-reason" />
          </label>
          <p data-role="separation-notice">被指定人为本案主办或协办时须填理由并确认。</p>
        </form>
      ) : null}
      {view.entries.sign ? (
        <form data-role="review-opinion">
          <h2>审理意见签出</h2>
          <label>
            意见类型
            <select name="kind" data-role="opinion-kind">
              {REVIEW_OPINION_OPTIONS.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            审理意见
            <textarea name="content" data-role="opinion-content" />
          </label>
          <p data-role="x22-notice">本案承办人员签出时返回警告，确认后继续。</p>
        </form>
      ) : null}
      {view.entries.objection ? (
        <form data-role="review-objection">
          <h2>审理异议呈批</h2>
          <label>
            异议理由
            <textarea name="note" data-role="objection-note" />
          </label>
          <label>
            证据引用
            <input name="evidenceRefs" data-role="objection-evidence" />
          </label>
          <p data-role="objection-notice">报负责人决定，不作为退回。</p>
        </form>
      ) : null}
    </section>
  );
}