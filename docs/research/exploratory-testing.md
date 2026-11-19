# 调研：自动化探索测试技术（票 #7）

> 子票：Research-自动化探索测试技术调研
> 状态：调研完成，供「Grilling-e2e生命周期机制设计」（#8 等）采用
> 日期：2026-11-16
> 方法：全部关键结论基于一手来源（官方文档、论文、官方仓库），逐条附来源链接

---

## 1. 结论先行

1. **探索轨道的主力组合**（按引入顺序）：**fast-check 属性测试（PBT）→ Schemathesis API 契约探索 → 容器内视觉回归（Playwright 原生截图）→ fast-check 模型化随机旅程 → UI monkey fuzz（gremlins.js）+ agent 会话探索（SBTM 自动化变体）**。排序逻辑：确定性递减、误报率递增、落地成本递增——先吃信噪比最高的，最后才引入需要重门禁过滤的手段。

2. **每个引擎的失败工件天然就是"缺陷报告 + 可复现脚本草案"**，这是本组合最关键的性质：
   - fast-check：失败输出携带 `seed` + `path`（模型化测试另有 `replayPath`），可直达最小反例重放（[fast-check README](https://github.com/dubzzz/fast-check)、[模型化测试文档](https://fast-check.dev/docs/advanced/model-based-testing)）；
   - Schemathesis：每个失败自动落盘 crash 文件并附 **curl 重现器**，`st replay` 可原样重发请求（[Replaying Failures](https://schemathesis.readthedocs.io/en/stable/guides/crash-reproduction)）；
   - 视觉回归：diff 图 + Playwright `trace.zip`（逐步 DOM 快照/网络/console）构成归因证据（[Trace Viewer](https://playwright.dev/docs/trace-viewer-intro)）；
   - RESTler（备选）：bug 自动分桶（bug bucket）并生成 **replay log** 用于复现（[microsoft/restler-fuzzer](https://github.com/microsoft/restler-fuzzer)）。
   **毕业流水线只需定义一个统一的缺陷报告 schema，把上述工件映射进去**（见第 4 节）。

3. **误报率必须分级治理**，且业界有量化数据支撑门禁设计：Google 数据——全部测试运行中约 1.5% 报 flaky，按周期看小型测试 0.5%、中型 1.6%、**大型（e2e）测试 14%** 出现 flaky（[Flaky Tests at Google](https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html)、[Where do our flaky tests come from?](https://testing.googleblog.com/2017/04/where-do-our-flaky-tests-come-from.html)）；LLM agent 自由探索的误报率极高——WebProber 在 120 个网站上的报告 **85% 为误报**（[arXiv:2509.05197](https://arxiv.org/html/2509.05197v1)），自主测试代理（ATA）正确判定率约 60%（[arXiv:2504.01495](https://arxiv.org/pdf/2504.01495)）。结论：**确定性引擎（PBT/契约 fuzz）的失败可直接进缺陷报告；旅程/视觉/agent 探索的失败必须过"多次重放稳定复现"门禁**。

4. **所有候选均满足本项目 AI-Native 硬约束**：可设随机种子（确定性）、输出机器可解析（JSON/HTML 报告）、可在容器内运行（不违反"宿主机只存代码"），与"基础设施容器共享、数据级隔离"兼容（Schemathesis 官方明确要求 stateful 测试跑在一次性环境上，恰好对上我们的数据级隔离设计，见 [Stateful Testing](https://schemathesis.readthedocs.io/en/stable/explanations/stateful/)）。

5. **agent 在探索轨道中的定位是"编排与归因层"**，不是替代确定性引擎：agent 负责①把 OpenAPI/领域规则翻译成属性与生成器（OSS-Fuzz-Gen 证明 LLM 生成的 fuzz target 可用并在 160 个项目上最高带来 35% 绝对覆盖率提升，[Google 官方博客](https://blog.oss-fuzz.com/posts/introducing-llm-based-harness-synthesis-for-unfuzzed-projects)）；②对失败工件做归因（读 trace.zip/HAR/console 生成缺陷报告草稿）；③执行 charter 驱动的会话探索（SBTM 自动化变体）。

---

## 2. 各技术画像

### 2.1 属性测试（PBT）—— fast-check（TS 原生）

**定位**：对纯函数/领域逻辑断言"对所有满足前置条件的输入，谓词均为真"（[README](https://github.com/dubzzz/fast-check)）。5.3k stars、活跃维护、MIT；jest、ramda、js-yaml 等项目在用并曾借其发现真实缺陷。

| 维度 | 画像 |
|---|---|
| 发现缺陷类别 | 序列化/解析往返丢失、边界值（空串/极值/Unicode）、日期与数值计算错误、几何计算（PostGIS 相关纯逻辑）、权限/校验规则违反、**竞态**（其调度器可随机化 Promise 解析顺序，官方宣称可检出 race conditions）、原型污染（首页宣称 fuzzing 可发现 prototype poisoning 类缺陷） |
| 误报率 | **极低**。失败即"断言的属性被违反"，属性本身就是规范；主要风险是属性写错（把 bug 写进规范），属校准成本而非运行时误报 |
| 落地成本 | **最低**。纯库、无外部服务；`@fast-check/vitest` 提供 `test.prop()` 与 Vitest 一等集成（[npm](https://www.npmjs.com/package/@fast-check/vitest)、[官方教程](https://fast-check.dev/docs/tutorials/setting-up-your-test-environment/property-based-testing-with-vitest)）。成本主要在"把示例断言抽象成属性"的思维转换 |
| agent 驱动方式 | **输入生成**：内置 arbitraries 且"biased by default"偏向边界；可从 JSON Schema 派生生成器（社区库 [json-schema-fast-check](https://github.com/meeshkan/json-schema-fast-check)，注意评估维护状态；[生态页](https://fast-check.dev/docs/ecosystem)）；`fc.gen()` 支持从 fake data 平滑迁移。**失败收缩**：自动收缩到最小反例，且可"replay directly on the minimal counterexample"。**归因**：失败输出含 `seed`+`path`，重放确定性 100% |

### 2.2 API 契约探索（contract fuzz）—— Schemathesis（主选），RESTler/RAFT（对照）

**定位**：从 OpenAPI（2.0/3.0/3.1/3.2）/GraphQL/gRPC schema 自动生成属性式测试："Catches server errors, schema violations, and validation gaps that hand-written tests miss"（[官方文档](https://schemathesis.readthedocs.io/)）。有 ACM 论文背书（[Schemathesis 4: Multi-Phase Property-Based Testing](https://dl.acm.org/doi/10.1145/3786155.3795697)）。

| 维度 | 画像 |
|---|---|
| 发现缺陷类别 | ① 未处理的 5xx（示例即"finding a server error that manual testing missed"）；② 负面测试暴露的校验缺口（生成"应当被 API 拒绝"的违规数据，[Data Generation](https://schemathesis.readthedocs.io/en/stable/explanations/data-generation/)）；③ 响应与 schema 不一致；④ 状态化（stateful）阶段：用真实响应数据串联多步操作，暴露"更新后读取、删除后使用、跨资源创建"类序列缺陷（[Stateful](https://schemathesis.readthedocs.io/en/stable/explanations/stateful/)） |
| 误报率 | **低**。5xx 与规范违例是客观失败。主要"准误报"来源：① spec 与实现的设计分歧（实为 spec 债务，应修 spec 而非掩盖）；② 测试环境数据/服务未就绪——用数据级隔离和健康检查前置解决 |
| 落地成本 | **中低**。"No per-endpoint tests to maintain — point it at your schema and run"。前提：**OpenAPI spec 质量到位**（NestJS 可产出 spec）。它是 Python CLI——跑在 devenv 容器内即可，符合"宿主机只存代码"；官方提供 CI/CD 集成指南 |
| agent 驱动方式 | **输入生成**：从 schema 自动生成，含负面数据；运行中"learns from server responses"自适应分配算力。**失败收缩/复现**：失败自动存 crash 文件，每个失败附最小 curl 重现器；`st replay` 原样重发并报告哪些已修复（[Replaying Failures](https://schemathesis.readthedocs.io/en/stable/guides/crash-reproduction)）；`--seed` 复现精确生成输入（[CLI 教程](https://schemathesis.readthedocs.io/en/stable/tutorials/cli)）。**归因**：HTML/JSON 报告 + 失败响应全文。**注意**：stateful 会真实写数据，官方要求跑在 disposable environment（与我们的独立 DB/bucket 隔离设计完全一致） |

**RESTler/RAFT 对照**（[microsoft/restler-fuzzer](https://github.com/microsoft/restler-fuzzer)、[RAFT](https://github.com/microsoft/rest-api-fuzz-testing)）：微软研究院出品的"first stateful REST API fuzzing tool"，从 OpenAPI 推断生产者-消费者依赖并从历史响应动态学习，探索深状态；缺陷检测含专项 checker（资源泄漏、层级违规、非法值注入，[Checkers](https://github.com/microsoft/restler-fuzzer/blob/main/docs/user-guide/Checkers.md)）；**产出 bug bucket（自动分桶去重）+ replay log（精确重放）**，RAFT 提供 GitHub Actions 集成。缺点：.NET 工具链、上手与字典维护成本高于 Schemathesis。**结论：先 Schemathesis；若后续需要更深的安全向序列探索再引入 RESTler。**

### 2.3 随机旅程生成（journey/session）—— fast-check 模型化测试（主形式），Schemathesis stateful（API 层），GraphWalker（对照）

**定位**：把"旅程"形式化为**命令序列**：对系统与简化模型同时执行随机命令流，断言两者一致——"we compare our system to a highly simplified version of it: the model"（[fast-check 模型化测试](https://fast-check.dev/docs/advanced/model-based-testing)）。

| 维度 | 画像 |
|---|---|
| 发现缺陷类别 | 仅在特定操作序列下暴露的状态机缺陷、顺序依赖、删除/失效后使用、乐观并发冲突；`scheduledModelRun` 用随机调度测**竞态**（文档定位为"better detection of race conditions"）；UI 层则暴露多步交互后才出现的渲染/状态错乱 |
| 误报率 | **中**。失败本身是确定的（seed 可重放），但"非缺陷失败"常见于：前置数据未构造、模型抽象与实现的有意分歧（如缓存导致的最终一致）——需要 `fc.pre` 前置条件与幂等清理来压噪 |
| 落地成本 | **中高**。需要为每条业务线编写 command 集（`check`/`run`/`toString` 三方法）与模型；但这套 command 集正是**领域状态机的活文档**，与 GLOSSARY 术语体系同构，长期资产 |
| agent 驱动方式 | **输入生成**：`fc.commands(cmds, { size: '+1' })` 生成逐渐加长的命令流；API 旅程的 command 直接包装 fetch，UI 旅程的 command 包装 Playwright 页面对象。**失败收缩**：`commands` 与普通数组的本质区别是"can efficiently shrink failing scenarios"——只收缩真正执行过的命令（生成 [A,B,C,A,A,C] 若只执行了 A,C,A 则只收缩这部分），失败自动最小化。**复现/归因**：失败输出 `seed`+`path`+`replayPath`（"encodes the history of what was really executed"），三者配合直达最小反例重放 |

**API 层旅程的零成本变体**：Schemathesis stateful 自动"identify producers … identify consumers … and chain them"（来源优先级：schema 自动分析 > 响应 URL 学习 > 手写 OpenAPI links），且每步以一定概率故意用"不存在的 ID"以同时覆盖 404 路径——**旅程生成不需要预先建模即可先跑起来**（[Stateful](https://schemathesis.readthedocs.io/en/stable/explanations/stateful/)）。

**GraphWalker 对照**（[官方站](https://graphwalker.github.io/)、[GW4E 概览](https://gw4e.github.io/mydoc_nutshell.html)）：图模型（YAML/GraphML）+ 生成器（`random(length)` 随机游走、`a_star` 等）生成测试路径。优点：模型可视化、非程序员可维护；缺点：JVM 工具链、**无内建失败收缩**、输出路径需自行绑定执行器。**结论：fast-check 模型化 + Schemathesis stateful 已覆盖其能力且收缩/复现更强，不引入。**

### 2.4 UI 模糊测试（monkey fuzz）—— gremlins.js；安全向 —— OWASP ZAP（可选）

**定位**：向运行中的前端释放随机"小怪兽"——内置 clicker/toucher/formFiller/scroller/typer 等物种随机操作页面，目标是"triggering JavaScript errors, or making the application fail"（[gremlins.js](https://github.com/marmelab/gremlins.js)，9.1k stars，MIT，marmelab）。mogwai（观察者）监控帧率等指标，累计 10 个错误自动停止。

| 维度 | 画像 |
|---|---|
| 发现缺陷类别 | 未捕获的前端 JS 异常、内存/帧率劣化（fps mogwai）、极端随机输入下的表单状态错乱、React 未处理边界（空值渲染崩溃） |
| 误报率 | **高**。随机点击会命中产品上"本来就不该点"的路径，报错未必是缺陷；需要把"合法操作空间"编码进自定义 species（gremlin 就是普通 JS 函数，"Everything in gremlins.js is configurable"） |
| 落地成本 | **低**。可嵌进 Playwright 会话内执行（社区实践：[monkey testing with gremlins.js and Playwright](https://medium.com/@kbalji.kks/web-app-resilience-monkey-testing-with-gremlins-js-and-playwright-1a9024564053)）；风险：2.x 发布于 2020（[发布文](https://marmelab.com/blog/2020/06/02/gremlins-2.html)），维护节奏平缓，需接受"够用但不再进化"的定位 |
| agent 驱动方式 | **输入生成**：物种即生成器；agent 可写"领域感知"的自定义 species（如只点业务上合法的按钮序列）。**复现**：`randomizer: new gremlins.Chance(1234)` 设种子可重复整轮攻击。**收缩：无内建**——失败后靠 trace.zip + 错误日志由 agent 归因，这是把它排在确定性引擎之后的原因 |

**OWASP ZAP**（可选）：对任意请求注入 fuzz 载荷（内置/自定义 payload，[官方 Fuzzer 文档](https://www.zaproxy.org/docs/desktop/addons/fuzzer)），面向注入/XSS 等安全缺陷类；作为探索轨道的**安全专项会话**按需触发，不进常态轮换。

### 2.5 覆盖率引导 fuzz —— Jazzer.js（纯函数层，可选）

**定位**：进程内、libFuzzer 血统的覆盖率引导 fuzzer，用于 Node.js（[CodeIntelligenceTesting/jazzer.js](https://github.com/CodeIntelligenceTesting/jazzer.js)），官方称每秒可执行数千用例，检出未捕获异常与 DoS；与 Jest 集成写成普通测试（[SD Times 报道](https://sdtimes.com/software-development/code-intelligence-introduces-integration-of-jazzer-js-into-jest)）。对照组 jsfuzz（[fuzzitdev/jsfuzz](https://github.com/fuzzitdev/jsfuzz)）同类但维护停滞。

| 维度 | 画像 |
|---|---|
| 发现缺陷类别 | 纯函数崩溃类：解析器（导入文件、坐标序列化）、几何算法极端值、正则回溯/超时（DoS 类） |
| 误报率 | **低**（崩溃即失败）；但只对"可进程内调用"的代码有效，**够不到 HTTP/DB/浏览器边界** |
| 落地成本 | 中。每个目标要写 fuzz target；收益集中在少数高价值纯模块 |
| agent 驱动方式 | **输入生成**：覆盖率反馈自动变异，无需人写生成器；**agent 生成 target**：OSS-Fuzz-Gen 已证明 LLM 可为真实项目写出有效 fuzz target（160 个 C/C++ 项目、最高 +35% 绝对覆盖率、6 个新漏洞，[官方博客](https://blog.oss-fuzz.com/posts/introducing-llm-based-harness-synthesis-for-unfuzzed-projects)、[GitHub](https://github.com/google/oss-fuzz-gen)），学术论文亦证实 LLM 生成的驱动与人工写的 fuzzing 效果相当（[SMU 论文](https://ink.library.smu.edu.sg/cgi/viewcontent.cgi?article=10508&context=sis_research)） |

### 2.6 可视化回归 diff —— Playwright 原生截图（基座）+ Argos（审阅层，可选）

**定位**：`await expect(page).toHaveScreenshot()` 首跑生成基线、后续逐像素比对（pixelmatch 引擎，[官方文档](https://playwright.dev/docs/test-snapshots)）。

| 维度 | 画像 |
|---|---|
| 发现缺陷类别 | 布局破坏、样式回归、组件渲染错乱、截断/溢出、主题色偏移——**断言写不出来但一眼假的缺陷**；对 AI-Native 团队尤其重要：diff 图是人类高层指挥者最省时间的缺陷呈现形态 |
| 误报率 | **高（若不治理）**：官方明示"Screenshots differ between browsers and platforms"——字体、抗锯齿、动画、光标都是噪声源。治理手段全部内建：`animations` 默认 `"disabled"`（CSS 动画禁用、无限动画取消）、`caret` 默认 `"hide"`、`mask`/`maskColor` 遮罩动态区、`stylePath` 注入样式隐藏动态元素、`threshold`（默认 0.2，感知色差）与 `maxDiffPixels`/`maxDiffPixelRatio` 容差（[API 文档](https://playwright.dev/docs/api/class-pageassertions)）；鼠标先 `page.mouse.move(-1,-1)` 避免 hover 残影。**根治环境漂移**：基线的生成与比对都固定在 devenv 的同一容器镜像内完成——社区与实践共识是"generate baselines inside the CI container"（[Playwright issue #20097](https://github.com/microsoft/playwright/issues/20097)、[Argos 跨平台差异分析](https://argos-ci.com/blog/playwright-screenshots-differ-macos-linux)、[Momentic Docker 指南](https://momentic.ai/blog/playwright-docker-guide)）。我们的"宿主机只存代码"约束天然强制了这一点，是架构红利 |
| 落地成本 | **中**。写用例便宜；贵在**基线治理**（何时允许更新基线：`--update-snapshots` 必须走审查）。开源审阅工作流可选 Argos CI（开源，Playwright/Vitest 集成，PR 上审阅 diff，官方定位支持"review the product, not just the code"包括 AI agent 审阅，[argos-ci.com](https://argos-ci.com)、[GitHub](https://github.com/argos-ci/argos)）；BackstopJS（自托管、Docker 渲染、无内建审阅流，[garris/BackstopJS](https://github.com/garris/backstopjs)）为备选；Lost Pixel 据竞品对比称已在停止运营（[Argos 2026 对比](https://argos-ci.com/blog/best-visual-regression-testing-tools)，单一来源需自行核实），不建议新引入 |
| agent 驱动方式 | **输入生成**：agent 为每个 charter 选择截图点位（关键页面/状态）与 mask 策略。**"收缩"**：视觉域没有自动收缩，替代物是 diff 热区图 + `maxDiffPixels` 逐级收紧定位是全局漂移还是局部缺陷。**归因**：失败截图 + trace.zip（每步动作的 DOM 快照/网络/console，[Trace Viewer](https://playwright.dev/docs/trace-viewer-intro)）+ `--update-snapshots` 前后对比，构成机器可读的归因包 |

### 2.7 LLM agent 会话探索 —— SBTM 的自动化变体

**定位**：把 Session-Based Test Management（Bach 兄弟提出，[Wikipedia](https://en.wikipedia.org/wiki/Session-based_testing)）的四要素**全部结构化为机器工件**：charter（任务书）→ session（时间盒，传统 60–90 分钟，[Testpad 介绍](https://testpad.com/session-based-test-management)）→ session sheet（会话记录：发现的缺陷/风险/疑问）→ debrief（复盘，传统用 PROOF 框架，改为 agent 间评审 + 人类高层抽查）。agent 会话 = "charter 输入 + 上述引擎按需调用 + 结构化报告输出"。

| 维度 | 画像 |
|---|---|
| 发现缺陷类别 | 跨系统语义缺陷（"上传的文件在地图上显示在错误位置"）、数据一致性、可用性/内容错误、确定性工具够不到的"需要意图"的路径 |
| 误报率 | **最高，且是当前业界最大风险点**：WebProber（VLM 驱动，基于 Browser-Use）在 120 个站点发现 29 个可用性问题、标注子集检出率 59.4%，但**85% 的报告是误报**（多源于浏览器自动化框架的不可靠，[arXiv:2509.05197](https://arxiv.org/html/2509.05197v1)）；ATA 对比研究显示最好实现（PinATA）正确判定率约 60%、特异性 94%，作者结论"有前景但尚不成熟"（[arXiv:2504.01495](https://arxiv.org/pdf/2504.01495)）。**因此 agent 会话产物绝不能直接进缺陷报告，必须过复现门禁** |
| 落地成本 | 高（会话编排、charter 库、报告 schema），但我们的执行者本来就是 agent，边际成本主要是治理设计而非工具采购 |
| agent 驱动方式 | **输入生成**：charter 由人类高层指挥或由上次 session sheet 派生（SBTM 的 charter 天然是"给 agent 的任务书"）；**失败收缩**：agent 对可疑现象先尝试最小化复现（这是它相对确定性引擎的短板）；**归因**：全程 trace.zip + HAR + console + 录像，session sheet 记录"做了什么/看到了什么/疑点在哪"，debrief 阶段产出缺陷报告草稿 |

---

## 3. 候选组合与引入顺序

| 阶段 | 引入物 | 前置依赖 | 探索产出形态 | 退出信号（验收） |
|---|---|---|---|---|
| **P0（随 e2e 基座）** | fast-check + `@fast-check/vitest` | 无（纯库） | 失败 = seed/path + 最小反例 | 首批领域属性（序列化往返、坐标计算、权限规则）接入；任一失败可一条命令重放 |
| **P1** | Schemathesis（stateless→stateful） | OpenAPI spec 成为一等公民；探索数据键空间 | 失败 = curl 重现器 + crash 文件 | 冒烟一个服务的契约探索；`st replay` 验证闭环 |
| **P2** | Playwright `toHaveScreenshot` + 容器内基线 | e2e 执行器（独立服务）内固定渲染镜像 | diff 图 + trace.zip | 基线生成/比对均在容器内；一次人为注入样式缺陷被捕获且无误报 |
| **P3** | fast-check 模型化旅程（API command → UI command） | P0 的 command 抽象；P1 提供数据工厂 | 失败 = 最小命令序列（replayPath） | 一条业务线（如"任务创建→分配→完成"）模型化，注入序列缺陷被收缩定位 |
| **P4** | gremlins.js monkey 会话 + agent charter 会话（SBTM 变体） | P1–P3 的引擎可被 agent 调用；缺陷报告 schema 落地 | session sheet + 引擎工件 + 复现门禁过滤后的报告 | 一次完整 charter 会话产出结构化 session sheet，误报被门禁拦截止于 triage |

**可选增强（不占主线）**：Jazzer.js 对高价值纯模块（几何计算、文件解析）做覆盖率引导 fuzz，fuzz target 由 agent 按 OSS-Fuzz-Gen 模式生成；RESTler/RAFT 替换或补充 Schemathesis 做安全向深探索；OWASP ZAP 安全专项会话。

**明确不引入**：GraphWalker（无收缩、JVM 工具链，能力被 P1/P3 覆盖）；jsfuzz（维护停滞）；Lost Pixel（疑似停止运营）。

---

## 4. 与毕业流水线的衔接设计（供 Grilling 机制设计采用）

**核心命题：探索引擎的失败工件 → 统一缺陷报告 schema → 复现门禁 → 毕业命令 → 复现用例（单向）。**

1. **统一缺陷报告 schema（探索产物标准形态）**。每条探索发现落为一条 JSON 记录：`{ engine, charter/property 描述, reproducibility: { seed, path?, replayPath?, curl?, replay_cmd }, evidence: { trace.zip?, diff 图?, HAR?, 响应体 }, suspected_area, sanitized: false }`。各引擎映射：
   - fast-check → `seed`/`path`/`replayPath` + 反例值；
   - Schemathesis → crash 文件 + curl 重现器 + `st replay` 命令；
   - RESTler（若引入）→ bug bucket + replay log；
   - 视觉 → 基线/diff/实际三图 + trace.zip + mask 策略；
   - agent 会话 → session sheet + 引擎工件引用。
   这正好实现"缺陷报告 + 可复现脚本草案"：**reproducibility 字段就是脚本草案的机器形态**。

2. **复现门禁（毕业前置条件，二选一或叠加）**：
   - **确定性引擎**（PBT/契约 fuzz/模型化）：seed 重放 1 次即可（确定性 100%），门禁退化为"确认非 spec 债务"；
   - **非确定引擎**（视觉/monkey/agent 会话）：同一 reproducibility 工件在**独立数据键空间重放 ≥3 次全部失败**才可进 triage。依据：Google 大型测试 14% flaky 率说明 e2e 类失败天然不稳，必须过滤；WebProber 85% 误报说明 agent 报告必须复验。

3. **归因自动化**：agent 拿 defect report 的 evidence（trace.zip 的逐步 DOM/网络/console、HAR、日志）执行归因流程，产出报告草稿（现象/疑似根因/影响面/最小复现步骤），人类只做高层裁决——对应 AI-Native 的"人类高层指挥"分工。

4. **毕业转写**：`devenv` 提供 `graduate` 命令把 defect report 转写为复现轨道用例——fast-check 属性直接固化（保留 seed 作为首个用例）；curl/请求序列固化为 API 复现用例；视觉 diff 固化为 `toHaveScreenshot` 用例（diff 后截图为新基线）；command 序列固化为 Playwright 脚本。**转写后打标记、加只读保护，反向（复现→探索）在工具与制度上双禁止**（与地图硬不变量 3 对齐）。

5. **调度与并发**（呼应地图"Not yet specified"项）：探索会话以 charter 为单位认领（与 issue tracker 的 agent 认领同构）；每个会话独占数据键空间（独立 DB/bucket），Schemathesis 官方对 disposable environment 的要求恰好被现有隔离设计满足；会话工件（含 seed）全部落库，任何失败可被第三个会话独立复验。

6. **与 triage 标签衔接**：探索产物过门禁后以 `needs-triage` 进入 issue tracker；信息不全（复现失败/环境不可重建）→ `needs-info`；确认后按既有人类/agent 分工流转。

---

## 5. 来源

### 一手来源（官方文档 / 论文 / 官方仓库）

- fast-check（属性测试）：[官网](https://fast-check.dev/) · [GitHub README（shrinking/seed/model-based/竞态）](https://github.com/dubzzz/fast-check) · [Model based testing 文档](https://fast-check.dev/docs/advanced/model-based-testing) · [生态页（JSON Schema 集成）](https://fast-check.dev/docs/ecosystem) · [@fast-check/vitest](https://www.npmjs.com/package/@fast-check/vitest) · [Vitest 集成教程](https://fast-check.dev/docs/tutorials/setting-up-your-test-environment/property-based-testing-with-vitest) · [json-schema-fast-check](https://github.com/meeshkan/json-schema-fast-check)
- Schemathesis（API 契约探索）：[官方文档首页](https://schemathesis.readthedocs.io/) · [Stateful Testing](https://schemathesis.readthedocs.io/en/stable/explanations/stateful/) · [Data Generation（负面测试）](https://schemathesis.readthedocs.io/en/stable/explanations/data-generation/) · [Replaying Failures](https://schemathesis.readthedocs.io/en/stable/guides/crash-reproduction) · [CLI 教程](https://schemathesis.readthedocs.io/en/stable/tutorials/cli) · [GitHub](https://github.com/schemathesis/schemathesis) · [ACM 论文：Schemathesis 4](https://dl.acm.org/doi/10.1145/3786155.3795697)
- RESTler / RAFT（状态化 API fuzz 对照）：[microsoft/restler-fuzzer](https://github.com/microsoft/restler-fuzzer) · [REST-ler 论文 arXiv:1806.09739](https://arxiv.org/abs/1806.09739) · [Checkers 文档](https://github.com/microsoft/restler-fuzzer/blob/main/docs/user-guide/Checkers.md) · [microsoft/rest-api-fuzz-testing（RAFT，GitHub Actions 集成）](https://github.com/microsoft/rest-api-fuzz-testing)
- Playwright（视觉回归 / 归因）：[Visual comparisons](https://playwright.dev/docs/test-snapshots) · [PageAssertions API（animations/caret/mask/threshold 默认值）](https://playwright.dev/docs/api/class-pageassertions) · [Trace Viewer](https://playwright.dev/docs/trace-viewer-intro) · [截图跨环境差异 issue #20097](https://github.com/microsoft/playwright/issues/20097)
- gremlins.js（UI monkey fuzz）：[GitHub](https://github.com/marmelab/gremlins.js) · [Gremlins 2 发布文（marmelab）](https://marmelab.com/blog/2020/06/02/gremlins-2.html)
- Jazzer.js（覆盖率引导 fuzz）：[GitHub](https://github.com/CodeIntelligenceTesting/jazzer.js) · [Jest 集成报道（SD Times）](https://sdtimes.com/software-development/code-intelligence-introduces-integration-of-jazzer-js-into-jest)；对照 jsfuzz：[GitHub](https://github.com/fuzzitdev/jsfuzz)
- OSS-Fuzz-Gen（LLM 生成 fuzz target 的可行性证据）：[官方博客](https://blog.oss-fuzz.com/posts/introducing-llm-based-harness-synthesis-for-unfuzzed-projects) · [GitHub](https://github.com/google/oss-fuzz-gen) · [Google Security Blog：AI-powered fuzzing](https://security.googleblog.com/2023/08/ai-powered-fuzzing-breaking-bug-hunting.html) · [LLM 生成驱动效果研究（SMU）](https://ink.library.smu.edu.sg/cgi/viewcontent.cgi?article=10508&context=sis_research)
- agent 测试有效性（误报率量化）：[Are Autonomous Web Agents Good Testers? arXiv:2504.01495](https://arxiv.org/pdf/2504.01495) · [WebProber: AI Agents for Web Testing, arXiv:2509.05197](https://arxiv.org/html/2509.05197v1)
- flaky 率数据（门禁依据）：[Flaky Tests at Google（2016）](https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html) · [Where do our flaky tests come from?（2017）](https://testing.googleblog.com/2017/04/where-do-our-flaky-tests-come-from.html)
- SBTM：[Session-based testing（Wikipedia）](https://en.wikipedia.org/wiki/Session-based_testing) · [Testpad：SBTM 四要素](https://testpad.com/session-based-test-management)
- 视觉回归审阅工具：[Argos CI 官网](https://argos-ci.com) · [Argos GitHub](https://github.com/argos-ci/argos) · [Argos：Playwright 截图跨平台差异](https://argos-ci.com/blog/playwright-screenshots-differ-macos-linux) · [BackstopJS](https://github.com/garris/backstopjs) · [Momentic：Playwright Docker 指南](https://momentic.ai/blog/playwright-docker-guide)
- GraphWalker（对照，不引入）：[官方站](https://graphwalker.github.io/) · [GW4E：random walk 生成器](https://gw4e.github.io/mydoc_nutshell.html)
- OWASP ZAP（可选安全会话）：[Fuzzer 官方文档](https://www.zaproxy.org/docs/desktop/addons/fuzzer)

### 过程参考（二手，仅背景）

- [gremlins.js + Playwright 实践（Medium）](https://medium.com/@kbalji.kks/web-app-resilience-monkey-testing-with-gremlins-js-and-playwright-1a9024564053) · [CSS-Tricks：monkey testing 入门](https://css-tricks.com/intro-monkey-testing-gremlins-js) · [Capital One：Schemathesis 实践](https://www.capitalone.com/tech/software-engineering/api-testing-schemathesis) · [diffy.website：截图在本地/CI/Docker 差异](https://diffy.website/blog/playwright-screenshots-ci-docker)
