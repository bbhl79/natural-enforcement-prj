# Verification 夹具（Agent 判据语料）

本目录是 `verify-natural-enforcement` 的**业务判据**，不是传统 e2e 数据仓。
Agent 对照这里的 profile / scenario 自判对错；修好产品后同一语料再跑必须变绿。

## 三层模型

| 层 | 路径 | 稳定性 | 说明 |
| ---- | ---- | ---- | ---- |
| Case Profiles | `case-profiles/` | 高：语义不随产品阶段删改 | 案卷脱敏事实槽（线索→结案） |
| Scenarios | `scenarios/runnable/`、`scenarios/latent/` | 中：可增量启用 | 引用 profile；`latent` 禁止假绿 |
| Identities / journeys 薄封装 | `identities/`、`journeys/`、`negatives/`、`samples/` | 既有 | journeys 逐步改为 scenario 投影；勿另写第二套叙事 |

原始案卷只缓存在 `.run/verify-case-seeds/`（gitignore），**不进 git**。

## 与 e2e、跑次证据

| 位置 | 用途 | 进 git |
| ---- | ---- | ---- |
| 本目录 | Verification 固化判据 | 是（脱敏；口令除外） |
| `e2e/testdata/` | 产品 e2e | 是；**不混放** |
| `.run/verify-*` | 单次跑证据 | 否 |
| `.run/verify-case-seeds/` | 飞书抽取中间稿 | 否 |

## 命名

- 业务可见字符串前缀：`vf-`
- Profile id：`vf-case-NN-<slug>`
- Scenario id：`vf-sc-<stage>-<slug>`
- 几何：广州一带示意坐标（约 113–114°E，23–23.2°N）；测绘类用点，土地/矿产用面

## 身份

见 `identities/`。口令只引用 `VERIFY_PASSWORD_SEED`、`VERIFY_LOGIN_PASSWORD` 或 `.run/verify-secrets.local.json` 的 `seed`。
业务跑次只消费其中一个口令。
换口令、清锁定和来源允许表不在本目录的 scenario 里做。
获准的准备路径见 `../harness/IDENTITY-PREP.md`。

## 跑次证据契约

目录：`.run/verify-<runId>/`

| 文件 | 内容 |
| ---- | ---- |
| `manifest.json` | `runId`、开始/结束时间、环境、scenario 列表 |
| `steps/<scenarioId>/<n>-<step>.json` | 单步：`expected`、`actual`、`pass`、证据相对路径 |
| `evidence/` | 截图、DOM 摘要、响应片段、日志 |
| `summary.json` | 总结果：`passed` / `failed` / `blocked`；失败项指向 step |

失败时 Agent 必须能只凭失败包复现意图，无需人喂截图。

## Case Profile 槽位

每份 profile 的 `stages` 键（缺省用 `absent`）：

`register` · `verify` · `dispatch` · `filing` · `investigate` · `hearing` · `legal_review` · `collective` · `decision` · `serve` · `execute` · `close`

每槽：`status`（`populated`|`thin`|`absent`）+ 脱敏事实 + 可选 `system` 映射（sourceCode、domain、types、spatial、partyNames…）。

Schema 说明见 `case-profiles/schema.md`。

## Scenario

| 字段 | 说明 |
| ---- | ---- |
| `id` / `status` | `runnable` 或 `latent` |
| `profileRefs` | 引用的 case-profile id |
| `identityRefs` | 身份夹具 id |
| `featureMapRefs` | Feature Map 节点 id |
| `steps` | 操作步骤（可引用 profile.system 投影） |
| `oracle` | 结构化 `assert[]`（`path` / `op` / `value`）；见 `RUN-CONTRACT.md` |
| `driver` | API 环用 `api`；负例见 `negatives/` |

模板：`scenarios/scenario.example.json`。API harness：`../harness/`，入口 `integration/verify-skill-loop.test.ts`。
