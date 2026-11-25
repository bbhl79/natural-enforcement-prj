# #58 证据：构建快照与运行镜像一致（固定输入快照 + 不可变绑定）

- 票：[#58 Task-保证构建快照与运行镜像一致](https://github.com/bbhl79/natural-enforcement-prj/issues/58)（parent [#23 Spec-工程基座](https://github.com/bbhl79/natural-enforcement-prj/issues/23)）
- 日期：2026-11-25（第二轮复审修复后复跑）
- 平台（Spec 支持环境矩阵·Windows 开发机行）：WSL2 Ubuntu（kernel 6.18.58.1，x86_64）+ docker CLI 29.1.3 + compose v2.40.3 + Podman Engine 6.1.4 machine（Fedora 44，Rancher Desktop WSL 集成，经 podman-root.sock）
- 口径：工程操作全部经 `./devenv/devenv` 唯一入口；结构化输出为 `--json` 实跑捕获；缓存状态=热（pnpm store cache mount 预热；turbo-cache 卷热）；网络只报告不控制——首次构建后各次构建均为纯源码变更（install 层缓存命中，零包下载，见 `10`）。
- 采集一致性机制、三命题区分、成立条件与原理性残余：`docs/adr/2026-11-25-21-19-快照采集一致性机制.md`。

## 验收标准对照

| # | 验收标准 | 证据 | 结论 |
|---|---|---|---|
| 1 | 固定快照覆盖未提交修改、新增、删除及 Dockerfile/构建脚本/锁文件等构建输入；采集后不再读取活工作树 | 采集=git 临时索引 `add -A`+`write-tree`（gitignored 不进快照）；构建上下文=快照物化目录（含 `NODE_IMAGE` 取自快照内 images.lock）；离线 S1–S5/S9/S16b/S24（`14`）；修改/新增/删除实跑（`03`+`04`） | ✅ |
| 2 | 采集/构建期间工作树再变 → 完整旧快照或明确拒绝，不产生混合内容却报告来源一致 | **机制**：stat 括号（端点）+ 内容双读（两遍全量读取 mode+blob 清单比对）+ 清单复核；**A/B 实证**：同一读取交错注入（两个 mtime 恢复型等长覆写），stat-only 变体接受从未存在组合 (G1,F2) 零重试（盲区实证），生产实现检出重试（`16`）；**确定性测试**：S23 交替更新/S24 空格文件名/S25 mtime 恢复型覆写交错/S26 失败传播（`14`）；真机持续写入拒绝（`05`）+ 重试（`06`）+ 构建期修改不泄漏（`06b`）；快照↔镜像内容对账（`15`，仅证命题 1） | ⚠️ **基本闭合，残余待裁决**：对一切「未完美复原」的写入闭合（含 mtime 恢复型覆写）；**完美往返（内容级 ABA）为原理性盲区**（任何只读机制不可检出，捕获内容即盘上内容）——ADR §4，待指挥者确认接受或升级 fs 级机制。**确认前不声称本条完全通过** |
| 3 | 启动不可变绑定本次构建产物；受控覆盖同 tag 后原构建仍按自己的不可变标识启动 | workspace tag 覆盖 → up 跳建、容器仍为绑定 ID（`07`）；绑定链：固定快照 → tools 不可变 ID → workspace 不可变 ID——tools 输入变更直接 up → 重建绑定新 ID + 层前缀核验（`08`a）；tools:local 覆盖 → 悬空镜像按 ID 命中（`08`b）；每次 up 含 `image.verified` | ✅ |
| 4 | 采用 #54 缓存结论，普通构建保持 frozen install，保留来源一致性而非完整构建证明的诚实口径 | `10`：deps 层 `--no-cache` 诊断重建，`--frozen-lockfile` + store cache mount，`resolved 544, reused 544, downloaded 0`；诚实口径写入 COMMANDS.md 与 ADR | ✅ |
| 5 | Windows 完成修改/新增/删除/竞态/tag 覆盖反例；增量重建连测 5 次（终点=服务更新+就绪），报告中位数及最差值 | 反例见上；5 次计时：中位 25875ms / 最差 26556ms（预算中位 ≤60s），逐 run 留档（`03-timing.txt` + `03-run*.jsonl`） | ✅ |

## 增量重建 5 次计时（终点 = api 容器重建 + 健康 + `image.verified`）

| 次 | 操作 | 墙钟 | api 容器 | 绑定镜像（截断） |
|---|---|---|---|---|
| 1 | 修改（probe r1） | 26053ms | d0298d72→eff4c2b2 | 96b2eb1f |
| 2 | 修改（probe r2） | 25652ms | eff4c2b2→1baa1977 | d6bf0e14 |
| 3 | 新增 probe2 | 26556ms | 1baa1977→722d01e1 | e7c4f2eb |
| 4 | 删除 probe2 | 17524ms | 722d01e1→c613f7c0 | d6bf0e14（== run2） |
| 5 | 修改（probe r5） | 25875ms | c613f7c0→0de768c9 | 9ff5e0ac |

**中位数 25875ms（25.9s），最差 26556ms（26.6s）**——预算（中位 ≤60s）内。
逐 run 原始记录见 `03-timing.txt`；内容断言见 `04-content-assertions.txt`。
采集机制（内容双读）使单次采集约 90–100ms（原 stat 括号约 50ms），对总耗时
影响不可见。run4 与 run2 同快照同镜像 ID（内容寻址；重提交时 ID 可因 created
时间戳不同而不同、内容一致——见首轮 README 对账，机制不依赖 ID 确定性）。

## 复审缺陷修复对照（第二轮）

| 复审缺陷 | 根因 | 修复 | 对应测试/证据 |
|---|---|---|---|
| 一、路径拆分与 stat 失败被吞 | 未加引号 `${@/#/$REPO_ROOT/}` 按空格拆分路径/仓库路径；`2>/dev/null`+`|| true` 吞掉 stat 失败；if/命令替换上下文中 set -e 被抑制，失败被掩盖成「两次都漏检查却判定稳定」 | 数组传参保留路径边界（`--literal-pathspecs` 处理通配文件名）；NUL 枚举流不过 bash 变量（命令替换丢 NUL）改临时文件；空集合显式合法；每步失败显式检查（枚举失败 die、读取失败重试后拒绝、stat 瞬态重试/硬错误传播），不依赖 set -e | S24（空格仓库+空格/通配文件名+窗口内修改检出）、S26a–d（枚举/读取/stat 失败传播）、S27（真实入口+空格文件名）；套件 `14` |
| 二、一致性保证的成立条件 | 双采集/stat 括号不证明「曾同时属于一个完整状态」；等长覆写+恢复 mtime（非恶意，如 rsync -a --inplace）不可检出；三命题混用 | 先纠正论证（ADR §1：镜像忠实于快照 / 快照对应真实完整状态 / 业务更新边界——第三者任何文件系统机制不保证）；机制换为 stat 括号+内容双读；A/B 实证旧检测盲区；确定性读取交错测试（批次钩子，非 git add 前后改文件） | ADR 全文；`16`（A/B 对照）；S23/S25（读取交错检出+从未存在组合拒绝）；⚠️ 完美往返 ABA 残余待指挥者裁决（ADR §4） |
| 三、保留已修复部分并回归 | — | 镜像缺失自动重建、引擎故障 die 3、快照→tools→workspace 绑定链、lockgen 重采集重核对全部保留 | S10–S22 回归全绿（`14`）；真机 `07`/`08`/`09a`/`09b` 复跑 |

## 证据清单

| 文件 | 内容 |
|---|---|
| `01-build.jsonl/.stderr.txt` | 链路构建（tools 带 input-hash label；workspace 带 base.image label + build-arg 绑定） |
| `02-up.jsonl/.stderr.txt` | tools.fresh + workspace.fresh 跳建 + image.verified 启动核对 |
| `03-timing.txt` + `03-run1..5.jsonl` | 增量重建 5 次计时（新采集机制复测） |
| `04-content-assertions.txt` | 计时集镜像内容断言 |
| `05-race-refusal.jsonl/.stderr/.exitcode` | 新机制：持续写入 → 3 次窗口均检出 → exit 4 明确拒绝 |
| `06-race-retry.jsonl` | 停止写入后重试成功 |
| `06b-build-during-mutation.jsonl` | 构建期间改工作树：镜像=采集前完整快照 |
| `07-tag-override.txt` | workspace:local 被覆盖 → up 跳建，容器仍为绑定镜像 |
| `08-tools-chain.txt` | tools 输入变更反例 + tools:local 覆盖反例 + 层前缀核验 + 悬空镜像平台坑 |
| `09a-no-state.jsonl` / `09b-deleted-image.jsonl` | 无状态 / 状态镜像丢失 → 重建成功（不提前退出） |
| `10-deps-nocache.log` | deps 层 --no-cache 诊断重建：frozen install + store 命中 downloaded 0（#54 采纳；一次性诊断构建，非 devenv 命令） |
| `11-verify.log` | lint + typecheck + test:unit 全绿 |
| `12-test.log` | 集成测试 31 用例全过 |
| `13-test-auth.log` | GitHub App 认证入口离线测试 71 通过 |
| `14-test-devenv.log` | 命令面离线 27 + 快照/绑定离线 58（含 S23–S27 确定性竞态与失败传播）全过 |
| `15-snapshot-consistency.txt` | 快照哈希 ↔ 镜像内容对账（仅证命题 1：镜像忠实于快照） |
| `16-ab-stat-only-vs-content-double-read.txt` | A/B 对照：同一读取交错注入，stat-only 接受从未存在组合（盲区实证）vs 内容双读检出 |

## 诚实备注

- **真实引擎验证 vs mock 测试区分**：`01`–`10` 为真机（Podman 6.1.4）实跑；离线
  58 项为 mock docker 的函数/入口级测试（`14`），两者互补不互替。
- **验收第二条状态**：对「未完美复原」的写入（含 mtime 恢复型等长覆写）已闭合；
  完美往返（内容级 ABA）为原理性盲区，待指挥者裁决（ADR §4）——**确认前不声称
  完全通过**。
- 三命题不可互替：本目录证据分别对应——命题 1（`15`）、命题 2（`16`+S23–S26+
  `05`/`06`/`06b`）；命题 3（业务更新边界）任何文件系统机制不保证，不在本票范围。
- 采集失败语义：枚举失败 die 4；读取失败重试后拒绝；stat 瞬态重试、硬错误传播；
  全部显式检查返回码（函数在 `$(...)`/`||` 上下文中 set -e 被抑制，不依赖其兜底）。
- docs/ 等被 git 跟踪的目录变更会改变快照哈希并触发重建（层缓存命中时秒级）。
- die 硬错误路径以 stderr ERROR + 退出码收尾，不发终值 JSON 事件（COMMANDS.md
  输出协议节已注明）。
- 测试运行期（test/lint 等无锁命令）与 build 的并发租约协调归 #61；per-worktree
  隔离归 #59。本票内 up/web/build 均持 stack 排他锁。
