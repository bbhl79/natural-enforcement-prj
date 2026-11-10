# Feature Map 维护约定

1. Scenario 跑红且原因为「找不到控件」时：先改地图选择器，再改产品（除非产品无障碍名）。
2. 路由或主导航变更：同步改 `feature-map.md` 对应行；PR 描述点名地图 diff。
3. 新能力上线：先加地图节点（可 `selectors: TBD`），再把相关 `latent` scenario 改为 `runnable`。
4. 标了 `fragile: true` 的条目，每季度或大改版后必须实机复核一次。
5. 完整「维护 Skill」可另票；当前由执行 Verification 的 Agent 按本文件回写。
