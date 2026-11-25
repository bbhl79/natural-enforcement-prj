# #58 证据：构建快照与运行镜像一致（固定输入快照 + 不可变绑定）

- 票：[#58 Task-保证构建快照与运行镜像一致](https://github.com/bbhl79/natural-enforcement-prj/issues/58)（parent [#23 Spec-工程基座](https://github.com/bbhl79/natural-enforcement-prj/issues/23)）
- 日期：2026-11-25（评审缺陷修复后复跑）
- 平台（Spec 支持环境矩阵·Windows 开发机行）：WSL2 Ubuntu（kernel 6.18.58.1，x86_64）+ docker CLI 29.1.3 + compose v2.40.3 + Podman Engine 6.1.4 machine（Fedora 44，Rancher Desktop WSL 集成，经 podman-root.sock）
- 口径：工程操作全部经 `./devenv/devenv` 唯一入口；结构化输出为 `--json` 实跑捕获；缓存状态=热（pnpm store cache mount `ne-pnpm-store-v11` 预热；turbo-cache 卷热）；网络只报告不控制——首次构建后各次构建均为纯源码变更（install 层缓存命中，零包下载，见 `10`）。
- 采集一致性机制与成立条件：`docs/adr/2026-11-25-21-19-快照采集一致性机制.md`（stat 括号；残余孔洞 §4 待指挥者确认）。

## 验收标准对照

| # | 验收标准 | 证据 | 结论 |
|---|---|---|---|
| 1 | 固定快照覆盖未提交修改、新增、删除及 Dockerfile/构建脚本/锁文件等构建输入；采集后不再读取活工作树 | 采集=git 临时索引 `add -A`+`write-tree`（gitignored 不进快照）；构建上下文=快照物化目录（含 `NODE_IMAGE` 取自快照内 images.lock）；离线 S1–S5/S9/S16b（`14`）；修改/新增/删除实跑（`03` 计时集 + `04` 内容断言） | ✅ |
| 2 | 采集/构建期间工作树再变 → 完整旧快照或明确拒绝，不产生混合内容却报告来源一致 | **机制**：stat 括号（清单+逐文件 mtime/size/inode 夹住读取窗口），成立条件与残余孔洞见 ADR；**确定性多文件竞态**（离线钩子注入，非撞概率）：交替更新两个关联文件，只接受完整版本 (v2,meta-v2)，两个混合组合（独立树哈希）均未出现；持续写入 → exit 4（S23/S23b，`14`）；真机持续写入拒绝（`05`）+ 停止后重试成功（`06`）；构建期间修改工作树 → 镜像=采集前完整快照（`06b`）；被接受快照 ↔ 镜像内容对账（`15`，口径限定：不替代无混合证明） | ✅（机制+条件见 ADR §5 待确认项） |
| 3 | 启动不可变绑定本次构建产物；受控覆盖同 tag 后原构建仍按自己的不可变标识启动 | workspace tag 覆盖 → up 跳建、容器仍为绑定 ID（`07`）；**绑定链**：固定快照 → tools 不可变 ID → workspace 不可变 ID——tools 输入变更直接 up → tools 重建并绑定新 ID、层前缀核验实际基础镜像匹配（`08`a）；tools:local 被覆盖 → 悬空状态镜像按 ID 命中不重建（`08`b）；每次 up 含 `image.verified`（`02`、`03` 各 run） | ✅ |
| 4 | 采用 #54 缓存结论，普通构建保持 frozen install，保留来源一致性而非完整构建证明的诚实口径 | `10`：deps 层 `--no-cache` 诊断重建，`--frozen-lockfile` + store cache mount，`resolved 544, reused 544, downloaded 0`；诚实口径写入 COMMANDS.md 与 ADR | ✅ |
| 5 | Windows 完成修改/新增/删除/竞态/tag 覆盖反例；增量重建连测 5 次（终点=服务更新+就绪），报告中位数及最差值 | 反例见上；5 次计时：中位 25240ms / 最差 26180ms（预算中位 ≤60s），逐 run 墙钟/容器/镜像/核对留档（`03-timing.txt` + `03-run*.jsonl`） | ✅ |

## 增量重建 5 次计时（终点 = api 容器重建 + 健康 + `image.verified`）

| 次 | 操作 | 墙钟 | api 容器 | 绑定镜像（截断） |
|---|---|---|---|---|
| 1 | 修改（probe r1） | 24886ms | 84af1730→cf9f7967 | f59a6c58 |
| 2 | 修改（probe r2） | 26003ms | cf9f7967→c4a9fea7 | 9a619219 |
| 3 | 新增 probe2 | 25240ms | c4a9fea7→27b5f3db | 7440940f |
| 4 | 删除 probe2 | 17607ms | 27b5f3db→d1fa735a | 9a619219（== run2） |
| 5 | 修改（probe r5） | 26180ms | d1fa735a→060fc5ee | 625b08a5 |

**中位数 25240ms（25.2s），最差 26180ms（26.2s）**——预算（中位 ≤60s）内。
逐 run 原始记录见 `03-timing.txt`，事件流见 `03-run1..5.jsonl`；计时为宿主墙钟
（`date +%s%3N` 夹取命令前后）。内容断言见 `04-content-assertions.txt`。

**内容寻址**：run4（删除 probe2）快照与 run2 相同，产出同一镜像 ID（9a619219）。
注意（实测）：同一快照重复构建**内容**（层+配置+标签）逐字节一致，但镜像 ID 仅在
构建器全缓存命中复用时相同；若构建器重提交（recommit），`created` 时间戳不同 →
ID 不同、内容相同（03a/03b 实测对账）。新鲜度机制不依赖 ID 确定性（不符即重建
并绑定当次 ID），正确性不受影响。

## 评审缺陷修复对照（本目录为修复后复跑证据）

| 评审缺陷 | 根因 | 修复 | 对应测试/证据 |
|---|---|---|---|
| 一、镜像缺失提前退出 | `labeled="$(docker image inspect …)"` 赋值在 `set -e` 下随 inspect 失败整体退出（exit 1），无状态/镜像丢失时不进重建；离线 runsub 用 `set +e` 掩盖了真实入口行为 | 未命中三态（无状态/镜像不存在/label 不符）显式进重建；inspect 失败时引擎探活区分「镜像不存在」与「引擎故障」（后者 die 3 不吞）；runsub 子 shell 改 `set -Eeuo pipefail` 与真实入口一致；另实测发现 podman `image ls` 不列悬空镜像，存在性探针不能用 ls | 离线 S12/S13/S13b/S13c/S19a–d；真机 `09a`（无状态重建）、`09b`（镜像丢失重建） |
| 二、tools 未纳入快照与绑定 | ensure 只重建 workspace，workspace.Dockerfile `FROM tools:local` 可变标签 | 可核对链路：固定快照 → tools 输入哈希（tools.Dockerfile blob + 快照内 NODE_IMAGE）↔ tools 不可变 ID → workspace 不可变 ID；workspace/lockgen 构建经 `--build-arg TOOLS_IMAGE=<ID>` 绑定；`devenv.base.image` label + 层前缀核验 | 离线 S16c/S17b/S20/S21/S22；真机 `08`（tools 输入变更反例、tools tag 覆盖反例、层前缀核验） |
| 三、多文件采集一致性论证不足 | 双采集相同只是稳定性检查，不证明文件曾同时属于一个完整状态；单 probe 证据不足 | stat 括号机制（ADR：成立条件=写入改变 mtime/size/inode 即检出，覆盖原子重命名/原地写/追加/增删；残余孔洞=mtime 保持型覆写与窗口内 ABA，ADR §4 声明、§5 待指挥者确认）；确定性多文件竞态测试（钩子注入，非概率） | ADR `docs/adr/2026-11-25-21-19-快照采集一致性机制.md`；离线 S23/S23b；真机 `05`/`06` |

## 证据清单

| 文件 | 内容 |
|---|---|
| `01-build.jsonl/.stderr.txt` | 新链路首次构建（tools 带 input-hash label；workspace 带 base.image label + build-arg 绑定） |
| `02-up.jsonl/.stderr.txt` | tools.fresh + workspace.fresh 跳建 + image.verified 启动核对 |
| `03-timing.txt` + `03-run1..5.jsonl` | 增量重建 5 次计时（修改/新增/删除/修改） |
| `04-content-assertions.txt` | 计时集镜像内容断言（新增在/删除不在/修改为新值） |
| `05-race-refusal.jsonl/.stderr/.exitcode` | stat 括号：持续写入 → 3 次窗口均检出 → exit 4 明确拒绝 |
| `06-race-retry.jsonl` | 停止写入后重试成功（tools 内容恢复 → tools ID 回到 d6fb6674，内容寻址） |
| `06b-build-during-mutation.jsonl` | 构建期间改工作树：镜像=采集前完整快照（probe-pre-mutation），活树已变 |
| `07-tag-override.txt` | workspace:local 被覆盖 → up 跳建，容器仍为绑定镜像 |
| `08-tools-chain.txt` | tools 输入变更反例 + tools:local 覆盖反例 + 层前缀核验 + 悬空镜像平台坑记录 |
| `09a-no-state.jsonl` / `09b-deleted-image.jsonl` | 项一真机回归：无状态 / 状态镜像丢失 → 重建成功（不再提前退出） |
| `10-deps-nocache.log` | deps 层 --no-cache 诊断重建：frozen install + store 命中 downloaded 0（#54 采纳；一次性诊断构建，非 devenv 命令） |
| `11-verify.log` | lint + typecheck + test:unit 全绿 |
| `12-test.log` | 集成测试 31 用例全过 |
| `13-test-auth.log` | GitHub App 认证入口离线测试 71 通过 |
| `14-test-devenv.log` | 命令面离线 27 + 快照/绑定离线 50（含 S23 确定性多文件竞态）全过 |
| `15-snapshot-consistency.txt` | 快照哈希 ↔ 镜像内容对账（口径限定：不替代无混合证明） |

## 诚实备注

- **真实引擎验证 vs mock 测试区分**：`01`–`10` 为真机（Podman 6.1.4）实跑；离线
  50 项为 mock docker 的函数/入口级测试（`14`），两者互补不互替。
- stat 括号是**条件化保证**：成立条件与残余孔洞（mtime 保持型覆写、窗口内 ABA、
  非本地 fs）见 ADR §3–§5；不声称「任意写者下绝对不混合」。
- 新鲜度跳建省去 docker build 调用；采集本身（清单+stat+git add，~100ms 级）
  每次消费命令都执行。
- docs/ 等被 git 跟踪的目录变更会改变快照哈希并触发重建（层缓存命中时秒级）——
  「构建输入全覆盖」口径的必然行为。
- die 硬错误路径（采集拒绝、启动核对失败、锁冲突、引擎故障）以 stderr ERROR +
  退出码收尾，不发终值 JSON 事件（COMMANDS.md 输出协议节已注明）。
- 测试运行期（test/lint 等无锁命令）与 build 的并发租约协调归 #61；per-worktree
  隔离归 #59。本票内 up/web/build 均持 stack 排他锁。
