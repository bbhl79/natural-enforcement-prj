# #61 锁与栈使用租约 — Windows（WSL2）验收证据

日期：2026-11-26 ｜ 机器：Windows WSL2 + Rancher Desktop podman machine（rootful，
`podman-root.sock`）｜ 引擎：Podman Engine 6.1.4（linux/amd64）｜ 代码：`dev` @ `8789bd9`
（实现 `2236586` + 复审修复 `8789bd9`；证据初版 `00ae4a0`，本目录为复审后的完整重跑）

本目录是 #61 五条验收标准的实机证据。所有"被阻塞/被放行"的一侧都是真实 `devenv`
命令；冲突窗口的确定性由两种方式制造：

- `tools/ne61-hold.sh`（source 生产同源 `lib/lock.sh` 的同一 `lock_acquire` /
  `lease_acquire` 入口）——用于 03/04/05/08；
- **真实 `devenv` 命令 + SIGSTOP 于持锁/持租约之后**——用于 10/11/12。SIGSTOP 的
  进程对 `kill -0` 仍是"存活"（这正是"慢构建仍存活"语义），冻结即确定窗口。

另有真实 `verify`（02/07）与真实 `build`（06/11）的 kill/恢复演练。全部日志来自
一次连续运行（`driver.log`），先写 `/tmp` 再归档——避免证据文件进入工作树快照
改变构建输入（#58 快照机制）。

## 环境与基线

- `00-doctor.err`：engine 行（podman 6.1.4 / linux-amd64 / rootful socket）、矩阵
  ok、worktree `natural-enforcement-90e22128`、db/api healthy；遗留共享项目 warn
  （#59 前资源，回收归 #75）。
- `00-status.out` / `00-ps.out`：初始 `locks` 空、`leases=none`，db/api 运行中。

## 验收对照

| #61 标准 | 证据 | 结果 |
|---|---|---|
| 宿主 POSIX mkdir 原子锁，记录 pid + 启动时间；按进程存活判定失效，不按超时 | 离线 T16–T23；实机 `06`/`07`/`08`/`11`/`12` | ✅ 失效按 kill -0 判定；空 owner 1s 宽限（T23） |
| build/up/down/restart 复合过程整体持排他锁；冲突 exit 6 或明确等待 | `10-*`（8×7 真实命令两两矩阵）；`06`/`11`（真实 build 持锁期间被 kill / 被 SIGSTOP） | ✅ 56 个有序对全 6；锁贯穿复合过程 |
| 测试运行期持共享栈租约；down/restart/migrate 与活跃租约互斥；多个隔离测试可并行 | `02`（两个真实 verify 并发重叠、均 rc 0）；`03`（8 写者 vs 活跃租约全 6）；`04`（6 读者 vs 排他锁全 6）；`12`（真实 verify 持租约，down 6） | ✅ |
| per-worktree 锁互不误伤；机器级 lockgen/基础镜像拉取锁跨 worktree 生效 | `05` | A 租约/锁不阻塞 B 的 down（rc 0）；prefetch 双向 6；lockgen → B build --lockgen 6 |
| Windows 逐对验证冲突矩阵 + kill 恢复 + 慢构建存活反例 | `10`（56 对）；`06`/`07`（kill 恢复）；`11`/`12`（真实存活反例，非替代持有者） | ✅ |

## 冲突矩阵（实机结果）

### 写者 vs 活跃共享租约（`03-*`，`DEVENV_LOCK_TIMEOUT=2` 限定等待）

持有者：`tools/ne61-hold.sh lease stack-90e22128`（活跃租约，owner
`1020630 1795694811 …`）。8 个真实写者命令（build/up/down/restart/web/web --down/
migrate/migrate:create）全部在触达 compose 前 exit 6，错误消息列出持有者
pid/启动时间/槽与修复线索（见各 `03-<cmd>.err` 尾行）。
`03-ps-before.out` 与 `03-ps-after.out` 显示同一批容器未被重启（db/api 的 Up 时长
按时间递增，无重建/重启迹象）。`03-status-during-lease.out`：`leases` 显示 active
持有者；复审修复后 `locks` 只含 `.lock` 目录（本例为空）。

### 读者 vs 活跃排他锁（`04-*`）

持有者：`tools/ne61-hold.sh lock stack-90e22128`（owner `1021597 1795694832 …`）。
6 个真实读者命令（test/test:unit/lint/typecheck/verify/seed）全部 exit 6，错误
消息列出持有者与修复线索；读者默认等待上限 120s，本矩阵用 `DEVENV_LOCK_TIMEOUT=2`
限定。

### 写者↔写者逐对（`10-*`）

每个**真实写者命令**在持 `stack-90e22128.lock` 后被 SIGSTOP（其 owner pid 对
kill -0 仍存活），另 7 个真实写者命令以 `DEVENV_LOCK_TIMEOUT=1` 依次执行——
8×7=56 个有序对**全部 exit 6**（`results.tsv` 中 `10-*` 行；`10-writer-pairs.txt`
列出每个持有者的停止记录与 cleanup 结果）。错误消息含持有者 pid/启动时间与修复
线索。每轮持有者被杀后 cleanup（`web --down` + `down` + `up`，migrate 持有者再补
`migrate` 清二级锁）恢复栈，全部 `stack-lock-present=no`。`10-git-status.txt` 显示
本次运行未产生迁移文件等副产物。

### 并行与跨 worktree（`02-*` / `05-*`）

- 两个真实 `devenv verify` 同时运行：`start=1795694794 end=1795694811`，均 rc 0，
  `overlap=yes`；期间 `status` 显示 active 租约（`02-status-during-lease.out`）。
- A（`90e22128`）租约/排他锁在场时，B（`/tmp/ne-61-evidence-b`，`ba110985`）
  `devenv down` 均 rc 0（per-worktree 锁互不误伤；`05-worktrees.txt`）。
- 机器级 `prefetch` 锁双向：A 持有 → B `prefetch` rc 6；B 持有 → A `prefetch` rc 6。
- 机器级 `lockgen` 锁：A 持有 → B `build --lockgen` rc 6。

## 故障演练（强制反例 + 存活反例）

- **kill 持锁进程后恢复**（`06-*`）：真实 `devenv build` 持锁时被 `kill -9`
  （owner `1023092 1795694862 …` 带 token 留下）；随后真实 `devenv down` rc 0，
  stderr 出现 `WARN: 锁 [stack-90e22128] 持有者已死，清理失效锁…`；`devenv up`
  恢复 rc 0。
- **kill 租约持有者后恢复**（`07-*`）：真实 `devenv verify` 持租约时被 `kill -9`；
  随后真实 `devenv down` rc 0，stderr 出现
  `WARN: 租约 [stack-90e22128] 持有者已死，清理失效租约…`；`devenv up` 恢复 rc 0。
- **存活持有者不被误清**（`08-*`，辅助进程）：持锁/持租约且保持存活时，真实
  `devenv down` 均 rc 6；锁目录与租约槽仍在。
- **真实慢构建存活**（`11-*`，非替代）：真实 `devenv build` 持锁后被 SIGSTOP
  （对 kill -0 仍存活）；真实 `devenv down` rc 6；锁仍在；SIGCONT 后 build rc 0、
  锁正常释放（"build 退出后 stack-lock 仍在：no"）。
- **真实测试存活**（`12-*`，非替代）：真实 `devenv verify` 持租约后被 SIGSTOP；
  真实 `devenv down` rc 6；租约槽仍在；SIGCONT 后 verify rc 0、槽正常释放。

## 文件索引

| 文件 | 内容 |
|---|---|
| `00-doctor.*` / `00-status.*` / `00-ps.*` | 开工基线（引擎/身份/服务/锁与租约为空） |
| `02-readers-parallel.txt` | 两个真实 verify 的起止秒与退出码、重叠判定 |
| `02-verify-a.log` / `02-verify-b.log` | 两个并发 verify 的完整输出 |
| `02-status-during-lease.out` | 运行期 status：active 租约可见 |
| `03-<cmd>.*` | 写者 vs 租约矩阵（8 个真实命令） |
| `03-ps-before.out` / `03-ps-after.out` | 矩阵前后容器状态（同批、未重启） |
| `03-status-during-lease.out` / `03-status-after.out` | 租约期/释放后 status |
| `04-<cmd>.*` | 读者 vs 排他锁矩阵（6 个真实命令） |
| `05-worktrees.txt` / `05-worktree-add.log` / `05-worktree-remove.log` | B 临时 worktree 身份与生命周期 |
| `05-b-doctor.err` / `05-b-status.*` | B 侧独立项目/凭据/锁状态 |
| `05-b-down-vs-a-lease.err` / `05-b-down-vs-a-lock.err` | 跨 worktree 放行（rc 0） |
| `05-b-prefetch-vs-a-prefetch.err` / `05-a-prefetch-vs-b-prefetch.err` | 机器级 prefetch 锁双向冲突 |
| `05-b-build-lockgen-vs-a-lockgen.err` | 机器级 lockgen 锁冲突 |
| `06-kill-lock.txt` / `06-build-killed.log` / `06-down-recover.*` / `06-up-restore.*` | kill 持锁进程 → 失效锁清理 → 恢复 |
| `07-kill-lease.txt` / `07-verify-killed.log` / `07-down-recover.*` / `07-up-restore.*` / `07-ps-after.*` | kill 租约持有者 → 失效租约清理 → 恢复 |
| `08-live-*.txt` / `08-down-vs-live-*.err` | 存活辅助持有者 → down 6、锁/槽未被误清 |
| `10-writer-pairs.txt` | 写者两两矩阵的持有者停止记录与 cleanup 结果 |
| `10-<holder>-vs-<blocked>.err` / `.out` | 56 个有序对的逐条输出 |
| `10-<holder>.holder.log` | 各真实持有者命令的自身输出（被杀前） |
| `10-cleanup-<holder>-*.log` | 每轮 cleanup（web --down/down/up，migrate 补 migrate） |
| `10-git-status.txt` | 矩阵运行后的工作树状态（无迁移文件等副产物） |
| `11-live-real-build.txt` / `11-build-holder.log` / `11-down-vs-live-real-build.*` | 真实慢构建存活反例 |
| `12-live-real-verify.txt` / `12-verify-holder.log` / `12-down-vs-live-real-verify.*` | 真实测试存活反例 |
| `09-*` | 收尾：up rc 0、doctor 通过、status `locks` 空 `leases=none`、db/api 健康 |
| `results.tsv` / `90-results.txt` | 完整命令-退出码清单（101 行，其中 77 行 rc=6） |
| `driver.log` | 一次连续运行的时间线（约 6 分钟） |
| `tools/run-evidence.sh` / `tools/ne61-hold.sh` | 可复跑的驱动与持有者辅助（见下） |

每个 `<name>` 都有 `.out`（stdout）与 `.err`（stderr）；长输出（并发 verify、被杀
命令自身的日志）为 `.log`。`--json` 命令的 stdout 是纯 JSON/JSONL，进度在
stderr（输出协议未受本票影响）。

## 复跑

```bash
# 前置：本机栈已 up（devenv up），且允许故障演练真实 down/up 栈（约 6 分钟）
bash docs/evidence/61-lock-lease/tools/run-evidence.sh all
```

- 驱动把日志写到 `/tmp/ne61-evidence`（不直接写仓库，避免快照抖动）；跑完后人工
  拷回本目录。分节运行会重置 `results.tsv`，完整结果请一次 `all`。
- 矩阵章节用 `DEVENV_LOCK_TIMEOUT=2`（03/04/05/08）与 `1`（10）限定等待，便于在
  有限时间逐条验证；生产默认等待上限见 `devenv/COMMANDS.md`。该覆盖入口仅用于
  测试/故障演练。
- `05` 临时 `git worktree add /tmp/ne-61-evidence-b HEAD` 并在结束时
  `git worktree remove --force`；`06`/`07` 会真实停栈再起栈；`10` 的持有者是真实
  命令被 SIGSTOP/SIGKILL，每轮后 cleanup 恢复。

## 诚实备注

- **真实命令 vs 辅助持有者**：被阻塞/被放行的一侧全部是真实 `devenv` 命令。
  `03`/`04`/`05`/`08` 的持有者由 `tools/ne61-hold.sh` 扮演（同源锁库入口，仅用于
  制造确定窗口）；`02`/`06`/`07`/`10`/`11`/`12` 的持有者是真实 `devenv` 命令，
  两者不互替。
- **"逐对"覆盖**：写者侧 8 命令 × 7 = 56 个有序对（`10`）；写者 8 命令 × 活跃租约
  （`03`）；读者 6 命令 × 活跃排他锁（`04`）；跨 worktree 与机器级（`05`）。
  `migrate` 的二级 `migrate-<wt>` 锁含在真实命令路径中（其 cleanup 也单独验证）。
- **03 容器口径**：`03-ps-before/after.out` 显示同一批容器、Up 时长按时间递增
  （无重建/重启迹象）；不声称逐字一致（Up 文本随时间变化）。
- **status 字段**：复审修复后 `locks` 只含 `.lock` 目录；租约在独立 `leases`
  字段；`stale` 只标注不清理（status 保持只读）。
- **prefetch 锁边界**：覆盖 `devenv prefetch` 的显式拉取；构建期 Dockerfile
  `FROM` 触发的隐式拉取由引擎按内容寻址去重（ADR/COMMANDS.md 已声明）。
- **SIGSTOP 语义**：SIGSTOP 进程对 `kill -0` 仍"存活"，故 10/11/12 与"慢构建仍
  存活时锁不被误清"语义一致；`06`/`07` 的 SIGKILL 是"持有进程已死"语义。
- **02 并发 verify 用时 17s**（单独运行约 16s）：两个进程在同一快照下各自执行
  新鲜度核对/登记，均 rc 0、租约并发持有——共享租约下的预期行为，不是串行化。
- **pid 复用 / 门 ABA 残余**：见 `docs/adr/2026-11-26-17-37-锁与栈使用租约.md`
  的已声明限制；本目录的 10/11/12 亦覆盖"存活持有者"与"持有者被 kill"两类场景。
- **遗留项目 warn**：`00`/`09` doctor 的 `legacy-project` warn 是 #59 前共享项目
  的未回收容器，与本票无关，回收归 #75。
- 运行结束后本机栈已恢复（`09-up` rc 0、`09-doctor` 通过、`09-ps` db/api 健康），
  `/tmp/natural-enforcement-locks` 为空，临时 worktree 已删除。
