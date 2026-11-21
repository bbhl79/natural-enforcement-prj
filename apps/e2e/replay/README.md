# replay/ — 复现脚本草案（每缺陷一个 .mjs，入库）

- 零第三方依赖（node 26 内建 fetch），长期可重建（缺陷记录的 `reproducibility.replayCommand` 指向这里）。
- 约定：脚本在 e2e 容器内执行，`E2E_API_BASE_URL` 注入目标栈；**退出码 0 = 缺陷复现**，非 0 = 未复现。
- `devenv e2e report` 用它实测复现门禁（确定性引擎 1 次、非确定引擎 ≥3 次全部复现）。
