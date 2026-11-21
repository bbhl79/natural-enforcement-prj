# PROTOTYPE #13 事实与坑清单（e2e 双轨与 CI 原型）

> 纵切「e2e 双轨与 CI」。分支：`prototype/e2e-dualtrack`（基于 `prototype/foundation-slice-2`，throwaway，不合入 dev）。
> 本文件是 #13 决议评论的原始素材与 Spec-e2e体系（#14）的直接输入。
> 除注明外，全部为 2026-11-21 容器内实测结论。前置事实见 `devenv/NOTES.md`（#11）/ `NOTES-slice2.md`（#12）。

## 0. 验证结果总览（全流程真跑）

| 票面要求 | 验证证据 |
|---|---|
| 数据级隔离 e2e 栈（共享基础设施容器 + 独立库/bucket/键空间） | `devenv ci/explore/e2e *` 每次 run 独立：`CREATE DATABASE e2e_<run_id>`（DROP FORCE 幂等重入）+ `prisma migrate deploy` + bucket `e2e-<run_id>`（api onModuleInit 自建）+ 队列名前缀 `e2e-<run_id>-`；基础设施容器（db/redis/rustfs）跨 run 共享，零宿主端口，浏览器经 compose 内网打 e2e-web:4173 |
| 一条复现用例（CI 模式可跑） | `devenv ci` 两态实证：毕业未修时 `✘ 1 def-0001.spec.ts` 且 **exit 0**（expected-fail 判绿）；修复后 `✓ 1` exit 0（真绿）。CI 模式 = `CI=true` 环境注入（workers=1 + failures/JSON(onlyFailures)/blob 报告器） |
| 一条探索用例走完毕业命令全流程（含防降级校验演示） | DEF-0001（**真实缺陷**：NUL 名称→500，契约 `z.string()` 未拦 PG text 禁存字符）：explore 发现（危险字典 prelude 首命中）→ report（门禁 1/1 实测回填）→ graduate（转写→**真跑校验 expect=fail 确认未修**→原子落账）→ 修复（契约 refine→400 + 单测）→ confirm-fix（真跑 expect=pass→摘标记→fixed）。防降级演示 6 项全过（§3）。DEF-0002 演示非机械引擎路径（agent-session→_drafts 草稿→CI 不收集→retire 留档） |
| GitHub Actions 草稿跑通复现轨道 | `.github/workflows/e2e-draft.yml`（push 触发本分支 + workflow_dispatch；checkout→devenv build→devenv verify→devenv ci --full-down→产物上传 !cancelled()）。真跑记录见 issue #13 决议评论 |
| 产出：毕业机制与 CI 集成事实沉淀 | 本文档 + `devenv/COMMANDS.md` e2e 命令面 + 退出码枚举表（§4） |

## 1. 核心机制事实（#10 决议 §1–§9 全量实现的定型差异）

### 1.1 毕业事务的「真跑校验」实现形态（#10 §6 的落地）

- 转写产物有两份：**final 形态**（expected-fail 用例，带 `test.fail()` 行）与 **verify 形态**（同一用例去掉 fail 行）。graduate 用 verify 形态真跑一次：未修缺陷必须 **失败**（反例确实打得出 5xx）；fixImmediate 必须通过。判定不符 → 零落盘 exit 9。
- verify-run 用独立配置 `playwright.verify.config.ts`（testDir `.verify-run/`，不在 repro/explore 目录树内）——草稿注入走 stdin tar（无 bind 架构），容器 overlay fs 可写。
- **expected-fail 的 CI 绿是有实证的**：playwright 把「预期失败且失败」计为 passed；「预期失败却通过」才红（confirm-fix 的触发器）。`devenv ci` 在未修状态下 exit 0 + 输出里可见 `✘ 1`——证据链完整。
- confirm-fix 复用同一 verify 形态真跑（expect=pass），通过后才摘 `test.fail()` 行（CLI 生成精确行匹配，非正则改写）。

### 1.2 生命周期 CLI 的「纯决策引擎 + op 协议」架构（无 bind 架构的必然）

- CLI（`apps/e2e/src/cli.ts`，tsc→dist，tools 容器内跑）**不落盘**：宿主树经 stdin tar 进 `/tmp/in` 只读；写盘/删文件以行协议输出（`W\t路径\tbase64` / `D\t路径` / `V\t校验载荷`），devenv 在宿主侧原子应用（全有或全无：V 判定不符→9 零应用；END error→透传码零应用）。
- 好处：①容器无需写通道；②宿主 git 状态由 bash 全权掌控；③协议可被未来 CI 直接消费。代价：消息面split（协议 stdout / 人类 stderr）——`run_cli_and_apply` 统一收口后才把拒绝原因透出（早期坑：set -e 吞 END 行，只见退出码不见原因）。

### 1.3 注册表（派生缓存）语义修正（对 #10 §3 的重要落地修正）

- 原设想「漂移即红」实测**死锁**：verify 失败时不重写缓存 → 下次必报 drift → 永远红（哪怕真实违规已修）。
- 定型：`registry:drift` 不作硬门禁；verify **始终重建** + 漂移时 WARN（"缓存过期或被手改，已自动重建；完整性以 defects/*.json 为准"）。完整性锚在入库的缺陷记录本身（+ git 历史），缓存只证「派生可重建」。

### 1.4 diff 级防降级的独立价值（实证非冗余）

- 「删 spec+删缺陷记录+renumber 收敛」的**洗白路径**：生命周期校验全绿（无洞、无孤儿、retired 语义自洽），**只有** `verify --diff-base` 抓出（删 DEF JSON=无条件红）。CI 必须传基线分支（`GITHUB_BASE_REF`）；本地默认不跑 diff 级。
- 普通删除（工作树不一致）会被生命周期索引检查先拦——diff 级是为「提交历史层面的一致性洗白」准备的第二道闸。

### 1.5 复现门禁的实测口径

- deterministic（PBT/契约 fuzz/脚本反例）：1 次重放；nondeterministic（视觉/monkey/agent）：≥3 次。`report` 命令**实测**门禁（起隔离栈→跑 replayCommand N 次→全部 exit 0=复现→回填 gate{attempts,keySpaces,allFailed}），非自查申报。
- replayCommand 约定：`node apps/e2e/replay/DEF-NNNN.mjs`，**零第三方依赖**（node 内建 fetch）、**exit 0 = 复现**——长期可重建（记录永不删，脚本随记录入库）。
- 修复后 replay 语义自动反转（0/1 未复现→exit 4 + 「环境漂移或已修复？」提示）——同一命令服务诊断与确认两个场景。

## 2. e2e 栈与容器事实（对调研报告的实证与修正）

| 事实 | 说明 |
|---|---|
| **BullMQ 6 队列名禁 `:`** | `Queue name cannot contain :`（bull 保留为 Redis 键分隔符）。键空间隔离前缀用 `-`；Redis 清理 pattern 按队列名前缀扫（`*e2e-<rid>-*`），不是任意键前缀。「独立键空间」在 BullMQ 语境=队列名级 |
| **Vite 8 preview 校验 Host** | 容器内网域名（e2e-web）被拒：`allowedHosts` 需显式放开（`preview.allowedHosts: true`；dev localhost 本在白名单）。preview proxy 目标可经 `API_ORIGIN` env 注入（e2e 栈指 e2e-api） |
| **mcr playwright 镜像可用性** | `v1.65.1-noble`（2.6GB）拉取顺利；`--init`+`ipc: host` 经 compose 服务级字段注入 OK；容器内跑 Chromium 无 shm 崩溃（UI 旅程 818ms 通过，含 antd 表单交互→API→PostGIS→表格回显全链） |
| **npx 找不到子包 bin** | compose run 工作目录 /workspace 下 `npx playwright` 失败（npx 只向上查 node_modules/.bin）。**解：`pnpm --filter @ne/e2e exec playwright test`**（cwd=包目录 + bin 在 PATH） |
| **e2e 镜像分层** | manifest 层（package.json 集合）→ `pnpm install --frozen-lockfile --filter @ne/e2e...` → 源码层（COPY apps/e2e + contracts）→ 各自 build。`--filter` 安装只拉 e2e 闭包依赖（playwright npm 包 ~50MB + fast-check + aws-sdk）；基座镜像含浏览器，npm 包与镜像 tag 严格同版本（1.65.1 exact，catalog 锁定） |
| **@playwright/fast-check 零 allowBuilds** | 两包均无 install-time 构建脚本（npm registry scripts 实查）——供应链面干净，无 pnpm 12 构建审批交互 |
| **PG 库名净化** | 外显 run_id 允许 `-`（bucket/队列名友好），库标识符只留 `[A-Za-z0-9_]`（`e2e_ci_123` 形态）；GHA 的 `ci-<run_id>-<attempt>` 直接可用 |
| **产物通道** | 容器内 outputDir/JSON/blob/trace → 命名卷 `e2e-artifacts` → run 结束 `docker cp` 导出宿主 `.artifacts/e2e/<run_id>/`（docker cp 对 created 容器可用——#11 lockgen 模式复用） |
| compose 插值陷阱 | `${E2E_RUN_ID:?}` 硬门在 **profile 未激活时也会求值**——炸掉所有常规 compose 命令。解：devenv compose() 兜底默认值，`:?` 改普通插值 |

## 3. 防降级演示实录（六项，全部真实触发后还原）

| # | 违规操作 | 结果 |
|---|---|---|
| 1 | 删 `tests/repro/def-0001.spec.ts`（不 retire） | exit 7：`[index] graduated 缺 tests/repro/def-*.spec.ts` + registry 漂移 WARN |
| 2 | 用例内加 `test.skip()` | exit 7：`[annotation] 禁用 test.skip/test.fixme` |
| 3 | 重复 graduate 已毕业缺陷 | exit 8：`已是 graduated；重复毕业被拒`（反向操作工具性禁止） |
| 4 | graduate 不存在的 DEF-9999 | exit 10：`缺陷不存在` |
| 5 | 删 `defects/DEF-0001.json` | exit 7：`无 DEF-0001 缺陷记录（毕业是唯一合法写入路径）` + 断号 |
| 6 | 洗白：删 spec+JSON+replay 后 renumber | 无 diff 基线时**绿**（生命周期被洗白）；`--diff-base HEAD~1` exit 7：`缺陷记录被删除…无条件红` |

## 4. 退出码枚举（原型定型，#10 留给本票的口径）

| 码 | 含义 | 触发示例 |
|---|---|---|
| 0 | 成功 | 全部命令正常路径 |
| 2 | 用法错误 | 未知子命令/缺 `--reason` |
| 3 | 环境未就绪 | 镜像未构建/服务未起（verify-run 前置检查） |
| 4 | 任务失败 | repro/explore 轨道非零退出（含「探索发现」）；replay 未复现 |
| 5 | 超时 | 健康等待（e2e-api/e2e-web 120s 窗） |
| 6 | 锁冲突 | build/migrate（机器级）；e2e 生命周期写（per-worktree） |
| 7 | 生命周期校验失败 | verify 索引/注解/编号/门禁违规；diff 级检查 |
| 8 | 状态转移/前置条件不合法 | 重复毕业/退役后毕业/门禁未过/草稿不可转正 |
| 9 | 毕业校验运行判定不符 | expect=fail 却通过 / expect=pass 却失败（翻译质量把关） |
| 10 | 缺陷不存在或 schema 不符 | 未知 ID/JSON 解析失败/机械引擎缺 counterexample |

JSON 输出字段：`devenv --json` 终值 `{"command","status","exitCode",…}`（现有约定延续）；e2e 长命令过程 JSONL `step.started/step.completed`（含 `target=workspace image refresh / e2e image refresh / graduate verify-run` 与 `verdict=reproduced|did-not-fail|passed|still-failing`）。

## 5. 工程坑清单（SPEC 输入）

1. **bash EXIT trap 引用 local**：`trap 'f "$rid"'` 在失败路径展开时 local 已出栈（`unbound variable` 遮蔽真实退出码 8→1）。**解：双引号立即展开** `trap "f '$rid'"`。AI 生成 bash 的高频暗雷。
2. **set -e × 命令替换吞诊断**：`e2e_cli … >ops` 失败即中止，CLI 的 END 行（含拒绝原因）锁在临时文件里。收口为 `run_cli_and_apply`（捕获 rc→有 END 行走 apply 展示消息并透传码；无 END 行=容器/构建问题透传 rc）。
3. **grep -P 的 ANSI-C quoting**：bash 下 `grep -P '^V\t'` 需 `$'\t'` 写法或 `-P` 内建 `\t`——`grep '^V\\t'` 不匹配（POSIX BRE 无 \t）。op 协议解析用 `grep -P` + `IFS=$'\t' read`。
4. **antd 双字按钮自动插空格**：`创建`渲染为`创 建`——`getByRole('button', {name:'创建'})` 不命中；用 `/创\s*建/`。同理 `查询`→`查 询`。
5. **antd 无 name 的 Form id 撞车**：两个 Form 都有 `name="lat"` 字段 → DOM id 重复 → label[for] 跨表单指向（getByLabel 作用域化失效 + 可访问名翻倍 `* 纬度 : * 纬度 :`）。解：表单内按角色定位（textbox/spinbutton 序）；根治=antd Form 加 name 前缀（SPEC 决策点）。
6. **vitest 单测树 vs 集成树**：verify 的单测用 mkdtemp 临时树（零基础设施、turbo 可缓存）；生命周期逻辑先过单测再上容器——校验器自身先被验证。
7. **探索「失败」的语义收口**：explore 轨道 exit 4 时 devenv 提示「这是产出不是事故」+ 产物路径——防止 agent 把发现当环境故障修栈。

## 6. SPEC 决策点清单（#14 直接输入）

1. **explore 轨道的调度形态**：当前手动 `devenv explore` 全量跑；charter 级认领（issue-tracker 同构）与 explore 配置的 project 化（按 charter 分 worker）待定。
2. **graduation --fixed（fixImmediate）**：已实现（转写生来绿+expect=pass 校验）；触发时机（修复 PR 同 commit）写进 SPEC 流程。
3. **verify-run 的失败归因**：exit code 无法区分「反例确实复现」与「栈坏了」（如 api 未起时连接错误也算 fail）。v1 靠前置健康检查 + stderr 人工判读；v2 可解析 verify-results.json 断言错误类型。**真实风险已记录**。
4. **UI 引擎毕业用例的栈需求**：graduate/confirm-fix 已带 e2e-web；CI 的 repro 轨道同样带（完整栈），成本可接受（web 容器秒级增量）。
5. **playwright npm 包与镜像同步升级流程**：catalog exact pin + images.lock digest 双锁；升级=两者同 PR 改 + e2e 全量演练（已具备 `devenv images --verify` 基建）。
6. **`.artifacts/` 的保留策略**：本地 run 产物目前无清理；SPEC 定保留窗（如 7 天）或挂 run-id LRU。
7. **多 agent 并发的 run_id 空间**：new_run_id=前缀+epoch+RANDOM（碰撞概率低）；SPEC 可选加 agent 名段。
8. **探索轨道产物 → 缺陷报告的半自动化**：本次 DEF-0001/0002 由 agent 从 results.json/error-context 归因手写；「归因草稿生成器」（读 JSON+trace 产 DEF-NNNN.json 草稿）是明显的下一步工具票。
