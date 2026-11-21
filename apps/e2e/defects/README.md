# defects/ — 缺陷生命周期事实源（每缺陷一个 JSON，入库，永不删除）

- 文件名 = 缺陷 ID：`DEF-NNNN.json`（本地 max+1 取号；撞号由 `devenv e2e renumber` 机械重排）。
- 状态写在文件里（`reported` → `graduated` → `fixed`；终态 `retired`），唯一合法写入路径是
  `devenv e2e report | graduate | confirm-fix | retire`。
- schema：`apps/e2e/src/defect/schema.ts`；证据只存 URI（指向 `.artifacts/e2e/<run-id>/`，不入库）。
- 登记流程：探索失败 → 本目录落 `DEF-NNNN.json`（gate 可占位）+ `replay/DEF-NNNN.mjs`（复现脚本草案）
  → `devenv e2e report`（实测门禁后回填并落账）。
