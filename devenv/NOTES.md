# PROTOTYPE #11 事实与坑清单（草稿，随构建实时记录）

> 纵切一「环境与后端」。本文件是 #11 决议评论的原始素材；最终沉淀以 issue 决议为准。
> 分支：`prototype/foundation-slice-1`（throwaway，不合入 dev）。

## 环境事实（2026-11-19 实测）

- 宿主：WSL2 Ubuntu，docker engine 6.1.4 + compose 2.40.3（Ubuntu 官方包，非 Docker Desktop）；**docker buildx 不可用**（`docker: unknown command`）→ digest 解析不能走 `buildx imagetools inspect`，改用「拉取后 `docker image inspect --format '{{index .RepoDigests 0}}'`」，同样是权威 manifest-list digest。
- Docker Hub 拉取速度慢（node:26.13.1-slim ~86MB 用时 ~13min ≈ 110KB/s）；postgis:18-3.6（~800MB）显著更久——**SPEC 的冷启动清单必须计入镜像预热**（devenv build 前置或 doctor 提示）。
- `node:26.13.1-slim` **无 corepack**（`command -v corepack` 为空）——Node 26 镜像确认不捆绑。工具链安装方式：`npm install -g pnpm@12.21.0`（Dockerfile 内锁定版本）。

## 版本事实（npm registry 实查，2026-11-19）

| 包 | latest | 决策 |
|---|---|---|
| typescript | **7.0.2**（原生编译器已 GA） | 仍锁 6.0.3（版本矩阵决策；7 留作提速项） |
| prisma（CLI） | **8.0.0-rc.34**（stable 仍未发） | 显式锁 7.10.1；catalog 里 caret 会撞 RC 的风险已被"精确 pin"规避 |
| @prisma/client / @prisma/adapter-pg | 7.10.1 | 与 CLI 同版本锁 |
| ioredis | **6.0.0**（新 major） | bullmq@6.7.8 peer 为 `ioredis >=5.0.0`，6.0.0 兼容 → 采用 |
| eslint / @eslint/js | **10.15.0 / 10.0.1** | typescript-eslint@8.73.0 peer 接受 `^8.57||^9||^10` → 采用 eslint 10 |
| vitest | **5.1.1** | 采用（NestJS 12 ESM 默认测试器；flat 配置 `include` 稳定） |
| bullmq | 6.7.8 | 采用 |
| @nestjs/* | 12.5.1 / swagger 12.1.2 | peer 均接受 TS ^6 |
| zod | 4.6.7 | 与 #9 决议一致 |

## devenv 设计事实

- 顶层可执行文件不能与 `devenv/` 目录同名 → 脚本落位 `devenv/devenv`，调用形态 `./devenv/devenv <cmd>`。
- compose 端口策略：**全部服务不发布宿主端口**（仅 compose 内网互访）→ 多 agent worktree 并发天然零端口冲突；代价是人类无法在宿主直接 curl API（用 `devenv exec api -- node -e "fetch(...)"` 或后续 slice 加网关）。
- 镜像锁：`devenv/images.lock` 为 shell-sourceable 的 `KEY=repo:tag@sha256:...`（devenv 纯 bash 解析，宿主无 jq；dotenv 格式对 docker compose 变量插值天然友好）。digest 解析用「拉取后 `docker image inspect RepoDigests`」。
- 多 agent 并发锁：`/tmp/natural-enforcement-locks`（机器级 tmpfs，跨 worktree）+ `flock`；独占命令：build / migrate / migrate:create。

## 重大环境发现与架构转向（2026-11-19）

**宿主 "docker" 实为 Rancher Desktop 的 podman machine**：

- `DOCKER_HOST=unix:///mnt/wsl/podman-sockets/podman-machine-default/podman-root.sock`；`~/.local/bin/docker`（29.1.3）是用户级 shim，server 报 6.1.4 = podman 版本；容器带 `io.buildah.version` 标签；本发行版无 /var/lib/containers、无 docker.sock、无 podman CLI、dpkg 无任何 docker 包；sudo 需密码 → 无法原地起真 engine。
- **bind mount 静默挂错**：bind 的宿主绝对路径在 machine（独立 WSL 发行版）文件系统内解析。实测挂 `/home/hulei815/Workspaces/natural-enforcement-prj` 进容器，内容是 machine 里的一份旧同名目录（e2e/frontend/infra）——不是报错，是**静默错误内容**，对 agent 是最危险的一类故障。`_ne_leak_quarantine_*` 目录暗示此前已有相关踩坑。
- **转向：无 bind 架构**。代码经 `docker build` 烘焙进 workspace 镜像（`devenv/workspace.Dockerfile`：manifest 层→`pnpm install --frozen-lockfile`，源码层→`turbo build`；lockfile 首次由 lockgen 阶段生成 + `docker cp` 导出）。命名卷挂 `/workspace/.turbo` 保 turbo 缓存。全部命令仍经 compose（env/网络零重复）。
- 影响面：源码变更后必须 `devenv build`（层缓存命中时秒级）；宿主不出现 node_modules（比 bind 架构更贴合"宿主机只存代码"）；多 worktree 并发时镜像 tag 竞争待 SPEC 决策（当前单 tag `workspace:local` + build 独占锁）。
- 其它被此环境逼出的事实：
  - compose 2.40 默认 Bake 构建，无 buildx 插件时会去拉 `moby/buildkit` 镜像 → devenv 改用 `docker build`（daemon/buildah 内建，可用）。
  - compose 相对 bind 路径按**调用方 CWD** 解析（`-f` 文件目录不可靠）——本架构已整体规避 bind，仅作记录。
  - named volume 首次创建为 root 属主；本架构下容器以宿主 UID 运行、仅写 /workspace/.turbo 与数据卷，未再遇到权限问题（buildah 构建层内为 root，产物在镜像内）。

## 待验证项（进行中）

- [ ] NestJS 12 原生 Standard Schema 校验 API（装包后 grep @nestjs/common d.ts；兜底=自写 ZodValidationPipe，已预置）
- [ ] @nestjs/swagger 12 从 zod 派生 OpenAPI 的实际输出（emit-openapi 脚本）
- [ ] Prisma 7 generator 选项（runtime/moduleFormat/generatedFileExtension 是否被 7.10.1 接受）
- [ ] rustfs 镜像内有无 curl（healthcheck 用）
- [ ] postgis/postgis:18-3.6 拉取完成 + digest 锁定
- [ ] pnpm 12 + catalog: 协议在容器内 install
- [ ] turbo 2.11 任务图 + 跨包 workspace 依赖（api → contracts）
- [ ] EXPLAIN 确认 GiST Index Scan（2000 点 + ANALYZE）
- [ ] BullMQ 6.7.8 + ioredis 6.0.0 实际往返
- [ ] compose run --rm tools 的并发行为（两个 devenv test 同时跑）
