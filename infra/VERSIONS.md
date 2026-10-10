# 地基版本定案表

定案介质 = GitHub #60（理由见 ADR-0001；书面证据 #58/#59）。锁定纪律：人读层锁 major（本表）；npm 树 patch 级由 `pnpm-lock.yaml` 承载（入库）；镜像锁显式 tag + digest（「待补」项由地基实施时现场补录，同时复测境内渠道可达性）。

| 层 | 锁定 | 定案时版本（2026-10-09） | 镜像引用 | Digest |
|---|---|---|---|---|
| 运行时 | Node 24 LTS（Krypton） | 24.21.x | `node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1`（2026-10-10 落表） | multi-arch index（amd64/arm64/s390x） |
| 语言 | TypeScript | **6.0.2**（钉死，勿追 7，见 ADR R1） | — | — |
| 包管理 | pnpm | 12.10.1（`packageManager` 字段入 lockfile 层） | — | — |
| 后端 | NestJS 12 | 12.1.2 | — | — |
| ORM/迁移 | Prisma 7 | 7.10.0（stable=prev 标签；8.0 为 rc 已排除） | — | — |
| 身份 | argon2 0.4x | 0.45.1（预编译覆盖 linux x64/arm64，容器免编译） | — | — |
| 前端 | React 19 / Redux Toolkit 2 / Tailwind CSS 4 / Vite 8 | 19.3.0 / 2.13.0 / 4.3.3 / 8.3.4 | — | — |
| 测试 | Vitest 5 / Playwright 1.64 | 5.0.3（peer vite 含 ^8.0.0 配对成立；弃 Node 20 不影响）/ 1.64.0 | `mcr.microsoft.com/playwright:v1.64.0@sha256:06a9939e57531807f8d5fd76ce44b53165ffb7d7501d87ab10e285c20b1e971f`（2026-10-10 补录；走 MCR 非 Docker Hub，境内渠道复测不适用） | amd64 `…bc72a8df…` / arm64 `…4109b399…` |
| Lint | ESLint 10 / typescript-eslint 8 | 10.12.0 / 8.71.1（与 TS 6.0.2 配对） | — | — |
| 队列 | BullMQ 6 / ioredis 6 / Redis server 8 | 6.3.12（peer ioredis>=5）/ 6.0.0 / 镜像 8 | `redis:8.10.2@sha256:2c2dff791878316e3b083188be0d578423b24813cdda5de0e80ea4f7b3e6bfd6`（2026-10-10 落表） | multi-arch index |
| 数据库 | PostgreSQL 18 × PostGIS 3.6.4 | 3.6.4（官方 supported：PG 12–18） | `postgis/postgis:18-3.6@sha256:60f6ad1d21ea86a67d47780b9a0d1e1d200500f62b19293fa834d0dea80b8677` | amd64 子镜像 `…7e00e8c3…`；**上游暂无 arm64**，见修订行 2026-10-10 |
| 文件服务 | RustFS 1 | 1.0.1（tag 已一手实证；GA 三周，E3 实测兜底） | `rustfs/rustfs:1.0.1@sha256:1803faef57627e2d9c2e7d89d655d712ddded5389040054987163043fecb6a3c` | amd64 `…7465b319…` / arm64 `…3bc0a69f…`（与 #58 研究记录一致） |
| 接入 | Nginx（官方 mainline 推荐线） | 1.29.x（具体 tag 落表时定） | `nginx:1.29.8@sha256:1881968aff6f7cdcc4b888c00a11f4ce241ad7ec957e0cb4a9e19e93a3ff87ea`（2026-10-10 落表） | multi-arch index |
| 编排 | Docker Compose v2 | 宿主前置要求（非镜像）；引擎 = Docker（Podman 已复议否决） | — | — |

## 执行纪律（强制）

1. `CREATE EXTENSION postgis` = 迁移历史**第一条**（shadow database 识别 geometry 类型的前提，Prisma 维护者官方口径 issue #7455）。
2. 空间列一律 `Unsupported("geometry…")` 透传 + `$queryRaw`/ST_ 函数；含必填空间字段的模型**禁用 ORM create/update**（官方 docs 明文）。
3. 一切镜像显式 tag + digest，**严禁 `latest`**。
4. e2e 浏览器走官方 `mcr.microsoft.com/playwright` 镜像（npmmirror 对 rev1248 Chromium x64 缺失；复核方法与最新覆盖见 `docs/research/stack-app-compat.md`）。
5. 镜像渠道：境内加速优先（实测 `docker.m.daocloud.io`、`docker.1ms.run` 覆盖 `library/node`、`postgis/postgis`；境内端到端可达性须现场复测）、Docker Hub 兜底；通道 = 宿主/CI 环境配置，**不入库**，仓库只写官方名 + digest。
6. 升级边界（跨 major，回 #60 裁决）：Prisma 8 GA（含 `@prisma/orm-extension-postgis` 原生空间路径）、TS 7.1+ 编译器 API 且 typescript-eslint 适配、Redis/Nginx 换线。同 major 内 patch/minor 调整由执行者自调并在下表追加修订行。
7. canvas-editor 不进地基（预设选型，首个文书切片自带）。

## 修订记录

- 2026-10-09：初版定案表。grilling 会话定案全集；书面腿 #58（PG×PostGIS×Prisma×RustFS）/#59（TS×Node×前端×测试×渠道）关闭销账；实测腿待 #47 E1–E7。
- 2026-10-10（#48 地基切片01 现场补录）：`redis:8`/`nginx:1.29`/`node:24` 三个浮动 tag 落定具体 tag——`redis:8.10.2`、`nginx:1.29.8`、`node:24.21.0-alpine`（Node 为 24.21.x 最新 patch）；digest 全部现场 `docker pull` + `buildx imagetools inspect` 实测补录（含 `mcr.microsoft.com/playwright:v1.64.0`，走 MCR 非 Docker Hub，境内渠道复测不适用）。`rustfs/rustfs:1.0.1` index digest 今日实测，amd64 子镜像 digest 与 #58 研究记录（`…7465b319…`）一致。镜像引用列一律完整 `tag@sha256:…` 形态，与 compose 实际引用逐字一致。
- 2026-10-10（postgis 18-3.6 digest 复核更正）：经 `docker manifest inspect -v` 核实，定案表原记 amd64 digest `20b5c713…` 实为该 tag 的 **provenance attestation manifest**（unknown/unknown，in-toto 层），原记 arm64 digest `7e00e8c3…` 实为 **amd64 子镜像**；`postgis/postgis:18-3.6` 上游当前 **仅 amd64**（Hub last_pushed 2026-08-31，复测日 2026-10-10），无 arm64。按实测更正为上表 index digest。**风险**：arm64（Apple Silicon 等）宿主暂无法拉取该库镜像，如需 arm64 开发回 #60 复议（属跨架构可用性缺口，非本表自调范围）。
- 2026-10-10（境内渠道复测）：`docker pull` 实测 **10/10 全通**——`docker.m.daocloud.io` 与 `docker.1ms.run` 两渠道 × 五镜像（postgis/postgis:18-3.6、redis:8.10.2、nginx:1.29.8、rustfs/rustfs:1.0.1、node:24.21.0-alpine）逐一直达成功。渠道属宿主配置不入库，仓库内 compose 只写官方名 + digest。
- 2026-10-10（#49 地基切片02 现场补录）：迁移/种子通道落地 `backend/prisma/`（Prisma 7.10.0，配置文件 `prisma7.config.ts`）。Prisma 7 客户端运行时三件套钉 `@prisma/client@7.10.0` + `@prisma/adapter-pg@7.10.0`（官方 driver adapter，Prisma 7 查询架构必需）+ `pg@8.23.1`（pg 8 major 内 minor 自调，依本表纪律 6 记修订）。执行纪律 1 落地：`0001_postgis_extension` 为迁移历史第一条。
- 2026-10-10（#55 地基切片08 销账）：队列栈按本表钉定版本落地——BullMQ **6.3.12**、ioredis **6.0.0** 进 `pnpm-lock.yaml`（patch 级锁定，与上表逐字一致）；`redis:8.10.2` 镜像 tag+digest 与 compose 逐字一致（切片01 已落表，本条为一致性销账）。pnpm 供应链「最小发布龄」策略对 bullmq@6.3.12 的豁免按钉定版本精确放行（`pnpm-workspace.yaml` 注释入档），非浮动取新。
- 2026-10-10（#52 地基切片05 现场补录）：argon2 **0.45.1** 进 `pnpm-lock.yaml`（根 + backend/identity 两处 importer，patch 级锁定与上表身份行逐字一致；2026-07-21 发布，最小发布龄自然满足，无需豁免）。免编译实测腿：npm 包内 prebuilds 一手核验（linux-x64 glibc/musl、linux-arm64 glibc/musl 随包分发）；工具链容器（alpine x86_64，musl）`--ignore-scripts` 安装下 hash/verify 单测 4/4 通过、种子散列实写成功——install 脚本被统一跳过时直接加载包内预编译二进制。**arm64 运行时实测未覆盖**（宿主无 binfmt/qemu，exec format error），arm64 免编译可用性依据 = 包内预编译产物 + 上游发布物，如需 arm64 实测请在 Apple Silicon 等 arm64 宿主复跑 `dev test unit`。
- 2026-10-10（#53 地基切片06 销账）：存储设施包 `packages/storage` 落地，**零新增第三方依赖**——S3 兼容 REST 客户端与 SigV4 签名基于 node:crypto + fetch 自实现（`@nestjs/common` 仅为可注入 Module 形态，版本同本表 12.1.2），RustFS SDK 依赖纪律以「不引入依赖」最强形态落实，结构测试 `storage-facility-entry` 兜底后续漂移。`rustfs/rustfs:1.0.1` 镜像 tag+digest 与 compose 逐字一致（切片01 已落表，本条为一致性销账）。E3 实测行为记录：Versioning 下原地改写/删除最新世代产生新世代（原版本按 versionId 无损读回）；对象锁 COMPLIANCE 下定点删除原版本（DELETE ?versionId=）被 403 AccessDenied 拒绝——WORM 语义与 #58 书面腿一致，E3 实测腿销账。
- 2026-10-10（#56 地基切片09 销账）：前端栈按上表钉定版本落地 frontend/——React **19.3.0** / React-DOM **19.3.0** / Redux Toolkit **2.13.0** / Tailwind CSS **4.3.3**（`@tailwindcss/vite` 同版本官方插件）/ Vite **8.3.4** / Vitest **5.0.3** 进 `pnpm-lock.yaml`（与上表逐字一致）；配套同 major 内自调（纪律 6）：`react-redux` **9.3.0**（peer React ^18||^19，`@types/react(-dom)` **19.3.0** 类型配套）、`@vitejs/plugin-react` **6.1.2**（peer Vite ^8，React 19 编译链官方插件）。前端本地镜像 `natural-enforcement/frontend:dev`：多阶段 Dockerfile 入库（`node:24.21.0-alpine` 钉定 digest 构建 → `nginx:1.29.8` 钉定 digest 运行），compose 只按 image 引用 + pull_policy never。
- 2026-10-10（#57 地基切片10 销账）：**Playwright 浏览器镜像不进地基运行面**——e2e 层实测形态（`e2e/cases/`：命令冒烟 + testdata/results 读写通道，E1 从零拉起）无浏览器依赖，不引入 `mcr.microsoft.com/playwright` 容器；digest 登记（切片01 已补录）保留作定案存档，首个需要浏览器型 e2e 的切片按执行纪律 4 启用（npmmirror 对 rev1248 Chromium x64 缺失为已知定案输入）。e2e 浏览器渠道复测随启用时进行，本切片不适用。本切片无新增钉定版本（dev 十命令/CI/run-id 均为编排与脚本，不涉依赖变更）；`node:24.21.0-alpine` 等既有镜像引用与上表逐字一致（一致性核对通过）。
