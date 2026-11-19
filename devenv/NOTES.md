# PROTOTYPE #11 事实与坑清单（终版）

> 纵切一「环境与后端」。分支：`prototype/foundation-slice-1`（throwaway，不合入 dev）。
> 本文件是 #11 决议评论的原始素材与两份 SPEC（Spec-工程基座 / Spec-e2e体系）的直接输入。
> 除注明外，全部为 2026-11-19/20 容器内实测结论。

## 0. 验证结果总览（全绿）

| 票面要求 | 验证证据 |
|---|---|
| monorepo 布局落地 | apps/{web,api,e2e} + packages/{contracts,tsconfig}，pnpm 12 workspaces + catalog，turbo 2.11（构建期） |
| devenv 完整命令面 | build/up/down/restart/ps/logs/exec/shell/test/test:unit/lint/typecheck/migrate/migrate:create/seed/wait/doctor/status/images 全部实测；幂等（up×2、migrate×2、seed×2 干净重入）；--json/JSONL；退出码 0/2/3/4/5/6 枚举落地 |
| 基础设施容器 | postgis/postgis:18-3.6（PostGIS 3.6.4）+ redis:8.2.11-alpine + rustfs/rustfs:1.0.6 全 Healthy；tag+digest 双层锁（images.lock）+ `images --verify` sha256 对比通过 |
| PostGIS 真实地理特性 | geography(Point,4326) + ST_DWithin 半径查询 + ST_Distance 排序；**EXPLAIN (ANALYZE) 实证 Index Scan using enforcementpoint_location_idx**（2000 点 + ANALYZE，非默认关闭 seqscan） |
| BullMQ 往返 | POST /evidence → 队列消费 → GetObject → sha256/bytes 回写 status=ready；集成测试断言往返闭环 |
| rustfs 往返 | 上传（put）→ 流式读回 + presigned URL 双路字节一致（sha256 互证）；forcePathStyle=true |
| 容器内测试 | 5 文件 16 用例全绿（contracts 单元 6 + api 单元 5 + geo 集成 3 + 全链路集成 6... 计数见运行输出）；`devenv test` 退出码 0 |
| 运行态冒烟 | 运行中 api：/health 200；/nearby 返回 7 点按距离排序（天安门 0m…西单 1984m）；非法 body → 400 + issues |

## 1. 重大环境发现（影响 SPEC 全局架构）

**宿主 "docker" = Rancher Desktop 的 podman machine（独立 WSL 发行版）**：

- 证据链：`DOCKER_HOST=unix:///mnt/wsl/podman-sockets/podman-machine-default/podman-root.sock`；`~/.local/bin/docker`（client 29.1.3，另有指向 Rancher Windows 侧 CLI 的 backup 软链）；server 版本报 6.1.4=podman 版本；容器带 `io.buildah.version:1.45.2` 标签；卷路径 `/var/lib/containers/storage/volumes/...`；本发行版无 docker.sock、无 podman CLI、dpkg 零 docker 包；sudo 需密码（无法原地装真 engine）。
- **bind mount 静默挂错**（本票最大坑）：bind 的宿主绝对路径在 machine 文件系统内解析——挂 `/home/hulei815/Workspaces/natural-enforcement-prj` 进容器，内容是 machine 里一份旧同名目录（e2e/frontend/infra），不报错、内容全错。对 agent 是最危险故障类别。Workspaces 下 `_ne_leak_quarantine_*` 目录暗示此前已有人踩过。
- 其它被逼出的事实：无 buildx 插件（`docker buildx` 不存在；compose 2.40 默认 Bake 构建会试图拉 `moby/buildkit` 镜像 → devenv 一律 `docker build` 走 daemon 内建构建器）；compose 相对 bind 路径按**调用方 CWD** 解析（`-f` 所在目录不可靠）；`docker ps` Status **不带 "(healthy)" 后缀**（健康态以 `docker inspect .State.Health.Status` 为准）；`docker ps` 不接受空串参数（`"${VAR:+-a}"` 引号展开即炸）。

**架构转向：无 bind 烘焙镜像**（本票核心设计输出）：

- 代码经 `docker build` COPY 进 workspace 镜像（manifest 层 → `pnpm install --frozen-lockfile`，源码层 → turbo build）；lockfile 首次由 lockgen 靶生成 + `docker cp` 导出（`--lockfile-only` 不拉包）。
- 源码消费型命令（up/test/lint/typecheck/migrate*/seed）前置秒级增量重建（`ensure_fresh_workspace`）——"改完即 build"成为命令面内建语义，agent 无需记忆。
- 运行容器统一以镜像默认 root 运行：镜像内容物为 buildah root 属主，uid 化容器对 dist/日志/迁移目录全线 EACCES；dev 单机场景无安全边界损失，卷内容不回宿主。
- compose 只挂命名卷（turbo 缓存 /workspace/.turbo；pgdata；rustfs-data）；**零宿主端口发布**——多 agent worktree 并发天然零端口冲突。
- 代价与遗留：多 worktree 并发时单 tag `workspace:local` 的镜像竞争（SPEC 需决策 per-worktree tag 或集中构建）；`migrate:create` 必须走"留名容器 + docker cp 导出 + 合并"特例。

## 2. 版本矩阵落地修正（npm registry 2026-11-19 实查）

| 项 | 实查 latest | 本纵切采用 |
|---|---|---|
| typescript | **7.0.2**（原生编译器 GA） | 6.0.3（按矩阵决策；7 为后续提速项） |
| prisma CLI | **8.0.0-rc.34**（stable 仍未发） | 显式锁 7.10.1 三件套（caret 会漂向 RC 风险 → 精确 pin） |
| ioredis | **6.0.0** | 6.0.0（bullmq 6.7.8 peer `>=5` 兼容，具名导出 `Redis`） |
| eslint / @eslint/js | **10.15 / 10.0.1** | 10（typescript-eslint 8.73 peer 接受 ^10） |
| vitest | **5.1.1** | 5.1.1 |
| @nestjs/* | 12.5.1 / swagger 12.1.2 | 同左 |
| zod | 4.6.7 | 同左（peer 全兼容） |

## 3. pnpm 12 供应链防护三连坑（全部实测）

1. **`minimumReleaseAge`**：默认拦截"发布过新"版本（ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION）；配置**只认 pnpm-workspace.yaml 的 camelCase 键**，.npmrc 的 `minimum-release-age` 无效。原型期=0；SPEC 决策点：确定性解析 vs 新包冷却期。
2. **依赖构建脚本默认禁跑**（ERR_PNPM_IGNORED_BUILDS，任何未决即硬失败）：`onlyBuiltDependencies`/`ignoredBuiltDependencies` 在 12.21.0 **均不生效**；真实机制 = `pnpm approve-builds`（非交互 `--all --yes`）写 **`allowBuilds` 映射且键必须带版本号**（`prisma@7.10.1: true`；裸包名不匹配）。`strictDepBuilds: false` 可整体降级警告（未采用）。版本号进键 = 每次升级都是显式审查点（AI-native 友好，建议 SPEC 保留）。
3. **approve 即补跑**：`pnpm approve-builds` 批准后立刻执行该包 postinstall——CI/镜像内顺序敏感（本项目预写 allowBuilds 规避）。

## 4. Prisma 7 + PostGIS 实测事实（对调研报告的修正与确认）

- **schema 内 `datasource.url` 已禁用**（P1012）——migrate 连接串进 prisma.config.ts **顶层 `datasource.url`**（放 `migrations.url` 不行）。
- **generator `output` 相对 schema 文件解析**（不是包根）：要落 src 需写 `../src/generated/client`。
- 生成入口是**目录内文件 `client/client.ts`**；nodenext 导入必须 `../src/generated/client/client.js`（目录式 `.js` 后缀导入无效）。
- generator 选项 `runtime="nodejs"` + `moduleFormat="esm"` + `generatedFileExtension="ts"` 全被 7.10.1 接受。
- `Unsupported("geography(Point,4326)")?` 双轨模式**完整走通**：迁移 DDL 正确生成 geography 可空列；`CREATE EXTENSION` 置于文件头（shadow db 重放需要）；GiST 索引手写追加；`migrate dev --create-only` + `migrate deploy` 全流程验证。
- prisma schema 注释是 `//` 不是 `#`（低级但真实）。
- adapter-pg + `$queryRaw` 参数化、float8→number、timestamp→Date 均正常。

## 5. NestJS 12 + TS6 + ESM 实测事实

- **导出面变化**：`@nestjs/core` 不再导出 `INestApplication`（用 `NestApplication` 具体类或从 `@nestjs/common` 取 INestApplication）与 `Logger`（改 `@nestjs/common`）。
- **DI × `import type` 陷阱**：构造器注入的类必须**值导入**——`import type` 擦除后 design:paramtypes 全退化为 `Function`，DI 报 UnknownDependenciesException。规则：注入参数一律值导入；纯类型标注才用 import type。
- **NestJS 12 的 Standard Schema 支持是响应序列化拦截器**（`StandardSchemaSerializerInterceptor` + `@SerializeOptions({schema})`，探测 d.ts 定案），**请求校验无原生管道** → #9 预案的自写 `ZodValidationPipe` 是正解（实测 400 + issues 输出符合预期）。
- **OpenAPI 派生断点（SPEC 待解）**：@nestjs/swagger 12.1.2 路径/标签/operationId 派生 ✓；但 **裸 zod schema 与 `z.toJSONSchema()` 挂 `@ApiBody({schema})` 均不产 requestBody**（根因未深挖：疑似 OpenAPI 3.0 子集过滤或装饰器 API 变化）。`StandardSchemaOpenApiConverter` 与文档级 `standardSchemaConverter` 钩子存在，是 SPEC 阶段的排查入口；Schemathesis 侧可临时直接吃 zod 导出的 JSON Schema。
- HTTP query 参数以字符串到达：契约 schema 用 `z.coerce.number()`（已在 contracts 落地）。
- octet-stream 原始字节上传需 `bodyParser:false` + 手工 `express.raw`（Nest 默认 parser 不含 raw）。

## 6. 其余坑清单

- **PostgreSQL 18 官方镜像要求卷挂 `/var/lib/postgresql`（父目录）**而非 `/data`——data 落版本子目录以支持 pg_upgrade；挂错直接退出并提示。首次 initdb 超 90s（慢网）→ up 等待窗按 SPEC 调大或分阶段。
- **turbo 在 podman-uid 场景全线 EACCES**（缓存/日志写入，含 TURBO_LOG_DIR 定向与 --no-daemon 均未根治）→ **运行期命令改 `pnpm -r --no-bail` 直跑；turbo 只用于镜像构建期**（该上下文正常）。SPEC 需重评 turbo 运行期价值或修复路径（worktree 缓存共享的吸引力仍在）。
- **vitest 5 解析怪癖**：test/helpers 子目录内 `../src/x.js` 报 Cannot find module（同形导入在 test/ 顶层正常）→ 装配内联进 spec 规避。
- **HTTP header 非 Latin-1 字符直接抛 TypeError**（undici）：中文文件名不能进自定义 header——unicode 文件名传输契约（RFC 8187 / multipart / base64 头）为 SPEC 决策点。
- rustfs 官方镜像含 curl，`/health` 健康检查可用；单节点 + named volume 免 chown（调研结论实证）。
- 慢网（~110KB/s）下冷启动代价：4 基础镜像 ~1GB + 全量 npm 依赖下载，首次 `devenv build` 约 1–1.5h；层缓存后增量秒级。SPEC 冷启动清单必须含镜像预热与依赖层预烘。

## 7. devenv 命令面终态

见 `devenv/COMMANDS.md`（Action | Command | 期望退出码 表 + 退出码枚举 + 并发语义）。全部命令实测通过；独占锁（build/migrate/migrate:create，flock /tmp 跨 worktree）与 `--json`/JSONL、进度 stderr/stdout 分流按设计工作。

## 8. SPEC 输入清单（决策点汇总）

1. 运行时基座：podman machine 的无 bind 烘焙架构是否定为 Spec-工程基座 基线（vs 要求真 docker engine）。
2. 多 worktree 的 workspace 镜像 tag 策略与集中构建。
3. `minimumReleaseAge` 取值（0 vs 冷却期）与 `allowBuilds` 版本化键的维护流程。
4. OpenAPI 请求体派生断点的修复路径（swagger 12.1.2）。
5. unicode 文件名传输契约。
6. turbo 运行期角色重评（podman-uid 修复 or pnpm -r 常态化）。
7. up 健康等待窗与冷启动镜像预热（devenv prefetch 类命令）。
8. `devenv test` 并发语义（共享 infra + 数据级隔离在 e2e 切面的落实——与 #13 衔接）。
