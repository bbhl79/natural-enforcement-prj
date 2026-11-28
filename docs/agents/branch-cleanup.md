# 分支清理与原型归档保护：合入后清理、archive 标签保护与自动删除

本文件覆盖 Spec-工程基座 §7 Git 规范的「清理」与「归档」两节（[#74](https://github.com/bbhl79/natural-enforcement-prj/issues/74)，
验收清单项 11）。分支保护两层规则集（dev）见 [branch-protection.md](branch-protection.md)；
两者共用 `devenv branch-protection` 漂移核对入口与 `devenv/rulesets/` 保存配置。

## 窄用途：PR 合入后清理（非通用 worktree 管理器）

`devenv branch-cleanup <branch> [--apply]` 只提供「PR 合入后清理本地分支与其
worktree」这一窄用途能力，**不**提供 worktree 创建、切换或通用管理。

- **双重判断**（squash 合入判定 = PR 状态 **且** 本地无未推送内容）：
  1. **PR 状态**：远端存在该分支的已合入 PR（`merged_at` 非空）。squash 合入后
     `merge_commit_sha` 是 dev 上的新提交，原分支提交并非其祖先——故不能用
     `git merge-base` 判定，须以 PR 的 `head.sha` 为合入基准。
  2. **本地内容**：① 检出该分支的 worktree 无未提交文件（含未跟踪文件，不含
     gitignored）；② 本地 tip 无超出合入 head 的提交（`git rev-list <head>..<branch>`）。
- **拒绝并列出原因**（任一不成立即拒，exit 4，不删除）：
  - 未提交文件（worktree 脏）；
  - 未推送提交（无合入 PR 且本地有远端不存在的提交）；
  - PR 合入后本地新增提交（PR 已合但本地事后增提交）；
  - PR 未合入或不存在。
- **不存在强制删除路径**：无 `--force`（传入即 exit 2）。判定通过后内部用
  `git worktree remove` + `git update-ref -d refs/heads/<branch> <判定基准tip>`
  删除——git 的 `branch -d` 无法识别 squash 合入（原提交非 dev 祖先），故用
  `update-ref -d` 的**原子 compare-and-delete**（仅当 ref 仍等于判定基准时删除，
  判定后并发新增提交即删除失败，不强删）；删除前再核 tip 仍为判定基准，关闭
  判定→删除 TOCTOU。命令面不暴露任何跳过闸门的旗标。「不得强制删除」指无用户
  可见的强制路径。
- **活跃运行保护（绝不强拆）**：目标 worktree 持活跃 `stack-<wt>` 排他锁或共享
  租约即拒绝（exit 6）。gitignored 的 `.devenv-state`（锁/租约槽、凭据、快照绑定）
  对 `git status --porcelain` 不可见，故按锁/租约持有者存活独立判定——清理是写者，
  不在测试/构建运行中途拆掉其 worktree（Spec §4 栈使用租约语义）。
- **豁免与恒拒**：`prototype/*` 留档分支豁免（exit 4，归档分支不清理）；
  `dev`/`main`/当前检出分支恒拒（exit 4）。
- **默认 dry-run**：不带 `--apply` 只报告判定（可清理 exit 0 / 拒绝 exit 4），不删除；
  `--apply` 才执行删除。与镜像回收（§10）dry-run/--apply 同口径，宁多留勿误删。
- **fail closed**：PR 查询失败 / 合入 head 不在本地对象库 → exit 3，不删除
  （先 `git fetch` 再判定）。

| 退出码 | 含义 |
|---|---|
| 0 | 可安全清理（dry-run）或已清理（--apply） |
| 2 | 用法错误（缺分支 / `--force` / 未知旗标 / 本地分支不存在） |
| 3 | 无法判定（PR 查询失败 / 合入 head 缺失，fail closed，不删除） |
| 4 | 拒绝清理（未保存工作 / 未合入 / prototype 豁免 / trunk 恒拒，列出原因） |
| 6 | 目标 worktree 持活跃栈锁/租约（绝不强拆，等待运行结束） |

`--json` 终值含 `branch`/`action`(dry-run\|cleaned)/`pr`/`merged_head`/`merge_commit`/
`reasons`——**以提交哈希为定位依据**。

## 远端 PR 分支合入后自动删除

仓库级开关 `delete_branch_on_merge=true`（GitHub → Settings → General →
Pull Requests → **Automatically delete head branches**）。合入 PR 后 GitHub 自动
删除头分支（同仓库分支；受保护分支与默认分支不删）。

- **需管理员开启**：App 无 Administration 权限（spec 安全基线），由指挥者在 UI 勾选。
- **可见性（实测，与 `bypass_actors` 同口径）**：匿名/`contents:read` 令牌的
  `GET /repos` **不返回**该字段，带 push 权限的令牌（App installation token）才返回。
  `devenv branch-protection` 据此拆分：公开面（字段缺失）记 NOTE 跳过（不死锁
  匿名/CI 本地核对）；管理员强校验（`--require-bypass-actors`）字段缺失即 fail closed；
  字段存在则严格核对 `true`/`false`。**CI 不授写权限读此字段**（评审裁决：规则集仅
  保护 dev，PR 代码持写权限可击穿 prototype 留档——不为读单个管理员开关提权质量门）；
  自动删除的生效闭环 = `devenv test:branch-cleanup verify-config`（App 身份带 push
  权限）+ 指挥者管理员核对（`--require-bypass-actors` 或 UI 复核）。

## archive 标签保护（禁更新/删除，允许创建）

保存配置：`devenv/rulesets/protect-archive-tags.json`（durable，进 CI 常驻核对）。

| JSON 字段 | Web UI 位置 |
|---|---|
| `name: protect-archive-tags` / `target: tag` / `enforcement: active` | Ruleset name / Targets: **tags** / Enforcement: Active |
| `conditions.ref_name.include: ["refs/tags/archive/*"]` | Target tags 的 Include by pattern：填 `archive/*`（UI 自动加 `refs/tags/` 前缀，勿手填全 ref） |
| `{type: update}` | Rules → **Restrict updates**（禁止任何推送更新标签，含移动；无绕过者即所有人禁） |
| `{type: deletion}` | Rules → **Restrict deletions**（禁止删除标签） |
| 无 `bypass_actors` | Bypass list 留空（App 与日常身份均不可更新/删除；管理员仍可改规则集本身） |

- **语义**：`update` 规则禁止对匹配标签的一切推送更新（移动标签须 force，被禁）；
  `deletion` 禁止删除。**不加 `creation` 规则**——创建新 `archive/*` 标签允许
  （归档需要能创建）。`update` 的 `update_allows_fetch_and_merge` 参数是分支语义
  （上游拉取），标签规则集省略；应用后 `verify-config` 逐字段核对实时形态，
  若 GitHub 物化差异按两步锁齐流程对齐保存配置。
- **归档定位**：`archive/*` 标签 + 验收记录写入**提交哈希**，以哈希为最终定位依据。
  归档保证**源码可追溯**，**不承诺**旧镜像/外部依赖永远可下载或旧环境未来可重跑。
- **创建归档标签**（允许——规则集无 `creation` 规则）：
  ```bash
  git tag archive/<名> <提交哈希>            # 指向要留档的提交（annotated 亦可：git tag -a）
  ./devenv/devenv git-push origin archive/<名>   # App 身份推送（创建允许）
  ```
  创建后该标签受保护——不可更新（移动）/删除；验收记录同时写入其提交哈希。
  `prototype/*` 分支本身是留档豁免对象（不清理），与 archive 标签共同构成原型追溯。
- **应用**（指挥者，管理员）：GitHub → Settings → Rules → Rulesets → New ruleset，
  target 选 tags，字段值 = JSON 文件。应用后 `devenv branch-protection`（匿名只读即可，
  `BP_GITHUB_TOKEN=<令牌>` 时可核自动删除设置）核对一致；`devenv test:branch-cleanup
  verify-config`（App 身份）含自动删除设置与绕过权断言核对。

## 漂移核对（共用入口）

`devenv branch-protection` 核对范围（#74 扩展）：dev 两层规则集 + **archive 标签
规则集** + **合入后自动删除设置**。保存配置 `devenv/rulesets/` ↔ GitHub 实时逐字段；
匿名只读（`BP_GITHUB_TOKEN`/`GITHUB_TOKEN` 存在时优先）；漂移或无法核查即非零
（fail closed），CI quality-gate 常驻。额外 tag 规则集覆盖 `archive/*` 命名空间
（不在保存配置中）判漂移（防削弱归档保护）。变更走两步锁齐（PR 改保存配置 +
UI 同步应用），与 dev 规则集同口径（见 branch-protection.md「日常与未来变更」）。

## 受控验收流程（#74；指挥者 UI 操作与 agent 阶段交错）

harness：`./devenv/devenv test:branch-cleanup <阶段>`；证据目录
`.artifacts/74-branch-cleanup/`（gitignored），记录提交哈希。清理逻辑反例
（未提交/未推送/合入后新增/prototype 豁免/无强制路径）由
`devenv/test/branch-cleanup-offline.test.sh` 以真实 git 沙箱 + mock GitHub 覆盖
（一平台，代码逻辑）；本 harness 覆盖真实 GitHub 配置面（一次）。

1. **`prepare`**（agent）：建测试分支 `test/bc-74-acceptance`（自 dev）+ 探针分支
   `test/bc74-probe`（本地 linked worktree + 真实内容提交）+ 探针 PR（App，靶=测试
   分支，不触碰 dev）。
2. **指挥者**：① UI 开启 Automatically delete head branches；② 创建
   `protect-archive-tags` 规则集（target=tag，字段见上表）；③ 批准并以 **squash**
   合入探针 PR（靶为测试分支）。把实况记入 `.artifacts/74-branch-cleanup/human-actions.md`。
3. **`verify-config`**（agent）：dev 两层 + archive 标签规则集 + 自动删除设置核对
   （App token）+ App 对 archive 规则集 `current_user_can_bypass=never` 断言。
4. **`negatives`**（agent）：**前置断言 archive 规则集 active 且 App 无绕过权**
   （否则不尝试，避免无保护时误改真实归档）；对真实 `archive/*` 标签尝试更新
   （移动到 dev HEAD）与删除 → 应拒（零写入），前后核对标签提交哈希不动。
5. **`cleanup-positive`**（agent，探针 PR 合入后）：断言探针远端分支已自动删除
   （AC1 远端）；`branch-cleanup <探针分支>` dry-run 安全 → `--apply` 删除本地
   worktree + 分支（AC1 本地）；记录 merge_commit/head 哈希。
6. **`cleanup-test`**（agent）：关探针 PR、删测试分支（探针分支已清理；archive
   标签受保护永久留档，不删）。
7. **`summary`**（agent）：AC1–5 映射 + 提交哈希汇总进 `summary.txt`；结论与证据
   摘录归档 Issue #74。

**诚实口径**：涉及人类账号或管理员配置的最终受控验收由指挥者执行；归档不承诺
旧环境永远可重建（源码经标签/提交哈希可追溯即满足）。