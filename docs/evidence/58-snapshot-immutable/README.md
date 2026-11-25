# #58 证据：构建快照与运行镜像一致（固定输入快照 + 不可变绑定）

- 票：[#58 Task-保证构建快照与运行镜像一致](https://github.com/bbhl79/natural-enforcement-prj/issues/58)（parent [#23 Spec-工程基座](https://github.com/bbhl79/natural-enforcement-prj/issues/23)）
- 日期：2026-11-25
- 平台（Spec 支持环境矩阵·Windows 开发机行）：WSL2 Ubuntu（kernel 6.18.58.1，x86_64）+ docker CLI 29.1.3 + compose v2.40.3 + Podman Engine 6.1.4 machine（Fedora 44，Rancher Desktop WSL 集成，经 podman-root.sock）
- 口径：工程操作全部经 `./devenv/devenv` 唯一入口；结构化输出为 `--json` 实跑捕获；缓存状态=热（pnpm store cache mount `ne-pnpm-store-v11` 经 #54 实验与本机构建预热；turbo-cache 卷热）；网络只报告不控制——首次构建后各次构建均为纯源码变更（install 层缓存命中，零包下载，见 `08`）。

## 验收标准对照

| # | 验收标准 | 证据 | 结论 |
|---|---|---|---|
| 1 | 固定快照覆盖未提交修改、新增、删除及 Dockerfile/构建脚本/锁文件等构建输入；采集后不再读取活工作树 | 采集=git 临时索引 `add -A`+`write-tree`（内容寻址树哈希，gitignored 不进快照）；构建上下文=快照物化目录（含 `NODE_IMAGE`，取自快照内 images.lock）；离线测试 S1–S5/S9/S16b（`12`）；修改/新增/删除实跑（`03` 计时集 + `04` 内容断言）；构建期改工作树不泄漏（`04`） | ✅ |
| 2 | 采集/构建期间工作树再变 → 完整旧快照或明确拒绝，不产生混合内容却报告来源一致 | 持续高速修改 → 3 次双采集均不一致 → exit 4 明确拒绝（`05`，含退出码留档），停止后重试成功（`06`）；构建期间修改 → 镜像=采集前完整快照（`04`）；低速修改下被接受的快照与镜像内容逐字节一致（`13`） | ✅ |
| 3 | 启动不可变绑定本次构建产物；受控覆盖同 tag 后原构建仍按自己的不可变标识启动 | `07`：tag 覆盖到 tools 镜像后，up 经 `workspace.fresh` 跳建，运行容器 `.Image` == 绑定 ID；每次 up 含 `image.verified` 启动核对（`02`、`03` 各 run） | ✅ |
| 4 | 采用 #54 缓存结论，普通构建保持 frozen install，保留来源一致性而非完整构建证明的诚实口径 | `08`：deps 层 `--no-cache` 诊断重建，`pnpm install --frozen-lockfile --store-dir=/pnpm/store`（cache mount `sharing=locked`），`resolved 544, reused 544, downloaded 0`；诚实口径写入 COMMANDS.md「固定输入快照与不可变绑定」节 | ✅ |
| 5 | Windows 完成修改/新增/删除/竞态/tag 覆盖反例；增量重建连测 5 次（终点=服务更新+就绪），报告中位数及最差值 | 反例见上；5 次计时见下表（中位 29.0s / 最差 29.6s，预算中位 ≤60s），逐 run 墙钟/容器/镜像/核对全留档（`03-timing.txt` + `03-run*.jsonl`） | ✅ |

## 增量重建 5 次计时（终点 = api 容器重建 + 健康 + `image.verified`）

| 次 | 操作 | 墙钟 | api 容器 | 绑定镜像（截断） |
|---|---|---|---|---|
| 1 | 修改（probe r1） | 29524ms | d089dbf3→2350750a | 7ad38ae0 |
| 2 | 修改（probe r2） | 29026ms | 2350750a→6e80e2b1 | 9acbe5c4 |
| 3 | 新增 probe2 | 29648ms | 6e80e2b1→c3109634 | d37c37a7 |
| 4 | 删除 probe2 | 21636ms | c3109634→7f677907 | 9acbe5c4（== run2） |
| 5 | 修改（probe r5） | 29012ms | 7f677907→18c6e5f1 | 6ea7088b |

**中位数 29026ms（29.0s），最差 29648ms（29.6s）**——预算（中位 ≤60s）内。
逐 run 原始记录（墙钟/退出码/容器变迁/绑定镜像/健康/启动核对）见 `03-timing.txt`，
事件流见 `03-run1..5.jsonl`。计时为宿主墙钟（`date +%s%3N` 夹取命令前后）。

内容断言（`04-content-assertions.txt`，对当次构建镜像 `docker run --rm` 实查）：
run3 镜像含 `snapshot-probe2.txt`；run4 镜像不含；run5 镜像 probe 为 r5。

**内容寻址确定性附带实证**：run4（删除 probe2）快照与 run2 相同，重建产出
**同一镜像 ID**（9acbe5c4…）——同快照必同产物。

## 机制要点（实现口径）

- **采集**：git 临时索引 `add -A` + `write-tree`（不碰用户索引；对象落 ODB 为不可达
  松散对象，随 gc 回收）；双采集一致才接受，重试 3 次后明确拒绝（exit 4）。
- **物化**：`git archive <tree>` 展开到临时目录 + mtime 归一固定纪元（跨构建缓存
  稳定）；构建上下文=物化目录，采集后不再读活工作树（含 `NODE_IMAGE` 取自快照内
  images.lock）。
- **新鲜度**：快照哈希 ↔ 镜像 `devenv.snapshot.hash` label ↔ 状态文件一致才跳建；
  `devenv.snapshot.inputs` 构建输入清单随镜像记录（审计用，不参与比对）。
- **绑定**：image ID 取自 `docker build -q` 输出（免 tag 二次解析竞态；podman 兼容层
  输出无前缀 64hex，lib 归一为 `sha256:` 前缀——首跑实测发现并已修）；compose 注入
  image ID；up/web 启动后核对运行容器 `.Image`（restart 只重启既有容器，无新绑定）。
- **lockgen 双靶**：有 lockfile 走 `lockgen`（增量解析 + 元数据 cache mount +
  `--prefer-offline`），无 lockfile 首引导走 `lockgen-fresh`（全量解析）——#54 §六.2
  实施期处理落地。

## 证据清单

| 文件 | 内容 |
|---|---|
| `01-build.jsonl/.stderr.txt` | 首次快照构建（热缓存；snapshot.captured → workspace.built） |
| `02-up.jsonl/.stderr.txt` | 新鲜度跳建（workspace.fresh）+ 首次 image.verified 启动核对 |
| `03-timing.txt` + `03-run1..5.jsonl` | 增量重建 5 次计时（修改/新增/删除/修改；墙钟/容器/镜像/核对逐 run 留档） |
| `04-build-during-mutation.jsonl` + `04-content-assertions.txt` | 构建期间改工作树：镜像=采集前快照；计时集内容断言 |
| `05-race-refusal.jsonl/.stderr/.exitcode` | 持续高速修改 → 3 次双采集不一致 → exit 4 明确拒绝 |
| `06-race-retry.jsonl` | 停止修改后重试成功 |
| `07-tag-override.txt` | 受控覆盖同 tag → up 跳建，运行容器仍为绑定镜像 |
| `08-deps-nocache.log` | deps 层 --no-cache 诊断重建：frozen install + store 命中 downloaded 0（#54 采纳证据；一次性诊断构建，非 devenv 命令） |
| `09-verify.log` | lint + typecheck + test:unit 全绿 |
| `10-test.log` | 集成测试 31 用例全过（contracts 10 + api 10 + web 11） |
| `11-test-auth.log` | GitHub App 认证入口离线测试 71 通过 |
| `12-test-devenv.log` | 命令面离线测试 27 + 快照/绑定离线测试 35 全过 |
| `13-snapshot-consistency.txt` | 被接受快照 ↔ 镜像内容逐字节一致（sha256 对账） |

## 诚实备注

- 双采集是**稳定性检查**而非原子快照：两次采集读到完全一致字节才接受（此时快照
  必为某个真实完整状态）；采集间隔（~20ms）内的写入若恰好避开则按「完整旧快照」
  接受——符合验收 2 的允许路径，且 `13` 证明被接受快照与镜像内容一致。
- 新鲜度跳建省去的是 docker build 调用；快照采集本身（~16ms 级 git 操作 + 双跑）
  每次消费命令都执行。
- docs/ 等被 git 跟踪的目录变更会改变快照哈希并触发重建（层缓存命中时秒级）——
  这是「构建输入全覆盖」口径的必然行为，证据跑期间实测观察到（写证据文件触发
  重建），如实记录。
- die 硬错误路径（采集拒绝、启动核对失败、锁冲突）以 stderr ERROR + 退出码收尾，
  不发终值 JSON 事件（与既有锁冲突路径同口径，COMMANDS.md 输出协议节已注明）。
- 测试运行期（test/lint 等无锁命令）与 build 并发的租约协调归 #61；per-worktree
  隔离归 #59。本票内 up/web/build 均持 stack 排他锁。
