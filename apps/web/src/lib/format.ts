// 纯展示格式化（可单测；不触 DOM / 网络）

export function formatDistance(m: number | null | undefined): string {
  if (m == null) return '—'
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`
}

export function formatBytes(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`
  return `${(n / (1024 * 1024)).toFixed(2)} MiB`
}

export function shortSha(sha: string | null | undefined): string {
  if (!sha) return '—'
  return sha.length > 12 ? `${sha.slice(0, 12)}…` : sha
}
