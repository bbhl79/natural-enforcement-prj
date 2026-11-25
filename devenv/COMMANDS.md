# devenv 命令面（工程基座唯一入口）

调用形态：`./devenv/devenv [--json] <子命令> [参数]`。
宿主工具链零安装：本命令面只使用白名单宿主工具（bash、docker CLI + compose v2、git、
coreutils、jq、openssl、curl、gh）；一切 node/pnpm/prisma 执行都在容器内。

本文件是命令面的**唯一权威**（Action | Command | 期望退出码 + 输出协议 + 并发语义）；
AGENTS.md 只放关键入口与指针。命令帮助（`devenv --help`）与本表保持一致。

## 命令表（Action | Command | 期望退出码）

### 工程栈

| Action | Command | 期望退出码 |
|---|---|---|
| 一键体检（端点/引擎/矩阵/锁文件/镜像/服务；退出码=可开工与否） | `devenv doctor` | 0 或 3 |
| 预取镜像锁中的上游镜像（分阶段、有进度/超时、可中断续跑） | `devenv prefetch` | 0 或 3/4/5 |
| 构建工具镜像 + 安装依赖 + turbo build（幂等） | `devenv build [--lockgen]` | 0 或 3/4/6 |
| 启动 db → 迁移幂等应用 → api，等待真实健康终态（幂等） | `devenv up` | 0 或 3/4/5/6 |
| 停止（连带清掉不在 compose 文件中的本项目遗留容器；--volumes 再清数据卷；不含 profile 隔离的 web——用 `web --down`） | `devenv down [--volumes]` | 0 或 3/6 |
| 重启 | `devenv restart [svc...]` | 0 或 3/6 |
| 启动前端并发布宿主端口（零端口不变量的唯一例外） | `devenv web [--port N] [--down]` | 0 或 2/3/5 |
| 容器状态 | `devenv ps [-a]` | 0 或 3 |
| 跟随日志（透传原始流） | `devenv logs [svc] [-f] [--tail N]` | 0 或 3 或子进程码 |
| 容器内执行（默认 tools；透传原始流） | `devenv exec [svc] -- cmd...` | 0 或 2/3 或子进程码 |
| 交互 shell（默认 tools；透传原始流） | `devenv shell [svc]` | 0 或 3 或子进程码 |
| 单元+集成测试（需先 up；连真实 PostGIS） | `devenv test [pattern...]` | 0 或 3/4 |
| 仅单元测试（零基础设施） | `devenv test:unit` | 0 或 3/4 |
| ESLint | `devenv lint` | 0 或 3/4 |
| tsc --noEmit | `devenv typecheck` | 0 或 3/4 |
| 聚合质量门：lint + typecheck + test:unit（本地与 CI 同一入口） | `devenv verify` | 0 或 3/4 |
| 应用全部 pending 迁移（prisma migrate deploy） | `devenv migrate` | 0 或 3/4/6 |
| 生成空迁移待编辑（prisma migrate dev --create-only） | `devenv migrate:create --name N` | 0 或 2/3/4/6 |
| 幂等种子数据 | `devenv seed` | 0 或 3/4 |
| 等待服务健康终态（默认 60s） | `devenv wait <db\|api\|web> [--timeout N]` | 0 或 2/3/5 |
| 人读总览（容器+锁+镜像） | `devenv status` | 0 或 3 |
| 查看镜像锁与生效 DB 镜像 / 校验运行态 digest 漂移 | `devenv images [--verify]` | 0 或 1/2/3 |

### GitHub App 认证入口（不触引擎；详见 docs/agents/github-app-auth.md）

| Action | Command | 期望退出码 |
|---|---|---|
| 以 App 身份执行 gh（拒绝 `gh auth`；拒绝 `-R` 指向未授权仓库） | `devenv gh <args...>` | 0 或 2/20/21/22/23 或 gh 自身退出码 |
| 以 App 身份 HTTPS 推送 | `devenv git-push <remote> <refspec...>` | 0 或 2/20/21/22/23 或 git 自身退出码 |
| 认证入口离线测试（不访问 GitHub） | `devenv test:auth` | 0 或 1 |
| 认证入口真实集成测试（默认只读；写操作需显式旗标） | `devenv test:auth:integration [旗标]` | 0 或 1 或 2 |
| 命令面离线测试（引擎解析/锁/输出协议，mock docker） | `devenv test:devenv` | 0 或 1 |

## 退出码枚举（总表归 Spec-工程基座；7–10 e2e 专用码段由 Spec-e2e 登记）

| 码 | 含义 | 典型修复 |
|---|---|---|
| 0 | 成功 | — |
| 2 | 用法错误（未知子命令/缺参数/非法覆盖格式） | 按 Usage 与 COMMANDS.md |
| 3 | 环境未就绪（引擎不在矩阵、端点解析失败、服务未起、锁文件缺失） | 按错误内嵌修复命令（多为 `devenv up`/`devenv build`） |
| 4 | 任务失败（test/lint/typecheck/build/verify 非零；拉取失败） | 看 stderr 完整输出 |
| 5 | 超时（健康等待/镜像拉取） | `devenv logs <svc>` 排查；prefetch 重跑续跑 |
| 6 | 独占锁冲突（另一会话持锁） | 等待或确认持有者已死（失效锁会自动清理） |
| 20 | 配置/授权不符（认证入口） | 核对 `devenv/github-app.json` 与本机授权 |
| 21 | 私钥缺失/权限/JWT 签名失败（认证入口） | 检查私钥路径与权限 |
| 22 | installation token 换取失败（认证入口） | 检查网络与 App 安装状态 |
| 23 | 目标仓库或推送 URL 未授权（认证入口） | 核对授权仓库清单 |

## 输出协议（Spec-工程基座 §4 三类）

1. **结构化命令**（build/up/test/verify/prefetch/doctor 等）`--json`：stdout 只放
   JSON/JSONL——长命令为 JSONL 事件流（`{"event":"engine",...}`、
   `{"event":"step.started",...}`、`{"event":"gate.completed",...}` 等），终值事件
   `{"command":"<cmd>","status":"ok|failed","exitCode":N,...}`；短命令为单 JSON。
   人类可读进度一律走 stderr，子进程原始输出捕获分流，**不得混入结果流**。
2. **透传命令**（exec/shell/logs）：输出为子进程原始流，不承诺其输出本身是 JSON；
   `--json` 对其仅包装终值元数据，原始流走独立通道。
3. **引擎报告**：每条工程栈命令执行前解析并报告实际端点 + 引擎身份/版本/架构
   （stderr 人类行 + `--json` 时 `{"event":"engine",...}` JSONL 事件）。

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
- 锁命名空间 `/tmp/natural-enforcement-locks`（机器级，跨 worktree 共享）。

| 命令 | 持有锁 | 互斥对象 |
|---|---|---|
| build / up / down / restart / web（up 路径） | stack（排他） | 彼此两两互斥 |
| migrate / migrate:create | stack + migrate（排他，按此顺序取得） | 彼此互斥；与 build/up/down 互斥 |
| test / verify / lint / typecheck / seed | 无（#61 引入栈使用租约） | — |
| 只读（ps/logs/status/images/doctor） | 无 | 任意并发 |

> 完整冲突矩阵（测试运行期共享租约、per-worktree 锁细分、机器级 lockgen 锁）
> 归 #61；本票先保证互斥原语两平台可用与 build/up/down/migrate/web 排他。
> 另：凡加载 images.lock 的命令（prefetch/build/up/images/status/doctor 等）在
> 锁文件缺失或 `DEVENV_DB_IMAGE` 格式非法时可退出 2（用法错误），上表不逐行重复。

## 架构不变量（Spec-工程基座 硬不变量，本命令面执行）

- **无 bind 烘焙镜像**：源码经 `devenv/workspace.Dockerfile` COPY 进镜像；compose
  只挂命名卷（pgdata、turbo-cache）；零宿主端口（web 唯一显式例外，profile 隔离
  opt-in）。调试访问一律经 `devenv exec/shell/logs`，不开放调试端口。
- **宿主工具链零安装**：node/pnpm/prisma 只在容器内执行；源码消费型命令
  （up/test/lint/typecheck/verify/migrate*/seed/web）前置 `ensure_fresh_workspace`
  增量重建（层缓存命中时秒级），保证容器内即当前工作树代码。
  （固定输入快照与不可变镜像绑定归 #58；per-worktree 隔离归 #59。）
- **devenv 唯一入口**：禁止直接操作 compose；静态检查拦截归 #76。
