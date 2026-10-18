import { Suspense, useState, type FormEvent } from 'react';
import { Await, Link, useAsyncError, useLoaderData, useRevalidator, useSearchParams } from 'react-router';

import { useAppDispatch, useAppSelector } from '../hooks';
import { ErrorCard, errorStatus } from '../shell/StatusPages';
import {
  CERT_RECORD_STATUS_LABEL,
  CERT_RECORD_STATUSES,
  CERT_TAG,
  certEditFrom,
  certNote,
  certProblemCount,
  certRecordLabel,
  maskPhone,
  orgText,
  passwordText,
  PERSONNEL_CERT_UPDATE,
  PERSONNEL_READ,
  POST_LABEL,
  updateCert,
  type CertRecordStatus,
  type CertUpdateInput,
  type CertUpdateResult,
  type PersonnelCard,
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

/** 岗位标记（#105 A1，不在 v0.4，按 spec 例外以单测和集成测试验收）。只读；维护入口随编辑票（#129）。 */
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

/** P6 view（纯渲染，单测直接渲染）。危险操作区随 #129、#130、#132 补入右栏。 */
export function PersonnelCardView({
  card,
  now,
  registered,
  canUpdate = false,
  onSaveCert,
}: {
  card: PersonnelCard;
  now: Date;
  registered: boolean;
  /** 会话清单里有 personnel.cert.update 时才显示执法证的登记按钮 */
  canUpdate?: boolean;
  onSaveCert?: (input: CertUpdateInput) => Promise<CertUpdateResult>;
}) {
  const [revealed, setRevealed] = useState(false);
  const off = Boolean(card.deactivatedAt);
  const saveCert = onSaveCert ?? (async () => ({ ok: true } as const));
  return (
    <>
      {registered ? <RegisteredBanner name={card.name} /> : null}
      <div className="grid2">
        <div className="card">
          <div className="card-h">
            {card.name}
            {off ? <span className="tag gray">已停用</span> : <span className="tag">在职</span>}
            <span className="hint">打开人员详情会留痕</span>
          </div>
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
          {/* 「编辑姓名、手机号、角色」按钮由 #129（personnel.profile.update）放在这里。 */}
          <CertSection card={card} now={now} canUpdate={canUpdate} onSave={saveCert} />
        </div>
        <div>
          <PostsCard card={card} />
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

/**
 * 卡片主体：接上执法证登记的取数与提交（#133）。
 * 保存成功后重取卡片——接口返回体不回显证号，界面按库里的当前值重新渲染。
 */
function ResolvedCard({ card, registered }: { card: PersonnelCard; registered: boolean }) {
  const dispatch = useAppDispatch();
  const revalidator = useRevalidator();
  const opcodes = useAppSelector((root) => root.login.operator?.opcodes ?? []);
  const saveCert = async (input: CertUpdateInput): Promise<CertUpdateResult> => {
    const result = await updateCert(dispatch, card.id, input);
    if (result.ok) void revalidator.revalidate();
    return result;
  };
  return (
    <PersonnelCardView
      card={card}
      now={new Date()}
      registered={registered}
      canUpdate={opcodes.includes(PERSONNEL_CERT_UPDATE)}
      onSaveCert={saveCert}
    />
  );
}

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
          <>
            <Crumb title={resolved.name} />
            <ResolvedCard card={resolved} registered={registered} />
          </>
        ) : null)}
      </Await>
    </Suspense>
  );
}
