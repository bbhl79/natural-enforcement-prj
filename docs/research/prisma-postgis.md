# Research：Prisma 与 PostGIS 集成模式调研

- 票：#3（Research-Prisma与PostGIS集成模式调研）
- 日期：2026-11-16 / 11-17（所有版本号与 issue 状态均于此时点用 npm registry 与 GitHub API 实时查证）
- 方法：只对照一手来源（Prisma 官方文档 / npm registry / prisma/orm GitHub issue / prisma-examples 官方示例仓库 / postgis.net 官方文档），每条结论附来源。

---

## 一、结论先行

**2026 年 11 月时点的关键事实：Prisma 官方 PostGIS 支持已经出现，但尚未 stable。**

1. **Prisma 8（"Prisma Next"）提供了官方 PostGIS 扩展 `@prisma/orm-extension-postgis`**：schema 级 `postgis.Geometry(4326)` 类型、GiST 索引声明、GeoJSON 读写 helper（`point()`/`polygon()`）、类型化空间查询（`dwithin`/`distanceSphere`/`within`/`intersects` 等）、迁移自动生成 `CREATE EXTENSION`。但它目前只有 RC 版本（npm latest = `8.0.0-rc.23`，首 RC 发布于 2026-08-07），且 Prisma 8 整体仍在 RC（CLI latest = `8.0.0-rc.33`，`8.0.0` stable 未发布）。
2. **Prisma 7（stable，`@prisma/client` latest = `7.10.1`）完全没有地理类型**：追踪 6 年的 issue #1798 至今 open；官方当前推荐的模式是 **`Unsupported("geography(Point,4326)")` 占位 + 定制迁移（customized migrations）双轨工作流 + `$queryRaw` 空间查询**。官方维护的 `prisma-examples/orm/postgis-express` 示例（已升级到 v7 结构）完整演示了这套模式。
3. **旧的 `postgresqlExtensions` preview（`extensions = [postgis(...)]` 语法）已在 Prisma v6.16.0 弃用**，官方现在只推荐"扩展装进迁移文件"的方式。不要再采用任何基于该 preview 的旧教程。
4. **对本项目的推荐：主线采用「Prisma 7 stable + Unsupported 占位 + 双轨迁移 + $queryRaw 空间查询」**；把「Prisma 8 stable + 官方 PostGIS 扩展」列为观察项并设定明确触发器。理由与地图 #1 的硬约束对齐：AI-Native 要求确定性与快速失败——Prisma 8 是全新架构（contract.prisma、`prisma contract emit`、`db.query/db.execute` 等新命令面），RC 阶段仍有 breaking change，把工程基座押注在 RC 上违背"确定性"原则；而 Prisma 7 官方承诺 12 个月 bug fix 维护期（自 2026-09 起算），足够覆盖本项目 SPEC 与原型周期。

---

## 二、2026 年时点的支持状态（证据链）

| 事实 | 证据 | 来源 |
| --- | --- | --- |
| `@prisma/client` stable 线为 7.x（7.10.1） | npm dist-tags（2026-11-16 查证） | [registry.npmjs.org/@prisma/client/dist-tags](https://registry.npmjs.org/-/package/@prisma%2Fclient/dist-tags) |
| Prisma CLI latest = `8.0.0-rc.33`，`8.0.0` stable 不存在（registry 404） | npm dist-tags + 版本探针 | [registry.npmjs.org/prisma/dist-tags](https://registry.npmjs.org/-/package/prisma/dist-tags) |
| 官方 PostGIS 扩展 `@prisma/orm-extension-postgis`，latest = `8.0.0-rc.23`，仅适配 Prisma 8 新架构 | npm registry + 官方文档 | [registry.npmjs.org/@prisma/orm-extension-postgis](https://registry.npmjs.org/@prisma/orm-extension-postgis)、[官方扩展文档](https://www.prisma.io/docs/orm/extensions/postgis) |
| issue #1798（Geolocation/Spatial types support）至今 open，162 条评论，最后更新 2026-05-13 | GitHub API | [prisma/orm#1798](https://github.com/prisma/orm/issues/1798) |
| Prisma 8 stable 预计 2026-10~11 发布（博文日期 2026-09-09 + "4 到 8 周"）；截至本文查证仍未发布；Prisma 7 承诺 12 个月维护；8 与 7 可在同一数据库并行、逐查询迁移 | 官方博客 | [Is Prisma 8 ready for long-lived production apps?](https://www.prisma.io/blog/is-prisma-8-ready-for-long-lived-production-apps) |
| 扩展暂不能声明 `geometry(Polygon, 4326)` 这类子类型（只有通用 `postgis.Geometry(4326)`），geography 未提及 | 官方文档未提及 + open bug | [prisma/orm#30772](https://github.com/prisma/orm/issues/30772)（2026-10-19 创建，open） |
| `postgresqlExtensions` preview 于 v6.16.0 弃用，官方改为推荐 customized migrations | v6 官方文档原文："…deprecated in v6.16.0, the recommended approach … is to install them via customized migrations" | [PostgreSQL extensions (v6)](https://www.prisma.io/docs/orm/v6/prisma-schema/postgresql-extensions) |
| Prisma 7 对 PostGIS 的官方姿态：Unsupported 类型 + 手写迁移 + raw SQL | 官方示例仓库（已升级 v7：`prisma-client` generator + `PrismaPg` adapter + `prisma.config.ts`） | [prisma-examples/orm/postgis-express](https://github.com/prisma/prisma-examples/tree/latest/orm/postgis-express) |

### Prisma 8 扩展能力一览（评估切换时用）

- schema：`types { Location = postgis.Geometry(4326) }` + `@@index([location], type: "gist")`；
- 查询：`p.location.dwithin(here, 0.1)`、`p.location.distanceSphere(here).lt(5000)`、`within`/`contains`/`intersects`/`intersectsBbox`；
- 迁移：`prisma contract emit` 自动在 `migrations/postgis/` 生成装扩展的迁移，不要自己声明 `extension postgis {}`；
- 已知坑：查询必须显式传 SRID（`distanceSphere`/`intersectsBbox` 除外）；`distanceSphere` 不走 GiST 需先用 `dwithin` 粗筛；经度跨 180° 与高纬度（>60°）时度数半径失真。
- 来源：[官方扩展文档](https://www.prisma.io/docs/orm/extensions/postgis)。

---

## 三、推荐模式（主线：Prisma 7 stable 双轨工作流）

### 3.1 总原则

- **一个迁移目录、一条历史**：Prisma 生成的 DDL 与手写的 PostGIS SQL 混排在同一份 `migration.sql` 里，不另立 SQL 目录、不引入第二套迁移 runner。`migrations/` 目录就是版本真相（single source of truth），dev 与 e2e 都从它出发。
- **schema 表达到"列存在"为止**：地理列用 `Unsupported(...)` 占位（迁移会正确生成列 DDL）；地理索引、PostGIS 函数、触发器等 Prisma 无法表达的对象，一律写在迁移 SQL 里。
- **空间读写全部走 `$queryRaw` / `$executeRaw` 标签模板**（参数化、可注入安全），并在 NestJS 的 repository 层封装成类型化方法——agent 只见函数签名，不见 WKB 十六进制。
- **扩展安装必须写进第一个迁移**，绝不手动 `CREATE EXTENSION`。官方原文："Do not install the extension manually, because it is also required by the shadow database."（shadow database 会完整重放迁移历史）。

### 3.2 地理列在 schema 中的表达

```prisma
// schema.prisma（Prisma 7）
generator client {
  provider = "prisma-client"
  output   = "./generated"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model EnforcementPoint {
  id        Int      @id @default(autoincrement())
  name      String
  // 关键点 1：Unsupported 占位；字符串就是列的类型名
  // 关键点 2：必须可空（?）或给 dbgenerated 默认值，否则 create/update/upsert 整个不可用
  location  Unsupported("geography(Point,4326)")?
  createdAt DateTime @default(now())
}
```

规则（来自 v7 schema reference 原文）：

- `Unsupported` 字段"not available in the generated client"——查询结果中不存在该字段，无法用 client 读或写；
- **若模型的 `Unsupported` 字段是 required，则该模型的 `create`/`update`/`upsert` 直接不可用**。所以要么 `?`（可空列），要么 `@default(dbgenerated("ST_SetSRID(ST_Point(0,0),4326)"))`（NOT NULL + 数据库默认值，仍可 create）；
- 官方示例的写法是带 schema 限定的 `Unsupported("\"public\".geography")?`——`Unsupported` 的字符串必须与 introspection 识别出的类型一致，**建议首次用 `prisma db pull` 校准写法**，避免 drift 检测误报。

类型选择建议（本项目"执法点位/半径查询"域）：

- **首选 `geography(Point, 4326)`**：`ST_DWithin` 直接用米，语义直观，且函数内置包围盒比较可走 GiST 索引（[ST_DWithin 文档](https://postgis.net/docs/ST_DWithin.html)）。官方示例也是 geography。
- 备选 `geometry(Point, 4326)`：若未来要做大量平面运算/栅格叠加再考虑；半径查询需要"度粗筛 + `ST_DistanceSphere` 米精筛"两段式（Prisma 8 扩展文档同款模式）。

### 3.3 双轨迁移工作流（dev 环境生成新迁移时）

```bash
# 0) 全部经 devenv 在容器内执行；数据库镜像用 postgis/postgis（内含扩展二进制）
#    推荐 postgis/postgis:17-3.5（Prisma 8 扩展文档同款镜像）

# 1) 照常改 schema.prisma（新增模型/字段/普通索引），然后生成"空"迁移
pnpm prisma migrate dev --create-only --name add_enforcement_point

# 2) 编辑 prisma/migrations/<timestamp>_add_enforcement_point/migration.sql
#    Prisma 已生成常规 DDL（含 Unsupported 列的 DDL），追加手写 PostGIS 部分：

-- AddPostGIS 手写部分：
CREATE INDEX "EnforcementPoint_location_idx"
  ON "EnforcementPoint" USING GIST ("location");

-- 可选：封装空间查询的数据库函数（官方示例模式，便于 $queryRaw 调用）
CREATE OR REPLACE FUNCTION "enforcement_points_within"(
  p_center geography(Point, 4326),
  p_radius_m double precision
) RETURNS TABLE (id int, name text, location geography(Point,4326))
AS $$
  SELECT e.id, e.name, e.location
  FROM "EnforcementPoint" e
  WHERE ST_DWithin(e.location, p_center, p_radius_m)
$$ LANGUAGE sql STABLE;

# 3) 应用（此步会在 shadow database 完整重放含 CREATE EXTENSION 的历史）
pnpm prisma migrate dev

# 4) 迁移目录随 git 提交——它就是 dev 与 e2e 共享的版本真相
```

首个迁移（init）额外包含（同样经 `--create-only` 手工确认后应用）：

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
```

要点：

- Prisma migrate 能为 `Unsupported` 列生成正确的 `CREATE TABLE`/`ALTER TABLE` DDL（官方示例的迁移就是"生成 + 手写函数"混合体），双轨混排是官方认可形态；
- **不要用 `prisma db push`**：它绕过迁移历史，与"版本真相在 migrations 目录"的策略冲突（仅适合官方说的早期原型草稿期，本项目不走这条路）；
- **已应用的迁移文件绝不修改**：`_prisma_migrations` 表按 checksum 校验，改动会报错；要改就追加新迁移。

### 3.4 空间读写（$queryRaw + ST_DWithin + GiST）

```ts
// apps/api/src/prisma/spatial/enforcement-point.repo.ts
import { PrismaService } from '../prisma.service';

export type LatLng = { lat: number; lng: number };

export class EnforcementPointRepo {
  constructor(private readonly db: PrismaService) {}

  /** 创建点位：地理列必须走原生 SQL（client 不能写 Unsupported 字段） */
  async create(name: string, at: LatLng) {
    const [row] = await this.db.$queryRaw<{ id: number }[]>`
      INSERT INTO "EnforcementPoint" ("name", "location")
      VALUES (${name}, ST_SetSRID(ST_Point(${at.lng}, ${at.lat}), 4326)::geography)
      RETURNING id
    `;
    return row;
  }

  /** 半径查询：ST_DWithin（geography 版，单位米）+ GiST 索引；
   *  输出用 ST_AsGeoJSON 转成可解析文本（原生返回是 WKB hex） */
  async findWithin(center: LatLng, radiusMeters: number) {
    return this.db.$queryRaw<{ id: number; name: string; geo: { type: string; coordinates: [number, number] } }[]>`
      SELECT id, name, ST_AsGeoJSON(location)::json AS geo,
             ST_Distance(location, ST_SetSRID(ST_Point(${center.lng}, ${center.lat}), 4326)::geography) AS distance_m
      FROM "EnforcementPoint"
      WHERE ST_DWithin(
        location,
        ST_SetSRID(ST_Point(${center.lng}, ${center.lat}), 4326)::geography,
        ${radiusMeters}
      )
      ORDER BY distance_m
    `;
  }
}
```

- `${}` 占位符由 `Prisma.sql` 标签模板参数化，防注入（[v7 raw database access](https://www.prisma.io/docs/orm/v7/prisma-client/queries/raw-database-access)）；
- `ST_DWithin`（geography 版）第三参即米，`use_spheroid` 默认 true；内置 bbox 比较自动利用 GiST 索引（[postgis.net](https://postgis.net/docs/ST_DWithin.html)）；
- geometry(4326) 若采用备选方案，则用两段式：`ST_DWithin(geom, :c, 0.05)`（度，走索引）+ `ST_DistanceSphere(geom, :c) <= :m`（米，精筛）；
- 复杂空间逻辑可下沉为数据库函数（官方示例即如此），repository 只 `$queryRaw` 调函数——对 agent DX 更友好：SQL 逻辑集中在迁移里接受 review。

### 3.5 dev 与 e2e 双数据库的迁移与版本策略

| | dev 库 | e2e 库（每会话/每 run 独立） |
| --- | --- | --- |
| 连接 | `DATABASE_URL` → 容器内 `natural_enforcement_dev` | `DATABASE_URL_E2E` → `e2e_<run_id>`（数据级隔离，同一个共享的 PostGIS 容器实例） |
| 命令 | `prisma migrate dev`（生成 + 应用 + drift 检测 + 可 reset） | `prisma migrate deploy`（只应用 pending 迁移） |
| shadow database | 需要；docker 内超级用户自动建/删，无云平台限制 | **不需要**（deploy 不碰 shadow、不做 drift 检测、绝不 reset） |
| 重置 | `prisma migrate reset`（drop + 全量重放） | 直接 `DROP DATABASE e2e_<run_id>` 重建 |
| 并发 | advisory lock 串行化（10s 超时）；**多 agent 并行生成迁移必须约定互斥**（同一时间只允许一个会话跑 `migrate dev`） | 各 e2e 库的 `_prisma_migrations` 相互独立，天然并发安全 |

依据（[v7 development-and-production 工作流](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/development-and-production)）：

- 官方原文："In a development environment, use the `migrate dev` command…In production and testing environments, use the `migrate deploy` command"；"`migrate dev` is a development command and should never be used in a production environment"（e2e 属于 testing 语义）；
- `migrate deploy` 不需要 shadow database、不检测 drift、不会触发 reset，失败快速、输出确定——契合 AI-Native 的 agent DX 要求；
- `migrate dev`/`deploy`/`resolve` 用 advisory locking（10 秒超时，不可配）防并发；可用 `PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK` 关闭（5.3.0 起），一般不需要。

**版本策略**：迁移目录随 git 单向前进（append-only）；e2e 库的生命周期 = 建库 → `migrate deploy` → seed → 跑用例 → drop。同一份迁移历史同时充当"e2e 从零建库的权威脚本"，天然验证迁移可重放性（shadow database 在每次 `migrate dev` 也在做同样的全量重放验证）。

---

## 四、迁移目录结构建议

```
apps/api/
├── prisma.config.ts                  # Prisma 7 配置（migrations 路径、env 加载）
└── prisma/
    ├── schema.prisma                 # 单一 schema；地理列用 Unsupported 占位
    └── migrations/                   # 唯一迁移目录 = 唯一版本真相（dev 与 e2e 共用）
        ├── migration_lock.toml       # Prisma 生成，锁定 provider=postgresql
        ├── 20261117000000_init_postgis/
        │   └── migration.sql         # CREATE EXTENSION postgis + 基础表（生成+手写混排）
        ├── 20261117010000_add_enforcement_point/
        │   └── migration.sql         # 常规 DDL（生成）+ GiST 索引 + 空间函数（手写）
        └── 20261117020000_seed_ref_data/
            └── migration.sql         # 可选：需随版本走的参考数据；测试数据仍走 seed 脚本
```

约定（写入工程基座 SPEC）：

1. **命名**：`<yyyymmddHHMMSS>_<snake_case_语义名>`，语义名显式标注含 PostGIS 内容（如 `add_enforcement_point_geo`），便于 agent 与人 review 时一眼识别双轨迁移；
2. **混排即规范**：Prisma 生成的段落保留 `-- CreateTable` 等注释头，手写段落用 `-- AddPostGIS:` 之类的注释头分隔；
3. **不建第二个 SQL 目录**（如 `sql/`、`db/postgis/` + 自研 runner）：两套真相会让 agent 在"该改哪个文件"上出错，且 `migrate deploy`/shadow database 只认 `prisma/migrations`；
4. 手写迁移必须幂等友好（`IF NOT EXISTS`、`CREATE OR REPLACE`），因为 shadow database 与 e2e 建库都会在空库上完整重放；
5. CI/质量门建议加一条 `prisma migrate diff --from-migrations ... --to-schema-datamodel ... --shadow-database-url ...` 的一致性校验（migration 终态 == schema），防止 agent 只改了一边。

---

## 五、风险与注意点

1. **不要把基座押在 Prisma 8 RC 上**：8.0.0 stable 尚未发布（原定 2026-10~11），RC 仍有 breaking change（官方博客明示，虽附升级方案）；且 8 是范式级重写（合约文件、新 CLI 命令面、新 raw API `db.query/db.execute`），周边（NestJS 生态、教程、agent 训练语料）需要时间跟上。
2. **切换 Prisma 8 的触发器**（建议写入地图 Decisions）：`@prisma/orm-extension-postgis` 发布 stable；`#30772`（`geometry(Polygon,4326)` 子类型声明）解决或确认不影响本项目；NestJS 侧无阻断。届时 8 与 7 可并行同库逐查询迁移（官方博客），双轨迁移目录在 8 的迁移体系中也有对应物（`ops.json` + `migration.ts`，支持非线性迁移图，对多 agent 并发更友好）。
3. **required `Unsupported` 字段会禁用该模型全部写操作**：地理列必须 `?` 可空或配 `@default(dbgenerated(...))`；选后者时注意默认值语义（如 `(0,0)` 点）是否可接受，或应用层把 NULL 视为"未定位"并在写入时强制补坐标。
4. **drift 误报**：`Unsupported("...")` 字符串必须与 introspection 输出的类型一致（是否带 `"public".` 前缀、是否带 `(Point,4326)` 修饰，取决于实际列类型）；首次以 `prisma db pull` 校准，之后照抄。
5. **shadow database 重放语义**：所有迁移（含 `CREATE EXTENSION`）都会在 shadow 库重放 → 数据库镜像必须自带 PostGIS（`postgis/postgis`）；dev 用户需 `CREATEDB` 权限（docker 默认超级用户天然满足）；**绝不能把 `shadowDatabaseUrl` 指向 dev 库本身**（官方警告会删数据）。
6. **WKB 陷阱**：`$queryRaw` 直接 select 地理列得到 WKB hex 字符串，必须 `ST_AsGeoJSON(...)::json` 或 `ST_AsText(...)`；同理 geography 与 geometry 之间用 `::geometry`/`::geography` 显式转换并统一 SRID，混用 SRID 会被 PostgreSQL 拒绝。
7. **度与米**：`ST_DWithin` geometry 版单位是 SRID 单位（4326 = 度，且高纬度/跨 180° 失真），geography 版才是米——半径语义一律走 geography 或两段式过滤。
8. **多 agent 并发**：`migrate dev` 生成迁移阶段必须互斥（同一 dev 库 + advisory lock 会直接失败于 10s 超时）；建议在 devenv 层为"迁移生成"提供显式锁/队列；e2e 各自建库 + `migrate deploy` 无此问题。
9. **squash/rebase 迁移历史的成本**：手写 SQL 使 `migrate diff` 无法完整推导（Prisma 只理解它认识的 DDL 子集）；需要收敛历史时用官方 baselining 流程重建基线，而不是删文件重放。
10. **旧教程污染**：2022-2024 的博客普遍教 `postgresqlExtensions` preview（已弃用）或第三方 client extension（如 npm 上的 `prisma-extension-postgis` 已 404 不存在）；agent 检索资料时应以本文来源清单为白名单。

---

## 六、来源（全部于 2026-11-16/17 查证）

**Prisma 官方文档**

- Prisma 8 PostGIS 扩展（Geometry 类型、dwithin/distanceSphere、GiST、迁移自动装扩展、SRID 陷阱）：https://www.prisma.io/docs/orm/extensions/postgis
- v7 PostgreSQL extensions（customized migrations 工作流；`--create-only` 三步曲）：https://www.prisma.io/docs/orm/v7/prisma-schema/postgresql-extensions
- v6 PostgreSQL extensions（postgresqlExtensions preview 于 v6.16.0 弃用的声明）：https://www.prisma.io/docs/orm/v6/prisma-schema/postgresql-extensions
- v7 Unsupported database features（`Unsupported` 语法、"扩展必须进迁移，shadow database 也需要"原文）：https://www.prisma.io/docs/orm/v7/prisma-schema/data-model/unsupported-database-features
- v7 迁移工作流·不支持特性（`--create-only` → 编辑 → 应用 → 提交；视图/触发器/存储过程必须进迁移）：https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/unsupported-database-features
- v7 Prisma Schema Reference（`Unsupported` 字段不出现在 client；required Unsupported 禁用 create/update/upsert；`@@index` 的 `type`/`ops` 参数）：https://www.prisma.io/docs/orm/v7/reference/prisma-schema-reference
- v7 索引文档（`type: Gist/Gin/SpGist/Brin/Hash`，`ops` 参数语法）：https://www.prisma.io/docs/orm/v7/prisma-schema/data-model/indexes
- v7 raw database access（`$queryRaw`/`Prisma.sql` 参数化）：https://www.prisma.io/docs/orm/v7/prisma-client/queries/raw-database-access
- v7 shadow database（用途、重放语义、CREATEDB、云平台限制、同库警告）：https://www.prisma.io/docs/orm/v7/prisma-migrate/understanding-prisma-migrate/shadow-database
- v7 development and production（dev 用 migrate dev、prod/testing 用 migrate deploy、advisory locking）：https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/development-and-production
- Prisma 8 raw queries（新 `db.raw.sql`/`db.query`/`db.execute`，评估 8 时需要）：https://www.prisma.io/docs/orm/prisma-client/queries/raw-database-access

**Prisma 官方博客**

- Is Prisma 8 ready for long-lived production apps?（RC 状态、stable 时间线、Prisma 7 维护 12 个月、7/8 并行迁移策略、迁移图设计）：https://www.prisma.io/blog/is-prisma-8-ready-for-long-lived-production-apps
- Prisma Next roadmap：https://www.prisma.io/blog/prisma-next-roadmap

**npm registry（版本状态实时查证）**

- prisma dist-tags（latest = 8.0.0-rc.33；8.0.0 不存在）：https://registry.npmjs.org/-/package/prisma/dist-tags
- @prisma/client dist-tags（latest = 7.10.1）：https://registry.npmjs.org/-/package/@prisma/client/dist-tags
- @prisma/orm-extension-postgis（latest = 8.0.0-rc.23，首 RC 约 2026-08-07）：https://registry.npmjs.org/@prisma/orm-extension-postgis

**GitHub（prisma/orm、prisma-examples）**

- #1798 Geolocation/Spatial types support（open，162 评论，2026-05-13 最后更新）：https://github.com/prisma/orm/issues/1798
- #30772 postgis.Geometry 无法声明 geometry(Polygon,4326) 子类型（open，2026-10-19）：https://github.com/prisma/orm/issues/30772
- #446 支持原生数据库类型 EPIC：https://github.com/prisma/orm/issues/446
- 官方示例 prisma-examples/orm/postgis-express（v7 结构：`Unsupported("\"public\".geography")?` + 手写迁移含 `CREATE EXTENSION ... schema "public"` 与 DB 函数 + `$queryRaw`/`st_point` 全 raw 读写）：https://github.com/prisma/prisma-examples/tree/latest/orm/postgis-express
  - schema.prisma：https://github.com/prisma/prisma-examples/blob/latest/orm/postgis-express/prisma/schema.prisma
  - 迁移 SQL：https://github.com/prisma/prisma-examples/blob/latest/orm/postgis-express/prisma/migrations/20210819135741_/migration.sql
  - 查询代码：https://github.com/prisma/prisma-examples/blob/latest/orm/postgis-express/src/server.ts

**PostGIS 官方**

- ST_DWithin（geometry 度 / geography 米、use_spheroid、bbox 比较利用索引）：https://postgis.net/docs/ST_DWithin.html
