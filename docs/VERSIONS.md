# 地基版本定案表

定案介质 = GitHub #60（理由见 ADR-0001；书面证据 #58/#59）。锁定纪律：人读层锁 major（本表）；npm 树 patch 级由 `pnpm-lock.yaml` 承载（入库）；镜像锁显式 tag + digest（「待补」项由地基实施时现场补录，同时复测境内渠道可达性）。

| 层 | 锁定 | 定案时版本（2026-10-09） | 镜像引用 | Digest |
|---|---|---|---|---|
| 运行时 | Node 24 LTS（Krypton） | 24.21.x | `node:24`（具体 tag 落表时定） | 待补 |
| 语言 | TypeScript | **6.0.2**（钉死，勿追 7，见 ADR R1） | — | — |
| 包管理 | pnpm | 12.10.1（`packageManager` 字段入 lockfile 层） | — | — |
| 后端 | NestJS 12 | 12.1.2 | — | — |
| ORM/迁移 | Prisma 7 | 7.10.0（stable=prev 标签；8.0 为 rc 已排除） | — | — |
| 身份 | argon2 0.4x | 0.45.1（预编译覆盖 linux x64/arm64，容器免编译） | — | — |
| 前端 | React 19 / Redux Toolkit 2 / Tailwind CSS 4 / Vite 8 | 19.3.0 / 2.13.0 / 4.3.3 / 8.3.4 | — | — |
| 测试 | Vitest 5 / Playwright 1.64 | 5.0.3（peer vite 含 ^8.0.0 配对成立；弃 Node 20 不影响）/ 1.64.0 | `mcr.microsoft.com/playwright:v1.64.0`（multi-arch） | 待补 |
| Lint | ESLint 10 / typescript-eslint 8 | 10.12.0 / 8.71.1（与 TS 6.0.2 配对） | — | — |
| 队列 | BullMQ 6 / ioredis 6 / Redis server 8 | 6.3.12（peer ioredis>=5）/ 6.0.0 / 镜像 8 | `redis:8`（具体 tag 落表时定） | 待补 |
| 数据库 | PostgreSQL 18 × PostGIS 3.6.4 | 3.6.4（官方 supported：PG 12–18） | `postgis/postgis:18-3.6` | amd64 `sha256:20b5c7130ab4d93b77c8f88d835268c64c3a9303d708a55b2eebd54872825cc3`；arm64 `sha256:7e00e8c3539fdd43f513b98806c8204714dcd09dea683c259e333d7690317119` |
| 文件服务 | RustFS 1 | 1.0.1（tag 已一手实证；GA 三周，E3 实测兜底） | `rustfs/rustfs:1.0.1` | 待补 |
| 接入 | Nginx（官方 mainline 推荐线） | 1.29.x（具体 tag 落表时定） | `nginx:1.29` | 待补 |
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
