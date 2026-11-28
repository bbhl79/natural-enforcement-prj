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
| 一键体检（端点/引擎/矩阵/锁文件/worktree 身份与凭据状态/供应链门禁/CI workflow 静态门禁/镜像/快照状态/服务；退出码=可开工与否） | `devenv doctor` | 0 或 3 |
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
| 构建 e2e 执行器镜像（官方 Playwright 基座 + 项目运行时；Playwright npm 包与镜像 tag 严格同版本，版本不符即停止；幂等，命中复用） | `devenv e2e build` | 0 或 3/4/6 |
| e2e 运行登记册（run id / status / live / 数据库 / bucket / 队列；只读） | `devenv e2e runs` | 0 或 3/4 |
| 缺陷记录查询（事实源 `apps/e2e/defects/<ID>.json`，经 stdin tar 只读进容器由纯决策引擎解析；show 输出摘要 + 证据 URI，list 输出清单；`--json` 终值含 `defect`/`defects`；未知 ID 或记录 schema 不符 exit 10，零落盘） | `devenv e2e defect show <DEF-NNNN>`、`devenv e2e defect list` | 0 或 2/3/4/10 |
| DEF-NNNN 取号（本地 max+1，不填洞；`--remote` 经 `devenv gh` 叠读远端 `defects/` 已有编号取 max(本地,远端)+1，best-effort：远端不可用只 WARN 并回退本地；`--remote-ref` 覆盖远端 ref，默认 `dev`，亦可用 `DEVENV_E2E_NUMBER_REMOTE_REF`） | `devenv e2e defect next-id [--remote] [--remote-ref REF]` | 0 或 2/3/4/10 |
| 重建缺陷注册表（派生缓存 `apps/e2e/.registry.json`，不入库；**始终重建**，与事实源漂移仅 WARN 不硬门禁；持生命周期写锁 `e2e-lifecycle-<wt>`，写盘经 op 协议宿主侧原子应用） | `devenv e2e registry rebuild` | 0 或 2/3/4/6/10 |
| 重放已登记缺陷（诊断与修复确认共用同一命令）：起隔离栈真跑记录内 `replayCommand`，复用 #70 per-run 机制（命名/准入/所有权锁/登记册/回收）+ #61 共享栈租约；**每轮 attempt 独立 run id → 独立库/bucket/队列键空间**（replay 写数据，同库重复 attempt 撞唯一约束会伪装成未复现）；`--attempts N` 多轮经失败签名比对判「同一断言处因同一原因失败」；**只读事实源**（门禁回填归 #109、修复确认归 #111）。0=复现、4=未复现（含「环境漂移或已修复？」语义反转提示）或多轮签名不一致、3=基础设施错误、10=缺陷不存在/非法记录/复现脚本缺失 | `devenv e2e replay <DEF-NNNN> [--attempts N] [--run-id BASE]` | 0 或 2/3/4/5/6/10 |
| 观察 per-run 容器日志（透传原始流；api\|worker\|web，默认 api） | `devenv e2e logs --run-id ID [svc] [-f] [--tail N]` | 0 或 2/3 或子进程码 |
| 登记探索发现为标准缺陷报告（**复现门禁由命令实测回填，非自查申报**）：起隔离栈跑发现载荷内 `replayCommand`，按**被测路径**分类——`kind=pure` 1 轮 / `kind=external-state` ≥3 轮，**每轮独立 run id → 独立库/bucket/队列键空间**且从明确前置状态开始（空库 DROP FORCE+CREATE → migrate deploy → 空桶/空队列）；逐轮失败签名经 #108 同一原语比对判「同一断言处因同一原因失败」。任一轮不符 / `errorClass=unknown`\|`infrastructure` / 未复现 → **门禁不过 exit 8、零登记**；过则缺陷 JSON（`status=reported`）+ 零依赖复现脚本经 op 协议**同一事务原子入库**，gate 证据（轮次/键空间/逐轮比对/前置状态声明）回填 `reproducibility.gate`，`defectId` 写回运行登记册；`issue` 回链位留空（写入归 #114）。`--from-results` 从 Playwright `results.json` 提取 #107 `property-finding` 附件；`--attempts` 只可上调不可低于路径下限；`--remote` 编号叠读 best-effort | `devenv e2e report --finding <file.json> [--from-results <results.json>] [--property NAME] [--attempts N] [--run-id BASE] [--by WHO] [--remote] [--remote-ref REF]` | 0 或 2/3/4/5/6/8/10 |
| 探索轨道：共享基础设施容器 + 每 run 独立数据库/bucket/队列键空间；per-run API/worker 绑定本 run 资源；运行期持共享栈使用租约；产物导出宿主 `.artifacts/e2e/<run-id>/`；探索发现=产出（exit 4，不提示误修测试栈） | `devenv explore [--run-id ID]` | 0 或 2/3/4/5/6 |

### GitHub App 认证入口（不触引擎；详见 docs/agents/github-app-auth.md）

| Action | Command | 期望退出码 |
|---|---|---|
| 以 App 身份执行 gh（拒绝 `gh auth`；拒绝 `-R` 指向未授权仓库） | `devenv gh <args...>` | 0 或 2/20/21/22/23 或 gh 自身退出码 |
| 以 App 身份 HTTPS 推送 | `devenv git-push <remote> <refspec...>` | 0 或 2/20/21/22/23 或 git 自身退出码 |
| 认证入口离线测试（不访问 GitHub） | `devenv test:auth` | 0 或 1 |
| 认证入口真实集成测试（默认只读；写操作需显式旗标） | `devenv test:auth:integration [旗标]` | 0 或 1 或 2 |
| 命令面离线测试（引擎解析/锁与栈使用租约/输出协议/快照与不可变绑定/per-worktree 隔离/供应链门禁/CI workflow 静态门禁/脚手架生成/e2e 隔离编排/e2e 生命周期决策引擎，mock docker） | `devenv test:devenv` | 0 或 1 |

## 退出码枚举（总表归 Spec-工程基座；7–10 e2e 专用码段由 Spec-e2e 登记：9/10 已登记（#106）、8 已登记（#109），7 由 #116 登记）

| 码 | 含义 | 典型修复 |
|---|---|---|
| 0 | 成功 | — |
| 2 | 用法错误（未知子命令/缺参数/非法覆盖格式；`gen nest-module` / `gen page` 缺必要业务信息、spec 非法、basePath 与既有契约路由冲突，或 `gen page` 缺少/不兼容 create/list HTTP 契约——含容器内生成器拒绝的字段类型/约束/字段不匹配错误，其退出码 2 原样透传，不降级为 4；e2e 生命周期用法错误：`e2e defect` 缺动作、`e2e defect show` 缺 ID 或 ID 非 `DEF-NNNN` 形态、未知 defect/registry 动作、`next-id --remote-max` 非整数、`e2e replay` 缺 ID/ID 形态非法/`--attempts` 非正整数/`--run-id` 追加 `-a<k>` 后超 40 字符/多余参数、签名引擎 `--source` 非 replay\|playwright 或载荷 JSON 非法、尚未实现的子命令（graduate/retire/renumber 等归后续票）；**`e2e report` 输入契约违规**：缺 `--finding`/载荷文件不存在/载荷非合法 JSON/发现载荷 schema 不符（给字段路径）/`source=property-finding` 缺 finding 或形状不符/缺 charter 且无法从属性发现派生/`concurrency` 在场却 `kind=pure`/`--attempts` 非正整数或**低于被测路径下限**/`--run-id` 追加 `-a<k>` 后超 40 字符/`replayCommand` 含 tab 或换行/`gate.rounds` 形态不符/`--from-results` 内无 `property-finding` 附件或多发现未以 `--property` 选定） | 按 Usage 与 COMMANDS.md；spec/契约问题按错误消息修正 `--spec` 或先生成 HTTP 契约；report 载荷按「e2e report」节的输入契约修正 |
| 3 | 环境未就绪（引擎不在矩阵、端点解析失败、服务未起、锁文件缺失、web 显式端口被占用；V 校验载荷无 per-run 隔离栈可用；**replay 基础设施错误**——脚本 exit 2 或签名 errorClass=infrastructure：连接失败/超时/服务不健康，**不是「未复现」**） | 按错误内嵌修复命令（多为 `devenv up`/`devenv build`；端口占用时报占用者并给替代命令）；replay 基础设施错误先按证据（logs/ 与 run.json）修运行环境再重放；**report 的环境档同此**——共享基础设施未起/镜像未绑定/健康等待失败属 3；注意区分：门禁**轮次内**脚本自述基础设施错误（exit 2 或 `errorClass=infrastructure`）归 **8**（那一轮没有缺陷复现证据，门禁不过），不是 3 |
| 4 | 任务失败（test/lint/typecheck/build/verify 非零；拉取失败；快照采集期工作树持续变化——明确拒绝，不出混合内容；生命周期 CLI 无 END 行的异常退出（容器/构建问题，子进程码入终值 `taskRc`）；op 路径越界/载荷非 base64/应用中途失败——工作区全量还原；**replay 未复现**——含「环境漂移或已修复？」语义反转提示；**replay 多轮失败签名不一致或缺失**——不是同一断言处因同一原因失败；replay 已复现但产物导出失败） | 看 stderr 完整输出；采集拒绝时暂停文件修改后重试；replay 未复现先判读是环境漂移还是已修复（修复确认走 #111 confirm-fix），签名不一致核对各轮 `replay.json` 的 signature 与脚本约定标记；**report 任务失败**——引擎无 END 行的异常退出（容器/构建问题，子进程码入 `taskRc`）、op 路径越界/载荷非 base64/应用中途失败（工作区全量还原）、计划协议不完整（缺 ID/replayCommand/脚本字节）、载荷暂存或树 tar 打包失败） |
| 5 | 超时（健康等待/镜像拉取） | `devenv logs <svc>` 排查；prefetch 重跑续跑 |
| 6 | 独占锁或栈使用租约冲突（另一会话持锁 / 测试运行中；含生命周期写锁 `e2e-lifecycle-<wt>`） | 等待或确认持有者已死（失效锁与失效租约会自动清理）；错误消息列出持有者与修复线索 |
| 7 | 生命周期校验失败（索引/注解/编号/diff 级；**由 #116 登记**，本表留位） | 见 #116 |
| 8 | 状态转移/前置条件不合法（**#109 已登记：`e2e report` 复现门禁未过或前置不符——零登记**）：① 轮次低于被测路径下限（pure 1 / external-state ≥3）；② 任一轮未复现（`replayCommand` exit≠0）；③ 任一轮 `errorClass=infrastructure`（环境故障不是缺陷复现）或脚本 exit 2；④ 任一轮 `errorClass=unknown`（证据不足档**永不过门禁**，不得伪装成确定分类）；⑤ 任一轮无失败签名（脚本未按约定打 `NE-E2E-SIGNATURE` 哨兵行）；⑥ 多轮签名比对不符（不是同一断言处因同一原因失败）；⑦ 键空间不独立（各轮 run id / 库 / bucket / 队列须互异）；⑧ 缺明确前置状态声明；⑨ 实测脚本与登记脚本 sha256 不符（门禁证的不是入库那份复现面）；⑩ 编号或脚本位已被占用（重跑取号）。后续票沿用本码：重复毕业/退役后毕业（#110/#116） | **工作区零改动**（全有或全无）。读 stderr 拒绝原因与终值 `gate.reason`（机器可消费）；核对各轮 `.artifacts/e2e/<run-id>/replay.json` 的 `signature`/`verdict`/`keySpace`；基础设施档先按证据修运行环境再重报；签名不符核对脚本约定标记与断言是否被弱化；编号被占用重跑 `report` 重新取号（跨 worktree 撞号由 #116 renumber 收敛） |
| 9 | 毕业校验运行判定不符（op 协议 V 载荷：expect=fail 却通过 / expect=pass 却失败）——**工作区零落盘**（全有或全无） | 读 stderr 拒绝原因与 `verdict` 事件（did-not-fail/still-failing）；核对缺陷是否已修或环境漂移，重跑校验运行 |
| 10 | 缺陷不存在或 schema 不符（未知 `DEF-NNNN`、记录 JSON 解析失败、zod 判别联合校验失败、ID 形态非法；**replay 复现脚本缺失** `apps/e2e/replay/<ID>.mjs`、`replayCommand` 含 tab/换行——脚本随记录入库是长期重建依据，事实源完整性同档拒绝） | 核对 `apps/e2e/defects/` 下记录与 `apps/e2e/replay/` 下脚本；按 stderr 给出的字段路径修正记录（schema 见 `apps/e2e/src/defect/schema.ts`）；**report 同档**——事实源树内有非法记录（取号/编号占用核对前即拒，零资源创建）、DEF 编号容量耗尽（DEF-0001..DEF-9999） |
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
（仅 `GITHUB_ACTIONS=true` 的 CI 托管上下文）在矩阵内；CI 上下文的 moby 还须
**amd64**（CI 矩阵条目：Docker Engine/moby + compose v2 + amd64——架构不符
exit 3，compose v2 由 doctor `compose-plugin` 检查项校验）；裸 Linux + moby
开发环境未验证、不声称支持（exit 3）；未识别引擎 exit 3。doctor 与每条命令
报告实际端点 + 引擎身份/版本/架构，不特判跳过。

## 镜像引用与可配置 DB 镜像

- `devenv/images.lock` 是上游镜像 **tag + digest 双层锁**的唯一事实源
  （`NODE_IMAGE` / `DB_IMAGE` / `DB_IMAGE_MACOS` / `REDIS_IMAGE` / `RUSTFS_IMAGE` /
  `PLAYWRIGHT_IMAGE`）；升级只改锁文件，一律走 PR + 验证。`PLAYWRIGHT_IMAGE`
  的 tag 版本必须与 `pnpm-workspace.yaml` catalog 的 `@playwright/test` 严格一致
  （静态门禁交叉核对；不一致即停止构建）。
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

## CI 同构质量门（#71，Spec-工程基座 §6）

- **同一入口**：本地与 CI 经同一 `devenv verify`（lint + typecheck +
  test:unit）与同一 `devenv test`（集成，需先 up）——CI 不自带第二套校验器。
- **workflow**：`.github/workflows/quality-gate.yml`；触发 pull_request /
  push(dev) / workflow_dispatch；`runs-on` 固定 `ubuntu-24.04`（升级须重新验收，
  doctor 步骤每次运行记录 `/etc/os-release` 实际系统版本）；执行段预算
  `timeout-minutes: 30`。
- **CI 顺序（先快后慢）**：doctor（CI 矩阵条目校验 + 实际运行时报告 + workflow
  静态门禁自检）→ verify（无服务；首跑内含快照构建）→ up → test（集成）→
  取证 → 拆栈（down）。本票不含 e2e/复现轨道接入（归 Spec-e2e 体系后续票）。
- **失败/取消分层（如实）**：普通失败先取证再拆栈——取证步骤 `!cancelled()`
  （含取证失败不掩盖原失败：`continue-on-error`），拆栈步骤 `always()`；
  取消（cancelled）拆栈尽力收尾、不保证完成；运行器强制终止（含超时被杀）
  无保证，临时资源随 VM 消亡，不写绝对保证。
- **取证产物**：`ps -a` / `status` / 全部服务 `logs`（不带服务名，带前缀、
  拓扑演进不漏采）/ `doctor` 输出（全部经 devenv 采集）落
  `.artifacts/ci/<run-id>-<attempt>/`（与 e2e run 产物同规的 per-run 证据区），
  经 upload-artifact 留存（30 天），供普通失败路径的现场诊断与验收归档。
- **workflow 静态门禁**（doctor `ci-workflows` 检查项）：`.github/workflows/`
  中直接调用 compose（docker compose / docker-compose / podman compose /
  podman-compose）即拒绝（exit 3），指明文件+行号；本地与 CI 同一校验器。
  离线反例测试：`devenv/test/ci-offline.test.sh`（`devenv test:devenv` 的
  组成部分）。**诚实口径**：这是 workflow 文件内的静态反例拦截，不阻止人在
  终端手动绕过 devenv，不声称已阻止（Spec §6 同款声明）。

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
| test / test:unit / verify / lint / typecheck / seed / explore（运行期） | stack-<wt> 共享租约（per-worktree） | 多个租约可并行；与上述排他命令双向互斥（读者遇排他锁等待/exit 6）。explore 从起 per-run 资源到回收全程持租约，`down`/`migrate` 等不会中途拆掉 run 的共享基础设施 |
| prefetch | prefetch（机器级） | 跨 worktree 互斥（基础镜像拉取）；冲突等待或 exit 6（重跑续跑） |
| e2e build / explore 的执行器镜像构建 | e2e-image-<wt>（排他，per-worktree；仅构建/核对窗口） | 与其它 e2e 执行器镜像构建互斥（状态文件/可变 tag 读改写串行化）；不取栈锁/租约，无锁序环；冲突等待/exit 6 |
| e2e 生命周期写命令（#106：e2e registry rebuild；#109：e2e report 的**登记阶段**；后续 graduate/confirm-fix/retire/renumber） | e2e-lifecycle-<wt>（排他，per-worktree，**mkdir 目录锁**，从取锁到 op 应用结束持同一把） | 本 worktree 内生命周期写命令彼此互斥（校验与写入之间无间隙）；与栈锁/租约正交（决策命令不做栈变更），无锁序环；跨 worktree 互不阻塞（合入时校验兜底：撞号 renumber/索引一致性/diff 级）；冲突等待 60s 或 exit 6。V 校验载荷所在的 per-run 运行另持 stack-<wt> 共享租约与 run 所有权锁 |
| explore 启动/运行所有权 | e2e-owner-<wt>-<runid>（排他，per-run-id，创建资源前取得 → 回收结束释放）；e2e-admit-<wt>（短临界区） | 同 run id 的第二个进程在启动窗口等待/exit 6，绝不进入清理路径破坏对方尚未启动的资源；admission 锁串行化「取得所有权 → 计数 → 登记」，并发计数含启动中预留名额；锁名与容器 worktree 标签含 worktree 后缀，跨 worktree 同名显式 run id 互不误判 |
| e2e replay（#108，运行期；每轮 attempt 一个独立 run） | stack-<wt> 共享租约（从起 per-run 资源到最后一轮回收全程）；每轮 e2e-owner-<wt>-<runid> + e2e-admit-<wt>（与 explore 同一准入/所有权机制）；e2e-image-<wt>（仅镜像构建/核对窗口） | 与 explore 同口径：多个 run 可并行（受 `E2E_MAX_CONCURRENT_RUNS` 硬上限，含启动预留），与 down/restart/migrate 等排他意图双向互斥（等待/exit 6）；同 run id 第二个进程启动窗口即拒，绝不进入清理路径；**不取生命周期写锁 `e2e-lifecycle-<wt>`**——replay 只读事实源（门禁回填归 #109 report、修复确认归 #111 confirm-fix），与生命周期写命令无互斥；轮次间串行（上一轮回收结束才起下一轮键空间） |
| e2e report（#109；门禁轮次运行期 + 登记临界区） | **门禁轮次**：stack-<wt> 共享租约（从起 per-run 资源到最后一轮回收全程）+ 每轮 e2e-owner-<wt>-<runid> / e2e-admit-<wt>（与 explore/replay 同一准入与所有权机制）+ e2e-image-<wt>（仅镜像构建/核对窗口）；**登记阶段**：e2e-lifecycle-<wt> 排他写锁（取锁 → 引擎判定 → op 原子应用结束持同一把） | 门禁轮次与 explore/replay 同口径：多 run 可并行（受 `E2E_MAX_CONCURRENT_RUNS` 硬上限，含启动预留），与 down/restart/migrate 双向互斥（等待/exit 6）；同 run id 第二个进程启动窗口即拒；轮次间串行（上一轮回收结束才起下一轮键空间——**独立键空间是门禁的硬要求**，同库重复重放会撞唯一约束伪装成未复现）。**锁序：stack 共享租约 → lifecycle 排他写锁**（无反向持有者：registry rebuild 只取 lifecycle 锁不取栈锁，故无环）；登记阶段与同 worktree 其它生命周期写命令互斥（冲突等待 60s 或 exit 6，零落盘）。取号在 plan 阶段（只读，不持写锁），登记阶段重核编号占用——被占用即 exit 8 要求重跑，跨 worktree 撞号由合入时 renumber 收敛 |
| build / gen 触发的 lockgen | lockgen（机器级） | 跨 worktree 互斥（共享标签/容器清理）；冲突等待或 exit 6（重跑即续） |
| 只读（ps/logs/status/images/doctor/gen evidence/e2e runs/e2e logs/e2e defect show·list·next-id） | 无 | 任意并发（gen evidence 只读绑定镜像内的证据文件，不重建、不触栈；e2e logs 只读容器日志；e2e defect 查询只读事实源，经 stdin tar 进容器，零落盘） |
| exec / shell（透传调试） | 无 | 交互时长无界，不持租约；需要稳定环境时先结束调试再拆栈 |

### 栈使用租约（#61）

- **语义**：读者（test/test:unit/verify/lint/typecheck/seed/explore）在运行期持
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
  与 lockgen 构建经 `--build-arg TOOLS_IMAGE=<内容寻址别名 tag>` 绑定基础镜像
  （`natural-enforcement/tools:imm-<64hex>`——tag 名内嵌 tools 镜像自身 ID，
  不可变语义与 ID 等价；#71：BuildKit 不支持 FROM 裸 ID，见 lib/stack.sh）；workspace 镜像 label `devenv.base.image` 记录
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
  `ready`（sha256/bytes）。**重试期间状态保持 `pending`**（前端继续轮询），
  仅 BullMQ 最后一次尝试失败才写 `failed`——避免“首次失败、重试成功”造成
  `failed → ready` 而 UI 停在 failed。队列名可用 `EVIDENCE_QUEUE_NAME` 注入
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

## e2e 隔离并行 run（#70）

**目标**：两条（或多条）e2e run 共享基础设施容器，但数据环境与后台处理完全隔离；
被测 API/worker 自身绑定本 run 资源，而不是只给测试脚本换名字。

**拓扑与数据级隔离**：

- 基础设施共享：`db` / `redis` / `rustfs` 由 dev 栈提供（`devenv up` 后，
  基础设施容器跨 run 共享）。`explore` 运行期持 **共享栈使用租约**（#61）——
  `down`/`restart`/`migrate` 等排他意图等待或 exit 6，不会中途拆栈/迁移。
- 每 run 独立数据环境（命名按各存储系统规则分别净化，超长截断 + 短哈希保唯一）：
  - 数据库：`e2e_<run-id>`（`[A-Za-z0-9_]`，≤63 字节；`DROP ... WITH (FORCE)`
    幂等重建 + `prisma migrate deploy`）；
  - bucket：`e2e-<run-id>`（小写字母数字+连字符，3–63，首尾字母数字）；
  - 队列键空间：`e2e-<run-id>-evidence-processing`（BullMQ 6 队列名禁 `:`，
    前缀用 `-`；worker 只消费本 run 队列名）。
- **服务绑定**：per-run 的 `api` / `worker` / `web` 容器经 `devenv/compose.e2e.yaml`
  启动（独立 compose 项目 `<worktree-project>-e2e-<run-id>` + per-run external
  网络），启动时注入本 run 的 `DATABASE_URL` / `S3_BUCKET` / `EVIDENCE_QUEUE_NAME`；
  基础设施容器以别名 `db`/`redis`/`rustfs` 接入该网络，不复制基础设施。
- **连接池与并发上限**：per-run API/worker 注入 `DATABASE_POOL_MAX`（默认 2/进程），
  满足"池 × 并发 < max_connections"；`E2E_MAX_CONCURRENT_RUNS`（默认 4）为硬上限，
  计数 = 本 worktree 存活的活动所有权锁（**含已登记但尚未起容器的启动预留**），
  超限在启动窗口拒绝（exit 6）。两个参数均可用同名环境变量显式覆盖。
- 零宿主端口保持：浏览器/执行器都在容器内网访问本 run 的 `web`/`api`。

**执行器镜像**：

- `devenv/e2e.Dockerfile` 基于 `images.lock` 的 `PLAYWRIGHT_IMAGE`（tag+digest，
  manifest-list）；`devenv e2e build` 从固定输入快照构建并登记不可变 image ID
  （**独立状态文件 `.devenv-state/e2e-image.env`**：`E2E_SNAPSHOT_HASH`/`E2E_IMAGE_ID`/
  `E2E_PLAYWRIGHT_IMAGE`；与 workspace 的 `workspace-image.env` 分离，#70），
  命中快照/版本时复用。
- **版本严格一致**：`PLAYWRIGHT_IMAGE` tag 版本必须等于 catalog 的
  `@playwright/test`（静态门禁交叉核对）；构建期再核对实际安装版本（不一致即停止）。
- 运行参数：`--init` + `ipc: host`（Chromium /dev/shm）+ 官方镜像浏览器。

**产物与登记册**：

- 执行器产物（Playwright JSON/HTML/trace/video）落 per-run 命名卷，运行结束经
  `docker cp` 导出宿主 `.artifacts/e2e/<run-id>/`；`run.json` 记录本 run 的
  数据库/bucket/队列、per-run 容器清单、workspace/执行器/Playwright 镜像绑定与统计。
- `.devenv-state/e2e-runs/<run-id>.json` 是运行登记册（status/live/资源坐标），
  `devenv e2e runs` 可读；异常退出标记 `aborted`。
- 回收：只清理带 e2e 前缀且属于本 run 命名空间的资源（库/桶/队列键空间）；
  开发库与开发 bucket 永不进入候选集（`delete-bucket` 脚本再次强制 `e2e-` 前缀）。

**探索语义**：`devenv explore` 的测试失败按**产出/任务失败**处理（退出码 4 +
产物路径 + 日志），提示**先读证据判读是「探索发现」还是「环境/服务绑定故障」，
不要未经判读就改测试栈**；不是把测试栈当故障直接修。
基础前置（基础设施未起、镜像构建失败、健康超时）仍按 3/4/5 报错。

**P0 属性探索（#107）**：fast-check 属性引擎在探索轨道内运行
（`apps/e2e/tests/explore/properties/`，不新增轨道），失败语义不变（exit 4 = 发现，
retries 0，不掩盖）。属性命名口径 `P0/<RULE-ID>/<slug>`（规则标识 EV-STATE/EV-NAME/
EV-BYTES/PT-GEO/PT-BOUND/PT-NAME；`charter` 字段为探索任务书联动预留位，认领机制归
#114）。属性违规时结构化反例以附件进入 `results.json` 该用例 `results[].attachments[]`
（`name=property-finding`，`body=base64(JSON)`：property/rule/charter/seed/counterexample/
counterexamplePath/numRuns/numShrinks[/request]），report（#109）可机械提取 seed+反例
登记与重放；绿跑时每个属性用例另带 `property-run` 摘要附件（seed/numRuns）。
`E2E_FORCE_FINDING=1` 同时触发故意反例属性夹具（properties/harness-selfcheck）；
`E2E_CHARTER_GAPS=1` 启用非默认「规则缺席」缺口探针（charter 发现素材，编码缺席规则，
不参与默认绿跑；本票不修 api 规则）。

**并行演练入口**：`E2E_PARALLEL_GROUP=<组标记> E2E_PARALLEL_SOAK_MS=<毫秒> devenv explore --run-id ...`
把共享组标记与等待窗口传入执行器；两个 run 用同组标记并行运行，隔离 charter 会在
等待窗口内反复读本 run 数据面并断言同组其它 run 的数据不出现（默认 0 = 单 run 不等待）。
失败语义验收钩子：`E2E_FORCE_FINDING=1 devenv explore --run-id ...` 让自检用例故意
失败，用于复现「失败=产出/任务失败 + 先判读再动手」的报告与产物路径。

## e2e 生命周期事实源与决策引擎（#106）

**事实源分层（Spec-e2e §3）**：

- 每缺陷一个**入库** JSON 记录 `apps/e2e/defects/DEF-NNNN.json` 是生命周期唯一事实源，
  永不删除（退役也留档）；完整性锚在入库记录与 git 历史。schema 归 e2e 包
  （`apps/e2e/src/defect/schema.ts`，zod 按引擎判别联合），不入共享契约包。
- 目录表达轨道归属：`defects/` 事实源、`replay/DEF-NNNN.mjs` 零第三方依赖复现脚本
  （exit 0 = 复现）、`tests/repro/` 复现轨道、`tests/repro/_drafts/` 草稿区（CI 不收集）。
- **注册表是派生缓存**：`apps/e2e/.registry.json`（`.gitignore` 排除，不入库）。
  `devenv e2e registry rebuild` **始终重建**；与事实源漂移只 `WARN` + `registry.rebuilt`
  事件（`drift=yes|no`），**不作硬门禁**——原型实证「漂移即红」会死锁（校验失败时
  不重写缓存 → 下次必报漂移 → 永远红）。后续票的校验器（#116）沿用同一语义。
- `DEF-NNNN` 取号：本地 max+1（按 `defects/` 文件名集合，坏记录仍占号），不填洞
  （断号是校验器违规项）；`--remote` 经 `devenv gh` 叠读远端已有编号（best-effort，
  失败只 WARN 回退本地）。撞号由后合入方机械重排（#116）。

**纯决策引擎 + op 行协议（Spec-e2e §10）**：

生命周期 CLI（`apps/e2e/src/cli.ts`，容器内 `node apps/e2e/dist/main.js`）**不落盘**：

1. 宿主树（`apps/e2e/{defects,replay,tests}` + 既有 `.registry.json`）经 **stdin tar**
   只读进容器 `/tmp/in`（无 bind 架构的读取通道；容器侧无宿主写通道）。
2. CLI stdout = 协议行，stderr = 人类可读摘要：
   - `W\t<relpath>\t<base64(utf8)>` 写文件（relpath 相对 `apps/e2e`）
   - `D\t<relpath>` 删文件
   - `V\t<id数字段>\t<expect:fail|pass>\t<base64>` 校验运行载荷
   - `END\t<status:ok|error>\t<code>\t<message>` 终值（每次调用恰一行，最后输出）
   查询命令（`defect show|list`、`next-id`）的数据行直接走 stdout（非协议行），
   宿主转发/包装为终值 JSON（`defect`/`defects`/`id` 字段）。
3. devenv **宿主侧原子应用**（`lib/e2e-lifecycle.sh`）：先 V（真跑一次，判定不符 →
   **exit 9 零落盘**）→ 再 END（`status=error` → 透传引擎声明的码，**零落盘**）→
   再 W/D（路径守卫 + 载荷预解码 + 既有文件备份；任一步失败**全量还原**）。
   V 载荷经宿主 `apps/e2e/.verify-run/` 生成后 tar 注入执行器，用
   `playwright.verify.config.ts`（testDir 在 repro/explore 树之外）真跑。
4. 原型坑收口：`set -e` + 命令替换会吞掉 END 行诊断——**先捕获 rc 再判协议**：
   有 END 行按协议拒绝（透传码 + 消息透出 stderr/终值 `reason`）；无 END 行 =
   容器/构建问题（映射 exit 4，子进程码入终值 `taskRc`，不外逸枚举）。

**输出与退出码**：查询/重建均为结构化命令（`--json` 时 stdout 只有 JSONL：引擎/
新鲜度事件 + `registry.rebuilt` 等 + 终值）。生命周期**拒绝**（END error / V 判定
不符）先发终值事件 `status:"failed"`（`exitCode` = 9/10/引擎声明码，`reason` = 拒绝
原因）再以该码退出（与 explore 发现同口径）；用法/环境/锁冲突走 `die`（无终值事件，
见输出协议节）。退出码 9/10 已登记；7/8 由 #116/#109 登记。

**并发**：写命令持 per-worktree `e2e-lifecycle-<wt>`（mkdir 目录锁，**非 flock**）
从取锁到应用结束；查询只读不取锁。跨 worktree 并发由合入时校验兜底（撞号 renumber、
索引一致性、diff 级）。详见并发语义表。

## e2e replay 重放与失败签名原语（#108）

**命令语义（Spec-e2e §4）**：`devenv e2e replay <ID>` 是**诊断与修复确认共用**的
重放命令——任何时点可用，起隔离栈真跑记录内 `replayCommand`：

- **exit 0 = 复现**（全部轮次脚本 exit 0）；
- **exit 4 = 未复现** + 语义反转提示「环境漂移或已修复？」（修复后重放语义自动反转；
  修复确认摘注解走 #111 `confirm-fix`，记录与脚本永不删除）；
- **exit 4 = 多轮失败签名不一致或缺失**（各轮都复现但不是「同一断言处因同一原因失败」）；
- **exit 3 = 基础设施错误**（脚本 exit 2 或签名 `errorClass=infrastructure`）——
  环境故障**不是**「未复现」，先按证据修运行环境；
- **exit 10 = 缺陷不存在 / 记录 schema 不符 / 复现脚本缺失**（计划阶段即拒，零资源创建）。

**per-run 编排复用（不复活原型单项目 compose/profile）**：`e2e_derive_names` →
`lease_acquire stack-<wt>` → `require_services db redis rustfs` → `ensure_fresh_workspace`
→ `e2e_build_image` → 每轮 `e2e_admission_begin`（所有权 + 并发上限）→ `e2e_connect_infra`
→ `e2e_db_purge` + `e2e_migrate` → `e2e_stack_start` → 执行器内跑脚本 → 签名提取 →
产物导出 + `run.json` → `e2e_teardown` → 登记册终态 → 释放所有权锁。

**每轮独立键空间（强制）**：run id = `<base>-a<k>`（base 默认 `rep-<wt>-<epoch>-<rand>`，
可 `--run-id` 覆盖；追加后缀后仍须 ≤40 字符）。replay **会写数据**：同库重复 attempt
撞 `name` 唯一约束（409）会伪装成「未复现」，故每轮独立库/bucket/队列 + 幂等
`DROP FORCE` 重建 + `migrate deploy`，保证「每次从明确前置状态开始」（Spec-e2e §5）。

**轮次预算**：默认 1 轮（诊断/修复确认）；`--attempts N` 显式多轮。门禁下限由
`replay-plan` 按被测路径输出（`pure`=1 / `external-state`=3），**门禁实测与回填归
#109 report**，本命令只读事实源、不改记录。

### replayCommand 约定（脚本随记录入库，长期重建依据）

- **零第三方依赖**：只用 node 内建（`fetch`/`process`），`node apps/e2e/replay/<ID>.mjs`；
  执行器注入 `E2E_API_BASE_URL=http://api:3000`（per-run 服务绑定）。
- **退出码**：`0` = 复现（缺陷在场）；`1` = 未复现（语义反转）；`2` = 基础设施错误
  （连接失败/超时/服务不健康，路径根本没被行使）。
- **失败输出约定（签名可机械提取）**：无论复现与否，在 stdout 打**一行**

  ```
  NE-E2E-SIGNATURE {"schemaVersion":1,"assertionId":"<稳定断言标识>","errorClass":"assertion|infrastructure|locator|unknown","outcome":"reproduced|not-reproduced|unknown","semanticMarkers":[{"key":"<语义维度>","value":"<规范化取值>"}]}
  ```

  - `assertionId`：脚本作者选定的**稳定结构标识**（如 `post-enforcement-points.whitespace-name`），
    不含消息措辞、不含行号；
  - `semanticMarkers`：只放**关键语义维度**（`http.status.expected` / `http.status.actual` /
    `body.id` / `error.code` …），**不放完整响应体或错误消息文本**；
  - 复现时标记承载缺陷的语义取值（供门禁逐轮比对）；未复现时承载**实际观测值**
    （比对不符即语义反转）；基础设施档 `outcome` 可为 `unknown`；
  - 多条标记取**最后一条**（脚本终态）；无标记 → 签名为 `null`（**不编造**），
    单轮仍按退出码判定，多轮则无法机器判「同一原因」→ exit 4。

### 失败签名模型与比对原语（#109 门禁 / #112 CI 共用）

签名 = **错误类别 + 断言标识 + 关键语义标记**，**不绑定完整消息文本**
（`apps/e2e/src/signature/`，纯函数库、零基础设施；入库形态见
`apps/e2e/src/defect/schema.ts` 的 `graduation.failureSignature`）：

```json
{"errorClass":"assertion","assertionId":"tests/repro/def-0001.spec.ts#DEF-0001 NUL 名引发 500#a1","semanticMarkers":[{"key":"actual","value":"500"},{"key":"expected","value":"< 500"},{"key":"matcher","value":"toBeLessThan"}]}
```

- **错误类别**（Spec-e2e §7「只把有证据支持的分类当确定事实」）：
  `infrastructure`（连接失败/超时/服务不健康）→ 判定引擎直接红；
  `locator`（找不到元素/多命中）→ 红 + 标明「需人判断是 UI 改版还是缺陷」；
  `assertion`（expect 结构可解析）→ 普通断言失败；
  `unknown`（证据不足以分类，如测试自身 throw 的自由文本）→ **保守档，不得据此判绿**。
- **断言标识**：Playwright 来源 = `file#describe路径 > 测试标题#断言序号`（取最后一次
  失败 result，重试终态为准）；replay 来源 = 脚本自述的稳定标识。两来源各自命名空间，
  比对在**同来源内**进行（门禁比 replay 轮次，CI 比毕业 verify-run 证据与本次结果）。
- **语义标记**：`{key,value}` 结构，按 key→value **集合**比对（书写顺序无关，
  `canonicalizeSignature` 规范化）。Playwright 来源取 `matcher` 链与 `Expected:`/`Received:`
  结构化取值（**先剥 ANSI 颜色码**——JSON reporter 的 message 带码，真实证据实证），
  自定义消息措辞一律丢弃。
- **语义敏感性**：合法重构改错误消息措辞 → 三要素不变 → 仍判同一失败（不红）；
  断言弱化（预期状态码 500→400）→ `expected` 标记不符 → 红。
- **比对原语**：`compareSignatures(a,b)` → `{matched,reason,differences[]}`；
  `compareSignatureSet(baseline,candidates)` → `{allMatched,reason,results[]}`。
  任一侧签名缺失 → 不匹配（无证据不得当同一失败）；零轮次 → `allMatched=false`。
  判定矩阵（绿/红/待判断）归判定引擎（#112），本原语只回答「是否同一失败」。
- **引擎入口**（容器内 `node apps/e2e/dist/main.js`，载荷走 **stdin**，不是 #106 的树
  tar 通道）：`signature extract --source replay|playwright`、`signature compare`
  （stdin `{baseline,candidates}`）；结果恒为**单行紧凑 JSON** 数据行 + `END` 终值。
  宿主桥 `devenv/lib/e2e-replay.sh` 复用 #106 的 END/数据行解析与「先捕获 rc 再判协议」
  收口（无 END = 容器/构建问题 → 4，子进程码不外逸枚举）。

**产物**：每轮 `.artifacts/e2e/<run-id>/`（`replay.out` 脚本 stdout = 签名载荷、
`replay.err`、`replay.json` 本轮判定/退出码/签名、`run.json` 运行清单、`logs/` 服务日志）
+ 运行登记册 `.devenv-state/e2e-runs/<run-id>.json`（`track=replay`）。
`run.json.playwrightExitCode` 字段名沿用既有清单形状，对 `track=replay` 承载的是
**replayCommand 退出码**（权威逐轮记录在 `replay.json.scriptExitCode`）。

**输出协议**：长命令 JSONL（`step.started/completed target="e2e database"|"replay"`、
`replay.signatures`）+ 终值单行 JSON（`command/subcommand/status/exitCode/defectId/
replayCommand/kind/gateMinAttempts/attempts/reproduced/signatureMatched/compareReason/
hint/runs[]`）。脚本原始输出与人类诊断走 **stderr**，结果流纯 JSONL。

## e2e report 实测复现门禁与缺陷登记（#109）

**命令语义（Spec-e2e §5 / GLOSSARY「复现门禁」）**：`devenv e2e report` 把探索发现
登记为标准缺陷报告，**门禁由命令实测回填而非自查申报**：起隔离栈跑发现载荷内的
`replayCommand` N 次，逐轮采集失败签名并比对，过门禁才登记。
**次数是检查预算不是证明**——跑够 N 次不等于过门禁，每轮都须从明确前置状态开始、
真的复现、且在**同一断言处因同一原因**失败。

### 输入契约（发现载荷 finding payload）

`--finding <file.json>` 是唯一必填输入。两个来源同一契约（`source` 区分 provenance）：

```jsonc
{
  "schemaVersion": 1,
  "source": "property-finding" | "agent-session" | "manual",
  "title": "…", "summary": "…",            // 必填
  "charter": "point-input-safety",          // 可省：property-finding 从 finding.charter 派生
  "suspectedArea": "packages/contracts/src/enforcement-point.ts",
  "layer": "api" | "ui" | "package",
  "severity": "low" | "medium" | "high" | "critical",
  "engine": "fast-check" | "schemathesis" | "visual" | "model-journey" | "monkey" | "agent-session",
                                            // 可省：property-finding 默认 fast-check，其余默认 agent-session
  "discoveredAt": "ISO8601Z", "discoveredBy": "who",   // 可省：宿主填实测时刻 / --by（NE_AGENT→USER→unknown）
  "finding": { … },                         // 来源载荷；source=property-finding 时**必填**且强校验
  "reproducibility": {
    "kind": "pure" | "external-state",      // **按被测路径**分类，不是按引擎
    "precondition": "每轮开始前的明确前置状态声明",   // 必填（缺失 → exit 8）
    "replayScript": "<零第三方依赖脚本源码>",        // 必填：源码而非路径（门禁在登记前实测）
    "replayCommand": "node apps/e2e/replay/{ID}.mjs", // 可省；{ID} 由取号结果替换
    "concurrency": { "triggerOrder": ["…","…"], "timing": "…", "preservedBy": "…" }  // 可省
  },
  "evidence": [{ "type": "json-report", "uri": ".artifacts/e2e/<run-id>/results.json" }],  // 可省，只存 URI
  "sanitized": true                         // 可省，默认 true
}
```

- **属性发现**（`source=property-finding`）：`finding` 即 #107 harness 写入 Playwright
  `results.json` 的 `property-finding` 附件载荷（`property/rule/charter/seed/counterexample/
  counterexamplePath/numRuns/numShrinks[/request]`）。`seed`/`counterexamplePath` 无损进
  `reproducibility.seed`/`path`，`counterexample`（收缩后最小反例）+ `request`（方法大写进
  契约枚举，二进制走 `bodyBase64`）进 `reproducibility.counterexample`——毕业机械转写的输入。
  `--from-results <results.json>` 由命令自己提取该附件（多发现须 `--property NAME` 选定，
  **不静默取第一个**），并把 `source` 定型为 `property-finding`。
- **agent 会话 / 手工发现**（`source=agent-session|manual`）：`finding` 为自由 JSON 证据
  载荷（session sheet 摘录等），不强制属性形状。机械引擎（`fast-check`/`schemathesis`）
  仍须携带反例，否则拒绝登记（判别联合的判别载荷）。
- 载荷 schema 不符 → **exit 2** 并给字段路径（输入契约违规，不是事实源损坏）。

### 门禁分类与每轮前置状态

| kind | 轮次下限 | 键空间要求 | 判据 |
|---|---|---|---|
| `pure`（纯函数/无外部状态） | **1** | 单轮（无从跨轮比对 → `signatureMatched=null`，**不是 true**） | 该轮复现 + 签名属证据承载档 |
| `external-state`（依赖外部状态/并发） | **≥3** | **每轮独立 run id → 独立库/bucket/队列**（run id / 库 / 桶 / 队列名各维度均须互异） | 每轮复现 + 逐轮签名与基线（首轮）比对全一致 |

每轮前置状态由 #70 机制**实测建立**：`DROP DATABASE … WITH (FORCE)` + `CREATE` →
`prisma migrate deploy` 至最新 → 空 bucket → 空队列键空间，**无种子数据**。
载荷的 `precondition` 是**声明**，`gate.rounds[].precondition` 是宿主实测建立的状态，
二者互为证据。轮次间**串行**（上一轮回收结束才起下一轮键空间）。

`--attempts N` 只可**上调**预算；低于路径下限 → exit 2（不得下调检查预算）。

### 失败签名与保守档

脚本须按 #108 约定在 stdout 打**一行** `NE-E2E-SIGNATURE <compact JSON>`
（`schemaVersion/assertionId/errorClass[/outcome]/semanticMarkers`，只放语义维度，
**不放完整消息文本**）。退出码约定：**0=复现 / 1=未复现 / 2=基础设施错误**。
逐轮经 `apps/e2e/src/signature/` 同一原语比对（本地与 CI 同一判定器）：

- `errorClass=assertion`：证据承载档（语义标记来自 matcher/expected/actual）。
- `errorClass=locator`：可承载证据，但 `gate.needsHumanJudgment=true` 留痕——
  **需人判断是 UI 改版还是缺陷**（Spec §7；判定矩阵的红/绿归 #112 CI 判定器）。
- `errorClass=infrastructure`：**门禁不过**（环境故障不是缺陷复现）→ exit 8。
- `errorClass=unknown`：**永不过门禁**（证据不足以分类，不得伪装成确定事实）→ exit 8。
- 无哨兵行 → `signature=null` → 门禁不过（无证据不得判同一失败）→ exit 8。

### 并发缺陷：保留触发顺序与时序（约定）

并发缺陷的 `replayCommand` **必须保留触发它的操作顺序与时序条件**，使第三个会话能
独立复验。约定：

1. 载荷声明 `reproducibility.concurrency`：`triggerOrder`（逐步操作顺序，脚本须按此序
   执行）、`timing`（并发窗口/延迟/soak 时长等**可复验**描述）、`preservedBy`（脚本如何
   保留，可选）。声明在场 ⇒ `kind` 必为 `external-state`（并发必然依赖外部状态），
   否则 exit 2。
2. 脚本内**不得**把有序触发改写为无序并发或省略等待：顺序与延迟是反例的一部分，
   不是实现细节。时序参数经 env 注入时须把实际取值打进签名语义标记（如
   `concurrency.soakMs`），使「时序条件变了」表现为签名不符而非静默通过。
3. 每轮仍在**独立键空间**重放同一触发序列——并发缺陷的门禁不是「同库反复触发」，
   而是「互不影响的数据环境里重复同一时序触发」。
4. 声明与脚本随记录入库（`reproducibility.concurrency` + `replay/<ID>.mjs`），
   长期可重建。

### 登记产物与落账事务

过门禁 → **同一事务**经 op 行协议宿主侧原子应用（全有或全无）：

- `apps/e2e/defects/<ID>.json`：`status=reported`，`reproducibility.gate` 回填
  `attempts/keySpaces/allFailed/signatureMatched/rounds[]/precondition/baselineSignature/
  compareReason/measuredAt/scriptSha256[/needsHumanJudgment]`；`evidence` 逐轮指向
  `.artifacts/e2e/<run-id>/replay.json` 与 `logs/api.log`（**只存 URI**，证据本体不入库）。
- `apps/e2e/replay/<ID>.mjs`：零第三方依赖复现脚本，**与实测所用字节同一份**
  （`gate.scriptSha256` 绑定；不符 → exit 8）。脚本随记录入库，是长期重建依据。
- `apps/e2e/.registry.json`：派生缓存同事务重建（不入库，漂移仅 WARN）。
- 运行登记册 `.devenv-state/e2e-runs/<run-id>.json`：登记成功后写回 `defectId` +
  `gateRole=report-gate-round`（记录 ↔ run 可互查；`track=report`）。
  **门禁不过零登记，亦不留缺陷关联。**
- `issue` 字段**留空**作 tracker 回链位（过门禁 → needs-triage 的写入归 #114）。
- 编号：`defect next-id` 同口径（本地 max+1，`--remote` 经 `devenv gh` 叠读远端 best-effort，
  失败只 WARN 回退本地）；登记阶段重核编号/脚本位占用，被占用 → exit 8 要求重跑。
- **不自动 commit**：记录与脚本需要同一 commit 入库（由实施者/PR 落）。

### 引擎桥与三段式

决策引擎（`apps/e2e/src/cli.ts` 的 `report plan|register|finding-from-results`）在容器内
运行、**不落盘**。report 既需事实源树（取号/编号占用核对/缓存重建）又需发现载荷，故
`lib/e2e-report.sh` 把**树 tar 与载荷同一 stdin 通道**送进容器：载荷作为 tar 成员
`.report-payload.json`，容器内解包到 `/tmp/in` 后以该成员为 stdin exec 引擎
（`--root /tmp/in`）。#108 的无状态签名桥（只送载荷）不足以承载 report。

实测轮次的脚本注入：脚本此时**尚未入库**，宿主把计划输出的脚本字节（base64 数据线）
解码到临时暂存目录，经 stdin tar 注入执行器 overlay 的**入库路径**
`/workspace/apps/e2e/replay/<ID>.mjs`，再行使同一条 `replayCommand`——无 bind 架构下
「实测的就是登记后那条命令」。

**输出协议**：长命令 JSONL（`step.started/completed target="report gate"|"e2e database"|
"report gate round"|"report register"`，逐轮 `verdict=reproduced|not-reproduced|
infrastructure`，登记 `verdict=registered|gate-failed|refused`）+ `--json` 终值单行 JSON
（`command/subcommand:"report"/status/exitCode/defectId/kind/attempts/minAttempts/
registered/recordPath/replayPath/remoteNumbering/gate{…}/runs[]/reason/hint`）。
非 `--json` 模式 stdout 为空，人类摘要走 stderr。脚本原始输出与诊断走 **stderr**。

**退出码**：0 登记成功 | 2 用法/输入契约 | 3 环境未就绪 | 4 任务失败（容器/落盘）|
5 超时 | 6 锁/租约冲突 | **8 门禁未过或前置不符（零登记）** | 10 事实源损坏。
