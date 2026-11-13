#!/usr/bin/env bash
# 用途：红探针：逐条注入违例源码，断言目标规则判红并能自清理。
# 结构测试红探针（评审必修 C6，补 #51 AC 缺的负例证据）。
# 为什么需要：兜底闸只出示「全绿」，无法区分「规则通过」与「规则根本没在扫」——
# 本 PR 的 frontend-boundary 就是这么一条恒绿死规则（case 里的 pg|@prisma/* 永远取不到）。
# 本用例逐条写入违例源码 → 断言结构测试确实判红且命中该规则 → 还原源码。
# 退出码只有 0/1，失败输出人类可读（沿用 integration/README.md 的用例纪律）。
# 为什么住 tools/ 而不是 integration/：本文件按设计内含各类违例字样（bullmq、深路径导入…），
# 而规则一律不扫 tools/（见 structural-test.sh 扫描范围注释）——放 integration/ 会被自己要
# 证明的规则判红。它与 structural-test.sh 同属兜底闸设施，成对维护。
# 接入：dev lint 的 structural-probe 子项（全量五项之一，dev 的 lint_structural_probe()），
# 随 dev check → CI 一起跑；
# 宿主侧纯源码扫描，无容器/网络依赖。违例文件写在真实工作树里再删除，故必须顺序执行、
# 不得与其他检查并行。
# #171 单规则化：逐条用例改跑 --rule <目标规则>（退出码 1 只可能来自目标规则，断言更强）；
# 单规则化弱化的「整闸聚合」由三条护栏补回——① 整闸变红（静态聚合语义断言 + 3 次带违例
# 全量运行）、② 数组内过滤 + 未知规则名报错、③ 接线完整性（RULES ↔ check_ 函数集 ↔
# 探针覆盖集三处逐字相等）。首尾两次基线保持全量，不得带过滤器。
set -uo pipefail

ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
STRUCTURAL="$ROOT/tools/structural-test.sh"

CREATED=()       # 临时写入的文件（绝对路径，删除即还原）
CREATED_DIRS=()  # tmp_write 本次新建的目录（绝对路径；删掉空目录才算还原干净）
MODIFIED=()      # 就地改写的既有文件（绝对路径）
SAVED=()         # 与 MODIFIED 同序：改写前的逐字节备份
FAILURES=0

# 写入一个临时探针文件并登记，cleanup 时删除
tmp_write() { # $1 = 相对 ROOT 的路径，$2.. = 内容行
  local path="$ROOT/$1" dir; shift
  dir="$(dirname "$path")"
  [ -d "$dir" ] || CREATED_DIRS+=("$dir")   # 只登记本次新建的目录，既有目录不动
  mkdir -p "$dir"
  printf '%s\n' "$@" > "$path"
  CREATED+=("$path")
}

# 就地追加内容到既有文件，先备份，cleanup 时逐字节还原
inplace_append() { # $1 = 绝对路径，$2.. = 追加内容行（先备份，cleanup 时逐字节还原）
  local path="$1" backup; shift
  backup="$(mktemp "${TMPDIR:-/tmp}/structural-probe-backup-XXXXXX")"
  cp -a "$path" "$backup"
  MODIFIED+=("$path")
  SAVED+=("$backup")
  printf '%s\n' "$@" >> "$path"
}

# 就地删除文件中的一行，先备份，cleanup 时逐字节还原
inplace_delete() { # $1 = 绝对路径，$2 = 要删掉的行（整行逐字匹配；先备份，cleanup 时逐字节还原）
  local path="$1" line="$2" backup
  backup="$(mktemp "${TMPDIR:-/tmp}/structural-probe-backup-XXXXXX")"
  cp -a "$path" "$backup"
  MODIFIED+=("$path")
  SAVED+=("$backup")
  grep -vxF -- "$line" "$backup" > "$path" || true
}

# 删临时文件、还原就地改写文件并逐字节校验
cleanup() { # 幂等：删临时文件 + 还原就地改写文件，还原后逐字节校验
  local i path dir backup
  for path in "${CREATED[@]}"; do rm -f "$path"; done
  CREATED=()
  for dir in "${CREATED_DIRS[@]}"; do rmdir "$dir" 2>/dev/null || true; done
  CREATED_DIRS=()
  for i in "${!MODIFIED[@]}"; do
    path="${MODIFIED[$i]}"; backup="${SAVED[$i]}"
    cp -a "$backup" "$path"
    if ! cmp -s "$backup" "$path"; then
      echo "[失败] 自清理不成立：$path 未能还原为改写前内容" >&2
      FAILURES=$((FAILURES + 1))
    fi
    rm -f "$backup"
  done
  MODIFIED=()
  SAVED=()
}
trap cleanup EXIT

# 输出一条通过
report_ok() { echo "[通过] $1"; }
# 输出一条失败并计数
report_bad() { echo "[失败] $1" >&2; FAILURES=$((FAILURES + 1)); }

# ---------- 违例探针：每条 = 一个 write_probe_<id> 函数 + 一条 SPECS 记录 ----------
# SPECS 记录格式：id|期望命中的规则名|人类可读说明

# 注入违例：前端直连库（@prisma/client）
write_probe_frontend-boundary() {
  tmp_write "frontend/src/_structural-probe.ts" \
    "// 探针（临时，勿入库）：前端直连库" \
    "import { PrismaClient } from '@prisma/client';" \
    "export const client = new PrismaClient();"
}

  # 换行链式形态：单行正则取不到，靠折行二次判定兜住（C6 扩口径项 ③）
write_probe_spatial-orm-chain() {
  tmp_write "backend/geo-dict/src/_structural-probe.mjs" \
    "// 探针（临时，勿入库）：空间模型 ORM 写，拆成多行使单行正则失明" \
    "export function probe(prisma) {" \
    "  return prisma" \
    "    .geoDictLandBoundary" \
    "      .create({ data: { name: 'probe' } });" \
    "}"
}

  # C5 扩范围证据：e2e 的 .sh 用例形态同样在 supervision-sink 扫描范围内
write_probe_supervision-sink-sh() {
  tmp_write "e2e/cases/_structural-probe.sh" \
    "#!/usr/bin/env bash" \
    "# 探针（临时，勿入库）：依赖单向模块 supervision" \
    "node -e \"import('@natural-enforcement/supervision')\""
}

# 注入违例：跨模块深路径导入
write_probe_module-public-entry() {
  tmp_write "backend/case/src/_structural-probe.ts" \
    "// 探针（临时，勿入库）：跨模块深路径导入（表内依赖，但绕过公共出口）" \
    "import { ProbeThing } from '@natural-enforcement/identity/src/persistence/probe-thing.ts';" \
    "export const thing = new ProbeThing();"
}

# 注入违例：白名单外业务实体 model
write_probe_g1-model-allowlist() {
  inplace_append "$ROOT/backend/prisma/schema.prisma" \
    "// 探针（临时，勿入库）：白名单外业务实体" \
    "model ProbeBusinessCase {" \
    "  id String @id" \
    "  @@map(\"probe_business_case\")" \
    "}"
}

  # #210：参照数据只追加（ADR 0016）。就地改行即违例；改参照数据只能追加新版本。
write_probe_reference-data-no-mutation() {
  tmp_write "backend/geo-dict/src/_structural-probe-reference.ts" \
    "// 探针（临时，勿入库）：参照数据表就地改行（ADR 0016 只追加）" \
    "export function probe(prisma: { geoDictSourceCode: { update(input: unknown): unknown } }) {" \
    "  return prisma.geoDictSourceCode.update({ where: { id: 'probe' }, data: { name: 'probe' } });" \
    "}"
}

  # #237：人员层利害关系只追加。就地改行即违例。
write_probe_person-conflict-append-only() {
  tmp_write "backend/case/src/_structural-probe-conflict.ts" \
    "// 探针（临时，勿入库）：人员层利害关系就地改行（#237 只追加）" \
    "export function probe(prisma: { personConflictEvent: { update(input: unknown): unknown } }) {" \
    "  return prisma.personConflictEvent.update({ where: { id: 'probe' }, data: { status: 'rejected' } });" \
    "}"
}

  # #263：机关层利害关系只追加。就地改行即违例。
write_probe_agency-conflict-append-only() {
  tmp_write "backend/case/src/_structural-probe-agency-conflict.ts" \
    "// 探针（临时，勿入库）：机关层利害关系就地改行（#263 只追加）" \
    "export function probe(prisma: { caseAgencyConflict: { update(input: unknown): unknown } }) {" \
    "  return prisma.caseAgencyConflict.update({ where: { id: 'probe' }, data: { markedBy: 'probe' } });" \
    "}"
}

  # #236：违法记录与笔录不物理删除。ORM delete 即违例。
write_probe_investigation-record-no-delete() {
  tmp_write "backend/case/src/_structural-probe-investigation.ts" \
    "// 探针（临时，勿入库）：违法记录物理删除" \
    "export function probe(prisma: { caseViolationRecord: { delete(input: unknown): unknown } }) {" \
    "  return prisma.caseViolationRecord.delete({ where: { id: 'probe' } });" \
    "}"
}

  # #235：环节实例与迁移历史只追加。就地改行即违例。
write_probe_case-history-append-only() {
  tmp_write "backend/case/src/_structural-probe-history.ts" \
    "// 探针（临时，勿入库）：环节实例就地改行（#235 只追加）" \
    "export function probe(prisma: { caseStageInstance: { update(input: unknown): unknown } }) {" \
    "  return prisma.caseStageInstance.update({ where: { id: 'probe' }, data: { status: 'completed' } });" \
    "}"
}

  # C7 扩范围证据：integration 层同样在设施入口规则范围内（装配层不豁免形态类规则）
write_probe_queue-in-integration() {
  tmp_write "integration/_structural-probe.ts" \
    "// 探针（临时，勿入库）：装配层裸依赖队列 SDK" \
    "import { Queue } from 'bullmq';" \
    "export const q = new Queue('probe');"
}

  # 同类洞的最后一处：空间纪律此前只扫 backend/ 与 packages/，装配层用 ORM 写空间模型
write_probe_spatial-in-integration() {
  # 同样绕过 ST_Transform 口径（执行纪律 2），现在也在范围内
  tmp_write "integration/_structural-probe-spatial.ts" \
    "// 探针（临时，勿入库）：装配层对空间模型调 ORM 写（执行纪律 2 禁止的形态）" \
    "export function probe(store: { geoDictSurveyPoint: { delete(q: unknown): unknown } }) {" \
    "  return store.geoDictSurveyPoint.delete({ where: { id: 'probe' } });" \
    "}"
}

  # #211：线索空间部件归 case 模块（规格 F）。它含 Unsupported 空间字段，ORM 写同样绕过
write_probe_clue-spatial-orm-write() {
  # ST_Transform 口径（执行纪律 2），故空间纪律的模型集扩到它与命中集表。
  tmp_write "backend/case/src/_structural-probe-clue-spatial.ts" \
    "// 探针（临时，勿入库）：线索空间部件 ORM 写（执行纪律 2 禁止的形态）" \
    "export function probe(prisma: { clueSpatialPart: { create(input: unknown): unknown } }) {" \
    "  return prisma.clueSpatialPart.create({ data: { id: 'probe' } });" \
    "}"
}

# 注入违例：包外引用留痕委托
write_probe_audit-facility-entry() {
  tmp_write "integration/_structural-probe-audit.ts" \
    "// 探针（临时，勿入库）：包外引用留痕委托" \
    "export function probe(db: { auditTrail: { create(input: unknown): Promise<unknown> } }) {" \
    "  return db.auditTrail.create({ data: { action: 'authz.denied' } });" \
    "}"
}

# 注入违例：启动包第二个文件引用身份数据库适配器
write_probe_server-adapter-file() {
  tmp_write "backend/server/src/_structural-probe-adapter.ts" \
    "// 探针（临时，勿入库）：第二个文件引用身份数据库适配器" \
    "import { PrismaIdentityStore } from '../../identity/src/persistence/prisma-identity-store.ts';" \
    "export const store = PrismaIdentityStore;"
}

  # #211：案件聚合模块的线索表适配器同样只在启动包的装配根里被引用（豁免名单收紧到
write_probe_case-adapter-file() {
  # 文件 + specifier 两条）。名单外的第二个文件引用照样判红。
  tmp_write "backend/server/src/_structural-probe-case-adapter.ts" \
    "// 探针（临时，勿入库）：第二个文件引用案件聚合模块的数据库适配器" \
    "import { PrismaClueStore } from '../../case/src/persistence/prisma-clue-store.ts';" \
    "export const store = PrismaClueStore;"
}

  # 豁免必须tight：名单外的深路径导入仍要判红，否则豁免等于把整层放行
write_probe_exempt-tightness() {
  inplace_append "$ROOT/integration/e2-access-matrix.test.ts" \
    "// 探针（临时，勿入库）：豁免名单外的跨模块深路径导入" \
    "import { ProbeThing } from '../backend/geo-dict/src/internal.ts';" \
    "export const thing = ProbeThing;"
}

  # compose 写字面量密钥（#120）
write_probe_compose-literal-secret() {
  inplace_append "$ROOT/infra/docker-compose.yml" \
    "  probe:" \
    "    environment:" \
    "      RUSTFS_SECRET_KEY: probe-literal"
}

  # compose 引用清单外变量名（#120）
write_probe_compose-unlisted-name() {
  inplace_append "$ROOT/infra/docker-compose.yml" \
    "  probe:" \
    "    image: \"\${PROBE_UNLISTED_IMAGE:?probe}\""
}

  # CI 给密钥写 || 回落字面量（#120 之前的写法）
write_probe_ci-literal-secret() {
  inplace_append "$ROOT/.github/workflows/ci.yml" \
    "      - name: probe" \
    "        env:" \
    "          POSTGRES_PASSWORD: \${{ secrets.DEV_POSTGRES_PASSWORD || 'probe-literal' }}" \
    "        run: true"
}

  # CI 的 env 出现清单外变量名（#120）
write_probe_ci-unlisted-name() {
  inplace_append "$ROOT/.github/workflows/ci.yml" \
    "      - name: probe" \
    "        env:" \
    "          PROBE_UNLISTED: x" \
    "        run: true"
}

  # compose 环境列表项带引号的字面量密钥（Copilot 评审：- "NAME=value" 形式）
write_probe_compose-quoted-list-secret() {
  inplace_append "$ROOT/infra/docker-compose.yml" \
    "  probe:" \
    "    environment:" \
    "      - \"POSTGRES_PASSWORD=probe-literal\""
}

  # DATABASE_URL 含口令，按密钥处理，不许写字面量连接串（Copilot 评审）
write_probe_compose-database-url-literal() {
  inplace_append "$ROOT/infra/docker-compose.yml" \
    "  probe:" \
    "    environment:" \
    "      DATABASE_URL: \"postgresql://probe:probe-literal@db:5432/probe\""
}

  # CI run 里的行内 shell 赋值写字面量密钥（Copilot 评审）
write_probe_ci-run-assignment() {
  inplace_append "$ROOT/.github/workflows/ci.yml" \
    "      - name: probe" \
    "        run: POSTGRES_PASSWORD=probe-literal true"
}

  # CI 经 env 上下文引用清单外变量名（Copilot 评审）
write_probe_ci-env-context() {
  inplace_append "$ROOT/.github/workflows/ci.yml" \
    "      - name: probe" \
    "        run: echo \"\${{ env.PROBE_UNLISTED }}\""
}

  # 把一条「待实现」登记注释掉：Vitest 不再登记，结构测试也不得计入（Copilot 评审）
write_probe_user-lock-assertion-commented() {
  inplace_delete "$ROOT/backend/server/src/user-lock.test.ts" \
    "  it.todo('USER-LOCK-L4 037：待实现');"
  printf '%s\n' "// it.todo('USER-LOCK-L4 037：待实现');" >> "$ROOT/backend/server/src/user-lock.test.ts"
}

  # 删掉一条「待实现」登记（#120：锁清单断言编号在测试代码里找不到即判红）
write_probe_user-lock-assertion-deleted() {
  inplace_delete "$ROOT/backend/server/src/user-lock.test.ts" \
    "  it.todo('USER-LOCK-L4 037：待实现');"
}

  # 前端改用声明式 <BrowserRouter>（#122：只许 data 模式）
write_probe_frontend-browser-router() {
  tmp_write "frontend/src/__probe_router.tsx" \
    "import { BrowserRouter } from 'react-router';" \
    "export const probe = BrowserRouter;"
}

  # 前端引入框架模式开发插件 @react-router/dev（#122）
write_probe_frontend-router-dev-plugin() {
  inplace_append "$ROOT/frontend/package.json" \
    '  "@react-router/dev": "8.4.0"'
}

# ---------- #170 补齐覆盖：以下 11 条各对应一条此前没有违例用例的兜底闸规则 ----------
# 构造纪律：每条违例在全闸下只命中目标规则一条（[FAIL] 行数 == 1）。落点按各规则自己的扫描
# 范围挑，避开三处连带：① 不以 supervision 为导入目标（任何模块 import supervision 都会连带
# supervision-sink）；② 不落 packages/storage（该包对存储 SDK 自带豁免，落进去就证不了红）；
# ③ 不写 bullmq/ioredis（那是 queue-facility-entry 的判据）。全部 tmp_write 新建文件，不改既有文件。

  # approval 的允许列 = shield identity case，deadline 属表外依赖。
write_probe_approval-deps() {
  # 用包名根导入（单斜杠）：module-public-entry 只拦 @natural-enforcement/*/*，不会连带命中。
  tmp_write "backend/approval/src/_structural-probe-deps.ts" \
    "// 探针（临时，勿入库）：approval 表外依赖业务模块 deadline" \
    "import { probe } from '@natural-enforcement/deadline';" \
    "export const thing = probe;"
}

  # case 的允许列 = shield identity geo-dict，approval 属表外依赖
write_probe_case-deps() {
  tmp_write "backend/case/src/_structural-probe-deps.ts" \
    "// 探针（临时，勿入库）：case 表外依赖业务模块 approval" \
    "import { probe } from '@natural-enforcement/approval';" \
    "export const thing = probe;"
}

  # deadline 的允许列 = shield case approval geo-dict，identity 属表外依赖
write_probe_deadline-deps() {
  tmp_write "backend/deadline/src/_structural-probe-deps.ts" \
    "// 探针（临时，勿入库）：deadline 表外依赖业务模块 identity" \
    "import { probe } from '@natural-enforcement/identity';" \
    "export const thing = probe;"
}

  # geo-dict 的允许列只有 shield，identity 属表外依赖
write_probe_geo-dict-deps() {
  tmp_write "backend/geo-dict/src/_structural-probe-deps.ts" \
    "// 探针（临时，勿入库）：geo-dict 表外依赖业务模块 identity" \
    "import { probe } from '@natural-enforcement/identity';" \
    "export const thing = probe;"
}

  # identity 的允许列 = shield audit，case 属表外依赖
write_probe_identity-deps() {
  tmp_write "backend/identity/src/_structural-probe-deps.ts" \
    "// 探针（临时，勿入库）：identity 表外依赖业务模块 case" \
    "import { probe } from '@natural-enforcement/case';" \
    "export const thing = probe;"
}

  # shield 不许依赖任何业务模块。落 packages/shield 内（本规则的唯一扫描根）；
write_probe_shield-no-business-dep() {
  # packages/ 不在 module-public-entry 的 find 范围里，故不连带。
  tmp_write "packages/shield/src/_structural-probe-business-dep.ts" \
    "// 探针（临时，勿入库）：shield 依赖业务模块" \
    "import { probe } from '@natural-enforcement/identity';" \
    "export const thing = probe;"
}

  # 绕过 shield 公共出口的深路径引用。落 packages/queue 而非 backend/：本规则扫
write_probe_shield-single-entry() {
  # backend/frontend/e2e/packages，而 module-public-entry 只扫 backend/frontend/e2e/integration
  # ——同样的深路径导入落在 backend/ 会一次命中两条规则。此处不写 bullmq/ioredis，故不连带
  # queue-facility-entry（该规则对 packages/queue 本就豁免）。
  tmp_write "packages/queue/src/_structural-probe-shield-entry.ts" \
    "// 探针（临时，勿入库）：绕过 shield 公共出口的深路径引用" \
    "import { probe } from '@natural-enforcement/shield/src/internal.ts';" \
    "export const thing = probe;"
}

  # 业务侧裸依赖存储 SDK。@aws-sdk/* 不是 @natural-enforcement/* 也不是相对路径，
write_probe_storage-facility-entry() {
  # specifiers_of 取不到，故 check_row 与 module-public-entry 都不连带。
  tmp_write "backend/case/src/_structural-probe-storage.ts" \
    "// 探针（临时，勿入库）：业务侧裸依赖存储 SDK" \
    "import { S3Client } from '@aws-sdk/client-s3';" \
    "export const client = S3Client;"
}

  # supervision 的允许列 = shield identity case，approval 属表外依赖。
write_probe_supervision-deps() {
  # 本文件归属 supervision，supervision-sink 对 home == supervision 直接跳过，故不连带。
  tmp_write "backend/supervision/src/_structural-probe-deps.ts" \
    "// 探针（临时，勿入库）：supervision 表外依赖业务模块 approval" \
    "import { probe } from '@natural-enforcement/approval';" \
    "export const thing = probe;"
}

  # 出现跨域弱引用入口名但未从 shield 导入。文件里无任何 specifier，
write_probe_weak-reference-entry() {
  # 故 check_row 与 module-public-entry 都取不到东西，不连带。
  tmp_write "backend/case/src/_structural-probe-weak-ref.ts" \
    "// 探针（临时，勿入库）：出现跨域弱引用入口名但未从 shield 导入" \
    "export const probe = requireCrossDomainReference;"
}

  # 截图全集多出状态键之外的文件名。规则只比文件名，不校验 PNG 格式与画面。
write_probe_screenshot-full-set() {
  # 落点是 docs/screens/manifest 下的新清单文件：截图本体已迁出版本控制，规则改读清单，
  # 故探针也往清单里塞一个越界名。cleanup 把该文件一并删掉，树回到干净状态。
  tmp_write "docs/screens/manifest/_structural-probe.txt" \
    "probe-extra.png"
}


  # #220：界面文案禁「捞回」。生产源码字面量出现即红。
write_probe_ui-copy-discipline() {
  tmp_write "frontend/src/__probe_ui_copy.tsx" \
    "export const probeLabel = '捞回';"
}

  # #234：立案呈批批准路径之外的 server 文件调用不予立案落点服务即红。
write_probe_no-case-landing-entry() {
  tmp_write "backend/server/src/_structural-probe-no-case.ts" \
    "// 探针（临时，勿入库）：绕过立案呈批调用不予立案落点服务" \
    "export const probe = 'recordNoCaseFromFilingApproval';"
}

# ---------- 注释规范（docs/agents/code-comments.md）：注释检查的违例探针 ----------
# 注入落点位于 COMMENT_SCOPE 之内（backend/approval/src），探针文件带「探针（临时，勿入库）」字样。
write_probe_source-comment-export() {
  # 导出符号缺紧邻注释：文件头与代码行齐全，只缺导出符号的注释。
  tmp_write "backend/approval/src/_structural-probe-export.ts" \
    "// 用途：探针（临时，勿入库）" \
    "const probeNote = 'probe';" \
    "export const probeExport = 1;"
}

  # 源文件缺文件头「用途：」：首个代码行之前没有该标记。导出符号已有注释，单独触发文件头规则。
write_probe_source-comment-header() {
  tmp_write "backend/approval/src/_structural-probe-header.ts" \
    "const probeNote = 'probe';" \
    "/** 探针导出：文件头缺用途。 */" \
    "export const probeHeader = 1;"
}

  # 测试 describe 缺紧邻注释：测试文件不要求文件头，只检查 describe 的上一行。
write_probe_source-comment-describe() {
  tmp_write "backend/approval/src/_structural-probe-describe.test.ts" \
    "import { describe, expect, it } from 'vitest';" \
    "describe('探针用例组', () => {" \
    "  it('占位', () => {" \
    "    expect(1).toBe(1);" \
    "  });" \
    "});"
}

  # 路由缺操作码注释：控制器路由的紧邻上一行没有「操作码」说明。
write_probe_source-comment-route() {
  tmp_write "backend/approval/src/_structural-probe-route.ts" \
    "// 用途：探针（临时，勿入库）" \
    "import { Controller, Get } from '@nestjs/common';" \
    "/** 探针控制器：路由缺少操作码说明。 */" \
    "@Controller('probe')" \
    "export class ProbeController {" \
    "  @Get('x')" \
    "  list(): string {" \
    "    return 'x';" \
    "  }" \
    "}"
}

  # 路由操作码不在登记表：注释写了操作码，但它不是 packages/shield/src/contract/opcode.ts 的键。
write_probe_source-comment-route-opcode() {
  tmp_write "backend/approval/src/_structural-probe-route-opcode.ts" \
    "// 用途：探针（临时，勿入库）" \
    "import { Controller, Get } from '@nestjs/common';" \
    "/** 探针控制器：操作码不在登记表。 */" \
    "@Controller('probe')" \
    "export class ProbeController {" \
    "  // 探针路由；操作码 no.such.opcode；无例外。" \
    "  @Get('x')" \
    "  list(): string {" \
    "    return 'x';" \
    "  }" \
    "}"
}

  # 注释里写了 import 样式文字：依赖矩阵规则按文本扫 specifier，不区分注释与代码，会把它当成真实导入。
write_probe_source-comment-importlike() {
  tmp_write "backend/approval/src/_structural-probe-importlike.ts" \
    "// 用途：探针（临时，勿入库）" \
    "// 反例：import { X } from '@natural-enforcement/case/src/internal/x.ts';" \
    "/** 探针导出：注释含 import 样式文字。 */" \
    "export const probeImportLike = 1;"
}

  # shell 函数缺紧邻注释：文件头齐全，只缺函数定义上一行的注释（set -u 隔开头部注释与函数）。
write_probe_shell-comment-function() {
  tmp_write "backend/approval/src/_structural-probe-shell.sh" \
    "#!/usr/bin/env bash" \
    "# 用途：探针（临时，勿入库）" \
    "set -u" \
    "probe_fn() { echo probe; }"
}

  # 注释引用的仓库路径未入库：路径不在 git ls-files 清单中。
write_probe_comment-path-refs() {
  tmp_write "backend/approval/src/_structural-probe-path.ts" \
    "// 用途：探针（临时，勿入库）" \
    "const probePathNote = 'probe';" \
    "/** 探针导出：注释引用不存在的路径。依据 docs/__structural-probe__/missing.md */" \
    "export const probePath = 1;"
}

# 期限规则的 basis 未指向判据或业务决策：追加一条自由文字 basis。
write_probe_criteria-traceability() {
  inplace_append "backend/deadline/src/rules.ts" "    basis: '自由文字，没有判据编号',"
}

SPECS=(
  "frontend-boundary|frontend-boundary|前端直连库（@prisma/client）"
  "spatial-orm-chain|spatial-no-orm-mutation|空间模型 ORM 写（换行链式）"
  "supervision-sink-sh|supervision-sink|单向模块被依赖（e2e 的 .sh 形态）"
  "module-public-entry|module-public-entry|跨模块深路径导入"
  "g1-model-allowlist|g1-model-allowlist|白名单外业务实体 model"
  "queue-in-integration|queue-facility-entry|装配层裸依赖队列 SDK（integration 已在范围内）"
  "spatial-in-integration|spatial-no-orm-mutation|装配层空间模型 ORM 写（空间纪律也扫 integration/e2e）"
  "exempt-tightness|module-public-entry|豁免名单外的深路径导入（豁免不放行整层）"
  "audit-facility-entry|audit-facility-entry|包外引用留痕委托"
  "server-adapter-file|module-public-entry|启动包第二个文件引用身份数据库适配器"
  "case-adapter-file|module-public-entry|启动包第二个文件引用案件聚合数据库适配器"
  "compose-literal-secret|runtime-manifest|compose 写字面量密钥"
  "compose-unlisted-name|runtime-manifest|compose 引用清单外变量名"
  "ci-literal-secret|runtime-manifest|CI 密钥带 || 回落字面量"
  "ci-unlisted-name|runtime-manifest|CI 出现清单外变量名"
  "user-lock-assertion-deleted|user-lock-assertions|删掉一条锁清单「待实现」登记"
  "compose-quoted-list-secret|runtime-manifest|compose 环境列表项带引号的字面量密钥"
  "compose-database-url-literal|runtime-manifest|compose 写字面量 DATABASE_URL 连接串"
  "ci-run-assignment|runtime-manifest|CI run 行内赋值写字面量密钥"
  "ci-env-context|runtime-manifest|CI 经 env 上下文引用清单外变量名"
  "user-lock-assertion-commented|user-lock-assertions|注释掉一条锁清单「待实现」登记"
  "frontend-browser-router|frontend-router-mode|前端使用声明式 BrowserRouter"
  "frontend-router-dev-plugin|frontend-router-mode|前端依赖框架模式插件 @react-router/dev"
  # #170 补齐覆盖：以下 11 条对应此前没有违例用例的规则；id 与目标规则同名（一条规则一条用例）
  "approval-deps|approval-deps|approval 表外依赖业务模块 deadline"
  "case-deps|case-deps|case 表外依赖业务模块 approval"
  "deadline-deps|deadline-deps|deadline 表外依赖业务模块 identity"
  "geo-dict-deps|geo-dict-deps|geo-dict 表外依赖业务模块 identity"
  "identity-deps|identity-deps|identity 表外依赖业务模块 case"
  "shield-no-business-dep|shield-no-business-dep|shield 依赖业务模块 identity"
  "shield-single-entry|shield-single-entry|绕过 shield 公共出口的深路径引用"
  "storage-facility-entry|storage-facility-entry|业务侧裸依赖存储 SDK @aws-sdk/client-s3"
  "supervision-deps|supervision-deps|supervision 表外依赖业务模块 approval"
  "weak-reference-entry|weak-reference-entry|跨域弱引用入口名未从 shield 导入"
  "screenshot-full-set|screenshot-full-set|截图全集多出状态键之外的文件名"
  "ui-copy-discipline|ui-copy-discipline|界面文案字面量出现「捞回」（#220）"
  # #210 新增规则：参照数据只追加的机器兜底。
  "reference-data-no-mutation|reference-data-no-mutation|参照数据表就地改行（ADR 0016 只追加）"
  # #235：环节实例与迁移历史只追加。
  "case-history-append-only|case-history-append-only|环节实例或迁移历史就地改行（#235 只追加）"
  # #237：人员层利害关系、回避决定、调查继续登记只追加。
  "person-conflict-append-only|person-conflict-append-only|人员层利害关系就地改行（#237 只追加）"
  # #263：机关层利害关系勾选只追加。
  "agency-conflict-append-only|agency-conflict-append-only|机关层利害关系就地改行（#263 只追加）"
  "investigation-record-no-delete|investigation-record-no-delete|违法记录或笔录物理删除"
  # #211：线索空间三表归 case 模块，空间纪律的模型集扩到线索空间部件与命中集表。
  "clue-spatial-orm-write|spatial-no-orm-mutation|线索空间部件 ORM 写（#211 新空间表禁 ORM 写）"
  # #234：server 层只有立案呈批批准路径能调用不予立案落点服务。
  "no-case-landing-entry|no-case-landing-entry|server 层第二个文件调用 recordNoCaseFromFilingApproval"
  # 注释规范（docs/agents/code-comments.md）：COMMENT_SCOPE 内的注释机器检查。
  "source-comment-export|source-comment-coverage|导出符号缺紧邻注释"
  "source-comment-header|source-comment-coverage|源文件缺文件头「用途：」"
  "source-comment-describe|source-comment-coverage|测试 describe 缺紧邻注释"
  "source-comment-route|source-comment-coverage|路由缺操作码注释"
  "source-comment-route-opcode|source-comment-coverage|路由操作码不在登记表"
  "source-comment-importlike|source-comment-coverage|注释里含 import 样式文字（会被依赖矩阵规则误判）"
  "shell-comment-function|shell-comment-coverage|shell 函数缺紧邻注释"
  "comment-path-refs|comment-path-refs|注释引用的仓库路径未入库"
  "criteria-traceability|criteria-traceability|期限规则的 basis 未指向判据或业务决策"
)

# ---------- 护栏①（#171）动态层：带违例的整闸全量运行，三族各取一条 ----------
# 逐条用例改单规则跑后，只证明「这条规则自己能红」；「有违例 ⇒ 整闸退出码 1 且点名
# 失败规则」这一聚合性质由本组补回。复用既有 write_probe_* 函数（同一时刻只有一个违例
# 在场，与逐条用例互不干扰）：import 形态类 / 清单契约类 / 形态入口类各一条。
GATE_RED_SPECS=(
  "module-public-entry|module-public-entry|import 形态类：跨模块深路径导入下整闸变红"
  "compose-literal-secret|runtime-manifest|清单契约类：compose 字面量密钥下整闸变红"
  "g1-model-allowlist|g1-model-allowlist|形态入口类：白名单外 model 下整闸变红"
)

# $1 = 说明，$2 = 期望规则名，$3 = 整闸输出，$4 = 整闸退出码
assert_gate_red() {
  local label="$1" rule="$2" out="$3" rc="$4"
  if [ "$rc" -ne 1 ]; then
    report_bad "整闸变红/$label：带违例的整闸全量运行退出码 = $rc，期望 1（聚合语义失效）"
    grep -E '^\[(OK|FAIL)\]' <<< "$out" | sed 's/^/    /' >&2
    return
  fi
  if ! grep -qE "^\[FAIL\] ${rule}[：:]" <<< "$out"; then
    report_bad "整闸变红/$label：整闸判红了，但输出没点名目标规则 $rule"
    grep -E '^\[FAIL\]' <<< "$out" | sed 's/^/    /' >&2
    return
  fi
  if ! grep -q '^结构测试：存在失败规则' <<< "$out"; then
    report_bad "整闸变红/$label：整闸判红了，但收尾行不是「存在失败规则」语义"
    tail -n 3 <<< "$out" | sed 's/^/    /' >&2
    return
  fi
  report_ok "整闸变红/$label：整闸退出码 1，点名 $rule，收尾行「存在失败规则」"
}

# 护栏①静态层：核读闸源码的聚合语义。四条件合计 = 「任一规则判红 ⇒ 整闸跑完全部规则、
# 退出码 1、失败规则被点名」，对 RULES 里全部规则统一成立（毫秒级，每次探针都跑）。
# 条件：① 派发是 for rule in "${RULES[@]}" 循环形态；② 循环体内无 break/exit（过滤与
# 派发之外不得有第三种行）；③ note_fail 写全局 FAIL=1（FAIL 初值 0 也在顶层）；
# ④ 脚本末尾是 exit "$FAIL"。
assert_gate_aggregation_static() {
  local src="$STRUCTURAL" block
  block="$(awk '/^for rule in "\$\{RULES\[@\]\}"; do$/{f=1} f{print} f&&/^done$/{exit}' "$src")"
  if [ -z "$block" ]; then
    report_bad "护栏①静态：闸里找不到 for rule in \"\${RULES[@]}\" 派发循环（聚合语义失去唯一载体）"
    return
  fi
  if ! grep -qxF '  "check_$rule"' <<< "$block"; then
    report_bad "护栏①静态：派发循环体内没有按名派发 \"check_\$rule\""
    return
  fi
  if grep -qE '(^|[[:space:]])(break|exit)([[:space:]]|$)' <<< "$block"; then
    report_bad "护栏①静态：派发循环体内出现 break/exit（第一条失败即早退，后续规则永远不跑）"
    grep -nE '(^|[[:space:]])(break|exit)([[:space:]]|$)' <<< "$block" | sed 's/^/    /' >&2
    return
  fi
  # 循环体只许两种行：--rule 过滤行（护栏②要求它只能在这里）与按名派发行。
  # 注意不能用 grep -qv 判「存在第三种行」：-v 的反选语义下 -q 极易写反，这里按计数判定。
  local unexpected
  unexpected="$(awk 'NR>1 && !/^done$/ { print }' <<< "$block" \
    | grep -vxF -e '  [ -n "$RULE_FILTER" ] && [ "$rule" != "$RULE_FILTER" ] && continue' \
                -e '  "check_$rule"' | grep -c . || true)"
  if [ "$unexpected" -ne 0 ]; then
    report_bad "护栏①静态：派发循环体内出现过滤与派行之外的第三种行（逐行核对该行是否绕过聚合语义）"
    awk 'NR>1 && !/^done$/ { print }' <<< "$block" \
      | grep -vxF -e '  [ -n "$RULE_FILTER" ] && [ "$rule" != "$RULE_FILTER" ] && continue' \
                  -e '  "check_$rule"' | sed 's/^/    /' >&2
    return
  fi
  if ! grep -qE '^note_fail\(\)[[:space:]]*\{.*FAIL=1' "$src"; then
    report_bad "护栏①静态：note_fail 不再写全局 FAIL=1（判红与退出码脱钩）"
    return
  fi
  if ! grep -qxF 'FAIL=0' "$src"; then
    report_bad "护栏①静态：顶层找不到 FAIL=0 初值（聚合标志失去初值）"
    return
  fi
  if [ "$(tail -n 1 "$src")" != 'exit "$FAIL"' ]; then
    report_bad "护栏①静态：脚本末尾不是 exit \"\$FAIL\"（判红不再决定退出码）"
    return
  fi
  report_ok "护栏①静态：派发循环形态、循环体无提前退出、note_fail 写全局 FAIL、末尾 exit \"\$FAIL\" 四条件成立"
}

# 护栏②静态层：--rule 过滤只许落在 RULES 派发循环体内；循环外不存在第二条按名派发入口。
# 为什么：若过滤/派发绕开 RULES 数组，探针可能为一个在真实闸里从不执行的死规则出具
# 「活规则」证明（失败模式 B，见 docs/research/probe-single-rule-guardrails.md §3.2）。
assert_filter_in_rules_loop_static() {
  local src="$STRUCTURAL" total in_loop
  total="$(grep -cF '"check_$rule"' "$src" || true)"
  in_loop="$(awk '/^for rule in "\$\{RULES\[@\]\}"; do$/{f=1} f{print} f&&/^done$/{exit}' "$src" \
    | grep -cF '"check_$rule"' || true)"
  if [ "$total" -ne 1 ] || [ "$in_loop" -ne 1 ]; then
    report_bad "护栏②静态：按名派发 \"check_\$rule\" 全闸应恰好 1 处且必须在 RULES 循环体内（实际：全闸 $total 处，循环内 $in_loop 处）"
    return
  fi
  if ! awk '/^for rule in "\$\{RULES\[@\]\}"; do$/{f=1} f{print} f&&/^done$/{exit}' "$src" \
      | grep -qF '[ "$rule" != "$RULE_FILTER" ]'; then
    report_bad "护栏②静态：RULES 派发循环体内没有 RULE_FILTER 过滤行（过滤落在数组之外 = 绕过 RULES）"
    return
  fi
  report_ok "护栏②静态：按名派发全闸唯一且在 RULES 循环体内，过滤行也在同一循环体内"
}

# 护栏②动态层：未知规则名必须 [FAIL] 未知规则名 + 非 0 退出，且绝不打印「全部规则通过」。
# 不报错的失败模式已实测：静默跑 0 条规则、打印「全部规则通过」、退出 0。
assert_unknown_rule_rejected() {
  local bogus="no-such-rule-probe" out rc
  out="$("$STRUCTURAL" --rule "$bogus" 2>&1)"; rc=$?
  if [ "$rc" -eq 0 ]; then
    report_bad "护栏②动态：未知规则名 $bogus 未被拒绝（退出码 0）"
    sed 's/^/    /' <<< "$out" >&2
    return
  fi
  if ! grep -qxF "[FAIL] 未知规则名：$bogus（不在 RULES 数组内，可选名见 --list-rules）" <<< "$out"; then
    report_bad "护栏②动态：未知规则名 $bogus 退出了非 0，但输出没有点名「[FAIL] 未知规则名」"
    sed 's/^/    /' <<< "$out" >&2
    return
  fi
  if grep -q '全部规则通过' <<< "$out"; then
    report_bad "护栏②动态：未知规则名 $bogus 的运行打印了「全部规则通过」（静默通过，误导诊断）"
    return
  fi
  report_ok "护栏②动态：未知规则名 $bogus 被拒绝（退出码 $rc，输出点名未知规则名，未打印全绿）"
}

# 集合差：$1、$2 = 已排序去重的清单文件；输出「在 $1 不在 $2」的行
set_diff() { comm -23 "$1" "$2"; }

# 护栏③：接线完整性。三处集合逐字相等：RULES 数组（经闸的只读模式 --list-rules 取得，
# 单一事实源，不 sed 解析闸源码）↔ 闸内 check_ 函数定义集（减去显式声明的 HELPERS，
# 经 --list-helpers 取得）↔ 探针 SPECS 的目标规则集。任一处脱节即报红：
# 删规则 → 死函数；加函数不进 RULES → 死规则；删探针用例 → 规则失去负例证据。
check_wiring() {
  local src="$STRUCTURAL" td rules helpers funcs union covered dead dangling overlap missing untested
  td="$(mktemp -d "${TMPDIR:-/tmp}/structural-probe-wiring-XXXXXX")"
  "$src" --list-rules | sort -u > "$td/rules"
  "$src" --list-helpers | sort -u > "$td/helpers"
  grep -oE '^check_[A-Za-z0-9_-]+\(\)' "$src" | sed -E 's/^check_//; s/\(\)$//' | sort -u > "$td/funcs"
  cat "$td/rules" "$td/helpers" | sort -u > "$td/union"
  printf '%s\n' "${SPECS[@]}" | cut -d'|' -f2 | sort -u > "$td/covered"
  rules="$(wc -l < "$td/rules" | xargs)"
  helpers="$(wc -l < "$td/helpers" | xargs)"
  funcs="$(wc -l < "$td/funcs" | xargs)"
  if [ "$rules" -eq 0 ]; then
    report_bad "接线完整性：--list-rules 输出为空（规则集取不到，后续断言全部失效）"
    rm -rf "$td"
    return
  fi
  dead="$(set_diff "$td/funcs" "$td/union" | tr '\n' ' ' | sed 's/ $//')"
  if [ -n "$dead" ]; then
    report_bad "接线完整性：存在 check_ 函数但未接入 RULES 数组、也未声明进 HELPERS（写了但从未接线的死规则）：$dead"
  fi
  dangling="$(set_diff "$td/rules" "$td/funcs" | tr '\n' ' ' | sed 's/ $//')"
  if [ -n "$dangling" ]; then
    report_bad "接线完整性：RULES 数组里的规则名找不到对应 check_ 函数定义（悬空规则名）：$dangling"
  fi
  overlap="$(comm -12 "$td/rules" "$td/helpers" | tr '\n' ' ' | sed 's/ $//')"
  if [ -n "$overlap" ]; then
    report_bad "接线完整性：同名条目同时出现在 RULES 与 HELPERS（helper 不是规则，不得进 RULES）：$overlap"
  fi
  missing="$(set_diff "$td/rules" "$td/covered" | tr '\n' ' ' | sed 's/ $//')"
  if [ -n "$missing" ]; then
    report_bad "接线完整性：这些规则没有违例用例（新增规则必须同时补一条探针用例）：$missing"
  fi
  untested="$(set_diff "$td/covered" "$td/rules" | tr '\n' ' ' | sed 's/ $//')"
  if [ -n "$untested" ]; then
    report_bad "接线完整性：探针用例的目标规则不在 RULES 数组内（用例证明不了任何在跑的规则）：$untested"
  fi
  if [ -z "$dead$dangling$overlap$missing$untested" ]; then
    report_ok "接线完整性：RULES（$rules 条）== check_ 函数集（$funcs 个，减 HELPERS $helpers 个）== 探针目标规则集，三处逐字相等"
  fi
  rm -rf "$td"
}

# $1 = 说明，$2 = 期望规则名，$3 = 结构测试输出，$4 = 结构测试退出码
assert_rule_red() {
  local label="$1" rule="$2" out="$3" rc="$4"
  if [ "$rc" -ne 1 ]; then
    report_bad "$label：违例未被判红（结构测试退出码 = $rc，期望 1）→ 该规则恒绿，兜底无效"
    echo "$out" | grep -E '^\[(OK|FAIL)\]' | sed 's/^/    /' >&2
    return
  fi
  if ! grep -qE "^\[FAIL\] ${rule}[：:]" <<< "$out"; then
    report_bad "$label：结构测试判红了，但没命中期望规则 $rule（实际判红项见下）"
    grep -E '^\[FAIL\]' <<< "$out" | sed 's/^/    /' >&2
    return
  fi
  report_ok "$label：$rule 确实把整体判成红"
}

# 红探针入口：接线检查、基线、逐条探针、整闸变红、自清理与护栏断言
main() {
  local spec id rule label out rc got covered
  echo "结构测试红探针（负例证据：逐条违例源码必须能把兜底闸判红）"

  # 0. 护栏③接线完整性（#171）：三处集合逐字相等。放在最前：接线断了，
  #    后面的逐条证明全部失真，先大声失败（负例自证也走这条快速路径）。
  check_wiring

  # 1. 基线：干净源码必须全绿，否则后面的「变红」证明不了任何事（全量，不带过滤器）
  out="$("$STRUCTURAL" 2>&1)"; got=$?
  if [ "$got" -ne 0 ]; then
    report_bad "基线不成立：无违例时结构测试已判红（退出码 $got），探针失去判别力"
    grep -E '^\[FAIL\]' <<< "$out" | sed 's/^/    /' >&2
    echo "红探针结论：基线即红，先修结构测试本身。" >&2
    return 1
  fi
  report_ok "基线：无违例时结构测试全绿"

  # 2. 逐条探针：写违例 → 单规则跑结构测试 → 还原 → 判定（还原先于判定，互不污染）。
  #    #171 单规则化：只跑目标规则，退出码 1 只可能来自目标规则，逐条断言比全闸跑更强。
  for spec in "${SPECS[@]}"; do
    IFS='|' read -r id rule label <<< "$spec"
    "write_probe_$id"
    out="$("$STRUCTURAL" --rule "$rule" 2>&1)"; got=$?
    cleanup
    assert_rule_red "$label" "$rule" "$out" "$got"
  done

  # 3. 护栏①动态层（#171）：带违例的整闸全量运行（不带过滤器），三族各一条。
  #    断言整闸退出码 1、输出点名目标规则、收尾行是「存在失败规则」语义。
  for spec in "${GATE_RED_SPECS[@]}"; do
    IFS='|' read -r id rule label <<< "$spec"
    "write_probe_$id"
    out="$("$STRUCTURAL" 2>&1)"; got=$?
    cleanup
    assert_gate_red "$label" "$rule" "$out" "$got"
  done

  # 4. 收尾基线：全部还原后必须回到全绿（自清理的最终证据；全量，不带过滤器）
  out="$("$STRUCTURAL" 2>&1)"; got=$?
  if [ "$got" -ne 0 ]; then
    report_bad "自清理不成立：探针结束后结构测试仍判红（退出码 $got）"
    grep -E '^\[FAIL\]' <<< "$out" | sed 's/^/    /' >&2
  else
    report_ok "自清理：探针产物已全部移除，结构测试回到全绿"
  fi

  # 5. 护栏①静态层 + 护栏②（#171）：闸的聚合语义、数组内过滤、未知规则名拒绝
  assert_gate_aggregation_static
  assert_filter_in_rules_loop_static
  assert_unknown_rule_rejected

  # 6. 覆盖口径：SPECS 的目标规则去重计数。每条兜底闸规则都必须至少有一条违例用例，
  #    否则该规则若成了恒绿死规则，探针证明不了（#170：22 用例覆盖 10 条 → 33 用例覆盖 21 条）。
  covered="$(printf '%s\n' "${SPECS[@]}" | cut -d'|' -f2 | sort -u | grep -c .)"
  echo "红探针覆盖：${#SPECS[@]} 条用例，目标规则去重后 $covered 条。"

  if [ "$FAILURES" -eq 0 ]; then
    echo "红探针结论：${#SPECS[@]} 条违例用例均可把各自的目标规则判红且能自清理，兜底闸不是恒绿摆设。"
    return 0
  fi
  echo "红探针结论：存在 $FAILURES 项恒绿或未自清理的规则，兜底闸不可信。" >&2
  return 1
}

main "$@"
