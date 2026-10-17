import { Suspense, useState } from 'react';
import { Await, Link, useAsyncError, useLoaderData, useRevalidator, useSearchParams } from 'react-router';

import { useAppSelector } from '../hooks';
import { ErrorCard, errorStatus } from '../shell/StatusPages';
import {
  CERT_TAG,
  certNote,
  maskPhone,
  orgText,
  passwordText,
  PERSONNEL_READ,
  POST_LABEL,
  type PersonnelCard,
} from './personnel';
import { PersonnelDenied, SkeletonCard } from './PersonnelStatus';

const SUPERVISE = '监督可以在「管理台留痕」里查阅人员维护的留痕。';

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

function CertSection({ cert, now }: { cert: PersonnelCard['cert']; now: Date }) {
  const tag = CERT_TAG[cert.status];
  const note = certNote(cert, now);
  const registered = cert.status !== 'none';
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
        {/* 证件状态列（有效 / 失效）由 #133 接入；接入前已登记的证一律按有效显示。 */}
        <div>{registered ? '有效' : '—'}</div>
      </div>
      <div className={`banner ${note.tone}`} style={{ marginTop: 10 }}>{note.text}</div>
      {/* 「登记执法证 / 变更执法证」按钮由 #133（personnel.cert.update）放在这里。 */}
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
}: {
  card: PersonnelCard;
  now: Date;
  registered: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const off = Boolean(card.deactivatedAt);
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
          <CertSection cert={card.cert} now={now} />
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
            <PersonnelCardView card={resolved} now={new Date()} registered={registered} />
          </>
        ) : null)}
      </Await>
    </Suspense>
  );
}
