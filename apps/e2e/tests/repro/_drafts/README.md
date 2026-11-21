# tests/repro/_drafts/ — 毕业草稿区（CI 不收集）

不可机械转写的引擎（visual / model-journey / monkey / agent-session）毕业时先落草稿：
`devenv e2e graduate <ID>` 生成 `def-NNNN.draft.spec.ts`（占位断言自毁式），agent/人补完断言后
**重跑 `devenv e2e graduate <ID>`** 转正（真跑校验 → 移出 _drafts → 状态 graduated）。

规则（`devenv verify` 校验）：
- 文件头必须链 reported 缺陷（`// defect: DEF-NNNN`）
- 草稿不得启用 `test.fail()`（转正时由 graduate 启用）
- graduated/fixed/retired 的缺陷不得残留草稿
