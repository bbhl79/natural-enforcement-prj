# Research：deps 层缓存失效归因与复用方案验证（#54 阶段 0 实验②）

- 票：[#54 Task-阶段0验证依赖缓存复用方案](https://github.com/bbhl79/natural-enforcement-prj/issues/54)（parent [#23 Spec-工程基座](https://github.com/bbhl79/natural-enforcement-prj/issues/23) 阶段 0 实验②）
- 日期：2026-11-24/25
- 方法：对照实验。基线 = 原型 `prototype/foundation-slice-2` 的 deps 层（无 store 复用）；候选 = pnpm 内容寻址 store + registry 元数据走引擎原生 cache mount。所有下载量证据来自 **pnpm 12.21.0 `--reporter=ndjson` 结构化事件**（非日志文本），原始事件流 gzip 留档于 [deps-cache-evidence/](deps-cache-evidence/)。
- 执行环境：Windows 开发机（WSL2 Ubuntu，kernel 6.18.58.1，x86_64）+ Podman Engine 6.1.4 machine（Fedora 44，Rancher Desktop WSL 集成，经 `podman-root.sock`）+ docker CLI 29.1.3。实验在 `prototype/foundation-slice-2` 之上的 throwaway 分支进行（见 §七），未改动 dev 的任何生产文件。

---

## 一、结论先行

1. **归因（验收 1）**：新增包使 deps 层失效，**不是**"无 bind 架构"的直接后果，而是 **store 随镜像层落盘、层缓存失效即被丢弃** 的后果。deps 层是 `COPY 各 package.json + pnpm-lock.yaml` → `RUN pnpm install --frozen-lockfile`；新增包改变 package.json 与 lockfile → 该 RUN 层缓存必然失效 → install 重跑。原型把 pnpm store 放在该层内部，层一失效 store 随之丢弃，于是 **新增 1 个包也全量重下 600 个包（158.8 MiB）**。实测：基线新增包后重建 **803 s、下载 600 包 / 158.8 MiB**（A4），与首次冷启动（A1：768 s、600 包 / 158.8 MiB）等量——"新增包后的缓存失效"与"首次冷启动下载"在基线上是同一量级，对照成立。
2. **候选方案（验收 2）**：把 pnpm store 与 registry 元数据挂到引擎原生 cache mount（`RUN --mount=type=cache`，`sharing=locked`），store 跨构建、跨 worktree 复用。实测：同样新增 1 个包后重建，**包内容下载 = 0**（pnpm ndjson 中 `pnpm:fetching-progress` 事件 0 条），store 清单哈希不变，产出的 `node_modules` 内容树与"干净下载"基线**逐文件一致**；新增包 + 1 个新外部依赖（left-pad）时**只下载 left-pad 1 个包**。（按本实验最严档"零下载且无 lifecycle 脚本"，因 prisma preinstall 每次执行，claim 账本 4 条记 false——实质零下载成立，最严档未达成，见 §四对账、§六.3。）
3. **闭环（验收 3）**：新增包闭环（`gen package` → lint → typecheck → test:unit）从同一源码基线 + 约定缓存出发连测 5 次，**中位数 111 s、最差 122 s**，远低于 10 min 预算；5 次 lint 阶段 deps 安装均零包下载（结构化 ndjson），不触发"无法验收"。
4. **超预算判定（验收 5）**：闭环耗时若超 10 min 预算，按 SPEC 提交实测报告由指挥者裁决，本报告不预领"自动通过"。
5. **附带发现（影响 SPEC/实施，非本票验收项）**：
   - 原型 lockgen 未 COPY 现有 lockfile，导致每次 lockgen 全量重解析（caret 漂移风险 + 慢）。本实验为隔离变量让其基于现有 lockfile 增量解析；**首引导（无 lockfile）场景仍需实施期处理**。
   - pnpm 12.21 的 **store 是缓存不是信任根**：对被篡改的 store 文件静默导入（实测 P2），`pnpm store status` 也不报（实测 P5）。需要"干净重建"时换 cache id（`--build-arg PNPM_STORE_CACHE_ID=<新 id>`，实测 P4 换 id 即空 store）。
   - `prisma` 的 `preinstall` 脚本在**每次** install（含热 store）都执行（实测约 43 ms，纯 Node 版本检查，无网络）；side-effects 缓存不覆盖 preinstall。离线构建（`--network=none`）实测成功，证明该脚本不依赖网络。

---

## 二、实验设计

### 对照与变量

| | 基线（A） | 候选（B） |
|---|---|---|
| deps 层 install | `pnpm install --frozen-lockfile`（store 在层内） | 同左，但 `--store-dir=/pnpm/store` 且该目录是 cache mount |
| store 位置 | 镜像层（随层缓存失效丢弃） | 引擎 cache mount（跨构建持久） |
| lockgen | `pnpm install --lockfile-only`（无 lockfile，全量解析） | 同左 + COPY 现有 lockfile + 元数据 cache mount + `--prefer-offline` |
| 镜像/compose 名 | 共享标签 | 实验隔离标签（`ne-exp54/*`），不碰共享资源 |

**控制变量**：同一源码基线（`prototype/foundation-slice-2` + 实验装置）、同一 lockfile、同一引擎。基线与候选的"新增包"用**同一个包名**（`exp-base-one`），使工作区符号链接一致、产物树可逐文件比对。

**测量协议**（SPEC §测量通用协议）：计时取命令墙钟毫秒；下载量取 pnpm ndjson 结构化事件；每次记录平台 / 缓存状态 / 实际网络（只报告不控制）。

### 证据口径（防"静默通过"）

下载证据不是"日志里没报错"，而是结构化判定（`summarize-pnpm.mjs`，16 项单测）：

- `pnpm:fetching-progress(status=started)` 按 `packageId` 去重计数 = 实际发起网络下载的包数；**0 = 零包内容下载**。
- 判定分六档：`no-evidence / failed / incomplete / downloaded / zero-fetch-scripts-ran / zero-download`。**只有**流完整、无错误、零下载、且无 lifecycle 脚本执行才是 `zero-download`；失败安装与被截断的流同样 `fetchedPackages=0`，绝不能算零下载。
- 闭环下载证据另由 **离线构建**（`RUN --network=none` + `pnpm install --offline`）行为性佐证：断网能建成 ⇒ 所需包内容全在本地。

---

## 三、归因实验（基线 A）

| 运行 | 操作 | 墙钟 | pnpm 下载包数 | 下载量 | 说明 |
|---|---|---|---|---|---|
| A1 | 首次冷启动（`--no-cache`，deps 靶） | 768 s | **600** | 158.8 MiB | 全量下载 |
| A2 | 同输入重建（无 `--no-cache`） | 12 s | —（install 未执行） | 0 | **层缓存命中**，9 个 `Using cache` |
| A3 | `gen package exp-base-one` + lockgen | 350 s | 0（lockfile-only） | 0 | 但 lockgen 全量重解析耗时 331 s（ndjson 证据：`a3-baseline-gen.log` 的 lockgen EVIDENCE 行，`fetchedPackages=0`、`executionMs=331061`） |
| A4 | 新增包后重建 deps 层 | **803 s** | **600** | **158.8 MiB** | **层失效 → 全量重下** |

**归因结论**：A4 与 A1 等量（600 包 / 158.8 MiB），证明新增包的代价 = 一次完整冷下载。失效链条：新增包 → `packages/exp-base-one/package.json` 新增 + `pnpm-lock.yaml` 变更 → deps 层 COPY 与 RUN 缓存失效 → install 重跑 → **store 在层内随之丢弃** → 全量重下。A2 证明：只要输入不变，层缓存命中、install 不执行（12 s）——问题专属于"输入变化"，与"无 bind"无因果。

---

## 四、候选方案验证（B）

候选 deps 层（完整 diff 见 §七）：

```dockerfile
ARG PNPM_STORE_CACHE_ID=ne-pnpm-store-v11
RUN --mount=type=cache,id=${PNPM_STORE_CACHE_ID},target=/pnpm/store,sharing=locked \
    bash -o pipefail -c 'pnpm install --frozen-lockfile --store-dir=/pnpm/store \
      --reporter=ndjson 2>&1 | tee /tmp/pnpm-install.ndjson | node /opt/exp/summarize-pnpm.mjs deps'
```

| 运行 | 操作 | 墙钟 | 包下载 | 关键证据 |
|---|---|---|---|---|
| B1 | 首次冷启动（空 store） | 348 s | 600 / 158.8 MiB | store 填充至 44460 文件 / 742920 KB |
| B2 | 同输入重建 | 8 s | —（层命中） | install 未执行 |
| B3 | `gen package exp-base-one` | 128 s | 0 | gen+lockgen 合计 128 s（基线 A3 为 350 s） |
| **B4** | **新增包后重建** | **51 s** | **0** | **store 哈希不变；产物树与基线逐文件一致** |
| B6-ext | 新增包 + left-pad@1.3.0 | 46 s | **1（仅 left-pad）** | `fetchedIds=["left-pad@1.3.0"]` |
| B7 | 离线构建（`--network=none` + `--offline`） | 52 s | 0 | **断网建成** ⇒ 包内容全在本地 |
| B8 | 两并发构建共享 store | 88 s / 88 s | 0 / 0 | pnpm 自报区间不重叠（`sharing=locked` 串行），均成功 |

**下载行为核验（验收 2 核心）**：

- B4 的 pnpm ndjson 中 `pnpm:fetching-progress` 事件 **0 条**（`fetchedPackages=0`），`resolved=600` 全部命中 store。
- store 清单哈希在 B1→B4 全程不变（`01e4c815…`），证明未变更依赖**包内容**命中本地存储、零网络下载。
- **确定性**：B4 产物 `node_modules`（52116 文件）与基线"干净下载"的 A4 产物**内容/权限/符号链接逐文件一致**（`determinism-add1.json: identical=true`）——热 store 不改变产物。B1（空 store + cache mount）产物同样与基线冷启动一致，证明 cache mount 机制本身不改变产物。（命名说明：`determinism-add1.json` 里候选侧标签为 `b6-candidate-add1`，因为它在 B6 确定性步骤计算；其镜像 `ne-exp54/deps:add1` 就是 B4 新增的镜像，`b6-cold-*` 同理对应 B1。）
- 元数据缓存：B3 后元数据缓存 233 文件 / 186 MiB（190,480 KB）；`gen`+lockgen 合计从基线 A3 的 350 s 降到 B3 的 128 s（COPY 现有 lockfile 增量解析 + `--prefer-offline` 复用已缓存元数据）。

**claim 账本的对账（诚实口径，防"静默通过"）**：本实验的软断言账本 `candidate/claims.jsonl` 有 **4 条记录为 false**——`b4-add-zero-download`、`b4-add-no-lifecycle-scripts-ran`、`b7-offline-install-zero-fetch-no-scripts`、`b8-concurrent-builds-zero-download`。它们失败在**最严档**（§二的六档判定里只有 `zero-download` = 零下载且无 lifecycle 脚本才算通过）：`prisma` 的 `preinstall` 脚本在每次 install（含热 store）都执行，使这些运行被判为 `zero-fetch-scripts-ran` 而非 `zero-download`。**其实质（未变更依赖包内容零网络下载）成立**：`fetchedPackages=0`、store 哈希不变、离线构建成功、产物树一致——但按本实验自己定的最严档，"零下载且无脚本"**未达成**，验收 2 的达成是**在"允许 prisma preinstall 这类无网络 lifecycle 脚本"的口径下**成立（§六.3）。账本原文未删改，4 条 false 与 11 条 true 一并留档。

---

## 五、新增包闭环 5 次测量（验收 3）

> 起点 `devenv gen package exp-loop-N`，终点 lint → typecheck → test:unit 全部 exit 0。每次从同一源码基线（`git reset --hard`）+ 约定缓存状态出发；各次闭环前后记录 cache_state，store 清单哈希不变证明**不累积**。质量门口径：原型尚无 `verify`，按 SPEC 交付定义的质量门 = lint + typecheck + test:unit（`verify` 落地后由 #58/#61 统一）。

| 闭环 | gen | lint | typecheck | test:unit | **总耗时** | lint 时 deps 安装下载 |
|---|---|---|---|---|---|---|
| 1 | 23 s | 52 s | 12 s | 11 s | **99 s** | 0 包（zero-fetch） |
| 2 | 41 s | 54 s | 13 s | 12 s | **122 s** | 0 包 |
| 3 | 23 s | 62 s | 12 s | 11 s | **111 s** | 0 包 |
| 4 | 36 s | 52 s | 12 s | 11 s | **113 s** | 0 包 |
| 5 | 24 s | 60 s | 13 s | 12 s | **110 s** | 0 包 |

（总耗时为墙钟 = 末个门终点 − gen 起点，含命令间间隙，故略大于各步之和。）

**中位数 111 s，最差 122 s**（SPEC 测量协议：5 次取中位数并记录最差）。**远低于 10 min（600 s）预算**——新增包闭环的耗时大头是质量门本身（lint/typecheck/test:unit 的容器启动与执行），依赖层重建因 store 命中几乎不占时间。

**下载证据（验收 3 的"无法取得可靠下载证据时判为无法验收"不触发）**：5 次闭环的 lint 阶段（新增包后首个重建 deps 层的门）pnpm ndjson 均为 `zero-fetch-scripts-ran`、`fetchedPackages=0`——未变更依赖包内容全部命中本地 store，零网络下载；各次闭环前后 store 清单哈希不变（闭环 `claims.jsonl` 14 条全 true，含 `loopN-store-unchanged-by-loop` 与 `loopN-lockfile-only-new-importer`；各次 `cache-loopN-before/after.json` 清单已留档）。

**样本有效性说明（诚实口径）**：loop4 首次测量时宿主休眠，产生 72 min 死时间（wall-clock 4392 s，但构建实际秒级）——判为无效样本；直接重测又因其 deps 层已被首次构建缓存（lint 命中层缓存、install 不执行），违反"同一约定缓存状态、不累积"。最终用**全新包名**（`exp-loop-4r`）重测，deps 层真正新建、install 运行且零下载，为上表 loop4。休眠原始证据保留于 `loop4-total.suspend-artifact.json`。

---

## 六、风险、限制与对 SPEC/实施的输入

1. **store 不是信任根**：pnpm 12.21 对被篡改的 store 文件**静默导入**（实测 P2：篡改后二次安装退出 0、内容与篡改一致、零重下），`pnpm store status` 也不报（P5）。**注意**：lockfile integrity + `--frozen-lockfile` 只约束解析层（装哪些版本），**防不住** store 内文件被篡改——P2 已证明被篡改内容会被静默导入。**缓解（不声称完整性保证）**：store 仅作**本地性能缓存**，信任等级等同本机用户（能写 store 的人本来就能改本机代码）；**CI 与发布构建不复用来源不明的 store**——用新 cache id 干净构建（P4 实测换 id 即空 store）。本条作为**供应链门禁票**的输入。
2. **lockgen 首引导**：本实验为隔离变量让 lockgen 基于现有 lockfile 增量解析；**无 lockfile 的首次引导**仍需全量解析（实施期处理，不在本票）。
3. **prisma preinstall**：每次 install 都执行（热 store 也是，约 43 ms），side-effects 缓存不覆盖；实测无网络（离线构建成功），但实施期若引入更多带 lifecycle 脚本的依赖，需重新评估"零下载"判定（本实验的 `zero-fetch-scripts-ran` 档即为此设）。
4. **冷启动仍是全量下载**：候选不减少首次冷启动的下载量（B1 仍 600 包），只消除"新增包/输入变化"的重复下载。冷启动下载段按 SPEC 无硬预算（有进度/超时/可续跑）。
5. **网络条件混杂**：基线 A1 与候选 B1 的冷启动墙钟不可直接比（实测有效带宽分别约 316 / 719 KB/s）。公平比较是 **A4 vs B4**（同一"新增包"操作）：下载包数 600 vs 0、墙钟 803 s vs 51 s——下载包数是受控变量，墙钟差主要由下载量解释。
6. **引擎差异**：cache mount 行为在 Podman/buildah（本机）与 Docker Engine + BuildKit（CI）间可能不同；`sharing=locked` 语义、cache id 隔离需 CI 侧复验（SPEC 已要求 CI 独立验收）。
7. **bash 3.2 兼容**：devenv 的数组展开已用 `${a[@]+"${a[@]}"}` 可移植写法（macOS 自带 bash 3.2 在 `set -u` 下展开空数组报 unbound，实测 bash:3.2 容器验证）。
8. **测量协议偏差（如实申报）**：① 父 SPEC §测量通用协议要求"计时取 devenv JSONL 事件时间戳"，本实验闭环总耗时取**运行器墙钟**（`loop_total` = 末个门终点 − gen 起点）；devenv JSONL 事件已带毫秒时间戳（本实验所加）且与各步墙钟一致，但严格说计时源是运行器而非 devenv 事件。② 父 SPEC 要求"每次记录平台/缓存状态/实际网络"，本实验**平台与缓存状态按阶段记录**（`env-*.txt` + 各次 `cache-loopN-*.json`），**网络状况按阶段记录**（`env-*.txt` 的 tarball 测速）+ 从 ndjson 抓取窗口推算有效带宽，**未做到每次闭环单独记录网络**——5 次闭环在同一时段连续执行，网络条件视为相同，但严格按协议这是一处缺口。
9. **额外实验与 SPEC 候选验证要求的对应**：B8 并发（`sharing=locked` 串行）、P2/P5 store 篡改、P4 换 id 干净重建、确定性树比对，对应父 SPEC §3"候选须验**可追溯/干净重建/并发/缓存失效**"的要求，非任意加戏；但它们确实占用了 2 天窗口的一部分，如实说明。

---

## 七、复现

实验装置（throwaway 分支，未合入 dev）：归档标签 **`archive/deps-cache-exp-54`**（指向 `78f4666`，基于 `prototype/foundation-slice-2`；源分支 `research/deps-cache-exp`）。关键文件：

- `devenv/exp/summarize-pnpm.mjs` + `verdict.test.mjs`：ndjson → 六档判定（16 项单测，容器内 `node --test`）。
- `devenv/exp/lib.sh` + `lib.selftest.sh`（91 项自检含反例）+ `lint-local.awk`：计时/取证/缓存状态/产物树哈希/闭环汇总。
- `devenv/exp/run-baseline.sh` / `run-candidate.sh` / `run-closed-loop.sh`：三阶段运行器（步骤可恢复，判断用 `claim()` 软断言记录）。

原始证据（pnpm ndjson gzip、各阶段 evidence/cache/determinism/concurrency JSON、环境记录）见 [deps-cache-evidence/](deps-cache-evidence/)。

---

## 八、验收标准对照

| #54 验收标准 | 状态 | 证据 |
|---|---|---|
| 1. 对照实验区分首次冷启动下载与新增包后缓存失效，记录平台/缓存/网络 | **达成** | §三 A1 vs A4（等量 600 包）；§二环境记录；§六.5 网络混杂声明 |
| 2. 候选以包管理器结构化输出/下载统计证明未变更依赖命中本地存储、零网络下载 | **达成（口径见备注）** | §四 B4（0 下载事件 + store 哈希不变 + 产物树一致）；B6-ext（仅 left-pad）；B7 离线建成。**备注**：实质（包内容零下载）由结构化 ndjson 证明；但按本实验最严档"零下载且无 lifecycle 脚本"，因 prisma preinstall 每次执行，claim 账本 4 条记 false（§四对账、§六.3）——达成是在"允许无网络 lifecycle 脚本"口径下成立 |
| 3. 新增包闭环同基线同缓存测 5 次，报中位数与最差；证据不可靠判无法验收 | **达成** | §五：中位 111 s / 最差 122 s；5 次 lint 均零下载（ndjson），证据可靠 |
| 4. 到期无结论 → 保留 frozen 构建 + 记录预算缺口 | 不适用（已有结论） | — |
| 5. 超预算 → 实测报告由指挥者裁决，不自动通过 | **未超预算** | §五：中位 111 s ≤ 600 s，无需裁决 |
