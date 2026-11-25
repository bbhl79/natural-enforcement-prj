// 纯展示格式化（可单测；不触 DOM / 网络）

export function formatDistance(m: number | null | undefined): string {
  if (m == null) return '—'
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`
}
