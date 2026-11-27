# devenv 命令面（工程基座唯一入口）

调用形态：`./devenv/devenv [--json] <子命令> [参数]`。
宿主工具链零安装：本命令面只使用白名单宿主工具（bash、docker CLI + compose v2、git、
coreutils、tar、find、jq、openssl、curl、gh；macOS 自带 bsdtar/BSD find 兼容所用法）；
一切 node/pnpm/prisma 执行都在容器内。

本文件是命令面的**唯一权威**（Action | Command | 期望退出码 + 输出协议 + 并发语义）；
AGENTS.md 只放关键入口与指针。命令帮助（`devenv --help`）与本表保持一致。

## 命令表（Action | Command | 期望退出码）

### 工程栈

| Action | Command | 期望退出码 |
|---|---|---|
| 一键体检（端点/引擎/矩阵/锁文件/worktree 身份与凭据状态/镜像/快照状态/服务；退出码=可开工与否） | `devenv doctor` | 0 或 3 |
| 预取镜像锁中的上游镜像（分阶段、有进度/超时、可中断续跑；机器级拉取锁） | `devenv prefetch` | 0 或 3/4/5/6 |
| 固定快照构建工具镜像 + 安装依赖 + turbo build（幂等；记录快照哈希与不可变镜像标识） | `devenv build [--lockgen]` | 0 或 3/4/6 |
| 启动 db → 迁移幂等应用 → api，等待真实健康终态（幂等） | `devenv up` | 0 或 3/4/5/6 |
| 停止（连带清掉不在 compose 文件中的本项目容器；--volumes 再清数据卷；仅本 worktree 项目范围；不含 profile 隔离的 web——用 `web --down`） | `devenv down [--volumes]` | 0 或 3/6 |
| 重启 | `devenv restart [svc...]` | 0 或 3/6 |
| 启动前端并发布宿主端口（零端口不变量的唯一例外；省略 --port 由引擎运行时分配空闲端口并回读实际端口进终值/status，--port N 显式固定发布；up 与 --down 路径均持栈排他锁） | `devenv web [--port N] [--down]` | 0 或 2/3/4/5/6 |
| 容器状态（人读表含发布端口） | `devenv ps [-a]` | 0 或 3 |
| 跟随日志（透传原始流） | `devenv logs [svc] [-f] [--tail N]` | 0 或 3 或子进程码 |
| 容器内执行（默认 tools；透传原始流） | `devenv exec [svc] -- cmd...` | 0 或 2/3 或子进程码 |
| 交互 shell（默认 tools；透传原始流） | `devenv shell [svc]` | 0 或 3 或子进程码 |
| 单元+集成测试（需先 up；连真实 PostGIS；运行期持共享栈使用租约） | `devenv test [pattern...]` | 0 或 3/4/6 |
| 仅单元测试（零数据库基础设施；仍使用 tools 容器/项目网络，运行期持共享栈使用租约） | `devenv test:unit` | 0 或 3/4/6 |
| ESLint（运行期持共享栈使用租约） | `devenv lint` | 0 或 3/4/6 |
| tsc --noEmit（运行期持共享栈使用租约） | `devenv typecheck` | 0 或 3/4/6 |
| 聚合质量门：lint + typecheck + test:unit（本地与 CI 同一入口；运行期持共享栈使用租约） | `devenv verify` | 0 或 3/4/6 |
| 应用全部 pending 迁移（prisma migrate deploy；与活跃租约互斥） | `devenv migrate` | 0 或 3/4/6 |
| 生成空迁移待编辑（prisma migrate dev --create-only；与活跃租约互斥） | `devenv migrate:create --name N` | 0 或 2/3/4/6 |
| 幂等种子数据（运行期持共享栈使用租约） | `devenv seed` | 0 或 3/4/6 |
| 等待服务健康终态（默认 60s） | `devenv wait <db\|api\|web> [--timeout N]` | 0 或 2/3/5 |
| 人读/机读总览（容器+锁+租约+镜像+web 实际端口；web 未运行如实报 none） | `devenv status` | 0 或 3 |
| 查看镜像锁与生效 DB 镜像 / 校验运行态 digest 漂移 | `devenv images [--verify]` | 0 或 1/2/3 |

### GitHub App 认证入口（不触引擎；详见 docs/agents/github-app-auth.md）

| Action | Command | 期望退出码 |
|---|---|---|
| 以 App 身份执行 gh（拒绝 `gh auth`；拒绝 `-R` 指向未授权仓库） | `devenv gh <args...>` | 0 或 2/20/21/22/23 或 gh 自身退出码 |
| 以 App 身份 HTTPS 推送 | `devenv git-push <remote> <refspec...>` | 0 或 2/20/21/22/23 或 git 自身退出码 |
| 认证入口离线测试（不访问 GitHub） | `devenv test:auth` | 0 或 1 |
| 认证入口真实集成测试（默认只读；写操作需显式旗标） | `devenv test:auth:integration [旗标]` | 0 或 1 或 2 |
| 命令面离线测试（引擎解析/锁与栈使用租约/输出协议/快照与不可变绑定/per-worktree 隔离，mock docker） | `devenv test:devenv` | 0 或 1 |

## 退出码枚举（总表归 Spec-工程基座；7–10 e2e 专用码段由 Spec-e2e 登记）

| 码 | 含义 | 典型修复 |
|---|---|---|
| 0 | 成功 | — |
| 2 | 用法错误（未知子命令/缺参数/非法覆盖格式） | 按 Usage 与 COMMANDS.md |
| 3 | 环境未就绪（引擎不在矩阵、端点解析失败、服务未起、锁文件缺失、web 显式端口被占用） | 按错误内嵌修复命令（多为 `devenv up`/`devenv build`；端口占用时报占用者并给替代命令） |
| 4 | 任务失败（test/lint/typecheck/build/verify 非零；拉取失败；快照采集期工作树持续变化——明确拒绝，不出混合内容） | 看 stderr 完整输出；采集拒绝时暂停文件修改后重试 |
| 5 | 超时（健康等待/镜像拉取） | `devenv logs <svc>` 排查；prefetch 重跑续跑 |
| 6 | 独占锁或栈使用租约冲突（另一会话持锁 / 测试运行中） | 等待或确认持有者已死（失效锁与失效租约会自动清理）；错误消息列出持有者与修复线索 |
| 20 | 配置/授权不符（认证入口） | 核对 `devenv/github-app.json` 与本机授权 |
| 21 | 私钥缺失/权限/JWT 签名失败（认证入口） | 检查私钥路径与权限 |
| 22 | installation token 换取失败（认证入口） | 检查网络与 App 安装状态 |
| 23 | 目标仓库或推送 URL 未授权（认证入口） | 核对授权仓库清单 |

## 输出协议（Spec-工程基座 §4 三类）

1. **结构化命令**（build/up/test/verify/prefetch/doctor 等）`--json`：stdout 只放
   JSON/JSONL——长命令为 JSONL 事件流（`{"event":"engine",...}`、
   `{"event":"step.started",...}`、`{"event":"snapshot.captured",...}`、
   `{"event":"workspace.fresh|built",...}`、`{"event":"image.verified",...}`、
   `{"event":"gate.completed",...}` 等），终值事件
   `{"command":"<cmd>","status":"ok|failed","exitCode":N,...}`；短命令为单 JSON。
   人类可读进度一律走 stderr，子进程原始输出捕获分流，**不得混入结果流**。
2. **透传命令**（exec/shell/logs）：默认输出为子进程原始流（stdout/stderr 原通道
   透传，可管道消费），不承诺其输出本身是 JSON，退出码 = 子进程码。`--json`
   仅包装终值元数据：子进程原始流整体分流到 stderr（独立通道），stdout 只放
   引擎事件与终值（`{"command":"exec|shell|logs","status":"ok|failed","exitCode":<子进程码>}`），
   进度与子进程输出不污染结构化结果流。
3. **引擎报告**：每条工程栈命令执行前解析并报告实际端点 + 引擎身份/版本/架构
   （stderr 人类行 + `--json` 时 `{"event":"engine",...}` JSONL 事件）。

> 硬错误路径（die：锁冲突 6、快照采集拒绝 4、启动核对失败 4、环境未就绪 3——含
> web 显式端口被占用等）以 stderr `ERROR` 行 + 退出码收尾，不发终值事件——与既有
> 锁冲突路径同口径。结构化命令的**步骤/任务失败**（run_step/run_task 路径，exit 4）
> 例外：先补发终值事件 `status:"failed"`（exitCode=4、taskRc=子进程码）再以退出码收尾。

## 引擎端点解析（Spec-工程基座 支持环境节）

解析顺序（选定即定，连接失败即报错，**绝不偷换下一个候选**）：

1. `DEVENV_DOCKER_HOST` 显式覆盖——优先并报告覆盖关系（覆盖与默认不同正是目的，不报错）；
2. `DOCKER_HOST` 环境变量；
3. `~/.rd/docker-env.sh` 安全提取（只 grep 赋值行，**绝不 source 整文件**）；
4. 平台文档化默认发现：WSL2 = Rancher podman machine rootful socket
   （`/mnt/wsl/podman-sockets/podman-machine-default/podman-root.sock`）；
   macOS = podman machine socket（`~/.local/share/containers/podman/machine/podman.sock`）
   与 `/var/run/docker.sock`；裸 Linux = `/var/run/docker.sock`。
   候选唯一才采用；歧义即失败（exit 3）并列候选；无候选即失败。

**macOS 宿主前置（2026-11-27 #53 实测）**：podman machine 已启动；宿主需有 `docker`
CLI 与 compose v2 插件（`~/.docker/cli-plugins/docker-compose` 可指向已有
`docker-compose`），以及 coreutils（快照用 `gstat`）。当默认发现同时命中 podman
socket 与 `/var/run/docker.sock` 时按歧义失败，须显式设置
`DEVENV_DOCKER_HOST=unix://$HOME/.local/share/containers/podman/machine/podman.sock`。

矩阵校验：Podman Engine（开发机：Windows WSL2 / macOS）与 Docker Engine/moby
（仅 `GITHUB_ACTIONS=true` 的 CI 托管上下文）在矩阵内；裸 Linux + moby 开发环境
未验证、不声称支持（exit 3）；未识别引擎 exit 3。doctor 与每条命令报告实际
端点 + 引擎身份/版本/架构，不特判跳过。

## 镜像引用与可配置 DB 镜像

- `devenv/images.lock` 是上游镜像 **tag + digest 双层锁**的唯一事实源
  （`NODE_IMAGE` / `DB_IMAGE`）；升级只改锁文件，一律走 PR + 验证。
- **PostGIS 镜像引用是可配置输入**（不写死单一平台路线）：
  `DEVENV_DB_IMAGE=repo:tag[@sha256:<64hex>]` 环境变量覆盖锁定的 `DB_IMAGE`
  （#53 macOS ARM 路线实验的切换点：Rosetta 仿真沿用锁定值 / kartoza multiarch /
  自建 arm64）。生效值与来源（images.lock / DEVENV_DB_IMAGE 显式覆盖）在
  doctor / status / images 输出中报告；格式非法 exit 2。
- `devenv images --verify` 校验运行中 db 容器镜像 digest 与生效引用一致
  （生效引用无 digest 时如实报告无法校验，exit 1）。

## 并发语义（幂等 ≠ 并发安全）

- 锁实现：宿主侧 **POSIX mkdir 原子目录锁**（不依赖 flock，macOS 可用）；
  锁目录含持有者 pid + 启动时间；失效判定以持有进程存活为准（kill -0），
  不按单纯超时删锁；持有者死亡留下的失效锁会被清理后可取得。
- 锁命名空间 `/tmp/natural-enforcement-locks`（机器级目录；锁名分派见下表）。
- **跨 worktree**：栈/数据/网络已按 worktree 隔离（见下节），stack/migrate 锁
  随之 per-worktree——不同 worktree 的 build/up/down/migrate **互不阻塞**；
  机器级仅 lockgen（共享 ne-lockgen:tmp 标签与遗留容器清理）与 prefetch
  （基础镜像拉取）。
- **复合过程整体持锁**：build/up/down/restart/web 的"检查新鲜度 → 构建 →
  启动/停止"从入口到退出持同一把排他锁（单步锁保护不了全过程）；进程被 kill
  留下的失效锁由下一次取得识别并清理，不永久阻塞环境。

| 命令 | 持有锁/租约 | 互斥对象 |
|---|---|---|
| build / up / down / restart / web（up 与 --down 路径） | stack-<wt>（排他，per-worktree） | 本 worktree 内彼此两两互斥；有活跃共享租约时等待，超时 exit 6。web 端口分配不持锁：省略 --port 时引擎原子分配（#62），跨 worktree 无端口互斥 |
| migrate / migrate:create | stack-<wt> + migrate-<wt>（排他，按此顺序取得） | 本 worktree 内互斥；与活跃共享租约互斥（等待/exit 6）；与其它 worktree 互不阻塞 |
| test / test:unit / verify / lint / typecheck / seed（运行期） | stack-<wt> 共享租约（per-worktree） | 多个租约可并行；与上述排他命令双向互斥（读者遇排他锁等待/exit 6） |
| prefetch | prefetch（机器级） | 跨 worktree 互斥（基础镜像拉取）；冲突等待或 exit 6（重跑续跑） |
| build 触发的 lockgen | lockgen（机器级） | 跨 worktree 互斥（共享标签/容器清理）；冲突等待或 exit 6（重跑即续） |
| 只读（ps/logs/status/images/doctor） | 无 | 任意并发 |
| exec / shell（透传调试） | 无 | 交互时长无界，不持租约；需要稳定环境时先结束调试再拆栈 |

### 栈使用租约（#61）

- **语义**：读者（test/test:unit/verify/lint/typecheck/seed）在运行期持
  `stack-<wt>.lease/<pid>.<epoch>.<rand>/owner`（共享，可并行）；写者
  （build/up/down/restart/web/migrate*）持 `stack-<wt>.lock`（排他）。
  "启动不被打断 ≠ 测试不被打断"：测试运行期间 `down`/`restart`/`migrate`/
  替换服务不得执行——写者须等待活跃租约释放，超时 **exit 6**，绝不强拆。
- **读写进入决策**：短临界区门 `stack-<wt>.gate` 用 mkdir 原子取得，把"检查
  对方是否在场 + 登记自己"串行化；门只持毫秒级，持有者死亡按 pid 存活判定
  失效（与锁同口径）。
- **失效处理**：租约槽 owner 记录 pid + 启动时间 + 槽名；持有进程被 kill 后，
  下一次写者取得或读者登记时清理失效槽（kill -0 判定），不永久阻塞环境。
  **不按超时清除**：慢构建/慢测试仍存活时锁与租约都有效，第二个进程不得闯入。
- **等待上限**：读者等排他锁 120s；写者等租约沿用各自的锁等待（build 120s、
  up/down/restart/web 60s、migrate/migrate:create 10s）；超时 exit 6，错误消息
  列出持有者 pid/启动时间/槽与修复线索。`DEVENV_LOCK_TIMEOUT=<秒>` 显式覆盖
  等待上限（测试/故障演练用；日常不设）。
- **机器级锁不参与租约**：prefetch/lockgen 只协调跨 worktree 的共享资源，
  不取栈使用租约；租约仅协调 per-worktree 栈。prefetch 锁覆盖 `devenv prefetch`
  的显式拉取；构建期 Dockerfile `FROM` 触发的隐式拉取由引擎按内容寻址去重，
  不在本锁范围内（构建仍受 per-worktree 栈锁与 #58 不可变绑定保护）。
- **可见性**：`devenv status` 报告锁目录条目与租约槽（`--json` 终值含
  `leases` 字段；stale 只标注，不清理——status 保持只读）。

> Windows 实机冲突矩阵与故障演练证据摘要见 Issue #61（历史原始输出留存于合并提交
> `d15712a` 的 `docs/evidence/61-lock-lease/`）；锁原语
> 与失效演练起于 #58 验收（T13–T15），本票扩展 T16–T21。另：凡加载 images.lock
> 的命令（prefetch/build/up/images/status/doctor 等）在锁文件缺失或
> `DEVENV_DB_IMAGE` 格式非法时可退出 2（用法错误），上表不逐行重复。

## per-worktree 运行资源隔离（#59，Spec-工程基座 硬不变量 4）

- **worktree 身份**：git 目录路径（`git rev-parse --absolute-git-dir`；主工作树
  `<root>/.git`，链接 worktree `.git/worktrees/<id>`）——per-worktree 唯一且对
  worktree 目录改名/移动稳定。非 git 上下文（离线测试沙箱等）回退工作树根路径
  哈希，source 期不 die。`DEVENV_WORKTREE_ID` 仅供离线测试注入确定性身份。
- **派生命名**：compose 项目名 `natural-enforcement-<8hex>`（容器/卷/网络的隔离根；
  compose.yaml 不写死 name，devenv 一律 `-p` 注入）；本地构建镜像 tag
  `natural-enforcement/{tools,workspace}:wt-<8hex>`（归属可辨）。
- **镜像共享**：镜像内容按不可变产物共享（同快照+同 tools 输入 → 同 image ID，
  存储层内容寻址去重）；运行正确性由不可变 image ID 绑定保证（#58），
  per-worktree tag 不替代绑定。
- **数据库凭据 per-worktree**：首调用 `openssl rand -hex 16`（32 hex，URI 安全）
  生成随机口令，持久化 `.devenv-state/db-credentials.env`（0600，gitignored，
  per-worktree 私有）；db `POSTGRES_PASSWORD` 与 api/tools `DATABASE_URL` 同源
  注入。口令随 worktree 状态保留：down/up 周期稳定（数据卷按初始口令初始化，
  换装必炸）；`down --volumes` 重建空库仍用同一口令（凭据是 worktree 身份不是数据）。
  凭据文件损坏（非 32 hex）→ exit 3 并内嵌修复命令。
- **锁分派**：stack-<wt>/migrate-<wt> per-worktree；机器级 lockgen 与 prefetch
  （跨 worktree 共享的 lockgen 靶容器/标签与基础镜像拉取；栈使用租约只协调
  per-worktree 栈）。migrate:create 容器名 `ne-migrate-create-<wt>`（机器级唯一）。
- **遗留共享项目**：#59 前所有 worktree 共用 compose 项目 `natural-enforcement`
  （容器/卷/网络）。#59 后该项目不被任何 worktree 管理：down 不触碰，doctor
  发现遗留容器报 warn（exit 仍 0）；遗留卷/镜像回收归 #75（宁多留勿误删）。
- **web 宿主端口（#62 已落地）**：web 是零宿主端口不变量的唯一 opt-in 例外。
  省略 `--port` 时注入裸容器端口（`4173`），由引擎在绑定时**原子分配**空闲宿主
  端口——不做"探测时空闲 → 再绑定"式预占（TOCTOU），两个 worktree 并发
  `devenv web` 实际成功且天然不同端口（Windows 实机证据摘要见 Issue #62，
  历史原始输出留存于 `d84142c`）；`--port N` 显式固定发布，冲突在引擎
  绑定时真实失败后诊断占用者（容器占用者经 `docker ps` Ports 文本识别，非容器
  监听者经 TCP 探测区分），exit 3 且错误含服务/端口/占用者/内嵌修复命令。
  实际端口一律经 `docker port` 回读（不预测），进 `--json` 终值与 `status`
  （`web_port`/`web_url`，按本 worktree 项目标签过滤；未运行如实报 none）。
- **对象存储凭据（前置声明）**：#56 最小栈暂无 rustfs/对象存储服务，"数据库/对象存储
  凭据独立"中对象存储半条当前为空集；服务回归时必须复刻 db_credentials_ensure
  模式（每 worktree 生成 + .devenv-state 持久化 + compose 同源注入），归该服务
  的实施票并与 #75 回收核对衔接。

## 架构不变量（Spec-工程基座 硬不变量，本命令面执行）

- **无 bind 烘焙镜像**：源码经 `devenv/workspace.Dockerfile` COPY 进镜像；compose
  只挂命名卷（pgdata、turbo-cache）；零宿主端口（web 唯一显式例外，profile 隔离
  opt-in，端口默认引擎运行时分配、实际端口回读入 status——#62）。调试访问一律经
  `devenv exec/shell/logs`，不开放调试端口（API/数据库等调试同此入口）。
- **宿主工具链零安装**：node/pnpm/prisma 只在容器内执行；源码消费型命令
  （up/test/lint/typecheck/verify/migrate*/seed/web）前置 `ensure_fresh_workspace`
  新鲜度核对（快照一致时亚秒级跳过，不一致时层缓存命中秒级重建），保证容器内
  即当前工作树代码。（固定输入快照与不可变绑定机制见下节；per-worktree 隔离
  已落地，见「per-worktree 运行资源隔离」节。）
- **devenv 唯一入口**：禁止直接操作 compose；静态检查拦截归 #76。

## 固定输入快照与不可变绑定（#58 落地，Spec-工程基座 §3）

- **固定输入快照**：凡消费当前源码的命令（up/test/lint/typecheck/verify/migrate*/seed/web）
  前置 `ensure_fresh_workspace`——用 git 临时索引 `add -A` + `write-tree` 采集工作树
  快照（内容寻址树哈希），覆盖未提交修改、新增、删除，以及 Dockerfile、构建脚本、
  锁文件等构建输入（gitignored 内容不进快照）；构建上下文 = 快照物化目录
  （git archive 自对象库），**采集后不再读取活工作树**。
- **采集一致性（stat 括号 + 内容双读）**：枚举/端点 stat（mtime,size,inode,mode）
  括号 + 两遍全量读取的 (mode,blob) 清单比对 + 文件清单复核——窗口内任何未完美
  复原的写入（含 mtime 恢复型等长覆写、chmod、增删）都被检出 → 重试 3 次后
  **明确拒绝**（exit 4），不产生混合内容却报告来源一致；枚举/读取/stat 失败
  显式重试或报错，不静默成功。机制、三命题区分（镜像忠实于快照 / 快照对应真实
  完整状态 / 业务更新边界——第三者任何文件系统机制都不保证）、成立条件与原理性
  残余（完美往返 ABA，经裁决接受为已声明局限）见
  `docs/adr/2026-11-25-21-19-快照采集一致性机制.md`。构建期间工作树再变不影响
  本次（构建只读快照）。
- **新鲜度核对**：无状态 / 状态镜像不存在 / label 缺失或不符 = 未命中 → 重建；
  引擎故障（无法列出本地镜像）→ exit 3 明确报错，不吞。命中条件：快照哈希 ↔
  镜像 `devenv.snapshot.hash` label ↔ 状态文件一致，且镜像 `devenv.base.image`
  label == 本次绑定的 tools ID。`devenv.snapshot.inputs` 构建输入清单随镜像记录
  （审计用，不参与比对）。
- **不可变绑定链**：固定快照 → tools 不可变镜像 ID → workspace 不可变镜像 ID。
  tools 输入哈希（tools.Dockerfile blob + 快照内 NODE_IMAGE）↔ tools image ID、
  快照哈希 ↔ workspace image ID 均记入状态文件
  `.devenv-state/workspace-image.env`（gitignored，每 worktree 私有）；workspace
  与 lockgen 构建经 `--build-arg TOOLS_IMAGE=<不可变 ID>` 绑定基础镜像（不依赖
  可被覆盖的 tools:local 标签）；workspace 镜像 label `devenv.base.image` 记录
  其基础镜像 ID（可核对）。image ID 取自 `docker build -q` 输出（免 tag 二次解析
  竞态；podman 兼容层输出无前缀 64hex，已归一）；compose 注入 image ID 而非可变
  tag；up/web 启动后核对运行容器 `.Image` == 本次绑定 ID——同 worktree 可变 tag
  被覆盖，原构建仍按自己的不可变标识启动。restart 只重启既有容器（不重新解析
  镜像、无新绑定产生），绑定核对在容器创建路径（up/web）完成。
- **构建输入 vs 运行时输入**：构建上下文（含 Dockerfile、构建脚本、锁文件、
  `NODE_IMAGE`）一律取自快照物化目录，采集后不读活工作树；`compose.yaml` 与
  `DB_IMAGE` 生效值是运行时输入（compose 注入），其变更经快照哈希在下次消费
  命令触发重建。
- **deps 层缓存（#54 结论采纳）**：pnpm store 与 registry 元数据走引擎原生
  cache mount（`sharing=locked`），普通构建保持 `--frozen-lockfile`；store 是
  缓存不是信任根，干净重建换 cache id（`--build-arg PNPM_STORE_CACHE_ID=<新 id>`）。
- **诚实口径**：本机制检查来源一致性、减少运行旧代码，**不声称完整构建证明**；
  锁与栈使用租约已落地（见「并发语义」节，Windows 证据摘要见 Issue #61），
  per-worktree 隔离已落地（见「per-worktree 运行资源隔离」节）。
