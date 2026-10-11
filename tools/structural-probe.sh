#!/usr/bin/env bash
# 结构测试红探针（评审必修 C6，补 #51 AC 缺的负例证据）。
# 为什么需要：兜底闸只出示「全绿」，无法区分「规则通过」与「规则根本没在扫」——
# 本 PR 的 frontend-boundary 就是这么一条恒绿死规则（case 里的 pg|@prisma/* 永远取不到）。
# 本用例逐条写入违例源码 → 断言结构测试确实判红且命中该规则 → 还原源码。
# 退出码只有 0/1，失败输出人类可读（沿用 integration/README.md 的用例纪律）。
# 为什么住 tools/ 而不是 integration/：本文件按设计内含各类违例字样（bullmq、深路径导入…），
# 而规则一律不扫 tools/（见 structural-test.sh 扫描范围注释）——放 integration/ 会被自己要
# 证明的规则判红。它与 structural-test.sh 同属兜底闸设施，成对维护。
# 接入：dev lint 的 structural-probe 子项（全量五项之一，dev:360），随 dev check → CI 一起跑；
# 宿主侧纯源码扫描，无容器/网络依赖。违例文件写在真实工作树里再删除，故必须顺序执行、
# 不得与其他检查并行。
set -uo pipefail

ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
STRUCTURAL="$ROOT/tools/structural-test.sh"

CREATED=()   # 临时写入的文件（绝对路径，删除即还原）
MODIFIED=()  # 就地改写的既有文件（绝对路径）
SAVED=()     # 与 MODIFIED 同序：改写前的逐字节备份
FAILURES=0

tmp_write() { # $1 = 相对 ROOT 的路径，$2.. = 内容行
  local path="$ROOT/$1"; shift
  mkdir -p "$(dirname "$path")"
  printf '%s\n' "$@" > "$path"
  CREATED+=("$path")
}

inplace_append() { # $1 = 绝对路径，$2.. = 追加内容行（先备份，cleanup 时逐字节还原）
  local path="$1" backup; shift
  backup="$(mktemp "${TMPDIR:-/tmp}/structural-probe-backup-XXXXXX")"
  cp -a "$path" "$backup"
  MODIFIED+=("$path")
  SAVED+=("$backup")
  printf '%s\n' "$@" >> "$path"
}

cleanup() { # 幂等：删临时文件 + 还原就地改写文件，还原后逐字节校验
  local i path backup
  for path in "${CREATED[@]}"; do rm -f "$path"; done
  CREATED=()
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

report_ok() { echo "[通过] $1"; }
report_bad() { echo "[失败] $1" >&2; FAILURES=$((FAILURES + 1)); }

# ---------- 违例探针：每条 = 一个 write_probe_<id> 函数 + 一条 SPECS 记录 ----------
# SPECS 记录格式：id|期望命中的规则名|人类可读说明

write_probe_frontend-boundary() {
  tmp_write "frontend/src/_structural-probe.ts" \
    "// 探针（临时，勿入库）：前端直连库" \
    "import { PrismaClient } from '@prisma/client';" \
    "export const client = new PrismaClient();"
}

write_probe_spatial-orm-chain() {
  # 换行链式形态：单行正则取不到，靠折行二次判定兜住（C6 扩口径项 ③）
  tmp_write "backend/geo-dict/src/_structural-probe.mjs" \
    "// 探针（临时，勿入库）：空间模型 ORM 写，拆成多行使单行正则失明" \
    "export function probe(prisma) {" \
    "  return prisma" \
    "    .geoDictLandBoundary" \
    "      .create({ data: { name: 'probe' } });" \
    "}"
}

write_probe_supervision-sink-sh() {
  # C5 扩范围证据：e2e 的 .sh 用例形态同样在 supervision-sink 扫描范围内
  tmp_write "e2e/cases/_structural-probe.sh" \
    "#!/usr/bin/env bash" \
    "# 探针（临时，勿入库）：依赖单向模块 supervision" \
    "node -e \"import('@natural-enforcement/supervision')\""
}

write_probe_module-public-entry() {
  tmp_write "backend/case/src/_structural-probe.ts" \
    "// 探针（临时，勿入库）：跨模块深路径导入（表内依赖，但绕过公共出口）" \
    "import { ProbeThing } from '@natural-enforcement/identity/src/persistence/probe-thing.ts';" \
    "export const thing = new ProbeThing();"
}

write_probe_g1-model-allowlist() {
  inplace_append "$ROOT/backend/prisma/schema.prisma" \
    "// 探针（临时，勿入库）：白名单外业务实体" \
    "model ProbeBusinessCase {" \
    "  id String @id" \
    "  @@map(\"probe_business_case\")" \
    "}"
}

write_probe_queue-in-integration() {
  # C7 扩范围证据：integration 层同样在设施入口规则范围内（装配层不豁免形态类规则）
  tmp_write "integration/_structural-probe.ts" \
    "// 探针（临时，勿入库）：装配层裸依赖队列 SDK" \
    "import { Queue } from 'bullmq';" \
    "export const q = new Queue('probe');"
}

write_probe_spatial-in-integration() {
  # 同类洞的最后一处：空间纪律此前只扫 backend/ 与 packages/，装配层用 ORM 写空间模型
  # 同样绕过 ST_Transform 口径（执行纪律 2），现在也在范围内
  tmp_write "integration/_structural-probe-spatial.ts" \
    "// 探针（临时，勿入库）：装配层对空间模型调 ORM 写（执行纪律 2 禁止的形态）" \
    "export function probe(store: { geoDictSurveyPoint: { delete(q: unknown): unknown } }) {" \
    "  return store.geoDictSurveyPoint.delete({ where: { id: 'probe' } });" \
    "}"
}

write_probe_exempt-tightness() {
  # 豁免必须tight：名单外的深路径导入仍要判红，否则豁免等于把整层放行
  inplace_append "$ROOT/integration/e2-access-matrix.test.ts" \
    "// 探针（临时，勿入库）：豁免名单外的跨模块深路径导入" \
    "import { ProbeThing } from '../backend/geo-dict/src/internal.ts';" \
    "export const thing = ProbeThing;"
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
)

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

main() {
  local spec id rule label out rc got
  echo "结构测试红探针（负例证据：逐条违例源码必须能把兜底闸判红）"

  # 0. 基线：干净源码必须全绿，否则后面的「变红」证明不了任何事
  out="$("$STRUCTURAL" 2>&1)"; got=$?
  if [ "$got" -ne 0 ]; then
    report_bad "基线不成立：无违例时结构测试已判红（退出码 $got），探针失去判别力"
    grep -E '^\[FAIL\]' <<< "$out" | sed 's/^/    /' >&2
    echo "红探针结论：基线即红，先修结构测试本身。" >&2
    return 1
  fi
  report_ok "基线：无违例时结构测试全绿"

  # 1. 逐条探针：写违例 → 跑结构测试 → 还原 → 判定（还原先于判定，互不污染）
  for spec in "${SPECS[@]}"; do
    IFS='|' read -r id rule label <<< "$spec"
    "write_probe_$id"
    out="$("$STRUCTURAL" 2>&1)"; got=$?
    cleanup
    assert_rule_red "$label" "$rule" "$out" "$got"
  done

  # 2. 收尾基线：全部还原后必须回到全绿（自清理的最终证据）
  out="$("$STRUCTURAL" 2>&1)"; got=$?
  if [ "$got" -ne 0 ]; then
    report_bad "自清理不成立：探针结束后结构测试仍判红（退出码 $got）"
    grep -E '^\[FAIL\]' <<< "$out" | sed 's/^/    /' >&2
  else
    report_ok "自清理：探针产物已全部移除，结构测试回到全绿"
  fi

  if [ "$FAILURES" -eq 0 ]; then
    echo "红探针结论：${#SPECS[@]} 条新/改规则均可被违例源码判红且能自清理，兜底闸不是恒绿摆设。"
    return 0
  fi
  echo "红探针结论：存在 $FAILURES 项恒绿或未自清理的规则，兜底闸不可信。" >&2
  return 1
}

main "$@"
