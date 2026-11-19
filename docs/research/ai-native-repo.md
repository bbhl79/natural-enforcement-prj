# Research-AI-native 仓库工程实践调研

- 子票：#8（Map #1：工程基座与 e2e 体系 SPEC 制定）
- 日期：2026-11-16
- 调研方法：按 `research` 技能方法，以一手来源为主（官方规范/官方文档/仓库内文件原文），二手文章仅作佐证；所有关键结论附来源链接。

## 一、结论先行

针对"1 名人类指挥 + 多 agent 执行、无 IDE、devenv 单一入口、多 agent 并发同一环境"这种纯 agent 开发模式，业界（截至 2026-11）已收敛出四条成熟共识：

1. **AGENTS.md 已是事实标准**：超过 60,000 个开源项目采用，OpenAI Codex、Gemini CLI、Cursor、GitHub Copilot coding agent、Claude Code（作为 CLAUDE.md 回退）、Aider、goose 等全部主流工具支持；根级一份 + monorepo 按目录嵌套、"离被编辑文件最近者优先"。内容上的共识是**极简主义**：只写 agent 无法从代码本身推断的事实，核心是"命令表"（做什么 | 命令 | 期望退出码）。
2. **面向 agent 的命令入口共识形态 = "扁平受约束的参数输入 + 机器可解析的输出 + 明确的退出语义"**。输入侧：保持扁平子命令/参数，**不要**把输入改造成单个 JSON payload——Microsoft 的实测数据显示 JSON 输入使成本升至 4–11 倍、小模型正确率显著下降；输出侧：`--json`（单对象）/ JSONL 事件流（长任务）/ `--output-schema`（结构化终值）已成三大工具（Codex/Claude Code/Gemini CLI）的共同模式；退出侧：0/非 0 + 显式失败事件（如 `turn.failed`/`error`），并文档化"期望退出码"。
3. **并发协作的硬规则是"一 agent 一 worktree 一分支" + 原子认领**。共享工作目录被明确列为反模式（竞态、索引损坏、合并地狱）；任务认领必须是原子操作（对 assignee 字段的 compare-and-swap），仅靠"状态约定"（ready→in-progress）存在竞态；worktree 之外的真正冲突源是**共享基础设施**（端口、依赖目录、本地数据库、Docker 守护进程）——本项目"基础设施容器共享、数据级隔离"的既定方向与业界结论吻合，还差端口/键空间的自动分配。
4. **可验证性正从"信任 agent 自述"转向"确定性验证器 + 结构化证据 + 门禁"**。"不跑验证就打勾"（Optimistic Checkmark）被列为头号反模式，且必须用机械化手段（钩子/门禁）而非提示词禁止；成熟形态 = 确定性验证器在开 PR/结束会话前强制运行 + agent 只交证据（命令 + 输出）不交结论 + 独立评审者（未参与编写的 agent/subagent）+ LLM-as-judge 查"是否越权改动范围"。

对本研究最关键的一句判断（Adobe ACI 设计文档）：**"修不好就换个更强的模型"通常是接口设计问题——"The fix is not a better model - it is a better interface."** 本项目把一切交互压到 devenv 一个命令面上，等于把全部 agent 体验押在 ACI（Agent-Computer Interface）设计质量上，以下清单即围绕此展开。

## 二、各实践画像

### 2.1 AGENTS.md 及指令文件约定的成熟形态

**规范与采纳**（来源：[agents.md](https://agents.md/)）：

- 定位是"给 agent 看的 README"：README 给人，AGENTS.md 给 agent，内容为构建/测试步骤与约定。
- 官网列出 20+ 支持工具（Codex、Jules、Factory、Aider、goose、opencode、Zed、Warp、VS Code、Devin、Junie、Amp、Cursor、RooCode、Gemini CLI、GitHub Copilot coding agent、Windsurf、Augment Code 等）；称已被 60k+ 开源项目使用（openai/codex、apache/airflow 等），并由 Linux Foundation 旗下 Agentic AI Foundation 管理。
- **嵌套与优先级**："The closest AGENTS.md to the edited file wins; explicit user chat prompts override everything."（离被编辑文件最近的 AGENTS.md 优先；用户显式指令覆盖一切。）
- 无 schema、无必填字段，纯 Markdown；建议"活文档"持续维护；迁移期用符号链接兼容旧文件名。

**内容哲学：极简主义**（来源：[Claude Code Best Practices](https://code.claude.com/docs/en/best-practices)）：

- 只写三类内容：agent 无法自发现的**验证命令**（测试/typecheck/lint、如何跑单个测试）、**误导性区域**（像死代码但不是的目录、不要模仿的遗留模式）、**不在仓库里的团队决策**；"已经纠正过两次的事"必须写入。
- 不写 agent 读代码就能得到的东西（目录结构、架构、通用规范）；目标 200 行以内；"工作主要是删行"；用 `/doctor prompt-audit` 清理陈旧矛盾指令。
- 强调规则不该靠 IMPORTANT 大写维持——要么文件太长，要么该规则应改为无例外的钩子（机械化约束）。
- 发布流程等"团队程序"放 skills/按需加载文档，不塞 CLAUDE.md（渐进披露）。

**生态侧影**：

- Gemini CLI 把上下文文件做成**分层体系**（来源：[Gemini CLI 配置文档](https://geminicli.com/docs/reference/configuration)）：文件名可配置（`context.fileName` 可为 `["CONTEXT.md","GEMINI.md"]` 数组）；加载层级 = 全局 `~/.gemini/` → 项目根及其祖先目录（以 `.git` 为边界）→ 当前子目录（默认最多扫 200 个目录）；内容拼接进 system prompt，支持 `@path/to/file.md` 导入、`/memory show` 检查实际加载内容。Google 侧另有"Agent Rules"社区统一动议（[gemini-cli discussion #1471](https://github.com/google-gemini/gemini-cli/discussions/1471)）。
- Claude Code 已支持把 AGENTS.md 作为 CLAUDE.md 的回退（二手佐证：[explainx 分析](https://explainx.ai/blog/claude-code-agents-md-support-2026)）；社区比较文章的普遍建议是"迁移到 AGENTS.md 单一事实源、废弃工具私有格式"（[buildbetter 对比](https://blog.buildbetter.ai/agents-md-vs-cursorrules-vs-claude-skills-2026-comparison)）。
- 先驱案例 Aider 的 CONVENTIONS.md（来源：[aider conventions 文档](https://aider.chat/docs/usage/conventions.html)）：小 markdown 约定文件，`--read CONVENTIONS.md` 只读注入、可被 prompt caching 缓存，`.aider.conf.yml` 常驻加载。
- 真实仓库样例：block/goose 根目录 `.goosehints`（本调研经 GitHub API 取回原文），内容就是"crate 布局 + 功能该落在哪个 crate + `just generate-openapi` + 必须过 `cargo clippy --all-targets -- -D warnings`"——一篇极短的"新同事须知"，正是 AGENTS.md 推荐内容清单的活样本。

### 2.2 面向 agent 的命令入口与机器可解析输出

**三大 agent CLI 的无头模式约定**（均为一手文档）：

| 维度 | OpenAI Codex `codex exec`（[文档](https://learn.chatgpt.com/docs/non-interactive-mode)） | Claude Code `claude -p`（[headless 文档](https://code.claude.com/docs/en/headless)） | Gemini CLI `gemini -p`（[配置文档](https://geminicli.com/docs/reference/configuration)） |
| --- | --- | --- | --- |
| 单值结构化输出 | `-o <path>` 写最终消息到文件；`--output-schema ./schema.json` 强制 JSON Schema | `--output-format json`（含 `result`、`session_id`、`total_cost_usd`）；`--json-schema` 生成 `structured_output` 字段 | `--output-format json`（stdout 单个 JSON 对象） |
| 流式事件 | `--json` → JSONL：`thread.started`/`turn.started`/`turn.completed`/`turn.failed`/`item.*`/`error`；`turn.completed` 带 token 用量 | `--output-format stream-json`（NDJSON）：`system/init`（会话元数据、`mcp_server_errors`）、`stream_event` 等 | `--output-format stream-json`（实时事件） |
| 进度/结果分流 | 进度走 stderr，stdout 保持干净可管道 | stderr 告警；stdout 是结果 | 同类设计 |
| 退出语义 | 0/非 0；`required=true` 的 MCP server 初始化失败则报错退出 | 0 成功/非 0 失败；SIGTERM→143；stdin 超 10MB 非零退出 | 0/非 0 |
| 会话续接 | `codex exec resume --last` / `resume <SESSION_ID>` | `--continue` / `--resume "$session_id"` | — |
| 输入管道约定 | 提示词为指令、管道 stdin 为上下文；`-` 表示 stdin 即全部提示词 | 管道 stdin/重定向 stdout；`jq -r '.result'` | 同类 |

**输入侧的实测反直觉结论**（来源：[Don't rewrite your CLI for agents — Microsoft DevBlogs, 2026-07](https://devblogs.microsoft.com/blog/dont-rewrite-your-cli-for-agents/)）：用合成 CLI `podctl`（30+ 嵌套参数）对 5 个模型各跑 5 次——扁平参数全模型 5/5 正确；单个 `--json` payload 下小模型正确率跌至 2/5、3/5，成本为参数模式的 **4–11 倍**（重试 + shell 转义税；PowerShell 上差距 9 倍、Bash 上缩到 1.5 倍）。结论："Keep your args… JSON never improved correctness and always increased cost."——**JSON 适合做输出契约，不适合做输入契约**。

**ACI 设计原则**（来源：[Adobe Mysticat AI-Native Guidelines — ACI Design](https://github.com/adobe/mysticat-ai-native-guidelines/blob/main/docs/04-configuration/aci-design.md)），五原则 + 审计清单，对 devenv 最直接可用：

- 核心论据：同一模型仅靠接口重设计，任务完成率 1.7% → 12.5%（引 SWE-agent 的 agent-computer interface 研究）。
- 五原则：约束搜索空间（结果上限、截断提示、查询至少两个限定词）；导航带状态（行号、"lines 150-250 of 800" 式位置指示）；动作点即时反馈（每次编辑后 lint，脚本 <5 秒、只针对变更文件、返回结构化输出）；**错误为 agent 而写**（`file:line` + 具体违规 + 怎么改）；**仓库自描述**（ADR、机器可读契约、引导脚本全在仓库内，关键上下文不落在 Slack/Confluence）。
- 渐进披露三层：Map（AGENTS.md，约 500–2000 token，会话开局）→ Module（按需 import，1k–5k）→ Detail（索取才给）；反模式：2000 行巨型 CLAUDE.md、全量 import。
- **命令文档表格化**："Action | Command | Expected exit code" 三列表，agent 据此自校验执行结果。

**业界已有的传统桩**：`git --porcelain`、`gh --json`、`docker --format` 等证明"默认人读、加旗标变机读"是最长寿的模式（本仓库 `docs/agents/issue-tracker.md` 已经全程用 `gh ... --json --jq`，即此模式受益者）。

### 2.3 任务分解、认领与并发协作规范

**Spec 驱动分解**（来源：[github/spec-kit](https://github.com/github/spec-kit)）：`/speckit-constitution → specify → plan → tasks → implement → converge` 斜杠命令流水线，产物沉淀在 `.specify/` 目录；bug 修复扩展的裁定只有 `verified`/`partial`/`failed` 三值，**只有 verified 算修好**；`converge` 显式输出 `Converged` 状态作为"代码与 spec 收敛"的机器可判定终点。——任务分解的产物（spec/plan/tasks）本身是仓库内文件，可被任意后续会话消费。

**多会话状态持久化**（来源：[Adobe Multi-Session Patterns](https://opensource.adobe.com/mysticat-ai-native-guidelines/02-lifecycle/multi-session-patterns/)）：

- 两阶段模式：initializer agent（一次）搭环境/脚手架/写 feature list/建 progress 文件；coding agent（多次）逐项实现、每项完成即 commit。
- `features.json`（机器可读任务清单）：显式状态机 `pending | in-progress | pass | fail`，记录完成会话；**"MUST NOT mark an item as pass without running its verification"**。分解粒度：每项一个会话内可完成（约 15–30 分钟 agent 工作量）、**独立可验证**、显式声明相互依赖；反例是"build the backend"式巨项。
- `progress.md`（决策/阻塞/下一步日志）：会话边界 = git commit；**会话收尾协议**（提交全部工作→更新清单→更新进度→push→跑完验证）；**会话启动协议**（确认 pwd/分支→读 progress→读 feature list→init.sh→基线测试→再动手）。
- 三大反模式：Amnesia Loop（不持久化状态，每会话重新发明决策）、Optimistic Checkmark（不打勾不验证）、Shared Worktree（多 agent 同目录"小心协调"）。

**Worktree 隔离的边界与缺口**（来源：[Upsun: Git worktrees for parallel AI coding agents](https://developer.upsun.com/posts/ai/git-worktrees-for-parallel-ai-coding-agents)）：

- 已成主流：Claude Code 内建 worktree 会话（`claude -w`）、Cursor "Parallel Agents"、incident.io 常态 4–5 个 Claude 并行；openai/codex 仓库根目录即有 `.worktreeinclude` 文件（本调研经 GitHub API 核实），Claude Code 用它把 gitignored 小文件（如 `.env`）复制进新 worktree（[best practices](https://code.claude.com/docs/en/best-practices)：大目录用 symlink 配置或把安装命令写进 CLAUDE.md）。
- worktree 解决不了的四类冲突：**端口抢占**（dev server 同默认端口，需端口偏移）、**依赖/缓存不随树走**（每树各自 install，磁盘放大，有用户 20 分钟吃掉 9.82GB）、**共享本地 DB/服务竞态**、**同文件并行改动造成的合并冲突**（无预警工具）。
- 理想编排器清单：自动端口分配、每树环境隔离（DB/服务）、任务独立性预检与冲突预警、中央调度/合并排序、有界上下文共享、按需起灭的临时环境、agent 状态面板。Claude Code 的 `/batch`（大机械任务拆 5–30 单元，每单元独立 worktree 开 PR）与 `claude agents`（后台运行总览）是厂商侧回应。

**原子认领**（来源：[Stop Two AI Agents Taking the Same Task](https://heyprov.com/blog/stop-two-ai-agents-same-task)）：

- 竞态本质：两个 agent 同刻读到同一任务清单；提示词"别重复干活"无效，"ready → in-progress"状态约定在读写不原子时同样失效。
- 修复：**认领 = 检查可用 + 记录归属的一次不可分操作**（对 assignee 的 compare-and-swap / 乐观锁）；输家得到冲突而不是静默覆盖。
- 任务记录必备字段：唯一当前 owner、认领时间、工作面（分支）、**有界租约（lease）或释放程序**、owner 失联后的去向。配套规则：不偷看似闲置的活动认领（走交接或等租约到期）；输家刷新队列改领别项，无任务可领就停，不发明工作；分解时同文件任务串行或指定集成 owner；**光有分支不够——归属必须在建分支之前可见**。
- 本仓库 `docs/agents/issue-tracker.md` 的"认领 = `gh issue edit --add-assignee @me` 作为会话首次写入"已具备 CAS 雏形（GitHub assignee 写入服务端原子），缺的是租约/心跳与失联回收。

### 2.4 Agent 产出的可验证性设计

- **证据而非结论**（来源：[Claude Code Best Practices](https://code.claude.com/docs/en/best-practices)）：向 agent 要 evidence——跑了哪些命令、输出是什么，而不是一句"all tests pass"；评审用未看过编写过程的全新 subagent（`/code-review` 或只读 `tools: Read, Grep, Glob` 的 reviewer，对照 spec 审 diff）；规模化前先拿 3 个文件试跑再放量；无人值守前五问：知道"完成"的定义吗、能自检吗、权限受限吗、有花费/轮次上限吗、人类批准最终合并吗。
- **确定性验证器 + 门禁**（来源：[Spotify: Feedback loops for background coding agents, Part 3](https://engineering.atspotify.com/2025/12/feedback-loops-background-coding-agents-part-3)）：最严重的失败是"CI 绿但功能错"；方案 = 多个独立确定性 verifier（发现 `pom.xml` 即触发的构建/测试器）藏在 MCP 工具抽象后，**解析原始输出、只回传关键错误**以省 agent 上下文；全部 verifier 在开 PR 前经 stop hook 强制运行，失败阻断 PR；再叠 LLM-as-judge（diff + 原始提示 → 是否越范围，典型罪状是顺手重构/禁用 flaky 测试），judge 否决约四分之一会话。
- **流程级可判定终点**（来源：[spec-kit](https://github.com/github/spec-kit)）：implement↔converge 循环直到机器可读的 `Converged`；bug 裁定三值枚举，verified 才算数。
- **机械化禁止"乐观打勾"**（来源：[Adobe Multi-Session Patterns](https://opensource.adobe.com/mysticat-ai-native-guidelines/02-lifecycle/multi-session-patterns/)）：MUST NOT 语义 + 钩子/门禁强制（同站 Guardrails 章节主张 MUST/SHOULD 规则需配 mechanical enforcement，而非指望模型自觉）。
- **命令表自校验**（来源：[ACI Design](https://github.com/adobe/mysticat-ai-native-guidelines/blob/main/docs/04-configuration/aci-design.md)）：文档给"期望退出码"，agent 执行后即可自比对话，验证回路的最小单元。
- 业界综述侧影："瓶颈已从写代码转移到验证代码"（[Addy Osmani: Agentic Verification](https://addyo.substack.com/p/agentic-verification)、[Agentic Code Review](https://addyosmani.com/blog/agentic-code-review)；[Momentic: 在 preview 部署上测 agent PR](https://momentic.ai/blog/test-coding-agent-pull-requests-preview-deploys)）。

## 三、对本项目的可借鉴清单

前提映射：本项目 = AGENTS.md 根文件（已有）+ `gh` 工单流（已有）+ 待建的 devenv 单一命令面（Spec-工程基座的核心）+ 共享基础设施容器、数据级隔离（已定）。以下按票面要求分三组，标注优先级（P0=进 SPEC 必选，P1=强烈建议，P2=观察项）。

### 3.1 devenv 命令面

| # | 借鉴点 | 来源 | 优先级 |
| --- | --- | --- | --- |
| C1 | **AGENTS.md 内置命令表**：三列"Action \| devenv 命令 \| 期望退出码"，覆盖构建/启停/观察/执行/验证；agent 每次执行后自比对退出码 | ACI Design 命令表；agents.md 推荐内容 | P0 |
| C2 | **输出双态**：默认人读；`--json` 全局旗标输出稳定 schema 的单 JSON（仿 `gh --json`）；schema 字段纳入文档 | gh/git --porcelain 传统；claude/gemini `--output-format json` | P0 |
| C3 | **长任务 JSONL 事件流**：`up`/`build`/`e2e` 等长命令支持 `--json` 输出 JSONL 事件（`started/completed/failed` + 项级事件），终值事件带耗时/统计 | codex exec `--json` 事件模型 | P1 |
| C4 | **进度/结果分流**：进度走 stderr、可管道的干净结果走 stdout | codex exec；claude -p | P0 |
| C5 | **输入保持扁平受约束**：子命令 + 扁平参数 + 枚举值；复杂输入宁可多个子命令，不做 JSON payload 入参 | Microsoft 实测（4–11 倍成本、正确率下降） | P0 |
| C6 | **退出码语义文档化并枚举化**：0=成功；非 0 区分固定类别（环境未启动/依赖未就绪/校验失败/超时/并发冲突被拒），成表写入 AGENTS.md；信号/中断约定明确（借鉴 claude 143 语义） | ACI"期望退出码"；claude headless 退出码 | P0 |
| C7 | **错误消息面向 agent**：`file:line`/服务名 + 具体违规 + 修复建议（如"先运行 devenv up"），devenv 自身报错模板化 | ACI 原则 4 | P0 |
| C8 | **动作点即时反馈**：验证类子命令只针对变更范围、秒级返回结构化结果（lint 单文件 <5s 目标）；全量校验另设显式命令 | ACI 原则 3 | P1 |
| C9 | **幂等 + 快速失败**：所有状态改变命令幂等（重复执行同结果）；前置条件不满足立即失败并给出修复命令；与地图"快速失败、幂等"既有决策互证 | ACI 审计清单；地图 #1 AI-Native 约束 | P0 |
| C10 | **终态等待子命令**：`devenv wait <service>`（ready probe、带超时与退出码），杜绝 agent 轮询 sleep | agent CLI 设计共识（[Dockup](https://dockup.ai/blog/cli-design-for-ai-agents)、[Speakeasy](https://www.speakeasy.com/blog/engineering/agent-friendly-cli)） | P1 |
| C11 | **并发语义内建**：每命令声明并发安全级别（只读/共享可并发/独占需锁）；独占命令（如迁移、e2e 毕业）自动取锁，锁信息进 `--json` 输出与 `devenv status` | 地图"并发是常态"；Upsun 共享资源冲突清单 | P0 |
| C12 | **环境自检命令**：`devenv doctor` 一键体检（依赖在位、端口、数据隔离键、基线可跑），退出码即"可开工与否" | Adobe 会话启动协议（init + 基线测试） | P1 |

### 3.2 脚手架

| # | 借鉴点 | 来源 | 优先级 |
| --- | --- | --- | --- |
| S1 | **`.worktreeinclude`**：列出需复制进新 worktree 的 gitignored 小文件；大目录（node_modules 等）走 symlink 白名单或"安装命令写进 AGENTS.md" | openai/codex 仓库实文件；Claude Code worktree 机制 | P0 |
| S2 | **worktree 管理进 devenv**：`devenv worktree add/remove/list` 封装 git worktree + 自动分支命名 + 自动端口/键空间偏移 + 触发数据级隔离初始化，把 Upsun 列举的四类冲突在入口处消解 | Upsun 编排器清单；Claude Code `/batch` | P1 |
| S3 | **多会话状态模板**：`features.json`（pending/in-progress/pass/fail 状态机 + 完成会话字段）与 `progress.md`（决策/阻塞/下一步）脚手架化，供 prototype/实施期 agent 会话接力 | Adobe 两阶段模式 | P1 |
| S4 | **会话首尾协议脚本化**：启动 = `devenv doctor` + 读状态文件 + 基线测试；收尾 = 跑验证 → 更新状态文件 → commit → push，封装为 `devenv session-start/end` 或文档化清单 | Adobe 会话协议 | P1 |
| S5 | **验证器统一入口**：`devenv verify`（全量确定性检查，CI 同源）+ `devenv verify --scope <target>`（增量）；作为"毕业"与 PR/合并前的强制门 | Spotify verifier + stop hook；spec-kit converge | P0 |
| S6 | **spec 驱动目录**：spec/plan/tasks 产物作为仓库文件沉淀（`.specify/` 或并入 `docs/`），实施工单从文件生成，保证任意会话可续 | spec-kit SDD | P2 |
| S7 | **CI 质量门与本地 verify 同构**：CI 只跑 `devenv verify`，本地与 CI 验证回路完全一致，避免"本地绿 CI 红"的 agent 困惑 | Spotify/地图 #1 CI 质量门决策 | P1 |

### 3.3 文档结构

| # | 借鉴点 | 来源 | 优先级 |
| --- | --- | --- | --- |
| D1 | **根 AGENTS.md 作为唯一权威 + 极简**：目标 200 行内；只写"验证命令、误导性区域、不在代码里的决策、纠正过两次的事"；工具特异配置全部指向它（符号链接/导入）而非平行维护 | Claude Code 极简主义；agents.md 迁移建议 | P0 |
| D2 | **三层渐进披露**：AGENTS.md（Map 层）→ `docs/agents/*.md` 按需细读（Module 层，现有 issue-tracker/domain/triage-labels 即此层）→ 深层细节索取才给；反模式：全量塞根文件 | ACI 渐进披露；Claude Code skills 分层 | P0 |
| D3 | **嵌套 AGENTS.md 预留**：monorepo 各 app/package 目录预留嵌套 AGENTS.md 位（"最近者优先"），服务 devenv 接入第二个后端时的模板化扩展 | agents.md 嵌套规则 | P1 |
| D4 | **命令文档表格化**：所有命令文档用"Action \| Command \| 期望退出码"表 + 示例 JSON 输出；表格优先于散文 | ACI 文档规范 | P0 |
| D5 | **仓库自描述**：ADR（`docs/adr/`，已有约定）、机器可读 API 契约、环境引导（devenv 命令）、环境变量清单（含类型/默认值）全部入库；禁止 Slack/口头隐性知识 | ACI 原则 5 | P0 |
| D6 | **GLOSSARY + ADR 既有布局保留**：与业界"自描述仓库"实践一致，e2e 术语（复现/探索/毕业）按地图计划首批落 GLOSSARY.md | 地图 #1；domain.md 既有约定 | P0 |
| D7 | **`docs/research/` 作为调研沉淀位**：本报告即首个样本；research 子票产物入库可追溯，与 issue 决策记录互链 | 本次实践 | P1 |
| D8 | **过期文档清理机制**：文档带"最后验证日期"，`devenv doctor` 或例行检查陈旧命令引用，防"文档说谎"毁掉 agent 信任 | Claude Code prompt-audit 思想 | P2 |

### 与既有决策的对齐校验

- "devenv 唯一入口 + 封装 compose" ↔ 业界"单一命令面 + ACI 设计"共识：方向正确，成败在 C1–C7 的细节。
- "基础设施容器共享、数据级隔离" ↔ Upsun 结论（共享 DB/端口是 worktree 之外头号冲突源）：方向正确，需补 C11 端口/键空间自动分配与 S2 worktree 集成。
- "gh 工单 + assignee 认领" ↔ 原子认领实践：已具备 CAS 雏形，建议 SPEC 补"租约/心跳/失联回收"条款（heyprov 清单）。
- "AI-Native：确定性、机器可解析、快速失败、幂等" ↔ 全部四个主题的业界共识：完全一致，无需调整。

## 四、来源

一手来源（规范/官方文档/仓库原文）：

1. agents.md 官方规范站：<https://agents.md/>
2. OpenAI Codex 非交互模式文档：<https://learn.chatgpt.com/docs/non-interactive-mode>
3. Claude Code Headless 文档：<https://code.claude.com/docs/en/headless>
4. Claude Code Best Practices：<https://code.claude.com/docs/en/best-practices>
5. Gemini CLI 配置参考（分层 context、--output-format）：<https://geminicli.com/docs/reference/configuration>
6. Adobe Mysticat AI-Native Guidelines — ACI Design：<https://github.com/adobe/mysticat-ai-native-guidelines/blob/main/docs/04-configuration/aci-design.md>
7. Adobe Mysticat AI-Native Guidelines — Multi-Session Patterns：<https://opensource.adobe.com/mysticat-ai-native-guidelines/02-lifecycle/multi-session-patterns/>
8. Microsoft DevBlogs — Don't rewrite your CLI for agents（2026-07）：<https://devblogs.microsoft.com/blog/dont-rewrite-your-cli-for-agents/>
9. github/spec-kit README：<https://github.com/github/spec-kit>
10. Spotify Engineering — Feedback loops for background coding agents, Part 3（2025-12）：<https://engineering.atspotify.com/2025/12/feedback-loops-background-coding-agents-part-3>
11. aider conventions 文档：<https://aider.chat/docs/usage/conventions.html>
12. block/goose `.goosehints`（经 GitHub API 取回原文）：<https://github.com/block/goose>
13. openai/codex 仓库根目录 `.worktreeinclude`（经 GitHub API 核实存在）：<https://github.com/openai/codex>
14. Google Gemini CLI "Agent Rules" 讨论：<https://github.com/google-gemini/gemini-cli/discussions/1471>

二手来源（佐证/综述）：

15. Upsun — Git worktrees for parallel AI coding agents：<https://developer.upsun.com/posts/ai/git-worktrees-for-parallel-ai-coding-agents>
16. Prov — Stop Two AI Agents Taking the Same Task：<https://heyprov.com/blog/stop-two-ai-agents-same-task>
17. Addy Osmani — Agentic Verification：<https://addyo.substack.com/p/agentic-verification>；Agentic Code Review：<https://addyosmani.com/blog/agentic-code-review>
18. Momentic — Test coding agent PRs on preview deploys：<https://momentic.ai/blog/test-coding-agent-pull-requests-preview-deploys>
19. Speakeasy — Making your CLI agent-friendly：<https://www.speakeasy.com/blog/engineering/agent-friendly-cli>
20. Dockup — AI Agent CLI Design：<https://dockup.ai/blog/cli-design-for-ai-agents>
21. buildbetter — AGENTS.md vs CursorRules 对比：<https://blog.buildbetter.ai/agents-md-vs-cursorrules-vs-claude-skills-2026-comparison>
22. explainx — Claude Code AGENTS.md 支持分析：<https://explainx.ai/blog/claude-code-agents-md-support-2026>
