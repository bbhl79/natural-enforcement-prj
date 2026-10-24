# backend/ 模块边界约定（#47 依赖矩阵人读副本，#51 成文）

唯一事实源 = #47 Implementation Decisions（含 #45 补丁）；机器可执行断言 =
`tools/structural-test.sh`（dev lint 检查 2）+ 其负例证据 `tools/structural-probe.sh`
（dev lint 检查 2b，子项名 `structural-probe`）。**本文与结构测试规则同步维护**。

## 模块清单（定案命名）

| 目录 | 模块 | 子域归属 |
|---|---|---|
| `packages/shield` | 统一契约（非业务模块） | 公共出口仅 `src/index.ts` |
| `backend/identity` | 身份组织 | 人员/机构（名称版本化，只失效不删除） |
| `backend/geo-dict` | 空间字典 | 持有合规规则参考数据，不依赖任何业务模块（承载见 ADR 0016） |
| `backend/case` | 案件聚合 | `clue`（线索，含立案前「线索登记域」写权）/ `dossier`（卷宗）/ `document`（文书） |
| `backend/approval` | 审批协同 | — |
| `backend/supervision` | 监督统计 | — |
| `backend/deadline` | 期限预警 | — |

## 依赖矩阵（表外依赖 = 构建失败，由结构测试机器兜底）

| 模块 | 允许依赖 | 往来方式 |
|---|---|---|
| shield | 不依赖任何业务模块 | 契约载体 |
| identity | 不依赖任何业务模块；可经公共出口使用留痕设施包（ADR 0012） | — |
| geo-dict | 不依赖任何业务模块 | — |
| case | shield、identity、geo-dict | 只读引用 |
| approval | shield、identity、case | 只读引用 + 订阅事件 |
| supervision | shield、identity、case | 只读，**单向**。业务模块无人依赖它。`backend/server` 启动包除外（ADR 0004） |
| deadline | shield、case、approval、**geo-dict（#45 补丁 1：只读引用程序节点类型）** | case/approval 为订阅，geo-dict 为只读引用 |
| frontend | shield + 各模块查询接口 | 不直连库、不依赖 backend 内部路径 |

`backend/server` 是 HTTP 启动包，不是第七个业务模块，不占上表的一行。它经公共出口装入全部六个模块，包括监督统计。结构测试 `supervision-sink` 跳过该目录。ADR 0004 只允许这个包里的一个文件直接引用身份模块的数据库适配器。该文件是 `backend/server/src/persistence.module.ts`。

## 往来形态：只有「只读查询 + 事件」两种，默认禁止直写

- **公共出口**：每模块唯一公共出口为包名根 `@natural-enforcement/<module>`
 （`package.json` 的 `exports["."]` → `src/index.ts`）。#52 起 identity 公共出口已承载
  四类动作强校验闸/人员/机构服务与持久化端口；其余模块空壳阶段暂无接口内容，形态约定先行。
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
BullMQ/RustFS SDK），不引用 backend 内部路径（含 `../../backend/…` 相对路径拐进去）。
`frontend-boundary` 自带 specifier 提取，扫 SCAN_CODE 全形态（ts/tsx/mts/cts + mjs/cjs/sh）；
评审必修 C6 修前的形态复用了只认 `@natural-enforcement/*` 与相对路径的提取器，那些依赖名
永远取不到 → 恒绿死规则，现由红探针负例证据兜住。

## 结构测试规则索引

本表逐条登记 `tools/structural-test.sh` 的 `RULES` 数组全部规则：一条规则一行，行序与 `RULES` 数组一致。

| 规则 | 矩阵行 |
|---|---|
| `shield-single-entry` | shield 行：公共出口仅 `packages/shield/src/index.ts` |
| `shield-no-business-dep` | shield 行：shield 不依赖任何业务模块 |
| `identity-deps` | 第 1 行：identity 不依赖任何业务模块（可依赖 shield 与留痕设施包 audit） |
| `geo-dict-deps` | 第 2 行：geo-dict 不依赖任何业务模块 |
| `case-deps` | 第 4 行：case 只许 → shield、identity、geo-dict |
| `approval-deps` | 第 5 行：approval 只许 → shield、identity、case |
| `supervision-deps` | 第 6 行：supervision 只许 → shield、identity、case |
| `supervision-sink` | 第 6 行「单向」反向断言 |
| `deadline-deps` | 第 7 行（含 #45 补丁 1） |
| `module-public-entry` | 往来形态（禁内部路径/跨模块相对路径；范围含 integration 层，豁免见下节） |
| `frontend-boundary` | frontend 行（不直连库、不引 backend 内部） |
| `weak-reference-entry` | 弱引用经 shield 入口 |
| `g1-model-allowlist` | #47 G1「地基不含业务实体」机检形态（承接 #52 AC4）：`backend/prisma/schema.prisma` 的 model 名与白名单逐字相等，表外新增即红——建表动作必须回 #47/#16 定案票，不得自行放宽。#69 定案列入 `AuthSession`、`AuthRememberMe`（见下节「认证记录」）。#92 定案列入 `Role`、`Permission`、`RolePermission`、`PersonnelRole`、`AuditTrail`（见下节「权限与留痕」）。#210 定案列入五张参照数据表（见下节「参照数据」）。#211 定案列入 18 张线索业务表（见下节「线索登记」） |
| `queue-facility-entry` | #55 队列设施唯一入口（bullmq/ioredis 只许在 `packages/queue`，业务侧只许经 `QUEUE_PORT` 注入；G5 机器兜底） |
| `storage-facility-entry` | #53 存储设施唯一入口（`@aws-sdk/*`、`@smithy/*`、`minio`、`rustfs` 只许在 `packages/storage`，业务侧只许经 `STORAGE_PORT` 注入；append-only 最保守语义的机器兜底） |
| `audit-facility-entry` | ADR 0012 留痕设施唯一入口（`auditTrail` 这个 Prisma 委托只许在 `packages/audit`。包外引用即红。观察留痕行走表名） |
| `spatial-no-orm-mutation` | 执行纪律 2（`geoDictLandBoundary` / `geoDictSurveyPoint` 两个空间字典模型与 `clueSpatialPart` / `clueSpatialHit` 两个线索空间模型禁用任何 ORM 写，含 upsert/createMany/updateMany/delete(Many) 与换行链式；写一律 `$queryRaw`/ST_ 函数。范围 = `backend/` + `packages/` + `integration/` + `e2e/` 全源码，SCAN_CODE 形态） |
| `reference-data-no-mutation` | 参照数据只追加的机器兜底（#210，ADR 0016）：五张参照数据表（`GeoDictSourceCode` / `GeoDictViolationType` / `GeoDictDocument` / `GeoDictViolationTypeBasis` / `GeoDictJurisdiction`）的 Prisma 委托只许 insert（create/createMany），不许 update/updateMany/delete/deleteMany/upsert——改参照数据＝追加新版本，不许就地改行或删行。范围 = `backend/` + `packages/` + `integration/` + `e2e/` 全源码，SCAN_CODE 形态，含换行链式 |
| `runtime-manifest` | 非矩阵行：运行参数清单（ADR 0008、#80、#120）。`infra/docker-compose.yml` 与 `.github/workflows/ci.yml` 里的变量名必须登记在 `infra/runtime.env`；密钥只许引用变量（compose）或 secrets（CI），不许字面量、默认值、回落值，也不许出现清单里密钥的夹具值 |
| `user-lock-assertions` | 非矩阵行：锁清单断言（#105「锁清单」、#111、#120）。`docs/user-lock.md` 每节带一个断言编号；测试代码里必须有标题以该编号开头的 it/test（含 it.todo「待实现」登记）；测试里出现清单外编号同样判红 |
| `frontend-router-mode` | 非矩阵行：前端路由模式（#105「前端：路由与应用壳」、#122）。react-router 只用 data 模式（createBrowserRouter + RouterProvider）；前端源码出现声明式 `<BrowserRouter>`/`<HashRouter>`，或任何 package.json、源码、vite 配置引用框架模式开发插件 `@react-router/dev` 即失败 |
| `screenshot-full-set` | 截图全集文件名集合（#105「截图验收（loop ⑥c）」、#134 收口、#207 换全集）：`docs/screens/<票>/` 顶层 `*.png` 的并集不得越出状态键全集。状态键全集 = 原型 v0.4 的 78 键（`frontend/prototype/admin-console/screens/*.png`，除 `overview.png`）∪ #207 协议第 I 节的 62 键（`docs/screens/keys-207.txt`）。v0.4 时代那批键一张不少（缺即红）；#207 时代那批由各执行票分票出图，齐套判定留到 #220「全集收尾」收口。自动判定只比文件名集合；画面一致由逐图人查（各票 README 与 PR） |

## 认证记录（#69）

会话与记住我分两张表，白名单名字是 `AuthSession`、`AuthRememberMe`。技术主键是 ULID。记录只失效不删除。两张表只存人员标识，不存组织、角色、数据范围、执法资格。浏览器拿到的是 256 位随机数，库里的 `secret_hash` 只存它的 SHA-256（64 位小写十六进制）。

寿命、Cookie、并发与结束条件以 #63 最终决议为准。本表只记录这些规则落在哪一列。

分表的原因：会话 Cookie 在浏览器关闭时消失，记住我可以留到勾选那次认证起 168 小时。换新秘密要保留已作废的旧摘要，旧秘密再次出现时才能认出来。一段会话可以没有记住我。一条记住我也可以没有仍在使用的会话。

一台设备是一个 `chain_id`。链的首行让 `chain_id` 等于自己的 `id`，换新秘密时原样复制。换新的写入顺序是先把旧行结束为 `rotated`，再插入 `predecessor_id` 指向旧行的新行。`predecessor_id` 唯一，所以每个前驱只有一个后继。后继只接受 `end_reason = rotated` 的前驱，退出、未勾选记住我、挤掉、停用这些结束不是换新，不能再延长这条链。同一条链同时只有一行未结束。按设备作废，就是结束这条链上未结束的那一行。

旧秘密再次出现时，用 `secret_hash` 命中 `end_reason = rotated` 的行，再结束该人员的全部会话和全部记住我。

### `auth_session`（会话）

| 列 | 含义 |
|---|---|
| `id` | ULID |
| `personnel_id` | 人员标识 |
| `secret_hash` | `__Host-sid` 随机数的 SHA-256 |
| `remember_me_chain_id` | 这台设备的记住我链首行 id。这次登录没有记住我则为空 |
| `authenticated_at` | 这段会话的认证时刻 |
| `last_seen_at` | 最近一次请求。空闲从这里起算。只允许向前改 |
| `absolute_ends_at` | 绝对终点。未勾选记住我时，从这次认证起 8 小时。勾选记住我时，必须等于该链首行的绝对终点，不重新起算 |
| `ended_at` | 空表示这段会话仍可使用 |
| `end_reason` | 与 `ended_at` 同一次写入。取值：`logout`、`admin-ended`、`personnel-deactivated`、`idle-timeout`、`absolute-timeout`、`displaced`、`remember-me-reuse` |

未结束的行只允许推进 `last_seen_at`。结束后整行不可再改。查找某人员仍未结束的会话，并取出最旧一段，使用部分索引 `auth_session_active_by_personnel`。

### `auth_remember_me`（记住我）

| 列 | 含义 |
|---|---|
| `id` | ULID |
| `personnel_id` | 人员标识 |
| `chain_id` | 设备链。首行等于自己的 `id` |
| `secret_hash` | `__Host-rm` 这一枚秘密的 SHA-256 |
| `absolute_ends_at` | 勾选那次认证起 168 小时。换新秘密不往后推，复制到新行 |
| `predecessor_id` | 被换下的上一枚秘密。首行为空 |
| `ended_at` | 空表示这一枚秘密仍可使用 |
| `end_reason` | 与 `ended_at` 同一次写入。取值：`logout`、`login-without-remember`、`rotated`、`displaced`、`admin-ended`、`personnel-deactivated`、`remember-me-reuse`、`absolute-timeout` |
| `created_at` | 这一枚秘密写入的时刻 |

已结束的行不可再改。同一条链同时只有一行未结束，由部分索引 `auth_remember_me_one_active_per_chain` 保证。按人员找出未结束的记住我，用部分索引 `auth_remember_me_active_by_personnel`。`chain_id` 的自引用外键是 `auth_remember_me_chain_fk`。加上会话的 `auth_session_active_by_personnel`，这四样 Prisma schema 表达不了，后续生成迁移时不得删掉。

## 权限与留痕（#92）

#96 已去掉人员表旧 `role` 列。授权按操作码，不按这一列。人员登录与执法资格的当前值：

| 列 | 含义 |
|---|---|
| `mobile_phone` | 登录标识。有值时全库唯一。空则不能登录。位数与号段不在 ADR 0005 规定 |
| `password_failure_count` | 失败次数。默认 0 |
| `password_failure_window_started_at` | 失败窗口起点 |
| `locked_until` | 锁定到期 |
| `password_changed_at` | 上次改密时间。空表示尚未改过初始口令 |
| `enforcement_cert_no` | 执法证号 |
| `enforcement_cert_expires_on` | 执法证有效期，日期 |

四张权限表白名单名字是 `Role`、`Permission`、`RolePermission`、`PersonnelRole`。技术主键是 ULID。一行权限是一条操作码。并集不落库。人员—角色不记机构。记录只失效不删除：库拒绝 DELETE，UPDATE 只允许把 `deactivated_at` 从空写成非空。未失效行的业务键由部分唯一索引保证：`role_one_active_name`、`permission_one_active_code`、`role_permission_one_active`、`personnel_role_one_active`。Prisma schema 表达不了这四条索引，后续生成迁移时不得删掉。

留痕表白名单名字是 `AuditTrail`。技术主键是 ULID。除主键、`created_at`、`action`、`outcome` 外都可空。`outcome` 只有 `succeeded` 与 `failed`。触发器复用 `reject_row_mutation`，拒绝 UPDATE 和 DELETE。登录标识、执法证号、口令不进入任何一列。可空整数列 `item_count` 记导出条数，只有带条数的动作写值（ADR 0013）。人员导出写 `personnel.exported`。导出留痕表 `ExportAudit` 已冻结：不再写入，表、触发器和白名单条目保留，已有行可查（ADR 0013）。

参照种子在所有环境写入七个角色、操作码名册和允许行。允许行以 GitHub issue #71 为准。`authz.binding.submit` 与 `authz.binding.approve` 只给系统管理。人员导出 `personnel.profile.export` 只给系统管理（#125）。开发测试夹具（机构与人员）只在 `NODE_ENV` 不是 `production` 时写入。生产环境必须设置 `NODE_ENV=production`，夹具人员才不进生产库。夹具人员带手机号，`password_changed_at` 为空。生产环境的首个系统管理人员不在本票。

## 参照数据（#210，ADR 0016）

五张参照数据表在空间字典模块（geo-dict）名下，随种子只追加写入。库层触发器拒 UPDATE 与
DELETE（复用 `reject_row_mutation`），应用层另由结构测试 `reference-data-no-mutation` 兜底：
委托只许 insert，改数据＝追加新版本。

| 白名单名字 | 承载 | 键 | 说明 |
|---|---|---|---|
| `GeoDictSourceCode` | 线索来源编码 | `code` + `version` | 30 项（5 大类 + 20 二级 + 5 三级）。`parent_code` 显式存上级编码，不按前缀推断 |
| `GeoDictViolationType` | 违法类型编码 | `code` + `version` | 94 个可选具体违法行为 + 19 个不可选大类。`domain` 取 land/mineral/survey/planning；`appendix` 是附录序号出处，不进编码 |
| `GeoDictDocument` | 依据文件表 | `code` + `version` | 80 份。`hierarchy_level` 取效力层级九档，`validity_status` 取效力状态三值 |
| `GeoDictViolationTypeBasis` | 违法类型的依据引用 | 类型版本 + 文件版本 + 条号 + 用途 | 用途四类：处罚、裁量基准、移送处分、认定标准。引用钉版本，展示名随行冻结快照 |
| `GeoDictJurisdiction` | 辖区对应 | `code` + `version` | 只存「街道（镇）编码 → 机构」，不按法域区分。业务方交付后随种子只追加写入 |

初值常量在 `backend/geo-dict/src/reference-data/`，由 `tools/generate-clue-reference-data.mjs`
从 `docs/research/` 下的定稿底稿生成；种子按同一份常量写库。核查图层与街道边界几何不入种子
（ADR 0021 未立）。

## 线索登记（#211）

18 张线索业务表归案件聚合模块（case）名下，是线索业务事实。迁移
`20261024224815_issue211_clue_registration` 建表；`audit_trail` 同批只新增可空 `detail TEXT`
（结构化快照，只写不回）。

| 白名单名字 | 承载 | 说明 |
|---|---|---|
| `Clue` | 线索主体 | 业务编号 `code` 与主键分离（取值来自 sequence `clue_code_seq`，形如 `CL0000000001`）。`idempotency_key` 与 `request_digest` 同存两列，同 key 异报文即 409 |
| `ClueSpatialObject` | 空间对象 | 线索持有 1..1 空间对象。`kind` 取 face/point，`part_count` 是几何部件数 |
| `ClueSpatialPart` | 空间部件 | 形制沿用 `GeoDictLandBoundary`：`geom` 为 EPSG:4490，`source_srid` + `source_geom` 保留来源坐标。禁 ORM 写，几何读写走 `$queryRaw` |
| `ClueSpatialHit` | 疑似重复命中集 | 每个合格面对一行：双方面 id、双方各自重合度、交集面积（平方米）。只存当前命中集，重算整体替换。禁 ORM 写 |
| `ClueRequirementSnapshot` | 录入要件快照 | 登记时快照要件键集合，老线索按登记当时判断。`declaration_version` 记声明版本 |
| `ClueItemValue` | 要件取值 | 一条线索逐键落值。`value` 是文本，`value_json` 是结构化取值 |
| `ClueItemGap` | 缺件 | 类型层缺件为常驻事实行。补齐后清单消失（`filled_at` 有值），行仍保留 |
| `ClueInitialType` | 初步涉嫌违法类型 | 可空可多个，取值取自违法类型清单 |
| `ClueTagLibrary` / `ClueTag` | 标签库与线索标签 | 登记时 create-on-use：库里没有的当场新建 |
| `ClueMaterial` | 已登记材料 | 只在登记事务中写入，没有待关联状态。`kind` 取 attachment/spatial-source；GeoJSON 来源文件不占普通附件配额 |
| `ClueVerificationRun` | 内业核查运行 | 土地/矿产录入后自动入队，点状不跑。`run_no` 是同一线索的运行序号 |
| `ClueHandler` | 承办人 | 主办/协办。`role` 取 main/assist |
| `ClueAssignment` | 分派事实 | 首次分派、重新分派、指定管辖、系统管理员重新指定都并入本表。`kind` 取 initial/reassign/designate/pool-reassign |
| `ClueWithdrawal` | 撤回不派 | `reason_codes` 是数组列，至少一项；`note` 必填 |
| `ClueDisposition` | 处置 | 不予立案、随旧线索办结、移送。`disposition` 取 no-case/with-old/transfer |
| `ClueClosureReminder` | 结案提醒 | 不予立案、移送、立案时按当前命中集逐对生成 |
| `ClueDesignationRequest` | 指定管辖报请 | 下级报请上级指定管辖。`status` 取 pending/approved/rejected |

## 测试装配层豁免（integration 层）

`integration/` 不属于任何业务模块，它按 #47 的验收矩阵做跨模块装配：直接引各模块 `src`
深路径与生成的 Prisma Client 是设计而非违规（书面依据 = `integration/tsconfig.json` 把
`../backend/prisma/**/*.ts` 纳入 include + `backend/identity/src/index.ts` 出口注释
「由 integration 层深路径装配」）。

- 豁免只覆盖 `module-public-entry` 一问（深路径 / 跨模块相对路径），且按
  **文件 → 允许的 specifier 前缀**逐条写死在 `tools/structural-test.sh` 的 `ASSEMBLY_EXEMPT`
  名单里；名单外的深路径导入照样判红（红探针 `tools/structural-probe.sh` 有此项负例证据）。
- 形态类规则不豁免：装配层同样不得裸依赖队列/存储 SDK、不得自定义
  `requireCrossDomainReference`、不得对空间模型调 ORM 写（`spatial-no-orm-mutation`
  的范围也含 `integration/`、`e2e/`）。
- 业务模块（`backend/*`、`frontend/*`）不适用本豁免，仍只许经对方公共出口。

## 兜底闸自身的负例证据

`tools/structural-test.sh` 只会出示「全绿」，分不清「规则通过」与「规则根本没在扫」。
`tools/structural-probe.sh`（dev lint 第五子项 `structural-probe`）逐条写入违例源码、断言
结构测试确实判红并命中该规则，然后还原源码——每条规则的「会红」是每次 check 都跑的断言。
两文件成对维护：加/改规则时同步补一条负例探针，否则该规则视为未被证明有效。
