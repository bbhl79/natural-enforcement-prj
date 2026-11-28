#!/usr/bin/env bash
# ============================================================================
# gen page 真实引擎闭环冒烟（#68 AC1–AC5：自动注册 / 契约统一封装 /
#   React useId 表单实例唯一与多 React 根前缀 / eslint-plugin-react / 真实 UI 旅程）
#
# 经 devenv 唯一入口，在真实引擎（Windows WSL2 / macOS）上执行：
#   Phase A：eslint-plugin-react 最小正确性规则面 13 条规则反例探针（flat config 生效）。
#   Phase B：gen nest-module --http → gen page（同名契约）→ gen page --contract（异名契约）
#     → 清单/整行锚点核对 → verify（lint + typecheck + test:unit，含双 Form 与多根测试）
#     → up + web（vite preview 动态代理生成路由）→ test（含 db 集成）
#     → 真实栈 UI 旅程（VITE_LIVE_WEB_URL=http://web:4173 跑生成 spec，真实 App 自动注册标签
#       → Form 提交 → web proxy → 真实 NestJS API → validated 校验 → 表格回显）
#     → 宿主 curl 独立验证实时 API 数据已落地
#     → 重复生成拒绝（exit 4）+ 容器内反例（字段类型非法 / spec 与契约字段不符，exit 2）
#     → 停止 web 并复原基线。
#   Phase C：基线反例（缺 --spec / 空 fields / 缺契约 / 不兼容契约 / 旗标误用 → exit 2）。
#   每步校验工作树签名（临时索引 add -A + write-tree）证明无部分写入与基线完整复原。
#
# 用法：devenv/test/gen-page-smoke.sh [--timeout S]
# 原始证据与 SUMMARY.md 写入 .artifacts/68-gen-page/（gitignored）。
# ============================================================================
set -Eeuo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TEST_DIR/../.." && pwd)"
DEVENV="$REPO_ROOT/devenv/devenv"
FIX="devenv/test/fixtures"
ART="$REPO_ROOT/.artifacts/68-gen-page"
PAGE_NAME="smoke-page"
ALIAS_NAME="smoke-page-alias"
UNREG_CONTRACT="smoke-unregistered"
UNREG_PAGE="smoke-unregistered-page"
APPMOD="apps/api/src/app.module.ts"
REGISTRY="packages/contracts/src/api-registry.ts"
INDEXTS="packages/contracts/src/index.ts"
APPTSX="apps/web/src/App.tsx"
TIMEOUT_SECS=1800
TIMEOUT_BIN=""
if command -v timeout >/dev/null 2>&1; then TIMEOUT_BIN="timeout"
elif command -v gtimeout >/dev/null 2>&1; then TIMEOUT_BIN="gtimeout"
fi

usage() {
  cat <<'EOF'
用法：gen-page-smoke.sh [--timeout S]

  --timeout S   每步上限秒数（默认 1800；超时退出码 124，不默认通过）

要求：引擎已就绪（devenv doctor 退出 0）；本脚本会执行 devenv up 与 devenv web（收尾自动关闭 web）。
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
command -v curl >/dev/null 2>&1 || { echo "缺 curl（白名单宿主工具）" >&2; exit 3; }

for p in \
  "apps/api/src/$PAGE_NAME" \
  "packages/contracts/src/$PAGE_NAME.ts" \
  "packages/contracts/src/$PAGE_NAME.spec.ts" \
  "apps/web/src/pages/$PAGE_NAME" \
  "apps/web/src/pages/$ALIAS_NAME" \
  "packages/contracts/src/$UNREG_CONTRACT.ts" \
  "apps/web/src/pages/$UNREG_PAGE"; do
  [[ ! -e "$REPO_ROOT/$p" ]] \
    || { echo "ERROR: 目标已存在 $p（拒绝开始，避免复原时误删既有内容）" >&2; exit 4; }
done

mkdir -p "$ART"
find "$ART" -mindepth 1 -delete
mkdir -p "$ART/baseline"
RESULTS="$ART/results.tsv"
: > "$RESULTS"

FAILED=0
LAST_RC=0
LAST_SECS=0
WEB_STARTED=0

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

tree_sig() {
  local idx sig="" rc=0
  idx="$(mktemp /tmp/ne-page-smoke-index.XXXXXX)"
  rm -f "$idx"
  GIT_INDEX_FILE="$idx" git -C "$REPO_ROOT" add -A >/dev/null 2>&1 || rc=$?
  if (( rc == 0 )); then
    sig="$(GIT_INDEX_FILE="$idx" git -C "$REPO_ROOT" write-tree)" || rc=$?
  fi
  rm -f "$idx"
  (( rc == 0 )) || { echo "ERROR: 工作树签名计算失败（退出码 $rc）" >&2; return 1; }
  printf '%s\n' "$sig"
}

count_line() { # <file> <整行>
  awk -v m="$2" '
    BEGIN { sub(/^[[:space:]]+/, "", m); sub(/[[:space:]]+$/, "", m) }
    { s = $0; sub(/^[[:space:]]+/, "", s); sub(/[[:space:]]+$/, "", s); if (s == m) c++ }
    END { print c + 0 }' "$1"
}

BASELINE_READY=0
restore_baseline() {
  (( BASELINE_READY )) || return 0
  if (( WEB_STARTED )); then
    "$DEVENV" web --down >/dev/null 2>&1 || true
    WEB_STARTED=0
  fi
  rm -rf \
    "$REPO_ROOT/apps/api/src/$PAGE_NAME" \
    "$REPO_ROOT/packages/contracts/src/$PAGE_NAME.ts" \
    "$REPO_ROOT/packages/contracts/src/$PAGE_NAME.spec.ts" \
    "$REPO_ROOT/apps/web/src/pages/$PAGE_NAME" \
    "$REPO_ROOT/apps/web/src/pages/$ALIAS_NAME" \
    "$REPO_ROOT/packages/contracts/src/$UNREG_CONTRACT.ts" \
    "$REPO_ROOT/apps/web/src/pages/$UNREG_PAGE"
  cp -p "$ART/baseline/app.module.ts" "$REPO_ROOT/$APPMOD"
  cp -p "$ART/baseline/api-registry.ts" "$REPO_ROOT/$REGISTRY"
  cp -p "$ART/baseline/index.ts" "$REPO_ROOT/$INDEXTS"
  cp -p "$ART/baseline/App.tsx" "$REPO_ROOT/$APPTSX"
}

cleanup() {
  local rc=$?
  restore_baseline || { echo "ERROR: 基线复原失败" >&2; rc=1; }
  exit "$rc"
}

# ---------------------------------------------------------------------------
# 预检：环境 / 基线备份 / 起点签名
# ---------------------------------------------------------------------------
echo "== gen page 真实引擎冒烟：产物 $ART"
run_case "$ART" doctor "$DEVENV" doctor
if (( LAST_RC != 0 )); then
  echo "ERROR: 引擎未就绪（devenv doctor 非零；见 $ART/doctor.err）" >&2
  exit 3
fi
run_case "$ART" up-baseline "$DEVENV" --json up
if (( LAST_RC != 0 )); then
  echo "ERROR: devenv up 失败（见 $ART/up-baseline.err）" >&2
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
cp -p "$REPO_ROOT/$INDEXTS" "$ART/baseline/index.ts"
cp -p "$REPO_ROOT/$APPTSX" "$ART/baseline/App.tsx"
BASELINE_READY=1
trap cleanup EXIT
START_SIG="$(tree_sig)"
echo "== 起点工作树签名：$START_SIG"

# ---------------------------------------------------------------------------
# Phase A：AC4 — eslint-plugin-react 最小正确性规则面在 flat config 下真实生效
# ---------------------------------------------------------------------------
echo "== Phase A: eslint-plugin-react 规则反例探针（flat config）"
mkdir -p "$ART/eslint"
run_case "$ART/eslint" react-rules "$DEVENV" exec -- node -e '
import("eslint").then(async ({ ESLint }) => {
  const eslint = new ESLint({ cwd: "/workspace" });
  const cases = [
    ["react/jsx-key", "export function A({ xs }: { xs: string[] }) { return <ul>{xs.map((x) => <li>{x}</li>)}</ul> }"],
    ["react/jsx-no-comment-textnodes", "export function A() { return <div>// oops</div> }"],
    ["react/jsx-no-duplicate-props", "export function A() { return <div id=\"a\" id=\"b\" /> }"],
    ["react/jsx-no-target-blank", "export function A() { return <a href=\"https://example.com\" target=\"_blank\">x</a> }"],
    ["react/no-children-prop", "export function A() { return <div children=\"x\" /> }"],
    ["react/no-danger-with-children", "export function A() { return <div dangerouslySetInnerHTML={{ __html: \"\" }}>x</div> }"],
    ["react/no-direct-mutation-state", "import React from \"react\"; export class A extends React.Component { f() { this.state.x = 1 } render() { return <div /> } }"],
    ["react/no-find-dom-node", "import ReactDOM from \"react-dom\"; export function f(c: unknown) { return ReactDOM.findDOMNode(c as never) }"],
    ["react/no-is-mounted", "import React from \"react\"; export class A extends React.Component { f() { return this.isMounted() } render() { return <div /> } }"],
    ["react/no-render-return-value", "import ReactDOM from \"react-dom\"; export const x = ReactDOM.render(<div />, document.body)"],
    ["react/no-string-refs", "import React from \"react\"; export class A extends React.Component { render() { return <div ref=\"x\" /> } }"],
    ["react/no-unstable-nested-components", "export function A() { function Child() { return <span /> } return <Child /> }"],
    ["react/void-dom-elements-no-children", "export function A() { return <input>bad</input> }"],
  ];
  let failed = 0;
  for (const [rule, code] of cases) {
    const [res] = await eslint.lintText(code, { filePath: "/workspace/apps/web/src/__probe.tsx" });
    const hit = res.messages.find((m) => m.ruleId === rule && m.severity === 2);
    if (hit) console.log("OK:", rule);
    else { console.error("MISS:", rule, res.messages); failed++; }
  }
  process.exit(failed ? 1 : 0);
});
'
expect_rc "eslint-plugin-react 13 条最小正确性规则在 flat config 下全部以 error 命中" 0 "$LAST_RC" "$ART/eslint/react-rules.err"

# ---------------------------------------------------------------------------
# Phase B：HTTP 模块 + 页面生成 → verify → up + web → test → 真实 UI 旅程
# ---------------------------------------------------------------------------
echo "== Phase B: gen nest-module + gen page 完整闭环与真实 UI 旅程"
mkdir -p "$ART/journey"
lock_before="$(sha256sum "$REPO_ROOT/pnpm-lock.yaml" | awk '{print $1}')"
df_before="$(sha256sum "$REPO_ROOT/devenv/workspace.Dockerfile" | awk '{print $1}')"

run_case "$ART/journey" gen-nest "$DEVENV" --json gen nest-module "$PAGE_NAME" --http --spec "$FIX/page-smoke.json"
expect_rc "前置 gen nest-module --http 成功" 0 "$LAST_RC" "$ART/journey/gen-nest.err"

run_case "$ART/journey" gen-page "$DEVENV" --json gen page "$PAGE_NAME" --spec "$FIX/page-smoke.json"
expect_rc "gen page（同名契约）成功" 0 "$LAST_RC" "$ART/journey/gen-page.err"

if jq -e . "$ART/journey/gen-page.out" >/dev/null 2>&1 \
  && jq -se --arg n "$PAGE_NAME" 'any(.[]; .command == "gen" and .status == "ok" and .kind == "page" and .name == $n and .contract == $n and .patches == "1" and .lockgen == "not-required")' "$ART/journey/gen-page.out" >/dev/null; then
  check ok "gen page JSONL 终值与字段完整" "kind=page contract=$PAGE_NAME patches=1 lockgen=not-required"
else
  check fail "gen page JSONL 终值" "解析失败或字段不符（见 $ART/journey/gen-page.out）"
fi

for f in \
  "apps/web/src/pages/$PAGE_NAME/$PAGE_NAME.api.ts" \
  "apps/web/src/pages/$PAGE_NAME/SmokePageForm.tsx" \
  "apps/web/src/pages/$PAGE_NAME/SmokePagePage.tsx" \
  "apps/web/src/pages/$PAGE_NAME/SmokePagePage.spec.tsx"; do
  [[ -f "$REPO_ROOT/$f" ]] && check ok "存在 $f" "file" || check fail "缺少 $f" "未生成"
done

# 回归：maxLength:0 的合法空串字段不得生成 required 规则（否则任何输入都无法提交）；
# 空白/换行/U+2028 标签已在输入侧规范化（生成测试用 getByLabelText 直接验证）。
FORM_FILE="$REPO_ROOT/apps/web/src/pages/$PAGE_NAME/SmokePageForm.tsx"
if grep -q 'name="emptyCode"' "$FORM_FILE" \
  && grep -q 'name="emptyCode".*max: 0' "$FORM_FILE" \
  && ! grep -q 'name="emptyCode".*required: true' "$FORM_FILE"; then
  check ok "maxLength:0 空串字段不与 required 冲突" "生成规则仅 max: 0"
else
  check fail "maxLength:0 空串字段 UI 规则" "生成物含 required 或缺少 max: 0（见 $FORM_FILE）"
fi

if [[ "$(count_line "$REPO_ROOT/$APPTSX" "import SmokePagePage from './pages/$PAGE_NAME/SmokePagePage.js'")" == "1" ]] \
  && [[ "$(count_line "$REPO_ROOT/$APPTSX" "{ key: '$PAGE_NAME', label: \"巡查工单\", children: <SmokePagePage /> },")" == "1" ]]; then
  check ok "App.tsx 整行锚点自动注册" "import=1 item=1"
else
  check fail "App.tsx 整行锚点自动注册" "注入次数不等于 1"
fi

if [[ "$(sha256sum "$REPO_ROOT/pnpm-lock.yaml" | awk '{print $1}')" == "$lock_before" \
   && "$(sha256sum "$REPO_ROOT/devenv/workspace.Dockerfile" | awk '{print $1}')" == "$df_before" ]]; then
  check ok "gen page 不触发 lockgen" "lockfile/Dockerfile 未变"
else
  check fail "gen page 不触发 lockgen" "lockfile 或 Dockerfile 被改动"
fi

# 异名页面消费同一契约（--contract）
run_case "$ART/journey" gen-page-alias "$DEVENV" --json gen page "$ALIAS_NAME" --contract "$PAGE_NAME" --spec "$FIX/page-smoke.json"
expect_rc "gen page --contract 异名页面成功" 0 "$LAST_RC" "$ART/journey/gen-page-alias.err"
if [[ "$(count_line "$REPO_ROOT/$APPTSX" "import SmokePageAliasPage from './pages/$ALIAS_NAME/SmokePageAliasPage.js'")" == "1" ]]; then
  check ok "App.tsx 支持多页面累加整行注册" "2 generated pages"
else
  check fail "App.tsx 多页面累加注册" "缺少 SmokePageAliasPage import"
fi

# 反例：契约仅从 index.ts 再导出、未登记 API_CONTRACT_ENDPOINTS → gen page 必须 exit 2。
# vite preview 代理由端点清单派生；放行会生成「能过类型检查但真实 API 无代理路由」的页面。
idx_sig="$(tree_sig)"
cat > "$REPO_ROOT/packages/contracts/src/$UNREG_CONTRACT.ts" <<'TS'
export const SMOKE_UNREGISTERED_ROUTES = {
  base: '/smoke-unregistered',
  create: '/smoke-unregistered',
  list: '/smoke-unregistered',
} as const
export const CreateSmokeUnregisteredSchema = {}
export const CreateSmokeUnregisteredResultSchema = {}
export const SmokeUnregisteredDtoSchema = {}
export const SmokeUnregisteredListResultSchema = {}
export const SMOKE_UNREGISTERED_ENDPOINTS = [] as const
TS
printf "export * from './%s.js'\n" "$UNREG_CONTRACT" >> "$REPO_ROOT/$INDEXTS"
run_case "$ART/journey" unregistered-contract "$DEVENV" --json gen page "$UNREG_PAGE" \
  --contract "$UNREG_CONTRACT" --spec "$FIX/page-smoke.json"
expect_rc "未登记端点的契约（仅 index.ts 导出）拒绝 exit 2" 2 "$LAST_RC" "$ART/journey/unregistered-contract.err"
if grep -q "未将 SMOKE_UNREGISTERED_ENDPOINTS 导入 API_CONTRACT_ENDPOINTS" "$ART/journey/unregistered-contract.err"; then
  check ok "报告端点未登记（vite 代理无路由风险）" "API_CONTRACT_ENDPOINTS 前置校验"
else
  check fail "未登记端点错误消息" "未命中 API_CONTRACT_ENDPOINTS 提示（见 $ART/journey/unregistered-contract.err）"
fi
[[ ! -e "$REPO_ROOT/apps/web/src/pages/$UNREG_PAGE" ]] \
  && check ok "未登记端点拒绝零写入" "目标目录不存在" \
  || check fail "未登记端点拒绝零写入" "目标目录被创建"
rm -f "$REPO_ROOT/packages/contracts/src/$UNREG_CONTRACT.ts"
cp -p "$ART/baseline/index.ts" "$REPO_ROOT/$INDEXTS"
[[ "$(tree_sig)" == "$idx_sig" ]] \
  && check ok "未登记端点反例后基线复原" "签名不变" \
  || check fail "未登记端点反例后基线复原" "工作树签名变化"

# verify（lint 含 eslint-plugin-react + typecheck + test:unit 含双 Form 与多根测试）
run_case "$ART/journey" verify "$DEVENV" --json verify
expect_rc "生成物 verify（lint+typecheck+test:unit）全绿" 0 "$LAST_RC" "$ART/journey/verify.err"
if grep -q 'SmokePagePage.spec.tsx' "$ART/journey/verify.err" \
  && grep -q 'SmokePageAliasPage.spec.tsx' "$ART/journey/verify.err" \
  && grep -q 'form-uniqueness.spec.tsx' "$ART/journey/verify.err"; then
  check ok "verify 实际运行基线与生成物全部表单唯一性/页面组件测试" "3 个前端组件测试文件全部执行"
else
  check fail "verify 组件测试确认" "输出未含预期测试文件名（见 $ART/journey/verify.err）"
fi

# up + web（真实 API 与 vite preview 动态代理生成路由）
run_case "$ART/journey" up "$DEVENV" --json up
expect_rc "devenv up（加载生成 API 模块）" 0 "$LAST_RC" "$ART/journey/up.err"

run_case "$ART/journey" web "$DEVENV" --json web
expect_rc "devenv web（vite preview 动态代理生成路由）" 0 "$LAST_RC" "$ART/journey/web.err"
WEB_PORT=""
if (( LAST_RC == 0 )); then
  WEB_STARTED=1
  WEB_PORT="$(jq -rs 'map(select(.command == "web")) | last | .port // ""' "$ART/journey/web.out")"
fi
if [[ "$WEB_PORT" =~ ^[0-9]+$ ]]; then
  check ok "web 实际宿主端口回读" "http://localhost:$WEB_PORT"
else
  check fail "web 实际宿主端口回读" "未能从 $ART/journey/web.out 解析端口"
fi

# test（含真实 db 集成测试）
run_case "$ART/journey" test "$DEVENV" --json test
expect_rc "devenv test（含集成测试）全绿" 0 "$LAST_RC" "$ART/journey/test.err"

# AC5：真实栈 UI 旅程（App 自动注册标签 → web proxy → 真实 NestJS API → validated → 表格回显）
run_case "$ART/journey" live-ui-journey \
  "$DEVENV" exec -- env VITE_LIVE_WEB_URL=http://web:4173 \
  pnpm --filter @ne/web exec vitest run "src/pages/$PAGE_NAME/SmokePagePage.spec.tsx"
expect_rc "真实栈 UI 旅程（App 自动注册标签 → web:4173 proxy → api:3000 → 数据回显）" 0 "$LAST_RC" "$ART/journey/live-ui-journey.err"
if grep -q '5 passed' "$ART/journey/live-ui-journey.out" \
  && ! grep -q 'skipped' "$ART/journey/live-ui-journey.out"; then
  check ok "真实栈 UI 旅程用例未跳过" "5 passed / 0 skipped（含真实栈旅程用例）"
else
  check fail "真实栈 UI 旅程用例未跳过" "输出未显示 5 passed 且无 skipped（见 $ART/journey/live-ui-journey.out）"
fi

# 宿主侧经 web 端口 curl 独立核对：UI 表单提交的记录真实存在运行中的 API 容器内
if [[ -n "$WEB_PORT" ]]; then
  run_case "$ART/journey" host-curl-echo curl -sf "http://localhost:${WEB_PORT}/smoke-pages"
  expect_rc "宿主经 web proxy 读回 /smoke-pages" 0 "$LAST_RC" "$ART/journey/host-curl-echo.err"
  if jq -e '(.items | length >= 1) and any(.items[]; .title == "sample" and .severity == 1 and .areaSqm == 0 and .urgent == true and .remark == "sample")' \
    "$ART/journey/host-curl-echo.out" >/dev/null 2>&1; then
    check ok "宿主独立核对 API 实时状态与 UI 提交数据一致" "$(cat "$ART/journey/host-curl-echo.out")"
  else
    check fail "宿主独立核对 API 数据" "未命中 UI 提交记录：$(cat "$ART/journey/host-curl-echo.out")"
  fi
fi

# 重复生成拒绝（exit 4，无部分写入）+ 容器内反例（exit 2，无部分写入）
sig_before="$(tree_sig)"
run_case "$ART/journey" dup-page "$DEVENV" --json gen page "$PAGE_NAME" --spec "$FIX/page-smoke.json"
expect_rc "重复 gen page 拒绝 exit 4" 4 "$LAST_RC" "$ART/journey/dup-page.err"
[[ "$(tree_sig)" == "$sig_before" ]] \
  && check ok "重复 gen page 拒绝无部分写入" "签名不变" \
  || check fail "重复 gen page 拒绝无部分写入" "工作树签名变化"

run_case "$ART/journey" neg-bad-type "$DEVENV" --json gen page smoke-bad-type --contract "$PAGE_NAME" --spec "$FIX/nest-module-bad-type.json"
expect_rc "容器内生成器拒绝非法字段类型透传 exit 2" 2 "$LAST_RC" "$ART/journey/neg-bad-type.err"
[[ "$(tree_sig)" == "$sig_before" ]] \
  && check ok "非法字段类型拒绝无部分写入" "签名不变" \
  || check fail "非法字段类型拒绝无部分写入" "工作树签名变化"

run_case "$ART/journey" neg-spec-mismatch "$DEVENV" --json gen page smoke-mismatch --contract "$PAGE_NAME" --spec "$FIX/nest-module-http.json"
expect_rc "容器内生成器拒绝 spec 与契约字段不符 exit 2" 2 "$LAST_RC" "$ART/journey/neg-spec-mismatch.err"
[[ "$(tree_sig)" == "$sig_before" ]] \
  && check ok "spec/契约不符拒绝无部分写入" "签名不变" \
  || check fail "spec/契约不符拒绝无部分写入" "工作树签名变化"

# 停 web 并复原基线
run_case "$ART/journey" web-down "$DEVENV" --json web --down
WEB_STARTED=0
expect_rc "devenv web --down 收尾" 0 "$LAST_RC" "$ART/journey/web-down.err"
restore_baseline
if [[ "$(tree_sig)" == "$START_SIG" ]]; then
  check ok "Phase B 后工作树基线完整复原" "签名=$START_SIG"
else
  check fail "Phase B 后基线复原" "签名不符"
fi

# ---------------------------------------------------------------------------
# Phase C：基线反例（均期望 exit 2 且工作树签名不变）
# ---------------------------------------------------------------------------
echo "== Phase C: 基线反例（exit 2，无部分写入）"
mkdir -p "$ART/negative"
run_neg() { # <id> <描述> <devenv 参数...>
  local id="$1" desc="$2" sig
  shift 2
  sig="$(tree_sig)"
  run_case "$ART/negative" "$id" "$DEVENV" --json "$@"
  expect_rc "反例 $desc exit 2" 2 "$LAST_RC" "$ART/negative/$id.err"
  [[ "$(tree_sig)" == "$sig" ]] \
    && check ok "反例 $desc 无部分写入" "签名不变" \
    || check fail "反例 $desc 无部分写入" "工作树签名变化"
}

run_neg missing-spec      "缺 --spec"                  gen page neg-missing-spec
run_neg empty-fields      "空 fields"                  gen page neg-empty-fields --spec "$FIX/nest-module-empty.json"
run_neg missing-contract  "缺对应 HTTP 契约"            gen page neg-no-contract --spec "$FIX/page-smoke.json"
run_neg bad-contract      "不兼容契约(enforcement-point)" gen page neg-bad-contract --contract enforcement-point --spec "$FIX/page-smoke.json"
run_neg wrong-flag        "误传 --http 旗标"            gen page neg-wrong-flag --http --spec "$FIX/page-smoke.json"

# 反例：label 仅在空白/换行/U+2028 上不同，规范化后重名 → exit 2（否则生成同可见标签）
run_neg duplicate-label   "规范化后重复 label"          gen page neg-dup-label --spec "$FIX/page-duplicate-label.json"
if grep -q "重复 label（规范化空白后）" "$ART/negative/duplicate-label.err"; then
  check ok "重复 label 报告规范化空白后查重" "含换行/U+2028 标签被拒绝"
else
  check fail "重复 label 错误消息" "未命中规范化查重提示（见 $ART/negative/duplicate-label.err）"
fi

# ---------------------------------------------------------------------------
# 收尾与摘要
# ---------------------------------------------------------------------------
restore_baseline
END_SIG="$(tree_sig)"
if [[ "$END_SIG" == "$START_SIG" ]]; then
  check ok "最终基线完整复原" "签名=$END_SIG"
else
  check fail "最终基线复原" "起点 $START_SIG != 终点 $END_SIG"
fi

pass_n="$(awk -F'\t' '$1=="ok"{c++} END{print c+0}' "$RESULTS")"
fail_n="$(awk -F'\t' '$1=="fail"{c++} END{print c+0}' "$RESULTS")"
{
  echo "# gen page 真实引擎冒烟摘要（#68）"
  echo
  sed 's/^/- /' "$ART/env.txt"
  echo "- 结果：${pass_n} 通过，${fail_n} 失败"
  echo "- 工作树签名：起点 \`${START_SIG}\` → 终点 \`${END_SIG}\`"
  echo
  echo "| 结果 | 检查项 | 详情 |"
  echo "|---|---|---|"
  awk -F'\t' '{ printf "| %s | %s | %s |\n", $1, $2, $3 }' "$RESULTS"
} > "$ART/SUMMARY.md"

echo "------------------------------------------------------------"
echo "gen page 真实引擎冒烟完成：${pass_n} 通过，${fail_n} 失败（摘要：$ART/SUMMARY.md）"
(( FAILED == 0 ))
