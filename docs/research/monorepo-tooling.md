# Research：Monorepo 工具链选型（pnpm workspaces / Nx / Turborepo）

- 子票：#4（Research-monorepo工具链选型调研）
- 日期：2026-11-16
- 服务对象：「Grilling-monorepo布局与契约共享」票（目录约定素材见第 5 节，可直接引用）
- 评价主轴：**AI-native / agent DX**（任务编排确定性、缓存对 agent 的实际价值、输出噪声、安装/维护成本、与 NestJS/Vite/Playwright 多 app 的配合）
- 项目约束回顾（来自地图 #1）：宿主机只存代码、devenv 唯一入口、一切经命令行/agent 执行（无 IDE）、多 agent 并发是常态、WSL2/Linux 一等公民。

## 时点版本基线（2026-11-16 实查）

| 工具 | 当前版本 | 状态 |
| --- | --- | --- |
| pnpm | 12.21.0（npm registry 实查）[S1] | 主线活跃；`tasks` 任务编排 + `pipeline` 实验性任务运行器已入主线 [S5][S6] |
| Nx | v24（2026-10-21 发布；v24.1.0-beta.1 于 2026-11-13 发布）| 每 6 个月一个大版本（4 月/10 月），前一大版本转 LTS 12 个月 [S18] |
| Turborepo | 2.11.11（2026-11-11 发布，canary 极活跃）| 官网自我定位已改为 "the build system for coding agents" [S9][S11] |
| @nx/nest / @nx/vite / @nx/playwright | 均 24.0.6 | 与 Nx 主版本 lockstep 维护 [S23] |

先澄清一个前提：**这不是三选一的互斥选项**。Turborepo 与 Nx 都是「包管理器之上的任务编排层」，两者都以 pnpm workspaces 为基座运行；真正的决策是：

- 方案 A：pnpm workspaces 裸用（编排靠 `pnpm -r` + `tasks`，缓存靠实验性 `pnpm pipeline`）
- 方案 B：pnpm workspaces + Turborepo
- 方案 C：pnpm workspaces + Nx

## 1. 结论先行

**推荐方案 B：pnpm workspaces（含 catalogs + tasks）作为依赖与任务声明基座，叠加 Turborepo 作为任务编排/缓存层。Nx 暂不引入，保留明确的重评估触发条件（见第 4.4 节）。**

核心理由（AI-native 视角，详细论证见第 3、4 节）：

1. **agent 可完整推理的最小确定性表面**：turbo 的编排契约就是 `turbo.json` + 各包 `package.json` scripts——两者都是 agent 天然善于读写的纯数据文件；默认 `--env-mode=strict` 密封环境变量、哈希覆盖 lockfile 与任务定义、输出必须显式声明 [S12][S13]。Nx 的项目图/任务配置大量来自插件推断，推理链对 agent 是黑盒（需走 Nx 自己的 MCP/skill 才能可靠获取）。
2. **为多 agent worktree 并发而生**：Turborepo 2.8 起本地缓存自动跨 git worktree 共享 [S13][S15]；Nx 22.7 也有同等能力 [S20]。但本项目（wayfinder 流程本身就在 worktree 中并行开 agent 会话）与 turbo 的这一投入方向完全同构，且 turbo 的 agent 专项（Agent Skill、`turbo docs`、任务 `description` 字段、llms.txt/agents.md 机器可读文档面 [S15][S16]）是当前唯一把「agent 是一等用户」写进产品身份的编排工具 [S11]。
3. **输出噪声与失败语义可控**：`--output-logs` 五档 + `--dry=json` 预演计划 + `--continue` 分级 + 「取最高退出码」[S12]；`--summarize` 落盘 JSON 运行摘要 [S12]。
4. **缓存归属与成本**：Vercel Remote Cache 全计划免费，也可按开放 API 规范自托管（含 HMAC 签名工件）[S14]；Nx 的远程缓存/分布式执行/Self-Healing CI 绑定 Nx Cloud（Hobby 免费 5 万 credits/月，自托管仅 Enterprise）[S22]。pnpm `pipeline` 的远程缓存甚至直接兼容 Turborepo Remote Cache API [S6]——互为退路。
5. **维护成本低**：turbo 2.x 语义稳定多年、单一 Rust 二进制、无 daemon；Nx 每 6 个月一个大版本 + 插件 lockstep 升级 + daemon，维护面大（由 agent 承担也得花 token）[S18][S20]。

裸 pnpm（方案 A）只作基座不作编排层：普通 `pnpm -r run` 无缓存 [S5]；`pnpm pipeline` 虽已具备 affected 选择、inputs/outputs/env 声明、跨 worktree 状态、甚至 Turborepo 兼容远程缓存，但官方标注 **experimental**，watch 模式明言是 proof of concept [S6]——把项目编排押在实验特性上不符合「快速失败、确定性」的项目不变量。

## 2. 对比矩阵

评分：◎ 强 / ○ 可用 / △ 弱（附来源编号）。

| 维度 | A：pnpm workspaces 裸用 | B：pnpm + Turborepo | C：pnpm + Nx |
| --- | --- | --- | --- |
| 安装成本（容器内） | ◎ 零额外（包管理器本身必需） | ○ 一个 devDep（Rust 二进制） | ○ devDep + `@nx/*` 插件族 + daemon |
| 编排配置表面 | ○ `pnpm-workspace.yaml` 的 `tasks`（dependsOn/`^`）[S5] | ◎ `turbo.json`（声明式、每任务可带 `description`）[S15] | △~○ nx.json + 项目配置 + 插件推断（隐性配置多） |
| 任务图确定性 | ○ 拓扑排序默认；循环即 `ERR_PNPM_TASK_CYCLE` 快速失败 [S3][S5]；但 `--parallel` 会静默丢弃图约束 [S5] | ◎ 默认 strict env-mode（未声明 env 不可见）[S12]；哈希含 lockfile、任务定义、globalDependencies [S13] | ◎ 同级 + **task sandboxing**：追踪真实文件 I/O，越界访问标记违规、缓存条目记为不可信 [S20] |
| 本地缓存 | △ `pnpm -r run` 无缓存 [S5]；仅 `pipeline` 有（experimental）[S6] | ◎ 成熟；日志随缓存回放 [S13] | ◎ 成熟；恢复 1110 个任务 17s→1.16s [S20] |
| 跨 git worktree 缓存共享 | △ pipeline 的 cargoTargetDir 提及 worktree [S6]，任务缓存未明示 | ◎ 2.8 起自动共享 `.turbo/cache` [S13][S15] | ◎ 22.7 起 worktree-aware caching [S20] |
| 远程缓存 | ○ pipeline 兼容 Turborepo API（12.12.0+，签名工件）[S6]，实验性 | ◎ Vercel 全计划免费 / 自托管开放规范 + 社区实现 [S14] | ○ 绑定 Nx Cloud（Hobby 免费 5 万 credits/月；自托管仅 Enterprise）[S22] |
| 机器可读输出 | ○ `--report-summary`（JSON 文件）、`--aggregate-output`、`pipeline --dry-run --json` [S4][S6] | ◎ `--dry=json`（任务计划）、`--summarize`（.turbo/runs JSON）、五档 `--output-logs` [S12] | ◎ `--outputStyle summary` **是 AI agent 驱动时的默认值**；CI 默认 `static-failures-only` [S19] |
| agent 专项能力 | △ 无（通用 CLI 而已） | ◎ Agent Skill、`turbo docs`、AGENTS.md 托管块（agentGuidance）、llms.txt/agents.md、版本化文档子域 [S15][S16] | ◎ Nx MCP server（docs/运行任务输出/CI 诊断；部分工具需连 Nx Cloud）、`nx configure-ai-agents` [S21] |
| 代码生成/约束 | △ 无 | △ 无（靠脚本与 lint 自建） | ◎ generators、module boundaries、`nx migrate` [S20][S21] |
| NestJS 配合 | ◎ 标准模式即可（见 3.5） | ◎ 工具无关，scripts 即契约 | ◎ @nx/nest 24.0.6 [S23] |
| Vite 配合 | ◎ | ◎ | ◎ @nx/vite 24.0.6 [S23] |
| Playwright 配合 | ○ 分片靠 CI matrix 手工 [S28] | ○ 同左；e2e 任务建议 `cache:false` | ◎ @nx/playwright + 分布式分片（Nx 自家博客）[S23][S24] |
| 维护节奏 | ◎ 随 pnpm 演进 | ◎ 2.x 语义长期稳定 | △ 6 个月一个大版本、LTS 12 个月、插件 lockstep [S18] |
| 退出成本 | —（基座） | 低：pnpm `tasks`/`pipeline` 可渐进承接 [S5][S6] | 中：生成物与配置深度耦合，`nx migrate` 迁移 [S18] |

## 3. Agent DX 视角分析

### 3.1 任务编排确定性

agent 改完代码后跑什么、按什么顺序跑、什么情况下会得到与上一次不同的结果——这是编排工具对 agent 的核心承诺。

- **Turborepo**：默认 `--env-mode=strict`——任务只能看到显式声明的环境变量（外加 PATH/SHELL 等系统必备），杜绝「机器环境差异导致缓存污染」这类 agent 最难自诊的问题 [S12]。缓存键 = 全局哈希（任务定义、根 lockfile、globalDependencies、globalEnv）+ 包级哈希（inputs 文件集、包 lockfile 变化、package.json）[S13]。`--dry=json` 输出完整执行计划（taskId、hash、command、inputs、outputs、依赖），agent 可先验计划再执行 [S12]。注意：独立任务间的执行顺序不保证（并发本质），失败语义分级（`--continue=never|dependencies-successful|always`），退出码取全程最高值——agent 解析失败无需猜 [S12]。
- **Nx**：唯一提供**缓存正确性验证**的工具——task sandboxing（22.6 起）追踪每个任务的真实文件读写，读越界/写越界记为违规，违规的缓存条目不再被信任，可用 `sandboxing-config.yaml` 白名单预期行为 [S20]。这是对「agent 改了未声明的输入导致假缓存命中」的最强防线（Nx 官方同时声称 Turborepo/Lerna/Rush「盲信你的配置」——属厂商口径，但其机制差异属实 [S20]）。代价：daemon 常驻（虽已从 1.6GB 降到约 200MB [S20]），CI 中通常需显式关闭以保证行为可复现。
- **pnpm**：`tasks.dependsOn` 支持 `^build` 依赖语义，拓扑就绪即调度，循环依赖直接 `ERR_PNPM_TASK_CYCLE` 快速失败 [S5]；`concurrencyGroups`（12.5.0+）可跨 pnpm 进程限流同名任务组、任务优先级（12.6.0+）[S5]——对「多 agent 共享一台 devenv 容器同时跑任务」的资源仲裁是贴心设计。弱点：`--parallel`/`--no-sort` 会静默忽略 tasks 图 [S5]，agent 传错标志得不到警告；无 env 密封机制。

**小结**：确定性保障 Nx（sandboxing）> Turborepo（strict env + 全量哈希）> pnpm 裸用；但 turbo 的确定性是「数据文件里看得见」的，Nx 的一部分在运行时机制里（agent 需理解插件推断才能预测行为）。

### 3.2 缓存对 agent 的实际价值

agent 的工作循环是「改动→验证→再改动」，验证频率远高于人类；且本项目多 agent 并行（各自 worktree）。缓存价值体现在三层：

1. **同 worktree 迭代**：三者都有本地缓存（pnpm 仅 pipeline 有 [S5][S6]）。turbo 命中即回放日志（agent 能看到上次运行的输出）[S13]。
2. **跨 worktree 并行 agent**：turbo 2.8+ 自动共享主 worktree 的 `.turbo/cache`，新 worktree 首跑即全命中 [S13][S15]；Nx 22.7 worktree-aware caching 同能力 [S20]。这正对本项目的多会话 worktree 工作流（本票自身就在 worktree 中执行）。
3. **跨机器/CI**：turbo 走 Vercel Remote Cache（全计划免费）或按开放 OpenAPI 规范（v8 端点）自托管，支持 HMAC-SHA256 签名工件（验签失败按 miss 处理），社区有多个开源 server 实现 [S14]。Nx Cloud 远程缓存免费额度 5 万 credits/月，缓存命中成本约为跑一次 5 分钟任务的 1/200，但自托管仅 Enterprise [S22]。pnpm pipeline 的远程缓存（12.12.0+）直接兼容 Turborepo Remote Cache API，且「服务不可达不失败」[S6]。

**风险与对冲**：缓存假命中是 agent 时代的新事故类别。turbo 的防线是 strict env + 显式 outputs（未声明的输出不会被缓存/恢复 [S13]）；Nx 的防线是 sandboxing [S20]。对冲惯例：凡依赖运行时状态的任务（连 PostGIS/Redis/rustfs 的集成测试、Playwright e2e）一律 `cache: false`，只有纯函数式任务（lint、typecheck、build、单测）进缓存——这应写进目录约定（见 5.3）。

### 3.3 输出噪声

无 IDE、无人类盯屏的仓库里，输出是 agent 的唯一反馈通道。噪声 = token 成本 + 关键信息稀释。

- **Turborepo**：`--output-logs = full | hash-only | new-only | errors-only | none` 五档；`--summarize` 把运行元数据（受影响包、任务耗时/哈希、缓存工件文件）写成 `.turbo/runs` 下的 JSON，官方明确建议用它排查 glob/cache miss [S12]。agent 日常组合：先 `--dry=json` 看计划，跑时 `--output-logs=errors-only`，失败后重跑单任务取 full。
- **Nx**：`--outputStyle` 有 8 种，其中 `summary`（只打印计数 + 每个失败任务一行）**是「AI agent 驱动 Nx 时」的默认值**，CI 默认 `static-failures-only` [S19]——Nx 会检测自己是否被 agent 驱动并自动切换输出风格，这是当前最激进的 agent 输出适配。TUI/Dynamic 等交互式风格对 agent 无效（容器内更应显式避开）。
- **pnpm**：`--aggregate-output`（并行输出整段收齐再打印）、`--report-summary`（写 `pnpm-exec-summary.json`：每任务 passed/queued/running/skipped/failure + 时长 + 错误详情）、`--reporter-hide-prefix`（CI 严格格式场景）[S4]；GitHub Actions 下有专门的分组输出适配 [S4]。可用但档位少一档「只看新任务」（turbo 的 new-only 对缓存重的仓库降噪明显）。

### 3.4 安装/维护成本

- **pnpm 裸用**：零额外工具。但「裸」的完整形态（tasks + pipeline）横跨多个 12.x 小版本引入（pipeline 12.4.0、concurrencyGroups 12.5.0、优先级 12.6.0、远程缓存 12.12.0）[S5][S6]，且 pipeline/watch 标注 experimental / proof of concept [S6]——依赖实验面本身就是维护成本。
- **Turborepo**：单 devDep；`turbo.json` 是唯一编排事实源；2.x 语义多年稳定；2.9 起任务图计算提速 81-91%（千包仓库 8.1s→0.716s，TTFT 11x）[S17]；2.11 还内置 `setup` 命令可校验和锁定工具链版本（Node/pnpm/Go/Rust/uv/Python，写 turbo.lock）[S10]——容器内工具链由镜像锁定时此项冗余，但可作为二道防线。文档全面 markdown 化（任意 URL 加 `.md`、版本化文档子域、`turbo docs` CLI 检索）[S15][S16]，对「无 IDE、agent 自助排障」的仓库是真省维护。
- **Nx**：6 个月一个大版本、上一版 LTS 仅 12 个月、所有 `@nx/*` lockstep 同版本 [S18]；升级靠 `nx migrate`（2026 路线图还在做 agent 化迁移与 agent 自治、synthetic monorepos 等 [S26]）。平台能力（generators、boundaries、DTE、Self-Healing CI）确实是三者最强，但每一项都在扩大「需要被理解和维护的表面」。

### 3.5 NestJS / Vite / Playwright 多 app 配合

- **NestJS**：官方 monorepo mode 是 nest-cli.json 自管的一套 workspace 机制（apps 无独立 package.json、依赖集中在根）[S25]，与包管理器 workspaces 是两条路，**不建议混用**。本项目走「每个 NestJS app 标准模式 + pnpm workspace 包」：`nest build`/`nest start` 按包正常工作，契约共享走 `packages/contracts` + `workspace:*`。@nx/nest（24.0.6 [S23]）提供的 generators/execution 对 agent 有加速价值，但引入它就要接受插件 lockstep。
- **Vite**：零特殊配合需求，任何方案下都是普通 script。@nx/vite 额外提供 vitest 集成与缓存 [S23]。
- **Playwright**：分片（`--shard` + CI matrix + 报告合并）是工具无关能力 [S28]。turbo/pnpm 下由 CI 矩阵手工编排；Nx 侧 @nx/playwright + Nx Agents 可自动分发分片 [S24]（需 Nx Cloud）。本项目 e2e 是「独立执行器应用 + 基础设施共享/数据级隔离」，任务本身不宜缓存（见 5.3），所以 Nx 的分片分发优势在本项目初期不构成决定权重。

### 3.6 与本项目硬不变量的适配

| 不变量 | 方案 B（推荐）的适配方式 |
| --- | --- |
| devenv 唯一入口 | devenv 内部封装 `turbo run ...`；人类/agent 只见 devenv 命令面；turbo 与 pnpm 全部容器内运行 |
| 容器内多 agent 并发 | worktree 缓存共享（同机同卷）+ 各任务并发上限（`--concurrency`，默认 10 [S12]）由 turbo 统一仲裁 |
| 无 IDE | 不依赖 Nx Console/TUI/图可视化；turbo 全部能力经 CLI + JSON；文档 agent 可自助检索 [S15][S16] |
| 快速失败/幂等 | strict env + 显式 outputs + 最高退出码语义 + `--dry=json` 预演 [S12][S13] |
| WSL2 一等公民 | pnpm/turbo/nx 均为 Linux 原生；性能敏感的 turbo 是 Rust 二进制 [S17] |

## 4. 推荐与理由

### 4.1 推荐

**pnpm workspaces（catalogs + tasks 声明）+ Turborepo 2.11.x。**

pnpm 侧职责：依赖安装、workspace 链接（`workspace:*`）、版本一致性（`catalog:`）、跨进程任务组限流（`concurrencyGroups`，可选）。turbo 侧职责：任务编排、缓存（本地 + 跨 worktree + 可选远程）、执行计划预演、输出降噪。

### 4.2 理由汇总

1. AI-native 匹配度：turbo 是当前唯一以 agent 为产品身份中心的编排工具（"build system for coding agents" [S11]，2.8 agent 专项 [S15]，Vercel 自家用 agent 开发 turbo 本身 [S17]），其投入方向与本项目形态同构。
2. 确定性可见性：契约全部落在 `turbo.json`/`package.json` 纯数据文件，agent 可直接推理与修改；strict env-mode 默认密封 [S12]。
3. 多 agent worktree 并发的一等支持（2.8+ [S13][S15]），与本项目流程（含本票执行方式）一致。
4. 远程缓存无厂商锁定：免费 Vercel 或按开放规范自托管 [S14]；pnpm pipeline 兼容同一 API [S6]，未来两条退路（去 turbo 化 / 去 pnpm 化）都开着。
5. 维护预算（1 人类 + agent 团队）下维护面最小：无大版本跑步机、无 daemon、无插件 lockstep。
6. NestJS/Vite/Playwright 全部走各框架原生 CLI，不引入包装层；e2e 双轨任务的 `cache:false` 语义清晰。

### 4.3 反方观点（为什么不选另两个）

- **不选 Nx（现在）**：优势真实（sandboxing [S20]、agent 默认 summary 输出 [S19]、MCP [S21]、generators/DTE [S24]），但 (a) 远程能力绑定 Nx Cloud，自托管仅 Enterprise [S22]，与「容器内闭环、可选断网」的偏好相悖；(b) 6 个月大版本 + 插件 lockstep [S18] 是持续税；(c) 配置推断层降低 agent 直接推理能力，且其 MCP/图可视化部分价值依赖 IDE/Cloud 生态，本项目无 IDE。若触发 4.4 条件再评估——Nx 可在 pnpm workspace 上增量引入，沉没成本低。
- **不选裸 pnpm（作编排层）**：`pnpm -r run` 无缓存 [S5]；pipeline 能力面已接近 turbo-lite（affected、inputs/outputs/env、dry-run JSON、签名远程缓存 [S6]）但官方标注 experimental，watch 是 proof of concept [S6]。作为**基座**保留其 `tasks` 声明与 turbo 语义对齐，为将来可能的「去 turbo」留手（见 5.2 的双声明策略）。

### 4.4 重评估触发条件（写给未来的 SPEC 维护者）

出现任一条件时重开调研票：

1. 仓库规模增长到需要代码生成器/模块边界强约束（跨 app 契约漂移靠 lint 已压不住）；
2. 需要 CI 分布式分片执行 Playwright（单机 e2e 时长成为瓶颈）且接受 Nx Cloud；
3. 缓存假命中事故频发，需要 sandboxing 级验证（或 turbo 出等价能力）；
4. `pnpm pipeline` 转正（脱离 experimental）且覆盖 watch/dev 场景——届时可评估撤掉 turbo 减一层依赖。

## 5. 目录约定素材（供 Grilling 票直接取用）

### 5.1 目录树

```
natural-enforcement-prj/
├─ pnpm-workspace.yaml        # packages 通配 + catalogs（第三方版本唯一事实源）+ tasks（与 turbo 语义对齐，见 5.2）
├─ pnpm-lock.yaml
├─ turbo.json                 # 任务编排唯一事实源：缓存/outputs/env/description
├─ package.json               # 根仅放工具 devDeps 与委托脚本（"build": "turbo run build"）
├─ devenv/                    # devenv 封装（compose 细节对人类/agent 不可见，地图硬不变量）
├─ apps/
│  ├─ web/                    # React+Vite+RTK Query+AntD+Tailwind（@ne/web）
│  ├─ api/                    # NestJS+Prisma（@ne/api，标准模式，不用 nest monorepo mode）
│  └─ e2e/                    # Playwright 独立执行器应用（@ne/e2e，探索/复现双轨）
├─ packages/
│  ├─ contracts/              # @ne/contracts：前后端共享契约（TS 类型 + schema），唯一被 apps 双向依赖的共享包
│  └─ tsconfig/               # @ne/tsconfig：共享 tsconfig bases
├─ docs/
│  ├─ research/               # 调研报告（本文件）
│  ├─ adr/                    # 单上下文决策记录（含本票结论的 ADR 引用）
│  └─ agents/
├─ GLOSSARY.md
└─ AGENTS.md                  # turbo agentGuidance 托管块 + 项目级 agent 规则
```

命名约定：所有 workspace 包 `@ne/*`；apps 与 packages 以目录区分职责（可运行产物 vs 被依赖库）。

### 5.2 配置样例（双声明策略）

`pnpm-workspace.yaml`（节选）：

```yaml
packages:
  - apps/*
  - packages/*

catalog:
  typescript: ^6.0.0
  "@nestjs/core": ^11.x          # 以 2026-11 实际锁定版本为准
  react: ^19.x
  vite: ^7.x

# 与 turbo.json 语义对齐（为 pnpm pipeline 时代留的对称面；见报告 4.4-4）
tasks:
  build:
    dependsOn: [^build]
  test:
    dependsOn: [build]
  typecheck:
    dependsOn: [^build]
```

`turbo.json`（节选，展示本报告主张的全部分约定）：

```jsonc
{
  "$schema": "https://turborepo.dev/schema.json",
  "agentGuidance": true,          // turbo 检测到 agent 时维护 AGENTS.md 托管块 [S16]
  "ui": "stream",
  "globalEnv": ["NODE_ENV"],
  "globalDependencies": [".env.example"],
  "tasks": {
    "build": {
      "description": "产出生产构建产物（类型检查 + bundle）",   // 给 agent 读的任务自描述 [S15]
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]                                     // 未声明的输出不会被缓存 [S13]
    },
    "typecheck": {
      "description": "仅 tsc --noEmit，零副作用",
      "dependsOn": ["^build"],
      "outputs": []
    },
    "test": {
      "description": "单元测试（纯函数式，可缓存）",
      "dependsOn": ["build"],
      "outputs": ["coverage/**"]
    },
    "e2e:explore": {
      "description": "e2e 探索轨：依赖共享基础设施 + 独立数据键空间；不可缓存",
      "cache": false,                                            // 运行时状态依赖任务一律不缓存
      "env": ["E2E_KEYSPACE", "DATABASE_URL"]
    },
    "e2e:repro": {
      "description": "e2e 复现轨：从探索轨毕业的用例回放；不可缓存",
      "cache": false,
      "env": ["E2E_KEYSPACE", "DATABASE_URL"]
    },
    "dev": {
      "description": "持久开发服务（turbo watch / 长驻）",
      "cache": false,
      "persistent": true
    }
  }
}
```

根 `package.json` scripts 只做委托：`"build": "turbo run build"`、`"test": "turbo run test"`、`"e2e": "turbo run e2e:explore e2e:repro"`——人类与 agent 的入口统一到同一命令面，再由 devenv 整体封装。

### 5.3 命令面与 agent 用法约定（写进 AGENTS.md 的素材）

| 场景 | 命令 |
| --- | --- |
| 预演执行计划（先看再跑） | `turbo run <task> --dry=json` [S12] |
| 日常验证（降噪） | `turbo run lint typecheck test --output-logs=errors-only` |
| 全量失败收集 | `turbo run build test --continue`（退出码取最高值）[S12] |
| 只跑受影响（对标 affected） | `turbo run test --filter=...[origin/dev]` [S12] |
| 缓存/哈希排查 | `turbo run <task> --summarize` 后读 `.turbo/runs` JSON [S12]；`turbo docs "<关键词>"` 查官方文档 [S15] |
| 强制绕过缓存复跑 | `turbo run <task> --force`（读禁写不禁）[S12][S13] |

硬约定：

1. 依赖运行时状态的任务（e2e、集成测试）必须 `cache: false`；可缓存任务必须显式声明 `outputs` 与 `env`。
2. 每个任务必须写 `description`（agent 的任务语义来源）[S15]。
3. 版本一致性走 `catalog:`，禁止在包里手写重复版本范围 [S7]。
4. 契约共享只经 `@ne/contracts` + `workspace:*`；apps 之间互不依赖。
5. NestJS 不用 nest-cli 的 monorepo mode（与 workspace 模型冲突 [S25]）。

### 5.4 留给 Grilling 票的问题清单

- `apps/e2e` 是否拆为 `apps/e2e-runner`（执行器）+ `packages/e2e-cases`（用例库，复现轨可独立引用）？
- contracts 包内 schema 技术选型（zod / OpenAPI 生成 / tRPC）——影响 build 任务依赖拓扑，未在本票范围。
- devenv 封装层对 turbo 的包装粒度（透传参数 vs 固定命令面）。
- CI 质量门的任务集与 `--continue` 策略（首版建议 lint+typecheck+test+build 全收集）。

## 6. 来源

版本与状态：

- [S1] pnpm 最新版本（npm registry）：https://registry.npmjs.org/pnpm/latest（12.21.0）
- [S9] turbo npm 最新版本：https://www.npmjs.com/package/turbo（2.11.11）
- [S10] Turborepo GitHub Releases（2.11.8-2.11.11 变更，setup/turbo.lock、WebMCP、watch 改进）：https://github.com/vercel/turborepo/releases
- [S18] Nx 版本节奏与支持策略（v24 Current 2026-10-21；半年一个大版本；LTS 12 个月）：https://nx.dev/docs/reference/releases
- [S23] @nx/nest / @nx/playwright / @nx/vite（均 24.0.6，npm registry）：https://registry.npmjs.org/@nx/nest/latest 、https://registry.npmjs.org/@nx/playwright/latest 、https://registry.npmjs.org/@nx/vite/latest

pnpm：

- [S2] pnpm 过滤器（git 选择器、merge-base、catalog 感知，v12.7.0 起）：https://pnpm.io/filtering
- [S3] pnpm recursive（拓扑排序默认、bail 语义、workspace-concurrency 容器配额感知）：https://pnpm.io/cli/recursive
- [S4] pnpm run（--stream/--aggregate-output/--report-summary/--reporter-hide-prefix、tasks 设置提及）：https://pnpm.io/cli/run
- [S5] pnpm workspace 任务编排（tasks/dependsOn/^、concurrencyGroups v12.5.0、优先级 v12.6.0、--parallel 丢弃图、pipeline 独占缓存）：https://pnpm.io/workspace-task-orchestration
- [S6] pnpm pipeline（v12.4.0+ 实验性：frozen install、affected、inputs/outputs/env 缓存键、--dry-run --json、Turborepo API 兼容远程缓存 v12.12.0+、watch 为 PoC）：https://pnpm.io/cli/pipeline
- [S7] pnpm catalogs：https://pnpm.io/catalogs
- [S8] pnpm workspaces（workspace: 协议、linkWorkspacePackages、injectWorkspacePackages）：https://pnpm.io/workspaces

Turborepo：

- [S11] Turborepo 官网定位 "the build system for coding agents" 与机器可读文档（llms.txt 等）：https://turborepo.dev
- [S12] turbo run CLI 参考（--output-logs 五档、--dry=json、--continue 分级与最高退出码、--summarize、--filter 语法、--concurrency 默认 10、--env-mode strict 默认、--force）：https://turborepo.dev/docs/reference/run
- [S13] Turborepo 缓存（全局/任务双哈希、outputs 必须声明、日志回放、worktree 共享 .turbo/cache、cache:false）：https://turborepo.dev/docs/crafting-your-repository/caching
- [S14] Turborepo 远程缓存（Vercel 全计划免费、自托管 OpenAPI 规范 v8、HMAC 签名、社区实现；页面更新于 2026-11-12）：https://turborepo.dev/docs/core-concepts/remote-caching
- [S15] Turborepo 2.8 发布（worktree 缓存共享、Agent Skill、markdown 文档/.md 路由/sitemap/版本化子域、turbo docs、任务 description）：https://turborepo.dev/blog/2-8
- [S16] Turborepo AI 指南（agentGuidance/AGENTS.md 托管块、agents.md 索引）：https://turborepo.dev/docs/guides/ai
- [S17] Turborepo 2.9（agent+沙箱驱动开发、任务图计算提速 81-96%、TTFT 11x、markdown profile）：https://vercel.com/blog/making-turborepo-ninety-six-percent-faster-with-agents-sandboxes-and-humans

Nx：

- [S19] nx run/run-many CLI（--outputStyle 8 种；summary 为 AI agent 驱动时默认、static-failures-only 为 CI 默认；--parallel 默认 3；--nxBail；nx reset 细分；--skipNxCache/--skipRemoteCache）：https://nx.dev/nx-api/nx/documents/run
- [S20] Nx 22.7 发布（task sandboxing 22.6：I/O 追踪/违规/不可信缓存/sandboxing-config.yaml；worktree-aware caching；daemon 内存 7x 下降；缓存恢复 17s→1.16s；nx show target；configure-ai-agents）：https://nx.dev/blog/nx-22-7-release ；沙箱机制文档：https://nx.dev/docs/kb/sandboxing
- [S21] Nx MCP server 参考（工具清单、minimal 模式、Nx Cloud 依赖项）：https://nx.dev/docs/reference/nx-mcp
- [S22] Nx Cloud 定价（Hobby 免费 5 万 credits/月；CI $99/月 beta；Team $29/月；自托管仅 Enterprise）：https://nx.dev/pricing
- [S24] Nx 测试分片技术博客（含 Playwright 分布式执行）：https://nx.dev/blog/test-splitting-techniques

生态与框架：

- [S25] NestJS monorepo mode（nest-cli.json 自管机制，与包管理器 workspaces 平行）：https://docs.nestjs.com/cli/monorepo
- [S26] Nx 2026 路线图（agent 自治、Self-Healing CI 演进、synthetic monorepos、任务分发；36M 月下载）：https://nx.dev/blog/nx-2026-roadmap
- [S28] Playwright 官方分片文档（--shard + CI matrix + 报告合并）：https://playwright.dev/docs/test-sharding
- [S27]（次要参考）第三方 Nx vs Turborepo 综述（共识：turbo 简单轻量、Nx 全家桶重）：https://www.js-obfuscator.com/article/35813579.html

---

*本报告由 agent 会话于独立 worktree（research/monorepo-tooling）完成；所有版本号与功能声明以 2026-11-16 可访问的官方主源为准。*
