#!/usr/bin/env bash
# 用途：源码结构规则的机器执行闸：任一规则红即整体非 0 退出。
# 结构测试设施（#51 全量七模块依赖矩阵；#50 shield 唯一出口规则并入；
# #55 队列设施唯一入口规则并入；#53 存储设施唯一入口规则并入）。
# 规则 = #47 Implementation Decisions 依赖矩阵（含 #45 补丁 1）的机器可执行断言；
# 任一规则红即整体非 0 退出（接入 dev lint，与 ESLint/依赖漏入库检查并列，
# 构成「失败即构建失败」的本地 CI 等价闸）。
#
# 扩展方式：新增一个 check_<规则名>() 函数（输出 [OK]/[FAIL] 行），并将其名追加到
# RULES 数组即可；规则函数只读仓库源码，不依赖容器或网络。共用辅助函数（非规则，
# 不进 RULES）必须登记进 HELPERS 数组——红探针的接线完整性护栏按
# 「check_ 函数集 == RULES ∪ HELPERS」核对，未登记的函数会被判成死规则（#171）。
#
# 运行参数（#171，仅供 tools/structural-probe.sh 与人工单查；dev 命令面不暴露）：
#   --rule <名>      只跑 RULES 数组内的一条规则；名不在数组内即 [FAIL] 未知规则名 + 退出 1。
#                    过滤只落在末尾派发循环体内，循环外不存在第二条按名派发入口。
#   --list-rules     只读模式：逐行输出 RULES 后退出 0，不跑任何规则。
#   --list-helpers   只读模式：逐行输出 HELPERS 后退出 0，不跑任何规则。
#   不带参数时行为与历史版本逐字相同（全量规则 + 同样的输出与退出码）。
#
# 性能约定（#176，父规格 #168 改造项 3；写在本文件头而不是 dev 的 usage：usage 面向
# 「命令怎么用」，本段面向「闸怎么维护」）：本闸是纯源码扫描，成本的量纲是「一次全量起了
# 多少个外部子进程」，不是算法复杂度——子进程数只由闸的形态决定，与机器快慢无关，是确定性的
# 回归红线；耗时受机器负载影响，只作粗兜底。
#   子进程预算（一次全闸；实测口径 = 数一次全闸起的外部子进程）：
#     总数 ≤ 4200；grep + sed 小计 ≤ 3400。超预算即形态退化，按失败处理。
#     实测：改造前 5910（grep 2330 / sed 1237 / dirname 865 / realpath 864 / awk 408 /
#     tr 165 / find 19 / 其余 24）→ 改造后 3564（grep 2020 / sed 926 / awk 409 / tr 166 /
#     find 19 / realpath 1 / dirname 1 / 其余 22）。
#     import 家族 9 条规则（shield-no-business-dep + 6 条 *-deps + supervision-sink +
#     module-public-entry）：grep+sed 622 → 1，realpath 864 → 1（一次批量），
#     dirname 864 → 0（改成参数展开），单条规则最多从 1193 降到 8。
#   grep + sed 为什么没降到研究文档 §6.2 说的 300 以下：残留 2945 全在本轮范围外——
#     runtime-manifest 1435（规格明列排除，另开票）、storage 366 / queue 346 / spatial 330 /
#     audit 195 四条逐文件形态规则（研究文档 §5.1 列为「需独立单遍」，另开票）、
#     frontend-router-mode 85 / frontend-boundary 84 / user-lock-assertions 83 / 其余 21。
#     §6.2 的「< 300」以「顺带批量化规则 11/14/15/16」为前提，那部分不属本票范围。
#   单次全闸墙钟上限：≤ 8 秒。本机（WSL2 / GNU bash 5.3）实测改造后 4.0–4.4 秒、
#     改造前 10.3 秒；上限取实测的约 1.8 倍，既容机器差异，又能抓住「退回逐文件扫描」。
#     该秒数待在 CI 机器上实测复核（规格 #168 开放项：具体值由实施票按 CI 机器实测重定）。
#   守门方式：CI 侧计数，不改本闸一行、不新增 CI 步骤——数一次全闸起的外部子进程，
#     总数 ≤ 4200、grep + sed 小计 ≤ 3400。超预算即形态退化，按失败处理。
#     （历史口径脚本 tools/structural-snapshot/count-subprocs.sh（已退役）：该目录的
#     快照基线记 21 条规则，在位闸 28 条，compare.sh 按 21 条比对会对全部 29 个场景误报
#     「不一致」。阈值与实测数字保留在本段，按同一口径复核即可。）
#   等价性判据：tools/structural-probe.sh——51 条注入违例的场景，红探针逐条断言目标规则
#     确实判红并自清理，已接入 dev lint structural-probe 与 CI。改本闸的取数形态后必须
#     重跑红探针，51 条违例仍须把各自的目标规则判红。
#
# 依赖矩阵（唯一事实源 = #47；人读副本 = backend/README.md，二者同步维护）：
#   shield      统一契约，不依赖任何业务模块；公共出口仅 src/index.ts
#   identity    身份组织，不依赖任何业务模块
#   geo-dict    空间字典，不依赖任何业务模块
#   case        案件聚合 → shield、identity、geo-dict（只读引用）
#   approval    审批协同 → shield、identity、case（只读引用 + 订阅事件）
#   supervision 监督统计 → shield、identity、case（只读，单向，无人依赖它）
#   deadline    期限预警 → shield、case（订阅）、approval（订阅）、
#               geo-dict（只读引用程序节点类型，#45 补丁 1）
#   frontend    前端工作台 → shield + 各模块查询接口（不直连库、不依赖 backend 内部路径）
#
# 往来形态（模块间只有「只读查询 + 事件」两种，默认禁止直写）：互引只许经对方公共出口
#（包名根导入 @natural-enforcement/<module>）；内部路径（深路径导入或跨模块相对路径）
#一律拦截，由 module-public-entry 规则承载。材料回指跨模块来源 = 「标识 + 冻结快照」
# 弱引用（#45 澄清，不算第三种往来），只许经 shield 的 requireCrossDomainReference 入口。
#
# 规则清单（矩阵每行一条；「依赖漏入库」由 dev lint 既有检查承载，此处不重复）：
#   shield-single-entry     shield 公共出口仅 packages/shield/src/index.ts
#   shield-no-business-dep  shield 不依赖任何业务模块
#   identity-deps           identity 不依赖任何业务模块；可依赖 shield 与留痕设施包 audit（ADR 0012）
#   geo-dict-deps           geo-dict 不依赖任何业务模块
#   case-deps               case 只许 → shield、identity、geo-dict
#   approval-deps           approval 只许 → shield、identity、case
#   supervision-deps        supervision 只许 → shield、identity、case
#   supervision-sink        无人依赖 supervision（矩阵行「单向」的反向断言）
#   deadline-deps           deadline 只许 → shield、case、approval、geo-dict（#45 补丁 1）
#   module-public-entry     backend/frontend/e2e/integration 互引模块只许公共出口（禁内部路径；
#                           integration 层按 ASSEMBLY_EXEMPT 名单豁免，评审必修 C7）
#   frontend-boundary       前端不直连库、不依赖 backend 内部（自带 specifier 提取，评审必修）
#   weak-reference-entry    跨域弱引用只许经 shield 的 requireCrossDomainReference 入口
#   g1-model-allowlist      schema.prisma 的 model 名白名单（#47 G1「地基不含业务实体」的
#                           机检形态，承接 #52 AC4「G1 由结构测试兜底」；新增表即失败。
#                           #69 定案列入 AuthSession、AuthRememberMe。
#                           #92 定案列入 Role、Permission、RolePermission、PersonnelRole、AuditTrail）
#   queue-facility-entry    队列设施唯一入口（#55）：bullmq/ioredis 只许出现在
#                           packages/queue（设施包）；backend/frontend/e2e/integration/shield
#                           出现裸队列依赖 = 业务 worker 绕过队列接口（G5 不可扩大条件的
#                           机器兜底，强于注释级约定）；业务侧只许经 QUEUE_PORT 注入
#   storage-facility-entry  存储设施唯一入口（#53）：S3/RustFS SDK 依赖（@aws-sdk/*、
#                           @smithy/*、minio、rustfs）只许出现在 packages/storage
#                           （设施包）；其余位置出现 = 绕过 StoragePort 追加式抽象
#                           直连存储（append-only 最保守语义的机器兜底，强于注释级约定）
#   audit-facility-entry    留痕设施唯一入口（ADR 0012）：auditTrail 这个 Prisma 委托
#                           只许出现在 packages/audit。包外引用即失败
#   spatial-no-orm-mutation 空间纪律机器兜底（评审必修扩口径）：backend/、packages/、
#                           integration/、e2e/ 全源码
#                           （SCAN_CODE 形态：ts/tsx/mts/cts + mjs/cjs/sh）不得对
#                           geoDictLandBoundary / geoDictSurveyPoint 两个空间模型
#                           delegate 调任何 ORM 写
#                           （create/createMany/upsert/update/updateMany/delete/deleteMany，
#                           含换行链式）——含必填空间字段的模型禁用 ORM 写
#                           （infra/VERSIONS.md 执行纪律 2），写一律走 $queryRaw/ST_ 函数
#   reference-data-no-mutation 参照数据只追加的机器兜底（#210）：五张参照数据表
#                           （geoDictSourceCode / geoDictViolationType / geoDictDocument /
#                           geoDictViolationTypeBasis / geoDictJurisdiction）的 delegate
#                           只许 insert，不许 update/updateMany/delete/deleteMany/upsert
#                           （ADR 0016：改参照数据＝追加新版本，不许就地改行或删行）
#   runtime-manifest        运行参数清单（ADR 0008、#80、#120）：infra/docker-compose.yml 与
#                           .github/workflows/ci.yml 里的变量名必须登记在 infra/runtime.env；
#                           密钥只许引用变量（compose）或 secrets（CI），不许字面量、默认值、
#                           回落值，也不许出现清单里密钥的夹具值
#   user-lock-assertions    锁清单断言（#105「锁清单」、#111、#120）：docs/user-lock.md 每节
#                           带一个断言编号；测试代码里必须有标题以该编号开头的 it/test
#                           （含 it.todo「待实现」登记）；测试里出现清单外编号同样判红
#   frontend-router-mode    前端路由模式（#105「前端：路由与应用壳」、#122）：react-router 只用
#                           data 模式（createBrowserRouter + RouterProvider）。前端源码出现
#                           声明式 <BrowserRouter>/<HashRouter>，或任何 package.json、源码、
#                           vite 配置引用框架模式开发插件 @react-router/dev 即失败
#   source-comment-coverage 源码注释覆盖（约定见 docs/agents/code-comments.md）：COMMENT_SCOPE 内的
#                           ts/tsx/mts/cts/mjs/cjs 须有文件头「用途：」、导出符号须有紧邻注释、
#                           测试文件的 describe 须有紧邻注释、控制器路由须有紧邻的「操作码 <码>」
#                           注释且操作码在 packages/shield/src/contract/opcode.ts 的名册内
#   shell-comment-coverage  shell 注释覆盖：COMMENT_SCOPE 内的 .sh 与 dev 须有文件头「用途：」、
#                           每个函数定义须有紧邻的 # 注释
#   comment-path-refs       注释引用的仓库路径须已入库（git ls-files）：防止注释指向未入库或已删除的文件
#   screenshot-full-set     截图全集文件名集合（#105「截图验收（loop ⑥c）」、#134 收口、#207 换全集、#220 齐套）：
#                           docs/screens/manifest/<票>.txt 各票状态键段的文件名并集，不得越出
#                           状态键全集，也不得缺键。
#                           状态键全集 = 原型 v0.4 的 78 键
#                           （frontend/prototype/admin-console/screens/*.png，除 overview.png）
#                           ∪ #207 协议第 I 节的 62 键（docs/screens/keys-207.txt）。
#                           v0.4 时代缺键判红；#207 的 62 键缺键同样判红（#220 收口）。
#                           文件名越出全集判红。清单的 ## aux 段（对照与补充图）不计入实有集合。
#                           自动判定只比文件名集合；画面一致由逐图人查（各票 README 与 PR）
set -uo pipefail

ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
BACKEND="$ROOT/backend"
SHIELD_DIR="$ROOT/packages/shield"
# 队列设施包（#55）：bullmq/ioredis 的唯一合法出现位置
QUEUE_DIR="$ROOT/packages/queue"
# 存储设施包（#53）：S3/RustFS SDK 的唯一合法出现位置
STORAGE_DIR="$ROOT/packages/storage"
# 留痕设施包（ADR 0012）：auditTrail 委托的唯一合法出现位置
AUDIT_DIR="$ROOT/packages/audit"
# ADR 0004：启动包里只有这一个文件可以直接引用各业务模块的数据库适配器
# （#52 身份组织；#211 案件聚合的线索表适配器）。名单是文件 + specifier 白名单：
# 名单外的深路径导入照样判红（红探针有负例证据）。
SERVER_ADAPTER_FILE="backend/server/src/persistence.module.ts"
SERVER_ADAPTER_SPECS=(
  "../../identity/src/persistence/prisma-identity-store.ts"
  "../../case/src/persistence/prisma-clue-store.ts"
  "../../case/src/persistence/prisma-case-store.ts"
)

# 该 specifier 是否在适配器豁免名单内。
is_server_adapter_spec() { # $1 = specifier
  local spec
  for spec in "${SERVER_ADAPTER_SPECS[@]}"; do
    [ "$spec" = "$1" ] && return 0
  done
  return 1
}

# 业务模块清单（定案命名，#47/#51）：模块名 → 源码目录（相对 ROOT）
MODULES=(identity geo-dict case approval supervision deadline)
declare -A MOD_DIR=(
  [identity]=backend/identity
  [geo-dict]=backend/geo-dict
  [case]=backend/case
  [approval]=backend/approval
  [supervision]=backend/supervision
  [deadline]=backend/deadline
)
# 依赖矩阵允许列（#47 原文，含 #45 补丁 1；元素 = 模块名或 shield）
declare -A ALLOW=(
  [identity]="shield audit"
  [geo-dict]="shield"
  [case]="shield identity geo-dict"
  [approval]="shield identity case"
  [supervision]="shield identity case"
  [deadline]="shield case approval geo-dict"
)

RULES=(
  shield-single-entry
  shield-no-business-dep
  identity-deps
  geo-dict-deps
  case-deps
  approval-deps
  supervision-deps
  supervision-sink
  deadline-deps
  module-public-entry
  frontend-boundary
  weak-reference-entry
  g1-model-allowlist
  queue-facility-entry
  storage-facility-entry
  audit-facility-entry
  spatial-no-orm-mutation
  reference-data-no-mutation
  case-history-append-only
  person-conflict-append-only
  agency-conflict-append-only
  investigation-record-no-delete
  runtime-manifest
  user-lock-assertions
  frontend-router-mode
  screenshot-full-set
  ui-copy-discipline
  no-case-landing-entry
  criteria-traceability
  source-comment-coverage
  shell-comment-coverage
  comment-path-refs
)
# 共用辅助函数（非规则，不进 RULES，#171 显式声明）：check_row 是 6 条 *-deps 规则
# 共用的矩阵行实现。红探针的接线完整性护栏按「check_ 函数集 == RULES ∪ HELPERS」核对，
# 不显式声明会被误判成「写了但从未接线的死规则」。
HELPERS=(
  row
)
FAIL=0

# 输出一条通过行
note_ok()   { echo "[OK]   $1"; }
# 输出一条失败行并置整体失败
note_fail() { echo "[FAIL] $1"; FAIL=1; }

# 扫描范围：业务源码（tools/、dev、infra、docs 不扫描：规则约束的是代码互引）
SCAN_TS_NAMES=(-name '*.ts' -o -name '*.tsx' -o -name '*.mts' -o -name '*.cts')
# SCAN_CODE（评审必修 C5）：可执行用例与脚本同样书写互引 specifier——e2e/cases/*.sh 直连
# 后端设施、backend/prisma/*.mjs 装配依赖、*.cjs 校验器走 require。只扫 .ts 让这些形态
# 落在兜底闸之外（本条为先决改动：加入后现有源码逐条复核，判定结果不变）。
SCAN_CODE_NAMES=("${SCAN_TS_NAMES[@]}" -o -name '*.mjs' -o -name '*.cjs' -o -name '*.sh')
# 生成产物排除（Prisma 7 生成客户端）。schema.prisma 的 generator client 把 output 定在
# backend/prisma/generated/prisma（相对 backend/prisma/ 解析）。该目录是构建产物，不入库、
# 不参与任何源码规则判定：生成的 model 类自带 update/updateMany/delete/deleteMany 方法，
# 会被「只追加」「不物理删除」「参照数据不��改」类规则误判为业务 ORM 改写调用（实测 83 条
# 假红：reference-data-no-mutation 25、spatial-no-orm-mutation 21、person-conflict-append-only
# 15、case-history-append-only 10、agency-conflict-append-only 5、investigation-record-no-delete
# 4、audit-facility-entry 3）。宿主工作树若残留该目录（有人手工跑过 prisma generate），闸必须
# 仍能判绿——故按路径排除，不依赖 .gitignore：本闸用 find/grep 扫盘，不读 gitignore。
SCAN_EXCLUDE_GENERATED=(-not -path "$BACKEND/prisma/generated/*")
SCAN_TS=(-type f \( "${SCAN_TS_NAMES[@]}" \) "${SCAN_EXCLUDE_GENERATED[@]}")
SCAN_CODE=(-type f \( "${SCAN_CODE_NAMES[@]}" \) "${SCAN_EXCLUDE_GENERATED[@]}")

# 互引 specifier 的提取正则（唯一一份定义）：包名根/深路径导入
# （@natural-enforcement/<mod>[/<…>]）、相对路径导入。第三方包（@nestjs/*、node: 等）
# 不在矩阵范围，不提取。require 与 from/import 同权（评审必修 C5）：.cjs 校验器以 node
# 原生 CJS 运行，只认 ESM 语法等于扫而不取。
# shield 定名 @natural-enforcement/shield（评审必修补 scope）：旧裸名 shield 不再是
# 合法 specifier，不在提取范围；其残留深路径引用由 shield-single-entry 规则单独拦截。
SPEC_RE="\b(from|import|require)[^'\"]{0,40}['\"](@natural-enforcement/[a-z0-9-]+|\.{1,2}/)[^'\"]*['\"]"
# 剥掉命中片段两头的关键字与引号（^[a-z]+ 吃掉 from/import/require，[^'"]* 吃到第一个引号）
SPEC_STRIP_PRE="s/^[a-z]+[^'\"]*['\"]//"
SPEC_STRIP_POST="s/['\"]\$//"

# 逐文件提取（老形态）。#176 之后 import 家族 9 条规则改走下面的共享导入索引，
# 本函数只剩 weak-reference-entry 一个调用方（它先用 grep -rlE 定位候选文件，
# 候选数常年为个位数，不在提速范围；研究文档 §5.1 同口径）。
specifiers_of() {
  grep -oE "$SPEC_RE" "$1" 2>/dev/null \
    | sed -E "$SPEC_STRIP_PRE; $SPEC_STRIP_POST"
}

# ---------- 共享导入索引 + 批量路径解析（#176，父规格 #168 改造项 3） ----------
# 为什么：改造前 9 条 import 家族规则（shield-no-business-dep + 6 条 *-deps +
# supervision-sink + module-public-entry）各自逐文件 grep+sed 提 specifier、各自对每个
# 相对 specifier 起一对 realpath+dirname。一次全闸 5910 个子进程里 1728 个纯属路径解析，
# 而 864 次 realpath 只有 181 个唯一「源文件目录|specifier」组合
# （docs/research/structural-test-speedup.md §1.1、§3.2）。
#
# 新形态两处，只改「数据从哪来」，不改判定：
#   ① import 单遍提取：一次整根 grep -rHnoZI + 一次 awk 切分 → 「文件 → specifier 列表」
#      共享索引 IMPORT_IDX。各规则的 find 调用与 SCAN_TS/SCAN_CODE 掩码定义零改动——
#      掩码控制权仍在 find 手里，索引只是数据源（研究文档 §3.1 推荐做法 3）。
#   ② realpath 批量化：相对 specifier 按「dirname(源文件)|specifier」去重（REL_KEYS/
#      REL_PATHS 同序成对），一片一次 realpath -m，输出行序与参数序一一对应，逐行归成
#      模块名存进查表 REL_TARGET。不用 awk 词法归一：realpath -m 先解符号链接再处理 ..，
#      词法归一不等价（当前仓库符号链接数 0 是偶然事实，不是规则保证）。
#
# 掩码过滤在取值处再做一遍（mask_allows）：索引按 SCAN_CODE（最宽掩码）存全量，
# SCAN_TS 规则取值时按自己的掩码过滤，不靠「反正这些根下现在没有 .mjs/.cjs/.sh」
# 这一偶然事实（研究文档 §2.1：backend/prisma/seed.mjs 里就有一条相对 specifier）。
# 掩码只有一份定义：扩展名 glob 从 SCAN_TS_NAMES/SCAN_CODE_NAMES 派生，索引的 --include
# 与取值处的过滤共用它，不允许出现第二份平行清单（会漂移）。
#
# 惰性构建：首次取值时才建索引与查表，故 --rule 单规则跑非 import 家族规则时一次都不建
# （红探针 33 条逐条用例全靠这点保持单规则耗时）。
#
# 结果一律写全局变量而不是 echo：命令替换每次 fork 一个子 shell，import 家族一轮要解析
# 上千次，fork 成本会吃掉批量化省下的时间。
IMPORT_ROOTS=("$BACKEND" "$ROOT/frontend" "$ROOT/e2e" "$ROOT/integration" "$SHIELD_DIR")
declare -A IMPORT_IDX=()    # 文件绝对路径 → 该文件的 specifier 列表（换行分隔）
declare -A REL_TARGET=()    # 「源文件目录|相对 specifier」 → 目标模块名（无归属 = 空串）
declare -A REL_KEY_SEEN=()  # 去重标记（只为 REL_KEYS 不重复，不承载取值）
REL_KEYS=()                 # 去重后的查表键，序 = 批量 realpath 的参数序
REL_PATHS=()                # 与 REL_KEYS 同序：喂给 realpath -m 的「源文件目录/specifier」
IMPORT_INDEX_READY=0
# 分片阈值：1000 键 ≈ 130 KB，远低于 ARG_MAX（本机 2 MB）；键数随仓库增长自动多跑几片
REALPATH_BATCH=1000
IMPORT_SPECS=""             # import_specs_of 的结果（换行分隔）
SPEC_TARGET=""              # target_of_spec / target_of_relative 的结果（模块名或空）
HOME_OF=""                  # home_of 的结果（模块名或空）
MODULE_HIT=""               # classify_resolved 的结果（模块名或空）

# 从 find 的 -name 表达式里取出扩展名 glob（元素形如 *.ts），派生出掩码的 glob 清单
SCAN_TS_GLOBS=()
for _scan_name in "${SCAN_TS_NAMES[@]}"; do
  case "$_scan_name" in \*.*) SCAN_TS_GLOBS+=("$_scan_name") ;; esac
done
SCAN_CODE_GLOBS=()
for _scan_name in "${SCAN_CODE_NAMES[@]}"; do
  case "$_scan_name" in \*.*) SCAN_CODE_GLOBS+=("$_scan_name") ;; esac
done
unset _scan_name

# 文件名扩展名是否在给定掩码内
mask_allows() { # $1 = 掩码名（ts|code），$2 = 文件绝对路径；扩展名在掩码内返回 0
  local base="${2##*/}" g
  case "$1" in
    ts)   for g in "${SCAN_TS_GLOBS[@]}";   do case "$base" in $g) return 0 ;; esac; done ;;
    code) for g in "${SCAN_CODE_GLOBS[@]}"; do case "$base" in $g) return 0 ;; esac; done ;;
  esac
  return 1
}

# 取某文件的 specifier 列表：结果写进全局 IMPORT_SPECS（换行分隔，无命中即空串）。
# $1 = 文件绝对路径（由各规则自己的 find 给出），$2 = 该规则的掩码名（ts|code）。
import_specs_of() {
  IMPORT_SPECS=""
  ensure_import_index
  mask_allows "$2" "$1" || return 0
  IMPORT_SPECS="${IMPORT_IDX[$1]:-}"
  return 0
}

# 惰性构建共享导入索引与批量路径解析表
ensure_import_index() {
  [ "$IMPORT_INDEX_READY" -eq 1 ] && return 0
  IMPORT_INDEX_READY=1     # 先置位：构建过程中任何取值都不得递归重建
  local roots=() inc=() r g line file spec dir key
  for r in "${IMPORT_ROOTS[@]}"; do [ -d "$r" ] && roots+=("$r"); done
  [ "${#roots[@]}" -gt 0 ] || return 0
  for g in "${SCAN_CODE_GLOBS[@]}"; do inc+=("--include=$g"); done
  # -Z 让 grep 在文件名后输出 NUL 而不是冒号：文件名里有冒号也切不错（研究文档 §3.1
  # 记了这个边界）。-I 跳过二进制文件：改造前逐文件 grep 对二进制文件只吐一句
  # 「Binary file … matches」，它既不是包名导入也不是相对路径，取不到归属、判不了红；
  # 改造后一律不提，判定等价，且不会污染下面的奇偶行配对。
  # tr 把 NUL 换成换行，awk 按「奇数行 = 文件名 / 偶数行 = 行号:命中片段」配对，剥引号
  # 语义逐字沿用老 sed 的两条表达式（q = sprintf("%c", 39) 是单引号，为的是不把 shell
  # 的单引号串切断）。文件名里含换行的形态本就不被本闸支持（find 输出按行读，改造前同）。
  while IFS= read -r line; do
    file="${line%%$'\t'*}"
    spec="${line#*$'\t'}"
    [ -n "$file" ] && [ -n "$spec" ] || continue
    if [ -n "${IMPORT_IDX[$file]+set}" ]; then
      IMPORT_IDX[$file]+=$'\n'"$spec"
    else
      IMPORT_IDX[$file]="$spec"
    fi
    case "$spec" in
      ./*|../*)
        dir="${file%/*}"; [ -n "$dir" ] || dir="/"
        # 键用 | 分隔且不会歧义：dir 是真实目录路径（末段不含 /），spec 必以 ./ 或 ../
        # 开头，故 dir 里不可能出现「|.」这样的分隔形态。
        key="$dir|$spec"
        if [ -z "${REL_KEY_SEEN[$key]+set}" ]; then
          REL_KEY_SEEN[$key]=1
          REL_KEYS+=("$key")
          REL_PATHS+=("$dir/$spec")   # 与老形态 realpath -m "$(dirname "$file")/$spec" 同参
        fi ;;
    esac
  done < <(grep -rHnoZI --exclude-dir=generated -E "$SPEC_RE" "${inc[@]}" "${roots[@]}" 2>/dev/null \
    | tr '\0' '\n' \
    | LC_ALL=C awk -v OFS='\t' '
        BEGIN { q = sprintf("%c", 39)
                PRE = "^[a-z]+[^\"" q "]*[\"" q "]"
                POST = "[\"" q "]$" }
        NR % 2 == 1 { file = $0; next }
        { p = index($0, ":"); m = substr($0, p + 1)
          sub(PRE, "", m); sub(POST, "", m)
          if (m != "") print file, m }')
  resolve_rel_targets
}

# 解析结果 → 模块名（与改造前 target_of_relative 的 case 分支逐字同口径）
classify_resolved() { # $1 = realpath -m 的结果；写进全局 MODULE_HIT
  case "$1" in
    "$SHIELD_DIR"|"$SHIELD_DIR"/*)                   MODULE_HIT=shield ;;
    "$BACKEND"/identity|"$BACKEND"/identity/*)       MODULE_HIT=identity ;;
    "$BACKEND"/geo-dict|"$BACKEND"/geo-dict/*)       MODULE_HIT=geo-dict ;;
    "$BACKEND"/case|"$BACKEND"/case/*)               MODULE_HIT=case ;;
    "$BACKEND"/approval|"$BACKEND"/approval/*)       MODULE_HIT=approval ;;
    "$BACKEND"/supervision|"$BACKEND"/supervision/*) MODULE_HIT=supervision ;;
    "$BACKEND"/deadline|"$BACKEND"/deadline/*)       MODULE_HIT=deadline ;;
    *)                                               MODULE_HIT="" ;;
  esac
}

# 阶段 B + C：一片一次 realpath -m，输出行序与参数序一一对应，逐行对回键存进查表。
# 行数校验是跨平台保险：realpath 若不保证「一参数一行」（研究文档 §7 记 macOS 无法确认），
# 退回逐个解析，绝不静默算错。
resolve_rel_targets() {
  local total="${#REL_KEYS[@]}" off=0 want got line key
  [ "$total" -gt 0 ] || return 0
  while [ "$off" -lt "$total" ]; do
    want=$((total - off))
    [ "$want" -gt "$REALPATH_BATCH" ] && want="$REALPATH_BATCH"
    got=0
    while IFS= read -r line; do
      key="${REL_KEYS[$((off + got))]}"
      classify_resolved "$line"
      REL_TARGET["$key"]="$MODULE_HIT"
      got=$((got + 1))
    done < <(realpath -m "${REL_PATHS[@]:off:want}" 2>/dev/null)
    if [ "$got" -ne "$want" ]; then
      resolve_rel_targets_one_by_one
      return 0
    fi
    off=$((off + want))
  done
}

# 回退形态：逐键一次 realpath -m（键已去重，仍远少于改造前的逐次调用）
resolve_rel_targets_one_by_one() {
  local i resolved
  REL_TARGET=()
  for i in "${!REL_KEYS[@]}"; do
    resolved="$(realpath -m "${REL_PATHS[$i]}" 2>/dev/null)"
    classify_resolved "$resolved"
    REL_TARGET["${REL_KEYS[$i]}"]="$MODULE_HIT"
  done
}

# 文件归属（相对 ROOT 的路径 → 所在模块名；非源码返回空）：结果写进全局 HOME_OF。
# 设施包与测试装配层同列（评审必修 C5）：它们是互引的真实发起方，缺归属即在
# module-public-entry 里被 `[ -z "$HOME_OF" ] && continue` 静默跳过——光扩 find 范围不够。
home_of() {
  local rel="${1#"$ROOT"/}"
  case "$rel" in
    packages/shield/*)           HOME_OF=shield ;;
    packages/queue/*)            HOME_OF=queue ;;
    packages/storage/*)          HOME_OF=storage ;;
    backend/identity/*)          HOME_OF=identity ;;
    backend/geo-dict/*)          HOME_OF=geo-dict ;;
    backend/case/*)              HOME_OF=case ;;
    backend/approval/*)          HOME_OF=approval ;;
    backend/supervision/*)       HOME_OF=supervision ;;
    backend/deadline/*)          HOME_OF=deadline ;;
    backend/server/*)            HOME_OF=server ;;
    frontend/*)                  HOME_OF=frontend ;;
    integration/*)               HOME_OF=integration ;;
    e2e/*)                       HOME_OF=e2e ;;
    *)                           HOME_OF="" ;;
  esac
}

# 相对 specifier 的目标归属：查批量解析表 REL_TARGET（改造前是逐次 realpath -m + dirname）。
# 结果写进全局 SPEC_TARGET；无归属（仓库外或不相关）= 空串。
target_of_relative() { # $1=文件绝对路径 $2=相对 specifier
  local dir="${1%/*}"
  [ -n "$dir" ] || dir="/"
  ensure_import_index
  SPEC_TARGET="${REL_TARGET["$dir|$2"]:-}"
}

# 将 specifier 归一化为模块名（shield 或六模块之一；无关返回空）：结果写进全局 SPEC_TARGET
target_of_spec() { # $1=文件绝对路径 $2=specifier
  case "$2" in
    @natural-enforcement/*) local rest="${2#@natural-enforcement/}"; SPEC_TARGET="${rest%%/*}" ;;
    ./*|../*)               target_of_relative "$1" "$2" ;;
    *)                      SPEC_TARGET="" ;;
  esac
}

# 测试装配层豁免（评审必修 C7：扩范围与豁免必须同批，否则立刻红）
# integration 层不属于任何业务模块，它按 #47 的验收矩阵做「跨模块装配」——直接引各模块
# src 深路径与生成的 Prisma Client 是设计而非违规。书面依据：integration/tsconfig.json
# 把 ../backend/prisma/**/*.ts 纳入 include + backend/identity/src/index.ts 出口注释
# 「由 integration 层深路径装配」。
# 此前这一层完全不在扫描范围内，全仓唯一一处跨模块深路径导入正藏在里面（兜底闸的洞）。
# 豁免只覆盖 module-public-entry 一问（深路径/跨模块相对路径）；形态类规则（队列/存储设施
# 入口、弱引用入口）一律不豁免：装配层同样不得裸依赖 SDK、不得自定义跨域引用入口。
# 名单 = 文件 → 允许的 specifier 前缀（空格分隔）；名单外的深路径导入照样判红。
declare -A ASSEMBLY_EXEMPT=(
  ["integration/e2-access-matrix.test.ts"]="../backend/identity/src/"
  # #119：身份存储层唯一冲突与事务接缝①，同样在 integration 层装配 PrismaIdentityStore。
  ["integration/identity-store-unique.test.ts"]="../backend/identity/src/"
  ["integration/tx-audit-seam.test.ts"]="../backend/identity/src/"
  # #122：会话操作码清单与授权判定的等价性断言，同样直接装配 AccessControlService
  ["integration/session-opcodes.test.ts"]="../backend/identity/src/"
  # #210：参照数据种子、录入要件声明与 form-schema 接口的断言，同样直接装配三个模块的源码。
  ["integration/clue-form-schema.test.ts"]="../backend/case/src/ ../backend/geo-dict/src/ ../backend/identity/src/"
  # #217：立案（filed）路径直调案件段的提醒生成内部服务，同样直接装配 case 与 identity 的源码。
  ["integration/clue-closure.test.ts"]="../backend/case/src/ ../backend/identity/src/"
  # #235：再次进入用状态机公共出口的 nextEntrySeq 与 CaseStore.appendStageInstance。
  ["integration/case-state-machine.test.ts"]="../backend/case/src/ ../backend/identity/src/"
  # #246：期限用例用案件公共出口的 CaseStore、nextEntrySeq 与身份公共出口的 newUlid。与 #235 同口径。
  # L1 判据：法审期限的期望值取期限公共出口的 findDeadlineRule，不手抄数值。
  ["integration/case-deadline.test.ts"]="../backend/case/src/ ../backend/identity/src/ ../backend/deadline/src/"
  # #238：退回用例只用身份公共出口 index.ts 的 newUlid。与 #235 同口径。
  ["integration/case-return.test.ts"]="../backend/identity/src/index.ts"
  # #239：改派用例只用身份公共出口 index.ts 的 newUlid。与 #238 同口径。
  ["integration/case-reassign.test.ts"]="../backend/identity/src/index.ts"
  # #272：告知／听证用例用期限公共出口的 DEADLINE_RULE_VERSION 断言期限规则版本。
  ["integration/notice-hearing.test.ts"]="../backend/deadline/src/index.ts"
  # #248：有效性用例只用身份公共出口 index.ts 的 newUlid。与 #238 同口径。
  ["integration/case-validity.test.ts"]="../backend/identity/src/index.ts"
  # 集成层共用的技术主键生成（#16 §1.1 ULID）：收敛 22 个测试文件各自复制的本地实现，
  # 生成器本体只在 identity 一处维护，本文件只做再出口。与 #238 同口径。
  ["integration/ulid-helpers.ts"]="../backend/identity/src/index.ts"
  # 验证资产迁入 e2e/verify（2026-11-10）：图层协议自检用产品里的图层适配器直连假图层服务，
  # 证明假服务与真实服务说同一协议。它由宿主 node 直接运行，不经 esbuild：case 公共出口
  # 会连带加载 case.module.ts 的装饰器，原生 node 解析失败，故只能直引这两个无装饰器文件。
  # 与 integration 层同属测试装配，豁免只放行这两个文件本身。
  ["e2e/verify/harness/layers/protocol-self-check.mjs"]="../../../../backend/case/src/clue/verification/layer-service-port.ts ../../../../backend/case/src/clue/verification/layers.ts"
)

# 判断装配层豁免名单是否放行该 specifier
is_assembly_exempt() { # $1 = 相对 ROOT 路径, $2 = specifier
  local rel="$1" spec="$2" prefix
  local allowed="${ASSEMBLY_EXEMPT[$rel]:-}"
  local -a prefixes=()
  [ -n "$allowed" ] || return 1
  read -r -a prefixes <<< "$allowed"   # 用 read 拆分：不做 glob 展开
  for prefix in "${prefixes[@]}"; do
    case "$spec" in "$prefix"*) return 0 ;; esac
  done
  return 1
}

# 矩阵行规则：某模块的引用不得超出允许列（表外依赖即失败）
check_row() { # $1=模块名
  local mod="$1" dir file spec target home fails=0 specs
  local allowed=" ${ALLOW[$mod]} "
  dir="$ROOT/${MOD_DIR[$mod]}"
  # 模块目录缺失判绿（语义上的空真）：直接 return，不进索引循环——#168 改造项 3 护栏
  # 要求这条语义与 g1-model-allowlist 的 schema 缺失判绿、runtime-manifest 的清单文件
  # 缺失判红三者分别保留，不统一化。
  [ -d "$dir" ] || { note_ok "$mod-deps：模块目录尚不存在（空行，无表外依赖）"; return; }
  while IFS= read -r file; do
    home="$mod"
    import_specs_of "$file" ts      # 掩码 = SCAN_TS（与下面 find 的掩码同源）
    specs="$IMPORT_SPECS"
    [ -n "$specs" ] || continue
    while IFS= read -r spec; do
      target_of_spec "$file" "$spec"
      target="$SPEC_TARGET"
      [ -z "$target" ] && continue
      [ "$target" = "$home" ] && continue
      case "$allowed" in
        *" $target "*)
          # 允许列内：只允许公共出口形态，深路径/相对路径由 module-public-entry 另行裁决
          case "$spec" in
            @natural-enforcement/*/*|../*)
              note_fail "$mod-deps：表内依赖形态违规 ${file#"$ROOT"/} → $spec（只许公共出口 @natural-enforcement/$target 根导入）"
              fails=$((fails + 1)) ;;
          esac ;;
        *)
          note_fail "$mod-deps：表外依赖 ${file#"$ROOT"/} → $spec（允许列：$(echo "$allowed" | xargs)）"
          fails=$((fails + 1)) ;;
      esac
    done <<< "$specs"
  done < <(find "$dir" "${SCAN_TS[@]}")
  if [ "$fails" -eq 0 ]; then
    note_ok "$mod-deps：依赖未超出允许列（$(echo "$allowed" | xargs)）"
  fi
}

# 规则 a（#50 并入）：shield 公共出口唯一
check_shield-single-entry() {
  local hits=0 line file where spec
  while IFS= read -r line; do
    file="${line%%:*}"
    where="${line#*:}"; where="${where%%:*}"
    spec="${line#*:*:}"
    spec="${spec#?}"; spec="${spec%?}" # 去首尾引号
    case "$spec" in
      packages/shield/src/index|packages/shield/src/index.js|packages/shield/src/index.ts) continue ;;
      @natural-enforcement/shield/src/index.ts|@natural-enforcement/shield/src/index.js) continue ;;
    esac
    note_fail "shield-single-entry：绕过公共出口的引用  ${file#"$ROOT"/}:$where → $spec"
    hits=$((hits + 1))
  done < <(grep -rEno --include='*.ts' --include='*.tsx' --include='*.mts' --include='*.cts' \
      --include='*.js' --include='*.jsx' --include='*.mjs' --include='*.cjs' \
      -e "['\"]shield/[^'\"]*['\"]" \
      -e "['\"]@natural-enforcement/shield/[^'\"]*['\"]" \
      -e "['\"][^'\"]*packages/shield/src/[^'\"]*['\"]" \
      "$ROOT/backend" "$ROOT/frontend" "$ROOT/e2e" "$ROOT/packages" 2>/dev/null)
  if [ "$hits" -eq 0 ]; then
    note_ok "shield-single-entry：shield 之外无绕过 src/index.ts 的引用"
  fi
}

# 规则 b：shield 不依赖任何业务模块（矩阵 shield 行）
check_shield-no-business-dep() {
  local file spec target fails=0 specs
  while IFS= read -r file; do
    import_specs_of "$file" ts      # 掩码 = SCAN_TS（与下面 find 的掩码同源）
    specs="$IMPORT_SPECS"
    [ -n "$specs" ] || continue
    while IFS= read -r spec; do
      target_of_spec "$file" "$spec"
      target="$SPEC_TARGET"
      if [ -n "$target" ] && [ "$target" != "shield" ]; then
        note_fail "shield-no-business-dep：shield 依赖业务模块 ${file#"$ROOT"/} → $spec"
        fails=$((fails + 1))
      fi
    done <<< "$specs"
  done < <(find "$SHIELD_DIR" "${SCAN_TS[@]}")
  if [ "$fails" -eq 0 ]; then
    note_ok "shield-no-business-dep：shield 不依赖任何业务模块"
  fi
}

# 执行本函数的规则扫描与判定
check_identity-deps()    { check_row identity; }
# 依赖矩阵行：geo-dict 不依赖任何业务模块
check_geo-dict-deps()    { check_row geo-dict; }
# 依赖矩阵行：case 只许 → shield、identity、geo-dict
check_case-deps()        { check_row case; }
# 依赖矩阵行：approval 只许 → shield、identity、case
check_approval-deps()    { check_row approval; }
# 依赖矩阵行：supervision 只许 → shield、identity、case
check_supervision-deps() { check_row supervision; }
# 依赖矩阵行：deadline 只许 → shield、case、approval、geo-dict
check_deadline-deps()    { check_row deadline; }

# 规则 i：矩阵行「监督统计（只读，单向，无人依赖它）」的反向断言
# 扫描范围含 e2e（评审必修 C5）：本规则断言的是「无人」，范围漏一处即断言不成立；
# e2e 用例形态是 .sh/.cjs，故用 SCAN_CODE 而非 SCAN_TS。
# ADR 0004：server 启动包不是业务模块，允许经公共出口引用全部六个模块，包括监督统计。
check_supervision-sink() {
  local file spec target home fails=0 specs
  while IFS= read -r file; do
    home_of "$file"
    home="$HOME_OF"
    [ "$home" = "supervision" ] && continue
    [ "$home" = "server" ] && continue
    import_specs_of "$file" code    # 掩码 = SCAN_CODE（与下面 find 的掩码同源）
    specs="$IMPORT_SPECS"
    [ -n "$specs" ] || continue
    while IFS= read -r spec; do
      target_of_spec "$file" "$spec"
      target="$SPEC_TARGET"
      if [ "$target" = "supervision" ]; then
        note_fail "supervision-sink：${file#"$ROOT"/} 依赖了单向模块 supervision（→ $spec）"
        fails=$((fails + 1))
      fi
    done <<< "$specs"
  done < <(find "$BACKEND" "$ROOT/frontend" "$ROOT/e2e" "${SCAN_CODE[@]}")
  if [ "$fails" -eq 0 ]; then
    note_ok "supervision-sink：业务模块无人依赖 supervision（server 启动包除外，ADR 0004）"
  fi
}

# 规则 j：backend/frontend/e2e/integration 互引模块只许公共出口——@natural-enforcement/<mod>/<深路径>
# 与跨模块相对路径一律拦截（往来形态 = 只读查询 + 事件，经公共出口表达；默认禁止直写）。
# 评审必修 C7：纳入 integration 层（此前全不在范围内，全仓唯一一处跨模块深路径导入正藏在
# 那里）+ 脚本形态（.mjs/.cjs/.sh）；测试装配层豁免见 ASSEMBLY_EXEMPT，与扩范围同批落地。
check_module-public-entry() {
  local file spec target home fails=0 specs
  while IFS= read -r file; do
    home_of "$file"
    home="$HOME_OF"
    # home_of 对 backend/prisma/prisma7.config.ts 与 backend/prisma/seed.mjs 返回空串，
    # 这两个文件完全不参与本规则判定（研究文档 §2.2）：共享索引化后这条「按文件跳过」
    # 语义必须原样保留，否则 backend/prisma/ 里的导入会变成新违规。
    [ -z "$home" ] && continue
    import_specs_of "$file" code    # 掩码 = SCAN_CODE（与下面 find 的掩码同源）
    specs="$IMPORT_SPECS"
    [ -n "$specs" ] || continue
    while IFS= read -r spec; do
      is_assembly_exempt "${file#"$ROOT"/}" "$spec" && continue
      if [ "${file#"$ROOT"/}" = "$SERVER_ADAPTER_FILE" ] && is_server_adapter_spec "$spec"; then
        continue
      fi
      case "$spec" in
        @natural-enforcement/*/*)
          note_fail "module-public-entry：内部路径导入 ${file#"$ROOT"/} → $spec（只许 @natural-enforcement/<module> 公共出口）"
          fails=$((fails + 1)) ;;
        ./*|../*)
          target_of_relative "$file" "$spec"
          target="$SPEC_TARGET"
          if [ -n "$target" ] && [ "$target" != "$home" ]; then
            note_fail "module-public-entry：跨模块相对路径 ${file#"$ROOT"/} → $spec（归属 $target；只许经其公共出口）"
            fails=$((fails + 1))
          fi ;;
      esac
    done <<< "$specs"
  done < <(find "$BACKEND" "$ROOT/frontend" "$ROOT/e2e" "$ROOT/integration" "${SCAN_CODE[@]}")
  if [ "$fails" -eq 0 ]; then
    note_ok "module-public-entry：模块互引均经公共出口（无内部路径/跨模块相对路径）"
  fi
}

# 规则 k：前端不直连库、不依赖 backend 内部路径。
# 评审必修（死规则修活）：此前复用 specifiers_of，而它只提取 @natural-enforcement/* 与
# 相对路径，case 里的 pg|ioredis|@prisma/client|… 永远取不到 → 规则恒绿。改为自带
# specifier 提取（同 queue/storage 设施入口规则的形态），并把「相对路径拐进 backend/」
# 一并纳入——前端经 ../../backend/… 拿 Prisma Client 同样是直连库。
check_frontend-boundary() {
  local file spec fails=0
  while IFS= read -r file; do
    while IFS= read -r spec; do
      note_fail "frontend-boundary：前端直连库/后端内部 ${file#"$ROOT"/} → $spec（前端只许 shield + 各模块公共出口的查询接口，数据一律经面板快照）"
      fails=$((fails + 1))
    done < <(grep -oE "\b(from|import|require)[^'\"]{0,40}['\"](pg|ioredis|bullmq|@prisma/[^'\"]*|rustfs[^'\"]*|@aws-sdk/[^'\"]*|@smithy/[^'\"]*|(backend|infra)/[^'\"]*|\.{1,2}/(backend|infra)/[^'\"]*)['\"]" \
        "$file" 2>/dev/null | sed -E "s/^[a-z]+[^'\"]*['\"]//; s/['\"]$//")
  done < <(find "$ROOT/frontend" "${SCAN_CODE[@]}")
  if [ "$fails" -eq 0 ]; then
    note_ok "frontend-boundary：前端无直连库/后端内部路径引用"
  fi
}

# 规则 l：跨域弱引用（标识 + 冻结快照，#45 澄清）只许经 shield 的 requireCrossDomainReference
# 入口——业务代码中出现该入口名的文件必须经 'shield' 导入，且不得自行定义同名入口
check_weak-reference-entry() {
  local file fails=0 imported=0
  while IFS= read -r file; do
    case "$file" in
      "$SHIELD_DIR"/*) continue ;;
    esac
    imported=0
    while IFS= read -r spec; do
      case "$spec" in
        shield|@natural-enforcement/shield) imported=1 ;;
      esac
    done < <(specifiers_of "$file")
    if grep -Eq '\b(function|const|class)\s+requireCrossDomainReference' "$file"; then
      note_fail "weak-reference-entry：${file#"$ROOT"/} 自行定义 requireCrossDomainReference（只许经 shield 入口）"
      fails=$((fails + 1))
    elif [ "$imported" -eq 0 ]; then
      note_fail "weak-reference-entry：${file#"$ROOT"/} 出现跨域弱引用入口名但未从 shield 导入"
      fails=$((fails + 1))
    fi
  done < <(grep -rlE 'requireCrossDomainReference' "$BACKEND" "$ROOT/frontend" "$ROOT/e2e" "$ROOT/integration" \
      --include='*.ts' --include='*.tsx' --include='*.mts' --include='*.cts' \
      --include='*.mjs' --include='*.cjs' --include='*.sh' 2>/dev/null)
  if [ "$fails" -eq 0 ]; then
    note_ok "weak-reference-entry：跨域弱引用均经 shield requireCrossDomainReference 入口"
  fi
}

# 规则 p（评审必修，承接 #52 AC4「G1 由结构测试兜底」）：地基不含业务实体（#47 G1），
# 机检形态 = schema.prisma 的 model 名白名单。白名单外新增即红 = 逼建表动作回到
# #47/#16 定案票（G1 不可扩大条件：#47 明文「CI 结构测试与评审是缺口不扩大的两道闸」），
# 白名单内实体缺席同样即红——名单与实际模型必须逐字相等，防止名单腐化成摆设。
# #69 定案追加 AuthSession、AuthRememberMe。分表理由与字段见 schema.prisma 与
# backend/README.md「认证记录」。寿命、Cookie、并发与结束条件以 #63 为准，不在此重开。
# #92 定案追加 Role、Permission、RolePermission、PersonnelRole、AuditTrail。
# #96 去掉人员表旧 role 列。字段见 schema.prisma 与 backend/README.md「权限与留痕」。
# #128（#105 岗位标记 A1）追加 PersonnelPost，记入 PR 供 #47 G1 定案。
# #75 定案追加 PersonnelPasswordHistory（ADR 0015）。
# #210 定案追加五张参照数据表（ADR 0016）：GeoDictSourceCode、GeoDictViolationType、
# GeoDictDocument、GeoDictViolationTypeBasis、GeoDictJurisdiction。
# #211 定案追加 18 张线索业务表（规格 F）：Clue、ClueSpatialObject、ClueSpatialPart、
# ClueRequirementSnapshot、ClueItemValue、ClueItemGap、ClueInitialType、ClueTagLibrary、
# ClueTag、ClueMaterial、ClueSpatialHit、ClueVerificationRun、ClueHandler、ClueAssignment、
# ClueWithdrawal、ClueDisposition、ClueClosureReminder、ClueExternalTransfer（#229）、ClueDesignationRequest、StorageObjectQuarantine（#224）、SecrecyReportTicket（#225）。
# #234 追加立案呈批与案件最小模型六张表（#27 T01／T02、#16）：FilingApproval、FilingApprovalVersion、
# FilingApprovalStep、CaseRecord、CaseSourceClue、CaseHandler。
# #235 追加环节实例、迁移历史、审批链：CaseStageInstance、CaseTransition、CaseApprovalChain。
# #237 追加人员层利害关系、回避决定、调查继续登记：PersonConflictEvent、
# PersonConflictDecision、CaseInvestigationEntry。
# #263 追加机关层利害关系勾选：CaseAgencyConflict。
# #238 追加审批意见、退回记录、环节失效、签字、材料：CaseApprovalOpinion、CaseReturn、
# CaseStageInvalidation、CaseStageSignature、CaseMaterial。
# #236 追加违法记录、笔录、收尾呈批、期限事件与告知记录：CaseViolationRecord、CaseInquiryRecord、
# CaseProcedureApproval、CaseProcedureVersion、CaseProcedureStep、CaseDeadlineEvent、CasePartyNotice。
# #246 追加期限行、期间事件、期限呈批与后装工作日历：CaseDeadlineRow、CasePeriodEvent、
# CaseDeadlineApproval、CaseDeadlineApprovalVersion、CaseDeadlineApprovalStep、DeadlineCalendarInstall。
# #271 追加新旧比对判定：CaseComparisonJudgment。
# #239 追加改派呈批与材料效力认定：CaseReassignment、CaseMaterialEffectiveness。
# #269 追加法审轮次、法审意见、集体讨论勾选与记录（#256 §5 E07／E08）：CaseLegalReview、
# CaseLegalReviewOpinion、CaseDiscussionMark、CaseDiscussionRecord。
G1_MODELS=(
  MigrationProbe
  OrgUnit
  OrgUnitNameVersion
  Personnel
  PersonnelNameVersion
  PersonnelAssignment
  ExportAudit
  AuthSession
  AuthRememberMe
  Role
  Permission
  RolePermission
  PersonnelRole
  PersonnelPost
  AuditTrail
  PersonnelPasswordHistory
  GeoDictLandBoundary
  GeoDictSurveyPoint
  GeoDictSourceCode
  GeoDictViolationType
  GeoDictDocument
  GeoDictViolationTypeBasis
  GeoDictJurisdiction
  Clue
  ClueSpatialObject
  ClueSpatialPart
  ClueRequirementSnapshot
  ClueItemValue
  ClueItemGap
  ClueInitialType
  ClueTagLibrary
  ClueTag
  ClueMaterial
  ClueSpatialHit
  ClueVerificationRun
  ClueHandler
  ClueAssignment
  ClueWithdrawal
  ClueDisposition
  ClueClosureReminder
  ClueExternalTransfer
  ClueDesignationRequest
  StorageObjectQuarantine
  SecrecyReportTicket
  FilingApproval
  FilingApprovalVersion
  FilingApprovalStep
  CaseRecord
  CaseSourceClue
  CaseHandler
  CaseStageInstance
  CaseTransition
  CaseApprovalChain
  PersonConflictEvent
  PersonConflictDecision
  CaseInvestigationEntry
  CaseAgencyConflict
  CaseApprovalOpinion
  CaseReturn
  CaseStageInvalidation
  CaseStageSignature
  CaseMaterial
  CaseViolationRecord
  CaseInquiryRecord
  CaseProcedureApproval
  CaseProcedureVersion
  CaseProcedureStep
  CaseDeadlineEvent
  CasePartyNotice
  CaseDeadlineRow
  CasePeriodEvent
  CaseDeadlineApproval
  CaseDeadlineApprovalVersion
  CaseDeadlineApprovalStep
  DeadlineCalendarInstall
  CaseComparisonJudgment
  CaseReassignment
  CaseMaterialEffectiveness
  CaseReviewReport
  CaseReviewReportVersion
  CaseReviewReportStep
  CaseReviewerDesignation
  CaseReviewOpinion
  CaseFrozenDecision
  CaseReviewObjection
  CaseReviewObjectionWindow
  CaseMarker
  CaseNotice
  CaseNoticeVersion
  CaseNoticeStep
  CaseNoticeValidityBaseline
  CaseValidityConfirmation
  CaseValidityReview
  CasePartySubmission
  CaseHearing
  CaseLegalReview
  CaseLegalReviewOpinion
  CaseDiscussionMark
  CaseDiscussionRecord
  CaseTransferApproval
  CaseTransferApprovalVersion
  CaseTransferApprovalStep
  CaseTransfer
  CaseTransferFile
  CaseCriminalDecision
  CaseCriminalOutlet
  CaseCriminalOutletStep
  CaseDossierMaterial
  CaseFinalizeApproval
  CaseFinalizeApprovalVersion
  CaseFinalizeApprovalStep
  CaseFinalize
  CaseDecisionApproval
  CaseDecisionApprovalVersion
  CaseDecisionApprovalStep
  CaseDelivery
  CaseExecutionRecord
  CaseClosureApproval
  CaseClosureApprovalVersion
  CaseClosureApprovalStep
  CaseClosure
)
# 执行本函数的规则扫描与判定
check_g1-model-allowlist() {
  local schema="$BACKEND/prisma/schema.prisma" model in_schema extra missing fails=0
  if [ ! -f "$schema" ]; then
    note_ok "g1-model-allowlist：schema.prisma 不在场（无模型 = 无 G1 越界）"
    return
  fi
  in_schema="$(grep -oE '^[[:space:]]*model [A-Za-z][A-Za-z0-9_]*' "$schema" | awk '{print $NF}' | sort -u)"
  extra=""
  while IFS= read -r model; do
    [ -z "$model" ] && continue
    case " ${G1_MODELS[*]} " in
      *" $model "*) ;;
      *) extra="$extra $model" ;;
    esac
  done <<< "$in_schema"
  if [ -n "$extra" ]; then
    note_fail "g1-model-allowlist：${schema#"$ROOT"/} 出现白名单外 model：$(echo "$extra" | xargs)（#47 G1 地基不含业务实体；新增表须回定案票，不得自行放宽）"
    fails=$((fails + 1))
  fi
  missing=""
  for model in "${G1_MODELS[@]}"; do
    grep -qx -- "$model" <<< "$in_schema" || missing="$missing $model"
  done
  if [ -n "$missing" ]; then
    note_fail "g1-model-allowlist：白名单与实际 model 不符，名单内实体缺席：$(echo "$missing" | xargs)（改表须同步名单并回 #47 留痕）"
    fails=$((fails + 1))
  fi
  if [ "$fails" -eq 0 ]; then
    note_ok "g1-model-allowlist：${schema#"$ROOT"/} 的 model 与 G1 白名单逐字相等（${#G1_MODELS[@]} 项，无业务实体越界）"
  fi
}

# 规则 m（#55 并入）：队列设施唯一入口——bullmq/ioredis 只许出现在 packages/queue。
# backend/frontend/e2e/integration/shield 出现裸队列依赖即失败：业务 worker 归各业务切片自带
#（G5），队列一律经 QueuePort 抽象注入，结构测试兜底防绕过。
# 评审必修 C7：范围补 integration 层与脚本形态（.mjs/.cjs/.sh + require 同权）。
check_queue-facility-entry() {
  local file spec fails=0
  while IFS= read -r file; do
    case "$file" in
      "$QUEUE_DIR"/*) continue ;; # 设施包自身豁免
    esac
    while IFS= read -r spec; do
      case "$spec" in
        bullmq|bullmq/*|ioredis|ioredis/*)
          note_fail "queue-facility-entry：${file#"$ROOT"/} 裸依赖 $spec（队列设施唯一入口 = packages/queue；业务侧只许经 QUEUE_PORT 注入，G5）"
          fails=$((fails + 1)) ;;
      esac
    done < <(grep -oE "\b(from|import|require)[^'\"]{0,40}['\"](bullmq|ioredis)(/[^'\"]*)?['\"]" \
        "$file" 2>/dev/null | sed -E "s/^[a-z]+[^'\"]*['\"]//; s/['\"]$//")
  done < <(find "$BACKEND" "$ROOT/frontend" "$ROOT/e2e" "$ROOT/integration" "$SHIELD_DIR" "${SCAN_CODE[@]}")
  if [ "$fails" -eq 0 ]; then
    note_ok "queue-facility-entry：bullmq/ioredis 仅在队列设施包内（业务侧无裸队列依赖，G5 机器兜底）"
  fi
}

# 规则 n（#53 并入）：存储设施唯一入口——S3/RustFS SDK（@aws-sdk/*、@smithy/*、
# minio、rustfs）只许出现在 packages/storage。业务侧绕过 StoragePort 追加式抽象直连
# 存储 = 在包外获得原地修改/删除通道，append-only 最保守语义被架空；
# 本包以零新增第三方依赖落实该纪律（S3 REST/SigV4 基于 node:crypto + fetch 自实现），
# 本规则防后续切片引入 SDK 时漂移出设施包。
check_storage-facility-entry() {
  local file spec fails=0
  while IFS= read -r file; do
    case "$file" in
      "$STORAGE_DIR"/*) continue ;; # 设施包自身豁免
    esac
    while IFS= read -r spec; do
      case "$spec" in
        @aws-sdk/*|@smithy/*|minio|minio/*|rustfs|rustfs/*)
          note_fail "storage-facility-entry：${file#"$ROOT"/} 裸依赖 $spec（存储设施唯一入口 = packages/storage；业务侧只许经 STORAGE_PORT 注入）"
          fails=$((fails + 1)) ;;
      esac
    done < <(grep -oE "\b(from|import|require)[^'\"]{0,40}['\"](@aws-sdk/[^'\"]*|@smithy/[^'\"]*|minio(/[^'\"]*)?|rustfs(/[^'\"]*)?)['\"]" \
        "$file" 2>/dev/null | sed -E "s/^[a-z]+[^'\"]*['\"]//; s/['\"]$//")
  done < <(find "$BACKEND" "$ROOT/frontend" "$ROOT/e2e" "$ROOT/integration" "$SHIELD_DIR" "$QUEUE_DIR" "${SCAN_CODE[@]}")
  if [ "$fails" -eq 0 ]; then
    note_ok "storage-facility-entry：S3/RustFS SDK 仅在存储设施包内（业务侧无裸存储依赖，append-only 机器兜底）"
  fi
}

# 规则：留痕设施唯一入口。auditTrail 委托只许出现在 packages/audit。
# 包外任何引用都判红，包括读取。测试观察留痕行时走表名，不走这个委托。
check_audit-facility-entry() {
  local hits=0 file
  while IFS= read -r file; do
    case "$file" in
      "$AUDIT_DIR"/*) continue ;;
    esac
    if grep -qE '(^|[^A-Za-z0-9_])auditTrail([^A-Za-z0-9_]|$)' "$file"; then
      note_fail "audit-facility-entry：${file#"$ROOT"/} 引用了 auditTrail Prisma 委托（留痕只许经 @natural-enforcement/audit 追加）"
      hits=$((hits + 1))
    fi
  done < <(find "$BACKEND" "$ROOT/packages" "$ROOT/frontend" "$ROOT/e2e" "$ROOT/integration" "${SCAN_CODE[@]}")
  if [ "$hits" -eq 0 ]; then
    note_ok "audit-facility-entry：auditTrail 委托仅在留痕设施包内（包外无直接引用）"
  fi
}

# 规则 o（评审必修扩口径）：空间纪律机器兜底——backend/、packages/、integration/、e2e/
# 全源码不得对空间模型 delegate 调任何 ORM 写。含必填 Unsupported 空间字段的模型走
# ORM 写会绕过 ST_Transform 统一口径（infra/VERSIONS.md 执行纪律 2），写一律 $queryRaw/ST_ 函数。
# 扩口径三处：① 方法集补全（create/update 之外的 upsert/createMany/updateMany/
# delete/deleteMany 同样是 ORM 写）；② 文件形态 = SCAN_CODE（.mjs/.cjs 种子与校验器、
# .sh 用例内联 node 都能拿到 delegate）；③ 换行链式（prisma.geoDictLandBoundary 换行
# .create(）折行后二次判定，单行已命中的文件不重复报。
# #211 扩口径：线索空间三表归 case 模块（规格 F），其中 clueSpatialPart（含 Unsupported
# 空间字段）与 clueSpatialHit（命中集经空间函数算出）同样禁 ORM 写。
SPATIAL_MODEL='geoDictLandBoundary|geoDictSurveyPoint|clueSpatialPart|clueSpatialHit'
SPATIAL_ORM_METHOD='createManyAndReturn|createMany|create|upsert|updateMany|update|deleteMany|delete'
SPATIAL_ORM_WRITE="(${SPATIAL_MODEL})[[:space:]]*\.[[:space:]]*(${SPATIAL_ORM_METHOD})[[:space:]]*\("
# 执行本函数的规则扫描与判定
check_spatial-no-orm-mutation() {
  local hits=0 file lines line
  while IFS= read -r file; do
    lines="$(grep -En -e "$SPATIAL_ORM_WRITE" "$file" 2>/dev/null)"
    if [ -n "$lines" ]; then
      while IFS= read -r line; do
        note_fail "spatial-no-orm-mutation：空间模型 ORM 写调用 ${file#"$ROOT"/}:${line%%:*}（含必填空间字段禁用 ORM 写，执行纪律 2；写一律 \$queryRaw/ST_ 函数）"
        hits=$((hits + 1))
      done <<< "$lines"
      continue
    fi
    if tr '\n' ' ' < "$file" | grep -qE "$SPATIAL_ORM_WRITE"; then
      note_fail "spatial-no-orm-mutation：${file#"$ROOT"/} 折行后检出空间模型 ORM 写（换行链式形态）"
      hits=$((hits + 1))
    fi
  done < <(find "$BACKEND" "$ROOT/packages" "$ROOT/integration" "$ROOT/e2e" "${SCAN_CODE[@]}")
  if [ "$hits" -eq 0 ]; then
    note_ok "spatial-no-orm-mutation：backend + packages + integration + e2e 全源码无空间模型 ORM 写调用（执行纪律 2 机器兜底）"
  fi
}

# 规则（#210 新增）：参照数据只追加的机器兜底——五张参照数据表（ADR 0016）的 delegate
# 只许 insert（create/createMany），不许 update / updateMany / delete / deleteMany / upsert。
# 库层触发器已拒 UPDATE 与 DELETE（reject_row_mutation），本规则补的是应用层那一道：
# 改参照数据只能追加新版本，不许就地改行、不许删行、不许 upsert 顶掉旧版本。
# 形态与 spatial-no-orm-mutation 同款：SCAN_CODE 范围 + 换行链式二次判定。
REFERENCE_MODEL='geoDictSourceCode|geoDictViolationType|geoDictDocument|geoDictViolationTypeBasis|geoDictJurisdiction'
REFERENCE_ORM_METHOD='upsert|updateMany|update|deleteMany|delete'
REFERENCE_ORM_WRITE="(${REFERENCE_MODEL})[[:space:]]*\.[[:space:]]*(${REFERENCE_ORM_METHOD})[[:space:]]*\("
# 执行本函数的规则扫描与判定
check_reference-data-no-mutation() {
  local hits=0 file lines line
  while IFS= read -r file; do
    lines="$(grep -En -e "$REFERENCE_ORM_WRITE" "$file" 2>/dev/null)"
    if [ -n "$lines" ]; then
      while IFS= read -r line; do
        note_fail "reference-data-no-mutation：参照数据表 ORM 改写调用 ${file#"$ROOT"/}:${line%%:*}（ADR 0016 只追加：改参照数据＝追加新版本，不许就地改行或删行）"
        hits=$((hits + 1))
      done <<< "$lines"
      continue
    fi
    if tr '\n' ' ' < "$file" | grep -qE "$REFERENCE_ORM_WRITE"; then
      note_fail "reference-data-no-mutation：${file#"$ROOT"/} 折行后检出参照数据表 ORM 改写（换行链式形态）"
      hits=$((hits + 1))
    fi
  done < <(find "$BACKEND" "$ROOT/packages" "$ROOT/integration" "$ROOT/e2e" "${SCAN_CODE[@]}")
  if [ "$hits" -eq 0 ]; then
    note_ok "reference-data-no-mutation：backend + packages + integration + e2e 全源码无参照数据表 ORM 改写调用（ADR 0016 只追加）"
  fi
}

# 规则（#235）：环节实例与迁移历史只追加。delegate 只许 create，不许 update／delete／upsert。
# 库层触发器 reject_row_mutation 拒 UPDATE 与 DELETE。本规则补应用层那一道。
# 审批链不在此列：进行中与办结允许以后改状态。
CASE_HISTORY_MODEL='caseStageInstance|caseTransition'
CASE_HISTORY_ORM_METHOD='upsert|updateMany|update|deleteMany|delete'
CASE_HISTORY_ORM_WRITE="(${CASE_HISTORY_MODEL})[[:space:]]*\.[[:space:]]*(${CASE_HISTORY_ORM_METHOD})[[:space:]]*\("
# 执行本函数的规则扫描与判定
check_case-history-append-only() {
  local hits=0 file lines line
  while IFS= read -r file; do
    lines="$(grep -En -e "$CASE_HISTORY_ORM_WRITE" "$file" 2>/dev/null)"
    if [ -n "$lines" ]; then
      while IFS= read -r line; do
        note_fail "case-history-append-only：环节实例或迁移历史 ORM 改写调用 ${file#"$ROOT"/}:${line%%:*}（#235 只追加：再次进入写新行，不许就地改行或删行）"
        hits=$((hits + 1))
      done <<< "$lines"
      continue
    fi
    if tr '\n' ' ' < "$file" | grep -qE "$CASE_HISTORY_ORM_WRITE"; then
      note_fail "case-history-append-only：${file#"$ROOT"/} 折行后检出环节实例或迁移历史 ORM 改写（换行链式形态）"
      hits=$((hits + 1))
    fi
  done < <(find "$BACKEND" "$ROOT/packages" "$ROOT/integration" "$ROOT/e2e" "${SCAN_CODE[@]}")
  if [ "$hits" -eq 0 ]; then
    note_ok "case-history-append-only：backend + packages + integration + e2e 全源码无环节实例或迁移历史 ORM 改写调用（#235 只追加）"
  fi
}

# 规则（#237）：人员层利害关系、回避决定、调查继续登记只追加。
# delegate 只许 create，不许 update／delete／upsert。库层触发器拒 UPDATE 与 DELETE。
PERSON_CONFLICT_MODEL='personConflictEvent|personConflictDecision|caseInvestigationEntry'
PERSON_CONFLICT_ORM_METHOD='upsert|updateMany|update|deleteMany|delete'
PERSON_CONFLICT_ORM_WRITE="(${PERSON_CONFLICT_MODEL})[[:space:]]*\.[[:space:]]*(${PERSON_CONFLICT_ORM_METHOD})[[:space:]]*\("
# 执行本函数的规则扫描与判定
check_person-conflict-append-only() {
  local hits=0 file lines line
  while IFS= read -r file; do
    lines="$(grep -En -e "$PERSON_CONFLICT_ORM_WRITE" "$file" 2>/dev/null)"
    if [ -n "$lines" ]; then
      while IFS= read -r line; do
        note_fail "person-conflict-append-only：人员层利害关系或调查登记 ORM 改写调用 ${file#"$ROOT"/}:${line%%:*}（#237 只追加：状态变化写新行，不许就地改行或删行）"
        hits=$((hits + 1))
      done <<< "$lines"
      continue
    fi
    if tr '\n' ' ' < "$file" | grep -qE "$PERSON_CONFLICT_ORM_WRITE"; then
      note_fail "person-conflict-append-only：${file#"$ROOT"/} 折行后检出人员层利害关系或调查登记 ORM 改写（换行链式形态）"
      hits=$((hits + 1))
    fi
  done < <(find "$BACKEND" "$ROOT/packages" "$ROOT/integration" "$ROOT/e2e" "${SCAN_CODE[@]}")
  if [ "$hits" -eq 0 ]; then
    note_ok "person-conflict-append-only：backend + packages + integration + e2e 全源码无人员层利害关系或调查登记 ORM 改写调用（#237 只追加）"
  fi
}

# 规则（#263）：机关层利害关系勾选只追加。delegate 只许 create，不许 update／delete／upsert。
# 库层触发器拒 UPDATE 与 DELETE。取消勾选不改行。
AGENCY_CONFLICT_MODEL='caseAgencyConflict'
AGENCY_CONFLICT_ORM_METHOD='upsert|updateMany|update|deleteMany|delete'
AGENCY_CONFLICT_ORM_WRITE="(${AGENCY_CONFLICT_MODEL})[[:space:]]*\.[[:space:]]*(${AGENCY_CONFLICT_ORM_METHOD})[[:space:]]*\("
# 执行本函数的规则扫描与判定
check_agency-conflict-append-only() {
  local hits=0 file lines line
  while IFS= read -r file; do
    lines="$(grep -En -e "$AGENCY_CONFLICT_ORM_WRITE" "$file" 2>/dev/null)"
    if [ -n "$lines" ]; then
      while IFS= read -r line; do
        note_fail "agency-conflict-append-only：机关层利害关系 ORM 改写调用 ${file#"$ROOT"/}:${line%%:*}（#263 只追加：不许就地改行或删行）"
        hits=$((hits + 1))
      done <<< "$lines"
      continue
    fi
    if tr '\n' ' ' < "$file" | grep -qE "$AGENCY_CONFLICT_ORM_WRITE"; then
      note_fail "agency-conflict-append-only：${file#"$ROOT"/} 折行后检出机关层利害关系 ORM 改写（换行链式形态）"
      hits=$((hits + 1))
    fi
  done < <(find "$BACKEND" "$ROOT/packages" "$ROOT/integration" "$ROOT/e2e" "${SCAN_CODE[@]}")
  if [ "$hits" -eq 0 ]; then
    note_ok "agency-conflict-append-only：backend + packages + integration + e2e 全源码无机关层利害关系 ORM 改写调用（#263 只追加）"
  fi
}

# 规则（#236）：违法记录与笔录不物理删除。作废只改状态。ORM delete 与 SQL DELETE FROM 都拒绝。
INVESTIGATION_RECORD_MODEL='caseViolationRecord|caseInquiryRecord'
INVESTIGATION_RECORD_ORM_METHOD='deleteMany|delete'
INVESTIGATION_RECORD_ORM_WRITE="(${INVESTIGATION_RECORD_MODEL})[[:space:]]*\.[[:space:]]*(${INVESTIGATION_RECORD_ORM_METHOD})[[:space:]]*\("
INVESTIGATION_RECORD_SQL='DELETE[[:space:]]+FROM[[:space:]]+(case_violation_record|case_inquiry_record)'
# 执行本函数的规则扫描与判定
check_investigation-record-no-delete() {
  local hits=0 file lines line sql
  while IFS= read -r file; do
    lines="$(grep -En -e "$INVESTIGATION_RECORD_ORM_WRITE" "$file" 2>/dev/null || true)"
    sql="$(grep -En -e "$INVESTIGATION_RECORD_SQL" "$file" 2>/dev/null || true)"
    if [ -n "$lines" ]; then
      while IFS= read -r line; do
        note_fail "investigation-record-no-delete：违法记录或笔录被删除 ${file#"$ROOT"/}:${line%%:*}（#236 不物理删除）"
        hits=$((hits + 1))
      done <<< "$lines"
      continue
    fi
    if [ -n "$sql" ]; then
      while IFS= read -r line; do
        note_fail "investigation-record-no-delete：违法记录或笔录被删除 ${file#"$ROOT"/}:${line%%:*}（#236 不物理删除）"
        hits=$((hits + 1))
      done <<< "$sql"
      continue
    fi
    if tr '\n' ' ' < "$file" | grep -qE "$INVESTIGATION_RECORD_ORM_WRITE"; then
      note_fail "investigation-record-no-delete：${file#"$ROOT"/} 折行后检出违法记录或笔录删除（换行链式形态）"
      hits=$((hits + 1))
    fi
  done < <(find "$BACKEND" "$ROOT/packages" "$ROOT/integration" "$ROOT/e2e" "${SCAN_CODE[@]}")
  if [ "$hits" -eq 0 ]; then
    note_ok "investigation-record-no-delete：backend + packages + integration + e2e 全源码无违法记录或笔录删除（#236 不物理删除）"
  fi
}


# 规则（#120，ADR 0008、#80）：运行参数清单。compose 与 CI 只引用 infra/runtime.env 登记的名字，
# 不写字面量密钥。清单解析与 dev、tools/ci-inject-env.sh 共用 tools/runtime-env-lib.sh。
RUNTIME_ENV_FILE="$ROOT/infra/runtime.env"
# shellcheck source=tools/runtime-env-lib.sh
. "$ROOT/tools/runtime-env-lib.sh"
MANIFEST_SCAN_FILES=(infra/docker-compose.yml .github/workflows/ci.yml)
# CI 平台自带变量：由 GitHub Actions 提供，不是运行参数，不进清单
CI_PLATFORM_VARS=" GITHUB_OUTPUT GITHUB_ENV GITHUB_STEP_SUMMARY GITHUB_PATH "
# 名字里带这些词的变量一律按密钥处理，清单漏标 secret 也拦得住。
# DATABASE_URL 是 derived 项，但连接串里含数据库口令，同样只许引用。
SECRET_NAME_PATTERN='(PASSWORD|SECRET|TOKEN|ACCESS_KEY|PRIVATE_KEY|^DATABASE_URL$)'
MANIFEST_NAMES=" "
MANIFEST_SECRETS=" "

# 变量名是否在运行参数清单内
manifest_has() { case "$MANIFEST_NAMES" in *" $1 "*) return 0 ;; esac; return 1; }
# 变量名是否属于清单里的密钥项（按清单名单或密钥名样式判定）
manifest_secret_name() {
  case "$MANIFEST_SECRETS" in *" $1 "*) return 0 ;; esac
  [[ "$1" =~ $SECRET_NAME_PATTERN ]]
}

# 执行本函数的规则扫描与判定
check_runtime-manifest() {
  local table fails=0 rel file nr line key value name kind secret_value line_assign
  if ! table="$(runtime_env_table 2>&1)"; then
    note_fail "runtime-manifest：清单 infra/runtime.env 格式错误：$table"
    return
  fi
  MANIFEST_NAMES=" $(cut -f1 <<< "$table" | xargs) "
  MANIFEST_SECRETS=" $(awk -F'\t' '$2 == "secret" { print $1 }' <<< "$table" | xargs) "
  for rel in "${MANIFEST_SCAN_FILES[@]}"; do
    file="$ROOT/$rel"
    if [ ! -f "$file" ]; then
      note_fail "runtime-manifest：缺少被核对的文件 $rel"
      fails=$((fails + 1))
      continue
    fi
    case "$rel" in .github/*) kind=ci ;; *) kind=compose ;; esac
    nr=0
    while IFS= read -r line || [ -n "$line" ]; do
      nr=$((nr + 1))
      [[ "$line" =~ ^[[:space:]]*# ]] && continue
      # ① 变量引用：$NAME / ${NAME…}。compose 的 $$ 转义交给容器内 shell 展开，不在此列。
      while IFS= read -r name; do
        [ -z "$name" ] && continue
        manifest_has "$name" && continue
        [ "$kind" = ci ] && case "$CI_PLATFORM_VARS" in *" $name "*) continue ;; esac
        note_fail "runtime-manifest：$rel:$nr 引用清单外变量名 $name（先登记到 infra/runtime.env）"
        fails=$((fails + 1))
      done < <(sed -E 's/\$\$\{?[A-Za-z_][A-Za-z0-9_]*//g' <<< "$line" \
                 | grep -oE '\$\{?[A-Za-z_][A-Za-z0-9_]*' | sed -E 's/^\$\{?//')
      # ② 带默认值或回落值的密钥引用：${SECRET:-x}、${SECRET-x}
      while IFS= read -r name; do
        [ -z "$name" ] && continue
        if manifest_secret_name "$name"; then
          note_fail "runtime-manifest：$rel:$nr 密钥 $name 带默认值（字面量密钥；值只来自 infra/runtime.env 或部署环境）"
          fails=$((fails + 1))
        fi
      done < <(grep -oE '\$\{[A-Za-z_][A-Za-z0-9_]*:?-' <<< "$line" | sed -E 's/^\$\{//; s/:?-$//')
      # ①b CI 的 env 上下文引用：${{ env.NAME }}、env['NAME']、env["NAME"]
      if [ "$kind" = ci ]; then
        while IFS= read -r name; do
          [ -z "$name" ] && continue
          manifest_has "$name" && continue
          case "$CI_PLATFORM_VARS" in *" $name "*) continue ;; esac
          note_fail "runtime-manifest：$rel:$nr 引用清单外变量名 env.$name（先登记到 infra/runtime.env）"
          fails=$((fails + 1))
        done < <(grep -oE "(^|[^A-Za-z0-9_./-])env(\.[A-Za-z_][A-Za-z0-9_]*|\[['\"][A-Za-z_][A-Za-z0-9_]*['\"]\])" <<< "$line" \
                   | sed -E "s/^[^e]?env\.?//; s/^\[['\"]//; s/['\"]\]$//")
      fi
      # ③ CI 的 secrets 引用：名字必须是 DEV_<清单名>，且不许 || 回落字面量
      if [ "$kind" = ci ]; then
        while IFS= read -r name; do
          [ -z "$name" ] && continue
          manifest_has "${name#DEV_}" && [ "${name#DEV_}" != "$name" ] && continue
          note_fail "runtime-manifest：$rel:$nr secrets.$name 不对应清单名（只许 secrets.DEV_<infra/runtime.env 里的名字>）"
          fails=$((fails + 1))
        done < <(grep -oE 'secrets\.[A-Za-z0-9_]+' <<< "$line" | sed 's/^secrets\.//')
        if grep -qE 'secrets\.[A-Za-z0-9_]+[[:space:]]*\|\|' <<< "$line"; then
          note_fail "runtime-manifest：$rel:$nr secrets 带 || 回落值（字面量密钥；未配置时由 tools/ci-inject-env.sh 取清单夹具值）"
          fails=$((fails + 1))
        fi
      fi
      # ④ 变量赋值：大写键（compose environment、CI env）。键名必须在清单里；密钥键的值只许引用。
      key=""; value=""
      if [[ "$line" =~ ^[[:space:]]+([A-Z][A-Z0-9_]*):[[:space:]]*(.*)$ ]]; then
        key="${BASH_REMATCH[1]}"; value="${BASH_REMATCH[2]}"
      elif [[ "$line" =~ ^[[:space:]]+-[[:space:]]+[\"\']?([A-Z][A-Z0-9_]*)=(.*)$ ]]; then
        # compose 环境列表项，含带引号的 - "NAME=value" / - 'NAME=value'
        key="${BASH_REMATCH[1]}"; value="${BASH_REMATCH[2]}"
        value="${value%\"}"; value="${value%\'}"
      fi
      if [ -n "$key" ]; then
        if ! manifest_has "$key"; then
          if [ "$kind" != ci ] || [[ "$CI_PLATFORM_VARS" != *" $key "* ]]; then
            note_fail "runtime-manifest：$rel:$nr 出现清单外变量名 $key（先登记到 infra/runtime.env）"
            fails=$((fails + 1))
          fi
        fi
        if manifest_secret_name "$key"; then
          value="${value%\"}"; value="${value#\"}"; value="${value%\'}"; value="${value#\'}"
          if [ "$kind" = compose ] && ! [[ "$value" =~ ^\$\{[A-Z][A-Z0-9_]*(:\?[^}]*)?\}$ ]]; then
            note_fail "runtime-manifest：$rel:$nr 密钥 $key 写了字面量（只许 \${$key:?…} 引用）"
            fails=$((fails + 1))
          elif [ "$kind" = ci ] && ! [[ "$value" =~ ^\$\{\{[[:space:]]*secrets\.[A-Za-z0-9_]+[[:space:]]*\}\}$ ]]; then
            note_fail "runtime-manifest：$rel:$nr 密钥 $key 写了字面量（只许 \${{ secrets.DEV_$key }}）"
            fails=$((fails + 1))
          fi
        fi
      fi
      # ④b 行内 shell 环境赋值：NAME=value（如 CI run: 里的 NAME=x cmd）。
      # 名字必须在清单里；密钥只许 $NAME / ${NAME} / ${{ secrets.… }} 形式的引用。
      while IFS= read -r line_assign; do
        [ -z "$line_assign" ] && continue
        key="${line_assign%%=*}"; value="${line_assign#*=}"
        if ! manifest_has "$key" && [[ "$CI_PLATFORM_VARS" != *" $key "* ]]; then
          note_fail "runtime-manifest：$rel:$nr 行内赋值出现清单外变量名 $key（先登记到 infra/runtime.env）"
          fails=$((fails + 1))
        fi
        value="${value#\"}"; value="${value#\'}"
        if manifest_secret_name "$key" && [[ "$value" != \$* ]]; then
          note_fail "runtime-manifest：$rel:$nr 行内赋值给密钥 $key 写了字面量（只许引用变量）"
          fails=$((fails + 1))
        fi
      done < <(grep -oE "(^|[[:space:];&|(])[A-Z][A-Z0-9_]*=[^[:space:]]*" <<< "$line" \
                 | sed -E 's/^[[:space:];&|(]//' \
                 | grep -vE "^[A-Z][A-Z0-9_]*=$" || true)
      # ⑤ 清单里密钥的夹具值不许原样出现
      for name in $MANIFEST_SECRETS; do
        secret_value="$(awk -F'\t' -v n="$name" '$1 == n { print $4 }' <<< "$table")"
        [ -z "$secret_value" ] && continue
        if grep -qwF -- "$secret_value" <<< "$line"; then
          note_fail "runtime-manifest：$rel:$nr 出现密钥 $name 的夹具值（字面量密钥；改为引用变量）"
          fails=$((fails + 1))
        fi
      done
    done < "$file"
  done
  if [ "$fails" -eq 0 ]; then
    note_ok "runtime-manifest：compose 与 CI 只引用清单内变量名，无字面量密钥（清单 $(wc -w <<< "$MANIFEST_NAMES" | xargs) 项）"
  fi
}

# 规则（#120，#105「锁清单」、#111）：锁清单断言。docs/user-lock.md 的每节 L<n> 带且只带一个
# 断言编号 USER-LOCK-L<n>。测试代码里必须有标题以该编号开头的 it/test（尚无承载模块的用
# it.todo 登记「待实现」）。测试里出现清单外编号同样判红，防止删条后断言残留。
USER_LOCK_FILE="$ROOT/docs/user-lock.md"
USER_LOCK_ID_RE='USER-LOCK-L[0-9]+'
# 执行本函数的规则扫描与判定
check_user-lock-assertions() {
  local fails=0 sections declared tested id n count
  if [ ! -f "$USER_LOCK_FILE" ]; then
    note_fail "user-lock-assertions：缺少锁清单 docs/user-lock.md"
    return
  fi
  sections="$(grep -oE '^## L[0-9]+ ' "$USER_LOCK_FILE" | awk '{ print $2 }')"
  declared="$(grep -E '^- \*\*断言编号\*\*：`'"$USER_LOCK_ID_RE"'`$' "$USER_LOCK_FILE" | grep -oE "$USER_LOCK_ID_RE")"
  if [ -z "$sections" ]; then
    note_fail "user-lock-assertions：docs/user-lock.md 里没有 L<n> 条目"
    return
  fi
  while IFS= read -r n; do
    count="$(grep -cx -- "USER-LOCK-$n" <<< "$declared")"
    if [ "$count" -ne 1 ]; then
      note_fail "user-lock-assertions：锁清单 $n 应带且只带一个断言编号 USER-LOCK-$n（实际 $count 个）"
      fails=$((fails + 1))
    fi
  done <<< "$sections"
  while IFS= read -r id; do
    [ -z "$id" ] && continue
    grep -qx -- "${id#USER-LOCK-}" <<< "$sections" && continue
    note_fail "user-lock-assertions：断言编号 $id 没有对应的锁清单条目"
    fails=$((fails + 1))
  done <<< "$declared"
  tested="$(find "$BACKEND" "$ROOT/packages" "$ROOT/frontend" "$ROOT/integration" "$ROOT/e2e" \
      -path '*/node_modules' -prune -o -path "$ROOT/frontend/prototype" -prune -o \
      -type f \( -name '*.test.ts' -o -name '*.test.tsx' -o -name '*.test.mts' \) -print 2>/dev/null \
    | while IFS= read -r file; do
        # 只认行首的实际调用：去掉 /* … */ 块注释里的行；// 注释和字符串里的调用不在行首，不计
        awk '
          inblock { if (index($0, "*/")) inblock = 0; next }
          /^[[:space:]]*\/\*/ { if (!index($0, "*/")) inblock = 1; next }
          { print }
        ' "$file" | grep -oE "^[[:space:]]*(it|test)(\.todo)?\([[:space:]]*['\"\`]$USER_LOCK_ID_RE\b"
      done | grep -oE "$USER_LOCK_ID_RE" | sort -u)"
  while IFS= read -r id; do
    [ -z "$id" ] && continue
    if ! grep -qx -- "$id" <<< "$tested"; then
      note_fail "user-lock-assertions：断言编号 $id 在测试代码里找不到对应断言或「待实现」登记"
      fails=$((fails + 1))
    fi
  done <<< "$declared"
  while IFS= read -r id; do
    [ -z "$id" ] && continue
    if ! grep -qx -- "$id" <<< "$declared"; then
      note_fail "user-lock-assertions：测试代码里的断言编号 $id 不在 docs/user-lock.md"
      fails=$((fails + 1))
    fi
  done <<< "$tested"
  if [ "$fails" -eq 0 ]; then
    note_ok "user-lock-assertions：锁清单 $(wc -l <<< "$sections" | xargs) 条，每条断言编号在测试代码里都有断言或「待实现」登记"
  fi
}

# 规则（#122，#105「前端：路由与应用壳」）：前端路由只用 data 模式。
# ① 前端源码（不含 node_modules、原型、构建产物）不得出现声明式路由组件 BrowserRouter /
#    HashRouter（createBrowserRouter、createHashRouter 不受影响：按整词匹配，前缀 create 不算）。
# ② 前端的 package.json、源码与配置不得引用框架模式开发插件 @react-router/dev。
FRONTEND_DIR="$ROOT/frontend"
# 执行本函数的规则扫描与判定
check_frontend-router-mode() {
  local fails=0 file
  while IFS= read -r file; do
    note_fail "frontend-router-mode：${file#"$ROOT"/} 使用了声明式路由组件（只许 createBrowserRouter + RouterProvider）"
    fails=$((fails + 1))
  done < <(find "$FRONTEND_DIR" -path '*/node_modules' -prune -o -path "$FRONTEND_DIR/prototype" -prune \
      -o -path "$FRONTEND_DIR/dist" -prune -o "${SCAN_TS[@]}" -print 2>/dev/null \
    | while IFS= read -r file; do
        grep -qE '(^|[^A-Za-z0-9_$])(BrowserRouter|HashRouter)([^A-Za-z0-9_$]|$)' "$file" && echo "$file"
      done)
  while IFS= read -r file; do
    note_fail "frontend-router-mode：${file#"$ROOT"/} 引用了框架模式插件 @react-router/dev"
    fails=$((fails + 1))
  done < <(find "$FRONTEND_DIR" -path '*/node_modules' -prune -o -path "$FRONTEND_DIR/prototype" -prune \
      -o -path "$FRONTEND_DIR/dist" -prune -o -type f \( "${SCAN_TS_NAMES[@]}" -o -name 'package.json' \
      -o -name '*.mjs' -o -name '*.cjs' -o -name '*.js' \) -print 2>/dev/null \
    | while IFS= read -r file; do
        grep -qF '@react-router/dev' "$file" && echo "$file"
      done)
  if [ "$fails" -eq 0 ]; then
    note_ok "frontend-router-mode：前端只用 data 模式路由，无声明式路由组件、无 @react-router/dev"
  fi
}

# 规则（#134 收口，#105「截图验收（loop ⑥c）」；#207 换全集，#220 齐套）：
# 截图全集 = 两个时代的状态键并集：
#   v0.4 时代（已收口，#122–#134 出齐）：原型 frontend/prototype/admin-console/screens/*.png
#     的 78 键（除改动总览 overview.png）。这批键一张不少，已出的图也不许撤走。
#   #207 时代（#207 协议第 I 节定义的 62 键，本全集定义处）：docs/screens/keys-207.txt。
#     #220 起这 62 键缺一即红。已出的图不许越出两个时代的并集。
# 实有集合 = docs/screens/manifest/<票>.txt 各票状态键段（## aux 段之前）的文件名并集。
#   截图本体已迁出版本控制（落在 e2e/results/screens/<票>/，不入库），清单是「哪一票出了哪些
#   状态键」的在库记录；## aux 段是对照与补充图，逐图人查用，不计入实有集合。
# 自动判定只比文件名集合；画面是否与原型一致由前端交互设计工程师逐图自查、Lei Hu gate② 签收。
SCREENS_WANT_DIR="$ROOT/frontend/prototype/admin-console/screens"
SCREENS_MANIFEST_DIR="$ROOT/docs/screens/manifest"
SCREENS_KEYS_207="$ROOT/docs/screens/keys-207.txt"
# 执行本函数的规则扫描与判定
check_screenshot-full-set() {
  local fails=0 want_v04 want_207 want have missing extra pending
  if [ ! -d "$SCREENS_WANT_DIR" ] || [ ! -d "$SCREENS_MANIFEST_DIR" ] || [ ! -f "$SCREENS_KEYS_207" ]; then
    note_fail "screenshot-full-set：缺少原型截图目录、docs/screens/manifest 目录或 #207 状态键清单"
    return
  fi
  # 三份清单一律按 LC_ALL=C 排序，comm 的两边必须同序同序则。
  # keys-207.txt 记的是状态键本身（不带扩展名，与 #207 协议第 I 节代码块逐字一致），
  # 比对时补上 .png 才与文件名同形。
  want_v04="$(find "$SCREENS_WANT_DIR" -maxdepth 1 -type f -name '*.png' ! -name 'overview.png' -printf '%f\n' | LC_ALL=C sort)"
  want_207="$(grep -v -e '^[[:space:]]*#' -e '^[[:space:]]*$' "$SCREENS_KEYS_207" | sed 's/$/.png/' | LC_ALL=C sort)"
  want="$(printf '%s\n%s\n' "$want_v04" "$want_207" | LC_ALL=C sort -u)"
  # 实有集合 = 各票清单的状态键段（## aux 段之前）的文件名并集。awk 逐文件处理，FNR 到 1
  # 即换文件，aux 标记随之复位。
  have="$(find "$SCREENS_MANIFEST_DIR" -maxdepth 1 -type f -name '*.txt' -exec awk '
      FNR == 1 { aux = 0 }
      /^## aux$/ { aux = 1; next }
      aux { next }
      /^#/ { next }
      /^[[:space:]]*$/ { next }
      { print }
    ' {} + | LC_ALL=C sort -u)"
  # 本机 comm 是 uutils 实现，不吃 herestring 参数；比较失败必须显式判红，不许静默放过。
  # comm 的序检查跟当前 locale 走。清单按 C 序排，比较也固定 C 序，避免 UTF-8 下误判未排序。
  if ! extra="$(LC_ALL=C comm -13 <(printf '%s\n' "$want") <(printf '%s\n' "$have"))"; then
    note_fail "screenshot-full-set：全集与状态键的集合比较执行失败"
    return
  fi
  if ! missing="$(LC_ALL=C comm -23 <(printf '%s\n' "$want_v04") <(printf '%s\n' "$have"))"; then
    note_fail "screenshot-full-set：全集与状态键的集合比较执行失败"
    return
  fi
  if ! pending="$(LC_ALL=C comm -23 <(printf '%s\n' "$want_207") <(printf '%s\n' "$have"))"; then
    note_fail "screenshot-full-set：全集与状态键的集合比较执行失败"
    return
  fi
  if [ -n "$missing" ]; then
    note_fail "screenshot-full-set：v0.4 收口时代缺状态键：$(tr '\n' ' ' <<<"$missing")"
    fails=1
  fi
  if [ -n "$extra" ]; then
    note_fail "screenshot-full-set：全集多出状态键之外的文件名：$(tr '\n' ' ' <<<"$extra")"
    fails=1
  fi
  if [ -n "$pending" ]; then
    note_fail "screenshot-full-set：#207 键缺：$(tr '\n' ' ' <<<"$pending")"
    fails=1
  fi
  if [ "$fails" -eq 0 ]; then
    note_ok "screenshot-full-set：docs/screens/manifest 各票状态键段并集 $(wc -l <<<"$have" | xargs) 个文件名，全在 v0.4 的 $(wc -l <<<"$want_v04" | xargs) 键与 #207 的 $(wc -l <<<"$want_207" | xargs) 键之内；#207 的 62 键齐套"
  fi
}

# 规则（#207／#220）：界面文案纪律。frontend/src 生产源码（排除 *.test.*／*.spec.*）的
# 字符串字面量不得出现「捞回」、Issue 号样式（#加 2–4 位数字）、`区块 [A-E]`。
# 注释里的「禁用／禁止」说明不计入（只扫引号字面量）。自动判定只看源码集合；渲染结果
# 由前端单测（router／shell／closure）补充。
check_ui-copy-discipline() {
  local file base line fails=0
  while IFS= read -r file; do
    base="${file##*/}"
    case "$base" in
      *.test.ts|*.test.tsx|*.spec.ts|*.spec.tsx) continue ;;
    esac
    # 只扫引号字面量：注释里的「禁用捞回」说明不计入。
    while IFS= read -r line; do
      note_fail "ui-copy-discipline：界面文案禁词 ${file#"$ROOT"/} → ${line}"
      fails=$((fails + 1))
    done < <(grep -nE "(['\"\`])([^'\"\`]*(捞回|区块[[:space:]]*[A-E]|#[0-9]{2,4})[^'\"\`]*)\1" "$file" 2>/dev/null \
      | grep -Ev "禁用|禁止|不得|勿写|不出现|not\.toContain|not\.toMatch" || true)
  done < <(find "$ROOT/frontend/src" -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' \) "${SCAN_CODE[@]}")
  if [ "$fails" -eq 0 ]; then
    note_ok "ui-copy-discipline：frontend/src 生产源码字面量无「捞回」、Issue 号样式、区块 [A-E]"
  fi
}

# 规则（#234）：不予立案落点服务 recordNoCaseFromFilingApproval 在 server 层只许由
# 立案呈批批准路径调用（backend/server/src/case-filing.service.ts）。
# 其他服务出现即红：防止重新开出绕过立案呈批的不予立案入口（X19）。
NO_CASE_LANDING_FILE="backend/server/src/case-filing.service.ts"
# 执行本函数的规则扫描与判定
check_no-case-landing-entry() {
  local file rel fails=0
  while IFS= read -r file; do
    rel="${file#"$ROOT"/}"
    [ "$rel" = "$NO_CASE_LANDING_FILE" ] && continue
    note_fail "no-case-landing-entry：${rel} 引用了 recordNoCaseFromFilingApproval（只许 ${NO_CASE_LANDING_FILE} 的立案呈批批准路径调用，#234 X19）"
    fails=$((fails + 1))
  done < <(find "$ROOT/backend/server/src" "${SCAN_CODE[@]}" -exec grep -lE 'recordNoCaseFromFilingApproval' {} + 2>/dev/null || true)
  if [ "$fails" -eq 0 ]; then
    note_ok "no-case-landing-entry：server 层只有立案呈批批准路径调用不予立案落点服务"
  fi
}

# ---------- 注释规范（约定 docs/agents/code-comments.md） ----------
# COMMENT_SCOPE：已完成注释的目录或文件（相对 ROOT）。范围只升不降：目录纳入后须长期合规。
# 匹配口径：路径等于条目，或以「条目/」开头。批次完成后在此追加条目。
COMMENT_SCOPE=(
  backend/approval/src
  backend/supervision/src
  backend/deadline/src
  backend/deadline/test
  backend/geo-dict
  backend/identity
  backend/case/src
  backend/case/test
  backend/prisma
  packages/audit
  packages/shield
  packages/storage
  packages/queue
  frontend/src/shell
  frontend/src/workbench
  frontend/src/login
  frontend/src/pages
  frontend/src/account
  frontend/src/admin
  frontend/src/clue
  frontend/src/case
  e2e/verify
  backend/server/src
  frontend/src/api.ts
  frontend/src/hooks.ts
  frontend/src/opcodes.ts
  frontend/src/router.tsx
  frontend/src/routing.ts
  frontend/src/routing.test.ts
  frontend/src/router.test.tsx
  frontend/src/session.ts
  frontend/src/store.ts
  frontend/src/main.tsx
  frontend/src/test-utils.tsx
  frontend/vite.config.ts
  backend/server/register.mjs
  backend/server/load-typescript.mjs
  backend/server/vitest.config.ts
  e2e/cases
  integration
  tools
  dev
  eslint.config.mjs
)
# 注释检查的排除项（生成物、迁移、原型、构建与运行产物、类型声明）。
COMMENT_EXCLUDE=(
  -not -path '*/node_modules/*' -not -path '*/dist/*'
  -not -path "$BACKEND/prisma/generated/*" -not -path "$BACKEND/prisma/migrations/*"
  -not -path "$ROOT/frontend/prototype/*" -not -path "$ROOT/e2e/results/*"
  -not -name '*.generated.ts' -not -name '*.d.ts' -not -name '*.d.cts' -not -name '*.d.mts'
)

# 列出 COMMENT_SCOPE 内的文件（NUL 分隔）。$1 = 文件名正则；其余 = find 的文件名过滤参数。
# 目录条目按 find 过滤；文件条目只按 $1 过滤（文件条目可以是 dev 这类无扩展名的）。
comment_scope_files() {
  local entry re="$1"; shift
  for entry in "${COMMENT_SCOPE[@]}"; do
    if [ -d "$ROOT/$entry" ]; then
      find "$ROOT/$entry" -type f "${COMMENT_EXCLUDE[@]}" "$@" -print0
    elif [ -f "$ROOT/$entry" ] && [[ "${entry##*/}" =~ $re ]]; then
      printf '%s\0' "$ROOT/$entry"
    fi
  done
}

# 取操作码名册：CASE_OPCODES 的键、ADMIN_CODES 的字面量、cfg.<对象>.<动作> 的组合展开。
# 输出形如「 a.b c.d 」（两端留空格，供 awk 做整词匹配）。
opcode_registry() {
  local file="$ROOT/packages/shield/src/contract/opcode.ts" objs acts o a out=""
  [ -f "$file" ] || return 0
  out="$(awk '/^const CASE_OPCODES = \{/{f=1;next} f&&/^\} as const/{f=0} f' "$file" \
    | grep -oE "^  '[a-z][a-z0-9._-]*':" | tr -d " ':")"
  out="$out $(awk '/^const ADMIN_CODES = \[/{f=1;next} f&&/^\] as const/{f=0} f' "$file" \
    | grep -oE "^  '[a-z][a-z0-9._-]*'," | tr -d " ',")"
  objs="$(grep -oE "ADMIN_OBJECTS = \[[^]]*\]" "$file" | grep -oE "'[a-z]+'" | tr -d "'")"
  acts="$(grep -oE "ADMIN_ACTIONS = \[[^]]*\]" "$file" | grep -oE "'[a-z]+'" | tr -d "'")"
  for o in $objs; do for a in $acts; do out="$out cfg.$o.$a"; done; done
  echo " $(echo $out) "
}

# TS 注释检查程序（awk）。输出：<类别>\t<文件>\t<行号>\t<说明>。
# 类别：HEADER 文件头缺「用途：」；EXPORT 导出符号缺紧邻注释；DESCRIBE describe 缺紧邻注释；
# ROUTE 路由缺操作码注释或操作码不在名册。变量 ops = 操作码名册（见 opcode_registry）。
COMMENT_TS_AWK='
function route_op(s,   p, rest) {
  p = index(s, "操作码 ")
  if (p == 0) return ""
  rest = substr(s, p + length("操作码 "))
  if (match(rest, /^[a-z][a-z0-9._-]*/)) return substr(rest, 1, RLENGTH)
  return ""
}
function route_check(   op) {
  if (index(cblock, "无操作码（") > 0) return
  op = route_op(cblock)
  if (op == "") printf "ROUTE\t%s\t%d\t路由缺少紧邻的「操作码 <码>」注释\n", FILENAME, FNR
  else if (index(ops, " " op " ") == 0) printf "ROUTE\t%s\t%d\t操作码 %s 不在 opcode.ts 名册\n", FILENAME, FNR, op
}
FNR == 1 {
  if (NR > 1 && pk == "src" && !hdr_ok && !hdr_out) printf "HEADER\t%s\t1\t文件头缺少「用途：」行\n", pf
  pf = FILENAME
  pk = (FILENAME ~ /\.test\.(ts|tsx)$/) ? "test" : "src"
  hdr_ok = 0; hdr_out = 0; code = 0; prev = 0; lk = ""; cblock = ""; dec = 0; depth = 0
}
FNR == 1 && /^#!/ { next }
/^[[:space:]]*(\/\/|\/\*|\*)/ && /(from|import|require)[^\047"]{0,40}[\047"](@natural-enforcement\/|\.\.?\/)/ {
  printf "IMPORTLIKE\t%s\t%d\t注释里含 import 样式文字，依赖矩阵规则会把它当作真实导入；调用方请写成路径，不带引号与 from/import/require\n", FILENAME, FNR
}
/^[[:space:]]*$/ { prev = 0; cblock = ""; lk = "gap"; next }
code == 0 && /^[[:space:]]*(\/\/|\/\*|\*)/ { if ($0 ~ /用途(：|:)/) hdr_ok = 1 }
code == 0 && !/^[[:space:]]*(\/\/|\/\*|\*)/ {
  code = 1
  if (pk == "src" && !hdr_ok) { printf "HEADER\t%s\t%d\t文件头缺少「用途：」行\n", FILENAME, FNR; hdr_out = 1 }
}
dec == 1 || /^[[:space:]]*@/ {
  if (dec == 0 && pk == "src" && $0 ~ /^[[:space:]]*@(Get|Post|Put|Patch|Delete|All)\(/) route_check()
  t = $0; o = gsub(/\(/, "(", t); t = $0; c = gsub(/\)/, ")", t)
  depth += o - c
  dec = (depth > 0) ? 1 : 0
  if (dec == 0) depth = 0
  next
}
/^[[:space:]]*\/\/[[:space:]]*[-=*~_#]{3,}/ { prev = 0; cblock = ""; lk = "divider"; next }
/^[[:space:]]*\/\// { cblock = (lk == "line") ? cblock " " $0 : $0; prev = 1; lk = "line"; next }
/\*\/[[:space:]]*$/ { cblock = ""; prev = 1; lk = "block"; next }
pk == "src" && /^export (async )?(function|const|class|interface|type|enum|let|var|abstract class)/ && !/^export type[[:space:]]*\{/ {
  if (!prev) printf "EXPORT\t%s\t%d\t导出符号缺少紧邻的注释\n", FILENAME, FNR
}
pk == "test" && /^[[:space:]]*describe(\.[a-z]+)?\(/ {
  if (!prev) printf "DESCRIBE\t%s\t%d\tdescribe 缺少紧邻的注释\n", FILENAME, FNR
}
{ cblock = ""; prev = 0; lk = "code" }
END {
  if (pk == "src" && !hdr_ok && !hdr_out) printf "HEADER\t%s\t1\t文件头缺少「用途：」行\n", pf
}
'

# shell 注释检查程序（awk）。输出同上。类别：HEADER 文件头缺「用途：」；FUNC 函数缺紧邻 # 注释。
COMMENT_SH_AWK='
FNR == 1 {
  if (NR > 1 && !hdr_ok && !hdr_out) printf "HEADER\t%s\t1\t文件头缺少「用途：」行\n", pf
  pf = FILENAME; hdr_ok = 0; hdr_out = 0; code = 0; prevc = 0
}
/^[[:space:]]*$/ { prevc = 0; next }
code == 0 && /^[[:space:]]*#/ {
  if ($0 ~ /用途(：|:)/) hdr_ok = 1
  prevc = ($0 ~ /^#!/) ? 0 : 1
  next
}
code == 0 {
  code = 1
  if (!hdr_ok) { printf "HEADER\t%s\t%d\t文件头缺少「用途：」行\n", FILENAME, FNR; hdr_out = 1 }
}
/^[[:space:]]*#/ { prevc = ($0 ~ /^#!/) ? 0 : 1; next }
/^[[:space:]]*(function[[:space:]]+)?[A-Za-z_][A-Za-z0-9_.-]*[[:space:]]*\(\)[[:space:]]*\{/ {
  if (!prevc) {
    name = $0
    sub(/^[[:space:]]*(function[[:space:]]+)?/, "", name)
    sub(/\(.*/, "", name)
    printf "FUNC\t%s\t%d\t函数 %s 缺少紧邻的注释\n", FILENAME, FNR, name
  }
}
{ prevc = 0 }
END { if (!hdr_ok && !hdr_out && pf != "") printf "HEADER\t%s\t1\t文件头缺少「用途：」行\n", pf }
'

# 注释路径引用提取程序（awk）：只扫注释行（// * # 开头），输出 <文件>\t<行号>\t<路径>。
# 取法：按空白切词，词内从仓库顶层目录名起取子串，再在第一个标点处截断。
# 不按字符类取路径：docs/adr 下的文件名是中文，mawk 按字节处理，字符类会把汉字拆开。
# 标点按整串匹配（全角与半角），对字节与字符两种语义都成立。
# 路径前一个字符是路径字符时视为别的单词的一部分，不取（前面多出字母的 mydocs 不算 docs）。
# 以下情形不是「引用一个具体入库文件」，一律不取：
#   通配符（含 *）；顶层目录名的斜杠列举（backend/frontend/e2e）；运行产物目录前缀
#   （e2e/results、frontend/dist、backend/prisma/generated、node_modules、coverage，它们不入库）；
#   引用之后紧跟「（已退役」「（已删除」「（已移除」，作者已显式说明该文件不在了。
COMMENT_PATH_AWK='
function cut_at_punct(s,   i, p, best) {
  best = length(s) + 1
  for (i = 1; i <= np; i++) { p = index(s, puncts[i]); if (p > 0 && p < best) best = p }
  return substr(s, 1, best - 1)
}
function is_listing(s,   n, seg, i, hits) {
  n = split(s, seg, "/"); hits = 0
  for (i = 2; i <= n; i++) if (seg[i] ~ /^(backend|frontend|packages|integration|e2e|tools|infra|docs)$/) hits++
  return hits > 0
}
BEGIN {
  np = split("； 。 ， 、 ： （ ） 「 」 《 》 —— — , ; ) ( ] [ > < ` \047 \"", puncts, " ")
}
/^[[:space:]]*(\/\/|\/\*|\*|#)/ {
  n = split($0, words, /[[:space:]]+/)
  for (w = 1; w <= n; w++) {
    cand = words[w]
    if (!match(cand, /(^|[^A-Za-z0-9_.\/-])(backend|frontend|packages|integration|e2e|tools|infra|docs|\.github)\//)) continue
    s = substr(cand, RSTART)
    if (substr(s, 1, 1) !~ /[a-z.]/) s = substr(s, 2)
    tail = s
    s = cut_at_punct(s)
    sub(/[.:]+$/, "", s)
    if (s ~ /\*/) continue
    if (is_listing(s)) continue
    if (s ~ /^(e2e\/results|frontend\/dist|backend\/prisma\/generated|node_modules|coverage)(\/|$)/) continue
    rest = substr(tail, length(s) + 1)
    if (index(rest, "（已退役") == 1 || index(rest, "（已删除") == 1 || index(rest, "（已移除") == 1) continue
    printf "%s\t%d\t%s\n", FILENAME, FNR, s
  }
}
'

# 期限规则的登记文件与 L1 判据产物。规则只扫登记表里的 basis 行。
CRITERIA_TRACE_SOURCE="$ROOT/backend/deadline/src/rules.ts"
CRITERIA_TRACE_PRODUCT="$ROOT/backend/deadline/src/criteria.generated.ts"

# 规则：期限规则的 basis 必须指向在场判据或业务决策（E8 可追溯性）。
check_criteria-traceability() {
  local line token refs fails=0 checked=0
  if [ ! -f "$CRITERIA_TRACE_SOURCE" ]; then
    note_ok "criteria-traceability：期限规则文件不在场，跳过"
    return
  fi
  if [ ! -f "$CRITERIA_TRACE_PRODUCT" ]; then
    note_fail "criteria-traceability：判据产物不在场（${CRITERIA_TRACE_PRODUCT#"$ROOT"/}），先运行 node tools/generate-review-criteria.mjs"
    return
  fi
  while IFS= read -r line; do
    refs=0
    for token in $(printf '%s\n' "$line" | grep -oE '判据:CRIT-[A-Z0-9-]+' | sed 's/^判据://'); do
      refs=$((refs + 1))
      if ! grep -qF "id: \"$token\"" "$CRITERIA_TRACE_PRODUCT"; then
        note_fail "criteria-traceability：basis 指向的判据不在产物内：$token"
        fails=$((fails + 1))
      fi
    done
    for token in $(printf '%s\n' "$line" | grep -oE '业务决策:DEC-[0-9]+' | sed 's/^业务决策://'); do
      refs=$((refs + 1))
      if ! grep -qF "id: \"$token\"" "$CRITERIA_TRACE_PRODUCT"; then
        note_fail "criteria-traceability：basis 指向的业务决策不在产物内：$token"
        fails=$((fails + 1))
      fi
    done
    checked=$((checked + 1))
    if [ "$refs" -eq 0 ]; then
      note_fail "criteria-traceability：basis 未指向判据或业务决策：$line"
      fails=$((fails + 1))
    fi
  done < <(grep -E "^[[:space:]]+basis: '" "$CRITERIA_TRACE_SOURCE" || true)
  if [ "$checked" -eq 0 ]; then
    note_fail "criteria-traceability：期限规则文件里没有 basis 行，规则可能扫错文件"
    return
  fi
  if [ "$fails" -eq 0 ]; then
    note_ok "criteria-traceability：期限规则的 basis 全部指向在场判据或业务决策（$checked 条）"
  fi
}

# 规则：COMMENT_SCOPE 内的 TS 注释覆盖（文件头、导出注释、describe 注释、路由操作码）。
check_source-comment-coverage() {
  local ops fails=0 kind file line msg
  ops="$(opcode_registry)"
  while IFS=$'\t' read -r kind file line msg; do
    [ -n "$kind" ] || continue
    note_fail "source-comment-coverage：${file#"$ROOT"/}:${line} ${msg}（约定 docs/agents/code-comments.md）"
    fails=$((fails + 1))
  done < <(comment_scope_files '\.(ts|tsx|mts|cts|mjs|cjs)$' \( -name '*.ts' -o -name '*.tsx' -o -name '*.mts' -o -name '*.cts' -o -name '*.mjs' -o -name '*.cjs' \) \
    | xargs -0 -r awk -v ops="$ops" "$COMMENT_TS_AWK")
  if [ "$fails" -eq 0 ]; then
    note_ok "source-comment-coverage：COMMENT_SCOPE（${#COMMENT_SCOPE[@]} 项）内的源码均有文件头、导出注释、describe 注释与路由操作码"
  fi
}

# 规则：COMMENT_SCOPE 内的 shell 注释覆盖（文件头、函数注释）。dev 无扩展名，按文件条目纳入。
check_shell-comment-coverage() {
  local fails=0 kind file line msg entry
  while IFS=$'\t' read -r kind file line msg; do
    [ -n "$kind" ] || continue
    note_fail "shell-comment-coverage：${file#"$ROOT"/}:${line} ${msg}（约定 docs/agents/code-comments.md）"
    fails=$((fails + 1))
  done < <({ comment_scope_files '\.sh$' -name '*.sh'
             for entry in "${COMMENT_SCOPE[@]}"; do [ -f "$ROOT/$entry" ] && [ "${entry##*/}" = dev ] && printf '%s\0' "$ROOT/$entry"; done
           } | xargs -0 -r awk "$COMMENT_SH_AWK")
  if [ "$fails" -eq 0 ]; then
    note_ok "shell-comment-coverage：COMMENT_SCOPE 内的 shell 文件均有文件头与函数注释"
  fi
}

# 规则：COMMENT_SCOPE 内注释引用的仓库路径须已入库。路径取 git ls-files -z（中文路径不被转义）。
# 命中口径：引用等于某个已入库文件，或是某个已入库路径的目录前缀。
check_comment-path-refs() {
  local fails=0 file line ref dir tracked
  tracked="$(git -C "$ROOT" ls-files -z 2>/dev/null | tr '\0' '\n')"
  if [ -z "$tracked" ]; then
    note_ok "comment-path-refs：非 git 工作树，跳过路径入库核对"
    return
  fi
  while IFS=$'\t' read -r file line ref; do
    [ -n "$ref" ] || continue
    # 引用末尾的 / 表示目录：先剥掉，再按「等于某个已入库文件，或有已入库文件位于该目录下」核对。
    dir="${ref%/}"
    if awk -v d="$dir" '$0 == d || index($0, d "/") == 1 { found = 1 } END { exit !found }' <<< "$tracked"; then
      continue
    fi
    note_fail "comment-path-refs：${file#"$ROOT"/}:${line} 注释引用的路径未入库：${ref}"
    fails=$((fails + 1))
  done < <(comment_scope_files '\.(ts|tsx|mts|cts|mjs|cjs|sh)$' \( -name '*.ts' -o -name '*.tsx' -o -name '*.mts' -o -name '*.cts' -o -name '*.mjs' -o -name '*.cjs' -o -name '*.sh' \) \
    | xargs -0 -r awk "$COMMENT_PATH_AWK")
  if [ "$fails" -eq 0 ]; then
    note_ok "comment-path-refs：COMMENT_SCOPE 内的注释所引用的仓库路径均已入库"
  fi
}

# ---------- 运行参数（#171）：--rule 单规则过滤 + 两个只读清单模式 ----------
# 向后兼容：不带参数时本段不改变任何行为，输出与退出码与历史版本逐字相同。
# 只读模式放在派发之前：清单输出后直接退出，不跑任何规则、不打印全量头行。
RULE_FILTER=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --rule)
      RULE_FILTER="${2:-}"
      if [ -z "$RULE_FILTER" ]; then
        echo "[FAIL] 未知规则名：--rule 缺少取值（可选名见 --list-rules）" >&2
        exit 1
      fi
      # 成员校验先行：名不在 RULES 数组内即报错退出，绝不静默跑零条规则后打印
      # 「全部规则通过」（该静默通过形态已实测，见 docs/research/probe-single-rule-guardrails.md §3.2）
      rule_known=0
      for r in "${RULES[@]}"; do
        [ "$r" = "$RULE_FILTER" ] && rule_known=1
      done
      if [ "$rule_known" -ne 1 ]; then
        echo "[FAIL] 未知规则名：$RULE_FILTER（不在 RULES 数组内，可选名见 --list-rules）" >&2
        exit 1
      fi
      shift 2 ;;
    --list-rules)
      for r in "${RULES[@]}"; do echo "$r"; done
      exit 0 ;;
    --list-helpers)
      for r in "${HELPERS[@]}"; do echo "$r"; done
      exit 0 ;;
    *)
      shift ;;
  esac
done

echo "结构测试（#51 全量七模块依赖矩阵，含 #45 补丁 1；规则源头 = #47 Implementation Decisions；#55 队列设施唯一入口、#53 存储设施唯一入口并入）"
# 派发循环 = 全闸聚合语义的唯一载体（红探针护栏①静态断言本循环形态：循环体内只有
# 过滤与派发两种行，无 break/exit；任一规则判红 ⇒ FAIL=1 ⇒ 末尾 exit "$FAIL" 非 0）。
# --rule 过滤只允许落在本循环体内（护栏②），循环外不存在第二条按名派发入口。
for rule in "${RULES[@]}"; do
  [ -n "$RULE_FILTER" ] && [ "$rule" != "$RULE_FILTER" ] && continue
  "check_$rule"
done
echo
if [ "$FAIL" -eq 0 ]; then
  echo "结构测试：全部规则通过。"
else
  echo "结构测试：存在失败规则，详见上方标红行。" >&2
fi
exit "$FAIL"
