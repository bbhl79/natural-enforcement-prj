# e2e/verify：业务验证资产

本目录是 e2e 层的业务验证资产：夹具、驱动、导航说明。
资产原在 `.cursor/skills/verify-natural-enforcement/`，2026-11-10 迁入本目录。
迁入目的：验证由 e2e 层负责，资产沉淀为稳定测试用例。
稳定用例的入口是 `e2e/cases/*.sh`，由 `./dev test e2e` 逐条执行。
本目录不放可执行用例，只放用例消费的资产与驱动。

## 信任路径

本地验证可信 → 云端扩展 → 最终 auto-merge。
产品修好后，同一套语料再跑必须变绿。
禁止假绿。

## 构件分工

| 构件 | 路径 | 作用 |
| ---- | ---- | ---- |
| 驱动 | `harness/` | 启动、取证、按 oracle 自判 |
| Feature Map | `features/` | UI 导航说明书 |
| Case Profiles | `fixtures/case-profiles/` | 稳定业务判据；01/02 含 `hardFields` |
| Scenarios | `fixtures/scenarios/{runnable,latent}/` | 可跑剧本与未实现阶段剧本 |
| Negatives | `fixtures/negatives/` | API 负例（与 scenario 同形） |
| Identities | `fixtures/identities/` | 种子角色登录引用 |
| 跑次证据 | `e2e/results/verify-*` | 单次跑失败包；不进 git |
| 发现器报告 | `e2e/results/discover/<runId>/` | 发现器唯一写口；不进 git |

运行产物只有一个根：`e2e/results/`（已 gitignore）。
根的定义在 `harness/paths.ts` 的 `RESULTS_DIR`。
`./dev --run-id <id>` 的日志与产物落 `e2e/results/<id>/`。

## 执行面

| 执行面 | 入口 | 覆盖 |
| ---- | ---- | ---- |
| integration 层 | `./dev test integration` 的 `integration/verify-*.test.ts` | 驱动自身逻辑；API 环在克隆库上跑 |
| e2e 层 | `./dev test e2e` 的 `e2e/cases/*.sh` | 整栈上的稳定用例 |
| 人工与诊断 | `harness/` 下的独立脚本 | 身份准备核对、本机诊断夹具、图层 overlay |

## 使用顺序（API 环）

1. 在容器内运行 `./dev test integration`。
   禁止在宿主机安装依赖。
   关注 `integration/verify-skill-loop.test.ts`（happy 与 punch 负例）。
2. 结果为红时，读 `e2e/results/verify-<runId>/` 下的 summary、steps、evidence。
3. 修好产品或夹具后，同一 scenario 再跑。
   未变绿时不得宣称完成。
4. 负例绿表示产品正确拒绝（例如缺 `clue.narrative` 返回 400）。
   负例绿不表示业务写入成功。

结构化 oracle 与证据契约见 `fixtures/RUN-CONTRACT.md`。
Scenario 形状见 `fixtures/scenarios/schema.md`。

## 认证与传输门禁

登录响应不是 200 时，跑次记 `blocked` 并退出。
正文含 `login.source-limited`、`source-limited` 或「来源受限」时，原因是 `source-limited`。
其余认证失败的原因是 `auth-rejected`。
传输地址不可达时，同样记 `blocked`。
不得把 `blocked` 改记成业务失败后继续扫下一场景。
不得遍历口令。
不得用 SQL 改口令或清锁定。
不得清 Redis。
不得为清空 SourceGate 内存而重启进程。
不得更换来源地址后继续同一次取证。
`host.docker.internal` 不可达时停止。
不得改用 compose 服务名 `nginx` 继续。
身份准备与验证跑分离。
规则见 `harness/IDENTITY-PREP.md`。
业务跑次只消费一个已声明口令。
登录已成功且产品要求更换口令时，只提交这一次产品更换。
P1 的无回溯上限样本已有驱动。
其余 P1 项、P2、P3 仍是缺口。
清单见 `harness/BACKLOG-STUBS.md`。

## 失败闭环（演示纪律）

故意改坏 `oracle.assert` 或产品字段名 → 驱动出红包 → 改回 → 同 scenario 再跑必须变绿。
不要求自动化混沌。
Agent 手改即可。

## 当前范围

- 已落地：身份夹具；01/02 hardFields；API negatives；`harness/` 与 integration 入口；跑次契约。
- UI 环（最小子集）：`harness/ui/run-ui-p0.sh` 与 `vf-sc-verify-loop-ui-login-register`（登录→登记壳字段；默认 headless）。
- 下一待办按钮：`harness/run-next-todo-buttons.sh`，场景 `vf-sc-next-todo-buttons`。按录入机构或已有承办机构的并集核对分派按钮。页面只 headless，不点写。
- 开发环境自动核查：`harness/run-auto-verification.sh`。空地址仍走查不成。假图层 overlay 在 `harness/layers/`，说现有适配器的查询协议。四条 scenario：`vf-sc-auto-verify-land-success`、`partial`、`duplicate`、`empty-failed`。页面取证只 headless，证据在 `e2e/results/verify-*`。验证结束会卸 overlay。
- 无回溯上限样本：`harness/run-hist-dup-no-lookback.sh`。栈起来之后播种一条 `transferred_out` peer。`disposition.recorded_at` 与 `registered_at` 为 `2019-01-01T00:00:00.000Z`。探测登记重叠面后读 `historicalGroups`。年龄不少于 4 年时 `anyAncientPeerInHist` 与 `noLookbackVerified` 为 true。播种不改写已有时间戳。
- 未实现产品阶段只标 `latent`，不得标成 runnable。
