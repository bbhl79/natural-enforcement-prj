# 数据与存储栈版本兼容性查证（PostgreSQL × PostGIS × Prisma 空间路径 × RustFS）

> 研究票 [#58](https://github.com/bbhl79/natural-enforcement-prj/issues/58) · 父票 #47（技术栈与版本定案的补充输入）
> 关联定案背景：2026-10-09 grilling 会话已定案——版本基线 = **追新**（定案时各包非 rc/beta/dev 的 latest stable major）；Node 运行时 = **24 LTS**；文件服务 = **RustFS**；PostgreSQL/PostGIS 的可行配对上限由本票查证决定。
> 性质：**只查证事实，不做定案**。选型与最终参数归父票 #47 决策。

---

## 0. 本文档的读法与方法说明

全文分三段，边界严格：

| 段 | 含义 | 标注方式 |
|---|---|---|
| 一 | **已查证的事实** | 每条附一手来源链接与查证日期；数值/区间逐字取自官方页面或官方 API/仓库 |
| 二 | **判定摘要** | 按票面三项结论给出「可行配对表 / Prisma 空间路径判定 / RustFS 可否承载 append-only」，只据第一段事实推导，不越界选型 |
| 三 | **未能查证与残余风险** | 明确列出取证受阻项、佐证不足项与须实测项 |

**方法说明（一手来源边界）**：本票仅采信下列一手渠道——`postgresql.org`（版本与支持政策）、`postgis.net`（发行/兼容/EOL，含其官方兼容数据 `compatibility.json`，据源码 `configure.ac` 生成）、`hub.docker.com` / `registry.hub.docker.com` 与 `auth.docker.io`（官方镜像 tag 与 digest，匿名 registry API 直接取证）、`github.com/prisma`（`prisma/prisma` releases 与新版 `prisma/orm` 源码）、`prisma.io/docs`（官方 ORM 文档）、`npm registry`（`prisma` dist-tags 与发布时间）、`github.com/rustfs/rustfs` 与其 README/源码、`docs.rustfs.com`；坐标系部分以 `postgis.net` 文档所述「spatial_ref_sys 由 PROJ/EPSG 载入」的机制为主，`proj.org`、`docs.qgis.org` 仅作佐证。凡未取到一手逐条证据者，一律进第三段，不写入结论表。

**查证日期**：以下所有事实均于 **2026-10-09** 取证。PostGIS 官方兼容 JSON 的 `generated_at` 为 `2026-10-09T15:05:02Z`、`source_revision` 为 `83e52850466d…`，与本文档同日。

**关键结论速览**（详见第二段）：
- 追新上限配对 = **PostgreSQL 18 + PostGIS 3.6.x**（官方 supported）；官方镜像需显式 pin tag `18-3.6`，**不可用 `latest`**。
- Prisma：当前 GA = **7.10.0**（8.0.0 仍为 rc，未入基线）。**7.x 无原生 PostGIS**，走 `Unsupported` 透传 + raw SQL；E4 坐标读写走「迁移首条装扩展 + `$queryRaw`/ST_ 函数」可行。原生支持已在 **Prisma 8 官方扩展 `@prisma/orm-extension-postgis`**，但 8.0.0 未 GA。
- RustFS：1.0.1（GA），Apache-2.0，镜像 `rustfs/rustfs` 可 digest 锁定；**Versioning + Object Lock(WORM，GOVERNANCE/COMPLIANCE + Legal Hold) 均已实现**，可承载 append-only 最保守语义。

---

## 一、已查证的事实

### 1.1 PostgreSQL 现行 stable major 与社区支持截止

来源：PostgreSQL 官方版本与支持政策页 <https://www.postgresql.org/support/versioning/>（查证日期 2026-10-09）。

- **当前受支持的 stable major 为 14、15、16、17、18**；14 以下（9.0–13）已标 "No"（不再支持）。**现行最新 stable major = 18**，初始发布于 **2025-09-25**。
- 官方原文：「The PostgreSQL Global Development Group supports a major version for **5 years** after its initial release. After this, a final minor version will be released and the software will then be unsupported (end-of-life).」以及「releases a new major version containing new features **about once a year**」。
- 社区支持（EOL）截止日：

| Major | 初始发布 | 社区支持截止（EOL） |
|---|---|---|
| 18 | 2025-09-25 | **2030-11-14** |
| 17 | 2024-09-26 | **2029-11-08** |
| 16 | 2023-09-14 | **2028-11-09** |
| 15 | 2022-10-13 | 2027-11-11 |
| 14 | 2021-09-30 | 2026-11-12 |

> 佐证旁注：官方页面未出现「每年 11 月第一个周二」的措辞，只表述为「about once a year / 支持 5 年」；追新口径应据此认定 PG18 为当前 stable，而非 PG19（PG19 尚未成为 stable，见 §1.2 PostGIS 3.7 的 beta 覆盖说明）。

### 1.2 PostGIS 各发行系列对 PostgreSQL 16/17/18 的官方支持

主来源：PostGIS 官方兼容数据 `<https://postgis.net/development/compatibility/compatibility.json>`（页面 <https://postgis.net/development/compatibility/> 背后的权威数据，据源码 `configure.ac` 生成；`generated_at=2026-10-09T15:05:02Z`，`source_revision=83e52850466d…`）。辅来源：PostGIS 版本政策页 <https://postgis.net/development/versions_eol/>、Windows 发行版本页 <https://postgis.net/documentation/getting_started/install_windows/released_versions/>。

官方 `status_definitions` 原文（逐字）：
- **supported** =「Supported by the PostGIS project policy for the listed release series.」
- **known-compatible** =「Expected to build or run from release/dependency metadata, but not shown as a current CI lane here.」

各 stable 系列的 PostgreSQL 支持区间与最新点版本（取自 `postgis_series`，逐字 `postgresql.supported`）：

| PostGIS 系列 | branch | 最新点版本 | 状态 | PostgreSQL 支持区间（官方 supported） |
|---|---|---|---|---|
| **3.6** | stable-3.6 | **3.6.4** | supported | **12–18** |
| **3.5** | stable-3.5 | **3.5.7** | supported | **12–17** |
| **3.4** | stable-3.4 | **3.4.6** | supported | **12–16** |
| 3.7 | master（dev） | 3.7.0beta1 | development | 14–19（PG19 为 beta 系列覆盖） |

逐格要点（PG16/17/18 × PostGIS）：

- **PG18 + PostGIS 3.6 = supported**（官方区间 12–18）。3.6 的 `feature_note` 原文：「Works on PostgreSQL 12-14, but GiST bulk index build sort support is only installed in the default opclass on **PostgreSQL 15 and later**.」→ PG18 属功能完整支持。
- **PG18 + PostGIS 3.5 = 不在默认 supported（12–17），官方标 known-compatible**，3.5 的 PG18 override 原文：「PostgreSQL 18 should be treated as newer-than-release metadata until explicit branch coverage is recorded.」→ 3.5 不支持追新上限 PG18 的「官方 supported」判定。
- **PG17 + PostGIS 3.6 / 3.5 = 均 supported**；PG16 + PostGIS 3.6 / 3.5 / 3.4 = 均 supported。
- **3.7 = development（beta），PG19 仅 beta 覆盖**：按「追新=非 rc/beta/dev 的 latest stable major」规则，3.7 不纳入基线；且 PG19 本身尚未成为 PostgreSQL stable（§1.1）。

> ⚠️ 一处口径差异（须向决策票暴露）：PostGIS **Windows 安装包页**称「Windows PostGIS Bundle 3.6.2 installers for **PostgreSQL 14-18**」（打包器仅出 14–18），而**核心源码矩阵**记 3.6 supported = **12–18**。二者不冲突——前者是发行二进制打包范围，后者是项目支持口径。本票结论以**核心源码矩阵**为准。

### 1.3 `postgis/postgis` 官方镜像现状与 bitnami 对比

主来源：Docker Hub registry API（匿名，`registry.hub.docker.com/v2/repositories/…`，查证日期 2026-10-09）。仓库页 <https://hub.docker.com/r/postgis/postgis>。

现存**组合 tag**（`postgis/postgis`，共 159 个 tag，最近推送批 **2026-08-31**；下列按体系筛出）：

| PG major | 现存 3.4/3.5/3.6 组合 tag | 说明 |
|---|---|---|
| 18 | `18-3.6`、`18-3.6-alpine`、`18-master` | **PG18 官方镜像仅与 PostGIS 3.6 配对**；无 `18-3.5`/`18-3.4` |
| 17 | `17-3.4`、`17-3.5`、`17-3.6-alpine`（+ `3.6.0alpha/beta-alpine`）、`17-master` | PG17 的 **3.6 仅有 alpine 变体**，无 `17-3.6`（非 alpine） |
| 16 | `16-3.4`、`16-3.5`（+ `16-3.5.0alpha2-alpine`）、`16-master` | **PG16 官方镜像最高到 PostGIS 3.5**，无 `16-3.6` |

关键 digest（多架构 manifest；`sha256` 可 `docker pull <repo>@<digest>` 锁定）：

- `latest` 与 `17-3.5` **同一 digest**：amd64 `sha256:8dfee83d8bd4c2873dc4a233c13ba2799a44f2edb16a0552d58715917fac32ba`（arm64 `sha256:72f22bc59e78…`）。→ **`latest` 当前指向 PG17 + PostGIS 3.5，而非最新配对**。
- `18-3.6`（追新上限配对的镜像）：amd64 `sha256:20b5c7130ab4d93b77c8f88d835268c64c3a9303d708a55b2eebd54872825cc3`，arm64 `sha256:7e00e8c3539fdd43f513b98806c8204714dcd09dea683c259e333d7690317119`。
- `16-3.5`：amd64 `sha256:7ef699637304…`。

> **镜像与源码矩阵的打包缺口**：§1.2 官方源码矩阵记「3.6 supported 覆盖 PG 12–18」，但 `postgis/postgis` 官方镜像并未发布 `16-3.6`、非 alpine 的 `17-3.6`。即：走官方镜像时，PostGIS 3.6 实际可拉取的 PG 组合为 **18（非 alpine 与 alpine）与 17（仅 alpine）**，PG16 只能取到 3.5。追新上限 PG18+3.6 在官方镜像可用（tag `18-3.6`），不受此缺口影响。

`latest` 语义与可锁定性：官方镜像**提供按版本 tag 且每 tag 附多架构 digest**，可**按 digest 锁定**；但 `latest` 为滚动 tag 且当前并非最新配对，追新口径应显式 pin `18-3.6` + digest。

**bitnami 对比（一句话）**：Docker Hub 上**不存在 `bitnami/postgis` 镜像**（registry 返回 HTTP 404，查证日期 2026-10-09），`bitnami/postgresql` 公共目录现仅保留滚动 `latest`/`latest-metadata`（最新非 `sha256-*` 语义 tag 亦为 `latest`，2026-10-04）而不再发布按版本 tag——相较之下，PostGIS 官方 `postgis/postgis` 是唯一同时具备「官方维护 + 按 PG×PostGIS 组合 tag + 可 digest 锁定」的镜像；bitnami 无对应 PostGIS 官方镜像可用。

### 1.4 头号风险项：Prisma 对 PostGIS geometry/geography 的支持路径

主来源：`prisma.io` 官方文档 + `npm registry`（`prisma` dist-tags）+ `github.com/prisma/prisma` releases + `github.com/prisma/orm` 源码。

**(a) 版本现状（追新口径）**——`npm registry.npmjs.org/prisma`（查证日期 2026-10-09）：
- dist-tags：`latest = 8.0.0-rc.22`、`next = 8.0.0-rc.10`、**`prev = 7.10.0`**。
- `7.10.0` 发布时间 **2026-08-25**；`8.0.0` 各 rc 于 `github.com/prisma/prisma/releases` 持续发布（`v8.0.0-rc.1` … `rc.17`，`prerelease:true`，最新 rc 于 2026-10-08）。
- → **当前唯一非 rc/beta/dev 的 latest stable major = Prisma 7.10.0**；**Prisma 8.0.0 仍是 RC，尚未 GA**（不满足「追新=latest stable major」入基线的条件）。

**(b) Prisma 7.x（GA 基线）对 PostGIS 的官方口径**——`https://www.prisma.io/docs/orm/prisma-client/queries/raw-database-access/custom-and-type-safe-queries`（查证日期 2026-10-09），逐字：
- Prisma ORM「**does not support working with geographic data, specifically using PostGIS**」；
- 含地理列的模型用 **`Unsupported` 类型**（文档样例：`location Unsupported("geography(Point, 4326)")`；geometry 同理 `Unsupported("geometry(...)")`）；
- 「**models with required `Unsupported` types do not expose write operations such as `create`, and `update`**」→ 必需空间字段的模型，Prisma Client **不提供 create/update**；
- 读写走 **`$queryRaw` + `ST_` 函数**；文档同时给出先决条件迁移 `-- CreateExtension\nCREATE EXTENSION IF NOT EXISTS "postgis";`。

**(c) Prisma Migrate 对 PostGIS 扩展（shadow database / CREATE EXTENSION）的官方处理**——`github.com/prisma/prisma` issue #7455「Migration failed on `ERROR: type "geometry" does not exist`」（state=closed；labels 含 `topic: geo`、`topic: prisma migrate dev`、`topic: postgresqlExtensions`；<https://github.com/prisma/prisma/issues/7455>，查证日期 2026-10-09）：
- 现象：`prisma migrate dev` 用 shadow database 时，若 geometry 列迁移先于扩展安装，报 `type "geometry" does not exist`。
- 维护者 @tomhoule 结论（逐字）：「is the `CREATE EXTENSION 'postgis';` **in a migration at the beginning of your migrations history** (before you use things enabled by postgis)? If not, this could be the cause.」
- → **官方口径：把 `CREATE EXTENSION postgis` 作为迁移历史中最先的一条**（早于任何引用 geometry/geography 的迁移），shadow database 才能识别类型；与 (b) 文档给出的「先建一条安装扩展的迁移」一致。

**(d) 原生支持是否已有（roadmap/changelog 2025–2026）**——新版 ORM 仓库 `github.com/prisma/orm`（Prisma 8 / "Prisma Next"，纯 TypeScript 重写）：
- 存在**官方 PostGIS 扩展**目录 `packages/9-public/@prisma/orm-extension-postgis/` 与 `packages/3-extensions/postgis/`；其 README 逐字：「**Geospatial columns, operators, and indexes for Prisma 8 on PostgreSQL, powered by PostGIS** … Model points, lines, and polygons as **first-class columns**, query them with a **type-safe DSL**, and let the framework handle the **wire format, SRID metadata, and `CREATE EXTENSION postgis`**」；列类型 `Geometry(srid?)`，GeoJSON 值，**七个查询算子**（`distance, distanceSphere, dwithin, contains, within, intersects, intersectsBbox`），并声明「the database-dependency declaration that makes **`prisma db init` enable PostGIS before the first migration runs**」。
- 该仓库自带 `migrations/20260601T0000_install_postgis_extension/migration.ts`，逐字含 `CREATE EXTENSION IF NOT EXISTS postgis` 与一个稳定 `invariantId` `postgis:install-postgis-v1`，并注明「downstream user columns naming `geometry` as nativeType rely on this op having applied first」→ **Prisma 8 由框架自动、按序处理扩展安装**，直接消解 (c) 的手工排序问题。
- 佐证：`prisma.io/docs/orm/next/reference/error-reference` 出现 `POSTGIS.GEOMETRY_INVALID`、`CONTRACT.NATIVE_TYPE_INVALID` 等错误码（查证日期 2026-10-09，正文为 SPA，逐条取自检索快照）。

> **口径澄清**：Prisma 的「first-class support for PostgreSQL」指 PostgreSQL 连接器本身（新 ORM 的首要目标库），**不等于** Prisma 7.x 已原生支持 PostGIS；PostGIS 空间类型在 **7.x 仍走 Unsupported+raw**，原生 geometry 是 **8.x（未 GA）** 的能力，且目前形态是**官方扩展 `@prisma/orm-extension-postgis`**。

### 1.5 EPSG:4490（CGCS2000 地理坐标）与高斯-克吕格 45xx 码的存在性

主来源：`postgis.net` 文档关于 `spatial_ref_sys` 的机制说明——`https://postgis.net/docs/manual-3.5/using_postgis_dbmanagement.html`（§4.5 Spatial Reference Systems，查证日期 2026-10-09）：`spatial_ref_sys` 为 OGC 兼容表，PostGIS「ships … **thousands of the most common spatial reference system definitions that are handled by the PROJ projection library**」，并可对不在核心集内的坐标系**追加自定义 SRID**。PostGIS 官方兼容 JSON（§1.2）亦以 PROJ 为依赖目录来源。

已查证到的坐标系事实：
- **EPSG:4490 = CGCS2000（China Geodetic Coordinate System 2000）地理 2D 坐标系**（经纬度，度为单位）。这是我国现行国家大地坐标系；EPSG 注册后经 PROJ 数据库进入 PostGIS `spatial_ref_sys`，故 SRID 4490 在 PostGIS 自带表中可用（机制一手取自 PostGIS 文档；4490 这一具体码由 QGIS 生态教程普遍登记作**佐证**，见第三段 §3）。
- **CGCS2000 的高斯-克吕格投影 EPSG 码集中在 EPSG:4491–4554 段**，含「3 度带 / 6 度带」各两种命名：**带号前缀**式（False Easting 含带号，如 `CGCS2000 / 3-degree Gauss-Kruger zone NN`）与**中央经线 CM**式（如 `CGCS2000 / 3-degree Gauss-Kruger CM 111E`）。例：`EPSG:4490` 作地理基准 → 投影派生；`EPSG:4547` = CGCS2000 3 度带第 39 带（带号式）；`EPSG:4548` ≈ 第 40 带。这些同样属 PROJ/EPSG 登记、经 §1.5 机制进入 `spatial_ref_sys`（逐条一手页未取得，见第三段）。
- **GCJ-02 无 EPSG 码**：GCJ-02（「火星坐标」）是对 WGS84 施加**非线性加偏**的保密偏移坐标，**不是 EPSG 注册的坐标系**，因此**不在 PROJ / PostGIS `spatial_ref_sys` 的标准集内**，通常须以自定义 proj4/WKT 或应用层偏移函数处理（此项为设计性说明，未由 EPSG 官方一手证明「不存在」，见第三段）。

### 1.6 RustFS：版本/许可/镜像/S3 语义/资源

主来源：`github.com/rustfs/rustfs`（releases、README、源码）+ Docker Hub registry API（`rustfs/rustfs`）。

- **许可证与定位**：README 逐字「high-performance, distributed object storage system **built in Rust** … offers **broad S3 API compatibility for supported features**, is completely open-source」。仓库 license = **Apache-2.0**（`gh api repos/rustfs/rustfs` → `spdx_id: Apache-2.0`），`archived:false`，created 2023-11-23。
- **当前版本与发布节奏**：`github.com/rustfs/rustfs/releases`（查证日期 2026-10-09）——**最新 stable = 1.0.1**（published **2026-10-03**，`prerelease:false`）；**1.0.0 GA = 2026-09-16**；此前 2026-07 至 09 为 weekly 级 beta→rc（`1.0.0-beta.10/11/12` → `rc.1…rc.6` → `1.0.0` → `1.0.1`）。即 **1.0 线刚 GA 约三周**。
- **官方 Docker 镜像**：repo **`rustfs/rustfs`**（Docker Hub，198 个 tag）。`latest` 与 `1.0.1` **同 digest**：amd64 `sha256:7465b31993156ca5cc0eb4b3c59a01ff69651961be62bcfeb6ce569f22034a56`、arm64 `sha256:3bc0a69f7636…`（2026-10-03）；另有 `-glibc` 变体（如 `1.0.1-glibc`）。→ **可按版本 tag + digest 锁定**；README 示例 `docker run … rustfs/rustfs:1.0.1`，端口 **9000（S3 API）/ 9001（console）**。
- **S3 语义覆盖面（README 功能矩阵，逐字）**：`Versioning ✅`、`Object Lock (WORM) ✅`、`Server-Side Encryption ✅`、`RustFS KMS ✅`、`Lifecycle Management (ILM) ✅`、`IAM / Policies ✅`、`Bitrot Protection ✅`、`Healing & Scanner ✅`、`Pool Expansion / Decommission ✅`、`Bucket Replication ✅`、`Site Replication ✅`、`Logging & Observability ✅`。
- **Object Lock 语义（源码一手，`crates/ecstore/src/bucket/object_lock/types.rs`，查证日期 2026-10-09）**：`RetentionMode` 枚举**恰两值** `Governance`("GOVERNANCE") / `Compliance`("COMPLIANCE")；另有 `LegalHoldStatus`(`ON`/`OFF`)、`ObjectRetention{mode,…}`、`ObjectLegalHold{status}`；逐字「The engine evaluates **WORM state from persisted object metadata and the bucket default retention**」，且保留模式修改门「compares the requested mode **literally** against the canonical persisted mode」→ **支持 per-object-version 的 retention（治理/合规两模式）与 legal hold，并有桶默认保留**。仓库并有 `distributed/object_lock_test.rs`、`versioning_test.rs`、`object_lock/object_lock_test.rs`、`bucket/lifecycle/object_lock_boundary.rs` 等 e2e 测试与 `.github/workflows/rustfs-s3-compat-test.yml`、`.docker/test/compat/docker-compose.minio.yml`（与 MinIO 行为对比的兼容测试）。
- **版本化行为（docs.rustfs.com/features/versioning，检索快照，查证日期 2026-10-09）**：逐字「RustFS implements **S3-compatible versioning** … Versioning is **enabled at the bucket level** … When a versioned object is deleted, a **delete marker** is created … If a versioned object is **overwritten, RustFS creates a new version** … Versioning serves as the foundation for **object locking, immutability, tiering, and lifecycle** management.」
- **资源需求（README 硬件表，逐字）**：基准环境 CPU「2 Core … 2.7/3.2 GHz」、Memory「**4GB**」、Network「15Gbps」、Drive「**40GB × 4**」、IOPS「3800 / Drive」。README 并逐字提示「A **single-node single-drive (SNSD)** deployment is supported only as a standalone local path. **It cannot expand in place or be added as a Pool.** To move to a multi-drive topology, create a new deployment and migrate data through S3.」
- 成熟度对比旁注（README 自述，非本票结论）：RustFS 自述「clear IP rights and safe for commercial use」，对照对象「Go or C-based」「Potential for memory GC pauses … Legal Risks: IP ambiguity」——指向 MinIO 的 AGPL 与许可争议；此为厂商口径，仅作背景。

---

## 二、判定摘要

> 仅据第一段查证事实推导，不做选型拍板。

### 2.1 PG × PostGIS 可行配对表

「官方 supported」按 §1.2 核心兼容矩阵（supported / known-compatible）：

| PostgreSQL \ PostGIS | 3.4 | 3.5 | 3.6 | 3.7（dev） |
|---|---|---|---|---|
| 16 | supported | supported | supported | supported |
| 17 | known-compatible | **supported** | **supported** | supported |
| **18（追新 latest stable）** | known-compatible | known-compatible | **supported ✅** | supported |

- **追新上限配对 = PostgreSQL 18 + PostGIS 3.6.x（最新点版本 3.6.4）**。理由：PG18 为当前唯一 latest stable major（§1.1）；对 PG18 唯一进入「supported」的 PostGIS 系列是 3.6（12–18）；3.5 对 PG18 仅 known-compatible；3.7 为 dev，按追新规则排除。
- 若保守取次新 stable：PG17 + PostGIS 3.6 或 3.5 均 supported；PG16 + 3.6/3.5/3.4 均 supported。
- **落地到镜像**（§1.3）：追新配对走官方 tag `postgis/postgis:18-3.6`（存在，可 digest 锁定 `sha256:20b5c713…`/`7e00e8c3…`）；**严禁用 `latest`**（其当前=PG17/PostGIS3.5，非最新配对）。注意官方镜像对 3.6 仅发布 PG18 与 PG17(alpine)，PG16+3.6 官方镜像未发布。

### 2.2 Prisma 空间路径判定（E4 坐标读写是否走得通、以什么方式）

前提：追新基线锁定 **Prisma 7.10.0**（§1.4a，8.0.0 未 GA）。

- **判定：在 7.10 下 E4 类坐标读写走得通，但不是 ORM 原生路径，而是「Unsupported 透传 + raw SQL」**，具体：
  1. **模式**：geometry/geography 列声明为 `Unsupported("geometry(Point,4490)")` / `Unsupported("geography(...)")`；Prisma Client 把该字段类型化为底层值，**不提供 create/update**（§1.4b）。
  2. **写入**：经 `$executeRaw`/`$queryRaw` 调 `ST_GeomFromText`/`ST_SetSRID`/`ST_MakePoint` 等（§1.4b）。
  3. **读取**：raw 查询取回（EWKB/GeoJSON/WKT），在应用层或经 SafeQL 等类型化封装解析。
  4. **迁移（关键前置）**：`CREATE EXTENSION postgis` **必须作为迁移历史第一条**，早于任何空间列迁移，否则 shadow database 报 `type "geometry" does not exist`（§1.4c）。可行落地：手工编写首条 `CREATE EXTENSION IF NOT EXISTS "postgis";` 迁移，或直接使用 `postgis/postgis` 镜像在容器初始化时已建扩展。
- **走向判断（面向决策票）**：**Prisma 8 官方 PostGIS 扩展 `@prisma/orm-extension-postgis` 已提供原生 first-class geometry 列 + GeoJSON + 类型安全空间算子 + 自动 `CREATE EXTENSION`（§1.4d）**；一旦 8.0.0 GA（当前 rc.17/22，日更），E4 可平滑升级为原生路径，且 7.x 的 raw 写法在其之上兼容。**建议：E4 以「7.10 raw+Unsupported」为可交付基线设计，同时将「Prisma 8 GA 后切换原生扩展」列为升级项，不阻塞开发。**
- 风险：Prisma 版本正处 7.10→8.0 大版本切换前夜，若中途把基线追到 8.0 GA，schema DSL 已由 PSL 迁向「Data Contracts」新模型，迁移工具链（`db init`/`migration plan`/contract hash）行为改变，需重估。

### 2.3 RustFS 可否承载「存储层 append-only 最保守语义（E3）」

**判定：可以**，且无需依赖外部 WORM 硬件——RustFS 1.0.1 的 S3 语义已覆盖该诉求（§1.6）：

- **「原地修改/删除被拒」→ Object Lock（WORM）**：`RetentionMode` 含 **GOVERNANCE / COMPLIANCE** 两模式 + `LegalHoldStatus`（ON/OFF），并有桶默认保留（bucket default retention）；**最保守取 COMPLIANCE 模式**（期内含 root 亦不可删/改）+ 足够长保留期 + 需要时无限期 **Legal Hold**。WORM 由持久化元数据+桶默认保留在引擎侧评估，非仅 API 门。
- **「产生新世代」→ Versioning**：桶级开启版本化；**覆盖=新 versionId、删除=delete marker（可恢复）**，历史版本留存，满足「不就地销毁」的世代语义。S3 语义下 Object Lock 依赖 versioning，二者组合即「不可变的新世代」。
- **落地配置路径（据查证事实，非拍板）**：建桶时即启用 Object Lock（S3 要求 lock 在桶创建时开启）→ 开启 versioning → 设桶默认 retention 为 COMPLIANCE + 保留期；对已封存对象版本按需加 Legal Hold；配 IAM/策略限制对 retention/legal-hold 的改写；启用 Bitrot + Healing/Scanner 保障字节完整；异地/灾备以 Bucket/Site Replication 承载（契合 #23 第四十一条异地备份诉求）。
- **约束（须实测/须向决策票暴露）**：RustFS 1.0 刚 GA（约三周），成熟度显著低于 PG/PostGIS/Prisma；**SNSD（单节点单盘）不能就地扩容或加池**，扩需新建部署经 S3 迁移——生产部署拓扑应按多盘纠删码规划；Object Lock 的保留到期语义、delete marker 与合规不可变性在 1.0.x 仍在修（1.0.1 发布记录含 replication/递归强删权限/删除标记等 fix）；README 的 2C/4GB/4×40GB 为**基准测试环境**而非严格最低值。E3 上线前须在目标版本上做「写覆盖→新世代、期内删除→被拒、Legal Hold→锁定、到期行为」的端到端验收。

---

## 三、未能查证与残余风险

### 3.1 取证受阻 / 佐证不足（须补一手）

| # | 缺口 | 现状与建议途径 |
|---|---|---|
| 1 | **EPSG:4490 与 CGCS2000 高斯投影 45xx 的逐码一手确认** | 本票未取得 `proj.org` / EPSG 注册表逐码页面；机制（spatial_ref_sys 由 PROJ/EPSG 载入）取自 PostGIS 文档（一手），具体码存在性以 QGIS 生态教程**佐证**。建议以 `proj.org`（PROJ 数据库）或 EPSG 官方登记复核 4490 与 4491–4554 段；`epsg.io` 可查 WKT 但非本次限定的一手渠道。 |
| 2 | **GCJ-02「无 EPSG 码」** | 属通识/设计性说明，未由 EPSG 官方一手证明「未登记」。落地时须以自定义 proj4/WKT 处理，并实测偏移。 |
| 3 | **PostGIS 3.5 / 3.4 官方 EOL 具体日期** | 本票取到 supported 区间与最新点版本，但未逐条取得 `versions_eol` 页的每系列截止日；追新基线用 3.6 不受影响，若回退 3.5 须补查。 |
| 4 | **`postgis/postgis` 镜像对 3.6 的 PG16 / PG17(非 alpine) 缺 tag** | 属官方镜像打包缺口（源码矩阵支持但镜像未发），是否后续补 tag 未知；追新走 PG18 不受影响。 |
| 5 | **`@prisma/orm-extension-postgis` 是否已发布到 npm、其可用版本与许可** | 本票仅在 `prisma/orm` 源码仓库见其目录与 README，未验证 npm 发布与稳定契约；须待 8.0.0 GA 复核。 |
| 6 | **Prisma 8.0.0 GA 时点** | 截至 2026-10-09 仅 rc（rc.17/22，日更），GA 日期未定；「追新=stable」下暂不入基线。 |
| 7 | **RustFS 精确最低硬件 / 生产级资源规格** | README 仅给基准测试环境（2C/4GB/4×40GB）；SNSD 限制已知，但真实最低规格与容量规划须实测。 |
| 8 | **RustFS 与 AWS S3 的逐 API 语义 100% 一致性** | 有 `.docker/test/compat`（对 MinIO）与 s3-compat CI，但覆盖面为「broad … for supported features」（厂商口径）；append-only 关键子集（retention 到期、delete marker 与 Object Lock 交互、Compliance 不可撤销）须实测验收。 |
| 9 | **`docs.rustfs.com/features/versioning` 页面可达性** | 该 URL 于检索快照存在并被引用，但本票 WebFetch 返回 404（文档路径可能已重排为 `/en/…`）；versioning 结论以 README + 源码为一手锚定。 |

### 3.2 属工程参数，须实测而非查证

以下须由集成/压测确定，非外部查证可得，列出供后续决策票纳入验收：

- **Prisma 7.10 + PG18 + PostGIS 3.6.4 三者端到端联通**：`Unsupported` 字段在最新 PG18/PostGIS3.6 下的 raw 读写往返、SRID 4490/45xx 的实际 `ST_` 行为与索引（GiST）表现。
- **迁移首条 `CREATE EXTENSION postgis` 在 Prisma Migrate + `postgis/postgis:18-3.6` 容器中的确定性**（shadow database 是否可靠拿到扩展）。
- **RustFS E3 语义端到端**：覆盖→新 versionId、期内删除→拒绝、Compliance 到期行为、Legal Hold 锁定、Bitrot 巡检与 healing 时延；以及多节点纠删码部署下的写放大与吞吐（对齐 #23 的 RPO/RTO 与封存吞吐诉求）。
- **空间索引与查询性能**：CGCS2000 投影（米制）vs 地理（度）下 `dwithin`/`intersects` 的量级表现，决定 E4 采用 geometry 还是 geography 存储（本票不判定）。

### 3.3 需进一步决策的判断（不属本票）

1. 追新上限是否采 **PG18 + PostGIS 3.6**（本票查证其官方 supported 且镜像可用），还是保守回退 PG16/17。
2. E4 空间路径是否接受「7.10 raw+Unsupported」为正式基线，及是否将「Prisma 8 GA 后切原生 PostGIS 扩展」写入技术债/升级计划。
3. 坐标存储 SRID 策略（4490 地理 vs 45xx 投影 vs 双写）与 GCJ-02 偏移处理边界——属 #47/领域票。
4. RustFS 部署拓扑（SNSD 禁用、多盘纠删码）与 Object Lock 具体保留期/模式（GOVERNANCE vs COMPLIANCE）——后者与 #23 的保管期限（永久/30年）对齐，属保管策略决策。

---

## 四、关键来源列表（均查证于 2026-10-09）

**PostgreSQL / PostGIS**
1. PostgreSQL 版本与支持政策 — <https://www.postgresql.org/support/versioning/>
2. PostGIS 官方兼容数据（源码生成 JSON） — <https://postgis.net/development/compatibility/compatibility.json>（页面 <https://postgis.net/development/compatibility/>）
3. PostGIS 版本与 EOL 政策 — <https://postgis.net/development/versions_eol/>
4. PostGIS Windows 发行版本页 — <https://postgis.net/documentation/getting_started/install_windows/released_versions/>
5. PostGIS 手册 §4.5 Spatial Reference Systems（spatial_ref_sys / PROJ） — <https://postgis.net/docs/manual-3.5/using_postgis_dbmanagement.html>
6. Docker Hub 官方镜像 `postgis/postgis`（tag/digest） — <https://hub.docker.com/r/postgis/postgis> 与 registry API `https://registry.hub.docker.com/v2/repositories/postgis/postgis/tags`
7. bitnami 镜像现状（无 `bitnami/postgis`；`bitnami/postgresql` 仅滚动 latest） — registry API `…/repositories/bitnami/postgis/`（404）、`…/repositories/bitnami/postgresql/tags`

**Prisma**
8. Prisma 地理空间/PostGIS 官方文档（Unsupported + raw） — <https://www.prisma.io/docs/orm/prisma-client/queries/raw-database-access/custom-and-type-safe-queries>
9. Prisma Migrate × PostGIS 扩展（shadow DB）issue #7455 — <https://github.com/prisma/prisma/issues/7455>
10. Prisma `npm` dist-tags（latest=8.0.0-rc.22 / prev=7.10.0） — <https://registry.npmjs.org/prisma>
11. Prisma 8 版本发布（RC 线） — <https://github.com/prisma/prisma/releases>
12. Prisma 8 官方 PostGIS 扩展（原生）源码/README — <https://github.com/prisma/orm>（`packages/9-public/@prisma/orm-extension-postgis`、`packages/3-extensions/postgis/migrations/…install_postgis_extension`）

**RustFS**
13. RustFS GitHub（releases、license Apache-2.0、README 功能矩阵与硬件表） — <https://github.com/rustfs/rustfs>
14. RustFS Object Lock 源码（GOVERNANCE/COMPLIANCE + Legal Hold） — <https://github.com/rustfs/rustfs/blob/main/crates/ecstore/src/bucket/object_lock/types.rs>
15. RustFS 版本化 docs（S3-compatible versioning / delete marker） — <https://docs.rustfs.com/features/versioning>
16. Docker Hub 官方镜像 `rustfs/rustfs`（tag/digest） — <https://hub.docker.com/r/rustfs/rustfs> 与 registry API `…/repositories/rustfs/rustfs/tags/1.0.1`

**坐标系（佐证）**
17. PROJ（PostGIS 变换依赖库） — <https://proj.org/>
18. QGIS 文档（CGCS2000 / EPSG 佐证） — <https://docs.qgis.org/>
