# Issue tracker：GitHub

本仓库的 issues 与 spec 以 GitHub Issues 形式存放。所有操作使用 `gh` CLI。

## 常用操作

- **创建 issue**：`gh issue create --title "..." --body "..."`。多行 body 使用 heredoc。
- **读取 issue**：`gh issue view <编号> --comments`，用 `jq` 过滤评论，同时获取标签。
- **列出 issues**：`gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`，按需附加 `--label` 与 `--state` 过滤。
- **评论 issue**：`gh issue comment <编号> --body "..."`
- **添加 / 移除标签**：`gh issue edit <编号> --add-label "..."` / `--remove-label "..."`
- **关闭 issue**：`gh issue close <编号> --comment "..."`

仓库从 `git remote -v` 推断；在 clone 目录内运行时 `gh` 自动识别。

## 标题前缀约定

技能体系创建的 issue，标题一律使用 `<前缀>-<简体中文描述>` 格式，前缀标识 issue 类型：

| 前缀         | issue 类型                  | 对应标签             |
| ------------ | --------------------------- | -------------------- |
| `Spec-`      | spec（`/to-spec` 产出）     | `ready-for-agent`    |
| `Map-`       | wayfinder 地图              | `wayfinder:map`      |
| `Research-`  | 调研子票                    | `wayfinder:research` |
| `Prototype-` | 原型子票                    | `wayfinder:prototype` |
| `Grilling-`  | 访谈子票                    | `wayfinder:grilling` |
| `Task-`      | 实现工单（`/to-tickets` 拆出） | `wayfinder:task`  |

- 描述部分用简体中文，简明表达内容。示例：`Spec-手工单位签收确认闭环`、`Map-e2e 探索体系落地`。
- 前缀与标签同时打，互为校验。
- 外部流入的原始 issue（如 bug 报告、外部请求）不加前缀；triage 收敛为可执行工单时，标题改为 `Task-` 前缀。

## PR 作为 triage 入口

**PR 作为请求入口：否。**（若本仓库把外部 PR 视为功能请求，改为 `yes`；`/triage` 读取此开关。）

设为 `yes` 时，PR 走与 issue 相同的标签与状态流程，使用 `gh pr` 对应命令：

- **读取 PR**：`gh pr view <编号> --comments`；diff 用 `gh pr diff <编号>`。
- **列出待 triage 的外部 PR**：`gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments`，只保留 `authorAssociation` 为 `CONTRIBUTOR`、`FIRST_TIME_CONTRIBUTOR` 或 `NONE` 的条目（丢弃 `OWNER`/`MEMBER`/`COLLABORATOR`）。
- **评论 / 标签 / 关闭**：`gh pr comment`、`gh pr edit --add-label`/`--remove-label`、`gh pr close`。

GitHub 的 issue 与 PR 共用一个编号空间，裸 `#42` 可能指两者之一：先 `gh pr view 42`，失败再 `gh issue view 42`。

## 当技能说「发布到 issue tracker」

创建一个 GitHub issue。

## 当技能说「获取相关工单」

运行 `gh issue view <编号> --comments`。

## Wayfinder 操作

供 `/wayfinder` 使用。**地图**是单条 issue，**子票**作为工单挂在地图下。

- **地图**：一条打上 `wayfinder:map` 标签的 issue，正文承载 Notes / 已有决策 / 迷雾。创建：`gh issue create --label wayfinder:map`。
- **子票**：作为 GitHub sub-issue 挂到地图下（用 `gh api` 调 sub-issues 端点）。sub-issues 不可用时，把子票加进地图正文的任务列表，并在子票正文顶部写 `Part of #<地图编号>`。标签：`wayfinder:<类型>`（`research`/`prototype`/`grilling`/`task`）。子票被认领后指派给当前开发。
- **阻塞关系**：使用 GitHub **原生 issue 依赖**，这是规范且 UI 可见的表达。加边：`gh api --method POST repos/<owner>/<repo>/issues/<子票>/dependencies/blocked_by -F issue_id=<阻塞者数据库id>`，其中 `<阻塞者数据库id>` 是阻塞者的数字 **database id**（`gh api repos/<owner>/<repo>/issues/<n> --jq .id`，不是 `#编号` 或 `node_id`）。GitHub 经 `issue_dependencies_summary.blocked_by` 报告开放阻塞者（仅开放项，实时闸门）。依赖功能不可用时，降级为在子票正文顶部写 `Blocked by: #<n>, #<n>`。所有阻塞者关闭后子票即解除阻塞。
- **前沿查询**：列出地图下开放的子票（`gh issue list --state open`，限定在地图的 sub-issues / 任务列表），剔除有开放阻塞者（`issue_dependencies_summary.blocked_by > 0`，或 `Blocked by` 行中有开放 issue）或已被认领的；按地图顺序取第一个。
- **认领**：`gh issue edit <n> --add-assignee @me`，作为会话首次写入。
- **解决**：`gh issue comment <n> --body "<答案>"`，然后 `gh issue close <n>`，再把上下文指针（gist + 链接）追加到地图的「已有决策」。
