#!/usr/bin/env bash
# ============================================================================
# e2e report 实测复现门禁真实引擎冒烟（#109 AC 真跑实证；#117 演练可复用）
#
# 经 devenv 唯一入口，在真实引擎 + 真实 per-run 隔离栈 + 真实执行器上验证：
#   S1 真实门禁不过：原型 DEF-0001（NUL 名 500）在 dev **已由 #66 修复** → 每轮
#      exit 1 未复现 → **exit 8 零登记**（事实源树逐字节不变）
#   S2 pure 路径 1 轮分类：同一规则缺口行使纯契约路径（无外部状态）→ 1 轮过门禁
#      → exit 0 登记（**临时夹具，跑完即删，不入仓库**）
#   S3 已入库 DEF-0001（#109 登记的纯空白名缺陷）可被下游重放：
#      `e2e replay --attempts 3` → exit 0 + 签名比对 allMatched=true
#   S4 已入库记录 schema 合法且门禁证据完整（gate.attempts=3 / rounds / precondition）
#
# 夹具是**临时**载荷（标题明示非入库记录），**不入仓库**；S2 登记产生的记录/脚本/
# 缓存跑完即删并核对工作树签名回到基线。「缺陷记录永不删除」的不变量锚在**已入库**
# 记录与 git 历史（Spec-e2e §3），未入库的验收夹具不在其列（与 #108 冒烟同口径）。
# 原始证据与 SUMMARY.md 写入 .artifacts/109-report-gate/smoke/（gitignored）。
#
# 用法：devenv/test/e2e-report-smoke.sh [--run-id BASE]
# 要求：引擎已就绪（devenv doctor 退出 0）；本脚本会执行 devenv up（幂等）。
# ============================================================================
set -Eeuo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TEST_DIR/../.." && pwd)"
DEVENV="$REPO_ROOT/devenv/devenv"
ART="$REPO_ROOT/.artifacts/109-report-gate/smoke"
E2E_DIR="$REPO_ROOT/apps/e2e"
RUN_BASE="rpt109s-$(date +%s)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run-id) RUN_BASE="${2:?--run-id 需要值}"; shift 2 ;;
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
printf 'HEAD=%s\nbaseline_tree=%s\nrun_base=%s\n' \
  "$(git -C "$REPO_ROOT" rev-parse HEAD)" "$BASE_SIG" "$RUN_BASE" > "$ART/context.txt"
git -C "$REPO_ROOT" status --porcelain >> "$ART/context.txt"

run() { # run <name> <cmd...>
  local name="$1"; shift
  set +e
  "$@" > "$ART/$name.out" 2> "$ART/$name.err"
  local rc=$?
  set -e
  printf '%s\n' "$rc" > "$ART/$name.exitcode"
}
rc_of() { cat "$ART/$1.exitcode"; }
last_json() { jq -s -e '.[-1] | '"$2" "$ART/$1.out" >/dev/null 2>&1; }

cleanup_fixtures() {
  # S2 临时登记产物回收（未入库夹具；已入库 DEF-0001 永不删除）
  local id
  for id in ${S2_ID:-}; do
    [[ "$id" =~ ^DEF-[0-9]{4}$ ]] || continue
    [[ "$id" == "DEF-0001" ]] && continue   # 入库记录永不动
    rm -f "$E2E_DIR/defects/$id.json" "$E2E_DIR/replay/$id.mjs"
  done
  rm -f "$E2E_DIR/.registry.json"
  rmdir "$E2E_DIR/defects" 2>/dev/null || true
}
trap 'cleanup_fixtures' EXIT

echo "== 前置：devenv up（幂等）"
run up "$DEVENV" up
[[ "$(rc_of up)" == 0 ]] || { printf 'devenv up 失败（rc=%s），见 %s/up.err\n' "$(rc_of up)" "$ART" >&2; exit 3; }

# --- 临时夹具载荷 -------------------------------------------------------------
# S1：NUL 名缺陷（dev 已修复）→ 每轮未复现 → 门禁不过
cat > "$ART/nul-fixed.mjs" <<'MJS'
// 临时夹具（不入仓库）：原型 DEF-0001（NUL 名引发 500）在 dev 已由 #66 regex 修复。
const base = process.env.E2E_API_BASE_URL ?? 'http://127.0.0.1:3000'
const AID = 'post-enforcement-points.nul-name'
const mark = (errorClass, outcome, markers) =>
  console.log('NE-E2E-SIGNATURE ' + JSON.stringify({
    schemaVersion: 1, assertionId: AID, errorClass, outcome, semanticMarkers: markers,
  }))
let resp, body
try {
  resp = await fetch(`${base}/enforcement-points`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'a' + String.fromCharCode(0) + 'b', lat: 23.1291, lng: 113.2644 }),
  })
  body = await resp.json().catch(() => ({}))
} catch (e) {
  mark('infrastructure', 'unknown', [{ key: 'error.code', value: String(e?.cause?.code ?? 'FETCH_FAILED') }])
  process.exit(2)
}
const reproduced = resp.status >= 500
mark('assertion', reproduced ? 'reproduced' : 'not-reproduced', [
  { key: 'http.status.expected', value: '5xx' },
  { key: 'http.status.actual', value: String(resp.status) },
])
process.exit(reproduced ? 0 : 1)
MJS
# S2：pure 路径（共享包导出纯 schema，白盒合规 Spec-e2e §1）
cat > "$ART/pure.mjs" <<'MJS'
// 临时夹具（不入仓库）：pure 路径 1 轮门禁分类演示（纯契约 schema，无外部状态）。
import { CreateEnforcementPointSchema } from '@ne/contracts'
const AID = 'contracts.create-enforcement-point.whitespace-name'
const parsed = CreateEnforcementPointSchema.safeParse({ name: ' ', lat: 23.1291, lng: 113.2644 })
const reproduced = parsed.success === true
console.log('NE-E2E-SIGNATURE ' + JSON.stringify({
  schemaVersion: 1, assertionId: AID, errorClass: 'assertion',
  outcome: reproduced ? 'reproduced' : 'not-reproduced',
  semanticMarkers: [
    { key: 'schema.parse.expected', value: 'rejected' },
    { key: 'schema.parse.actual', value: parsed.success ? 'accepted' : 'rejected' },
  ],
}))
process.exit(reproduced ? 0 : 1)
MJS

PRECOND_EXT='每轮：空库（DROP DATABASE WITH FORCE + CREATE）→ prisma migrate deploy 至最新 → 空 bucket → 空队列键空间，无种子数据'
PRECOND_PURE='单轮：被测路径为纯契约 schema（无外部状态，脚本不触栈）；仍起 per-run 隔离栈使前置状态显式同构'
jq -n --rawfile s "$ART/nul-fixed.mjs" --arg p "$PRECOND_EXT" '{
  schemaVersion:1,source:"manual",
  title:"临时夹具（非入库记录）：NUL 名缺陷在 dev 已修复 → 门禁不过演示",
  summary:"#109 冒烟夹具——验证任一轮未复现即 exit 8 零登记；跑完即删，不入仓库",
  charter:"point-input-safety（门禁不过夹具）",
  suspectedArea:"packages/contracts/src/enforcement-point.ts",
  layer:"api",severity:"low",engine:"agent-session",
  reproducibility:{kind:"external-state",precondition:$p,replayScript:$s},
  evidence:[],sanitized:true}' > "$ART/finding-nul.json"
jq -n --rawfile s "$ART/pure.mjs" --arg p "$PRECOND_PURE" '{
  schemaVersion:1,source:"manual",
  title:"临时夹具（非入库记录）：pure 路径 1 轮门禁分类演示",
  summary:"#109 冒烟夹具——验证按被测路径分类（pure 1 轮）；跑完即删，不入仓库",
  charter:"point-input-safety（pure 路径分类夹具）",
  suspectedArea:"packages/contracts/src/enforcement-point.ts",
  layer:"package",severity:"low",engine:"agent-session",
  reproducibility:{kind:"pure",precondition:$p,replayScript:$s},
  evidence:[],sanitized:true}' > "$ART/finding-pure.json"

# --- S1 真实门禁不过 → exit 8 零登记 ------------------------------------------
echo "== S1 已修复缺陷重放 → 门禁不过 exit 8 零登记"
S1_FP="$(tree_signature)"
run s1 "$DEVENV" --json e2e report --finding "$ART/finding-nul.json" --run-id "${RUN_BASE}-nul"
if [[ "$(rc_of s1)" == 8 ]] && last_json s1 \
  '.command == "e2e" and .subcommand == "report" and .status == "failed" and .exitCode == 8 and .registered == false and .gate.reason == "round-not-reproduced"'; then
  pass "S1 每轮未复现（dev 已修复）→ exit 8 + registered=false + gate.reason=round-not-reproduced"
else
  fail "S1" "rc=$(rc_of s1) out=$(tail -2 "$ART/s1.out") err=$(tail -8 "$ART/s1.err")"
fi
[[ "$(tree_signature)" == "$S1_FP" ]] \
  && pass "S1 门禁不过零登记（工作树签名逐字节回到基线）" || fail "S1zero" "工作树被改动"
S1_DBS="$(jq -r '.database' "$REPO_ROOT/.devenv-state/e2e-runs/${RUN_BASE}-nul-a"*.json 2>/dev/null | sort -u | wc -l | tr -d ' ')"
[[ "$S1_DBS" == 3 ]] && pass "S1 门禁不过仍实测 3 轮独立键空间（预算已花，证据留痕）" || fail "S1db" "独立库数=$S1_DBS"
S1_ASSOC="$(jq -r '.defectId // "absent"' "$REPO_ROOT/.devenv-state/e2e-runs/${RUN_BASE}-nul-a1.json" 2>/dev/null)"
[[ "$S1_ASSOC" == "absent" ]] && pass "S1 零登记亦不留缺陷关联（登记册无 defectId）" || fail "S1assoc" "defectId=$S1_ASSOC"

# --- S2 pure 路径 1 轮过门禁 → 登记（临时夹具，跑完即删）----------------------
echo "== S2 pure 路径 1 轮分类 → exit 0 登记"
run s2 "$DEVENV" --json e2e report --finding "$ART/finding-pure.json" --run-id "${RUN_BASE}-pure"
S2_ID="$(jq -s -r '.[-1].defectId // empty' "$ART/s2.out" 2>/dev/null || printf '')"
if [[ "$(rc_of s2)" == 0 ]] && last_json s2 \
  '.status == "ok" and .exitCode == 0 and .registered == true and .kind == "pure" and .attempts == 1 and .minAttempts == 1'; then
  pass "S2 pure 路径 1 轮过门禁 → exit 0 登记（按被测路径分类，非按引擎）"
else
  fail "S2" "rc=$(rc_of s2) id=$S2_ID out=$(tail -2 "$ART/s2.out") err=$(tail -8 "$ART/s2.err")"
fi
if [[ -n "$S2_ID" && -f "$E2E_DIR/defects/$S2_ID.json" ]]; then
  [[ "$(jq -r '.reproducibility.gate.attempts' "$E2E_DIR/defects/$S2_ID.json")" == 1 ]] \
    && pass "S2 gate.attempts=1 回填（pure 预算）" || fail "S2att" "attempts 不符"
  [[ "$(jq -r '.reproducibility.gate.signatureMatched' "$E2E_DIR/defects/$S2_ID.json")" == "null" ]] \
    && pass "S2 单轮 signatureMatched=null（无从跨轮比对，不自证同一）" || fail "S2sig" "签名比对位不符"
  [[ -f "$E2E_DIR/replay/$S2_ID.mjs" ]] \
    && pass "S2 记录 + 脚本同一事务入库" || fail "S2script" "脚本缺失"
else
  fail "S2files" "id=$S2_ID 记录未落盘"
fi

# --- S3 已入库 DEF-0001 可被下游重放（3 轮独立键空间 + 签名比对）--------------
echo "== S3 已入库 DEF-0001 重放 3 轮 → exit 0 + allMatched"
if [[ -f "$E2E_DIR/defects/DEF-0001.json" ]]; then
  run s3 "$DEVENV" --json e2e replay DEF-0001 --attempts 3 --run-id "${RUN_BASE}-d1"
  if [[ "$(rc_of s3)" == 0 ]] && last_json s3 \
    '.status == "ok" and .reproduced == true and .attempts == 3 and .signatureMatched == true'; then
    pass "S3 入库 DEF-0001 三轮真跑全复现 + 签名比对 allMatched=true（下游 #110/#112 夹具可用）"
  else
    fail "S3" "rc=$(rc_of s3) out=$(tail -2 "$ART/s3.out") err=$(tail -8 "$ART/s3.err")"
  fi
  S3_DBS="$(jq -r '.database' "$REPO_ROOT/.devenv-state/e2e-runs/${RUN_BASE}-d1-a"*.json 2>/dev/null | sort -u | wc -l | tr -d ' ')"
  [[ "$S3_DBS" == 3 ]] && pass "S3 每轮独立数据库键空间（固定空白名不撞唯一约束）" || fail "S3db" "独立库数=$S3_DBS"
else
  fail "S3pre" "DEF-0001 未入库（#109 登记产物缺失）"
fi

# --- S4 入库记录 schema 合法 + 门禁证据完整 -----------------------------------
echo "== S4 入库记录 schema 与门禁证据"
run s4 "$DEVENV" --json e2e defect show DEF-0001
if [[ "$(rc_of s4)" == 0 ]] && last_json s4 \
  '.defect.id == "DEF-0001" and .defect.status == "reported" and .defect.engine == "fast-check" and .defect.reproducibility.kind == "external-state" and .defect.reproducibility.gate.attempts == 3 and (.defect.reproducibility.gate.rounds | length == 3) and .defect.reproducibility.gate.allFailed == true and .defect.reproducibility.gate.signatureMatched == true'; then
  pass "S4 DEF-0001 schema 合法：reported/fast-check/external-state，gate 3 轮证据完整"
else
  fail "S4" "rc=$(rc_of s4) out=$(tail -1 "$ART/s4.out") err=$(tail -5 "$ART/s4.err")"
fi
last_json s4 '.defect.reproducibility.gate.precondition != null and (.defect.reproducibility.counterexample.input != null) and (.defect.issue == null)' \
  && pass "S4 前置状态声明 + 属性反例在场；issue 回链位留空（写入归 #114）" || fail "S4b" "门禁证据/回链位不符"
last_json s4 '.defect.reproducibility.gate.rounds[0].keySpace.database != .defect.reproducibility.gate.rounds[1].keySpace.database' \
  && pass "S4 逐轮键空间坐标入库（独立性可机器复核）" || fail "S4c" "键空间坐标缺失"

# --- 收尾：回收临时夹具，核对工作树回到基线 -----------------------------------
cleanup_fixtures
trap - EXIT
END_SIG="$(tree_signature)"
[[ "$END_SIG" == "$BASE_SIG" ]] \
  && pass "S5 临时夹具全部回收，工作树签名回到基线（入库 DEF-0001 未被触碰）" \
  || fail "S5" "工作树与基线不符（残留夹具？）"

{
  printf '# #109 report 冒烟 SUMMARY\n\n'
  printf -- '- HEAD: %s\n- baseline_tree: %s\n- run_base: %s\n' \
    "$(git -C "$REPO_ROOT" rev-parse HEAD)" "$BASE_SIG" "$RUN_BASE"
  printf -- '- 结果：%s 通过 / %s 失败\n\n' "$PASS_COUNT" "$FAILURES"
  printf '## 逐项\n\n'
  cat "$ART/results.txt"
} > "$ART/SUMMARY.md"

echo "------------------------------------------------------------"
echo "e2e report 冒烟完成：${PASS_COUNT} 通过，${FAILURES} 失败（证据：$ART）"
[[ "$FAILURES" == 0 ]]