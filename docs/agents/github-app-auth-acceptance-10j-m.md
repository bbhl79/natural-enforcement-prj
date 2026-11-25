# GitHub App 认证入口验收证据：spec #23 项 10 j–m（issue #55）

执行环境：WSL2（Windows 开发机），会话 = orca 编排的 Claude Code CLI（进程链见各
`evidence.log` 的 ancestry 段）。执行时间：2026-11-25（UTC 时间戳见各行）。
授权依据：issue #55（ready-for-agent）明确要求留存真实命令、退出码与 GitHub 侧证据。

证据目录（本机，gitignored）：`.artifacts/auth-acceptance/<UTC 时间戳>/`，含
`evidence.log`（进程链 + 全部命令与退出码）、各命令 stdout/stderr 捕获、`summary.txt`。
本文件为摘要；原始证据以本机证据目录与 GitHub 侧记录为准。

## j. 从正常启动的 IDE 插件经 devenv 操作，GitHub 上显示的操作者为 App bot

**通过（指挥者 2026-11-25 裁定）。** 事实表述：证据会话宿主为 orca 编排的
Claude Code CLI（进程链：bash → claude → orca-agents → …，见各 `evidence.log`
ancestry 段），不是字面意义的 IDE 插件；指挥者裁定该 orca 会话即其正常使用的
agent 入口，项 j 的「正常启动的 IDE 插件」前提据此接受，不再单独补跑。

经 devenv 入口操作，GitHub 侧操作者为 App bot（均绑定到具体操作，杜绝假阳性）：

- 评论（按评论 ID 绑定作者）：
  `devenv gh issue comment 55 --body …` → rc=0；
  `devenv gh api repos/…/issues/comments/7150428162 --jq .user.login` → rc=0，
  作者 = `bbhl79-agent[bot]`。
  GitHub 侧证据：<https://github.com/bbhl79/natural-enforcement-prj/issues/55#issuecomment-7150428162>
  另：本验收的证据评论 `…#issuecomment-7151787172` 作者同为 `bbhl79-agent[bot]`。
- 推送（按 `after == 本次 sha` 绑定 actor）：
  `devenv git-push origin +test/app-auth-push:refs/heads/test/app-auth-push` → rc=0；
  activity 记录 `actor=bbhl79-agent[bot]`，`after=a3f7f7ce…`（另两次：3c490590、c8487e86）。
  GitHub 侧证据：远端分支 `test/app-auth-push`（草稿分支，保留供审计，删除需另行确认）。

## k. 首次成功操作超过 1 小时后再次操作仍成功，并证明每次调用重新换取短期令牌

命令：`./devenv/devenv test:auth:integration --sustained`（等待 3700s > token
生命周期 1h）。证据目录：`.artifacts/auth-acceptance/20261125T021407Z`（11 通过 0 失败）。

- t0 = 2026-11-25T02:14:12Z：`devenv gh api /installation/repositories` → rc=0；
  in-process 换取 token0，sha256 = `7f84a422939a…`（只记哈希，token 不落地）。
- 睡眠 3700s（跨过 1h token 生命周期）。
- t1 = 2026-11-25T03:16:00Z（elapsed=3708s）：同一命令再次操作 → rc=0；
  换取 token1，sha256 = `9575b19619a0…`，与 token0 不同。
- **主证据**：t0 换取的 token 到 t1 已过期，再次操作成功 ⟹ 入口必然在 t1 重新
  换取了有效 token（若复用缓存旧 token 必然 401）。**佐证**：入口 mint 路径同一
  函数两次调用产出不同 token；「每次调用重新换取」的结构性证明另见离线测试
  T11（8 并发调用 → 8 个互不相同 token）与 T15（启动时注入的旧 token 被忽略）。

## l. 私钥不可用时，即使个人账号已登录，devenv gh 与 devenv git-push 均失败且不回退个人凭据

命令：`./devenv/devenv test:auth:integration --key-outage`（20261125T021132Z，18 通过 0 失败）：

- 前置成立：个人 gh 登录有效（`gh api /user` → `bbhl79`，个人身份不经 devenv）。
- 私钥 chmod 000 期间：`devenv gh api /installation/repositories` → rc=21；
  `devenv git-push origin HEAD:refs/heads/should-not-exist` → rc=21。双路径均失败，
  错误信息为私钥权限拒绝，无网络请求发出。
- 恢复 600 后 gh 路径正常；`devenv gh api repos/…/git/ref/heads/should-not-exist`
  → 非零（404）：私钥不可用期间**无任何回退推送在远端生效**。

## m. 检查命令输出、日志和仓库内容，不出现 installation token 或私钥

每次集成运行结尾自动执行（范围：证据目录 + 仓库全部明文内容，含 .git 的
config/reflog 等明文文件；压缩对象为二进制，grep -I 跳过）：

- 活 token 精确值扫描：测试进程 in-process 换取真实 token（先验证其可用），经
  stdin 交 `grep -F` 全盘扫描——token 不进 argv/文件/日志；零命中。
- 形态扫描：`ghs_[A-Za-z0-9]{20,}`（installation token 形态）与 PEM 私钥标记，
  零命中（扫描模式串拼接构造，扫描器自身文件不含可命中字面量）。
- 扫描顺序：先扫描 → 写 `summary.txt` → 再终扫一次覆盖 summary 与全部日志，
  终扫结果只含固定字符串与计数，不引入未扫描内容。
- 各次运行（含全部写操作输出）均零命中；离线测试 T18 对 mock 输出做同类扫描。
- 审查顺带加固：mint 路径的 JWT 与项 m 活 token 此前经 curl `-H` 出现在进程
  argv（ps 可见，违反边界文档「不进命令参数」），已统一改为 `-H @-` 经 stdin
  传递（`devenv/lib/github-app-auth.sh` 与本测试两侧）。

## 顺带修复的既有缺陷（memory 未决项）

1. `--push-test-branch` 不可重入 → 改 `+refspec` 覆盖专用草稿分支；已连续 3 次
   推送成功（3c490590 → c8487e86 → a3f7f7ce）。
2. 推送身份校验假阳性 → activity 查询绑定 `after == 本次 sha`；修复过程中实测发现
   `+refspec` 覆盖的活动类型为 `force_push`（非 `push`），过滤器已覆盖三类
   （push / force_push / branch_creation）。
3. 评论身份校验由「最后一条匹配正文」改为按评论 ID 绑定。

「agent 无法读取其他凭据」未作为通过项（spec #23 已接受残余风险，不作验证）。
