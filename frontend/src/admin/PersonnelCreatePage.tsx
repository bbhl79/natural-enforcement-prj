import { Suspense, useState, type FormEvent } from 'react';
import { Await, Link, useAsyncError, useLoaderData, useNavigate, useRevalidator } from 'react-router';

import { useAppDispatch, useAppSelector } from '../hooks';
import { ErrorCard } from '../shell/StatusPages';
import type { OrgUnit } from './orgTree';
import {
  PASSWORD_RULE_LABEL,
  PASSWORD_RULES,
  PERSONNEL_REGISTER,
  POST_LABEL,
  POSTS,
  problemCount,
  registerPersonnel,
  ROLES,
  type PersonnelPost,
  type RegisterInput,
  type RegisterResult,
} from './personnel';
import { PersonnelDenied, SkeletonCard } from './PersonnelStatus';

function Crumb() {
  return <div className="crumb">管理台 / <Link to="/admin/personnel">人员</Link> / <b>新建人员</b></div>;
}

export const EMPTY_INPUT: RegisterInput = {
  code: '', name: '', orgUnitId: '', mobilePhone: '', initialPassword: '', roles: [], posts: [], certNo: '', certExpiresOn: '',
};

type Failure = Extract<RegisterResult, { ok: false }>;

function toggle<T>(list: readonly T[], item: T, on: boolean): T[] {
  return on ? [...list.filter((x) => x !== item), item] : list.filter((x) => x !== item);
}

/** P6 create / createInvalid（纯渲染，单测直接渲染）。 */
export function PersonnelCreateForm({
  orgUnits,
  input,
  failure,
  busy,
  onInput,
  onSubmit,
}: {
  orgUnits: readonly OrgUnit[];
  input: RegisterInput;
  failure: Failure | null;
  busy: boolean;
  onInput: (next: RegisterInput) => void;
  onSubmit: () => void;
}) {
  const fields = failure?.fields ?? {};
  const missed = new Set(failure?.passwordRules ?? []);
  const count = failure ? problemCount(failure) : 0;
  const hint = (field: keyof RegisterInput, help: string | null) => {
    const error = fields[field];
    if (error) return <div className="err" data-error={field}>{error}</div>;
    return help ? <div className="help">{help}</div> : null;
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };
  return (
    <form onSubmit={submit} noValidate>
      {failure?.message ? <div className="banner danger">{failure.message}</div> : null}
      {count > 0 ? <div className="banner danger">{`还有 ${count} 处需要修改，改好后再保存。`}</div> : null}
      <div className="grid2">
        <div className="card">
          <div className="form-row">
            <label htmlFor="p-code">工号<span className="req">*</span></label>
            <div>
              <input id="p-code" className="input" value={input.code} onChange={(e) => onInput({ ...input, code: e.target.value })} />
              {hint('code', null)}
            </div>
          </div>
          <div className="form-row">
            <label htmlFor="p-name">姓名<span className="req">*</span></label>
            <div>
              <input id="p-name" className="input" value={input.name} onChange={(e) => onInput({ ...input, name: e.target.value })} />
              {hint('name', null)}
            </div>
          </div>
          <div className="form-row">
            <label htmlFor="p-phone">手机号<span className="req">*</span></label>
            <div>
              <input id="p-phone" className="input" inputMode="numeric" value={input.mobilePhone} onChange={(e) => onInput({ ...input, mobilePhone: e.target.value })} />
              {hint('mobilePhone', '用于登录，全系统不能重复')}
            </div>
          </div>
          <div className="form-row">
            <label htmlFor="p-org">任职机构<span className="req">*</span></label>
            <div>
              <select id="p-org" className="select" value={input.orgUnitId} onChange={(e) => onInput({ ...input, orgUnitId: e.target.value })}>
                <option value="">请选择任职机构</option>
                {orgUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
              </select>
              {hint('orgUnitId', '只能选你任职机构及其下级')}
            </div>
          </div>
          <div className="form-row">
            <label>角色<span className="req">*</span></label>
            <div>
              <div className="checks">
                {ROLES.map((role) => (
                  <label key={role}>
                    <input
                      type="checkbox"
                      checked={input.roles.includes(role)}
                      onChange={(e) => onInput({ ...input, roles: toggle(input.roles, role, e.target.checked) })}
                    />
                    {` ${role}`}
                  </label>
                ))}
              </div>
              {hint('roles', '至少选一个，可多选')}
            </div>
          </div>
          <div className="form-row" data-section="posts">
            <label>岗位标记</label>
            <div>
              <div className="checks">
                {POSTS.map((post) => (
                  <label key={post}>
                    <input
                      type="checkbox"
                      data-post={post}
                      checked={input.posts.includes(post)}
                      onChange={(e) => onInput({ ...input, posts: toggle<PersonnelPost>(input.posts, post, e.target.checked) })}
                    />
                    {` ${POST_LABEL[post]}`}
                  </label>
                ))}
              </div>
              {hint('posts', '可多选，也可不选。岗位标记用于审批链选人，不是角色，不授予任何权限。')}
            </div>
          </div>
          <div className="form-row">
            <label htmlFor="p-password">初始口令<span className="req">*</span></label>
            <div>
              <input
                id="p-password"
                className="input"
                type="text"
                autoComplete="off"
                placeholder="请输入新的初始口令"
                value={input.initialPassword}
                onChange={(e) => onInput({ ...input, initialPassword: e.target.value })}
              />
              {fields.initialPassword ? <div className="err" data-error="initialPassword">{fields.initialPassword}</div> : null}
              <div className="help">对方首次登录时必须改掉初始口令。请当面或电话告知，不要通过群聊发送。</div>
            </div>
          </div>
          <div className="section-title">执法证（可稍后登记）</div>
          {/* 原型 P6:51。可留空；要填须两项都填。变更与证件状态在卡片的执法证一段（#133）。 */}
          <div className="form-row">
            <label htmlFor="p-cert-no">执法证号</label>
            <div>
              <input id="p-cert-no" className="input" placeholder="未登记可留空" value={input.certNo} onChange={(e) => onInput({ ...input, certNo: e.target.value })} />
              {hint('certNo', null)}
            </div>
          </div>
          <div className="form-row">
            <label htmlFor="p-cert-expires">有效期至</label>
            <div>
              <input
                id="p-cert-expires"
                className="input"
                placeholder="年-月-日"
                style={{ width: 200 }}
                value={input.certExpiresOn}
                onChange={(e) => onInput({ ...input, certExpiresOn: e.target.value })}
              />
              {hint('certExpiresOn', null)}
            </div>
          </div>
          <div className="banner gray">不登记执法证也能建人员；未登记的人员不能启动核查、不能立案。</div>
          <div className="actions">
            <Link className="btn" to="/admin/personnel">取消</Link>
            <button type="submit" className="btn btn-primary" disabled={busy} data-requires={PERSONNEL_REGISTER}>保存</button>
          </div>
        </div>
        <div className="card">
          <div className="card-h">初始口令要求</div>
          <ul style={{ marginLeft: 18, lineHeight: 1.9 }}>
            {PASSWORD_RULES.map((rule) => (
              <li key={rule} data-rule={rule} style={{ color: missed.has(rule) ? 'var(--danger)' : 'inherit' }}>
                {PASSWORD_RULE_LABEL[rule]}
                {missed.has(rule) ? '（未满足）' : ''}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </form>
  );
}

function Head() {
  return (
    <>
      <Crumb />
      <div className="page-h">
        <div>
          <h1>新建人员</h1>
          <div className="desc">带 <span className="req">*</span> 的为必填。执法证可以稍后登记。</div>
        </div>
      </div>
    </>
  );
}

function OrgError() {
  useAsyncError();
  const revalidator = useRevalidator();
  return <ErrorCard what="可选机构" onRetry={() => void revalidator.revalidate()} />;
}

function CreateForm({ orgUnits }: { orgUnits: readonly OrgUnit[] }) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [input, setInput] = useState<RegisterInput>(EMPTY_INPUT);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const result = await registerPersonnel(dispatch, input);
    setBusy(false);
    if (result.ok) {
      // 口令只在本页内存里，跳转后即丢弃，不进地址栏和存储。
      void navigate(`/admin/personnel/${encodeURIComponent(result.id)}?registered=1`);
      return;
    }
    setFailure(result);
  };
  return (
    <PersonnelCreateForm
      orgUnits={orgUnits}
      input={input}
      failure={failure}
      busy={busy}
      onInput={setInput}
      onSubmit={() => void submit()}
    />
  );
}

/** 新建人员（P6 create）：只有持登记码的系统管理能用。 */
export default function PersonnelCreatePage() {
  const { orgUnits } = useLoaderData() as { orgUnits: Promise<OrgUnit[] | null> };
  const opcodes = useAppSelector((root) => root.login.operator?.opcodes ?? []);
  if (!opcodes.includes(PERSONNEL_REGISTER)) {
    return (
      <>
        <Crumb />
        <PersonnelDenied what="新建人员" opcodes={opcodes} supervise="监督可以在「管理台留痕」里查阅人员维护的留痕。" />
      </>
    );
  }
  return (
    <>
      <Head />
      <Suspense fallback={<div className="grid2" aria-busy="true"><SkeletonCard rows={8} /><SkeletonCard rows={7} /></div>}>
        <Await resolve={orgUnits} errorElement={<OrgError />}>
          {(resolved: OrgUnit[] | null) => (resolved ? <CreateForm orgUnits={resolved} /> : null)}
        </Await>
      </Suspense>
    </>
  );
}
