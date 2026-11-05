# Verification 测试数据框架

本目录是即将落地的 Verification Skill 的**测试数据框架**。

**内容由人后续在 Cursor 中填写。** 本轮只建目录、约定、空模板与本说明，不编造业务字段内容。

## 谁填什么

| 路径 | 谁填 | 填什么 |
| ---- | ---- | ---- |
| `identities/` | 人 | 角色身份夹具（经办／内勤／负责人等）；口令只写引用，不写明文 |
| `journeys/*/` | 人 | 各 P0 旅程的最小合法字段包与期望结果 |
| `negatives/*/` | 人 | 负例场景的输入与期望阻断／失败表现 |
| `samples/` | 人 | 查重用「历史关联」样本元数据 |
| `../features/` | 人 | Feature Map（本轮空壳） |
| `.run/verify-*` | 跑次自动／执行者 | 跑次证据、截图、日志；**不进 git** |

## 与 e2e/testdata、.run/verify-* 的分工

| 位置 | 用途 | 是否进 git |
| ---- | ---- | ---- |
| `.cursor/skills/verify-natural-enforcement/fixtures/` | Verification Skill 固化夹具与模板；与产品 e2e 隔离 | **进仓固化**（模板与约定；真实口令除外） |
| `e2e/testdata/` | 现有产品 e2e 测试数据 | 进仓（既有约定）；**本框架不与之混放** |
| `.run/verify-*` | 单次验证跑次的证据产物（日志、截图、报告） | **不进 git**（根 `.gitignore` 已忽略 `.run/`） |

原则：夹具进仓固化；跑次证据进 `.run` 且 gitignore。

## 身份夹具字段约定（`identities/`）

每个身份可用一份 JSON 描述。字段约定：

| 字段 | 说明 |
| ---- | ---- |
| `id` | 夹具稳定标识（如 `handler-01`） |
| `role` | 角色标签（经办／内勤／负责人等；具体枚举后人填） |
| `displayName` | 显示名占位 |
| `mobile` | 手机号占位（测试号段或虚构号，禁止个人真实号码） |
| `passwordRef` | 口令引用，**禁止**写入生产／个人真实口令明文 |

`passwordRef` 推荐形态（二选一或并用说明）：

- 环境变量名：`"passwordRef": { "env": "VERIFY_PASSWORD_HANDLER_01" }`
- 本地 secrets 文件路径（该文件本身不进 git）：`"passwordRef": { "secretsFile": ".run/verify-secrets.local.json", "key": "handler-01" }`

见 `identities/schema.md` 与 `identities/identity.example.json`。

## 每条 journey 目录的文件形态

每个 `journeys/<name>/` 至少准备：

| 文件 | 用途 |
| ---- | ---- |
| `input.json.example` | 旅程输入字段包模板；复制为 `input.json` 后由人填写 |
| `expected-outcomes.md.example` | 期望结果说明模板；复制为 `expected-outcomes.md` 后由人填写 |
| `README.md`（可选） | 该旅程备注、前置条件、依赖身份 |

负例目录 `negatives/<name>/` 采用相同形态。

复制用法示例：

```bash
cp input.json.example input.json
cp expected-outcomes.md.example expected-outcomes.md
```

`*.example` 进 git。填好的 `input.json`／`expected-outcomes.md` 是否进 git 由人在填内容时决定；含敏感信息则留本地或放 secrets，勿提交明文口令。

## 命名与隔离约定

- 夹具数据前缀建议：`vf-`（verify fixtures），用于业务侧可识别的测试主体／线索标题等占位，避免与真人业务混淆。
- 验证跑次使用**独立库／独立环境**，不污染开发库。
- 本框架路径固定在 `.cursor/skills/verify-natural-enforcement/fixtures/`，不写入 `e2e/testdata/`。

## samples（查重历史关联）

`samples/` 存放查重用「历史关联」样本的占位与元数据模板。真实样本内容由人后续填写。

## 明确声明

- 本轮交付仅为脚手架：目录、约定、空模板、README。
- **旅程业务字段、负例具体断言、身份真实测试账号、Playwright 脚本、完整 SKILL 正文均不在本轮范围。**
- 后人填写时不得把生产／个人真实口令写入仓库。
