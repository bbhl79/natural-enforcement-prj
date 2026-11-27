# 依赖与镜像供应链门禁

本文件是 #63 落地的供应链规则与操作手册（Spec-工程基座 §2/§8）。命令面入口与退出码见
`devenv/COMMANDS.md`；这里回答「门禁查什么、为什么、失败后怎么做」。

## 1. 唯一事实源

| 事实 | 权威位置 | 说明 |
|---|---|---|
| 第三方版本 | `pnpm-workspace.yaml` 的 `catalog` | 只允许精确版本；manifest 通过 `catalog:` 引用 |
| 依赖解析结果 | `pnpm-lock.yaml` | 普通构建 `--frozen-lockfile`；变更须经 `devenv build --lockgen` 生成并审查 diff |
| 冷区/审批/技能策略 | `pnpm-workspace.yaml` 的 `minimumReleaseAge*` / `allowBuilds` / `permissions` | pnpm 12 只认这里的 camelCase 键，`.npmrc` 无效 |
| 上游镜像 | `devenv/images.lock` | 完整 tag + digest；多架构锁 manifest-list，单架构锁平台摘要 |
| 包内 agent skills | pnpm `permissions` + 容器内 `pnpm permissions list` | 默认不采纳；待审批即构建失败 |

任何一条都可以用 `devenv supply-chain`（宿主静态核对）与
`devenv supply-chain --container`（容器内权限核对）复验。

## 2. 门禁矩阵

| 检查 | 何时执行 | 失败表现 | 修复入口 |
|---|---|---|---|
| catalog 非空、值精确 | `supply-chain`、`doctor`、`build` 预检 | exit 3（doctor）/ 4（supply-chain/build），逐条 `supply_chain.error` | 改 `pnpm-workspace.yaml` catalog；再 `build --lockgen` |
| allowBuilds 版本化键 | 同上 | 同上 | 改成 `pkg@1.2.3: true/false`；升级后重新审批 |
| `minimumReleaseAge` 正整数 + strict | 同上 | 同上 | 恢复 `1440` / `true`；例外走第 3 节流程 |
| manifest 依赖 `catalog:` 化 | 同上 | 同上 | catalog 中已有该包却写死版本 → 改 `catalog:`；未收录 → 先入 catalog |
| lockfile 漂移（catalog/importer/版本） | 同上 | 同上 | `devenv build --lockgen` 后逐行审查 `pnpm-lock.yaml` diff，确认非预期变化再提交 |
| 镜像锁 digest/kind/platform | `supply-chain`、`doctor`、`images`、`build` 预检 | 同上 | 改 `devenv/images.lock`；按第 5 节解析 digest |
| 构建脚本/agent skills 待审批 | workspace 镜像 deps 层、`supply-chain --container` | 镜像构建失败 / exit 4 | 审查后 `pnpm approve` 或 `permissions.*`；提交配置变更 |
| 运行态镜像 digest 漂移 | `devenv images --verify` | exit 1，`db`/`node` 结果非 ok | 重建/重拉；核对 `images.lock` 与实际运行镜像 |

`devenv build --lockgen` 与首次引导（无 lockfile）会跳过静态门禁：它的职责正是
生成待审查的锁文件，不能用旧门禁拦住生成过程。生成后必须审查 diff 并让普通构建
再次过门禁。

静态漂移检查的范围是「声明 ↔ 锁文件」：catalog、直接依赖集合与解析版本。**传递依赖的
版本/integrity 增删不由此门禁判定**，它们在 `pnpm-lock.yaml` 的 PR diff 中审查；
普通构建的 `--frozen-lockfile` 保证运行期不会临时重解析。

## 3. 新包冷却期（pnpm 12.21 实测语义）

- 单位是**分钟**：`minimumReleaseAge: 1440` = 1 天。本仓库定值 1440。
- 显式配置 `minimumReleaseAge` 时 `minimumReleaseAgeStrict` 默认 `true`；本仓库
  显式写出，避免默认值变化。违反时 pnpm 以
  `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` 失败并要求审查，不会静默写入例外。
- `minimumReleaseAgeIgnoreMissingTime` 必须保持 `false`：缺发布时间的包不得静默跳过。
- `minimumReleaseAgeExclude` 只接受**精确** `pkg@version`；裸包名或版本范围会被
  本仓库静态门禁拒绝。
- `--trust-lockfile` 会跳过策略检查——只在离线复现/审计场景使用，不得进入
  构建脚本或 CI。`devenv` 不传递该旗标。

### 紧急安全更新流程

1. 在 PR 描述中写明 CVE/公告链接、受影响版本、为何不能等待冷却期。
2. 只把**该精确版本**加入 `minimumReleaseAgeExclude`（例如
   `"pkg@1.2.4"`），禁止通配、禁止关闭 `minimumReleaseAgeStrict`、
   禁止打开 `minimumReleaseAgeIgnoreMissingTime`。
3. 同 PR 更新 `pnpm-lock.yaml`（`devenv build --lockgen`）并让
   `devenv supply-chain` / `devenv build` 通过；PR 需人工 review。
4. 例外条目带期限（PR 中写明移除日期，最长不超过冷却期结束）。冷却期过后删除
   `minimumReleaseAgeExclude` 条目，恢复默认策略。

## 4. 构建脚本审批（allowBuilds）

- 键必须带版本：`pkg@1.2.3` 或 `@scope/pkg@1.2.3`。裸包名会让升级静默继承批准，
  静态门禁直接拒绝。
- 值只能是 `true`（允许执行）或 `false`（显式拒绝）。升级版本即新的审批点：
  必须重新审查 postinstall 行为。
- 当前显式拒绝：`@scarf/scarf@1.4.0`（prisma 遥测上报器）。
- `onlyBuiltDependencies` / `ignoredBuiltDependencies` 在 pnpm 12.21 不生效，
  不要使用。

## 5. 镜像锁与 digest 类型

`devenv/images.lock` 的每一条都是 `repo:tag@sha256:<64hex>`：

- **多架构镜像**（`NODE_IMAGE`、`DB_IMAGE_MACOS`）：锁 manifest-list digest，
  `*_KIND=manifest-list`。该 digest 跨架构成立。
- **单架构镜像**（官方 `postgis/postgis`）：锁该平台 digest，
  `*_KIND=single-arch` + `*_PLATFORM=linux/amd64`。
- **macOS Apple Silicon 路线**（#53 路线 B）：引擎架构为 arm64 时自动采用
  `DB_IMAGE_MACOS=kartoza/postgis:18.6-3.6.4@sha256:5fa6...`（manifest-list）；
  其余平台用 `DB_IMAGE`。`DEVENV_DB_IMAGE` 显式覆盖始终优先。
- 解析方法：`docker pull <ref>` 后
  `docker image inspect --format '{{json .RepoDigests}}' <ref>`；多架构镜像要确认
  digest 对应 manifest-list，而不是某一平台子 manifest。单架构镜像若 registry 仍以
  OCI index 发布（含 attestation），必须锁 index 中对应平台的 manifest digest
  （官方 postgis 的 linux/amd64 为 `sha256:530b81…`；index 自身是 `4a43e3c3…`），
  否则「单架构锁平台摘要」名不副实。静态门禁不联网，登记时需人工核对。
- `devenv images --verify` 把运行中 db 容器的 `RepoDigests` 与生效锁值比对，
  并核对 tools 镜像 label `devenv.node.image` 与 `NODE_IMAGE`。结果
  `ok / drift / not-running / no-digest-in-ref / not-built` 中任一非 ok → exit 1。

### Windows / WSL2 反例演练

Windows（WSL2 + Podman）应使用官方 `DB_IMAGE`（amd64）。在 Windows 主机上执行并
归档以下反例，证明门禁不是只在 macOS 成立：

1. **镜像漂移**：临时把 `images.lock` 的 `DB_IMAGE` digest 改成错误值 →
   `devenv images --verify` 必须 exit 1 且报告 `drift`；恢复后 ok。
2. **未批准构建脚本**：在 `allowBuilds` 中删掉一个实际存在的构建脚本条目（或新增
   一个未批准的包）→ `devenv supply-chain` / `devenv build` 必须在引擎构建前
   exit 4；恢复后通过。
3. **未批准 agent skills**：引入/保留一个带 skills 的依赖且不写
   `permissions.<pkg>.skills` → `devenv supply-chain --container`（或镜像 deps 层）
   必须列出 `Awaiting approval:` 并失败；显式批准/拒绝后通过。

证据写入 `.artifacts/63-supply-chain/windows-<case>/`（命令、stdout/stderr、退出码），
并在 Issue/PR 评论中贴关键输出与 commit SHA。**当前开发环境为 macOS，Windows
反例无法在本机伪造或声称已通过**；必须在真实 Windows/WSL2 主机执行后归档。

## 6. 包内 agent skills

- 默认策略：**不自动采纳**。pnpm 12.21 只把显式批准的依赖技能链接到
  `.claude/skills`；未处理时 `pnpm permissions list` 会显示 `Awaiting approval:`。
- 任何待审批项都会让 workspace 镜像 deps 层与 `devenv supply-chain --container`
  失败（fail-closed），从而阻止「依赖悄悄向 agent 注入指令」。
- 已审查决定：`@reduxjs/toolkit@2.15.0` 携带 13 个 Redux 指南技能；本项目只消费
  RTK Query 基础语义，不引入依赖注入的 agent 指令，故在
  `pnpm-workspace.yaml` 写入 `permissions."@reduxjs/toolkit".skills: false`。
- 批准/拒绝方式：交互式 `pnpm approve`，或直接在 `permissions` 中写
  `skills: true/false`（拒绝时 `pnpm approve "!pkg" --yes` 会写入 `skills: false`）。
  变更后重新 `devenv build`，确认 deps 层门禁通过。

## 7. 常见失败与修复

| 现象 | 原因 | 修复 |
|---|---|---|
| `缺 pnpm-workspace.yaml` | 在错误目录运行，或沙箱未镜像仓库根 | 在仓库根执行；测试沙箱需带 catalog/lockfile 输入 |
| `lockfile catalog 缺声明条目` | 改了 catalog 未重新 lockgen | `devenv build --lockgen`，审查 diff |
| `锁文件出现 manifest 未声明的直接依赖` | lockfile 被手工编辑或依赖已删 | 恢复 lockfile，或确认后重新 lockgen |
| `Awaiting approval` | 新依赖带构建脚本/skills | 审查内容后显式批准或拒绝 |
| `images --verify` 报 `not-running` | db 未启动 | `devenv up` 后重试 |
| `images --verify` 报 `not-built` | tools/workspace 镜像未构建 | `devenv build` 后重试 |
| `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` | 版本太新 | 等待冷却期；安全更新走第 3 节例外流程 |
