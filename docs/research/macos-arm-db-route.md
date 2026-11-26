# Research：macOS Apple Silicon 数据库 ARM 路线核实（#53 阶段 0 实验①）

- 票：[#53 Task-阶段0核定macOS数据库路线](https://github.com/bbhl79/natural-enforcement-prj/issues/53)（parent [#23 Spec-工程基座](https://github.com/bbhl79/natural-enforcement-prj/issues/23) 阶段 0 实验①）
- 日期：2026-11-24（Registry 结论）；2026-11-26 runbook 对齐当前 `dev` 命令面（#56/#58/#59 落地后，见 §四）
- 方法：Docker Registry HTTP API 实查（本机 WSL2 执行，命令与判定口径见 §2，可复跑）；Podman 上游一手文档（官方 man page / Podman Desktop docs / GitHub release 与 issue）
- 分工边界（诚实口径）：本文档完成**候选路线 registry 核实 + Rosetta 能力调研 + Mac 实验 runbook**。验收标准中"经 devenv 执行迁移、真实空间查询和集成测试"与"实测等待时间"**必须在 Apple Silicon Mac 本机执行**，由指挥者完成；未执行前不声称 macOS 已支持。本文档发布不构成 #53 验收。

---

## 一、结论先行

1. **`postgis/postgis` 全维护标签 amd64-only，无官方 ARM 原生路线**（2026-11-24 扩大范围复核：latest、19-3.7、18-3.6、18-3.7、17-3.5/3.6/3.7、16-3.5/3.6/3.7、15-3.5、15-3.7 共 12 个标签逐一查 manifest，全部仅 `linux/amd64`）。SPEC（2026-11-22 registry 实查，限定 18-3.6 / 17-3.5 / latest）结论成立，且比当时认知更彻底：**连旧版维护标签也没有 arm64**。
2. **候选 ARM 路线三条**（对应 SPEC"amd64 仿真 / 自建 arm64 / 符合供应链要求的第三方"）：
   - **A. amd64 仿真（Rosetta）**：沿用现有锁 `postgis/postgis:18-3.6@sha256:4a43e3c3e5d55b9208240fc71db543b79c638766280c625a425bd0a2390989c4`，镜像锁零改动。Podman ≥5.1.0 在 Apple Silicon 的 machine 默认启用 Rosetta（applehv 虚拟化），上游声称 x86_64 性能"近原生"——**这是声称不是事实，等待时间必须 Mac 实测**。
   - **B. 第三方 multiarch 镜像（`kartoza/postgis`）**：2026-11-24 实查 multiarch[amd64, arm64]，有可精确 pin 的 tag（见 §2）。**未经供应链审查不得采用**（SPEC：第三方按来源/构建过程/更新机制审查）。
   - **C. 自建 arm64 镜像**：以官方 `library/postgres`（multiarch 含 arm64，2026-11-24 实查）为基座装 PostGIS。维护成本最高（跟随 pg/postgis 版本、构建与扫描流水线），仅当 A 实测不可接受时评估。
3. **到期（2 天）仍无 Mac 实验结论时的保守配置**：维持 A 路线（现有镜像锁不动 + Rosetta 仿真），未决项显式记录（SPEC 验收标准第 4 条口径）；不引入未经验证的 B/C。

---

## 二、Registry 实查（2026-11-24，WSL2 本机执行，可复跑）

判定口径：拉 manifest，索引型取 `manifests[].platform`（排除 `unknown/unknown` 的 attestation 条目）；单架构型拉 config blob 读 `.architecture`。token 获取需 `scope=repository:<repo>:pull`；**blob GET 必须跟随 307 重定向（`curl -L`）且官方库 scope 为 `repository:library/postgres`**（写错 scope 会拿 401，看似镜像不存在）。

| 镜像:tag | 架构 | digest（manifest-list） | 证据 |
| --- | --- | --- | --- |
| `postgis/postgis:latest` | amd64 only | `sha256:7e7edf180d29…` | manifest 200，platforms=[amd64] |
| `postgis/postgis:18-3.6` | amd64 only | `sha256:4a43e3c3e5d55b9208240fc71db543b79c638766280c625a425bd0a2390989c4`（与当前 `devenv/images.lock` 锁定值一致） | 同上 |
| `postgis/postgis:18-3.7` / `17-3.5`~`17-3.7` / `16-3.5`~`16-3.7` / `15-3.5` / `15-3.7` / `19-3.7`（与上一行合计 12 个标签） | 全部 amd64 only | （略） | 同上 |
| `postgis/postgis:15-3.4` 及以下旧标签 | amd64 only（单架构 manifest，config blob 确认） | （略） | blob GET `-L` |
| `kartoza/postgis:18.6-3.7.0` | **amd64 + arm64** | `sha256:6b07ffc131b8…` | manifest 200 |
| `kartoza/postgis:18.6-3.6.4` | **amd64 + arm64** | `sha256:5fa6f8e228a7…`（PostGIS 3.6.4 与现锁 3.6 线同代） | manifest 200 |
| `pgrouting/pgrouting:latest` | amd64 only | — | manifest 200 |
| `library/postgres:18` | amd64 + arm64（另含 arm/386/ppc64le/riscv64/s390x） | — | manifest 200 |

复跑命令模板：

```bash
TOKEN=$(curl -sf "https://auth.docker.io/token?service=registry.docker.io&scope=repository:<repo>:pull" | jq -r .token)
curl -s -D /tmp/h -o /tmp/m -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json" \
  "https://registry-1.docker.io/v2/<repo>/manifests/<tag>"
grep -i docker-content-digest /tmp/h          # manifest-list digest
jq -r '[.manifests[].platform | select(.architecture!="unknown") | .architecture] | unique | join(",")' /tmp/m
```

注意事项：`kartoza/postgis` 的日期后缀 tag（如 `18.6-3.7.0--v2026.11.15`）出现在 tags/list 但 manifest 404（上游清理或列表滞后），**pin 选不带日期后缀的精确版本 tag**；`latest` 为可变标签，只用于观察不用于锁。

---

## 三、Rosetta / Podman machine 能力事实（上游一手来源）

| 事实 | 来源 |
| --- | --- |
| macOS Apple Silicon 上 Podman machine 用原生 Apple hypervisor `applehv`，**新装 machine 默认启用 Rosetta**；关闭则回退 qemu（慢） | [Podman Desktop: Native Apple Rosetta translation layer](https://podman-desktop.io/docs/podman/rosetta) |
| Rosetta 支持自 **Podman 5.1.0** 起进入 machine（5.1.0 引入 `CONTAINERS_MACHINE_ROSETTA` 环境变量与 containers.conf 配置） | [podman#22918（5.1.0 行为变更说明）](https://github.com/containers/podman/issues/22918)、[opendatahub-io notebooks macos-podman-rosetta.md](https://github.com/opendatahub-io/notebooks/blob/main/docs/macos-podman-rosetta.md) |
| 核实开关：`podman machine inspect` 输出含 `"Rosetta": true`；配置文件 `~/.config/containers/containers.conf` 的 `[machine] rosetta` 缺省即默认启用 | [podman-machine-inspect(1)](https://docs.podman.io/en/stable/markdown/podman-machine-inspect.1.html)、Podman Desktop 上文（Verification 节） |
| 前提：macOS Silicon + 已安装 Rosetta 2（`softwareupdate --install-rosetta`）；VM 内 binfmt 挂载点核实 `podman machine ssh -- cat /proc/sys/fs/binfmt_misc/rosetta` | [oneuptime: Podman Machine with Apple Rosetta](https://oneuptime.com/blog/post/2026-03-16-podman-machine-apple-rosetta/view) |
| 已知坑：qemu 用户态仿真与 Rosetta 差异大，amd64 容器报 `exec format error` 多半是 machine 未带 Rosetta 重建；机器配置目录路径含 `applehv` 可佐证虚拟化提供方 | [oneuptime: Podman Machine on Apple Silicon](https://oneuptime.com/blog/post/2026-03-16-podman-machine-apple-silicon/view) |
| 备选仿真：FEX-Emu machine（仅 libkrun provider，2026-04 讨论态），不作主线 | [podman discussion #28549](https://github.com/containers/podman/discussions/28549) |

---

## 四、Mac 实验 runbook（指挥者在 Apple Silicon Mac 执行）

> 执行环境：**当前 `dev`（或本 PR 变基后的分支）**。实验从当前 `dev` 建 worktree，一工作单元一 worktree；实验期间不改 `devenv/`、`devenv/images.lock` 或业务代码（路线切换只经 `DEVENV_DB_IMAGE` 环境变量覆盖）。
> per-worktree 隔离（#59 已落地）：compose 项目名为 `natural-enforcement-<8hex>`（容器/卷/网络按 worktree 独立）；数据库用户/库名仍为 `ne` / `natural_enforcement_dev`；数据库口令是**每 worktree 随机值**，由 devenv 自动生成并持久化在 `.devenv-state/db-credentials.env`（0600，gitignored，per-worktree 私有），经 compose 同源注入 db 与 api/tools——文档与证据里都不要记录口令，也不要在宿主 shell 展开 `"$POSTGRES_USER"` 或 `"$DB_PASSWORD"`。
> 证据格式（对齐 #53 验收标准）：每条留**命令 + 退出码 + JSON 输出**；建议证据文件（JSON 原样）存入仓库 `docs/research/macos-arm-evidence/`，随实验 PR 入库，issue 评论只贴摘要与指针。
> 计时：取 devenv JSONL 事件时间戳；同机同 worktree **连测 5 次取中位数并记录最差**（SPEC 测量通用协议）。

**步骤 A — 虚拟化/Rosetta 能力核实（验收标准 1）**

```bash
uname -m                                   # 期望 arm64
podman version                             # 记录 client/server 版本（需 ≥5.1，最好 6.x）
podman machine inspect --format '{{json .}}' | jq .   # 记录 Rosetta / CPUs / Memory / 配置目录（applehv）
arch -x86_64 /usr/bin/true && echo ROSETTA_OK         # 宿主 Rosetta 2 可用
podman machine ssh -- cat /proc/sys/fs/binfmt_misc/rosetta   # VM 内 Rosetta binfmt 已注册
```

**步骤 B — 起实验 worktree**

```bash
git worktree add ../ne-macos-exp dev
cd ../ne-macos-exp
```

> 若改用本 PR 变基后的分支（含本 runbook 更新）：`git worktree add ../ne-macos-exp research/macos-arm-db-route`。

**步骤 C — 冷启动（仿真拉 amd64 锁定镜像，验收标准 2 的一部分 + 计时）**

```bash
./devenv/devenv doctor            # 一键体检：端点/引擎/矩阵/锁文件/worktree 身份与凭据状态/镜像/快照/服务（退出码=可开工与否；--json 为 JSONL+终值）
docker version --format '{{json .Server}}'   # 补记引擎原始字段（doctor 已报告身份/版本/架构，二者互证）
docker info --format 'arch={{.Architecture}} os={{.OSType}}'   # 补记运行架构（arm64 宿主 + amd64 容器仿真）
./devenv/devenv prefetch          # 冷启动第 1 步：预取 NODE_IMAGE + DB_IMAGE（分阶段、有超时、可中断续跑；计时起点）
./devenv/devenv build             # 冷启动第 2 步：固定快照构建 tools + workspace（JSONL 计时）
./devenv/devenv up                # 冷启动第 3 步：db → 迁移幂等应用 → api，等待真实健康终态（无需先单独 migrate）
```

> `doctor` 已报告端点、引擎身份/版本/架构、矩阵校验、锁文件、worktree 身份与凭据状态、镜像、快照状态与服务健康；上面的 `docker version/info` 仅作原始字段存档。
> 全局旗标保持 `./devenv/devenv [--json] <子命令>`（`--json` 在子命令之前）。
> 路线 B/C 的镜像切换只经 `DEVENV_DB_IMAGE=repo:tag[@sha256:<64hex>]` 覆盖（doctor/status/images 会报告生效值与来源），**不改 `devenv/images.lock`**：
>
> ```bash
> DEVENV_DB_IMAGE=kartoza/postgis:18.6-3.6.4@sha256:<64hex> ./devenv/devenv --json up
> ```

**步骤 D — 迁移 / 种子 / 集成测试（验收标准 2 核心）**

```bash
./devenv/devenv migrate           # 可选复核：up 已幂等应用迁移；单独跑 migrate deploy，退出码 0
./devenv/devenv seed              # 幂等种子（广州市区 5 个执法点）
./devenv/devenv --json test       # 全局旗标须在前；集成含 geo 用例（ST_DWithin 半径查询 + EXPLAIN 索引证据），退出码 0
./devenv/devenv exec db -- psql -U ne -d natural_enforcement_dev \
  -c 'EXPLAIN (ANALYZE) SELECT id FROM "EnforcementPoint" \
      WHERE ST_DWithin(location, ST_MakePoint(113.2644,23.1291)::geography, 2000) \
      ORDER BY location <-> ST_MakePoint(113.2644,23.1291)::geography LIMIT 5;'
# 期望：Index Scan using "EnforcementPoint_location_idx"（GiST），非 Seq Scan
```

> 注：库名/用户名取自当前 `devenv/compose.yaml`（`ne` / `natural_enforcement_dev`），per-worktree 隔离不改变它们（变的是 compose 项目名与随机口令）；表与索引经迁移用引号建出（`"EnforcementPoint"` / `"EnforcementPoint_location_idx"`），psql 里**必须带引号**，小写会报 relation does not exist。`devenv exec` 的环境变量在容器内，宿主 shell 不要写 `"$POSTGRES_USER"` 或 `"$DB_PASSWORD"`（会被宿主展开为空串）。示例坐标取广州市中心（市政府一带，与集成测试 CENTER 一致）。

**步骤 E — 等待时间测量（验收标准 3；每行 5 次中位 + 最差）**

| 行 | 起点 | 终点 |
| --- | --- | --- |
| 首次冷启动 | prefetch/build 调用 | up 就绪 |
| 同机二次冷启动 | 同上（层缓存命中） | 同上 |
| 增量重建 | 改一个源码文件后调消费命令 | 服务更新 + 就绪检查通过 |

**步骤 F — 决策记录（验收标准 1 的"选择及理由"）**

- A 路线等待时间在可接受区间（指挥者按 §五 表核定）→ 选 A，镜像锁零改动，#53 收尾。
- A 实测不可接受 → 对 B（kartoza）做供应链审查（来源/构建过程/更新机制），审查通过再实测同协议（切换只经 `DEVENV_DB_IMAGE=kartoza/postgis:<精确 tag>@sha256:<64hex>` 覆盖，**不改 `devenv/images.lock`**；生效值与来源经 `devenv images`/`doctor` 复核）；C 仅作 B 否决后的备选。
- 超预算：实测报告 → 指挥者裁决"改进"或"显式接受"（SPEC 路径），实施者不预领自动验收。

---

## 五、Mac 等待预算核定表（模板，实测后由指挥者填核定值）

| 操作 | Windows 参考 | Mac 实测（中位 / 最差） | 指挥者核定 |
| --- | --- | --- | --- |
| 增量重建（含就绪检查） | ≤ 60s |  |  |
| 新增包闭环 | ≤ 10min |  |  |
| 首次冷启动（构建+启动） | ≤ 15min |  |  |
| 同机二次冷启动 | ≤ 10min |  |  |
| 集成测试（devenv test） | — |  |  |

（SPEC 口径：Mac 各行不沿用 Windows 数字，待阶段 0 实测后指挥者核定。）

---

## 六、#53 验收标准对照

| 验收标准 | 状态（截至 2026-11-24） |
| --- | --- |
| 1. 2 天内核实 Podman machine 虚拟化/Rosetta 能力，记录候选 ARM 路线、选择及理由 | **部分完成**：候选路线已 registry 实查（§1/§2），Rosetta 能力与核实命令已调研（§3）；**Mac 本机核实 + 路线选择待执行**（§4 步骤 A/F） |
| 2. 经 devenv 执行迁移、真实空间查询和集成测试，保存命令/退出码/JSON/运行环境 | **待 Mac 执行**（§4 步骤 B–D），证据格式已约定 |
| 3. 实测开发等待时间，指挥者核定 Mac 预算 | **待 Mac 执行**（§4 步骤 E + §五） |
| 4. 到期无结论 → 保守配置 + 记录未决项 | 预案已定（§一.3），不希望被用到 |
