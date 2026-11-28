#!/usr/bin/env bash
# ============================================================================
# e2e 生命周期决策引擎真实引擎冒烟（#106 AC2/AC4/AC5）
#
# 经 devenv 唯一入口，在真实引擎上验证：
#   A 命令面（真实决策引擎在 tools 容器内跑，宿主树经 stdin tar 只读进容器）：
#     defect list / show（--json 终值 + 证据 URI）、未知 ID exit 10、
#     非法记录 exit 10、next-id 本地 max+1、registry rebuild（W op 宿主原子应用）、
#     注册表漂移仅 WARN 不硬门禁、**END error 零落盘**（事实源损坏时重建被拒）。
#   B op 协议 V 载荷（本票无 graduate 命令面入口，归 #110；故在**宿主桥接缝**驱动，
#     但容器/执行器/per-run 栈全部真实）：起真实 per-run 隔离栈 → V expect=fail
#     载荷真跑通过 → 判定不符 exit 9 **零落盘**；V 载荷真跑失败 → 判定相符 →
#     同批 W 落账；多项 W/D 原子应用。
#
# 判定：任一步退出码/JSON/落盘结果不符 → 失败（exit 1，保留原始证据）。
# 本脚本临时改动工作树（新增夹具缺陷记录与 replay 脚本，**不入仓库**），结束/失败
# 时删除夹具并核对工作树签名回到基线；注册表缓存（gitignored）一并清理。
# 原始证据与 SUMMARY.md 写入 .artifacts/106-defect-lifecycle/smoke/（gitignored）。
#
# 用法：devenv/test/e2e-lifecycle-smoke.sh [--run-id ID]
# 要求：引擎已就绪（devenv doctor 退出 0）；本脚本会执行 devenv up（幂等）。
# ============================================================================
set -Eeuo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TEST_DIR/../.." && pwd)"
DEVENV="$REPO_ROOT/devenv/devenv"
ART="$REPO_ROOT/.artifacts/106-defect-lifecycle/smoke"
E2E_DIR="$REPO_ROOT/apps/e2e"
FIX_ID="DEF-9001"
RUN_ID="lif-$(date +%s)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run-id) RUN_ID="${2:?--run-id 需要值}"; shift 2 ;;
    *) printf '未知参数：%s\n' "$1" >&2; exit 2 ;;
  esac
done

mkdir -p "$ART"
FAILURES=0
PASS_COUNT=0
pass() { printf 'PASS: %s\n' "$1" | tee -a "$ART/results.txt"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { printf 'FAIL: %s —— %s\n' "$1" "$2" | tee -a "$ART/results.txt"; FAILURES=$((FAILURES + 1)); }
: > "$ART/results.txt"

# 工作树签名（临时索引，与 #58 快照同口径；不动用户索引，忽略 gitignored 证据）
tree_signature() {
  local tmp idx
  tmp="$(mktemp -d)"
  idx="$tmp/index"
  GIT_INDEX_FILE="$idx" git -C "$REPO_ROOT" add -A >/dev/null 2>&1
  GIT_INDEX_FILE="$idx" git -C "$REPO_ROOT" write-tree
  rm -rf "$tmp"
}

BASE_SIG="$(tree_signature)"
printf 'HEAD=%s\nbaseline_tree=%s\n' "$(git -C "$REPO_ROOT" rev-parse HEAD)" "$BASE_SIG" > "$ART/context.txt"
git -C "$REPO_ROOT" status --porcelain >> "$ART/context.txt"

cleanup() {
  rm -f "$E2E_DIR/defects/$FIX_ID.json" "$E2E_DIR/replay/$FIX_ID.mjs" "$E2E_DIR/.registry.json"
  rm -rf "$E2E_DIR/.verify-run"
}
trap cleanup EXIT

run() { # run <label> <cmd...>：捕获 stdout/stderr/exitcode
  local label="$1"; shift
  local rc=0
  printf '%q ' "$@" > "$ART/$label.cmd"
  "$@" > "$ART/$label.out" 2> "$ART/$label.err" || rc=$?
  printf '%s\n' "$rc" > "$ART/$label.exitcode"
  printf '[%s] rc=%s cmd=%s\n' "$(date -u +%H:%M:%S)" "$rc" "$(cat "$ART/$label.cmd")" >> "$ART/evidence.log"
  return "$rc"
}

last_json() { jq -s -e '.[-1] | '"$2" "$ART/$1.out" >/dev/null 2>&1; }

echo "== A 命令面（真实 tools 容器 + 真实决策引擎）"
run doctor "$DEVENV" doctor || { echo "doctor 未通过，见 $ART/doctor.err" >&2; exit 1; }

# 夹具记录（临时，不入仓库；标题明示非真实缺陷）
mkdir -p "$E2E_DIR/defects" "$E2E_DIR/replay"
cat > "$E2E_DIR/defects/$FIX_ID.json" <<JSON
{
  "schemaVersion": 1,
  "id": "$FIX_ID",
  "title": "冒烟夹具（非真实缺陷）：生命周期管线自检",
  "summary": "#106 验收夹具——验证事实源查询/取号/注册表/op 管线，跑完即删，不入仓库",
  "status": "reported",
  "engine": "agent-session",
  "layer": "api",
  "discoveredAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "discoveredBy": "e2e-lifecycle-smoke",
  "charter": "创建点位输入空间全量安全（广州点位）",
  "suspectedArea": "apps/e2e/src/cli.ts",
  "severity": "low",
  "reproducibility": {
    "kind": "external-state",
    "replayPath": "apps/e2e/replay/$FIX_ID.mjs",
    "replayCommand": "node apps/e2e/replay/$FIX_ID.mjs",
    "gate": { "attempts": 1, "keySpaces": ["smoke-$RUN_ID"], "allFailed": true }
  },
  "evidence": [{ "type": "log", "uri": ".artifacts/e2e/smoke-$RUN_ID/logs/api.log" }],
  "sanitized": true
}
JSON
cat > "$E2E_DIR/replay/$FIX_ID.mjs" <<'MJS'
// #106 冒烟夹具（非真实缺陷复现脚本）：零第三方依赖，跑完随夹具一并删除。
process.exit(0)
MJS

run a1 "$DEVENV" --json e2e defect list
if [[ "$(cat "$ART/a1.exitcode")" == 0 ]] && last_json a1 ".defects | any(.id == \"$FIX_ID\")"; then
  pass "A1 defect list --json：真实容器解析事实源，夹具记录在列"
else
  fail "A1" "rc=$(cat "$ART/a1.exitcode") err=$(tail -3 "$ART/a1.err")"
fi
grep -q 'tar -x -C /tmp/in' "$ART/a1.err" 2>/dev/null || true

run a2 "$DEVENV" --json e2e defect show "$FIX_ID"
if [[ "$(cat "$ART/a2.exitcode")" == 0 ]] \
  && last_json a2 ".defect.id == \"$FIX_ID\" and (.defect.evidence[0].uri | startswith(\".artifacts/e2e/\"))"; then
  pass "A2 defect show --json：记录 + 证据 URI（只存 URI，不入库）"
else
  fail "A2" "rc=$(cat "$ART/a2.exitcode") out=$(tail -1 "$ART/a2.out")"
fi

run a3 "$DEVENV" --json e2e defect show DEF-9999
if [[ "$(cat "$ART/a3.exitcode")" == 10 ]] && grep -q '缺陷不存在：DEF-9999' "$ART/a3.err" \
  && last_json a3 '.status == "failed" and .exitCode == 10'; then
  pass "A3 未知 ID exit 10 + 拒绝原因透出 + 终值 failed/10"
else
  fail "A3" "rc=$(cat "$ART/a3.exitcode") err=$(tail -3 "$ART/a3.err")"
fi

run a4 "$DEVENV" --json e2e defect next-id
if [[ "$(cat "$ART/a4.exitcode")" == 0 ]] && last_json a4 '.id == "DEF-9002"'; then
  pass "A4 取号本地 max+1（DEF-9001 → DEF-9002）"
else
  fail "A4" "rc=$(cat "$ART/a4.exitcode") out=$(tail -1 "$ART/a4.out")"
fi

# W op 真实管线：registry rebuild（引擎发 W 行 → 宿主原子应用）
run a5 "$DEVENV" --json e2e registry rebuild
if [[ "$(cat "$ART/a5.exitcode")" == 0 && -f "$E2E_DIR/.registry.json" ]] \
  && jq -e ".defects | any(.id == \"$FIX_ID\")" "$E2E_DIR/.registry.json" >/dev/null 2>&1 \
  && jq -s -e 'any(.[]; .event == "registry.rebuilt" and .drift == "no")' "$ART/a5.out" >/dev/null 2>&1; then
  pass "A5 registry rebuild：W op 经真实容器→宿主原子应用，派生缓存落盘（drift=no）"
else
  fail "A5" "rc=$(cat "$ART/a5.exitcode") err=$(tail -3 "$ART/a5.err") reg=$(cat "$E2E_DIR/.registry.json" 2>/dev/null)"
fi

# 漂移仅 WARN（手改缓存后重建）
printf '{"defects":[{"id":"DEF-0001","status":"retired","engine":"monkey","specPath":null}]}\n' > "$E2E_DIR/.registry.json"
run a6 "$DEVENV" --json e2e registry rebuild
if [[ "$(cat "$ART/a6.exitcode")" == 0 ]] && grep -q 'WARN' "$ART/a6.err" \
  && jq -s -e 'any(.[]; .event == "registry.rebuilt" and .drift == "yes")' "$ART/a6.out" >/dev/null 2>&1 \
  && jq -e ".defects | any(.id == \"$FIX_ID\")" "$E2E_DIR/.registry.json" >/dev/null 2>&1; then
  pass "A6 注册表漂移仅 WARN + 自动重建为事实源同构（exit 0，不硬门禁）"
else
  fail "A6" "rc=$(cat "$ART/a6.exitcode") err=$(tail -3 "$ART/a6.err")"
fi

# END error 零落盘：事实源损坏 → 引擎 END error 10 → 宿主拒绝，缓存不动
REG_BEFORE="$(sha256sum "$E2E_DIR/.registry.json" | awk '{print $1}')"
cp -p "$E2E_DIR/defects/$FIX_ID.json" "$ART/fixture-record.bak"
printf '{"schemaVersion":1,"id":"%s"\n' "$FIX_ID" > "$E2E_DIR/defects/$FIX_ID.json"
run a7 "$DEVENV" --json e2e registry rebuild
REG_AFTER="$(sha256sum "$E2E_DIR/.registry.json" | awk '{print $1}')"
if [[ "$(cat "$ART/a7.exitcode")" == 10 ]] && [[ "$REG_BEFORE" == "$REG_AFTER" ]] \
  && grep -q 'JSON 解析失败' "$ART/a7.err"; then
  pass "A7 END error（事实源损坏）→ exit 10 零落盘 + 拒绝原因透出"
else
  fail "A7" "rc=$(cat "$ART/a7.exitcode") before=$REG_BEFORE after=$REG_AFTER err=$(tail -3 "$ART/a7.err")"
fi
run a8 "$DEVENV" --json e2e defect list
[[ "$(cat "$ART/a8.exitcode")" == 10 ]] \
  && pass "A8 非法记录 defect list exit 10（schema/解析失败即拒）" \
  || fail "A8" "rc=$(cat "$ART/a8.exitcode")"
cp -p "$ART/fixture-record.bak" "$E2E_DIR/defects/$FIX_ID.json"

echo "== B op 协议 V 载荷（真实 per-run 栈 + 真实执行器；宿主桥接缝）"
run b0 "$DEVENV" up || { echo "devenv up 失败，见 $ART/b0.err" >&2; exit 1; }

# 起真实 per-run 隔离栈（复用 #70 编排原语），在 run 内驱动 V 载荷
B_RC=0
(
  set -Eeuo pipefail
  trap 'e2e_cleanup_on_exit; lease_release_all; lock_release_all; snapshot_cleanup' EXIT
  source "$REPO_ROOT/devenv/lib/output.sh"
  source "$REPO_ROOT/devenv/lib/engine.sh"
  source "$REPO_ROOT/devenv/lib/lock.sh"
  source "$REPO_ROOT/devenv/lib/snapshot.sh"
  source "$REPO_ROOT/devenv/lib/stack.sh"
  source "$REPO_ROOT/devenv/lib/supply-chain.sh"
  source "$REPO_ROOT/devenv/lib/ci.sh"
  source "$REPO_ROOT/devenv/lib/gen.sh"
  source "$REPO_ROOT/devenv/lib/e2e.sh"
  source "$REPO_ROOT/devenv/lib/github-app-auth.sh"
  source "$REPO_ROOT/devenv/lib/e2e-lifecycle.sh"
  JSON=1; CMD="e2e"
  engine_init
  lease_acquire "stack-$WT_SUFFIX" 120
  require_services db redis rustfs
  ensure_fresh_workspace
  e2e_build_image "$ENSURE_SNAPSHOT_HASH"
  e2e_derive_names "$RUN_ID" "verify"
  mkdir -p "$E2E_RUN_DIR"
  e2e_admission_begin
  e2e_connect_infra
  e2e_db_purge
  e2e_migrate
  e2e_stack_start

  # V 载荷：真实 API 断言（/health 200）——expect=fail 却通过 → 判定不符
  PASS_SPEC='import { expect, test } from "@playwright/test"
test("smoke 夹具：健康端点应 200", async ({ request }) => {
  const r = await request.get("/health")
  expect(r.status()).toBe(200)
})
'
  FAIL_SPEC='import { expect, test } from "@playwright/test"
test("smoke 夹具：健康端点应 500（故意失败）", async ({ request }) => {
  const r = await request.get("/health")
  expect(r.status()).toBe(500)
})
'
  W_PATH="defects/$FIX_ID.json"
  W_CONTENT="$(cat "$E2E_DIR/defects/$FIX_ID.json")"
  b64() { printf '%s' "$1" | openssl base64 -e -A; }

  # B1 V 判定不符 → exit 9 零落盘（同批 W 绝不应用）
  BEFORE="$(sha256sum "$E2E_DIR/$W_PATH" | awk '{print $1}')"
  OPS1="$(mktemp)"
  {
    printf 'V\t9001\tfail\t%s\n' "$(b64 "$PASS_SPEC")"
    printf 'W\t%s\t%s\n' "$W_PATH" "$(b64 '{"id":"DEF-9001","status":"graduated"}')"
    printf 'END\tok\t0\t冒烟落账\n'
  } > "$OPS1"
  rc=0
  e2e_ops_apply "$OPS1" || rc=$?
  AFTER="$(sha256sum "$E2E_DIR/$W_PATH" | awk '{print $1}')"
  printf 'B1 rc=%s before=%s after=%s\n' "$rc" "$BEFORE" "$AFTER"
  [[ "$rc" == 9 && "$BEFORE" == "$AFTER" ]] || exit 11

  # B2 V 判定相符（expect=fail 且真失败）→ 同批 W 落账
  OPS2="$(mktemp)"
  {
    printf 'V\t9001\tfail\t%s\n' "$(b64 "$FAIL_SPEC")"
    printf 'W\treplay/smoke-apply.txt\t%s\n' "$(b64 'op 协议原子应用证据（冒烟，跑完即删）')"
    printf 'END\tok\t0\t冒烟落账\n'
  } > "$OPS2"
  rc=0
  e2e_ops_apply "$OPS2" || rc=$?
  printf 'B2 rc=%s applied=%s\n' "$rc" "$(cat "$E2E_DIR/replay/smoke-apply.txt" 2>/dev/null)"
  [[ "$rc" == 0 && -f "$E2E_DIR/replay/smoke-apply.txt" ]] || exit 12
  rm -f "$E2E_DIR/replay/smoke-apply.txt" "$OPS1" "$OPS2"

  e2e_teardown
  E2E_ACTIVE_RUN_ID=""
  lock_release_one "$(e2e_owner_lock_name)"
  e2e_registry_write ok 0
) > "$ART/b1.jsonl" 2> "$ART/b1.err" || B_RC=$?
printf '%s\n' "$B_RC" > "$ART/b1.exitcode"
if [[ "$B_RC" == 0 ]] && grep -q 'B1 rc=9' "$ART/b1.jsonl"; then
  pass "B1 V expect=fail 却通过（真实执行器真跑）→ exit 9 零落盘"
else
  fail "B1" "rc=$B_RC out=$(grep '^B1' "$ART/b1.jsonl" 2>/dev/null) err=$(tail -5 "$ART/b1.err")"
fi
if grep -q 'B2 rc=0' "$ART/b1.jsonl"; then
  pass "B2 V 判定相符（真失败）→ 同批 W 原子落账"
else
  fail "B2" "out=$(grep '^B2' "$ART/b1.jsonl" 2>/dev/null) err=$(tail -5 "$ART/b1.err")"
fi
jq -s -e 'any(.[]; .event == "step.completed" and .verdict == "did-not-fail")' "$ART/b1.jsonl" >/dev/null 2>&1 \
  && pass "B3 verdict=did-not-fail 事件留痕（拒绝原因可机器消费）" \
  || fail "B3" "缺 verdict 事件"
jq -s -e 'any(.[]; .event == "step.completed" and .verdict == "reproduced")' "$ART/b1.jsonl" >/dev/null 2>&1 \
  && pass "B4 verdict=reproduced 事件留痕" \
  || fail "B4" "缺 verdict 事件"
[[ ! -d "$E2E_DIR/.verify-run" ]] \
  && pass "B5 校验运行后宿主 .verify-run 临时目录清理" || fail "B5" ".verify-run 残留"

echo "== 收尾：夹具清理与工作树签名核对"
cleanup
FINAL_SIG="$(tree_signature)"
printf 'final_tree=%s\n' "$FINAL_SIG" >> "$ART/context.txt"
if [[ "$BASE_SIG" == "$FINAL_SIG" ]]; then
  pass "C1 夹具清理后工作树签名回到基线（夹具不入仓库）"
else
  fail "C1" "签名不符：base=$BASE_SIG final=$FINAL_SIG（见 $ART/context.txt）"
fi
run c2 "$DEVENV" --json e2e defect list
if [[ "$(cat "$ART/c2.exitcode")" == 0 ]] && last_json c2 '.defects == []'; then
  pass "C2 绿地空树 defect list 输出空数组 exit 0"
else
  fail "C2" "rc=$(cat "$ART/c2.exitcode") out=$(tail -1 "$ART/c2.out")"
fi

{
  echo "# #106 生命周期决策引擎真实引擎冒烟"
  echo
  echo "- HEAD：$(git -C "$REPO_ROOT" rev-parse HEAD)"
  echo "- 基线/终态工作树签名：$BASE_SIG / $FINAL_SIG"
  echo "- 通过：$PASS_COUNT；失败：$FAILURES"
  echo
  echo "## 逐项结果"
  cat "$ART/results.txt"
  echo
  echo "## 原始证据"
  echo "各步骤 .cmd/.out/.err/.exitcode 与 b1.jsonl（V 载荷真跑事件流）在本目录。"
} > "$ART/SUMMARY.md"

echo "------------------------------------------------------------"
echo "冒烟完成：${PASS_COUNT} 通过，${FAILURES} 失败（汇总：$ART/SUMMARY.md）"
[[ "$FAILURES" == 0 ]]