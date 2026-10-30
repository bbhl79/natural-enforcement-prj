// 案件详情「定型」页签（#243）：查看必需材料与缺件、发起归档审批、查看定型状态。
import {
  FINALIZE_APPROVAL_STATUS_NAMES,
  FINALIZE_CASE_STATUS_NAMES,
  canStartFinalize,
  type FinalizeChecklistRow,
  type FinalizeView,
} from './finalize';

export interface CaseFinalizeSectionProps {
  readonly view: FinalizeView;
  readonly message: string | null;
  readonly onSaveDraft: (input: { readonly missingReason: string }) => void;
  readonly onSubmit: () => void;
  readonly onReview: () => void;
  readonly onApprove: () => void;
}

function necessityOf(row: FinalizeChecklistRow): string {
  if (row.exempt) return '可豁免';
  if (row.required) return '必需';
  return '辅助';
}

function stateOf(row: FinalizeChecklistRow): string {
  if (row.missing) return '缺件';
  if (row.present) return '已入卷';
  if (!row.current) return '非当前';
  return '未入卷';
}

export function CaseFinalizeSection(props: CaseFinalizeSectionProps) {
  const view = props.view;
  const approval = view.approval;
  const canDraft = canStartFinalize(view.status) && (approval === null || approval.status === 'drafting');

  return (
    <section data-role="case-finalize">
      <h1>定型</h1>
      {props.message ? <div className="help" data-role="finalize-failure">{props.message}</div> : null}

      <div className="card" data-role="finalize-status">
        <div className="card-h">定型状态</div>
        <p>
          案件状态：{FINALIZE_CASE_STATUS_NAMES[view.status] ?? view.status}
          {view.finalize
            ? `；已定型，代次 ${view.finalize.generationNo}，结论 ${view.finalize.conclusionName}`
            : '；尚未定型'}
        </p>
        {view.finalize?.missingReason ? <p>缺件理由：{view.finalize.missingReason}</p> : null}
        {view.finalize?.receiptDeficient ? <p>移送回证缺失已随归档审批批准。</p> : null}
        {approval ? (
          <p data-role="finalize-approval">
            归档审批：{FINALIZE_APPROVAL_STATUS_NAMES[approval.status] ?? approval.status}
          </p>
        ) : null}
      </div>

      <div className="card" data-role="finalize-materials">
        <div className="card-h">卷宗材料</div>
        <p>
          清单版本 {view.materialsRule.version}；必需项 {view.requirement.requiredItems.join('、') || '无'}
        </p>
        {view.receipt.transfers.length > 0 ? (
          <p data-role="finalize-receipt">
            移送回证：{view.receipt.complete ? '齐全' : '未齐全'}
          </p>
        ) : null}
        <table>
          <thead>
            <tr>
              <th>项号</th>
              <th>材料</th>
              <th>必要性</th>
              <th>现状</th>
            </tr>
          </thead>
          <tbody>
            {view.checklist.map((row) => (
              <tr key={row.itemCode} data-role="finalize-item">
                <td>{row.itemCode}</td>
                <td>{row.itemName}</td>
                <td>{necessityOf(row)}</td>
                <td>{stateOf(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {view.finalize ? (
        <div className="card" data-role="finalize-frozen">
          <div className="card-h">归档代次</div>
          <p>
            代次 {view.finalize.generationNo}，结论 {view.finalize.conclusionName}，
            {view.finalize.finalizedAt.slice(0, 10)}
          </p>
        </div>
      ) : null}

      {canDraft ? (
        <form
          className="card"
          data-role="finalize-form"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const reason = (form.elements.namedItem('missingReason') as HTMLTextAreaElement | null)?.value ?? '';
            props.onSaveDraft({ missingReason: reason });
          }}
        >
          <div className="card-h">归档审批</div>
          <p>
            缺件或移送回证缺失时须写明理由；经批准后结论记为「经批准缺项」。
          </p>
          <label>
            缺件理由
            <textarea name="missingReason" defaultValue={approval?.missingReason ?? ''} />
          </label>
          <button type="submit">{approval ? '保存归档审批稿' : '发起归档审批'}</button>
        </form>
      ) : null}

      {approval?.status === 'drafting' ? (
        <div className="card" data-role="finalize-submit">
          <button type="button" onClick={props.onSubmit}>提交归档审批</button>
        </div>
      ) : null}
      {approval?.status === 'pending_review' ? (
        <div className="card" data-role="finalize-review">
          <button type="button" onClick={props.onReview}>审核通过</button>
        </div>
      ) : null}
      {approval?.status === 'pending_approval' ? (
        <div className="card" data-role="finalize-approve">
          <button type="button" onClick={props.onApprove}>批准归档</button>
        </div>
      ) : null}
      {!canStartFinalize(view.status) && !view.finalize ? (
        <p className="help" data-role="finalize-not-ready">只有已结案或已撤案的案件可以发起归档审批。</p>
      ) : null}
    </section>
  );
}