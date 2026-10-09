# backend/ 模块边界约定（#47 依赖矩阵人读副本，#51 成文）

唯一事实源 = #47 Implementation Decisions（含 #45 补丁）；机器可执行断言 =
`tools/structural-test.sh`（dev lint 检查 2）。**本文与结构测试规则同步维护**。

## 模块清单（定案命名）

| 目录 | 模块 | 子域归属 |
|---|---|---|
| `packages/shield` | 统一契约（非业务模块） | 公共出口仅 `src/index.ts` |
| `backend/identity` | 身份组织 | 人员/机构（名称版本化，只失效不删除） |
| `backend/geo-dict` | 空间字典 | 含合规规则参考数据 |
| `backend/case` | 案件聚合 | `clue`（线索，含立案前「线索登记域」写权）/ `dossier`（卷宗）/ `document`（文书） |
| `backend/approval` | 审批协同 | — |
| `backend/supervision` | 监督统计 | — |
| `backend/deadline` | 期限预警 | — |

## 依赖矩阵（表外依赖 = 构建失败，由结构测试机器兜底）

| 模块 | 允许依赖 | 往来方式 |
|---|---|---|
| shield | 不依赖任何业务模块 | 契约载体 |
| identity | 不依赖任何业务模块 | — |
| geo-dict | 不依赖任何业务模块 | — |
| case | shield、identity、geo-dict | 只读引用 |
| approval | shield、identity、case | 只读引用 + 订阅事件 |
| supervision | shield、identity、case | 只读，**单向，无人依赖它** |
| deadline | shield、case、approval、**geo-dict（#45 补丁 1：只读引用程序节点类型）** | case/approval 为订阅，geo-dict 为只读引用 |
| frontend | shield + 各模块查询接口 | 不直连库、不依赖 backend 内部路径 |

## 往来形态：只有「只读查询 + 事件」两种，默认禁止直写

- **公共出口**：每模块唯一公共出口为包名根 `@natural-enforcement/<module>`
 （`package.json` 的 `exports["."]` → `src/index.ts`）。本切片空壳阶段公共出口暂无
  查询/事件接口内容，形态约定先行。
- **只读查询**：跨模块读取只许 import 对方公共出口暴露的查询接口（只读语义），
  严禁深路径导入（`@natural-enforcement/<module>/<内部路径>`）与跨模块相对路径——
  这两种形态即「直写/绕过接口」的代码级同义，由结构测试 `module-public-entry` 拦截。
- **事件**：订阅只许经对方公共出口暴露的事件契约；订阅不构成写权。
- 案件聚合不依赖任何业务模块（矩阵第 4 行允许列即其全集）。

## 跨域弱引用（#45 澄清，不算第三种往来）

材料回指跨模块来源（如文书回指审批记录）= **「标识 + 冻结快照」弱引用**：

- 只存对方实体技术主键（ULID，#16 §1.1）+ 写入时的冻结快照（展示用冗余字段）；
- 存在性校验/展示解析走统一契约查询入口（shield），案件聚合对审批协同**无代码依赖**；
- 引用键入口统一为 shield 的 `requireCrossDomainReference`——业务代码不得自行定义
  同名入口或降级校验（结构测试 `weak-reference-entry` 拦截）；
- 弱引用不创造「第三种往来」：写入方永不对被引用模块发起调用，读取解析经 shield。

## 前端边界

前端只许依赖 shield 与各模块公共出口的查询接口；不直连库（pg/Prisma/ioredis/
BullMQ/RustFS SDK），不引用 backend 内部路径。本切片为规则先行的最小形态，
前端代码落地时按同一规则扩展。

## 结构测试规则索引

| 规则 | 矩阵行 |
|---|---|
| `shield-single-entry` / `shield-no-business-dep` | shield 行 |
| `identity-deps` / `geo-dict-deps` | 第 1、2 行 |
| `case-deps` / `approval-deps` / `supervision-deps` | 第 4、5、6 行 |
| `supervision-sink` | 第 6 行「单向」反向断言 |
| `deadline-deps` | 第 7 行（含 #45 补丁 1） |
| `module-public-entry` | 往来形态（禁内部路径/跨模块相对路径） |
| `frontend-boundary` | frontend 行（不直连库最小形态） |
| `weak-reference-entry` | 弱引用经 shield 入口 |
