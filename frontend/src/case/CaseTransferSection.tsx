// 案件详情「移送」页签（#242）：发起移送呈批、查看记载、上传或补传回证、
// 登记公安检察决定与选择人工出口。
import { useState, type FormEvent } from 'react';

import {
  TRANSFER_KIND_OPTIONS,
  TRANSFER_LEVEL_NAMES,
  type TransferView,
} from './transfer';

export interface OutletDraftInput {
  readonly outlet: string;
  readonly illegalStateCleared: string;
  readonly illegalStateNote: string;
  readonly penaltyBasis: string;
  readonly reason: string;
}

export interface CaseTransferSectionProps {
  readonly view: TransferView;
  readonly message: string | null;
  readonly canDraft: boolean;
  readonly onDraftTransfer: (input: {
    readonly kind: string;
    readonly receivingOrg: string;
    readonly documentNo: string;
    readonly letterDate: string;
    readonly reason: string;
    readonly files: readonly File[];
  }) => void;
  readonly onUploadReceipt: (transferId: string, files: readonly File[]) => void;
  readonly onRecordDecision: (input: {
    readonly source: string;
    readonly notifiedOn: string;
    readonly reason: string;
    readonly caseReturned: boolean;
    readonly returnedList: readonly string[];
  }) => void;
  readonly onDraftOutlet: (decisionId: string, input: OutletDraftInput) => void;
  readonly onCloseoutGate: () => void;
}

function filesOf(input: HTMLInputElement | null): File[] {
  return input?.files ? Array.from(input.files) : [];
}

export function CaseTransferSection(props: CaseTransferSectionProps) {
  const [outlet, setOutlet] = useState('investigate-again');
  const view = props.view;
  const hasCriminalTransfer = view.transfers.some((row) => row.kind === 'criminal');

  return (
    <section data-role="case-transfer">
      <h1>移送</h1>
      {props.message ? <div className="help" data-role="transfer-failure">{props.message}</div> : null}

      <div className="card" data-role="transfer-chain">
        <div className="card-h">呈批链路</div>
        <p>
          {view.chain.basis}：{view.chain.levels.map((level) => TRANSFER_LEVEL_NAMES[level] ?? level).join(' → ')}
        </p>
        <p data-role="transfer-receipts">
          回证{view.receiptsComplete ? '已齐全' : '未齐全'}（回证缺失不阻断结案）
        </p>
        {view.criminalTransferReviewPass ? (
          <p data-role="transfer-legal-review">涉刑移送法审已通过</p>
        ) : (
          <p data-role="transfer-legal-review">涉刑移送尚未取得法审通过</p>
        )}
      </div>

      <div className="card" data-role="transfer-records">
        <div className="card-h">移送记载</div>
        {view.transfers.length === 0 ? <div className="help">尚无移送记载</div> : (
          <ul>
            {view.transfers.map((row) => (
              <li key={row.id} data-role="transfer-record">
                {row.kindName} 致 {row.receivingOrg}，{row.documentNo}，{row.letterDate}，{row.reason}
                <span data-role="transfer-record-receipt">
                  回证 {row.receiptCount} 份{row.receiptsComplete ? '（齐全）' : '（可后补）'}
                </span>
                <form
                  data-role="receipt-form"
                  onSubmit={(event: FormEvent<HTMLFormElement>) => {
                    event.preventDefault();
                    const form = event.currentTarget;
                    props.onUploadReceipt(row.id, filesOf(form.elements.namedItem('receipt') as HTMLInputElement | null));
                  }}
                >
                  <input type="file" name="receipt" multiple />
                  <button type="submit">上传或补传回证</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </div>

      {props.canDraft ? (
        <form
          className="card"
          data-role="transfer-form"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            const form = event.currentTarget;
            const value = (name: string) => String((form.elements.namedItem(name) as HTMLInputElement | null)?.value ?? '');
            props.onDraftTransfer({
              kind: value('kind'),
              receivingOrg: value('receivingOrg'),
              documentNo: value('documentNo'),
              letterDate: value('letterDate'),
              reason: value('reason'),
              files: filesOf(form.elements.namedItem('attachment') as HTMLInputElement | null),
            });
            form.reset();
          }}
        >
          <div className="card-h">发起移送呈批</div>
          <label>
            移送类型
            <select name="kind" defaultValue="jurisdiction">
              {TRANSFER_KIND_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            接收机关
            <input name="receivingOrg" required />
          </label>
          <label>
            文书编号
            <input name="documentNo" required />
          </label>
          <label>
            发函日期（留空取当日，可补录）
            <input name="letterDate" placeholder="2026-10-29" />
          </label>
          <label>
            原因
            <textarea name="reason" required />
          </label>
          <label>
            附件
            <input type="file" name="attachment" multiple />
          </label>
          <button type="submit">保存呈批</button>
        </form>
      ) : null}

      {view.approvals.length > 0 ? (
        <div className="card" data-role="transfer-approvals">
          <div className="card-h">呈批状态</div>
          <ul>
            {view.approvals.map((row) => (
              <li key={row.id}>
                {row.kindName}：{row.status}
                {row.kind === 'criminal' && row.decisionDueOn ? `，三个工作日内决定，到期日 ${row.decisionDueOn}` : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="card" data-role="criminal-decisions">
        <div className="card-h">公安、检察决定</div>
        {view.criminalDecisions.length === 0 ? <div className="help">尚无外部决定记载</div> : (
          <ul>
            {view.criminalDecisions.map((row) => (
              <li key={row.id} data-role="criminal-decision">
                {row.sourceName} {row.notifiedOn}：{row.reason}
                {row.caseReturned ? '（退回案卷）' : ''}
                <span data-role="criminal-decision-countdown">
                  {row.countdown.dueOn ? `三日提示至 ${row.countdown.dueOn}` : '三日提示待算'}
                  {row.countdown.expired ? '（已过，不阻断）' : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
        {hasCriminalTransfer && props.canDraft ? (
          <form
            data-role="criminal-decision-form"
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              const form = event.currentTarget;
              const value = (name: string) => String((form.elements.namedItem(name) as HTMLInputElement | null)?.value ?? '');
              const list = value('returnedList')
                .split('\n')
                .map((item) => item.trim())
                .filter((item) => item !== '');
              props.onRecordDecision({
                source: value('source'),
                notifiedOn: value('notifiedOn'),
                reason: value('reason'),
                caseReturned: (form.elements.namedItem('caseReturned') as HTMLInputElement | null)?.checked === true,
                returnedList: list,
              });
              form.reset();
            }}
          >
            <div className="card-h">登记外部决定</div>
            <label>
              来源
              <select name="source" defaultValue="police">
                <option value="police">公安</option>
                <option value="procuratorate">检察</option>
              </select>
            </label>
            <label>
              通知日期
              <input name="notifiedOn" placeholder="2026-10-29" required />
            </label>
            <label>
              理由
              <textarea name="reason" required />
            </label>
            <label>
              <input type="checkbox" name="caseReturned" /> 退回案卷
            </label>
            <label>
              退回案卷清单（每行一份）
              <textarea name="returnedList" />
            </label>
            <button type="submit">保存记载</button>
          </form>
        ) : null}
      </div>

      {view.criminalDecisions.length > 0 && props.canDraft ? (
        <form
          className="card"
          data-role="outlet-form"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            const form = event.currentTarget;
            const value = (name: string) => String((form.elements.namedItem(name) as HTMLInputElement | null)?.value ?? '');
            props.onDraftOutlet(view.criminalDecisions[0].id, {
              outlet,
              illegalStateCleared: value('illegalStateCleared'),
              illegalStateNote: value('illegalStateNote'),
              penaltyBasis: value('penaltyBasis'),
              reason: value('outletReason'),
            });
          }}
        >
          <div className="card-h">外部决定后的处理出口</div>
          <label>
            出口
            <select name="outlet" value={outlet} onChange={(event) => setOutlet(event.target.value)}>
              <option value="investigate-again">回调查继续行政处罚</option>
              <option value="close-or-other">呈批结案或其他处理</option>
            </select>
          </label>
          {outlet === 'investigate-again' ? (
            <>
              <label>
                违法状态是否仍未消除
                <select name="illegalStateCleared" defaultValue="no">
                  <option value="no">是</option>
                  <option value="yes">否</option>
                </select>
              </label>
              <label>
                说明
                <textarea name="illegalStateNote" required />
              </label>
              <label>
                处罚依据
                <input name="penaltyBasis" required />
              </label>
            </>
          ) : (
            <label>
              理由
              <textarea name="outletReason" required />
            </label>
          )}
          <button type="submit">保存出口呈批</button>
        </form>
      ) : null}

      <div className="card" data-role="closeout-gate">
        <div className="card-h">结案前移送检查</div>
        <button type="button" onClick={() => props.onCloseoutGate()}>检查</button>
      </div>
    </section>
  );
}