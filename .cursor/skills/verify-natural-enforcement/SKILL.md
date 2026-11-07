# verify-natural-enforcement

给 Agent 的**眼睛和手**：自己跑环境、自己打 API（本轮）、自己取证、自己对照夹具判对错。
不是又一套给人看的传统测试；`e2e/` 与 integration 仍服务 CI，本 Skill 与之隔离。

## 信任路径

本地 Verification 可信 → 云端扩展 → 最终 auto-merge。
修好产品后，**同一套语料再跑必须变绿**；假绿禁止。

## 构件分工

| 构件 | 路径 | 作用 |
| ---- | ---- | ---- |
| 本 Skill | `SKILL.md` + `harness/` | 如何启动、取证、自判 |
| Feature Map | `features/` | UI 导航说明书（UI 环另票） |
| Case Profiles | `fixtures/case-profiles/` | 稳定业务判据；01/02 含 `hardFields` |
| Scenarios | `fixtures/scenarios/{runnable,latent}/` | 可跑 / 未实现阶段剧本 |
| Negatives | `fixtures/negatives/` | API 负例（与 scenario 同形） |
| Identities | `fixtures/identities/` | 种子角色登录引用 |
| 跑次证据 | `.run/verify-*` | 单次跑失败包；**不进 git** |
| 案卷原文缓存 | `.run/verify-case-seeds/` | lark-cli 中间稿；**不进 git** |

## 使用顺序（Agent）— API 环

1. **先跑 harness**（容器内，勿宿主机装依赖）：
   `./dev test integration`
   关注 `integration/verify-skill-loop.test.ts`（happy + punch 负例）。
2. 红则读 `.run/verify-<runId>/`（容器工作目录下；summary / steps / evidence）。
3. 修产品或夹具后，**同一 scenario 再跑**；未变绿不得宣称完成。
4. 负例绿 = 产品正确拒绝（如缺 `clue.narrative` → 400），不是业务写入成功。

结构化 oracle 与证据契约见 `fixtures/RUN-CONTRACT.md`。
Scenario 形状见 `fixtures/scenarios/schema.md`。

## 失败闭环（演示纪律）

故意改坏 `oracle.assert` 或产品字段名 → harness 出红包 → 改回 → 同 scenario 再跑必须变绿。
不要求自动化混沌；Agent 手改即可。

## 当前范围

- 已落地：身份夹具；01/02 hardFields；API negatives；`harness/` + integration 入口；跑次契约。
- UI 环（最小子集）：`harness/ui/run-ui-p0.sh` + `vf-sc-verify-loop-ui-login-register`（登录→登记壳字段；默认 headless）。
- 下一待办按钮：`harness/run-next-todo-buttons.sh`，场景 `vf-sc-next-todo-buttons`。按录入机构或已有承办机构的并集核对分派按钮。页面只 headless，不点写。
- 全链「录入→核查→分派」UI 与 Feature Map 深探另票；本环不引入 CI Playwright 依赖。
- 开发环境自动核查：`harness/run-auto-verification.sh`。空地址仍走查不成。假图层 overlay 在 `harness/layers/`，说现有适配器的查询协议。四条 scenario：`vf-sc-auto-verify-land-success`、`partial`、`duplicate`、`empty-failed`。页面取证只 headless，证据在 `.run/verify-*`。验证结束会卸 overlay。
- 未实现产品阶段只标 `latent`，不得标成 runnable。
