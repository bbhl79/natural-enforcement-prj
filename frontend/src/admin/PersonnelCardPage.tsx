import { Suspense, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Await, Link, useAsyncError, useLoaderData, useRevalidator, useSearchParams } from 'react-router';

import { useAppDispatch, useAppSelector } from '../hooks';
import { ErrorCard, errorStatus } from '../shell/StatusPages';
import type { OrgUnit } from './orgTree';
import {
  CERT_RECORD_STATUS_LABEL,
  CERT_RECORD_STATUSES,
  CERT_TAG,
  certEditFrom,
  certNote,
  certProblemCount,
  certRecordLabel,
  deactivatePersonnel,
  editInputFromCard,
  endPersonnelSessions,
  loadRestoreOrgUnits,
  loadTransferDestinations,
  maskPhone,
  orgText,
  passwordText,
  PASSWORD_RULE_LABEL,
  PERSONNEL_CERT_UPDATE,
  PERSONNEL_DEACTIVATE,
  PERSONNEL_READ,
  PERSONNEL_RESTORE,
  PERSONNEL_SESSIONS_END,
  PERSONNEL_UPDATE,
  POST_LABEL,
  POSTS,
  restorePersonnel,
  ROLES,
  SESSIONS_ENDED_NOTICE,
  transferPersonnel,
  updateCert,
  updatePersonnel,
  type CertRecordStatus,
  type CertUpdateInput,
  type CertUpdateResult,
  type EditInput,
  type PersonnelCard,
  type PersonnelPost,
  type TransferDestination,
} from './personnel';
import { PersonnelDenied, SkeletonCard } from './PersonnelStatus';

const SUPERVISE = '监督可以在「管理台留痕」里查阅人员维护的留痕。';
const CERT_HELP = '按证件原样填写。一人一证。';
const CERT_BANNER = '换发新证时直接改为新证号和新有效期。只能逐条人工登记，请对照实物证件核对。';

function Crumb({ title }: { title: string }) {
  return <div className="crumb">管理台 / <Link to="/admin/personnel">人员</Link> / <b>{title}</b></div>;
}

/** 登记成功后回到卡片时的提示（#105：请当面或电话告知初始口令）。 */
export function RegisteredBanner({ name }: { name: string }) {
  return (
    <div className="banner ok" data-notice="registered">
      {`已建人员「${name}」。请当面或电话告知初始口令，不要通过群聊发送。对方首次登录时必须改掉初始口令。`}
    </div>
  );
}

type CertFailure = Extract<CertUpdateResult, { ok: false }>;

/** P6 certEdit：执法证登记表单（证号、有效期至、证件状态三项都必填）。 */
export function CertForm({
  input,
  failure,
  busy,
  onInput,
  onSubmit,
  onCancel,
}: {
  input: CertUpdateInput;
  failure: CertFailure | null;
  busy: boolean;
  onInput: (next: CertUpdateInput) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const fields = failure?.fields ?? {};
  const count = failure ? certProblemCount(failure) : 0;
  const hint = (field: keyof CertUpdateInput, help: string | null) => {
    const error = fields[field];
    if (error) return <div className="err" data-error={field}>{error}</div>;
    return help ? <div className="help">{help}</div> : null;
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };
  return (
    <form onSubmit={submit} noValidate data-section="cert-form">
      <div className="section-title">执法证</div>
      {failure?.message ? <div className="banner danger">{failure.message}</div> : null}
      {count > 0 ? <div className="banner danger">{`还有 ${count} 处需要修改，改好后再保存。`}</div> : null}
      <div className="form-row">
        <label htmlFor="c-no">执法证号<span className="req">*</span></label>
        <div>
          <input id="c-no" className="input" value={input.certNo} onChange={(e) => onInput({ ...input, certNo: e.target.value })} />
          {hint('certNo', CERT_HELP)}
        </div>
      </div>
      <div className="form-row">
        <label htmlFor="c-expires">有效期至<span className="req">*</span></label>
        <div>
          <input
            id="c-expires"
            className="input"
            placeholder="年-月-日"
            style={{ width: 200 }}
            value={input.certExpiresOn}
            onChange={(e) => onInput({ ...input, certExpiresOn: e.target.value })}
          />
          {hint('certExpiresOn', null)}
        </div>
      </div>
      <div className="form-row">
        <label htmlFor="c-status">证件状态<span className="req">*</span></label>
        <div>
          <select
            id="c-status"
            className="select"
            style={{ width: 200 }}
            value={input.certStatus}
            onChange={(e) => onInput({ ...input, certStatus: e.target.value as CertRecordStatus })}
          >
            {CERT_RECORD_STATUSES.map((status) => (
              <option key={status} value={status}>{CERT_RECORD_STATUS_LABEL[status]}</option>
            ))}
          </select>
          {hint('certStatus', null)}
        </div>
      </div>
      <div className="banner gray">{CERT_BANNER}</div>
      <div className="actions">
        <button type="button" className="btn" onClick={onCancel}>取消</button>
        <button type="submit" className="btn btn-primary" disabled={busy} data-requires={PERSONNEL_CERT_UPDATE}>保存执法证</button>
      </div>
    </form>
  );
}

/**
 * 执法证一段（P6，#133）。只读态显示证号、有效期、证件状态与说明句；
 * 持 personnel.cert.update 的人多一个「登记执法证 / 变更执法证」按钮，点开是表单。
 * 保存成功后由页面重取卡片，表单收起。
 */
export function CertSection({
  card,
  now,
  canUpdate,
  onSave,
}: {
  card: PersonnelCard;
  now: Date;
  canUpdate: boolean;
  onSave: (input: CertUpdateInput) => Promise<CertUpdateResult>;
}) {
  const cert = card.cert;
  const tag = CERT_TAG[cert.status];
  const note = certNote(cert, now);
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState<CertUpdateInput>(() => certEditFrom(card));
  const [failure, setFailure] = useState<CertFailure | null>(null);
  const [busy, setBusy] = useState(false);

  if (editing) {
    return (
      <CertForm
        input={input}
        failure={failure}
        busy={busy}
        onInput={setInput}
        onCancel={() => { setEditing(false); setFailure(null); }}
        onSubmit={() => void (async () => {
          setBusy(true);
          const result = await onSave(input);
          setBusy(false);
          if (result.ok) {
            setEditing(false);
            setFailure(null);
            return;
          }
          setFailure(result);
        })()}
      />
    );
  }
  return (
    <>
      <div className="section-title">
        {'执法证 '}
        <span className={tag.tone ? `tag ${tag.tone}` : 'tag'}>{tag.label}</span>
      </div>
      <div className="kv">
        <div className="k">执法证号</div>
        <div>{cert.no || '—'}</div>
        <div className="k">有效期至</div>
        <div>{cert.expiresOn || '—'}</div>
        <div className="k">证件状态</div>
        <div>{certRecordLabel(cert.status)}</div>
      </div>
      <div className={`banner ${note.tone}`} style={{ marginTop: 10 }}>{note.text}</div>
      {canUpdate ? (
        <button
          type="button"
          className="btn btn-sm"
          data-requires={PERSONNEL_CERT_UPDATE}
          onClick={() => { setInput(certEditFrom(card)); setFailure(null); setEditing(true); }}
        >
          {cert.status === 'none' ? '登记执法证' : '变更执法证'}
        </button>
      ) : null}
    </>
  );
}

/** 岗位标记（#105 A1，不在 v0.4，按 spec 例外以单测和集成测试验收）。只读；维护入口在编辑表单里（#129）。 */
export function PostsCard({ card }: { card: PersonnelCard }) {
  return (
    <div className="card" data-section="posts">
      <div className="card-h">岗位标记</div>
      {card.posts.length > 0 ? (
        <div className="checks" style={{ paddingTop: 0 }}>
          {card.posts.map((post) => <span key={post} className="tag" data-post={post}>{POST_LABEL[post]}</span>)}
        </div>
      ) : <div>无</div>}
      <div className="help" style={{ marginTop: 8 }}>岗位标记用于审批链选人，不是角色，不授予任何权限。</div>
    </div>
  );
}

// ---------- 编辑（P6 edit / selfEdit，#129） ----------

export interface EditFailure {
  fields: Partial<Record<'name' | 'mobilePhone' | 'roles' | 'posts', string>>;
  message: string | null;
}

export interface EditState {
  input: EditInput;
  failure: EditFailure | null;
  busy: boolean;
  onInput: (next: EditInput) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

function toggle<T>(list: readonly T[], item: T, on: boolean): T[] {
  return on ? [...list.filter((x) => x !== item), item] : list.filter((x) => x !== item);
}

/** P6 edit / selfEdit 的表单（纯渲染，单测直接渲染）。工号不可改；本人编辑时角色与岗位标记置灰。 */
export function PersonnelEditForm({ card, self, edit }: { card: PersonnelCard; self: boolean; edit: EditState }) {
  const { input, failure, busy } = edit;
  const fields = failure?.fields ?? {};
  const submit = (event: FormEvent) => {
    event.preventDefault();
    edit.onSubmit();
  };
  return (
    <form onSubmit={submit} noValidate data-mode="edit">
      {failure?.message ? <div className="banner danger" data-error="message">{failure.message}</div> : null}
      <div className="form-row">
        <label htmlFor="e-code">工号</label>
        <input id="e-code" className="input ro" value={card.code} disabled />
      </div>
      <div className="form-row">
        <label htmlFor="e-name">姓名<span className="req">*</span></label>
        <div>
          <input id="e-name" className="input" value={input.name} disabled={busy} onChange={(e) => edit.onInput({ ...input, name: e.target.value })} />
          {fields.name ? <div className="err" data-error="name">{fields.name}</div> : null}
        </div>
      </div>
      <div className="form-row">
        <label htmlFor="e-phone">手机号<span className="req">*</span></label>
        <div>
          <input id="e-phone" className="input" inputMode="numeric" value={input.mobilePhone} disabled={busy} onChange={(e) => edit.onInput({ ...input, mobilePhone: e.target.value })} />
          {fields.mobilePhone ? <div className="err" data-error="mobilePhone">{fields.mobilePhone}</div> : null}
          <div className="help">手机号用于登录，全系统不能重复。</div>
        </div>
      </div>
      <div className="form-row">
        <label>角色<span className="req">*</span></label>
        <div data-field="roles">
          <div className="checks">
            {ROLES.map((role) => (
              <label key={role}>
                <input
                  type="checkbox"
                  data-role={role}
                  checked={input.roles.includes(role)}
                  disabled={self || busy}
                  onChange={(e) => edit.onInput({ ...input, roles: toggle(input.roles, role, e.target.checked) })}
                />
                {` ${role}`}
              </label>
            ))}
          </div>
          {fields.roles ? <div className="err" data-error="roles">{fields.roles}</div> : null}
          {self ? (
            <div className="help" data-reason="self-role">不能修改自己的角色。如需调整，请找本单位其他系统管理人员办理。</div>
          ) : (
            <div className="help">至少保留一个角色。角色变化在对方下一次操作时生效，不用重新登录。</div>
          )}
        </div>
      </div>
      {/* 岗位标记一段不在 v0.4（#105 写明的例外），交互照角色一段；本人编辑时同样置灰。 */}
      <div className="form-row" data-section="posts">
        <label>岗位标记</label>
        <div data-field="posts">
          <div className="checks">
            {POSTS.map((post) => (
              <label key={post}>
                <input
                  type="checkbox"
                  data-post={post}
                  checked={input.posts.includes(post)}
                  disabled={self || busy}
                  onChange={(e) => edit.onInput({ ...input, posts: toggle<PersonnelPost>(input.posts, post, e.target.checked) })}
                />
                {` ${POST_LABEL[post]}`}
              </label>
            ))}
          </div>
          {fields.posts ? <div className="err" data-error="posts">{fields.posts}</div> : null}
          {self ? (
            <div className="help" data-reason="self-post">不能修改自己的岗位标记。如需调整，请找本单位其他系统管理人员办理。</div>
          ) : (
            <div className="help">可多选，也可不选。岗位标记用于审批链选人，不是角色，不授予任何权限。</div>
          )}
        </div>
      </div>
      <div className="actions">
        <button type="button" className="btn" disabled={busy} onClick={edit.onCancel}>取消</button>
        <button type="submit" className="btn btn-primary" disabled={busy} data-requires={PERSONNEL_UPDATE}>保存</button>
      </div>
    </form>
  );
}

// ---------- 调岗弹窗（P6 transfer，#129） ----------

/** 弹窗里能拿到焦点的元素（不含禁用的）。 */
const FOCUSABLE = 'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/** 弹窗（同 P4 的写法）：打开时焦点进弹窗，Tab 在弹窗内循环，关闭时焦点回到触发按钮。 */
function Modal({ title, children, foot }: { title: string; children: ReactNode; foot: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const box = ref.current;
    // autofocus 只认未禁用的元素：调岗弹窗挂载时清单还在读取，调入机构 select 处于禁用，
    // 命中它则 focus() 无效、焦点留在背景。排除禁用后回退到第一个可聚焦元素（此时是取消按钮），
    // 保证焦点进弹窗、Tab 陷阱生效（对照 LockedPersonnelPage 的焦点管理）。
    (box?.querySelector<HTMLElement>('[data-autofocus]:not([disabled])') ?? box?.querySelector<HTMLElement>(FOCUSABLE))?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  const trapTab = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab' || !ref.current) return;
    const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    const current = document.activeElement;
    const inside = current instanceof Node && ref.current.contains(current);
    if (event.shiftKey && (current === first || !inside)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (current === last || !inside)) {
      event.preventDefault();
      first.focus();
    }
  };
  return (
    <div className="mask">
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} ref={ref} onKeyDown={trapTab}>
        <h3>{title}</h3>
        {children}
        <div className="foot">{foot}</div>
      </div>
    </div>
  );
}

export interface TransferFailure {
  fields: { orgUnitId?: string };
  message: string | null;
}

export interface TransferState {
  /** null = 还在读取 */
  destinations: TransferDestination[] | null;
  loadFailed: boolean;
  orgUnitId: string;
  failure: TransferFailure | null;
  busy: boolean;
  onChange: (orgUnitId: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

/** P6 transfer（纯渲染，单测直接渲染）。文案照原型：目的地不限本区，效果两条。 */
export function TransferDialog({ card, transfer }: { card: PersonnelCard; transfer: TransferState }) {
  const { destinations, loadFailed, orgUnitId, failure, busy } = transfer;
  return (
    <Modal
      title={`调岗：${card.name}`}
      foot={(
        <>
          <button type="button" className="btn" disabled={busy} onClick={transfer.onCancel}>取消</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || loadFailed || destinations === null || orgUnitId === ''}
            onClick={transfer.onSubmit}
          >
            确认调岗
          </button>
        </>
      )}
    >
      {failure?.message ? <div className="banner danger" data-error="message">{failure.message}</div> : null}
      <div className="form-row">
        <label htmlFor="t-from">现机构</label>
        <input id="t-from" className="input ro" value={orgText(card)} disabled />
      </div>
      <div className="form-row">
        <label htmlFor="t-to">调入机构<span className="req">*</span></label>
        <div>
          <select
            id="t-to"
            className="select"
            value={orgUnitId}
            disabled={busy || loadFailed || destinations === null}
            data-autofocus
            onChange={(event) => transfer.onChange(event.target.value)}
          >
            <option value="">请选择调入机构</option>
            {(destinations ?? []).map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
          </select>
          {failure?.fields.orgUnitId ? <div className="err" data-error="orgUnitId">{failure.fields.orgUnitId}</div> : null}
          {loadFailed ? <div className="err" data-error="destinations">无法读取可选机构，请关闭后重试。</div> : null}
          <div className="help">调入机构不限于本区。</div>
        </div>
      </div>
      <ul>
        <li>对方下一次操作起，只能看到新机构范围内的线索和案件；</li>
        <li>对方经手的历史记录不变。</li>
      </ul>
    </Modal>
  );
}

// ---------- 停用与结束全部会话确认弹窗（P6 deactivate / endsessions，#130） ----------

/** 两个确认弹窗共用的状态。message 是 409/403/500 给人看的一句；null = 没有失败。 */
export interface ConfirmState {
  busy: boolean;
  message: string | null;
  onCancel: () => void;
  onSubmit: () => void;
}

/** P6 deactivate（纯渲染，单测直接渲染）。三条后果照原型，确认按钮为危险色。 */
export function DeactivateDialog({ card, confirm }: { card: PersonnelCard; confirm: ConfirmState }) {
  return (
    <Modal
      title={`停用「${card.name}」？`}
      foot={(
        <>
          <button type="button" className="btn" disabled={confirm.busy} onClick={confirm.onCancel}>取消</button>
          <button type="button" className="btn btn-danger" disabled={confirm.busy} onClick={confirm.onSubmit}>确认停用</button>
        </>
      )}
    >
      {confirm.message ? <div className="banner danger" data-error="message">{confirm.message}</div> : null}
      <ul>
        <li>对方的全部会话会在下一次操作时结束，之后不能再登录；</li>
        <li>对方经手的线索、案件和记录照常保留；</li>
        <li>以后可以恢复，恢复时需要重设初始口令。</li>
      </ul>
    </Modal>
  );
}

/** P6 endsessions（纯渲染）。适用情形一句与两条后果照原型；不改口令，怀疑泄露请走重设（#132 交付入口）。 */
export function EndSessionsDialog({ card, confirm }: { card: PersonnelCard; confirm: ConfirmState }) {
  return (
    <Modal
      title={`结束「${card.name}」的全部会话？`}
      foot={(
        <>
          <button type="button" className="btn" disabled={confirm.busy} onClick={confirm.onCancel}>取消</button>
          <button type="button" className="btn btn-danger" disabled={confirm.busy} onClick={confirm.onSubmit}>确认结束</button>
        </>
      )}
    >
      {confirm.message ? <div className="banner danger" data-error="message">{confirm.message}</div> : null}
      <p>适用于怀疑口令泄露、设备丢失等情况。</p>
      <ul>
        <li>对方的全部会话和全部「记住我」，会在下一次操作时结束；</li>
        <li>对方可以用原口令重新登录。如怀疑口令泄露，请改用「重设初始口令」。</li>
      </ul>
    </Modal>
  );
}

// ---------- 恢复弹窗（P6 restore / restoreNewOrg，#130） ----------

export interface RestoreFailure {
  fields: Partial<Record<'initialPassword' | 'orgUnitId', string>>;
  /** 没满足的口令策略规则码对应的提示句 */
  passwordRules: string[];
  message: string | null;
}

export interface RestoreState {
  /** 数据范围内在用的机构；只在原任职机构已停用时读取，null = 还在读取 */
  orgUnits: OrgUnit[] | null;
  loadFailed: boolean;
  initialPassword: string;
  orgUnitId: string;
  failure: RestoreFailure | null;
  busy: boolean;
  onPassword: (value: string) => void;
  onOrg: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

/** P6 restore / restoreNewOrg（纯渲染）。原机构在用只设新初始口令；已停用则同一步选新任职机构。 */
export function RestoreDialog({ card, restore }: { card: PersonnelCard; restore: RestoreState }) {
  const needOrg = card.orgDeactivated;
  const fields = restore.failure?.fields ?? {};
  const ruleTexts = (restore.failure?.passwordRules ?? [])
    .map((rule) => PASSWORD_RULE_LABEL[rule])
    .filter((text): text is string => Boolean(text));
  return (
    <Modal
      title={`恢复「${card.name}」？`}
      foot={(
        <>
          <button type="button" className="btn" disabled={restore.busy} onClick={restore.onCancel}>取消</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={restore.busy || restore.loadFailed || (needOrg && (restore.orgUnits === null || restore.orgUnitId === ''))}
            onClick={restore.onSubmit}
          >
            确认恢复
          </button>
        </>
      )}
    >
      {restore.failure?.message ? <div className="banner danger" data-error="message">{restore.failure.message}</div> : null}
      <div className="kv" style={{ marginBottom: 12 }}>
        <div className="k">{needOrg ? '原任职机构' : '所在机构'}</div>
        <div>{card.orgName ? (needOrg ? orgText(card) : `${orgText(card)}（在用）`) : '—'}</div>
      </div>
      {needOrg ? (
        <>
          <div className="banner amber" data-reason="org-deactivated">原任职机构已停用，恢复时需同时选一个新任职机构。</div>
          <div className="form-row">
            <label htmlFor="r-org">新任职机构<span className="req">*</span></label>
            <div>
              <select
                id="r-org"
                className="select"
                value={restore.orgUnitId}
                disabled={restore.busy || restore.loadFailed || restore.orgUnits === null}
                data-autofocus
                onChange={(event) => restore.onOrg(event.target.value)}
              >
                <option value="">请选择在用机构</option>
                {(restore.orgUnits ?? []).map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
              </select>
              {fields.orgUnitId ? <div className="err" data-error="orgUnitId">{fields.orgUnitId}</div> : null}
              {restore.loadFailed ? <div className="err" data-error="orgUnits">无法读取可选机构，请关闭后重试。</div> : null}
              <div className="help">只能选你数据范围内在用的机构。</div>
            </div>
          </div>
        </>
      ) : null}
      <div className="form-row">
        <label htmlFor="r-password">新的初始口令<span className="req">*</span></label>
        <div>
          <input
            id="r-password"
            className="input"
            type="text"
            autoComplete="off"
            placeholder="请输入新的初始口令"
            value={restore.initialPassword}
            disabled={restore.busy}
            data-autofocus={needOrg ? undefined : 'true'}
            onChange={(event) => restore.onPassword(event.target.value)}
          />
          {fields.initialPassword ? <div className="err" data-error="initialPassword">{fields.initialPassword}</div> : null}
          {ruleTexts.length > 0 ? (
            <ul className="err" data-reason="non-compliant" style={{ margin: '4px 0 0 18px' }}>
              {ruleTexts.map((text) => <li key={text}>{text}</li>)}
            </ul>
          ) : null}
          <div className="help">恢复后对方首次登录必须改掉这个口令。不能与对方最近 5 次使用过的口令相同。</div>
        </div>
      </div>
      {needOrg ? <p>确认后，恢复和调到新任职机构一并完成。</p> : null}
    </Modal>
  );
}

// ---------- 卡片（P6 view） ----------

/** P6 view（纯渲染，单测直接渲染）。重设口令（#132）、执法证登记/变更（#133）随后补入危险操作区。 */
export function PersonnelCardView({
  card,
  now,
  registered,
  canUpdateCert = false,
  onSaveCert,
  self = false,
  canUpdate = false,
  canDeactivate = false,
  canRestore = false,
  canEndSessions = false,
  dangerBusy = false,
  notice = null,
  edit = null,
  onEnterEdit,
  onOpenTransfer,
  onOpenDeactivate,
  onOpenEndSessions,
  onOpenRestore,
}: {
  card: PersonnelCard;
  now: Date;
  registered: boolean;
  /** 会话清单里有 personnel.cert.update 时才显示执法证的登记按钮 */
  canUpdateCert?: boolean;
  onSaveCert?: (input: CertUpdateInput) => Promise<CertUpdateResult>;
  /** 卡片是不是操作者本人（G23：本人不能改角色、改岗位标记、调岗、结束会话、停用）。按工号认。 */
  self?: boolean;
  /** 会话清单里有 personnel.profile.update。 */
  canUpdate?: boolean;
  /** 会话清单里有 personnel.profile.deactivate。 */
  canDeactivate?: boolean;
  /** 会话清单里有 personnel.profile.restore。 */
  canRestore?: boolean;
  /** 会话清单里有 personnel.sessions.end。 */
  canEndSessions?: boolean;
  /** 危险操作区有请求在途：四个入口一并置灰，避免回调互相覆盖卡片。 */
  dangerBusy?: boolean;
  /** 结束全部会话成功后的结果横幅。 */
  notice?: string | null;
  /** 编辑态；null = 查看态。 */
  edit?: EditState | null;
  onEnterEdit?: () => void;
  onOpenTransfer?: () => void;
  onOpenDeactivate?: () => void;
  onOpenEndSessions?: () => void;
  onOpenRestore?: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const off = Boolean(card.deactivatedAt);
  const rowBusy = edit?.busy === true || dangerBusy;
  const saveCert = onSaveCert ?? (async () => ({ ok: true } as const));
  return (
    <>
      {registered ? <RegisteredBanner name={card.name} /> : null}
      {notice ? <div className="banner ok" role="status" data-notice="sessions-ended">{notice}</div> : null}
      <div className="grid2">
        <div className="card">
          <div className="card-h">
            {card.name}
            {off ? <span className="tag gray">已停用</span> : <span className="tag">在职</span>}
            <span className="hint">打开人员详情会留痕</span>
          </div>
          {edit ? (
            <PersonnelEditForm card={card} self={self} edit={edit} />
          ) : (
            <>
              <div className="kv">
                <div className="k">工号</div>
                <div className="mono">{card.code}</div>
                <div className="k">姓名</div>
                <div>{card.name}</div>
                <div className="k">手机号</div>
                <div>
                  {revealed ? card.mobilePhone ?? '—' : maskPhone(card.mobilePhone)}
                  {card.mobilePhone ? (
                    <>
                      {' '}
                      <button type="button" className="link-btn" style={{ fontSize: 12 }} onClick={() => setRevealed(!revealed)}>
                        {revealed ? '隐藏号码' : '显示完整号码'}
                      </button>
                    </>
                  ) : null}
                </div>
                <div className="k">当前机构</div>
                <div>{orgText(card)}</div>
                <div className="k">角色</div>
                <div>{card.roles.join('、') || '—'}</div>
                <div className="k">口令</div>
                <div>{passwordText(card)}</div>
              </div>
              <div className="actions" style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="btn btn-sm"
                  data-requires={PERSONNEL_UPDATE}
                  disabled={off || !canUpdate || dangerBusy}
                  onClick={onEnterEdit}
                >
                  编辑姓名、手机号、角色
                </button>
              </div>
              <CertSection card={card} now={now} canUpdate={canUpdateCert} onSave={saveCert} />
            </>
          )}
        </div>
        <div>
          <PostsCard card={card} />
          <div className="card">
            <div className="card-h">需谨慎的操作</div>
            <div className="danger-zone">
              {off ? (
                /* 已停用卡片没有调岗、结束、停用入口（v0.4，P6-restoreNewOrg）；恢复一行照原型。 */
                <div className="row">
                  <div>
                    恢复人员
                    <div className="help">恢复后需用新的初始口令登录</div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    data-requires={PERSONNEL_RESTORE}
                    data-action="restore"
                    disabled={!canRestore || dangerBusy}
                    onClick={onOpenRestore}
                  >
                    恢复
                  </button>
                </div>
              ) : (
                <>
                  <div className="row">
                    <div>
                      调岗
                      <div className="help">新机构的数据范围下一次操作即生效</div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm"
                      data-requires={PERSONNEL_UPDATE}
                      data-action="transfer"
                      disabled={self || !canUpdate || rowBusy}
                      onClick={onOpenTransfer}
                    >
                      调岗
                    </button>
                  </div>
                  {/* 重设初始口令一行由 #132 补入。 */}
                  <div className="row">
                    <div>
                      结束全部会话
                      <div className="help">对方的全部会话在下一次操作时结束</div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost-danger"
                      data-requires={PERSONNEL_SESSIONS_END}
                      data-action="endsessions"
                      disabled={self || !canEndSessions || rowBusy}
                      onClick={onOpenEndSessions}
                    >
                      结束
                    </button>
                  </div>
                  <div className="row">
                    <div>
                      停用人员
                      <div className="help">停用后不能登录，记录照常保留</div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost-danger"
                      data-requires={PERSONNEL_DEACTIVATE}
                      data-action="deactivate"
                      disabled={self || !canDeactivate || rowBusy}
                      onClick={onOpenDeactivate}
                    >
                      停用
                    </button>
                  </div>
                </>
              )}
            </div>
            {self && !off ? (
              <div className="banner amber" data-reason="self" style={{ marginTop: 10, marginBottom: 0 }}>
                这是你本人。不能给自己调岗、重设口令、结束会话或停用，请找本单位其他系统管理人员办理。
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}

/** P6 loading：左右两块骨架。 */
export function PersonnelCardSkeleton() {
  return (
    <div className="grid2" aria-busy="true">
      <SkeletonCard rows={8} />
      <SkeletonCard rows={4} />
    </div>
  );
}

function CardError() {
  const error = useAsyncError();
  const revalidator = useRevalidator();
  const opcodes = useAppSelector((root) => root.login.operator?.opcodes ?? []);
  const status = errorStatus(error);
  if (status === 403) return <PersonnelDenied what="人员详情" opcodes={opcodes} supervise={SUPERVISE} />;
  if (status === 404) {
    return (
      <div className="card">
        <div className="empty">
          <div className="t">没有找到这个人员</div>
          <div>地址可能输错了，或这个人员不在你的范围内。请从人员名单进入。</div>
          <div style={{ marginTop: 14 }}><Link className="btn btn-primary" to="/admin/personnel">回到人员名单</Link></div>
        </div>
      </div>
    );
  }
  return <ErrorCard what="人员详情" onRetry={() => void revalidator.revalidate()} />;
}

/** 调入机构的新「当前机构」上级名：上级是根机构或本机构是根机构时为 null（同卡接口口径）。 */
export function parentNameOf(dest: TransferDestination, units: readonly TransferDestination[]): string | null {
  const parent = units.find((unit) => unit.id === dest.parentId);
  if (!parent || parent.parentId === null) return null;
  return parent.name;
}

/**
 * 卡片工作区：执法证登记（#133）与编辑、调岗（#129）、停用、恢复、结束全部会话（#130）的状态放这里。
 * 编辑、调岗与危险操作成功后就地更新卡片，不重取（重取会多写一行 personnel.viewed）；
 * 执法证保存成功后重取卡片——接口返回体不回显证号，界面按库里的当前值重新渲染。
 */
function CardWorkspace({ loaded, registered }: { loaded: PersonnelCard; registered: boolean }) {
  const dispatch = useAppDispatch();
  const revalidator = useRevalidator();
  const operator = useAppSelector((root) => root.login.operator);
  const opcodes = operator?.opcodes ?? [];
  const [override, setOverride] = useState<PersonnelCard | null>(null);
  const card = override ?? loaded;
  const [edit, setEdit] = useState<{ input: EditInput; failure: EditFailure | null; busy: boolean } | null>(null);
  const [transfer, setTransfer] = useState<Omit<TransferState, 'onChange' | 'onCancel' | 'onSubmit'> | null>(null);
  const [danger, setDanger] = useState<DangerWorkspace | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const self = operator !== null && operator.code === card.code;
  const canUpdate = opcodes.includes(PERSONNEL_UPDATE);
  const canDeactivate = opcodes.includes(PERSONNEL_DEACTIVATE);
  const canRestore = opcodes.includes(PERSONNEL_RESTORE);
  const canEndSessions = opcodes.includes(PERSONNEL_SESSIONS_END);
  const canUpdateCert = opcodes.includes(PERSONNEL_CERT_UPDATE);

  const saveCert = async (input: CertUpdateInput): Promise<CertUpdateResult> => {
    const result = await updateCert(dispatch, card.id, input);
    if (result.ok) {
      // 重取回来的卡片是权威值：先丢掉编辑与调岗留下的就地覆盖，否则旧证件情况会盖住新值。
      setOverride(null);
      void revalidator.revalidate();
    }
    return result;
  };

  const submitEdit = async (input: EditInput) => {
    setEdit({ input, failure: null, busy: true });
    const result = await updatePersonnel(dispatch, card.id, input);
    if (result.ok) {
      // 就地更新卡片显示（提交成功的值就是新值），角色与标记按显示顺序归位。
      // 函数式更新：合并到最新的 override（或 loaded），避免与并发的调岗回调展开同一份旧 card 互相覆盖。
      setOverride((prev) => ({
        ...(prev ?? loaded),
        name: input.name.trim(),
        mobilePhone: input.mobilePhone.trim(),
        roles: ROLES.filter((role) => input.roles.includes(role)),
        posts: POSTS.filter((post) => (input.posts as readonly string[]).includes(post)),
      }));
      setEdit(null);
      return;
    }
    setEdit({ input, failure: { fields: result.fields, message: result.message }, busy: false });
  };

  const openTransfer = async () => {
    setTransfer({ destinations: null, loadFailed: false, orgUnitId: '', failure: null, busy: false });
    const destinations = await loadTransferDestinations(dispatch, card.id);
    setTransfer((prev) => (prev === null ? prev : { ...prev, destinations, loadFailed: destinations === null }));
  };

  const submitTransfer = async (state: Omit<TransferState, 'onChange' | 'onCancel' | 'onSubmit'>) => {
    setTransfer({ ...state, busy: true });
    const result = await transferPersonnel(dispatch, card.id, state.orgUnitId);
    if (result.ok) {
      const dest = state.destinations?.find((unit) => unit.id === state.orgUnitId);
      if (dest) {
        // 函数式更新：合并到最新的 override（或 loaded），避免与并发的编辑回调展开同一份旧 card 互相覆盖。
        setOverride((prev) => ({
          ...(prev ?? loaded),
          orgUnitId: dest.id,
          orgName: dest.name,
          orgParentName: parentNameOf(dest, state.destinations ?? []),
        }));
      }
      setTransfer(null);
      return;
    }
    setTransfer({ ...state, failure: { fields: result.fields, message: result.message }, busy: false });
  };

  const openDeactivate = () => {
    setNotice(null);
    setDanger({ kind: 'deactivate', busy: false, message: null });
  };

  const openEndSessions = () => {
    setNotice(null);
    setDanger({ kind: 'endsessions', busy: false, message: null });
  };

  const openRestore = async () => {
    setNotice(null);
    setDanger({ kind: 'restore', busy: false, orgUnits: card.orgDeactivated ? null : [], loadFailed: false, initialPassword: '', orgUnitId: '', failure: null });
    if (!card.orgDeactivated) return;
    const orgUnits = await loadRestoreOrgUnits(dispatch);
    setDanger((prev) => (prev === null || prev.kind !== 'restore' ? prev : { ...prev, orgUnits, loadFailed: orgUnits === null }));
  };

  const submitConfirm = async (kind: 'deactivate' | 'endsessions') => {
    setDanger({ kind, busy: true, message: null });
    const result = kind === 'deactivate'
      ? await deactivatePersonnel(dispatch, card.id)
      : await endPersonnelSessions(dispatch, card.id);
    if (result.ok) {
      setDanger(null);
      if (kind === 'deactivate') {
        // 就地翻成已停用态：标签、口令一栏与危险操作区（恢复一行）随之切换。
        setOverride((prev) => ({ ...(prev ?? loaded), deactivatedAt: new Date().toISOString() }));
      } else {
        setNotice(SESSIONS_ENDED_NOTICE);
      }
      return;
    }
    if (result.message === null) {
      setDanger(null);
      return;
    }
    setDanger({ kind, busy: false, message: result.message });
  };

  const submitRestore = async (state: Extract<DangerWorkspace, { kind: 'restore' }>) => {
    setDanger({ ...state, busy: true });
    const result = await restorePersonnel(dispatch, card.id, { initialPassword: state.initialPassword, orgUnitId: state.orgUnitId });
    if (result.ok) {
      const dest = state.orgUnits?.find((unit) => unit.id === result.orgUnitId);
      // 就地翻成在职态：口令回到「尚未改过初始口令」；带新机构时任职一并更新（恢复与调岗同事务）。
      setOverride((prev) => ({
        ...(prev ?? loaded),
        deactivatedAt: null,
        passwordChangedAt: null,
        orgDeactivated: false,
        ...(dest ? { orgUnitId: dest.id, orgName: dest.name, orgParentName: parentNameOf(dest, state.orgUnits ?? []) } : {}),
      }));
      setDanger(null);
      return;
    }
    if (result.message === null && Object.keys(result.fields).length === 0 && result.passwordRules.length === 0) {
      setDanger(null);
      return;
    }
    setDanger({ ...state, busy: false, failure: { fields: result.fields, passwordRules: result.passwordRules, message: result.message } });
  };

  return (
    <>
      <Crumb title={card.name} />
      <PersonnelCardView
        card={card}
        now={new Date()}
        registered={registered}
        canUpdateCert={canUpdateCert}
        onSaveCert={saveCert}
        self={self}
        canUpdate={canUpdate}
        canDeactivate={canDeactivate}
        canRestore={canRestore}
        canEndSessions={canEndSessions}
        dangerBusy={danger?.busy === true}
        notice={notice}
        edit={edit === null ? null : {
          ...edit,
          onInput: (next) => setEdit({ ...edit, input: next }),
          onCancel: () => setEdit(null),
          onSubmit: () => void submitEdit(edit.input),
        }}
        onEnterEdit={() => setEdit({ input: editInputFromCard(card), failure: null, busy: false })}
        onOpenTransfer={() => void openTransfer()}
        onOpenDeactivate={openDeactivate}
        onOpenEndSessions={openEndSessions}
        onOpenRestore={() => void openRestore()}
      />
      {transfer ? (
        <TransferDialog
          card={card}
          transfer={{
            ...transfer,
            onChange: (orgUnitId) => setTransfer({ ...transfer, orgUnitId }),
            onCancel: () => setTransfer(null),
            onSubmit: () => void submitTransfer(transfer),
          }}
        />
      ) : null}
      {danger?.kind === 'deactivate' ? (
        <DeactivateDialog
          card={card}
          confirm={{
            busy: danger.busy,
            message: danger.message,
            onCancel: () => setDanger(null),
            onSubmit: () => void submitConfirm('deactivate'),
          }}
        />
      ) : null}
      {danger?.kind === 'endsessions' ? (
        <EndSessionsDialog
          card={card}
          confirm={{
            busy: danger.busy,
            message: danger.message,
            onCancel: () => setDanger(null),
            onSubmit: () => void submitConfirm('endsessions'),
          }}
        />
      ) : null}
      {danger?.kind === 'restore' ? (
        <RestoreDialog
          card={card}
          restore={{
            orgUnits: danger.orgUnits,
            loadFailed: danger.loadFailed,
            initialPassword: danger.initialPassword,
            orgUnitId: danger.orgUnitId,
            failure: danger.failure,
            busy: danger.busy,
            onPassword: (initialPassword) => setDanger({ ...danger, initialPassword }),
            onOrg: (orgUnitId) => setDanger({ ...danger, orgUnitId }),
            onCancel: () => setDanger(null),
            onSubmit: () => void submitRestore(danger),
          }}
        />
      ) : null}
    </>
  );
}

/** 危险操作区三个弹窗的工作状态；restore 另带新任职机构清单与表单。 */
type DangerWorkspace =
  | { kind: 'deactivate' | 'endsessions'; busy: boolean; message: string | null }
  | {
    kind: 'restore';
    busy: boolean;
    orgUnits: OrgUnit[] | null;
    loadFailed: boolean;
    initialPassword: string;
    orgUnitId: string;
    failure: RestoreFailure | null;
  };

/** 人员卡片（P6）：每次打开服务端写 personnel.viewed；手机号默认遮挡，点开只是前端解除遮挡。 */
export default function PersonnelCardPage() {
  const { card } = useLoaderData() as { card: Promise<PersonnelCard | null> };
  const opcodes = useAppSelector((root) => root.login.operator?.opcodes ?? []);
  const [search] = useSearchParams();
  const registered = search.get('registered') === '1';
  if (!opcodes.includes(PERSONNEL_READ)) {
    return (
      <>
        <Crumb title="人员详情" />
        <PersonnelDenied what="人员详情" opcodes={opcodes} supervise={SUPERVISE} />
      </>
    );
  }
  return (
    <Suspense fallback={<><Crumb title="人员详情" /><PersonnelCardSkeleton /></>}>
      <Await resolve={card} errorElement={<><Crumb title="人员详情" /><CardError /></>}>
        {(resolved: PersonnelCard | null) => (resolved ? (
          <CardWorkspace loaded={resolved} registered={registered} />
        ) : null)}
      </Await>
    </Suspense>
  );
}
