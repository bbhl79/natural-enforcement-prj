# Research：版本矩阵与镜像基座调研（2026-11-16）

- 对应票：#5（Research-版本矩阵与镜像基座调研），父地图 #1
- 调研时点：2026-11-16
- 方法：全部结论取自一手来源（官方发布时间表/发布公告/官方文档/GitHub Releases/Docker Hub Tags API），每条附来源链接。调研分支：`research/version-matrix`。
- 项目约束（来自地图 #1）：宿主机只存代码、devenv 唯一入口、agent DX（确定性、机器可解析、快速失败）、技术栈已定（React+Vite / NestJS+Prisma / PostGIS / Redis+BullMQ / rustfs，TypeScript 6）。

---

## 一、锁定版本矩阵表

| 组件 | 推荐版本（锁定值） | 选择理由 | 来源 |
|---|---|---|---|
| Node.js 运行时 | **26 LTS "Lithium"**，当前 26.13.1（备选：24 LTS "Krypton" 24.22.3） | 2026-10-28 进入 Active LTS，维护至 2029-04-30，是支持窗口最长的 LTS；Node 官方明确"生产只用 Active/Maintenance LTS"；NestJS 12 CLI 明确要求 v22.22.3+/v24.15+/v26+（26 在列）。备选 24 处于 Maintenance（至 2028-04-30），在 Prisma 文档版本范围字符串内，是最保守回退 | [nodejs/Release schedule.json](https://github.com/nodejs/release/blob/main/schedule.json)、[nodejs.org 已发布版本](https://nodejs.org/en/about/previous-releases)、[NestJS 迁移指南](https://docs.nestjs.com/migration-guide) |
| TypeScript | **6.0（最新补丁 6.0.3）** | 6.0 于 2026-03-23 发布，是 JS 版编译器最后一条发布线，定位为 5.9→7.0 的"桥"；与 NestJS 12 的 peer 依赖（`typescript@^6`）一致；Prisma 要求 TS ≥5.4（推荐 5.9+），6.0 高于下限。TS 7.0（原生 Go 编译器）已于 2026-07 GA（7.0.2，2026-08-20），7.1 Beta 2026-10-20——按地图已定技术栈先锁 6.x，7 作为后续提速选项 | [TS 6.0 公告](https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/)、[TS 7.0 公告](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)、[TypeScript Releases](https://github.com/microsoft/TypeScript/releases)、[NestJS 迁移指南](https://docs.nestjs.com/migration-guide) |
| NestJS（TS6 的落地约束） | **12.x**（v12.5.0，2026-11-12） | 12 是唯一以 TS 6 为 peer 依赖的主线（@nestjs/schematics v12 requires TypeScript 6）；核心包 ESM-only（CJS 应用可经 require(esm) 继续用）；monorepo 默认构建器改 Rspack；ESM 项目默认测试器 Vitest | [NestJS 迁移指南](https://docs.nestjs.com/migration-guide)、[nestjs/nest releases](https://github.com/nestjs/nest/releases) |
| Prisma | **7.x** | v7 默认 Rust-free 架构（新 `prisma-client` provider + queryCompiler + driver adapter 如 `@prisma/adapter-pg`），官方称更快、bundle 更小，且**大幅消解 alpine/musl 引擎兼容问题**；系统要求：Node ^20.19.0 / ^22.12.0 / ^24.0.0（政策为"支持全部 Active/Maintenance LTS"，见风险 1）；TS ≥5.4；libc 要件 glibc 或 musl（Alpine musl 1.2.x + OpenSSL 1.1.x/3.x，amd64/arm64 均支持） | [Prisma 7 升级指南](https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-7)、[Prisma 系统要求](https://www.prisma.io/docs/orm/reference/system-requirements) |
| Node 基础镜像变体 | **`node:26.13.1-slim`**（= trixie-slim，amd64 约 86MB；备选 `26.13.1-alpine3.24` 约 63MB） | slim 为 glibc 基座：Prisma 与其他原生 npm 依赖零特判、诊断/工具链兼容面最大；alpine 为 musl：Prisma 官方支持（musl 1.2.x + OpenSSL），但个别原生 npm 模块可能缺 musl prebuilt。默认 Debian 基座已切换为 trixie。体积差约 23MB，不足以抵消特判成本，基座定 slim | [Docker Hub node tags](https://hub.docker.com/_/node)、[Prisma 系统要求](https://www.prisma.io/docs/orm/reference/system-requirements) |
| PostgreSQL + PostGIS | **`postgis/postgis:18-3.6`**（保守回退 `17-3.5`） | PG 18 为当前 GA 大版本（19 仅 rc1/rc2 预览）；PostGIS 3.6.0 于 2025-09-02 发布，已有一年以上成熟度；PostGIS 3.7.0 于 2026-11-16（调研当日）刚发布，不锁。18-3.6 tag 最近更新 2026-10-26 | [PostGIS 3.6.0 公告](https://postgis.net/2025/09/PostGIS-3.6.0/)、[postgis/postgis tags](https://hub.docker.com/r/postgis/postgis/tags) |
| Redis | **`redis:8.2.11`**（-alpine3.22 变体可选；队列场景建议 alpine） | 8.2 是最成熟的 8.x 维护线（2025-07 起、第 11 个补丁、2026-10-26/11-12 仍在打补丁）；BullMQ 仅要求 Redis ≥6.2，兼容裕度充足；许可：Redis ≥8.0 起三重许可 RSALv2/SSPLv1/**AGPLv3** 三选一（重新开源），自托管内部使用无合规障碍；BullMQ 官方确认 Valkey/Dragonfly 兼容，留有出路。8.10.3 为最新稳定线、8.12 已到 rc3，均可作升级路径 | [Redis 许可证说明](https://redis.io/legal/licenses/)、[redis/redis releases](https://github.com/redis/redis/releases)、[Docker Hub redis tags](https://hub.docker.com/_/redis)、[BullMQ Introduction](https://docs.bullmq.io/guide/introduction) |
| BullMQ | **6.7.x**（v6.7.6，2026-11-12） | v6 主线（6.0.0 发布于 2026-07-30）引入可插拔队列后端（Redis 默认 / PostgreSQL 可选）；官方兼容矩阵："works with Redis 6.2 or newer and compatible servers such as Valkey and Dragonfly"；运行时 Node ≥14.17 | [BullMQ v6.0.0 发布说明](https://github.com/taskforcesh/bullmq/releases/tag/v6.0.0)、[BullMQ Releases](https://github.com/taskforcesh/bullmq/releases)、[BullMQ Introduction](https://docs.bullmq.io/guide/introduction) |
| rustfs（对象存储） | **`rustfs/rustfs:1.0.6`** | 1.0.0 GA 于 2026-09-16，1.0.6（2026-11-15）为最新稳定版；默认镜像为 musl 静态二进制（amd64 约 136MB，另有 `-glibc` 变体约 195MB，均支持 amd64/arm64）；项目经 S3 API 访问，无原生绑定顾虑；仓库活跃（36k+ stars，调研当日仍有提交） | [rustfs releases](https://github.com/rustfs/rustfs/releases)、[rustfs/rustfs tags](https://hub.docker.com/r/rustfs/rustfs/tags) |

## 二、镜像 tag 锁定策略建议

1. **禁止浮动 tag**：一律不使用 `latest`、裸大版本（`node:26`）或裸变体（`26-slim`）。compose 中写完整语义版本 tag：
   `node:26.13.1-slim`、`postgis/postgis:18-3.6`、`redis:8.2.11-alpine`、`rustfs/rustfs:1.0.6`。
2. **双层锁定（tag + digest）**：完整版本 tag 之上再叠加 digest 锁定（`image: tag@sha256:…`），统一收敛到一份集中锁文件（如 `devenv/images.lock`，机器可解析格式）。理由：postgis/postgis 官方**只有 `{PG}-{PostGIS}` minor 级 tag，没有完整 patch tag**（`18-3.6` 会在 minor 内浮动补丁，2026-10-26 就更新过一次），digest 是唯一能保证字节级确定的手段；对其余镜像 digest 锁定可防同名 tag 被覆盖。
3. **devenv 封装升级**：版本变更只发生在锁文件，由 devenv 提供 `bump/lock` 类命令（输出当前/目标 tag+digest，JSON 等机器可解析格式），升级一律走 PR + e2e 毕业演练，与地图"多 agent 并发"约束下的一致性对齐。
4. **Node 主备双轨**：锁文件同时记录 26（主）与 24（备）两行完整 tag，Prisma 兼容性若在原型期实测不过，切换成本仅为改锁文件一行 + 重建。
5. **数据类服务（PostGIS/Redis/rustfs）与应用镜像（node）解耦锁定**：数据服务版本变更需附带数据迁移评估（PostGIS minor 升级、RDB/AOF 兼容、bucket 结构），不允许随应用版本顺手升级。

## 三、风险与注意点

1. **Node 26 刚进入 Active LTS（2026-10-28，约 3 周）**：个别依赖的"支持版本范围字符串"滞后——Prisma 系统要求页写 `^20.19.0, ^22.12.0, ^24.0.0`，未列 26，但其政策是"官方支持并测试所有 Active LTS 和 Maintenance LTS"。缓解：原型子票（完整集成验证）实测 Prisma 7 + Node 26；不过则回退 24.22.3（在范围字符串内）。
2. **TS 6.0 默认值与废弃项**：新默认 `strict:true`、`module:esnext`、`target:es2025`、`noUncheckedSideEffectImports:true`、`libReplacement:false`；`rootDir` 默认为 tsconfig 所在目录；`types` 默认 `[]`（不再自动加载全部 @types，官方称合理设置可提速 20–50%）。一批选项已废弃、TS 7 将彻底移除：`target:es5`/`downlevelIteration`、`moduleResolution: node|classic`、`module: amd/umd/systemjs/none`、`baseUrl`、`esModuleInterop:false`、`alwaysStrict:false`、`outFile`、旧式 `module Foo {}` 命名空间、import assertions、`no-default-lib` 指令。新项目 tsconfig 直接按 6.0 语义从零编写（不搬 5.x 配置），一次性规避 7.0 移除项；官方迁移工具 [ts5to6](https://github.com/andrewbranch/ts5to6) 可参考其规则。
3. **TS 7 在途**：原生编译器 7.0 已 GA、7.1 在 Beta，仅支持 6.0 语言语义的子集过渡已完成（6.0 即对齐版）。锁 6.x 不阻塞后续切 7 换取约 10 倍编译提速，但需 NestJS/Rspack/Vitest 生态就绪后再评估。
4. **Prisma 7 迁移面**：包为 ESM-only（`"type":"module"`）、generator 必须用 `prisma-client` 且 `output` 必填（不再生成进 node_modules）、配置迁至 `prisma.config.ts`、不再自动加载 `.env`——环境变量注入方式需与 devenv 设计对齐；PG 连接走 `@prisma/adapter-pg`，注意底层 node-pg 默认无连接超时。
5. **NestJS 12 注意**：核心包 ESM-only（CJS 应用经 require(esm) 仍可用，但 Lambda/旧 Node 有坑）；`@Optional()` 继承、生命周期钩子顺序、Terminus API、Config validationSchema（Standard Schema，Joi ≥18）等有破坏性变更；若留用 Jest 加载 ESM 包需 Node ≥24.9——这也是选 Node 26 的又一理由。`nest upgrade --dry-run` 可先出迁移报告（agent 友好）。
6. **alpine（musl）vs slim（glibc）**：Prisma 官方对 Alpine（musl 1.2.x + OpenSSL 1.1.x/3.x，amd64/arm64）明确支持，且 v7 默认无 Rust 引擎后主要兼容风险已消除；但 musl 生态下其他原生 npm 模块（如有）偶有缺 prebuilt、以及运行时诊断工具链兼容性的尾部风险。结论：基座统一 `slim`，alpine 不作为默认。
7. **Redis 版本线密集**：当前并行维护 8.2/8.4/8.6/8.8/8.10 五条 minor 线（2026-10-26 同日打补丁），8.12 已到 rc3。锁 8.2.11 即最成熟线；BullMQ 只要求 ≥6.2，无版本压力。许可证：≥8.0 可选 AGPLv3，自托管场景（本项目 e2e/开发）无再分发义务风险；若未来对 AGPL 敏感，BullMQ 官方兼容 Valkey，可平替。
8. **BullMQ v6 破坏性变更**：`ioredis` 不再是直接依赖，改为可选 peer——**需显式安装 ioredis**（或选 node-redis/GLIDE 适配器）；legacy repeatable jobs（`Queue#add` 的 repeat、`getRepeatableJobs` 等）已移除，周期任务一律用 Job Schedulers；`Queue#client` 等 Redis 内部接口收进 backend 抽象。队列代码从 v6 语义写起即可，无历史包袱。
9. **rustfs 节奏快**：1.0.0→1.0.6 仅两个月，补丁频繁（有时隔天）。锁 1.0.6 + digest；e2e 必须覆盖上传/下载往返（地图已要求），升级走锁文件 PR。
10. **当日新发布不锁定**：PostGIS 3.7.0（2026-11-16 发布）与 PG 19（rc 阶段）均不进入基座，作为后续升级候选。

## 来源总表

- Node.js 发布时间表（schedule.json）：https://github.com/nodejs/release/blob/main/schedule.json
- Node.js 已发布版本状态：https://nodejs.org/en/about/previous-releases
- TypeScript 6.0 公告：https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/
- TypeScript 7.0 公告：https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
- TypeScript Releases：https://github.com/microsoft/TypeScript/releases
- ts5to6 迁移工具：https://github.com/andrewbranch/ts5to6
- NestJS 12 迁移指南：https://docs.nestjs.com/migration-guide
- NestJS Releases：https://github.com/nestjs/nest/releases
- Prisma 系统要求（OS/Node/TS、Alpine musl 支持）：https://www.prisma.io/docs/orm/reference/system-requirements
- Prisma 7 升级指南（Rust-free、driver adapters、ESM）：https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-7
- Docker Hub node tags（变体与体积）：https://hub.docker.com/_/node
- PostGIS 3.6.0 发布公告：https://postgis.net/2025/09/PostGIS-3.6.0/
- Docker Hub postgis/postgis tags：https://hub.docker.com/r/postgis/postgis/tags
- Redis 许可证（三重许可）：https://redis.io/legal/licenses/
- redis/redis Releases：https://github.com/redis/redis/releases
- Docker Hub redis tags：https://hub.docker.com/_/redis
- BullMQ 官方文档 Introduction（Redis ≥6.2、Valkey/Dragonfly 兼容）：https://docs.bullmq.io/guide/introduction
- BullMQ v6.0.0 发布说明（破坏性变更）：https://github.com/taskforcesh/bullmq/releases/tag/v6.0.0
- BullMQ Releases：https://github.com/taskforcesh/bullmq/releases
- rustfs Releases：https://github.com/rustfs/rustfs/releases
- Docker Hub rustfs/rustfs tags：https://hub.docker.com/r/rustfs/rustfs/tags
