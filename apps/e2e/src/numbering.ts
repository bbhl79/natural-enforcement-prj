// DEF-NNNN 取号（#106；Spec-e2e §4）：本地 max+1，可叠读远端已有编号。
// 远端叠读由 devenv 宿主侧经 `devenv gh` best-effort 取得后以 --remote-max 传入
// （容器内无网络凭据，也不得有）；撞号由后合入方机械重排（#116 renumber）。
// 取号不填洞：断号是校验器的违规项（编号唯一 + 连续无洞），不是取号要修的事。
import type { DefectTree } from './tree.js'

/** 编号形态 DEF-NNNN（四位补零）；容量耗尽明确报错，不静默产出非法 ID */
export function formatDefectId(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 9999) {
    throw new Error(`DEF 编号非法或容量耗尽：${n}（合法区间 DEF-0001..DEF-9999）`)
  }
  return `DEF-${String(n).padStart(4, '0')}`
}

/** 本地最大编号：按 defects/ 文件名集合（非法内容的记录仍占号——记录永不删除） */
export function localMaxNumber(tree: DefectTree): number {
  let max = 0
  for (const f of tree.defectFiles) {
    const m = /^DEF-(\d{4})\.json$/.exec(f)
    if (!m) continue
    const n = Number.parseInt(m[1] ?? '0', 10)
    if (n > max) max = n
  }
  return max
}

export interface NextDefectId {
  id: string
  localMax: number
  remoteMax: number
}

/** 下一个可用编号 = max(本地, 远端) + 1 */
export function nextDefectId(tree: DefectTree, remoteMax = 0): NextDefectId {
  const localMax = localMaxNumber(tree)
  const remote = Number.isInteger(remoteMax) && remoteMax > 0 ? remoteMax : 0
  return { id: formatDefectId(Math.max(localMax, remote) + 1), localMax, remoteMax: remote }
}