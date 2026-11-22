# 调研索引与结论汇总（2026-11 批次）

本目录是地图 [#1（工程基座与e2e体系SPEC制定）](https://github.com/bbhl79/natural-enforcement-prj/issues/1) 下七张 research 子票（#2–#8）的产物沉淀位（对应 `ai-native-repo.md` 可借鉴清单 D7）。报告全文经 `--no-ff` 合并入库，原始 commit（作者/时间/调研会话证据）保留在 git 历史；原 `research/*` 分支已清理。

- 调研时点：2026-11-16/17；复核时点：2026-11-19（复核结果见下）
- 各报告只对「调研时点」负责；本索引的速览表是当前唯一有效的决策口径，与报告正文冲突时以本索引（含勘误）为准。

## 一、锁定决策速览（供 SPEC 与原型直接引用）

### 版本矩阵（详情：[version-matrix.md](version-matrix.md)）

| 组件 | 锁定值 | 备注 |
| --- | --- | --- |
| Node.js | **26 LTS（26.13.1）**，镜像 `node:26.13.1-slim` | Active LTS 至 2029-04；备选 24（Prisma 兼容性回退轨） |
| TypeScript | **6.0.x**（6.0.3） | TS 7.0 已 GA 但生态未就绪，仅作后续提速项；新 tsconfig 按 6.0 语义从零写 |
| NestJS | **12.x** | 唯一以 `typescript@^6` 为 peer 的主线；核心包 ESM-only |
| Prisma | **7.x**（@prisma/client 7.10.1） | Prisma 8 仍 RC（复核：8.0.0-rc.34，stable 未发布），不押 RC |
| PostgreSQL + PostGIS | `postgis/postgis:18-3.6` | 保守回退 `17-3.5` |
| Redis | `redis:8.2.11` | ≥8.0 三重许可（含 AGPLv3 可选项），自托管无障碍 |
| BullMQ | **6.7.x** | 要求 Redis ≥6.2；ioredis 需显式安装；周期任务用 Job Schedulers |
| rustfs | `rustfs/rustfs:1.0.6` | Apache-2.0；dev/e2e 用途，不承诺生产 |
| Playwright | **1.65.1** + `mcr.microsoft.com/playwright:v1.65.1-noble` | npm 包与镜像 tag 严格同版本；Alpine 不可用 |
| pnpm / Turborepo | **12.21.0 / 2.11.x** | 见 monorepo 决策 |

镜像锁定策略：完整版本 tag + digest 双层锁，统一收敛到集中锁文件；数据服务与应用镜像解耦升级；升级一律 PR + e2e 演练。

### 工程决策（各报告一句话结论）

| 领域 | 决策 | 详情 |
| --- | --- | --- |
| monorepo | pnpm workspaces（catalogs + tasks）基座 + Turborepo 编排/缓存层；Nx 暂缓（4 条重评估触发条件）；包名 `@ne/*`；NestJS 不用 nest-cli monorepo mode | [monorepo-tooling.md](monorepo-tooling.md) |
| Prisma×PostGIS | Prisma 7 + `Unsupported("geography(Point,4326)")?` 占位 + `migrate dev --create-only` 双轨迁移 + `$queryRaw`/ST_DWithin；dev 库 `migrate dev`、e2e 库 `migrate deploy`；migrations 目录是唯一版本真相 | [prisma-postgis.md](prisma-postgis.md) |
| 对象存储 | dev/e2e 采用 rustfs 单节点（named volume、mem_limit 1g、/health 健康检查、禁 canned ACL）；访问收敛到单一 storage 适配模块；备选顺序 Garage → SeaweedFS；MinIO 社区版已归档停维护，排除 | [rustfs.md](rustfs.md) |
| e2e 执行 | 官方 noble 镜像 + `--init` + `--ipc=host`；数据隔离三层模型（run 级键空间 + 幂等种子 + 测试唯一命名免重置）；CI 走 devenv 起完整栈 + mcr 容器跑 e2e；失败消费链 JSON(onlyFailures) → trace.zip → agent-cli attach | [playwright-e2e.md](playwright-e2e.md) |
| 探索轨道 | 五层组合按确定性递减引入：P0 fast-check → P1 Schemathesis → P2 视觉回归 → P3 模型化随机旅程 → P4 gremlins.js + agent 会话（SBTM 变体）；统一缺陷报告 schema + 复现门禁（非确定引擎重放 ≥3 次）接通单向毕业 | [exploratory-testing.md](exploratory-testing.md) |
| AI-native 工程 | AGENTS.md 极简 + 命令表；devenv 命令面 12 条 / 脚手架 7 条 / 文档结构 8 条可借鉴清单（P0/P1/P2 分级） | [ai-native-repo.md](ai-native-repo.md) |

## 二、复核结论（2026-11-19）

对七份报告的关键事实做了独立抽查（npm dist-tags、Docker Hub tag API、MCR tag list、GitHub API），**全部通过，无一失实**：

| 断言 | 报告值（11-16） | 复核值（11-19） | 结论 |
| --- | --- | --- | --- |
| pnpm latest | 12.21.0 | 12.21.0 | ✅ |
| turbo latest | 2.11.11 | 2.11.13 | ✅ 同一 2.11.x 线 |
| TypeScript latest | 7.0.2（6.0.3 为 JS 编译器终线） | 7.0.2 | ✅ 与「锁 6.0.x」决策前提一致 |
| prisma CLI | 8.0.0-rc.33，无 stable | 8.0.0-rc.34，仍无 stable | ✅ 「Prisma 7 主线」决策维持 |
| @prisma/client latest | 7.10.1 | 7.10.1 | ✅ |
| @prisma/orm-extension-postgis | 8.0.0-rc.23 | 8.0.0-rc.24 | ✅ 仍 RC |
| @playwright/test latest | 1.65.1 | 1.65.1 | ✅ |
| BullMQ latest | 6.7.6 | 6.7.8 | ✅ 同一 6.7.x 线 |
| `node:26.13.1-slim` | 存在 | Docker Hub 200 | ✅ |
| `postgis/postgis:18-3.6` | 存在 | Docker Hub 200 | ✅ |
| `redis:8.2.11` | 存在 | Docker Hub 200 | ✅ |
| `rustfs/rustfs:1.0.6` | 存在（11-15 推送） | 存在，且仍为最新 release | ✅ |
| `mcr…playwright:v1.65.1-noble` | 存在 | 存在（含 amd64/arm64 变体） | ✅ |
| MinIO 社区版归档 | 2026-04-25 归档 | `archived: true` | ✅ rustfs 选型地基成立 |

## 三、勘误（报告间不一致修正）

报告原文保持调研时点原样（primary source 不事后改写），以下四处以本索引为准：

1. **monorepo-tooling.md §5.2** 样例 catalog 写 `"@nestjs/core": ^11.x` —— 与版本矩阵（NestJS 12 为 TS6 唯一主线）矛盾。**正确口径：`@nestjs/core: ^12.x`**（该样例本就注明「以 2026-11 实际锁定版本为准」）。
2. **prisma-postgis.md §3.3** 注释推荐镜像 `postgis/postgis:17-3.5` —— 版本矩阵已锁定 **`postgis/postgis:18-3.6`**（17-3.5 仅为保守回退备选）。以版本矩阵为准。
3. **exploratory-testing.md** 头部「供『Grilling-e2e生命周期机制设计』（#8 等）采用」为编号笔误，该 grilling 票现为 **#10**。
4. **exploratory-testing.md §1/§2.7/§4** 引用 WebProber「85% 误报率」与 Google 14% flaky 并列为复现门禁的量化依据 —— 经核实原始论文（arXiv:2509.05197 §4.2），85% 是 120 个**静态学术个人主页**上 agent 裸跑（无复现机制）报告条目的误报占比，误报主因是浏览器自动化框架自身限制；场景与本项目（探索任务书约束、受控容器浏览器、trace 证据、复现门禁）差异大。**正确口径：仅作"agent 原始报告不可直接采信、须过门禁"的方向性佐证，不用于阈值推导**；"≥3 次"定位为检查预算而非证明（见 Spec-e2e体系 §5）。

## 四、消费指引（谁读哪份）

| 子票 | 应取用的材料 |
| --- | --- |
| #9 Grilling-monorepo布局与契约共享 | monorepo-tooling.md §5（目录树/turbo.json/命令面约定 + §5.4 留给 grilling 的问题清单） |
| #10 Grilling-e2e生命周期机制设计 | playwright-e2e.md §2–§4 + exploratory-testing.md §3–§4（组合、缺陷 schema、复现门禁、毕业转写） |
| #11 Prototype-环境与后端 | version-matrix.md（全表）+ rustfs.md §4（compose 片段）+ prisma-postgis.md §3–§4（schema/迁移/目录结构） |
| #12 Prototype-前端与脚手架 | ai-native-repo.md §3（C1–C12/S1–S7/D1–D8 清单）+ monorepo-tooling.md §5.1 |
| #13 Prototype-e2e双轨与CI原型 | playwright-e2e.md（全）+ exploratory-testing.md §3（P0 起步） |
| #14/#15 Grilling-SPEC 起草与批准 | 本索引速览表 + 各报告结论先行节 |
