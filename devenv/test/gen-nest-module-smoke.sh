#!/usr/bin/env bash
# ============================================================================
# gen nest-module 真实引擎闭环冒烟（#67 AC5：HTTP 与 internal 两种生成物）
#
# 经 devenv 唯一入口，在真实引擎（Windows WSL2 / macOS）上对两种 variant 各走一轮：
#   gen → 生成物清单 / 整行锚点核对 → verify（lint+typecheck+test:unit）→
#   test（含生成的集成测试；需 db）→ [HTTP] 导出 OpenAPI（强制 #66 完整性检查，
#   并断言含生成路径与请求体/201/400/200）→ 重复生成拒绝（exit 4，工作树签名不变）
#   → 复原基线并核对签名。
# 另跑 5 条反例（缺 --spec / 空 fields / 字段类型非法 / basePath 与既有契约冲突 /
# 缺 variant），期望 exit 2 且工作树签名前后一致（无部分写入）；其中「字段类型非法」
# 由容器内生成器拒绝（退出码 2 经 devenv 透传，不得被误报成任务失败 4）。
#
# 判定：任一步退出码 / 清单 / 锚点 / 签名不符 → 失败（exit 1，保留原始证据）；
# 全部通过才 exit 0。工作树签名 = 临时索引 `git add -A` + `write-tree`（与 #58 快照
# 同口径：覆盖未提交/新增/删除，不动用户索引，忽略 gitignored 的证据目录）。
#
# 用法：devenv/test/gen-nest-module-smoke.sh [--timeout S]
#   --timeout S   每步上限秒数（默认 1800；超时退出码 124，不默认通过）
# 要求：引擎已就绪（devenv doctor 退出 0）；本脚本会执行 devenv up（幂等）以满足
#   集成测试对 db 的依赖。
# 本脚本临时改动工作树（新增 smoke-http / smoke-internal 模块并补丁两处锚点），
# 结束/失败时复原基线并校验签名；复原失败会明确报错并保留现场。
# 原始证据与 SUMMARY.md 写入 .artifacts/67-gen-nest-module/（gitignored）。
# ============================================================================
set -Eeuo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TEST_DIR/../.." && pwd)"
DEVENV="$REPO_ROOT/devenv/devenv"
FIX="devenv/test/fixtures"
ART="$REPO_ROOT/.artifacts/67-gen-nest-module"
HTTP_NAME="smoke-http"
INTERNAL_NAME="smoke-internal"
APPMOD="apps/api/src/app.module.ts"
REGISTRY="packages/contracts/src/api-registry.ts"
TIMEOUT_SECS=1800
TIMEOUT_BIN=""
if command -v timeout >/dev/null 2>&1; then TIMEOUT_BIN="timeout"
elif command -v gtimeout >/dev/null 2>&1; then TIMEOUT_BIN="gtimeout"
fi

usage() {
  cat <<'EOF'
用法：gen-nest-module-smoke.sh [--timeout S]

  --timeout S   每步上限秒数（默认 1800；超时退出码 124，不默认通过）

要求：引擎已就绪（devenv doctor 退出 0）；会执行 devenv up（幂等）。
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --timeout) TIMEOUT_SECS="${2:?--timeout 需要值}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数：$1" >&2; usage >&2; exit 2 ;;
  esac
done
[[ "$TIMEOUT_SECS" =~ ^[0-9]+$ ]] && (( 10#$TIMEOUT_SECS >= 1 )) \
  || { echo "--timeout 需要正整数" >&2; exit 2; }
command -v jq >/dev/null 2>&1 || { echo "缺 jq（白名单宿主工具）" >&2; exit 3; }

# 绝不删除/覆盖不属于本脚本的既有内容：smoke 目标已存在则拒绝开始
for n in "$HTTP_NAME" "$INTERNAL_NAME"; do
  for p in "apps/api/src/$n" "packages/contracts/src/$n.ts" "packages/contracts/src/$n.spec.ts"; do
    [[ ! -e "$REPO_ROOT/$p" ]] \
      || { echo "ERROR: 目标已存在 $p（拒绝开始，避免复原时误删既有内容）" >&2; exit 4; }
  done
done

mkdir -p "$ART"
find "$ART" -mindepth 1 -delete   # 本目录归本脚本所有：每次运行重新取证，避免新旧 SHA 的证据混放
mkdir -p "$ART/baseline"
RESULTS="$ART/results.tsv"
: > "$RESULTS"

# ---------------------------------------------------------------------------
# 工具函数
# ---------------------------------------------------------------------------
FAILED=0
LAST_RC=0
LAST_SECS=0

check() { # <ok|fail> <步骤> <细节>
  local status="$1" label="$2" detail="$3"
  printf '%s\t%s\t%s\n' "$status" "$label" "$detail" >> "$RESULTS"
  if [[ "$status" == ok ]]; then
    printf 'PASS: %s（%s）\n' "$label" "$detail"
  else
    printf 'FAIL: %s —— %s\n' "$label" "$detail" >&2
    FAILED=1
  fi
}

expect_rc() { # <步骤> <期望码> <实际码> <详情文件>
  if [[ "$3" == "$2" ]]; then
    check ok "$1" "exit $3，${LAST_SECS}s"
  else
    check fail "$1" "期望 exit $2，实际 $3（见 $4）"
  fi
}

# 原始输出/退出码落盘；退出码存入 LAST_RC，函数恒返回 0（由调用方判定）
run_case() { # <dir> <label> <cmd...>
  local dir="$1" label="$2" t0
  shift 2
  local -a prefix=()
  if [[ -n "$TIMEOUT_BIN" ]]; then prefix=("$TIMEOUT_BIN" "$TIMEOUT_SECS"); fi
  t0="$(date +%s)"
  set +e
  ${prefix[@]+"${prefix[@]}"} "$@" > "$dir/$label.out" 2> "$dir/$label.err"
  LAST_RC=$?
  set -e
  LAST_SECS=$(( $(date +%s) - t0 ))
  printf '%s\n' "$LAST_RC" > "$dir/$label.exitcode"
  if (( LAST_RC == 124 )); then printf 'timeout=%ss\n' "$TIMEOUT_SECS" > "$dir/$label.timeout"; fi
  return 0
}

# 工作树签名：临时索引 add -A + write-tree（不动用户索引；gitignored 内容不计入）
tree_sig() {
  local idx sig="" rc=0
  idx="$(mktemp /tmp/ne-smoke-index.XXXXXX)"
  rm -f "$idx"  # 不存在的索引文件 = 空索引
  GIT_INDEX_FILE="$idx" git -C "$REPO_ROOT" add -A >/dev/null 2>&1 || rc=$?
  if (( rc == 0 )); then
    sig="$(GIT_INDEX_FILE="$idx" git -C "$REPO_ROOT" write-tree)" || rc=$?
  fi
  rm -f "$idx"
  (( rc == 0 )) || { echo "ERROR: 工作树签名计算失败（退出码 $rc）" >&2; return 1; }
  printf '%s\n' "$sig"
}

# 整行（去首尾空白后相等）出现次数
count_line() { # <file> <整行>
  awk -v m="$2" '
    BEGIN { sub(/^[[:space:]]+/, "", m); sub(/[[:space:]]+$/, "", m) }
    { s = $0; sub(/^[[:space:]]+/, "", s); sub(/[[:space:]]+$/, "", s); if (s == m) c++ }
    END { print c + 0 }' "$1"
}

BASELINE_READY=0
# 幂等：只删除本脚本的 smoke 模块并把两处锚点文件还原为起跑前备份；可安全重复调用
# （每个 variant 结束、脚本收尾、EXIT trap 都会调用，不设「已复原」标志位，避免
# 第一次复原后标志位让后续异常退出跳过清理）。
restore_baseline() {
  (( BASELINE_READY )) || return 0
  local n
  for n in "$HTTP_NAME" "$INTERNAL_NAME"; do
    rm -rf "$REPO_ROOT/apps/api/src/$n" \
           "$REPO_ROOT/packages/contracts/src/$n.ts" \
           "$REPO_ROOT/packages/contracts/src/$n.spec.ts"
  done
  cp -p "$ART/baseline/app.module.ts" "$REPO_ROOT/$APPMOD"
  cp -p "$ART/baseline/api-registry.ts" "$REPO_ROOT/$REGISTRY"
}
cleanup() {
  local rc=$?
  restore_baseline || { echo "ERROR: 基线复原失败——请检查 $APPMOD、$REGISTRY 与 apps/api/src/smoke-*" >&2; rc=1; }
  exit "$rc"
}

# ---------------------------------------------------------------------------
# 预检：环境 / 基线备份 / 起点签名
# ---------------------------------------------------------------------------
echo "== gen nest-module 真实引擎冒烟：产物 $ART"
run_case "$ART" doctor "$DEVENV" doctor
if (( LAST_RC != 0 )); then
  echo "ERROR: 引擎未就绪（devenv doctor 非零；见 $ART/doctor.err）" >&2
  exit 3
fi
run_case "$ART" up "$DEVENV" --json up
if (( LAST_RC != 0 )); then
  echo "ERROR: devenv up 失败（见 $ART/up.err）——集成测试需要 db" >&2
  exit 3
fi

{
  echo "HEAD: $(git -C "$REPO_ROOT" rev-parse HEAD)"
  echo "branch: $(git -C "$REPO_ROOT" branch --show-current)"
  if [[ -z "$(git -C "$REPO_ROOT" status --porcelain)" ]]; then
    echo "worktree: clean"
  else
    echo "worktree: DIRTY（证据不绑定单一 commit）"
  fi
  echo "date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "uname: $(uname -a)"
  grep -E 'engine-endpoint' "$ART/doctor.err" || true
} > "$ART/env.txt"

cp -p "$REPO_ROOT/$APPMOD" "$ART/baseline/app.module.ts"
cp -p "$REPO_ROOT/$REGISTRY" "$ART/baseline/api-registry.ts"
BASELINE_READY=1
trap cleanup EXIT
START_SIG="$(tree_sig)"
echo "== 起点工作树签名：$START_SIG"

# ---------------------------------------------------------------------------
# 单个 variant 的完整闭环
# ---------------------------------------------------------------------------
run_variant() { # <variant> <name> <spec 相对路径>
  local variant="$1" name="$2" spec="$3" dir="$ART/$1" tag="$1"
  local pascal upper before mid after f line missing gates base_path
  local -a want forbid
  pascal="$(printf '%s' "$name" | awk -F- '{ for (i = 1; i <= NF; i++) printf "%s%s", toupper(substr($i, 1, 1)), substr($i, 2) }')"
  upper="$(printf '%s' "$name" | tr '[:lower:]-' '[:upper:]_')"
  mkdir -p "$dir"
  before="$(tree_sig)"
  echo "== [$tag] gen nest-module $name --$variant --spec $spec"

  # 1. gen
  run_case "$dir" gen "$DEVENV" --json gen nest-module "$name" "--$variant" --spec "$spec"
  expect_rc "$tag gen" 0 "$LAST_RC" "$dir/gen.err"
  (( LAST_RC == 0 )) || return 0   # 后续步骤无意义；保留证据与基线复原由调用方处理
  if jq -se --arg v "$variant" 'any(.[]; .command == "gen" and .status == "ok" and .kind == "nest-module" and .variant == $v and .lockgen == "not-required")' \
      "$dir/gen.out" >/dev/null 2>&1; then
    check ok "$tag gen 终值" "variant=$variant lockgen=not-required（不新增 workspace 包，不触发 lockgen）"
  else
    check fail "$tag gen 终值" "终值字段不符（见 $dir/gen.out）"
  fi

  # 2. 生成物清单（HTTP 含 controller/契约/集成测试；internal 无 controller/契约）
  want=("apps/api/src/$name/$name.module.ts" "apps/api/src/$name/$name.service.ts")
  forbid=()
  if [[ "$variant" == http ]]; then
    want+=("apps/api/src/$name/$name.controller.ts" "apps/api/src/$name/$name.controller.spec.ts"
           "packages/contracts/src/$name.ts" "packages/contracts/src/$name.spec.ts")
  else
    want+=("apps/api/src/$name/$name.service.spec.ts")
    forbid=("apps/api/src/$name/$name.controller.ts"
            "packages/contracts/src/$name.ts" "packages/contracts/src/$name.spec.ts")
  fi
  missing=""
  for f in "${want[@]}"; do [[ -f "$REPO_ROOT/$f" ]] || missing+=" $f"; done
  for f in ${forbid[@]+"${forbid[@]}"}; do [[ ! -e "$REPO_ROOT/$f" ]] || missing+=" (不应存在)$f"; done
  if [[ -z "$missing" ]]; then
    check ok "$tag 生成物清单" "${#want[@]} 个必需文件齐全；禁出文件 ${#forbid[@]} 个均不存在"
  else
    check fail "$tag 生成物清单" "缺失/越界：$missing"
  fi
  ( cd "$REPO_ROOT" && sha256sum "${want[@]}" ) > "$dir/files.sha256" 2>/dev/null || true

  # 3. 整行锚点（app.module；HTTP 另有 api-registry；internal 不得改 api-registry）
  if [[ "$(count_line "$REPO_ROOT/$APPMOD" "import { ${pascal}Module } from './${name}/${name}.module.js'")" == 1 \
     && "$(count_line "$REPO_ROOT/$APPMOD" "${pascal}Module,")" == 1 ]]; then
    check ok "$tag app.module 整行锚点" "import 与 imports 条目各 1 整行"
  else
    check fail "$tag app.module 整行锚点" "注册行不是恰好各一处"
  fi
  if [[ "$variant" == http ]]; then
    missing=""
    for line in "export * from './${name}.js'" \
                "import { ${upper}_ENDPOINTS } from './${name}.js'" \
                "...${upper}_ENDPOINTS,"; do
      [[ "$(count_line "$REPO_ROOT/$REGISTRY" "$line")" == 1 ]] || missing+=" [$line]"
    done
    if [[ -z "$missing" ]]; then
      check ok "$tag api-registry 整行锚点" "export / import / 展开项各 1 整行"
    else
      check fail "$tag api-registry 整行锚点" "缺失或重复：$missing"
    fi
  elif cmp -s "$ART/baseline/api-registry.ts" "$REPO_ROOT/$REGISTRY"; then
    check ok "$tag 契约注册表未改" "internal 不进入 API_CONTRACT_ENDPOINTS"
  else
    check fail "$tag 契约注册表未改" "internal 不应修改 api-registry.ts"
  fi

  # 4. verify（lint + typecheck + test:unit）
  run_case "$dir" verify "$DEVENV" --json verify
  expect_rc "$tag verify（lint+typecheck+test:unit）" 0 "$LAST_RC" "$dir/verify.err"
  gates="$(jq -r 'select(.event == "gate.completed") | "\(.gate)=\(.result)"' "$dir/verify.out" 2>/dev/null | tr '\n' ' ')"
  if [[ "$gates" == *"lint=ok"* && "$gates" == *"typecheck=ok"* && "$gates" == *"test:unit=ok"* ]]; then
    check ok "$tag verify 质量门" "$gates"
  else
    check fail "$tag verify 质量门" "三道门未全部 ok：${gates:-（无 gate.completed 事件）}"
  fi
  missing=""
  if [[ "$variant" == http ]]; then
    for f in "$name.controller.spec.ts" "$name.spec.ts"; do
      grep -qF -- "$f" "$dir/verify.err" || missing+=" $f"
    done
  else
    grep -qF -- "$name.service.spec.ts" "$dir/verify.err" || missing+=" $name.service.spec.ts"
  fi
  if [[ -z "$missing" ]]; then
    check ok "$tag 生成物测试已执行" "verify 输出含生成的 spec 文件"
  else
    check fail "$tag 生成物测试已执行" "verify 输出缺少：$missing"
  fi

  # 5. test（含 db 集成测试）
  run_case "$dir" test "$DEVENV" --json test
  expect_rc "$tag test（含集成测试）" 0 "$LAST_RC" "$dir/test.err"

  # 6. OpenAPI（HTTP）：导出前强制 #66 完整性检查；断言生成端点被准确表达
  if [[ "$variant" == http ]]; then
    base_path="$(jq -r '.basePath // ""' "$REPO_ROOT/$spec")"
    [[ -n "$base_path" ]] || base_path="/$name"
    run_case "$dir" openapi "$DEVENV" exec -- node apps/api/dist/scripts/emit-openapi.js
    expect_rc "$tag OpenAPI 导出（#66 完整性检查）" 0 "$LAST_RC" "$dir/openapi.err"
    if jq -e --arg p "$base_path" '
        (.paths[$p].post.requestBody.required == true)
        and (.paths[$p].post.responses | has("201") and has("400"))
        and (.paths[$p].get.responses | has("200"))' "$dir/openapi.out" >/dev/null 2>&1; then
      check ok "$tag OpenAPI 准确表达生成端点" "$base_path：POST requestBody required + 201/400；GET 200"
    else
      check fail "$tag OpenAPI 准确表达生成端点" "$base_path 的 operation 缺失或不完整（见 $dir/openapi.out）"
    fi
  fi

  # 7. 重复生成：拒绝且工作树签名不变（无部分写入）
  mid="$(tree_sig)"
  run_case "$dir" repeat "$DEVENV" --json gen nest-module "$name" "--$variant" --spec "$spec"
  expect_rc "$tag 重复生成拒绝" 4 "$LAST_RC" "$dir/repeat.err"
  grep -qF "目标已存在" "$dir/repeat.err" \
    && check ok "$tag 重复生成提示" "报告「目标已存在」" \
    || check fail "$tag 重复生成提示" "未报告目标已存在（见 $dir/repeat.err）"
  after="$(tree_sig)"
  if [[ "$mid" == "$after" ]]; then
    check ok "$tag 重复生成无部分写入" "工作树签名不变 ${mid:0:12}…"
  else
    check fail "$tag 重复生成无部分写入" "签名变化 $mid → $after"
  fi

  # 8. 复原基线并核对签名
  restore_baseline
  after="$(tree_sig)"
  if [[ "$before" == "$after" ]]; then
    check ok "$tag 复原基线" "工作树签名回到生成前 ${before:0:12}…"
  else
    check fail "$tag 复原基线" "签名不符 $before → $after（保留现场）"
  fi
}

# ---------------------------------------------------------------------------
# 反例：期望 exit 2 + 明确提示 + 无部分写入
# ---------------------------------------------------------------------------
run_negative() { # <标签> <期望码> <stderr 必含片段> <devenv 子命令参数...>
  local label="$1" want="$2" needle="$3" dir="$ART/negative" before after
  shift 3
  mkdir -p "$dir"
  before="$(tree_sig)"
  run_case "$dir" "$label" "$DEVENV" --json "$@"
  expect_rc "反例 $label" "$want" "$LAST_RC" "$dir/$label.err"
  if grep -qF -- "$needle" "$dir/$label.err"; then
    check ok "反例 $label 提示" "含「$needle」"
  else
    check fail "反例 $label 提示" "stderr 缺少「$needle」（见 $dir/$label.err）"
  fi
  after="$(tree_sig)"
  if [[ "$before" == "$after" ]]; then
    check ok "反例 $label 无部分写入" "工作树签名不变 ${before:0:12}…"
  else
    check fail "反例 $label 无部分写入" "签名变化 $before → $after"
  fi
}

run_variant http "$HTTP_NAME" "$FIX/nest-module-http.json"
run_variant internal "$INTERNAL_NAME" "$FIX/nest-module-internal.json"

echo "== 反例（期望 exit 2、明确提示、无部分写入）"
run_negative missing-spec 2 "缺少必要业务信息" \
  gen nest-module smoke-neg --http
run_negative empty-fields 2 "fields 必须是非空对象" \
  gen nest-module smoke-neg --internal --spec "$FIX/nest-module-empty.json"
run_negative bad-field-type 2 "字段 occurredAt.type 必须是" \
  gen nest-module smoke-neg --http --spec "$FIX/nest-module-bad-type.json"
run_negative base-path-conflict 2 "与已有契约路由冲突：/health" \
  gen nest-module smoke-neg --http --spec "$FIX/nest-module-conflict.json"
run_negative missing-variant 2 "--http|--internal" \
  gen nest-module smoke-neg --spec "$FIX/nest-module-http.json"

# ---------------------------------------------------------------------------
# 收尾：最终复原核对 + SUMMARY
# ---------------------------------------------------------------------------
restore_baseline
END_SIG="$(tree_sig)"
if [[ "$START_SIG" == "$END_SIG" ]]; then
  check ok "最终基线复原" "工作树签名与运行前一致 ${START_SIG:0:12}…"
else
  check fail "最终基线复原" "签名不符 $START_SIG → $END_SIG（保留现场）"
fi

{
  echo "# #67 gen nest-module 真实引擎证据摘要"
  echo
  sed 's/^/- /' "$ART/env.txt"
  echo
  echo "| 结果 | 步骤 | 细节 |"
  echo "|---|---|---|"
  awk -F'\t' '{ printf "| %s | %s | %s |\n", ($1 == "ok" ? "PASS" : "FAIL"), $2, $3 }' "$RESULTS"
  echo
  if (( FAILED )); then echo "**结论：失败**（原始输出见各子目录的 .out/.err/.exitcode）"; else echo "**结论：全部通过**"; fi
} > "$ART/SUMMARY.md"

if (( FAILED )); then
  echo "== 失败：见 $ART/SUMMARY.md 与各步骤原始输出" >&2
  exit 1
fi
echo "== 通过：HTTP 与 internal 两种生成物的闭环与 5 条反例全部符合预期"
echo "== 汇总：$ART/SUMMARY.md"
