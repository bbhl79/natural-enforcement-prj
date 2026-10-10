#!/usr/bin/env bash
# 结构测试设施（#51 全量七模块依赖矩阵；#50 shield 唯一出口规则并入；
# #55 队列设施唯一入口规则并入；#53 存储设施唯一入口规则并入）。
# 规则 = #47 Implementation Decisions 依赖矩阵（含 #45 补丁 1）的机器可执行断言；
# 任一规则红即整体非 0 退出（接入 dev lint，与 ESLint/依赖漏入库检查并列，
# 构成「失败即构建失败」的本地 CI 等价闸）。
#
# 扩展方式：新增一个 check_<规则名>() 函数（输出 [OK]/[FAIL] 行），并将其名追加到
# RULES 数组即可；规则函数只读仓库源码，不依赖容器或网络。
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
#   identity-deps           identity 不依赖任何业务模块
#   geo-dict-deps           geo-dict 不依赖任何业务模块
#   case-deps               case 只许 → shield、identity、geo-dict
#   approval-deps           approval 只许 → shield、identity、case
#   supervision-deps        supervision 只许 → shield、identity、case
#   supervision-sink        无人依赖 supervision（矩阵行「单向」的反向断言）
#   deadline-deps           deadline 只许 → shield、case、approval、geo-dict（#45 补丁 1）
#   module-public-entry     backend/frontend/e2e 互引模块只许公共出口（禁内部路径）
#   frontend-boundary       前端不直连库（本切片最小形态；查询接口规则随前端代码落地扩展）
#   weak-reference-entry    跨域弱引用只许经 shield 的 requireCrossDomainReference 入口
#   queue-facility-entry    队列设施唯一入口（#55）：bullmq/ioredis 只许出现在
#                           packages/queue（设施包）；backend/frontend/e2e/shield 出现
#                           裸队列依赖 = 业务 worker 绕过队列接口（G5 不可扩大条件的
#                           机器兜底，强于注释级约定）；业务侧只许经 QUEUE_PORT 注入
#   storage-facility-entry  存储设施唯一入口（#53）：S3/RustFS SDK 依赖（@aws-sdk/*、
#                           @smithy/*、minio、rustfs）只许出现在 packages/storage
#                           （设施包）；其余位置出现 = 绕过 StoragePort 追加式抽象
#                           直连存储（append-only 最保守语义的机器兜底，强于注释级约定）
#   spatial-no-orm-mutation 空间纪律机器兜底（评审必修）：backend/ 全源码（含 geo-dict
#                           以外）不得对 geoDictLandBoundary / geoDictSurveyPoint 两个
#                           空间模型 delegate 调 .create(/.update(——含必填空间字段的模型
#                           禁用 ORM 写（infra/VERSIONS.md 执行纪律 2），写一律走
#                           $queryRaw/ST_ 函数；注释级约定之上的正则兜底
set -uo pipefail

ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
BACKEND="$ROOT/backend"
SHIELD_DIR="$ROOT/packages/shield"
# 队列设施包（#55）：bullmq/ioredis 的唯一合法出现位置
QUEUE_DIR="$ROOT/packages/queue"
# 存储设施包（#53）：S3/RustFS SDK 的唯一合法出现位置
STORAGE_DIR="$ROOT/packages/storage"

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
  [identity]="shield"
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
  queue-facility-entry
  storage-facility-entry
  spatial-no-orm-mutation
)
FAIL=0

note_ok()   { echo "[OK]   $1"; }
note_fail() { echo "[FAIL] $1"; FAIL=1; }

# 扫描范围：业务源码（tools/、dev、infra、docs 不扫描：规则约束的是代码互引）
SCAN_TS=(-type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.mts' -o -name '*.cts' \))

# 提取文件中的模块互引 specifier：包名根/深路径导入（@natural-enforcement/<mod>[/<…>]）、
# 相对路径导入。第三方包（@nestjs/*、node: 等）不在矩阵范围，不提取。
# shield 定名 @natural-enforcement/shield（评审必修补 scope）：旧裸名 shield 不再是
# 合法 specifier，不在提取范围；其残留深路径引用由 shield-single-entry 规则单独拦截。
specifiers_of() {
  grep -oE "\b(from|import)[^'\"]{0,40}['\"](@natural-enforcement/[a-z0-9-]+|\.{1,2}/)[^'\"]*['\"]" \
      "$1" 2>/dev/null \
    | sed -E "s/^[a-z]+[^'\"]*['\"]//; s/['\"]$//"
}

# 文件归属（相对 ROOT 的路径 → 所在模块名；非业务源码返回空）
home_of() {
  local rel="${1#"$ROOT"/}"
  case "$rel" in
    packages/shield/*)           echo shield ;;
    backend/identity/*)          echo identity ;;
    backend/geo-dict/*)          echo geo-dict ;;
    backend/case/*)              echo case ;;
    backend/approval/*)          echo approval ;;
    backend/supervision/*)       echo supervision ;;
    backend/deadline/*)          echo deadline ;;
    frontend/*)                  echo frontend ;;
    *)                           echo "" ;;
  esac
}

# 相对 specifier 的目标归属：解析后落在哪个模块目录（含 shield；仓库外或不相关返回空）
target_of_relative() {
  local resolved
  resolved="$(realpath -m "$(dirname "$1")/$2")"
  case "$resolved" in
    "$SHIELD_DIR"|"$SHIELD_DIR"/*)               echo shield ;;
    "$BACKEND"/identity|"$BACKEND"/identity/*)   echo identity ;;
    "$BACKEND"/geo-dict|"$BACKEND"/geo-dict/*)   echo geo-dict ;;
    "$BACKEND"/case|"$BACKEND"/case/*)           echo case ;;
    "$BACKEND"/approval|"$BACKEND"/approval/*)   echo approval ;;
    "$BACKEND"/supervision|"$BACKEND"/supervision/*) echo supervision ;;
    "$BACKEND"/deadline|"$BACKEND"/deadline/*)   echo deadline ;;
    *)                                            echo "" ;;
  esac
}

# 将 specifier 归一化为模块名（shield 或六模块之一；无关返回空）
target_of_spec() { # $1=文件绝对路径 $2=specifier
  case "$2" in
    @natural-enforcement/*) local rest="${2#@natural-enforcement/}"; echo "${rest%%/*}" ;;
    ./*|../*)               target_of_relative "$1" "$2" ;;
    *)                      echo "" ;;
  esac
}

# 矩阵行规则：某模块的引用不得超出允许列（表外依赖即失败）
check_row() { # $1=模块名
  local mod="$1" dir file spec target home fails=0
  local allowed=" ${ALLOW[$mod]} "
  dir="$ROOT/${MOD_DIR[$mod]}"
  [ -d "$dir" ] || { note_ok "$mod-deps：模块目录尚不存在（空行，无表外依赖）"; return; }
  while IFS= read -r file; do
    home="$mod"
    while IFS= read -r spec; do
      target="$(target_of_spec "$file" "$spec")"
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
    done < <(specifiers_of "$file")
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
  local file spec target fails=0
  while IFS= read -r file; do
    while IFS= read -r spec; do
      target="$(target_of_spec "$file" "$spec")"
      if [ -n "$target" ] && [ "$target" != "shield" ]; then
        note_fail "shield-no-business-dep：shield 依赖业务模块 ${file#"$ROOT"/} → $spec"
        fails=$((fails + 1))
      fi
    done < <(specifiers_of "$file")
  done < <(find "$SHIELD_DIR" "${SCAN_TS[@]}")
  if [ "$fails" -eq 0 ]; then
    note_ok "shield-no-business-dep：shield 不依赖任何业务模块"
  fi
}

check_identity-deps()    { check_row identity; }
check_geo-dict-deps()    { check_row geo-dict; }
check_case-deps()        { check_row case; }
check_approval-deps()    { check_row approval; }
check_supervision-deps() { check_row supervision; }
check_deadline-deps()    { check_row deadline; }

# 规则 i：矩阵行「监督统计（只读，单向，无人依赖它）」的反向断言
check_supervision-sink() {
  local file spec target home fails=0
  while IFS= read -r file; do
    home="$(home_of "$file")"
    [ "$home" = "supervision" ] && continue
    while IFS= read -r spec; do
      target="$(target_of_spec "$file" "$spec")"
      if [ "$target" = "supervision" ]; then
        note_fail "supervision-sink：${file#"$ROOT"/} 依赖了单向模块 supervision（→ $spec）"
        fails=$((fails + 1))
      fi
    done < <(specifiers_of "$file")
  done < <(find "$BACKEND" "$ROOT/frontend" "${SCAN_TS[@]}")
  if [ "$fails" -eq 0 ]; then
    note_ok "supervision-sink：无人依赖 supervision（单向成立）"
  fi
}

# 规则 j：backend/frontend/e2e 互引模块只许公共出口——@natural-enforcement/<mod>/<深路径>
# 与跨模块相对路径一律拦截（往来形态 = 只读查询 + 事件，经公共出口表达；默认禁止直写）
check_module-public-entry() {
  local file spec target home fails=0
  while IFS= read -r file; do
    home="$(home_of "$file")"
    [ -z "$home" ] && continue
    while IFS= read -r spec; do
      case "$spec" in
        @natural-enforcement/*/*)
          note_fail "module-public-entry：内部路径导入 ${file#"$ROOT"/} → $spec（只许 @natural-enforcement/<module> 公共出口）"
          fails=$((fails + 1)) ;;
        ./*|../*)
          target="$(target_of_relative "$file" "$spec")"
          if [ -n "$target" ] && [ "$target" != "$home" ]; then
            note_fail "module-public-entry：跨模块相对路径 ${file#"$ROOT"/} → $spec（归属 $target；只许经其公共出口）"
            fails=$((fails + 1))
          fi ;;
      esac
    done < <(specifiers_of "$file")
  done < <(find "$BACKEND" "$ROOT/frontend" "$ROOT/e2e" "${SCAN_TS[@]}")
  if [ "$fails" -eq 0 ]; then
    note_ok "module-public-entry：模块互引均经公共出口（无内部路径/跨模块相对路径）"
  fi
}

# 规则 k：前端不直连库（本切片最小形态；frontend 尚无代码，规则先行，防后续切片漂移）
check_frontend-boundary() {
  local file spec fails=0
  while IFS= read -r file; do
    while IFS= read -r spec; do
      case "$spec" in
        pg|pg/*|ioredis|ioredis/*|bullmq|bullmq/*|@prisma/client|@prisma/client/*|@prisma/orm*|rustfs*|backend/*)
          note_fail "frontend-boundary：前端直连库/后端内部 ${file#"$ROOT"/} → $spec（前端只许 shield + 各模块查询接口）"
          fails=$((fails + 1)) ;;
      esac
    done < <(specifiers_of "$file")
  done < <(find "$ROOT/frontend" "${SCAN_TS[@]}")
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
  done < <(grep -rlE 'requireCrossDomainReference' "$BACKEND" "$ROOT/frontend" "$ROOT/e2e" --include='*.ts' --include='*.tsx' 2>/dev/null)
  if [ "$fails" -eq 0 ]; then
    note_ok "weak-reference-entry：跨域弱引用均经 shield requireCrossDomainReference 入口"
  fi
}

# 规则 m（#55 并入）：队列设施唯一入口——bullmq/ioredis 只许出现在 packages/queue。
# backend/frontend/e2e/shield 出现裸队列依赖即失败：业务 worker 归各业务切片自带
#（G5），队列一律经 QueuePort 抽象注入，结构测试兜底防绕过。
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
    done < <(grep -oE "\b(from|import)[^'\"]{0,40}['\"](bullmq|ioredis)(/[^'\"]*)?['\"]" \
        "$file" 2>/dev/null | sed -E "s/^[a-z]+[^'\"]*['\"]//; s/['\"]$//")
  done < <(find "$BACKEND" "$ROOT/frontend" "$ROOT/e2e" "$SHIELD_DIR" "${SCAN_TS[@]}")
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
    done < <(grep -oE "\b(from|import)[^'\"]{0,40}['\"](@aws-sdk/[^'\"]*|@smithy/[^'\"]*|minio(/[^'\"]*)?|rustfs(/[^'\"]*)?)['\"]" \
        "$file" 2>/dev/null | sed -E "s/^[a-z]+[^'\"]*['\"]//; s/['\"]$//")
  done < <(find "$BACKEND" "$ROOT/frontend" "$ROOT/e2e" "$SHIELD_DIR" "$QUEUE_DIR" "${SCAN_TS[@]}")
  if [ "$fails" -eq 0 ]; then
    note_ok "storage-facility-entry：S3/RustFS SDK 仅在存储设施包内（业务侧无裸存储依赖，append-only 机器兜底）"
  fi
}

# 规则 o（评审必修）：空间纪律机器兜底——backend/ 全源码不得对两个空间模型 delegate
# 调 .create(/.update(。含必填 Unsupported 空间字段的模型走 ORM 写会绕过 ST_Transform
# 统一口径（infra/VERSIONS.md 执行纪律 2），写一律 $queryRaw/ST_ 函数；本规则以正则
# 扫 delegate 调用形态兜底，防后续切片漂移出原生空间路径。
check_spatial-no-orm-mutation() {
  local hits=0 line
  while IFS= read -r line; do
    note_fail "spatial-no-orm-mutation：空间模型 ORM 写调用 ${line}（含必填空间字段禁用 ORM create/update，执行纪律 2；写一律 \$queryRaw/ST_ 函数）"
    hits=$((hits + 1))
  done < <(grep -rEn --include='*.ts' --include='*.tsx' --include='*.mts' --include='*.cts' \
      -e '(geoDictLandBoundary|geoDictSurveyPoint)\.(create|update)\(' \
      "$BACKEND" 2>/dev/null)
  if [ "$hits" -eq 0 ]; then
    note_ok "spatial-no-orm-mutation：backend 全源码无空间模型 ORM create/update 调用（执行纪律 2 机器兜底）"
  fi
}

echo "结构测试（#51 全量七模块依赖矩阵，含 #45 补丁 1；规则源头 = #47 Implementation Decisions；#55 队列设施唯一入口、#53 存储设施唯一入口并入）"
for rule in "${RULES[@]}"; do
  "check_$rule"
done
echo
if [ "$FAIL" -eq 0 ]; then
  echo "结构测试：全部规则通过。"
else
  echo "结构测试：存在失败规则，详见上方标红行。" >&2
fi
exit "$FAIL"
