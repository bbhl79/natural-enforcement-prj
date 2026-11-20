// 纯展示格式化（可单测；不触 DOM / 网络）

export function formatDistance(m: number | null | undefined): string {
  if (m == null) return '—'
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`
}

export function formatBytes(b: number | null | undefined): string {
  if (b == null) return '—'
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / (1024 * 1024)).toFixed(1)} MB`
}

export function shortSha(sha: string | null | undefined): string {
  if (!sha) return '—'
  return sha.slice(0, 12)
}

/** unicode 文件名进 HTTP header 的临时契约：encodeURIComponent 转 ASCII-safe（#11 发现的 Latin-1 限制） */
export function encodeWireName(name: string): string {
  return encodeURIComponent(name)
}
