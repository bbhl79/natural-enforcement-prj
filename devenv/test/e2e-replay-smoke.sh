#!/usr/bin/env bash
# ============================================================================
# e2e replay 重放与失败签名原语真实引擎冒烟（#108 AC1/AC2/AC4 真跑实证）
#
# 经 devenv 唯一入口，在真实引擎 + 真实 per-run 隔离栈 + 真实执行器上验证：
#   S1 DEF-0002 类（纯空白名被接受，dev **未收紧**）→ replay exit 0 复现 + 约定标记签名
#   S2 DEF-0001 类（NUL 名引发 500，dev **已由 #66 regex 修复**）→ replay exit 4
#      语义反转「环境漂移或已修复？」（脚本用原型裸退出码形态，验证约定是增量兼容）
#   S3 多轮 --attempts 3：每轮独立键空间（固定名重复创建不撞唯一约束）→ exit 0 +
#      签名比对 allMatched=true（同一断言处因同一原因失败）
#   S4 基础设施错误（连接被拒）→ exit 3，**不是**「未复现」
#   S5 未知 ID → exit 10（零资源创建）
#   S6 输出协议：结果流纯 JSONL；S7 每轮 replay.json/run.json/登记册 track=replay
#
# 夹具是**临时** schema 合法记录 + 零依赖脚本（DEF-9101/9102/9103，标题明示非真实
# 缺陷），**不入仓库**（真实登记归 #109/#117）；结束/失败时删除并核对工作树签名回到
# 基线。原始证据与 SUMMARY.md 写入 .artifacts/108-replay-signature/smoke/（gitignored）。
#
# 用法：devenv/test/e2e-replay-smoke.sh [--run-id BASE]
# 要求：引擎已就绪（devenv doctor 退出 0）；本脚本会执行 devenv up（幂等）。
# ============================================================================
set -Eeuo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TEST_DIR/../.." && pwd)"
DEVENV="$REPO_ROOT/devenv/devenv"
ART="$REPO_ROOT/.artifacts/108-replay-signature/smoke"
E2E_DIR="$REPO_ROOT/apps/e2e"
RUN_BASE="rep108-$(date +%s)"
IDS="DEF-9101 DEF-9102 DEF-9103"

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

cleanup() {
  local id
  for id in $IDS; do
    rm -f "$E2E_DIR/defects/$id.json" "$E2E_DIR/replay/$id.mjs"
  done
  rm -f "$E2E_DIR/.registry.json"
}
trap cleanup EXIT

run() { # run <label> <cmd...>：捕获 stdout/stderr/exitcode；恒返回 0（先捕获 rc 再判定）
  local label="$1"; shift
  local rc=0
  printf '%q ' "$@" > "$ART/$label.cmd"
  "$@" > "$ART/$label.out" 2> "$ART/$label.err" || rc=$?
  printf '%s\n' "$rc" > "$ART/$label.exitcode"
  printf '[%s] rc=%s cmd=%s\n' "$(date -u +%H:%M:%S)" "$rc" "$(cat "$ART/$label.cmd")" >> "$ART/evidence.log"
  return 0
}
rc_of() { cat "$ART/$1.exitcode"; }
last_json() { jq -s -e '.[-1] | '"$2" "$ART/$1.out" >/dev/null 2>&1; }

echo "== 前置：doctor / up / 夹具（临时，不入仓库）"
run doctor "$DEVENV" doctor
if [[ "$(rc_of doctor)" != 0 ]]; then echo "doctor 未通过，见 $ART/doctor.err" >&2; exit 1; fi
run up "$DEVENV" up
if [[ "$(rc_of up)" != 0 ]]; then echo "devenv up 失败，见 $ART/up.err" >&2; exit 1; fi

mkdir -p "$E2E_DIR/defects" "$E2E_DIR/replay"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# --- 夹具记录（schema 合法；标题明示非真实缺陷，跑完即删）---------------------
# 坐标一律广州（23.1291,113.2644）；NUL 用 String.fromCharCode(0) 构造（避免源码裸控制字符）
cat > "$E2E_DIR/defects/DEF-9101.json" <<JSON
{
  "schemaVersion": 1,
  "id": "DEF-9101",
  "title": "冒烟夹具（非真实缺陷）：纯空白名被接受入库（DEF-0002 类，dev 未收紧）",
  "summary": "#108 验收夹具——契约 nameSchema 无 trim/nonblank，纯空白名过契约并入库；跑完即删，不入仓库",
  "status": "reported",
  "engine": "agent-session",
  "layer": "api",
  "discoveredAt": "$NOW",
  "discoveredBy": "e2e-replay-smoke",
  "charter": "创建点位输入空间全量安全（广州点位）",
  "suspectedArea": "packages/contracts/src/enforcement-point.ts",
  "severity": "low",
  "reproducibility": {
    "kind": "external-state",
    "replayPath": "apps/e2e/replay/DEF-9101.mjs",
    "replayCommand": "node apps/e2e/replay/DEF-9101.mjs",
    "gate": { "attempts": 0, "keySpaces": [], "allFailed": false }
  },
  "evidence": [],
  "sanitized": true
}
JSON
cat > "$E2E_DIR/defects/DEF-9102.json" <<JSON
{
  "schemaVersion": 1,
  "id": "DEF-9102",
  "title": "冒烟夹具（非真实缺陷）：NUL 名引发 500（DEF-0001 类，dev 已由 #66 修复）",
  "summary": "#108 验收夹具——验证修复后重放语义自动反转（exit 4）；跑完即删，不入仓库",
  "status": "reported",
  "engine": "agent-session",
  "layer": "api",
  "discoveredAt": "$NOW",
  "discoveredBy": "e2e-replay-smoke",
  "charter": "创建点位输入空间全量安全（广州点位）",
  "suspectedArea": "packages/contracts/src/enforcement-point.ts",
  "severity": "medium",
  "reproducibility": {
    "kind": "external-state",
    "replayPath": "apps/e2e/replay/DEF-9102.mjs",
    "replayCommand": "node apps/e2e/replay/DEF-9102.mjs",
    "gate": { "attempts": 0, "keySpaces": [], "allFailed": false }
  },
  "evidence": [],
  "sanitized": true
}
JSON
cat > "$E2E_DIR/defects/DEF-9103.json" <<JSON
{
  "schemaVersion": 1,
  "id": "DEF-9103",
  "title": "冒烟夹具（非真实缺陷）：基础设施错误档（连接被拒，路径未被行使）",
  "summary": "#108 验收夹具——验证基础设施错误 exit 3 与「未复现」exit 4 分档；跑完即删，不入仓库",
  "status": "reported",
  "engine": "agent-session",
  "layer": "api",
  "discoveredAt": "$NOW",
  "discoveredBy": "e2e-replay-smoke",
  "charter": "创建点位输入空间全量安全（广州点位）",
  "suspectedArea": "devenv/compose.e2e.yaml",
  "severity": "low",
  "reproducibility": {
    "kind": "external-state",
    "replayPath": "apps/e2e/replay/DEF-9103.mjs",
    "replayCommand": "node apps/e2e/replay/DEF-9103.mjs",
    "gate": { "attempts": 0, "keySpaces": [], "allFailed": false }
  },
  "evidence": [],
  "sanitized": true
}
JSON

# --- 零第三方依赖复现脚本（node 内建 fetch；约定哨兵行）-----------------------
cat > "$E2E_DIR/replay/DEF-9101.mjs" <<'MJS'
// #108 冒烟夹具（非真实缺陷）：DEF-0002 类——纯空白名被接受入库（dev 未收紧）。
// 零第三方依赖（node 内建 fetch）；exit 0=复现 / 1=未复现 / 2=基础设施错误。
// 失败输出约定：stdout 一行 NE-E2E-SIGNATURE <compact JSON>（只放语义维度，不放消息文本）。
const base = process.env.E2E_API_BASE_URL ?? 'http://127.0.0.1:3000'
const AID = 'post-enforcement-points.whitespace-name'
const mark = (errorClass, outcome, markers) =>
  console.log('NE-E2E-SIGNATURE ' + JSON.stringify({
    schemaVersion: 1, assertionId: AID, errorClass, outcome, semanticMarkers: markers,
  }))
let resp, body
try {
  resp = await fetch(`${base}/enforcement-points`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '   ', lat: 23.1291, lng: 113.2644 }),
  })
  body = await resp.json().catch(() => ({}))
} catch (e) {
  mark('infrastructure', 'unknown', [{ key: 'error.code', value: String(e?.cause?.code ?? 'FETCH_FAILED') }])
  process.exit(2)
}
const reproduced = resp.status === 201 && typeof body.id === 'number'
mark('assertion', reproduced ? 'reproduced' : 'not-reproduced', [
  { key: 'http.status.expected', value: '201' },
  { key: 'http.status.actual', value: String(resp.status) },
  { key: 'body.id', value: typeof body.id },
])
process.exit(reproduced ? 0 : 1)
MJS
cat > "$E2E_DIR/replay/DEF-9102.mjs" <<'MJS'
// #108 冒烟夹具（非真实缺陷）：DEF-0001 类——NUL 名引发 500（dev 已由 #66 regex 修复）。
// **原型裸退出码形态**（无约定标记）：验证约定是增量兼容，旧脚本仍可单轮诊断。
const base = process.env.E2E_API_BASE_URL ?? 'http://127.0.0.1:3000'
const nulName = 'a' + String.fromCharCode(0) + 'b'
const resp = await fetch(`${base}/enforcement-points`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: nulName, lat: 23.1291, lng: 113.2644 }),
})
console.log('status=' + resp.status)
if (resp.status >= 500) process.exit(0) // 复现
process.exit(1)                          // 未复现（已修复 → 语义反转）
MJS
cat > "$E2E_DIR/replay/DEF-9103.mjs" <<'MJS'
// #108 冒烟夹具（非真实缺陷）：基础设施错误档——连一个确定关闭的端口（连接被拒）。
const base = process.env.E2E_API_BASE_URL ?? 'http://api:3000'
const unreachable = base.replace(':3000', ':9999')
const AID = 'get-health.connect'
try {
  await fetch(`${unreachable}/health`)
  console.log('NE-E2E-SIGNATURE ' + JSON.stringify({
    schemaVersion: 1, assertionId: AID, errorClass: 'assertion', outcome: 'not-reproduced',
    semanticMarkers: [{ key: 'error.code', value: 'UNEXPECTED_SUCCESS' }],
  }))
  process.exit(1)
} catch (e) {
  console.log('NE-E2E-SIGNATURE ' + JSON.stringify({
    schemaVersion: 1, assertionId: AID, errorClass: 'infrastructure', outcome: 'unknown',
    semanticMarkers: [{ key: 'error.code', value: String(e?.cause?.code ?? 'FETCH_FAILED') }],
  }))
  process.exit(2)
}
MJS

echo "== S1 DEF-0002 类（dev 未收紧）→ exit 0 复现"
run s1 "$DEVENV" --json e2e replay DEF-9101 --run-id "${RUN_BASE}-w1"
if [[ "$(rc_of s1)" == 0 ]] && last_json s1 \
  '.command == "e2e" and .subcommand == "replay" and .status == "ok" and .exitCode == 0 and .reproduced == true and .defectId == "DEF-9101" and (.runs[0].signature.errorClass == "assertion")'; then
  pass "S1 纯空白名缺陷真跑复现 → exit 0 + 约定标记签名（errorClass=assertion）"
else
  fail "S1" "rc=$(rc_of s1) out=$(tail -2 "$ART/s1.out") err=$(tail -8 "$ART/s1.err")"
fi
last_json s1 '.runs[0].signature.semanticMarkers | any(.key == "http.status.actual" and .value == "201")' \
  && pass "S1 签名承载关键语义标记（实际响应状态 201，非完整消息文本）" \
  || fail "S1markers" "终值不符：$(tail -1 "$ART/s1.out")"
last_json s1 '.signatureMatched == null and .attempts == 1 and .gateMinAttempts == 3' \
  && pass "S1 单轮 signatureMatched=null；门禁下限按被测路径输出 3（供 #109）" \
  || fail "S1min" "终值不符：$(tail -1 "$ART/s1.out")"

echo "== S2 DEF-0001 类（dev 已修复）→ exit 4 语义反转"
run s2 "$DEVENV" --json e2e replay DEF-9102 --run-id "${RUN_BASE}-n1"
if [[ "$(rc_of s2)" == 4 ]] && grep -q '环境漂移或已修复' "$ART/s2.err" \
  && last_json s2 '.status == "failed" and .exitCode == 4 and .reproduced == false and (.hint | contains("环境漂移或已修复"))'; then
  pass "S2 NUL 名缺陷已修复 → 真跑 exit 4 + 语义反转提示「环境漂移或已修复？」"
else
  fail "S2" "rc=$(rc_of s2) err=$(tail -8 "$ART/s2.err") out=$(tail -1 "$ART/s2.out")"
fi
grep -q 'status=400' "$ART/s2.err" \
  && pass "S2 实际观测：契约 regex 拒 NUL → 400（不再是 500），脚本裸退出码形态仍兼容" \
  || fail "S2obs" "未见 400 观测：$(grep -o 'status=[0-9]*' "$ART/s2.err" | head -2)"
last_json s2 '.runs[0].signature == null' \
  && pass "S2 无约定标记 → signature=null（不编造；单轮仍按退出码判定）" \
  || fail "S2sig" "终值不符：$(tail -1 "$ART/s2.out")"

echo "== S3 多轮独立键空间 → exit 0 + 签名比对 allMatched"
run s3 "$DEVENV" --json e2e replay DEF-9101 --attempts 3 --run-id "${RUN_BASE}-w3"
if [[ "$(rc_of s3)" == 0 ]] && last_json s3 \
  '.attempts == 3 and .reproduced == true and .signatureMatched == true and (.runs | length == 3)'; then
  pass "S3 三轮真跑全复现 + 签名比对 allMatched=true → exit 0（同一断言处因同一原因失败）"
else
  fail "S3" "rc=$(rc_of s3) out=$(tail -2 "$ART/s3.out") err=$(tail -8 "$ART/s3.err")"
fi
REG="$REPO_ROOT/.devenv-state/e2e-runs"
DBS="$(jq -r '.database' "$REG/${RUN_BASE}-w3-a1.json" "$REG/${RUN_BASE}-w3-a2.json" "$REG/${RUN_BASE}-w3-a3.json" 2>/dev/null | sort -u | wc -l | tr -d ' ')"
[[ "$DBS" == 3 ]] \
  && pass "S3 每轮独立数据库键空间（3 个不同库名）——固定空白名重复创建不撞唯一约束" \
  || fail "S3db" "独立库数=$DBS（期望 3）"
TRACKS="$(jq -r '.track' "$REG/${RUN_BASE}-w3-a1.json" "$REG/${RUN_BASE}-w3-a2.json" "$REG/${RUN_BASE}-w3-a3.json" 2>/dev/null | sort -u)"
[[ "$TRACKS" == "replay" ]] \
  && pass "S3 运行登记册 track=replay（复用 #70 登记册，可 devenv e2e runs 查）" \
  || fail "S3track" "track=$TRACKS"
STATUSES="$(jq -r '.status' "$REG/${RUN_BASE}-w3-a1.json" "$REG/${RUN_BASE}-w3-a2.json" "$REG/${RUN_BASE}-w3-a3.json" 2>/dev/null | sort -u)"
[[ "$STATUSES" == "ok" ]] && pass "S3 三轮登记册终态 ok（回收完成，非 running/aborted）" || fail "S3status" "status=$STATUSES"

echo "== S4 基础设施错误 → exit 3（不是未复现）"
run s4 "$DEVENV" --json e2e replay DEF-9103 --run-id "${RUN_BASE}-i1"
if [[ "$(rc_of s4)" == 3 ]] && last_json s4 '.exitCode == 3 and (.runs[0].verdict == "infrastructure") and (.runs[0].signature.errorClass == "infrastructure")'; then
  pass "S4 连接被拒真跑 → exit 3 + verdict/errorClass=infrastructure（与语义反转分档）"
else
  fail "S4" "rc=$(rc_of s4) out=$(tail -2 "$ART/s4.out") err=$(tail -8 "$ART/s4.err")"
fi
last_json s4 '.runs[0].signature.semanticMarkers | any(.key == "error.code" and .value == "ECONNREFUSED")' \
  && pass "S4 基础设施档语义标记 error.code=ECONNREFUSED（结构化错误码，非消息文本）" \
  || fail "S4code" "终值不符：$(tail -1 "$ART/s4.out")"

echo "== S5 未知 ID → exit 10"
run s5 "$DEVENV" --json e2e replay DEF-9999
[[ "$(rc_of s5)" == 10 ]] && last_json s5 '.status == "failed" and .exitCode == 10' \
  && pass "S5 未知 ID → exit 10 + 终值 failed/10（计划阶段即拒）" \
  || fail "S5" "rc=$(rc_of s5) err=$(tail -4 "$ART/s5.err")"

echo "== S6/S7 输出协议与逐轮证据"
if grep -qv '^{' "$ART/s1.out"; then
  fail "S6" "结果流混入非 JSON 行：$(grep -v '^{' "$ART/s1.out" | head -2)"
else
  pass "S6 长命令结果流纯 JSONL（脚本原始输出/诊断走 stderr）"
fi
jq -s -e 'any(.[]; .event == "step.completed" and .target == "replay" and .verdict == "reproduced")' "$ART/s1.out" >/dev/null 2>&1 \
  && pass "S6 verdict=reproduced 事件留痕（机器可消费）" || fail "S6ev" "缺 verdict 事件"
jq -s -e 'any(.[]; .event == "replay.signatures" and .allMatched == "true")' "$ART/s3.out" >/dev/null 2>&1 \
  && pass "S6 多轮 replay.signatures 事件留痕" || fail "S6sigev" "缺 replay.signatures 事件"
A1="$REPO_ROOT/.artifacts/e2e/${RUN_BASE}-w3-a1"
if [[ -f "$A1/replay.json" && -f "$A1/run.json" && -f "$A1/replay.out" && -d "$A1/logs" ]] \
  && jq -e '.verdict == "reproduced" and .scriptExitCode == 0 and .signature.assertionId == "post-enforcement-points.whitespace-name"' "$A1/replay.json" >/dev/null 2>&1; then
  pass "S7 每轮证据齐备（replay.out 载荷 / replay.json 判定+签名 / run.json / logs 服务日志）"
else
  fail "S7" "产物缺失或不符：$(ls "$A1" 2>/dev/null)"
fi
grep -q 'NE-E2E-SIGNATURE' "$A1/replay.out" \
  && pass "S7 约定哨兵行落在 replay.out（签名载荷通道可复核）" || fail "S7out" "replay.out 缺哨兵行"

echo "== 收尾：夹具清理与工作树签名核对"
cleanup
FINAL_SIG="$(tree_signature)"
printf 'final_tree=%s\n' "$FINAL_SIG" >> "$ART/context.txt"
if [[ "$BASE_SIG" == "$FINAL_SIG" ]]; then
  pass "C1 夹具清理后工作树签名回到基线（临时记录/脚本不入仓库）"
else
  fail "C1" "签名不符：base=$BASE_SIG final=$FINAL_SIG（见 $ART/context.txt）"
fi
run c2 "$DEVENV" --json e2e defect list
[[ "$(rc_of c2)" == 0 ]] && last_json c2 '.defects == []' \
  && pass "C2 夹具清理后事实源回到绿地（defect list 空数组 exit 0）" \
  || fail "C2" "rc=$(rc_of c2) out=$(tail -1 "$ART/c2.out")"

{
  echo "# #108 replay 重放与失败签名原语真实引擎冒烟"
  echo
  echo "- HEAD：$(git -C "$REPO_ROOT" rev-parse HEAD)"
  echo "- 基线/终态工作树签名：$BASE_SIG / $FINAL_SIG"
  echo "- run base：$RUN_BASE"
  echo "- 通过：$PASS_COUNT；失败：$FAILURES"
  echo
  echo "## 逐项结果"
  cat "$ART/results.txt"
  echo
  echo "## 原始证据"
  echo "各步骤 .cmd/.out/.err/.exitcode 在本目录；每轮 run 产物在 .artifacts/e2e/${RUN_BASE}-*/。"
} > "$ART/SUMMARY.md"

echo "------------------------------------------------------------"
echo "冒烟完成：${PASS_COUNT} 通过，${FAILURES} 失败（汇总：$ART/SUMMARY.md）"
[[ "$FAILURES" == 0 ]]