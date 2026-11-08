// 旅程启动前的隔离门禁。纯函数，不调用 docker，不执行 dev up。

export const SHARED_COMPOSE_PROJECT = 'natural-enforcement';

/** infra/runtime.env 里的宿主端口。隔离栈必须改掉这些值，避免占用共享端口。 */
export const SHARED_HOST_PORTS = {
  POSTGRES_PORT: '5432',
  REDIS_PORT: '6379',
  RUSTFS_PORT: '9000',
  RUSTFS_CONSOLE_PORT: '9001',
  NGINX_PORT: '8080',
} as const;

const DEDICATED_PROJECT = /^verify-[a-z0-9][a-z0-9-]{2,40}$/;

export interface IsolationEnv {
  readonly COMPOSE_PROJECT_NAME?: string | undefined;
  readonly NE_DEPLOYMENT?: string | undefined;
  readonly NODE_ENV?: string | undefined;
  readonly VERIFY_ISOLATION?: string | undefined;
  readonly POSTGRES_PORT?: string | undefined;
  readonly REDIS_PORT?: string | undefined;
  readonly RUSTFS_PORT?: string | undefined;
  readonly RUSTFS_CONSOLE_PORT?: string | undefined;
  readonly NGINX_PORT?: string | undefined;
}

export interface IsolationDecision {
  readonly ok: boolean;
  readonly reasons: readonly string[];
  readonly project: string | null;
  readonly upAllowed: false | true;
  readonly sourceGateBypass: false;
}

export function evaluateJourneyIsolation(env: IsolationEnv): IsolationDecision {
  const reasons: string[] = [];
  const project = (env.COMPOSE_PROJECT_NAME ?? '').trim();
  if (project === '') reasons.push('缺少 COMPOSE_PROJECT_NAME');
  if (project === SHARED_COMPOSE_PROJECT) reasons.push('拒绝默认 natural-enforcement 项目');
  if (project.includes('e3')) reasons.push('拒绝 e3 项目名');
  if (project !== '' && project !== SHARED_COMPOSE_PROJECT && !DEDICATED_PROJECT.test(project)) {
    reasons.push('COMPOSE_PROJECT_NAME 必须匹配 verify-*');
  }
  if ((env.NE_DEPLOYMENT ?? '').trim() !== 'verify') reasons.push('NE_DEPLOYMENT 必须是 verify');
  if ((env.NODE_ENV ?? '').trim() === 'production') reasons.push('拒绝 NODE_ENV=production');
  if ((env.VERIFY_ISOLATION ?? '').trim() !== 'dedicated') reasons.push('缺少 VERIFY_ISOLATION=dedicated');
  for (const [name, shared] of Object.entries(SHARED_HOST_PORTS)) {
    const value = (env[name as keyof typeof SHARED_HOST_PORTS] ?? '').trim();
    if (value === '') reasons.push(`缺少 ${name}`);
    else if (value === shared) reasons.push(`${name} 仍是共享端口 ${shared}`);
  }
  const ok = reasons.length === 0;
  return {
    ok,
    reasons,
    project: ok ? project : null,
    upAllowed: ok,
    sourceGateBypass: false,
  };
}

export interface DiffSnapshot {
  readonly runId: string;
  readonly status: 'passed' | 'failed' | 'blocked';
  readonly endedAt: string | null;
}

export type DiffPlanStatus =
  | 'first-run'
  | 'compared'
  | 'baseline-missing'
  | 'blocked-baseline'
  | 'interrupted';

/** 显式基线优先。无基线且无已完成入账跑次时为首次运行。blocked 与未结束跑次不作为基线。 */
export function planHistoryDiff(
  requestedBaselineId: string,
  snapshots: readonly DiffSnapshot[],
): { readonly status: DiffPlanStatus; readonly baselineRunId: string | null } {
  const requested = requestedBaselineId.trim();
  if (requested !== '') {
    const named = snapshots.find((item) => item.runId === requested);
    if (named === undefined) return { status: 'baseline-missing', baselineRunId: null };
    if (named.status === 'blocked') return { status: 'blocked-baseline', baselineRunId: named.runId };
    if (named.endedAt === null || named.endedAt === '') {
      return { status: 'interrupted', baselineRunId: named.runId };
    }
    return { status: 'compared', baselineRunId: named.runId };
  }
  const completed = snapshots.filter(
    (item) => item.status !== 'blocked' && item.endedAt !== null && item.endedAt !== '',
  );
  if (completed.length === 0) return { status: 'first-run', baselineRunId: null };
  const latest = completed.reduce((best, item) => (item.endedAt! > best.endedAt! ? item : best));
  return { status: 'compared', baselineRunId: latest.runId };
}

/** 已完成（passed/failed）的跑次目录拒绝再次写入。 */
export function refuseCompletedRun(summaryStatus: string | null): boolean {
  return summaryStatus === 'passed' || summaryStatus === 'failed';
}
