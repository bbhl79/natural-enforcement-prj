# #61 锁与栈使用租约 — Windows（WSL2）验收证据

日期：2026-11-26 ｜ 机器：Windows WSL2 + Rancher Desktop podman machine（rootful，
`podman-root.sock`）｜ 引擎：Podman Engine 6.1.4（linux/amd64）｜ 代码：`dev` @ `2236586`

本目录是 #61 五条验收标准的实机证据。所有"被阻塞/被放行"的一侧都是真实
`devenv` 命令；冲突窗口由 `tools/ne61-hold.sh` 制造——它 source 与生产同源的
`lib/lock.sh`，调用同一个 `lock_acquire` / `lease_acquire` 入口，保证持有者身份、
owner 格式与失效判定和真实命令完全一致。另在 02/06/07 用真实 `devenv verify` /
`devenv build` 持有者交叉验证（不是只靠辅助进程）。全部日志来自一次连续运行
（`driver.log`），先写 `/tmp` 再归档——避免证据文件进入工作树快照改变构建输入。

## 环境与基线

- `00-doctor.err`：engine 行（podman 6.1.4 / linux-amd64 / rootful socket）、矩阵
  ok、worktree `natural-enforcement-90e22128`、db/api healthy；遗留共享项目 warn
  （#59 前资源，回收归 #75）。
- `00-status.out`：初始 `locks=空`、`leases=none`。
- `00-ps.out`：db/api 均已运行（后续冲突矩阵未 restart 它们，见 `03-ps-*`）。

## 验收对照

| #61 标准 | 证据 | 结果 |
|---|---|---|
| 宿主 POSIX mkdir 原子锁，记录 pid + 启动时间；按进程存活判定失效，不按超时 | 离线 T16–T21；实机 `06`/`07`/`08` | 失效锁/租约被识别清理；存活持有者不被误清（见下） |
| build/up/down/restart 复合过程整体持排他锁；冲突 exit 6 或明确等待 | `03-*`（8 个写者命令全部 6）；`06`（kill 发生在 build 持锁期间） | ✅ 全部 exit 6；kill 后锁目录仍在，证明锁贯穿复合过程 |
| 测试运行期持共享栈租约；down/restart/migrate 与活跃租约互斥；多个隔离测试可并行 | `02-*`（两个真实 verify 并发重叠、均 rc 0；运行期 status 显示 active 租约）；`03-down`/`03-restart`/`03-migrate`/`03-migrate-create`（6）；`04-*`（读者被排他锁挡 6） | ✅ 共享语义与双向互斥均成立 |
| per-worktree 锁互不误伤；机器级 lockgen/基础镜像拉取锁跨 worktree 生效 | `05-*` | A 的租约/排他锁不阻塞 B 的 `down`（均 rc 0）；prefetch 锁 A↔B 双向 6；`lockgen` 锁 A 持有 → B `build --lockgen` 6 |
| Windows 逐对验证冲突矩阵 + kill 持锁进程可恢复、慢构建存活时锁不被误清两个故障反例 | `03`/`04` 矩阵；`06`/`07` kill 恢复；`08` 存活持有者反例 | ✅ 见下 |

## 冲突矩阵（实机结果）

### 写者 vs 活跃共享租约（`03-*`，`DEVENV_LOCK_TIMEOUT=2` 限定等待）

持有者：`tools/ne61-hold.sh lease stack-90e22128`（活跃租约，owner
`970321 1795686377 …`）。每个真实命令均在触达 compose 前 exit 6。

| 被阻塞命令 | 退出码 | 关键错误（stderr 尾行） |
|---|---|---|
| `devenv build` | 6 | 独占锁 [stack-90e22128] 有活跃栈使用租约… |
| `devenv up` | 6 | 同上 |
| `devenv down` | 6 | 同上 |
| `devenv restart` | 6 | 同上 |
| `devenv web --port 5199` | 6 | 同上 |
| `devenv web --down` | 6 | 同上 |
| `devenv migrate` | 6 | 同上 |
| `devenv migrate:create --name evidence_61` | 6 | 同上 |

`03-ps-before.out` 与 `03-ps-after.out` 逐字一致（db/api 一直在运行、未被重启）；
`03-status-during-lease.out` 显示 `leases: "stack-90e22128 pid=… active"`。

### 读者 vs 活跃排他锁（`04-*`，同上限）

持有者：`tools/ne61-hold.sh lock stack-90e22128`。六个真实读者命令全部 exit 6，
且未触达 compose：

| 被阻塞命令 | 退出码 | 关键错误（stderr 尾行） |
|---|---|---|
| `devenv test` | 6 | 共享租约 [stack-90e22128] 被排他锁占用… |
| `devenv test:unit` | 6 | 同上 |
| `devenv lint` | 6 | 同上 |
| `devenv typecheck` | 6 | 同上 |
| `devenv verify` | 6 | 同上 |
| `devenv seed` | 6 | 同上 |

### 并行与跨 worktree（`02-*` / `05-*`）

| 场景 | 结果 |
|---|---|
| 两个真实 `devenv verify` 同时运行 | 两者 `start=1795686351 end=1795686377 rc=0`，`overlap=yes`；期间 `status` 可见 active 租约（`02-status-during-lease.out`） |
| A 租约 / A 排他锁 在场时，B（`/tmp/ne-61-evidence-b`，suffix `ba110985`）执行 `devenv down` | 均 rc 0（per-worktree 锁互不误伤；`05-worktrees.txt`、`05-b-doctor.err`） |
| 机器级 `prefetch` 锁：A 持有 → B `devenv prefetch`；B 持有 → A `devenv prefetch` | 双向 rc 6（`05-b-prefetch-vs-a-prefetch.err` / `05-a-prefetch-vs-b-prefetch.err`） |
| 机器级 `lockgen` 锁：A 持有 → B `devenv build --lockgen` | rc 6（`05-b-build-lockgen-vs-a-lockgen.err`） |

## 故障演练（两个强制反例 + 存活反例）

- **kill 持锁进程后恢复**（`06-*`）：真实 `devenv build` 持 `stack-90e22128.lock`
  时被 `kill -9`（owner `972531 1795686430` 留下）；随后真实 `devenv down` rc 0，
  stderr 出现 `WARN: 锁 [stack-90e22128] 持有者已死，清理失效锁…`；`devenv up`
  恢复 rc 0。锁目录在 kill 后、down 前仍在（`06-kill-lock.txt`）。
- **kill 租约持有者后恢复**（`07-*`）：真实 `devenv verify` 持有租约槽时被
  `kill -9`；随后真实 `devenv down` rc 0，stderr 出现
  `WARN: 租约 [stack-90e22128] 持有者已死，清理失效租约…`；`devenv up` 恢复 rc 0，
  终态 db/api healthy（`07-ps-after.out`、`09-doctor.err`）。
- **存活持有者不被误清**（`08-*`）：辅助进程持排他锁 / 持共享租约且保持存活时，
  真实 `devenv down` 均 rc 6；锁目录与租约槽仍在（`08-live-lock.txt` /
  `08-live-lease.txt`）。该反例对应"慢构建仍存活 → 第二个进程不得闯入"；真实
  慢构建持锁路径由 `06` 的 kill 前现场（锁目录在 build 运行期间存在）佐证。

## 文件索引

| 文件 | 内容 |
|---|---|
| `00-doctor.*` / `00-status.*` / `00-ps.*` | 开工基线（引擎/身份/服务/锁与租约为空） |
| `02-readers-parallel.txt` | 两个真实 verify 的起止秒与退出码、重叠判定 |
| `02-verify-a.log` / `02-verify-b.log` | 两个并发 verify 的完整输出（lint/typecheck/test:unit） |
| `02-status-during-lease.out` | 运行期 status：active 租约可见 |
| `03-<cmd>.*` | 写者 vs 租约矩阵的每个真实命令输出（8 个） |
| `03-ps-before.out` / `03-ps-after.out` | 矩阵前后容器状态（逐字一致） |
| `03-status-during-lease.out` / `03-status-after.out` | 租约期/释放后 status |
| `04-<cmd>.*` | 读者 vs 排他锁矩阵的每个真实命令输出（6 个） |
| `05-worktrees.txt` | A/B worktree suffix 与项目名 |
| `05-worktree-add.log` / `05-worktree-remove.log` | B 临时 worktree 的创建/删除 |
| `05-b-doctor.err` | B 侧 doctor（独立项目/凭据/锁） |
| `05-b-down-vs-a-lease.err` / `05-b-down-vs-a-lock.err` | 跨 worktree 放行（rc 0） |
| `05-b-prefetch-vs-a-prefetch.err` / `05-a-prefetch-vs-b-prefetch.err` | 机器级 prefetch 锁双向冲突 |
| `05-b-build-lockgen-vs-a-lockgen.err` | 机器级 lockgen 锁冲突 |
| `06-kill-lock.txt` / `06-build-killed.log` / `06-down-recover.err` / `06-up-restore.*` | kill 持锁进程 → 失效锁清理 → 恢复 |
| `07-kill-lease.txt` / `07-verify-killed.log` / `07-down-recover.err` / `07-up-restore.*` | kill 租约持有者 → 失效租约清理 → 恢复 |
| `08-live-lock.txt` / `08-down-vs-live-lock.err` | 存活锁持有者 → down exit 6、锁未被误清 |
| `08-live-lease.txt` / `08-down-vs-live-lease.err` | 存活租约持有者 → down exit 6、槽未被误清 |
| `09-*` | 收尾：up rc 0、doctor 通过、status 无锁无租约、db/api 健康 |
| `results.tsv` / `90-results.txt` | 本次运行的完整命令-退出码清单（driver 生成） |
| `driver.log` | 一次连续运行的时间线（含各章节） |
| `tools/run-evidence.sh` / `tools/ne61-hold.sh` | 可复跑的驱动与持有者辅助（见下） |

每个 `<name>` 都有 `.out`（stdout）与 `.err`（stderr）原始文件；`--json` 命令的
stdout 是纯 JSON/JSONL，人类进度在 stderr（输出协议未受本票影响）。

## 复跑

```bash
# 前置：本机栈已 up（devenv up），且允许故障演练真实 down/up 本机栈
bash docs/evidence/61-lock-lease/tools/run-evidence.sh all
```

- 驱动把日志写到 `/tmp/ne61-evidence`（不直接写仓库，避免快照抖动）；跑完后
  人工拷回本目录。
- 矩阵章节用 `DEVENV_LOCK_TIMEOUT=2` 限定等待，便于在有限时间内逐条验证；
  生产默认等待上限见 `devenv/COMMANDS.md`（读者 120s；写者沿用各命令锁超时）。
  该覆盖入口仅用于测试/故障演练。
- `05` 会临时 `git worktree add /tmp/ne-61-evidence-b HEAD` 并在结束时
  `git worktree remove --force`；`06`/`07` 会真实停栈再起栈。

## 诚实备注

- **真实命令 vs 辅助持有者**：被阻塞/被放行的一侧全部是真实 `devenv` 命令；
  `03`/`04`/`05`/`08` 的持有者由 `tools/ne61-hold.sh` 扮演（同源锁库入口，仅
  用于制造确定窗口）。真实 `verify`（02、07）与真实 `build`（06）的持锁/持租约
  行为另行覆盖，两者不互替。
- **矩阵的"逐对"**：写者侧 8 个命令 × 活跃租约、读者侧 6 个命令 × 活跃排他锁；
  同一 worktree 内写者之间共享同一把 `stack-<wt>.lock`，故矩阵按锁类别成立
  （另有 `migrate` 的二级 `migrate-<wt>` 锁，已包含在真实命令路径中）。
- **02 并发 verify 用时 26s**（单独运行约 16s）：两个进程在同一快照下各自执行
  新鲜度核对/构建登记；两者均 rc 0、租约并发持有——这是共享租约下的预期行为，
  不是串行化。镜像内容寻址与不可变绑定见 #58；状态文件 last-writer-wins 的
  已声明限制见 ADR。
- **遗留项目 warn**：`00`/`09` doctor 中的 `legacy-project` warn 是 #59 前共享
  项目的未回收容器，与本票无关，回收归 #75。
- **pid 复用**：失效判定按 pid 存活（与 #58 锁同口径）；pid 被无关进程复用可能
  误判存活，以超时 exit 6 收尾并需人工确认（ADR 已记录）。
- 运行结束后本机栈已恢复（`09-up` rc 0、`09-doctor` 通过、`09-ps` db/api 健康），
  `/tmp/natural-enforcement-locks` 为空，临时 worktree 已删除。