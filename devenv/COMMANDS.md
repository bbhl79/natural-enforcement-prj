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
| 一键体检（端点/引擎/矩阵/锁文件/worktree 身份与凭据状态/供应链门禁/镜像/快照状态/服务；退出码=可开工与否） | `devenv doctor` | 0 或 3 |
| 预取镜像锁中的上游镜像（分阶段、有进度/超时、可中断续跑；机器级拉取锁） | `devenv prefetch` | 0 或 3/4/5/6 |
| 固定快照构建工具镜像 + 安装依赖 + turbo build（幂等；构建前跑供应链静态门禁；记录快照哈希与不可变镜像标识） | `devenv build [--lockgen]` | 0 或 3/4/6 |
| 启动 db/redis/rustfs → 迁移幂等应用 → api/worker，等待真实健康终态（幂等） | `devenv up` | 0 或 3/4/5/6 |
| 停止（连带清掉不在 compose 文件中的本项目容器；--volumes 再清数据卷；仅本 worktree 项目范围；不含 profile 隔离的 web——用 `web --down`） | `devenv down [--volumes]` | 0 或 3/6 |
| 重启 | `devenv restart [svc...]` | 0 或 3/6 |
| 启动前端并发布宿主端口（零端口不变量的唯一例外；省略 --port 由引擎运行时分配空闲端口并回读实际端口进终值/status，--port N 显式固定发布；up 与 --down 路径均持栈排他锁） | `devenv web [--port N] [--down]` | 0 或 2/3/4/5/6 |
| 容器状态（人读表含发布端口） | `devenv ps [-a]` | 0 或 3 |
| 跟随日志（透传原始流） | `devenv logs [svc] [-f] [--tail N]` | 0 或 3 或子进程码 |
| 容器内执行（默认 tools；透传原始流） | `devenv exec [svc] -- cmd...` | 0 或 2/3 或子进程码 |
| 交互 shell（默认 tools；透传原始流） | `devenv shell [svc]` | 0 或 3 或子进程码 |
| 单元+集成测试（需先 up；连真实 PostGIS/Redis/rustfs；worker 由测试进程内独立上下文启动；运行期持共享栈使用租约） | `devenv test [pattern...]` | 0 或 3/4/6 |
| 仅单元测试（零数据库基础设施；仍使用 tools 容器/项目网络，运行期持共享栈使用租约） | `devenv test:unit` | 0 或 3/4/6 |
| ESLint（运行期持共享栈使用租约） | `devenv lint` | 0 或 3/4/6 |
| tsc --noEmit（运行期持共享栈使用租约） | `devenv typecheck` | 0 或 3/4/6 |
| 聚合质量门：lint + typecheck + test:unit（本地与 CI 同一入口；运行期持共享栈使用租约） | `devenv verify` | 0 或 3/4/6 |
| 从当前工作树生成器生成新 workspace 包/应用、契约完整的 Nest 模块或自动注册页面：package/app 自动补 workspace.Dockerfile 两靶 manifest 并触发机器级 lockgen；nest-module `--http` 生成契约/schema/校验/集成测试并整行锚点登记 OpenAPI 清单，`--internal` 仅生成 module/service（不强制 HTTP 契约）；page 经 RTK Query + `validated` 消费既有 HTTP 契约并整行锚点注册到 `App.tsx`，表单使用 React `useId`（多 React 根带根级前缀）；来源路径+子树哈希+整集哈希可核；目标已存在/锚点已注入即拒绝，全有或全无；缺业务信息或契约 exit 2；非预期 lockfile diff 停止并保留现场 | `devenv gen <package\|app> <kebab-case 名>`、`devenv gen nest-module <kebab-case 名> --http\|--internal --spec <仓库相对路径>` 或 `devenv gen page <kebab-case 名> --spec <仓库相对路径> [--contract <契约名>]` | 0 或 2/3/4/6 |
| 读取当前绑定 workspace 镜像内的 pnpm 下载证据（构建须 `DEVENV_PNPM_EVIDENCE=1`；证据缺失/流不完整 exit 4，不默认通过） | `devenv gen evidence` | 0 或 3/4 |
| 应用全部 pending 迁移（prisma migrate deploy；与活跃租约互斥） | `devenv migrate` | 0 或 3/4/6 |
| 生成空迁移待编辑（prisma migrate dev --create-only；与活跃租约互斥） | `devenv migrate:create --name N` | 0 或 2/3/4/6 |
| 幂等种子数据（运行期持共享栈使用租约） | `devenv seed` | 0 或 3/4/6 |
| 等待服务健康终态（默认 60s） | `devenv wait <db\|redis\|rustfs\|api\|worker\|web> [--timeout N]` | 0 或 2/3/5 |
| 人读/机读总览（容器+锁+租约+镜像+web 实际端口；web 未运行如实报 none） | `devenv status` | 0 或 3 |
| 查看镜像锁与生效 DB 镜像 / 校验运行态 digest 漂移 | `devenv images [--verify]` | 0 或 1/2/3 |
| 供应链门禁：catalog 精确 pin / allowBuilds 版本化 / 冷却期 / 锁文件漂移 / 镜像锁类型静态核对；`--container` 追加核对待审批构建脚本与包内 agent skills（默认拒绝） | `devenv supply-chain [--container]` | 0 或 2/3/4/6 |

### GitHub App 认证入口（不触引擎；详见 docs/agents/github-app-auth.md）

| Action | Command | 期望退出码 |
|---|---|---|
| 以 App 身份执行 gh（拒绝 `gh auth`；拒绝 `-R` 指向未授权仓库） | `devenv gh <args...>` | 0 或 2/20/21/22/23 或 gh 自身退出码 |
| 以 App 身份 HTTPS 推送 | `devenv git-push <remote> <refspec...>` | 0 或 2/20/21/22/23 或 git 自身退出码 |
| 认证入口离线测试（不访问 GitHub） | `devenv test:auth` | 0 或 1 |
| 认证入口真实集成测试（默认只读；写操作需显式旗标） | `devenv test:auth:integration [旗标]` | 0 或 1 或 2 |
| 命令面离线测试（引擎解析/锁与栈使用租约/输出协议/快照与不可变绑定/per-worktree 隔离/供应链门禁，mock docker） | `devenv test:devenv` | 0 或 1 |

## 退出码枚举（总表归 Spec-工程基座；7–10 e2e 专用码段由 Spec-e2e 登记）

| 码 | 含义 | 典型修复 |
|---|---|---|
| 0 | 成功 | — |
| 2 | 用法错误（未知子命令/缺参数/非法覆盖格式；`gen nest-module` / `gen page` 缺必要业务信息、spec 非法、basePath 与既有契约路由冲突，或 `gen page` 缺少/不兼容 create/list HTTP 契约——含容器内生成器拒绝的字段类型/约束/字段不匹配错误，其退出码 2 原样透传，不降级为 4） | 按 Usage 与 COMMANDS.md；spec/契约问题按错误消息修正 `--spec` 或先生成 HTTP 契约 |
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
   `gen package` / `gen app` / `gen nest-module` / `gen page` 的 JSONL 含 `{"event":"gen.source",...}`
   （宿主来源路径/子树哈希/整集哈希/文件数/快照）、`{"event":"gen.applied",...}`
   （落盘文件数与补丁数）；package/app 另有 `{"event":"gen.lockfile","result":"expected",...}`。
   nest-module 的终值另含 `variant=http|internal`、`spec=<路径>`、`patches=<补丁数>`、
   `lockgen=not-required`（不新增 workspace 包/依赖）；page 的终值含 `contract=<契约名>`、
   `spec=<路径>`、`patches=1`、`lockgen=not-required`。生成器容器的 stdout tar
   由 devenv 内部捕获到事务目录（**不经 devenv 的 stdout**），与结果流严格分离；
   `--json` 的 stdout 只有 JSONL。`gen evidence` 是短命令：非 `--json` 时 stdout
   为单行紧凑证据 JSON，`--json` 时为 engine 事件 + 同一证据 JSON（JSONL）。
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
  （`NODE_IMAGE` / `DB_IMAGE` / `DB_IMAGE_MACOS` / `REDIS_IMAGE` / `RUSTFS_IMAGE`）；升级只改锁文件，一律走 PR + 验证。
- **digest 类型必须与镜像形态一致**（#63）：
  - 多架构镜像锁 **manifest-list digest**（跨架构成立）→ `*_KIND=manifest-list`；
  - 单架构镜像锁**该平台 digest** → `*_KIND=single-arch` 且声明
    `*_PLATFORM=<os>/<arch>`（如 `linux/amd64`）。
  - 官方 `postgis/postgis` 仅 amd64，故 `DB_IMAGE_KIND=single-arch`、
    `DB_IMAGE_PLATFORM=linux/amd64`；锁值取 registry index 中该平台的 **manifest
    digest**（`sha256:530b81…`），不是 index 自身的 digest。`NODE_IMAGE`、
    `DB_IMAGE_MACOS`、`REDIS_IMAGE`、`RUSTFS_IMAGE` 为 manifest-list。
  - 静态门禁拒绝缺 digest、缺 kind/platform、字段格式非法的锁文件；镜像实际形态
    （index vs 平台 manifest）需在登记时经 registry/`docker pull` 核对，静态检查
    不联网。
- **PostGIS 镜像引用是可配置输入**（不写死单一平台路线）：
  `DEVENV_DB_IMAGE=repo:tag[@sha256:<64hex>]` 环境变量覆盖锁定的 `DB_IMAGE`
  （#53 macOS ARM 路线实验的切换点：Rosetta 仿真沿用锁定值 / kartoza multiarch /
  自建 arm64）。**引擎架构为 arm64 时自动采用 `DB_IMAGE_MACOS`**（kartoza
  multiarch，macOS Apple Silicon 路线 B），其余（Windows/WSL2/CI amd64）使用
  `DB_IMAGE`。`DEVENV_DB_IMAGE` 始终最高优先。生效值与来源（images.lock /
  macOS 路线 / DEVENV_DB_IMAGE 显式覆盖）在 doctor / status / images 输出中报告；
  生效 `kind` 取 `manifest-list|single-arch`，显式覆盖无锁元数据时报告 `unknown`；
  格式非法 exit 2。
- `devenv images --verify` 校验运行中 db 容器镜像 digest 与**生效引用**一致
  （`RepoDigests` 命中锁值；未运行、无 digest 或漂移均 exit 1），并核对 tools
  镜像 label `devenv.node.image` 与 `NODE_IMAGE` 一致（未构建/漂移 exit 1）。

## 供应链门禁（#63）

规则与例外流程权威文档：`docs/agents/supply-chain.md`。命令面只做执行与报告：

- `devenv supply-chain`：宿主侧静态核对（jq/awk，不触引擎）——
  - `pnpm-workspace.yaml` 存在；`catalog` 非空且每个值都是**精确版本**
    （拒绝 `^ ~ * latest`/URL）；
  - `allowBuilds` 键必须带版本（`pkg@1.2.3` / `@scope/pkg@1.2.3`），值仅 true/false
    （升级即新的显式审批点）；
  - `minimumReleaseAge` 为**正整数分钟**（本仓库 1440 = 1 天），
    `minimumReleaseAgeStrict: true`，`minimumReleaseAgeIgnoreMissingTime` 不得开启，
    `dangerouslyAllowAllBuilds` 不得开启，`minimumReleaseAgeExclude` 只允许精确
    `pkg@version`；
  - 各 manifest 的第三方依赖必须走 `catalog:`（catalog 中的包不得写死版本），
    `workspace:*` 仅用于内部包；
  - `pnpm-lock.yaml` 与声明一致：catalog specifier/version、importer 直接依赖集合、
    解析版本任一漂移都停止并提示 `devenv build --lockgen` 后审查 diff；
  - `devenv/images.lock` digest/kind/platform 完整（含 `DB_IMAGE_MACOS` 登记）。
  失败 **exit 4**，并输出逐条 `supply_chain.error` 事件。
- `devenv supply-chain --container`：静态门禁通过后，确保当前快照 workspace 已
  构建，再在 tools 容器内运行 `pnpm permissions list`：任何**待审批**的构建脚本或
  包内 agent skills 都使门禁失败（**默认拒绝**，exit 4），须显式审查后
  `pnpm approve` / `permissions.*` 落地；检查本身失败按 fail-closed 处理。
- `devenv build`（非 `--lockgen`）在取得构建锁、进入引擎构建前跑同一静态门禁；
  失败 exit 4 且**不调用引擎**。`--lockgen` 与首次引导（无 lockfile）跳过静态门禁，
  用于生成待审查的锁文件。workspace 镜像 deps 层在 `pnpm install --frozen-lockfile`
  之后运行权限门禁，任何新出现的待审批项都会中断镜像构建。
- 依赖包自带的 agent skills **不自动采纳**；只有显式批准的才链接到
  `.claude/skills`。当前 `@reduxjs/toolkit@2.15.0` 携带的 13 个技能已审查并显式
  拒绝（`permissions."@reduxjs/toolkit".skills: false`）。

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
  启动/停止"从入口到退出持同一把排他锁（单步锁保护不了全过程）；`gen package` /
  `gen app` 从采集货源到 lockgen 结束持 `gen-<wt>`；`gen nest-module` / `gen page` 从采集货源
  到落盘结束持同一把（不触发 lockgen）。build 在栈锁之后也取同一把（gen/build
  互斥），进程被 kill 留下的失效锁由下一次取得识别并清理，不永久阻塞环境。

| 命令 | 持有锁/租约 | 互斥对象 |
|---|---|---|
| build / up / down / restart / web（up 与 --down 路径）/ supply-chain --container | stack-<wt>（排他，per-worktree）；build 另取 gen-<wt> | 本 worktree 内彼此两两互斥；有活跃共享租约时等待，超时 exit 6。web 端口分配不持锁：省略 --port 时引擎原子分配（#62），跨 worktree 无端口互斥 |
| gen package / gen app / gen nest-module / gen page | gen-<wt>（排他，per-worktree）；package/app 触发时另取 lockgen（机器级） | 与其它 gen、与 build 互斥（build 也取得 gen-<wt>，保证生成期源码/锁文件不被并发**构建**读取）；lockgen 跨 worktree 互斥；冲突等待或 exit 6。nest-module/page 不新增 workspace 包，不触发 lockgen。其余只读消费命令不取 gen 锁，靠快照采集的 stat 括号/双读检出混合状态并明确拒绝（exit 4），不与 gen 串行。gen 不做栈变更，不取栈使用租约 |
| migrate / migrate:create | stack-<wt> + migrate-<wt>（排他，按此顺序取得） | 本 worktree 内互斥；与活跃共享租约互斥（等待/exit 6）；与其它 worktree 互不阻塞 |
| test / test:unit / verify / lint / typecheck / seed（运行期） | stack-<wt> 共享租约（per-worktree） | 多个租约可并行；与上述排他命令双向互斥（读者遇排他锁等待/exit 6） |
| prefetch | prefetch（机器级） | 跨 worktree 互斥（基础镜像拉取）；冲突等待或 exit 6（重跑续跑） |
| build / gen 触发的 lockgen | lockgen（机器级） | 跨 worktree 互斥（共享标签/容器清理）；冲突等待或 exit 6（重跑即续） |
| 只读（ps/logs/status/images/doctor/gen evidence） | 无 | 任意并发（gen evidence 只读绑定镜像内的证据文件，不重建、不触栈） |
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

## 脚手架生成（#64 package / #65 app / #67 nest-module / #68 page，Spec-工程基座 §5）

- **来源可核，无烘焙 fallback**：生成器 = 当前工作树的完整 `devenv/gen/` 集合，
  经固定快照（#58）采集；报告宿主来源路径、git 子树哈希（`treeHash`）与整集内容
  哈希（`setHash`）。输入经 **stdin tar** 进入一次性容器（`--network none
  --read-only`），容器侧重算整集哈希并与宿主比对——不一致即退出 4，未执行生成。
  nest-module 的业务 spec 与锚点文件（`apps/api/src/app.module.ts`、
  `packages/contracts/src/api-registry.ts`），以及 page 的业务 spec、契约文件与
  `apps/web/src/App.tsx` 同经该 tar 传入，不读镜像内烘焙副本。
  `.dockerignore` 排除 `devenv/gen`，容器入口另断言 `/workspace/devenv/gen`
  不存在：镜像内没有可静默 fallback 的生成器副本。
- **文件通道隔离**：生成器容器的 stdout tar 由 devenv 内部捕获到事务目录，不经
  devenv 的 stdout；`--json` 的 stdout 只有 JSONL 事件/终值。tar 内含
  `.ne-gen-manifest.json`（每个文件的 sha256/mode + 补丁的旧/新哈希/新增整行 +
  nest-module spec 路径/哈希）。
- **全有或全无**：宿主先列 tar 成员做路径/链接安全校验（拒绝绝对路径、`..`、
  反斜杠、符号/硬链接），再解包到 `.devenv-state/gen-txn.*`（gitignored，同文件
  系统），校验清单、文件集合精确相等与全部哈希；再以原子 `rename` 提交。补丁
  只允许**整行追加**：宿主按清单声明的 `addedLines` 核对旧/新文件的整行出现次数，
  去掉新增行后必须与快照锚点逐字节一致（非预期修改 → exit 4）。任何失败都回滚
  本次新文件（含新建空目录）与补丁备份；package/app 另回滚 Dockerfile 与 lockfile。
  **lockgen 成功之后**的锁文件审查或供应链门禁失败则保留现场供审查（不自动
  接受、也不回滚——与「非预期 diff 停止并请求审查」一致）。目标目录已存在、
  同 `@ne/<name>` 包名已在 `packages/`/`apps/` 占用、模块/契约锚点已注入同名行、
  或 Dockerfile 已注入同名 COPY 行 → exit 4，且不写入任何文件（幂等保护）。
- **workspace 清单联动**：`devenv/workspace.Dockerfile` 的 lockgen-base 与 deps
  两靶各有一个 `# @gen:pkg-copy` 标记；生成器要求恰好两处命中并各追加一行
  `COPY <packages|apps>/<name>/package.json ...`，否则拒绝。落盘后采集新快照并触发
  **机器级 `lockgen` 锁**保护的 lockgen（与 build 触发的 lockgen 同一把）。
- **lockfile diff 审查规则**：只接受新增 `<packages|apps>/<name>` importer 的预期 diff
  （去掉该 importer 后规范化比对新旧锁文件必须一致）；其它任何差异 → exit 4，
  停止并要求审查，生成物与新锁文件**保留**（不自动接受、不回滚），修正生成器/
  依赖后重新 gen。
- **nest-module 契约联动（#67）**：`devenv gen nest-module <name> --http|--internal
  --spec <仓库相对路径>`。`--spec` 是必要业务信息（非空 `fields`；可选
  `description`/`basePath`），字段支持 string/integer/number/boolean 与
  minLength/maxLength/minimum/maximum/optional；缺失、空 fields、被 gitignore
  忽略、路径不安全（`..`/`.` 段、符号链接）、字段类型/约束非法，或 HTTP 的
  basePath 与既有契约路由冲突（OpenAPI 会出现重复 operation；预检扫描
  `packages/contracts/src` 的路由字面量，排除本模块自己的契约文件）→ exit 2，
  生成前停止（不产生部分写入）。同名模块/契约文件已存在仍是 exit 4（幂等拒绝）。
  - HTTP：在 `packages/contracts/src/<name>.ts` 生成路由常量、请求/响应 zod
    schema 与端点清单；`apps/api/src/<name>/` 生成 module/controller/service 及
    集成测试（真实 HTTP 装配：请求校验 → service → 响应校验 → #66 OpenAPI
    完整性检查）。controller 用 `@Body({ schema, pipes: [ZodValidationPipe] })`
    做请求校验、`ApiContractResponse` 做响应校验；契约文件经
    `packages/contracts/src/api-registry.ts` 的 `// @gen:endpoint-import` /
    `// @gen:endpoint-spread` 整行锚点进入 `API_CONTRACT_ENDPOINTS`。
  - internal：只生成 module/service/单测，不生成 controller、契约文件或 OpenAPI
    登记（Spec §5：internal kind 不强制 HTTP 契约）。
  - 两种 variant 都经 `apps/api/src/app.module.ts` 的 `// @gen:module-import` /
    `// @gen:module-entry` 整行锚点自动注册；锚点缺失或已注入同名行 → exit 4。
  - 不新增 workspace 包（无 package.json/lockfile 变化）→ 不触发 lockgen；
    仍执行静态供应链门禁。示例 service 是可直接调用/测试的内存实现，接入真实
    持久化时替换（契约、校验、文档与测试是生成物的稳定部分）。
- **生成物开箱质量**：package 模板（`packages/<name>`）与 app 模板（`apps/<name>`，
  含 `start` 入口脚本、`@ne/tsconfig/node.json` 与 `@types/node`）均含
  build/typecheck/test/test:unit 脚本与 `@ne/tsconfig`/catalog devDependencies；
  nest-module 生成物直接复用 `@ne/api` 的 Nest/zod/契约依赖（无需改依赖清单）。
  闭环验收为 `devenv verify`（lint + typecheck + test:unit）及 `test` 全绿、
  普通构建 frozen install 成功；HTTP 生成物另经 `node apps/api/dist/scripts/
  emit-openapi.js` 导出并强制 #66 完整性检查。生成器执行与 build 读取源码/锁文件
  互斥（`gen-<wt>`），lockgen 与其它 worktree 互斥（机器级）。
- **page 自动注册与表单实例唯一（#68）**：`devenv gen page <name> --spec <仓库相对路径>
  [--contract <kebab-case 契约名>]`。`--spec` 复用 nest-module 的字段模型（新增可选顶层
  `title` 与字段级 `label`），`--contract` 默认与 `<name>` 同名，必须指向 `@ne/contracts`
  中已导出、且**已登记到 `API_CONTRACT_ENDPOINTS`** 的 create/list HTTP 契约（如
  `#67 gen nest-module --http` 生成物；`api-registry.ts` 需有整行
  `import { <UPPER>_ENDPOINTS } from './<contract>.js'` 与 `...<UPPER>_ENDPOINTS,`）。
  仅从 `index.ts` 再导出而未登记端点 → exit 2：vite preview 代理由端点清单派生，未登记时
  页面能过类型检查但真实 API 无代理路由。缺失 spec、空 fields、缺失/不兼容契约、spec 字段
  与契约（字段集合与 zod 表达式）不符、或 label **规范化空白（换行/制表/NBSP/U+2028/U+2029
  折叠为空格）后重名** → exit 2，生成前停止（零写入）。同名页面目录或 `App.tsx` 已注入
  同名 key/import → exit 4。
  - 生成物落 `apps/web/src/pages/<name>/`（`<name>.api.ts`、`<Pascal>Form.tsx`、
    `<Pascal>Page.tsx`、`<Pascal>Page.spec.tsx`），按 `apps/web/src/App.tsx` 的
    `// @gen:page-import` / `// @gen:page-item` 整行锚点自动注册为标签页；不新增
    workspace 包/依赖 → 不触发 lockgen，仍执行静态供应链门禁。
  - 契约与代理同源：`<name>.api.ts` 经 `neApi.enhanceEndpoints({ addTagTypes }).injectEndpoints`
    消费 `@ne/contracts` 路由常量与推断类型，响应全部经 `validated(...)` 统一校验封装；
    `apps/web/vite.config.ts` 的 `apiProxy` 直接从 `API_CONTRACT_ENDPOINTS` 派生并配置
    `preview.allowedHosts: ['web', 'localhost']`，生成页面通过 `devenv web` 即可立即调用真实 API。
  - UI 规则与 zod 语义一致：字符串未声明 `minLength`（或 `minLength: 0`，含 `maxLength: 0`
    的空串契约）时不加 `required`，未触碰的输入序列化为 `''` 而非 `undefined`；仅当必填且
    `minLength > 0` 才加 `required`。可选字符串的长度规则对空值放行（空值由 payload 构建器省略）。
  - 表单实例唯一与多 React 根：`apps/web/src/lib/root.tsx`（`createWebRoot`）为
    `createRoot` 统一传入 `identifierPrefix`（主入口默认 `ne-web-`，省略时自动分配递增前缀）；
    `<Pascal>Form` 与既有 `CreatePointForm` / `NearbyPanel` 均使用 React `useId` 作为 Ant Design
    `<Form name={formId}>`。生成的 `<Pascal>Page.spec.tsx` 与基线 `apps/web/test/form-uniqueness.spec.tsx`
    在真实渲染 DOM 上断言双相同 Form 与多 React 根的 DOM id 唯一、根级前缀生效及 `<label for>` 关联。
  - `eslint-plugin-react` 最小正确性规则面（13 条 error 规则）在根级 `eslint.config.js`
    flat config 下生效（显式 `settings.react.version: '19.3'` 兼容 ESLint 10）。
- **page 真实引擎冒烟（#68 AC1–AC5）**：`devenv/test/gen-page-smoke.sh [--timeout S]`
  在真实引擎上依次验证：① `eslint-plugin-react` 13 条规则反例探针；② `gen nest-module --http`
  + `gen page`（同名与 `--contract` 异名）→ 整行锚点核对 → `verify` → `up` + `web` → `test`
  → 真实栈 UI 旅程（`VITE_LIVE_WEB_URL=http://web:4173` 下挂载真实 `<App />` 自动注册标签，
  表单提交经 `vite preview` proxy 到真实 NestJS API 并回显在表格）→ 宿主 `curl` 独立核对
  实时 API 状态；③ 未登记端点契约（仅 `index.ts` 导出）拒绝 exit 2、`maxLength: 0` 空串字段
  不与 `required` 冲突（生成物源码 + 提交回显双重断言）、规范化后重复 label 拒绝 exit 2；
  ④ 重复生成拒绝（exit 4）与其它容器/宿主反例（exit 2）；⑤ 全程工作树签名核对无部分写入
  与基线复原。原始证据与 `SUMMARY.md` 写入 `.artifacts/68-gen-page/`。
- **nest-module 真实引擎冒烟（#67 AC5）**：`devenv/test/gen-nest-module-smoke.sh
  [--timeout S]` 在真实引擎上对 HTTP 与 internal 各走 gen → 清单/整行锚点核对 →
  verify → test → [HTTP] OpenAPI 导出与端点断言 → 重复生成拒绝（exit 4）→ 复原
  基线，另跑 5 条反例（缺 `--spec`/空 fields/字段类型非法/basePath 冲突/缺 variant，
  均期望 exit 2）。每步校验工作树签名（临时索引 `add -A` + `write-tree`，与 #58
  快照同口径）证明「无部分写入」与「基线完整复原」；任一不符即失败，不默认通过。
  原始证据与 SUMMARY.md 写入 `.artifacts/67-gen-nest-module/`（记录 HEAD 与工作树
  是否干净，脏树证据不绑定单一 commit）。
- **下载证据与基准**：`DEVENV_PNPM_EVIDENCE=1`（只接受空/0/1，拼写错误 exit 2）
  构建时，deps 层以 pnpm ndjson 结构化事件摘要写入镜像
  `/workspace/.devenv/pnpm-install.json`；`devenv gen evidence` 从绑定镜像读取
  （缺失/流不完整/`errors>0` → exit 4「无法验收」，stdout 为单行紧凑 JSON）。
  `devenv/test/gen-loop.sh [--loops N] [--timeout S]` 从同一基线 + 共享缓存重复
  gen → build（证据）→ verify，报告 gen 到 verify 的中位数/最差值；只有
  `complete=true`、`fetchedPackages=0` 且 `errors=0`（未变更依赖零包内容下载）
  才算通过，证据缺失/超时不默认通过。原始证据写入 `.artifacts/64-gen-loop/`。
  Windows 5 轮实机证据需在 WSL2 bash 内执行该脚本（本仓开发机为 macOS，
  Windows 数字未在本环境取得，不得以 macOS 结果冒充）。

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
- **对象存储凭据 per-worktree（#69 已落地）**：`openssl rand` 生成 S3 access key
  （16-32 位小写字母数字）与 secret（32 hex），持久化
  `.devenv-state/storage-credentials.env`（0600，gitignored，per-worktree 私有）；
  rustfs `RUSTFS_ACCESS_KEY/SECRET_KEY` 与 api/worker/tools 的 `S3_ACCESS_KEY/SECRET_KEY`
  同源注入。凭据文件损坏（格式不符）→ exit 3 并内嵌修复命令；凭据随 worktree 状态
  保留，换凭据需 `down --volumes` 重建 rustfs 数据卷。

## 架构不变量（Spec-工程基座 硬不变量，本命令面执行）

- **无 bind 烘焙镜像**：源码经 `devenv/workspace.Dockerfile` COPY 进镜像；compose
  只挂命名卷（pgdata、rustfs-data、turbo-cache）；零宿主端口（web 唯一显式例外，profile 隔离
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

## 同源文件证据往返（#69）

**服务拓扑**：`devenv up` 额外启动 `redis`（队列）与 `rustfs`（对象存储，单节点、
`mem_limit: 1g`、仅容器内网），迁移后启动 `api` 与独立 `worker` 进程；`worker` 的
compose 健康检查读 Redis 心跳（证明已进入消费循环），不发布任何宿主端口。
`web` 的 preview proxy 仍由 `@ne/contracts` 的端点清单派生，因此 `/evidence*` 自动
同源代理到 `api:3000`。

**凭据与隔离**：rustfs 的 `S3_ACCESS_KEY` / `S3_SECRET_KEY` 每 worktree 随机生成，
持久化 `.devenv-state/storage-credentials.env`（0600，gitignored）；与数据库口令同口径
（凭据随 worktree 状态保留，换凭据需 `down --volumes` 重建数据卷）。对象数据卷
`rustfs-data` per-worktree 独立。

**HTTP 契约（`@ne/contracts` → OpenAPI，#66 完整性门禁）**：

| 端点 | 请求 | 响应 |
|---|---|---|
| `POST /evidence` | `application/octet-stream` 原始字节；`x-original-name: encodeURIComponent(name)`（必需）；`x-point-id` 正整数（可选） | 201 `EvidenceRecordDto`（pending）；400/413/415/503 |
| `GET /evidence/:id` | 路径参数 `id` | 200 `EvidenceRecordDto`；404 |
| `GET /evidence/:id/content` | 路径参数 `id` | 200 `application/octet-stream`（同源字节，`Content-Disposition` RFC 5987）；404/503 |

- 上传上限 10 MiB（`MAX_EVIDENCE_BYTES`；body parser 上限 +1 字节用于应用层返回契约
  声明的 413）。文件名解码失败、wire 超长（>4096）、解码后超 200 码点、路径分隔符/
  穿越名、控制字符/双向控制符/纯空白一律 400；**文件名只作展示元数据，对象键只由
  服务端生成的记录 id 构成**（`evidence/<id>`）。
- 浏览器响应（上传/记录/下载）不含 bucket、对象键、presigned URL 或内部存储地址；
  记录 DTO 只给同源相对路径 `contentPath`。presigned GET 仅服务间使用：worker
  经 presigned GET 读取对象并回写 sha256/字节数，失败的浏览器可见文案固定且不含
  内部地址（完整异常只进服务端日志）。
- 后台处理：`POST /evidence` 建 pending 记录并投递 BullMQ；worker 回写
  `ready`（sha256/bytes）或 `failed`。队列名可用 `EVIDENCE_QUEUE_NAME` 注入
  （#70 每 run 键空间的前置能力）。

**证据与验证入口**：

- `devenv test`：`apps/api/test/evidence.spec.ts` 连真实 PostGIS + Redis + rustfs，
  覆盖 unicode/emoji、恶意/解码失败/长度、同源上传下载字节一致、服务间 presigned
  与浏览器响应不泄漏内部地址；worker 以测试进程内独立 Nest 上下文启动并使用随机
  队列名，测试自清理记录/对象/点位。
- `devenv/test/evidence-ui-smoke.sh`（需先 `devenv up` + `devenv web`）：在 tools
  容器内以 `EVIDENCE_UI_BASE_URL=http://web:4173` 渲染真实 `EvidencePanel`，经
  preview proxy 完成 选择 unicode 文件 → 上传 → worker ready → 同源下载字节一致 →
  UI 展示；结束按记录 id 自清理。
