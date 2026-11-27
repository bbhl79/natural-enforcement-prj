# #53 证据：macOS Apple Silicon 数据库 ARM 路线（阶段 0 实验①）

- 票：[#53 Task-阶段0核定macOS数据库路线](https://github.com/bbhl79/natural-enforcement-prj/issues/53)（parent [#23 Spec-工程基座](https://github.com/bbhl79/natural-enforcement-prj/issues/23) 阶段 0 实验①）
- 日期：2026-11-27
- 路径说明：本目录沿用 #53 runbook 约定的 `docs/research/macos-arm-evidence/`（非 `docs/evidence/<票号>-<slug>/` 惯例，因 runbook 已指定）。
- 机器：Apple Silicon Mac（macOS **27.2.1** / Darwin 27.2.0 / arm64）；Podman 6.1.4，machine provider **libkrun**，8 vCPU / 44.7 GiB / 376 GiB
- 口径：**验收路径**（doctor/prefetch/build/up/seed/test/verify/exec/images）一律经 `./devenv/devenv` 唯一入口；结构化输出为 `--json` 实跑捕获（stdout 原样），进度/子进程输出在 `.err`；退出码在 `.exitcode`。DB 路线切换只用 `DEVENV_DB_IMAGE` 覆盖，**未改 `devenv/images.lock`**。
- **口径例外（如实标注）**：A/B 候选对照（`12-*`）、镜像/环境元数据（`00-*`、`15-*`）使用直接 `podman`/`docker`/`curl`，属于**研究对照与观测仪器**，不是验收路径；选定路线 B 的迁移、空间查询、集成测试全部经 devenv（上表 1–14 行）。
- 结论：**选定候选 B（kartoza/postgis multiarch，arm64 原生）**；候选 A（amd64 仿真）可用但在本机 qemu 下空间负载慢 25–33 倍，且需要 per-service 平台 pin（devenv 尚未支持），不作默认。Mac 等待预算实测值见下表，**核定权在指挥者**。

## 运行环境核实（验收标准 1）

| 项 | 实测 |
| --- | --- |
| 宿主 | macOS 27.2.1（Darwin 27.2.0），`uname -m` = arm64 |
| Podman | client/server 6.1.4；machine `podman-machine-default`，VM TYPE **libkrun** |
| Rosetta | 宿主 **未安装**（`arch -x86_64 /usr/bin/true` → Bad CPU type）；`podman machine inspect` → `"Rosetta": false` |
| VM binfmt | `qemu-aarch64_be` / `qemu-i386` / `qemu-i486` / **`qemu-x86_64`**（amd64 经 qemu 用户态仿真，非 Rosetta） |
| 引擎端点 | `DEVENV_DOCKER_HOST=unix://$HOME/.local/share/containers/podman/machine/podman.sock`（显式覆盖；默认发现同时命中该 socket 与 `/var/run/docker.sock`，按 SPEC 歧义即失败） |
| 宿主工具 | docker CLI 29.10.1（brew）、compose v5.6.1（插件符号链接）、coreutils（`gstat`）、jq/openssl/curl/gh/git |

原始输出：`00-environment.txt`。Rosetta 能力结论：**本机当前不具备 Rosetta 路线**；候选 A 的实测因此是 qemu 仿真（研究文档 §3 的“近原生”前提在本机不成立）。

## 候选路线对比（同一 SQL 负载，容器内 TCP + 密码就绪）

| 指标 | A：`postgis/postgis:18-3.6`（amd64/qemu） | B：`kartoza/postgis:18.6-3.6.4`（arm64 原生） | 比值（A/B） |
| --- | --- | --- | --- |
| 首次口令可用启动 | 19.7 s | 7.4 s | 2.7× |
| `CREATE TABLE`（50k 表） | 37 ms | 1.5 ms | 24× |
| `INSERT` 50k 点 | 916 ms | 34 ms | 27× |
| GiST 索引（50k） | 2545 ms | 78 ms | 33× |
| `ANALYZE` | 1765 ms | 82 ms | 22× |
| `ST_DWithin` + KNN（GiST） | **133.5 ms** | **5.2 ms** | 26× |
| 镜像本地大小 | 698 MB | 1.84 GB | 0.38× |
| 索引使用 | Bitmap Index Scan | Bitmap Index Scan | — |

原始输出：`12-db-route-probes.txt`。查询负载：50k 随机点（广州市区）+ GiST 索引，
`ST_DWithin(location, 市政府坐标, 2000m) ORDER BY <-> LIMIT 5`。

**候选 A 的额外阻塞**：镜像 amd64-only，arm64 宿主直接 `docker pull` 报
`no image found in image index for architecture "arm64"...`（`12a-pull-amd64-only.txt`）。
选 A 必须在 db 服务上 pin `linux/amd64`（compose `platform:` 或等价机制），devenv 当前
没有该机制；本次实验通过 `DOCKER_DEFAULT_PLATFORM=linux/amd64` 仅用于取证拉取。

## 选定路线 B 的 devenv 全链路（验收标准 2）

| 序 | 命令（环境前缀：`DEVENV_DOCKER_HOST=... DEVENV_DB_IMAGE=kartoza/...@sha256:5fa6…`） | 退出码 | 耗时 | 证据 |
| --- | --- | --- | --- | --- |
| 1 | `devenv doctor` | 0 | — | `01-doctor.json`（引擎/矩阵/compose/锁/DB 覆盖/worktree/凭据/镜像/服务全 ok） |
| 2 | `devenv prefetch` | 0 | 9.5 s（镜像已缓存） | `01-prefetch.jsonl`（拉取 kartoza 覆盖值 + node）；`16-timings.txt` |
| 3 | `devenv build`（冷构建） | 0 | 244 s | `02-build.jsonl` 终值 `duration:"244s"`（快照 `caacb62e…`，workspace + tools 镜像） |
| 4 | `devenv up`（db 健康 → migrate deploy → api 健康） | 0 | 56.4 s | `03-up-routeB.jsonl`（含迁移已应用）；`16-timings.txt` |
| 5 | `devenv seed` | 0 | 49.0 s | `04-seed.err`（`{"seeded":5,"mode":"idempotent"}`；`.out` 为空）；`16-timings.txt` |
| 6 | `devenv test`（单元 + 集成；`test/geo.spec.ts`、`util/geo.spec.ts` 各 3 用例） | 0 | 67.5 s | `05-test.jsonl` + `.err`；`16-timings.txt` |
| 7 | `devenv build` + `devenv up`（同机二次冷启动） | 0 | 40.0 s + 60.4 s = 100.4 s | `06-build2.jsonl` / `07-up2.jsonl`；`16-timings.txt` |
| 8 | 增量重建 ×5（改 `apps/api/src/main.ts` 注释 → `devenv up` 到 api 健康） | 0 ×5 | 55/55/55/54/54 s（中位 55 s） | `13-incremental-*.jsonl`、`13-incremental-timings.txt` |
| 9 | `devenv verify`（lint + typecheck + test:unit） | 0 | 100.6 s | `09-verify.jsonl`；`16-timings.txt` |
| 10 | `devenv images --verify` | 0 | — | `08-images-verify.json`（运行 digest = 锁/覆盖 digest `sha256:5fa6…`） |
| 11 | `devenv exec db -- psql`：行数 + `EXPLAIN (ANALYZE)` | 0 | — | `14-spatial-query.txt`（5 行；`Index Scan using "EnforcementPoint_location_idx"`，4.6 ms） |
| 12 | `devenv test:devenv`（命令面离线） | 0 | — | `10-test-devenv.out`（191 通过 0 失败 = 44+58+89） |
| 13 | `devenv test:auth`（认证入口离线） | 0 | — | `11-test-auth.out`（71 通过 0 失败） |

> 迁移由 `devenv up` 内幂等应用（`migrate deploy` 步骤 0），无需单独 `devenv migrate`。
> 空间查询命令与 runbook 的差异：kartoza 的 unix socket 使用 peer 认证，`devenv exec db`
> 需走 TCP + 容器内口令：`sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 …'`
> （口令不落宿主 shell、不写证据）。

## Mac 等待预算实测（验收标准 3；核定权在指挥者）

| 操作 | 实测（中位 / 最差） | Windows 参考预算 | 指挥者核定 |
| --- | --- | --- | --- |
| 增量重建（终点含服务更新 + 就绪检查） | **55 s / 55 s**（5 次） | ≤ 60 s | 待核定 |
| 首次冷启动（build + start；不含下载） | **约 300.4 s**（build 244 s 取自 JSONL + up 56.4 s 同命令实测；首次 up 未单独留存） | ≤ 15 min | 待核定 |
| 同机二次冷启动（build + up） | **100.4 s**（40.0 + 60.4，单次） | ≤ 10 min | 待核定 |
| 集成测试（`devenv test`） | **67.5 s**（单次） | — | 待核定 |
| 新增包闭环 | 未测（归 #58 deps 缓存路线） | ≤ 10 min | 不适用本票 |

计时原始值：`16-timings.txt`（含精确 argv 与环境前缀）与 `02-build.jsonl` / `13-incremental-timings.txt`。
首次镜像下载（Node 约 45 s、DB 约 96 s，stopwatch）属下载段，无硬预算，未纳入预算行、未单独留存文件；
`01-prefetch.jsonl` 为缓存命中的 9.5 s 复跑。

诚实口径：以上为单次或 5 次样本的实测；#78 正式验收须按测量协议重跑并记录 5 次中位/最差。
本票不预先领取“预算达标即自动验收”。

## 第三方镜像供应链审查（选择 B 的前置）

- **来源**：[github.com/kartoza/docker-postgis](https://github.com/kartoza/docker-postgis)，Kartoza 维护，2014 年创建，707 stars，3 open issues，2026-11-15 仍有推送，未归档。
- **构建过程**：Dockerfile 基于 `debian:trixie-slim`，通过 **PGDG apt 源 + GPG 签名**安装
  PostgreSQL/PostGIS；GitHub Actions 工作流 `build-latest.yaml` / `check-image.yaml` /
  `deploy-image.yaml`；镜像内 `/etc/kartoza/build_info.env` 记录实际版本与 base digest：
  `PG_VER_PROD=18.6`、`GIS_VER_PROD=3.6.4`、`BASE_IMAGE_DIGEST_SHA=debian@sha256:62bd…`。
- **更新机制**：Docker Hub 精确 tag（本实验 `18.6-3.6.4`）+ multiarch manifest-list digest
  `sha256:5fa6f8e2…` 双层 pin；`devenv images --verify` 运行态校验通过。
- **风险（如实）**：非 Docker Official Image；镜像 1.84 GB（官方 amd64 698 MB），额外携带
  pgrouting / raster / cron / h3 / ogr_fdw / my_fdw（前两者之外多为未使用攻击面）；
  build 脚本 GPL-2.0（本项目仅 dev 使用，不分发镜像；若未来分发须复核义务）。
- **结论（待指挥者核定）**：在 **digest pin + 来源/构建/更新可核** 的前提下可接受，作为
  macOS ARM 默认路线；供应链门禁的正式登记归 #63。

原始输出：`15-image-metadata.txt`（镜像平台/大小/build_info/labels）、`15a-supply-chain-github-api.json`（仓库元数据、workflows、tags，公开未认证读取）、`15b-kartoza-Dockerfile.txt`（构建脚本原文）。

## 决策（候选 B）与理由

1. **B 原生 arm64**：同一空间负载比 A（qemu）快 25–33 倍；启动快 2.7 倍；无需平台 pin，
   现有 devenv 命令面零改动即可跑通（只经 `DEVENV_DB_IMAGE` 覆盖）。
2. **A 不作默认**：本机无 Rosetta（qemu 仿真），且 amd64-only 镜像要求 per-service 平台 pin
   （devenv 尚未支持）；作为“零改动沿用官方镜像”的优势在本机不成立。
3. **C（自建 arm64）不采用**：B 已满足需求，自建带来跟随 PG/PostGIS 版本与构建/扫描流水线的持续维护成本。
4. **未决项**：Mac 预算待指挥者核定；`images.lock` 仍锁官方 amd64 镜像，#63 按本路线登记
   kartoza tag + manifest-list digest（或实现按平台选择）；Rosetta 路线未实测，若后续安装
   Rosetta 2 可复测 A 作对照，不影响本决策。**未声称 macOS 已支持**——正式验收归 #78。

## 实验中发现并修复的 macOS 兼容缺陷

1. **bash 3.2 变量名解析**：`$VAR` 紧邻全角字符（如 `$PROJECT_NAME（`）被解析为非法变量名，
   `set -u` 下报 unbound variable。已把 12 个脚本文件中的这类引用改为 `${VAR}`（行为不变）。
   rebase 到 PR #87 后，其 `offline.test.sh` 新增 6 处同类写法，本分支一并改为 `${VAR}`
   （合计 13 个脚本文件）。
2. **bash 3.2 空数组展开**：`"${extra[@]}"` 在空数组时 unbound；`devenv doctor` 的
   `svc_container_id` 首当其冲。改为 `${extra[@]+"${extra[@]}"}`（与既有写法一致）。
3. **认证入口 BSD stat**：私钥权限检查只有 GNU `stat -c`；增加 BSD `stat -f` 回退。
   该修复由 PR #87（`fix/github-app-macos-stat`）独立完成，本分支 rebase 后复验。
4. **认证离线测试可移植性**：mock curl 使用 macOS 不存在的 `flock` → 改 POSIX `mkdir` 自旋锁；
   `wc -l` 前导空格导致 T11 误判。该修复同样由 PR #87 完成。

复跑结果（rebase 到 PR #87 之后）：`test:devenv` 191/191（44+58+89）、`test:auth` 75/75
（#87 新增用例，含修复前的 `offline.test.sh` bash 3.2 unbound）、`verify` 全绿、`test` 全绿。

## 未做 / 不声称

- 不是 Mac 正式全量验收（#78）：未做 3 worktree 并发、并行 e2e、容量/内存/磁盘、干净机冷启动、宿主残留反例。
- 未改 `devenv/images.lock` 与默认 DB 镜像；macOS 当前仍需 `DEVENV_DB_IMAGE` 显式覆盖。
- macOS 上 GitHub App 真实集成（JWT/换 token/推送）未复测；仅离线套件通过。
- Rosetta 2 未安装、未测试。