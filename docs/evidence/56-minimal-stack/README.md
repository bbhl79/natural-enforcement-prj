# #56 证据：Windows 真实链路 + 空间查询（最小空间数据开发栈）

- 票：[#56 Task-贯通最小空间数据开发栈](https://github.com/bbhl79/natural-enforcement-prj/issues/56)（parent [#23 Spec-工程基座](https://github.com/bbhl79/natural-enforcement-prj/issues/23)）
- 日期：2026-11-25
- 平台（Spec 支持环境矩阵·Windows 开发机行）：WSL2 Ubuntu + docker CLI 29.1.3（Ubuntu 包）+ compose v2.40.3 + Podman Engine 6.1.4 machine（Fedora 44，Rancher Desktop WSL 集成，经 podman-root.sock）
- 口径：全部命令经 `./devenv/devenv` 唯一入口执行；结构化输出为 `--json` 实跑捕获（stdout 原样），进度/子进程输出在对应 `.stderr.txt`；退出码在对应 `.exitcode`。

## 验收标准对照

| # | 验收标准 | 证据 | 结论 |
|---|---|---|---|
| 1 | Windows 依次 doctor → prefetch → build → up → verify → 集成 test → web，等到真实健康终态 | `01`–`08` 各命令 JSON/JSONL + 退出码全 0；up 含 db 健康→迁移应用→api 健康终态等待 | ✅ |
| 2 | 浏览器旅程用契约包路由/schema/推断类型；API 请求 zod 校验；web 响应统一校验封装 | `09-web-journey.txt`：经 web 源（localhost:5173，与浏览器同路径）HTML 200 → /health → nearby 真实数据 → 非法 query/body 均 400 + zod issues；统一封装 `apps/web/src/lib/validate.ts`（transformResponse 一律经 `validated()`） | ✅ |
| 3 | PostGIS 镜像引用是可配置输入，不写死单一平台路线 | `12-db-image-override.txt`：`DEVENV_DB_IMAGE` 覆盖生效并报告来源（默认 images.lock / 覆盖 kartoza multiarch 候选）；非法格式 exit 2；锁文件不变 | ✅ |
| 4 | 源码烘焙进镜像，只命名卷；宿主无项目工具链；除 web 外无宿主端口 | `11-host-residue.txt`：工作区零 node_modules/dist；宿主工具链路径今日零写入（归因诚实口径）；`docker ps` 仅 web 发布 5173，db/api 零宿主端口 | ✅ |
| 5 | 结构化输出、进度分流、枚举退出码、引擎端点/身份/版本/架构报告；现有 GitHub App 离线测试保持通过 | 各 `.jsonl` 含 `{"event":"engine","identity":"podman","version":"6.1.4","arch":"amd64","endpoint":...}`；stdout 纯结果流、进度全 stderr；`15-auth-offline.txt`：test:auth 71 通过 0 失败（本票改动后复跑） | ✅ |
| 6 | 留存本票 Windows 真实链路和空间查询证据 | 本目录全部文件；空间证据 `10-spatial-evidence.txt` | ✅ |

## 空间查询证据（`10-spatial-evidence.txt`）

- 库内 5 点位（幂等种子）；`devenv test` 跑完测试残留（it-/http-/exp- 前缀）为 **0**——
  集成测试按统一前缀自清理并断言零残留。
- `EXPLAIN (ANALYZE)`（统计有效规模：2000 合成点 + ANALYZE，证据后清理回 5）：
  `Index Scan using "EnforcementPoint_location_idx"`——ST_DWithin 半径查询 + `<->` KNN
  排序走 GiST 索引（非 Seq Scan；5 行小表 Seq Scan 是规划器正确选择，索引证据须在有效规模展示）。
- PostGIS 3.6（USE_GEOS=1 USE_PROJ=1）。
- 经 web 源的 nearby 实返：5 个种子点位按 ST_Distance 升序（越秀公园 766m … 广州塔 6645m，
  半径 8000m，中心 23.1291,113.2644 广州市政府一带），无测试残留点位。

## 命令序列与退出码

| 序 | 命令 | 退出码 | 证据 |
|---|---|---|---|
| 0 | `devenv down --volumes`（清场，含原型遗留卷） | 0 | `00-down-volumes.*` |
| 1 | `devenv --json doctor` | 0 | `01-doctor.json`（9 检查项：引擎/矩阵/compose/锁/DB 镜像/镜像/服务） |
| 2 | `devenv --json prefetch` | 0 | `02-prefetch.jsonl`（两上游镜像按锁 digest 拉取） |
| 3 | `devenv --json build` | 0 | `03-build.jsonl`（热缓存 7s；冷构建见下注） |
| 4 | `devenv --json up` | 0 | `04-up.jsonl`（db 健康→migrate deploy→api 健康） |
| 5 | `devenv --json verify` | 0 | `05-verify.jsonl`（lint+typecheck+test:unit 全 ok） |
| 6 | `devenv --json test` | 0 | `06-test.jsonl`（31 用例：contracts 10 + api 10 + web 11，含 geo 集成 3 与两个自清理用例；跑完库内测试点位为 0，见 `10` 第 2 节） |
| 7 | `devenv seed` | 0 | `07-seed.stderr.txt`（`{"seeded":5,"mode":"idempotent"}`） |
| 8 | `devenv --json web` | 0 | `08-web.jsonl`（`http://localhost:5173` 健康终态） |
| 9 | 浏览器旅程（curl 经 web 源） | — | `09-web-journey.txt`（诚实口径：浏览器路径代理，RTK Query 内执行由 jsdom 测试覆盖） |
| 10 | 空间证据（exec db psql EXPLAIN） | — | `10-spatial-evidence.txt` |
| 11 | 宿主残留检查 | — | `11-host-residue.txt` |
| 12 | DB 镜像覆盖演示 | — | `12-db-image-override.txt` |
| 13 | `devenv --json images --verify` | 0 | `13-images-verify.json`（运行 digest == 锁 digest） |
| 14 | 幂等重入（up×2 / seed×2 / migrate×2） | 0 | `14-idempotency.txt` |
| 15 | `devenv test:auth`（现有 GitHub App 离线测试保持通过） | 0 | `15-auth-offline.txt`（71 通过 0 失败） |
| 16 | `devenv test:devenv`（命令面离线测试） | 0 | `16-devenv-offline.txt`（27 通过 0 失败） |

注：首次冷构建（lockgen 解析 + 全量依赖下载 + turbo build）在本机慢网（~200KB/s）约 25 分钟；
`03-build.jsonl` 为层缓存命中后的增量构建（7s）。deps 层缓存优化结论的采纳归 #58。

## 证据跑中发现的两个真实缺陷（已修复并复跑通过）

1. **db 健康检查 init 竞态**：官方 postgres 镜像 init 阶段临时服务器只监听 unix socket，
   裸 `pg_isready`（默认 socket）在 init 窗口期误报健康，随后临时服务器停止 → 紧随的
   migrate 撞 P1001。修复：健康检查改 `pg_isready -h 127.0.0.1`（TCP），并把 up 定为
   db 健康 → 迁移应用 → api 启动 的顺序（api 不服务于无 schema 窗口期）。
2. **web 缺 zod 依赖声明**：`lib/validate.ts`（统一校验封装）直接 import zod 但
   apps/web 未声明 → typecheck/test:unit 失败。修复：补声明 + `build --lockgen`
   重生成锁文件（zod 4.6.7 本在树内，锁文件 diff 仅 web importer 增行）。

## 评审轮（双轴 code-review）后的加固（已复跑全绿）

- 结构化命令的子进程退出码不再外逸：docker/compose 步骤统一经 `run_step` 包装
  （失败 → 终值事件 exitCode=4 + taskRc，进程退出 4），枚举退出码不被绕过。
- `images`/`status` 的 --json 输出协议修正（锁文件原文不再混入 JSON 结果流；
  status --json 不再静默退化为 ps）。`migrate:create` 导出目录名排除
  migration_lock.toml（字母序陷阱）。`web` 启动纳入 stack 排他锁（锁表已更新）。
- 契约全覆盖补齐：`/health` 响应入契约（HealthResultSchema）+ web 侧经统一校验
  封装；api service/repo 入出参改用契约 DTO 类型（不内联重声明）。
- 广州化补漏：geo 单元测试坐标、api-flow 否定用例经度。

## 指挥者评审轮（PR #82 评审意见）后的修正（已复跑全绿）

- **集成测试自清理**：geo.spec（it-near/it-far/exp bulk）与 api-flow.spec（http-*）
  统一 run 前缀，收尾删除 + 断言按前缀零残留；`devenv test` 跑完库内测试点位为 0
  （`10` 第 1–2 节实测）。证据链（06/09/10）随之重跑对齐：nearby 只余 5 个种子点位。
- **空间证据口径**：GiST 索引证据改在统计有效规模展示（2000 合成点 + ANALYZE，
  证据后清理回 5）——5 行小表 Seq Scan 是规划器正确选择，不再误读。
- **`devenv down` 加 `--remove-orphans`**：清掉不在 compose 文件中的本项目遗留容器
  （原型 redis/rustfs）；COMMANDS.md 注明 down 不含 profile 隔离的 web（用 `web --down`）。

## 诚实边界

- 本证据证明 #56 最小链路在 Windows 开发机真实通过；不声称 macOS 已支持（#57/#78），
  不声称并发/worktree 隔离/锁冲突矩阵已验收（#59/#61/#62），不声称快照/不可变绑定（#58）。
- 宿主残留检查为项目特征路径比对（范围明示），非「宿主从未装工具」全称证明。
- DB 镜像覆盖证明可配置机制与报告链路；备选镜像真实运行归 #57。
