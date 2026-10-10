import { fetchHealthSnapshot } from './healthSlice';
import { useAppDispatch, useAppSelector } from '../hooks';

const STATUS_STYLE: Record<string, { dot: string; text: string }> = {
  ok: { dot: 'bg-emerald-500', text: 'text-emerald-700' },
  fail: { dot: 'bg-red-500', text: 'text-red-700' },
};

/**
 * health 面板（#56）：展示后端四依赖（容器/db/队列/前端可访问）状态，
 * 与 dev health 输出同源（快照由 dev 脚本生成，经 /health/health.json 提供）。
 */
export default function HealthPanel() {
  const dispatch = useAppDispatch();
  const { loadState, snapshot, error } = useAppSelector((state) => state.health);

  return (
    <main className="mx-auto max-w-2xl px-6 py-12 font-sans">
      <h1 className="text-2xl font-bold text-slate-900">自然执法工程 · 环境健康面板</h1>
      <p className="mt-2 text-sm text-slate-500">
        后端四依赖状态，与 <code className="rounded bg-slate-100 px-1">dev health</code> 输出同源。
      </p>

      {loadState === 'loading' && <p className="mt-8 text-slate-600">正在读取健康快照…</p>}

      {loadState === 'failed' && (
        <div className="mt-8 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          <p>未找到健康快照：{error}</p>
          <p className="mt-1">
            请先运行 <code className="rounded bg-amber-100 px-1">dev health</code>
            （或 dev up）生成快照；面板数据与 dev health 同源。
          </p>
        </div>
      )}

      {loadState === 'succeeded' && snapshot && (
        <>
          <ul className="mt-8 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white shadow-sm">
            {snapshot.checks.map((check) => {
              const style = STATUS_STYLE[check.status] ?? {
                dot: 'bg-slate-300',
                text: 'text-slate-500',
              };
              return (
                <li key={check.id} className="flex items-center gap-3 px-4 py-3">
                  <span className={`h-2.5 w-2.5 rounded-full ${style.dot}`} aria-hidden="true" />
                  <span className="w-24 shrink-0 font-medium text-slate-800">{check.label}</span>
                  <span className={`text-sm ${style.text}`}>{check.detail}</span>
                </li>
              );
            })}
          </ul>
          <p className="mt-4 text-xs text-slate-400">
            快照生成时间：{snapshot.generatedAt} · 数据源：nginx 同域静态端点 /health/health.json
          </p>
        </>
      )}

      <button
        type="button"
        className="mt-8 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        onClick={() => void dispatch(fetchHealthSnapshot())}
      >
        重新读取
      </button>
    </main>
  );
}
