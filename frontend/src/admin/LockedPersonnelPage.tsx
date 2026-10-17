import { Suspense, useReducer, type ReactNode } from 'react';
import { Await, useAsyncError, useLoaderData, useRevalidator } from 'react-router';

import type { ApiDispatch } from '../api';
import { useAppDispatch, useAppSelector } from '../hooks';
import { DeniedCard, ErrorCard, errorStatus } from '../shell/StatusPages';
import {
  COLUMNS,
  EMPTY_HINT,
  EMPTY_TITLE,
  formatUnlockTime,
  initialLockedState,
  isDenial,
  LOCKED_READ,
  LOCKED_RELEASE,
  lockedReducer,
  markedRowId,
  NO_ORG_HINT,
  noticeReason,
  noticeText,
  PAGE_DESC,
  PAGE_TITLE,
  PASSWORD_RESET,
  performAction,
  RESET_EFFECT,
  RESET_PLACEHOLDER,
  RESET_RULE_TEXT,
  resetDialogTitle,
  resetRulesSentence,
  UNLOCK_NOTE,
  unlockDialogTitle,
  type LockedEvent,
  type LockedRow,
  type LockedState,
  type Notice,
} from './lockedPersonnel';

const MARKED_ROW = { background: '#fffaeb' } as const;
const SKELETON_WIDTHS = [60, 73, 86, 99, 72];

function Crumb() {
  return <div className="crumb">管理台 / <b>{PAGE_TITLE}</b></div>;
}

function Head({ onRefresh }: { onRefresh: () => void }) {
  return (
    <>
      <Crumb />
      <div className="page-h">
        <div>
          <h1>{PAGE_TITLE}</h1>
          <div className="desc">{PAGE_DESC}</div>
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={onRefresh}>刷新</button>
        </div>
      </div>
    </>
  );
}

/** P7 loading：骨架。 */
function ListSkeleton() {
  return (
    <div className="card" aria-busy="true">
      {SKELETON_WIDTHS.map((width) => <div key={width} className="skel" style={{ width: `${width}%` }} />)}
    </div>
  );
}

function ListError() {
  const error = useAsyncError();
  const revalidator = useRevalidator();
  if (errorStatus(error) === 403) return <DeniedCard what={PAGE_TITLE} />;
  return <ErrorCard what={PAGE_TITLE} onRetry={() => void revalidator.revalidate()} />;
}

function NoticeBanner({ notice }: { notice: Notice }) {
  const reason = noticeReason(notice);
  return (
    <div className={`banner ${isDenial(notice) ? 'danger' : 'ok'}`} role="status" data-reason={reason ?? undefined}>
      {noticeText(notice)}
    </div>
  );
}

function Dialog({ title, children, foot }: { title: string; children: ReactNode; foot: ReactNode }) {
  return (
    <div className="mask">
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <h3>{title}</h3>
        {children}
        <div className="foot">{foot}</div>
      </div>
    </div>
  );
}

export interface LockedViewProps {
  state: LockedState;
  opcodes: readonly string[];
  send: (event: LockedEvent) => void;
  onConfirm: () => void;
}

function UnlockDialog({ row, pending, send, onConfirm }: { row: LockedRow; pending: boolean; send: LockedViewProps['send']; onConfirm: () => void }) {
  return (
    <Dialog
      title={unlockDialogTitle(row)}
      foot={(
        <>
          <button type="button" className="btn" disabled={pending} onClick={() => send({ type: 'close' })}>取消</button>
          <button type="button" className="btn btn-primary" disabled={pending} onClick={onConfirm}>确认解锁</button>
        </>
      )}
    >
      <div className="kv">
        <div className="k">工号</div><div className="mono">{row.code}</div>
        <div className="k">当前机构名</div><div>{row.orgName ?? ''}</div>
        <div className="k">自动解锁时间</div><div>{formatUnlockTime(row.lockedUntil)}</div>
      </div>
      <p style={{ marginTop: 10 }}>{UNLOCK_NOTE}</p>
    </Dialog>
  );
}

function ResetDialog({ row, state, send, onConfirm }: { row: LockedRow; state: LockedState; send: LockedViewProps['send']; onConfirm: () => void }) {
  const ruleTexts = state.ruleCodes.map((code) => RESET_RULE_TEXT[code]).filter((text): text is string => Boolean(text));
  return (
    <Dialog
      title={resetDialogTitle(row)}
      foot={(
        <>
          <button type="button" className="btn" disabled={state.pending} onClick={() => send({ type: 'close' })}>取消</button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={state.pending}
            onClick={onConfirm}
          >
            确认重设
          </button>
        </>
      )}
    >
      <div className="kv" style={{ marginBottom: 12 }}>
        <div className="k">工号</div><div className="mono">{row.code}</div>
        <div className="k">当前机构名</div><div>{row.orgName ?? ''}</div>
      </div>
      <div className="form-row">
        <label htmlFor="locked-reset-password">新的初始口令<span className="req">*</span></label>
        <div>
          <input
            id="locked-reset-password"
            className="input"
            type="password"
            autoComplete="new-password"
            placeholder={RESET_PLACEHOLDER}
            value={state.password}
            disabled={state.pending}
            onChange={(event) => send({ type: 'password', value: event.target.value })}
          />
          {ruleTexts.length > 0 ? (
            <ul className="err" data-reason="non-compliant" style={{ margin: '4px 0 0 18px' }}>
              {ruleTexts.map((text) => <li key={text}>{text}</li>)}
            </ul>
          ) : null}
          <div className="help">{resetRulesSentence()}</div>
        </div>
      </div>
      <p>{RESET_EFFECT}</p>
    </Dialog>
  );
}

/** 列表与动作（P7 data/empty/各确认与结果状态）。只依赖传入的状态，便于单测静态渲染。 */
export function LockedPersonnelView({ state, opcodes, send, onConfirm }: LockedViewProps) {
  const canUnlock = opcodes.includes(LOCKED_RELEASE);
  const canReset = opcodes.includes(PASSWORD_RESET);
  const marked = markedRowId(state);
  const banner = state.notice ? <NoticeBanner notice={state.notice} /> : null;
  const dialog = state.dialog;
  const overlay = dialog === null ? null : dialog.kind === 'unlock'
    ? <UnlockDialog row={dialog.row} pending={state.pending} send={send} onConfirm={onConfirm} />
    : <ResetDialog row={dialog.row} state={state} send={send} onConfirm={onConfirm} />;
  if (state.rows.length === 0) {
    return (
      <>
        {banner}
        <div className="card">
          <div className="empty">
            <div className="t">{EMPTY_TITLE}</div>
            <div>{EMPTY_HINT}</div>
          </div>
        </div>
        {overlay}
      </>
    );
  }
  return (
    <>
      {banner}
      <div className="card">
        <div className="card-h">
          {`共 ${state.rows.length} 人`}
          <span className="hint">{NO_ORG_HINT}</span>
        </div>
        <table className="table" data-fields={COLUMNS.join(' ')}>
          <thead>
            <tr>
              {COLUMNS.map((title) => <th key={title}>{title}</th>)}
              <th style={{ width: 210 }} />
            </tr>
          </thead>
          <tbody>
            {state.rows.map((row) => (
              <tr key={row.id} style={row.id === marked ? MARKED_ROW : undefined} data-personnel={row.id}>
                <td className="mono">{row.id}</td>
                <td className="mono">{row.code}</td>
                <td>{row.name}</td>
                <td>{row.orgName ?? ''}</td>
                <td>{formatUnlockTime(row.lockedUntil)}</td>
                <td>
                  <div className="actions">
                    {canUnlock ? (
                      <button
                        type="button"
                        className="btn btn-sm"
                        data-requires={LOCKED_RELEASE}
                        onClick={() => send({ type: 'open', kind: 'unlock', row })}
                      >
                        解锁
                      </button>
                    ) : null}
                    {canReset ? (
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost-danger"
                        data-requires={PASSWORD_RESET}
                        onClick={() => send({ type: 'open', kind: 'reset', row })}
                      >
                        重设初始口令
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {overlay}
    </>
  );
}

/** 有状态的列表：动作在这里发出，结果回到 reducer。 */
function LockedPersonnelList({ rows, opcodes, selfCode }: { rows: LockedRow[]; opcodes: readonly string[]; selfCode: string | null }) {
  const dispatch = useAppDispatch() as unknown as ApiDispatch;
  const [state, send] = useReducer(lockedReducer, rows, initialLockedState);
  const onConfirm = () => {
    const dialog = state.dialog;
    if (!dialog || state.pending) return;
    send({ type: 'submit' });
    void performAction(dispatch, dialog.kind, dialog.row, state.password, selfCode)
      .then((result) => send({ type: 'settled', result }));
  };
  return <LockedPersonnelView state={state} opcodes={opcodes} send={send} onConfirm={onConfirm} />;
}

/** 被锁人员（P7）：系统管理解锁、重设初始口令；没有列表码时显示无权限卡片。 */
export default function LockedPersonnelPage() {
  const { list, generation } = useLoaderData() as { list: Promise<LockedRow[]>; generation: number };
  const operator = useAppSelector((root) => root.login.operator);
  const revalidator = useRevalidator();
  const opcodes = operator?.opcodes ?? [];
  if (!opcodes.includes(LOCKED_READ)) {
    return (
      <>
        <Crumb />
        <DeniedCard what={PAGE_TITLE} />
      </>
    );
  }
  return (
    <>
      <Head onRefresh={() => void revalidator.revalidate()} />
      <Suspense fallback={<ListSkeleton />}>
        <Await resolve={list} errorElement={<ListError />}>
          {(rows: LockedRow[]) => (
            <LockedPersonnelList key={generation} rows={rows} opcodes={opcodes} selfCode={operator?.code ?? null} />
          )}
        </Await>
      </Suspense>
    </>
  );
}
