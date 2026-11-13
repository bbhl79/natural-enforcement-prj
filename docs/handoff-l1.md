# L1 合法合规判据体系 · 交接文档

> 交接时间：2026-11-13
> 仓库：`bbhl79/natural-enforcement-prj`，分支 `dev`，HEAD `f8e1c5f`
> 状态：核心实现完成，全链验证通过。改动已 `git add`，**未提交**。
> 用途：在 Cursor 中继续本轮工作。

---

## 0. 先读这几份

按顺序读，约 30 分钟。

| 顺序 | 文件 | 看什么 |
|---|---|---|
| 1 | [docs/research/criteria/README.md](../research/criteria/README.md) | 底稿格式、八条断言、解释类型三分 |
| 2 | [docs/research/criteria/decisions.md](../research/criteria/decisions.md) | 四条业务决策，为什么它们不是判据 |
| 3 | [tools/generate-review-criteria.mjs](../../tools/generate-review-criteria.mjs) | 生成器实现，断言编号与错误格式 |
| 4 | [backend/deadline/src/rules.ts](../../backend/deadline/src/rules.ts) | 七条期限规则与 `basis` 编号 |
| 5 | [backend/deadline/test/criteria.test.ts](../../backend/deadline/test/criteria.test.ts) | 反向校验怎么断言 |
| 6 | [tools/structural-test.sh](../../tools/structural-test.sh) 的 `check_criteria-traceability` | 结构规则怎么扫 `basis` |
| 7 | [dev](../../dev) 的 `lint_criteria` | 门禁怎么挂 |

再读 [AGENTS.md](../../AGENTS.md) 与 [docs/agents/main-flow.md](../agents/main-flow.md)，确认本仓库的流程与语言纪律。

---

## 1. 一句话

L1 是一条可机器复算的链：**官方原文 → 判据底稿 → 生成产物 → 代码与测试**。代码里的法规数值与出处，锚定到入库原文；任何一环断开，门禁判红。

---

## 2. 已完成

### 2.1 新增文件

| 路径 | 作用 |
|---|---|
| `docs/research/sources/doc_002.txt` | 自然资源违法行为立案查处工作规程正文 |
| `docs/research/sources/doc_025.txt` | 广东省自然资源行政处罚自由裁量权实施办法 |
| `docs/research/sources/doc_042.txt` | 行政处罚法 |
| `docs/research/sources/doc_061.txt` | 自然资源行政处罚办法 |
| `docs/research/sources/doc_081.txt` | 行政执法机关移送涉嫌犯罪案件的规定 |
| `docs/research/sources/doc_082.txt` | 广州市依法行政条例 |
| `docs/research/criteria/README.md` | 底稿格式与校验口径 |
| `docs/research/criteria/doc_002.md` 等六份 | 判据底稿，共 18 条判据 |
| `docs/research/criteria/decisions.md` | 业务决策登记，共 4 条 |
| `tools/generate-review-criteria.mjs` | 判据生成器，八条断言 |
| `tools/generate-review-criteria.test.mjs` | 生成器负例自测，9 条用例 |
| `backend/deadline/src/criteria.generated.ts` | 期限模块的判据产物 |
| `backend/case/src/criteria.generated.ts` | 案件模块的判据产物 |
| `backend/deadline/test/criteria.test.ts` | 期限规则反向校验，2 条用例 |
| `backend/case/test/criteria.test.ts` | 法制审核清单反向校验，4 条用例 |

### 2.2 修改文件

| 路径 | 改了什么 |
|---|---|
| `backend/deadline/src/rules.ts` | 七条 `basis` 改为 `判据:CRIT-*` 或 `业务决策:DEC-*`；接口注释说明编号格式 |
| `backend/deadline/src/index.ts` | 公共出口再导出 `LEGAL_CRITERIA`、`BUSINESS_DECISIONS` |
| `docs/research/legal-document-table.md` | 追加 `doc_081`、`doc_082`；修正「存疑两行」的过时描述 |
| `backend/geo-dict/src/reference-data/reference-data.generated.ts` | 由既有生成器重新生成，文件表 80 → 82 |
| `integration/case-deadline.test.ts` | 法审期限期望值改从 `findDeadlineRule` 取，去掉手抄数值 |
| `integration/clue-form-schema.test.ts` | 文件表条数 80 → 82 |
| `tools/structural-test.sh` | 新增规则 `criteria-traceability`；`ASSEMBLY_EXEMPT` 放行期限公共出口；探针计数 50 → 51 |
| `tools/structural-probe.sh` | 新增 `write_probe_criteria-traceability` 与 SPECS 条目 |
| `dev` | 新增 `lint criteria` 子命令，全量 lint 五项 → 六项 |
| `backend/README.md` | 规则索引表补 `criteria-traceability` |

### 2.3 验证证据

全部在 2026-11-12 至 2026-11-13 实跑。

| 命令 | 结果 |
|---|---|
| `node tools/generate-review-criteria.mjs --check` | 通过 |
| `node --test tools/generate-review-criteria.test.mjs` | 9/9 通过 |
| `./dev lint criteria` | 通过 |
| `bash tools/structural-test.sh` | 32 条规则全绿 |
| `tools/structural-probe.sh` | 51 条用例、32 条目标规则全通过，退出 0 |
| `./dev test unit` | 通过，含新增 2+4 条用例与类型检查 |
| `./dev test integration` | 69 个文件全部通过 |
| `./dev lint eslint` | 通过 |
| 变异验证：`DEFAULT_HANDLING_DAYS` 90 → 60 | 测试判红 `expected 60 to be 90`；还原后逐字节一致 |

---

## 3. 关键设计决策

### 3.1 原文入库，不依赖外网

公开法规原文放 `docs/research/sources/`，每份带 sha256。第三方只靠仓库即可离线复算。法规文本依《著作权法》第五条不受著作权保护。

### 3.2 锚定代替签署

判据的权威性来自两件事：摘录是原文的连续子串；快照哈希与底稿记录一致。不需要任何人签字。改动原文、摘录或哈希，三者任一不一致即判红。

### 3.3 解释类型三分

| 类型 | 机器要求 | 例子 |
|---|---|---|
| 直译 | 带期望值与 `sourceValues`；取值须是摘录子串 | 九十日、五个工作日、三十日 |
| 推导 | 带 `derivation`；链上判据须在同一底稿 | 第 64 条「五日」+ 第 85 条「五日指工作日」 |
| 裁量 | 不得带期望值；只登记风险 | 法审 5＋10 个工作日 |

### 3.4 裁量登记

查不到公开法规出处的项，进 `decisions.md`，编号 `DEC-*`。代码 `basis` 写 `业务决策:DEC-*`。这些项不产出机器断言，只登记出处、理由、风险。

首批四条：`DEC-001` 法审 5＋10、`DEC-002` 移送告知 3 个工作日、`DEC-003` 必审清单第 5 项罚种、`DEC-004` 涉刑移送触发法审。

### 3.5 反向校验

测试不再手写法规数值。它从 `criteria.generated.ts` 读期望值，与规则登记表比对。代码改了而底稿没改，测试判红。这是 L1 相对原有测试的实质增量。

### 3.6 门禁分层

| 门禁 | 跑在哪 | 抓什么 |
|---|---|---|
| 生成器 `--check` | `dev lint criteria`、CI | 底稿、原文、产物不一致 |
| 结构规则 `criteria-traceability` | `dev lint structural`、CI | `basis` 没编号或编号不在产物 |
| 反向校验测试 | `dev test unit`、CI | 代码数值与判据期望值不一致 |
| 红探针 | `dev lint structural-probe`、CI | 结构规则变成恒绿死规则 |

### 3.7 产物按模块拆分

判据产物按消费模块分成两份，避免跨模块依赖。期限模块的产物放 `backend/deadline/src/`，案件模块的放 `backend/case/src/`。生成器按 `consumers` 自动归组；无消费方的原子判据随引用它的推导项归组。

---

## 4. 首批查出的四处偏差

1. **行政处罚法第 60 条原文只有九十日**，没有延长三十日。延长三十日出自办法第 38 条。两条判据分开锚定：`CRIT-DL-001`（90 日）与 `CRIT-DL-002`（延期上限 30 日）。
2. **行政处罚法第 85 条把「五日」定义为工作日**。听证申请期 5 个工作日是直译，不是裁量。`CRIT-DL-004` 由 `CRIT-DL-004A` 与 `CRIT-DL-004B` 推导得出。
3. **规程 11.1.2（4）写三个工作日，310 号令第九条写「3 日」**。规程是部门规范性文件，低于行政法规，代码取日历日。冲突写在 `CRIT-DL-007` 的注记里。
4. **法审 5＋10 个工作日与移送告知 3 个工作日查不到公开法规出处**。登记为 `DEC-001`、`DEC-002`，不再冒充法规判据。

---

## 5. 当前工作树状态

- 本轮改动共 30 个文件，已 `git add`，**未提交**。
- `docs/onboarding.md` 的计数修订在工作树里，但该文件本身未被 Git 跟踪，未暂存。
- 以下文件在本轮之前就是未跟踪状态，与 L1 无关，未改动：
  - `docs/architecture/`
  - `docs/grilling-answers-supervision-draft.md`
  - `docs/roadmap-next.md`
- 不要求提交格式时不要提交。若提交，先读 `.cursor/rules/git-commit.mdc`。

---

## 6. 尚未完成与已知缺口

### 6.1 W7：正例探针与系统变异（P2）

现状：生成器有 9 条负例自测；结构规则有 51 条红探针；人工做了一次 90 → 60 的变异验证。

缺口：

- 结构规则没有「正例探针」：注入合规源码后断言判绿且理由命中预期条款。
- 业务常量没有系统变异测试：90 日、60%、5 个工作日、90/75/60 阈值等应逐一变异，测试必须杀死变异体。

落点：`tools/structural-probe.sh`、`backend/deadline/test/criteria.test.ts`。

### 6.2 W8：出处校验升级（P1，可独立做）

现状：`e2e/verify/harness/discover/source-check.ts` 只查非空白，不查编号是否在文件表，也不查效力状态。

目标：增「编号 ∈ DOCUMENTS」与「效力状态非已废止」。该文件声明纯函数、无 I/O，建议由调用方传入文件表，保持纯函数。

落点：`e2e/verify/harness/discover/source-check.ts`、`e2e/verify/harness/discover/reconcile.ts`、`integration/verify-discover-source-check.test.ts`。

### 6.3 文件表只追加，v2 通道缺失（P1，阻塞效力状态变更）

`DOCUMENTS` 是只追加参照数据（ADR 0016）。库层触发器拒 UPDATE；`seed.mjs` 按「编码+版本」比对，内容不一致即报错。当前生成器只写 `version = 1`，**没有实现同编码追加 v2 的通道**。

后果：不能就地改已有行的效力状态或效力层级。要标记某份法规「已废止」，必须先补 v2 通道。

落点：`tools/generate-clue-reference-data.mjs`、`backend/prisma/seed.mjs`、`docs/adr/0016-参照数据随种子只追加写入.md`。

### 6.4 `objected` 语义偏严（P2）

现状：反向校验要求 `status === 'active'`，所以判据被提异议改成 `objected` 会让测试判红。这比路线图 2.10 的「停用自动」更严格：它把异议变成阻塞，而不是静默停用。

要改成「停用但不阻塞」，需改 `backend/deadline/test/criteria.test.ts`：遇到 `objected` 跳过数值比对，同时在结构规则或清单里登记待议状态。

### 6.5 文档计数未全同步（P2）

`docs/roadmap-next.md` 仍写 31 条规则、50+4 探针；实际是 32 条规则、51 SPECS + 3 GATE_RED_SPECS。该文件是未跟踪的用户文档，未改。`docs/onboarding.md` 与 `backend/README.md` 已同步。

### 6.6 手工同步点

以下位置没有自动闸，改动时要手动同步：

| 改动 | 要同步的位置 |
|---|---|
| 文件表新增行 | `integration/clue-form-schema.test.ts` 的 `documents` 计数 |
| 新增结构规则 | `docs/onboarding.md` 的规则条数、`backend/README.md` 的规则索引表 |
| 新增红探针 | `docs/onboarding.md` 的探针条数、`tools/structural-test.sh` 文件头的探针计数 |
| 新增 integration 跨模块导入 | `tools/structural-test.sh` 的 `ASSEMBLY_EXEMPT` |

---

## 7. 在 Cursor 中继续：建议顺序

### 第一步：复核现状（P0）

```bash
git diff --cached --stat
node tools/generate-review-criteria.mjs --check
./dev lint criteria
./dev lint structural
./dev test unit
```

不要先跑 `./dev check`：它会经 e2e 销毁数据卷，只在可弃数据的工作区跑。

### 第二步：W8 出处校验升级（P1，独立）

目标：`source-check.ts` 拒绝不在文件表的编号与已废止文件。

验收：

- 纯函数签名增加文件表参数，不引入 I/O。
- 新增用例：编号不在文件表判 `pending-authority`；已废止判 `pending-authority`；合法编号仍 `ok`。
- `./dev test integration` 全绿。

### 第三步：文件表 v2 通道（P1，阻塞效力变更）

目标：同编码追加新版本，已有环境不报错。

验收：

- `legal-document-table.md` 支持同一文件编号多版本行，或新增版本列。
- `generate-clue-reference-data.mjs` 产出当前版本；`--check` 确定。
- `seed.mjs` 按「编码+版本」幂等追加，不 UPDATE。
- 在已有 82 行数据的克隆库上重跑种子不报错。

### 第四步：W7 正例探针与变异（P2）

目标：证明规则「判得对」，不只是「会红」。

验收：

- 至少一条正例探针：注入合规源码，判绿且理由命中预期条款。
- 业务常量变异清单：90 日、30 日、5 个工作日、3 个工作日、60% 等；每个变异必须被测试杀死。

### 第五步：`objected` 语义（P2）

目标：异议停用断言但不阻塞 CI。

验收：

- `objected` 判据跳过数值比对。
- 待议状态有可查记录（测试或清单）。
- 原有 `active` 判据行为不变。

---

## 8. 常用命令

```bash
# 生成判据产物（写盘）
node tools/generate-review-criteria.mjs

# 校验底稿、原文、产物一致（不写盘）
node tools/generate-review-criteria.mjs --check

# 生成器负例自测
node --test tools/generate-review-criteria.test.mjs

# L1 门禁
./dev lint criteria

# 结构闸与红探针
./dev lint structural
./dev lint structural-probe

# 单元测试与类型检查
./dev test unit

# 集成测试（需库；会重建 it_template）
./dev test integration

# 全量静态检查（含 ESLint）
./dev lint

# 全链（会经 e2e 销毁数据卷，只在可弃数据工作区跑）
./dev check
```

---

## 9. 纪律与边界

- 所有安装动作只在工具链容器内做，宿主不跑 `pnpm/npm install`，仓库不留 `node_modules`。
- 不手改 `*.generated.ts`。改底稿，重跑生成器。
- 不用代码值反推判据。判据只能来自原文。
- 不复用判据编号。编号代表规则位置，改含义就换新号。
- 不就地改 `DOCUMENTS` 已有行。见 6.3。
- 不自行拍板业务决策。裁量项进 `decisions.md`，写清出处与风险。
- 不把「中止停算」当漏查去补。它是已知法规空白，已由 #29 拍板，属裁量层。
- 不要求任何外部主体签署。L1 的权威性来自原文与哈希。
- 提交前读 `.cursor/rules/git-commit.mdc`；分支与 worktree 操作前读 `.cursor/rules/branches.mdc`。
- 代码注释遵循 `docs/agents/code-comments.md`。新增文件头必须有「用途：」。
- 注释里引用的仓库路径必须已入库，否则 `comment-path-refs` 判红。