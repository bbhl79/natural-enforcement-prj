// 用途：案件调查环节展示面板，按服务端给出的入口列出各调查动作与中止呈批表单。
// 调用方：frontend/src/case/CaseInvestigationPage.tsx，测试经 InvestigationPanel 与 SuspendDraftForm 挂载。
// 调查环节最小入口（#236）。中止呈批的延长勾选不是必填。

/** 调查环节整页视图：当前阶段、中止标记、提示与各动作入口开关。 */
export interface InvestigationView {
  id: string;
  status: string;
  currentStage: string;
  suspended: boolean;
  prompts: { extendDeadline: string; partyNotice: string };
  entries: {
    inquiry: boolean;
    violation: boolean;
    suspend: boolean;
    resume: boolean;
    terminate: boolean;
    withdraw: boolean;
    close: boolean;
  };
}

/** 中止呈批表单：勾选是否同时办延长，并提示三个工作日内书面告知当事人。 */
export function SuspendDraftForm({ extendTogether }: { extendTogether: boolean }) {
  return (
    <form data-role="suspend-draft">
      <label>
        <input type="checkbox" data-role="extend-together" defaultChecked={extendTogether} />
        是否同时办延长办案期限
      </label>
      <p>须在三个工作日内书面告知当事人</p>
    </form>
  );
}

/** 调查面板：只读渲染服务端允许的调查动作入口与期限链接。 */
export function InvestigationPanel({ view }: { view: InvestigationView }) {
  return (
    <section data-role="investigation">
      <p>
        <a data-role="deadline-link" href={`/case/${view.id}/deadline`}>
          查看期限
        </a>
      </p>
      {view.entries.inquiry ? <h2>笔录登记</h2> : null}
      {view.entries.violation ? <h2>违法记录登记与作废</h2> : null}
      {view.entries.suspend ? (
        <div>
          <h2>中止呈批</h2>
          <SuspendDraftForm extendTogether={false} />
          <p>{view.prompts.partyNotice}</p>
        </div>
      ) : null}
      {view.entries.resume ? <h2>恢复呈批</h2> : null}
      {view.entries.terminate ? <h2>终止调查呈批</h2> : null}
      {view.entries.withdraw ? <h2>撤案呈批</h2> : null}
      {view.entries.close ? <h2>结案呈批</h2> : null}
    </section>
  );
}
