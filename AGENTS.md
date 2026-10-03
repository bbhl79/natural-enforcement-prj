## 语言

与用户的交互，以及本仓库中的文档，使用简体中文。专业术语和惯用缩写保留原文，如 GitHub、issue、label、ADR、`gh`。

## Git 提交

准备提交信息，或执行 `git commit`、`git push` 之前，先读 `docs/rules/git-commit.md` 并遵守。

## Agent skills

### Issue tracker

议题与规格说明以 GitHub issue 形式存放在 `bbhl79/natural-enforcement-prj`。见 `docs/agents/issue-tracker.md`。

### Triage labels

五个标准角色，label 字符串与角色名相同（`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`）。见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文（single-context）：仓库根目录一份 `CONTEXT.md` 与 `docs/adr/`。见 `docs/agents/domain.md`。

## 合并 DoD

主 agent 合并进 `dev` 前逐项核对（工作流约定 §5）：

- `./dev lint`／`test`／`build` 绿
- A06 空库可 migrate
- A07–A12 挂在 `main` 与 `dev` 保护上，未被旁路
- block 门禁是服务端断言
- PR 回链 issue，且飞书权威指针版本等于当前基线
- 目标分支是 `dev`。`main` 只收里程碑出口的 `dev→main` release PR（人批准后合入并打 tag）
- 本仓库是 1 人项目。PR owner 是 Lei（`bbhl79`），无法对自己的 PR 点 GitHub Approve。人的合并闸门是在对话里明确说批准或同意合并；主 agent 收到后执行 merge。`assertions` 与 `path-guard` 仍是 required check。主 agent 先对照验收句检查，不合并未看过或未通过的 PR

## 红线摘要

全文见飞书《Agent 实施工作流约定》§2（token `AuzJdFfmRo2OLex0qDTcsXVHnvb`）。开工先读 `CONTEXT.md`。

- 设计口径以飞书为准。issue 内 spec 只留摘要加权威指针，禁止整段复制。冲突时改 issue。
- 提问前按 `CONTEXT.md` 检索飞书。命中用四元组作答；未命中才问人。
- 拍板按 USER LOCK 写回飞书：日期、编号、supersede 链。不覆盖旧结论。
- `gate.*` block 只能是服务端断言。禁止只灰前端按钮，禁止配置降级。
- `main` 是 release 分支，禁止在 `main` 上直接迭代。feature PR 进 `dev`。
- 权威指针四元组：doc_token＋version＋section＋url。合并前校验 version 等于当前基线。
- 完成等于该 feature 验收句全绿且为服务端断言。

## worktree

一律建在与项目平级的 `natural-enforcement-prj-wts/`，命名 `wt-<票号>`，从最新 `dev` 拉出：

```bash
git worktree add ../natural-enforcement-prj-wts/wt-123 -b feat/123 dev
```

## 已拍板（2026-10-03）

- 代码与 GitHub Issues 继续托管在 `bbhl79/natural-enforcement-prj`（[#2](https://github.com/bbhl79/natural-enforcement-prj/issues/2)）。
- 本阶段不设 spend cap，也不设每 feature 预算硬上限（[#3](https://github.com/bbhl79/natural-enforcement-prj/issues/3)）。tier 路由仍按工作流 §6.1。
- D3 当前基线＝v0.1.9，revision 175（LOCK-20261003-04，取代 LOCK-20261003-01；r12 行保留）。
- LOCK-20261003-05：M0b 范围＝MS-M0b ①；五条＝渲染入卷链五个服务端断言；GIS 不接真源；档案年限不进本次；迁移 0001 仅权限五表。附录 v0.1.7。

飞书写入先给人看正文，确认后才执行。
