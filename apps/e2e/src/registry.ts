// 注册表 = 派生缓存（#106；Spec-e2e §3 / ADR 2026-11-19 双轨生命周期 §2）。
//
// 定型口径（原型实证「漂移即红」会死锁：verify 失败时不重写缓存 → 下次必报
// drift → 永远红，哪怕真实违规已修）：
//   - 注册表**不入库**（apps/e2e/.registry.json，.gitignore 排除）；
//   - 校验器**始终重建**；漂移仅 WARN，不作硬门禁；
//   - 完整性锚在入库缺陷记录（defects/*.json）与 git 历史，缓存只证「派生可重建」。
// 本模块是纯函数：重建/漂移判定都不落盘（写盘经 op 协议由 devenv 宿主侧执行）。
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DefectEngine, DefectStatus } from './defect/schema.js'
import type { DefectTree } from './tree.js'

/** 派生缓存文件（相对 apps/e2e；不入库） */
export const REGISTRY_FILE = '.registry.json'

export interface RegistryEntry {
  id: string
  status: DefectStatus
  engine: DefectEngine
  specPath: string | null // 复现轨道用例（graduated/fixed 才有；索引一致性由校验器判定）
}

export interface Registry {
  defects: RegistryEntry[]
}

/** 始终重建：从事实源派生索引（按 id 排序，稳定字节形便于漂移比对） */
export function rebuildRegistry(tree: DefectTree): string {
  const defects: RegistryEntry[] = [...tree.defects.values()]
    .map((d) => ({
      id: d.record.id,
      status: d.record.status,
      engine: d.record.engine,
      specPath: (tree.reproSpecs.get(d.record.id) ?? [])[0] ?? null,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return `${JSON.stringify({ defects } satisfies Registry, null, 2)}\n`
}

/** 漂移检测（非违规）：缓存存在且与重建结果不一致 → true（调用方 WARN + 重建） */
export function registryDrifted(tree: DefectTree): boolean {
  const regPath = join(tree.root, REGISTRY_FILE)
  if (!existsSync(regPath)) return false
  try {
    const existing: unknown = JSON.parse(readFileSync(regPath, 'utf8'))
    const rebuilt: unknown = JSON.parse(rebuildRegistry(tree))
    return JSON.stringify(existing) !== JSON.stringify(rebuilt)
  } catch {
    return true // 缓存损坏同样可重建自愈
  }
}