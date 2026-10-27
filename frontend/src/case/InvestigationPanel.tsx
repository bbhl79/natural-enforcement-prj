// 调查环节最小入口（#236）。中止呈批的延长勾选不是必填。

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

export function InvestigationPanel({ view }: { view: InvestigationView }) {
  return (
    <section data-role="investigation">
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
