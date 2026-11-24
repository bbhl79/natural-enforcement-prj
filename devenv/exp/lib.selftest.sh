#!/usr/bin/env bash
# lib.sh 辅助函数自检（无需 docker 的部分）。每条断言都有可能失败；含反例。
# 用法：./devenv/exp/lib.selftest.sh   → 全过 exit 0，否则非零
set -Eeuo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export EVIDENCE_DIR="${EVIDENCE_DIR:-$(mktemp -d)}"
# shellcheck source=lib.sh
source "$HERE/lib.sh"
PROD_REPO="$REPO_ROOT"
fail=0
check() { if eval "$2"; then echo "PASS  $1"; else echo "FAIL  $1"; fail=1; fi; }

# ---------------------------------------------------------------- median_worst（字面量期望）
R="$(mktemp)"
printf '%s\n' \
  '{"name":"loop1-total","durationMs":300}' '{"name":"loop2-total","durationMs":100}' \
  '{"name":"loop3-total","durationMs":500}' '{"name":"loop4-total","durationMs":200}' \
  '{"name":"loop5-total","durationMs":400}' '{"name":"loop1-gen","durationMs":9999}' >"$R"
check "median_worst odd n=5: median=300 worst=500 (other names ignored)" \
  "median_worst $R '^loop[0-9]+-total\$' | jq -e '.n==5 and .median==300 and .worst==500' >/dev/null"
printf '%s\n' '{"name":"x1","durationMs":10}' '{"name":"x2","durationMs":20}' '{"name":"x3","durationMs":30}' '{"name":"x4","durationMs":40}' >"$R"
check "median_worst even n=4: median=25 worst=40" \
  "median_worst $R '^x' | jq -e '.n==4 and .median==25 and .worst==40' >/dev/null"
check "median_worst empty selection: n=0 median=null worst=null" \
  "median_worst $R '^nomatch' | jq -e '.n==0 and .median==null and .worst==null' >/dev/null"

# ---------------------------------------------------------------- interval_overlap_ms
check "overlap partial (0,10)/(5,15) = 5"   "[ \"\$(interval_overlap_ms 0 10 5 15)\" = 5 ]"
check "overlap touching (0,10)/(10,20) = 0" "[ \"\$(interval_overlap_ms 0 10 10 20)\" = 0 ]"
check "overlap disjoint (0,10)/(20,30) = 0" "[ \"\$(interval_overlap_ms 0 10 20 30)\" = 0 ]"
check "overlap contained (0,100)/(10,20) = 10" "[ \"\$(interval_overlap_ms 0 100 10 20)\" = 10 ]"

# ---------------------------------------------------------------- lockfile_delta（临时 git 仓库）
# 夹具与真实 `gen package` 产物逐行一致：11 行内容 + 1 行尾部空行 = git diff 的 12 行新增。
T="$(mktemp -d)"
git -C "$T" init -q && git -C "$T" config user.email t@t && git -C "$T" config user.name t
write_lock() { # write_lock <importer-extra-file|-> <packages-extra-file|->：组装 lockfile（块文本原样保留空行）
  {
    printf 'lockfileVersion: "9.0"\n\nimporters:\n\n  packages/a:\n    devDependencies: {}\n\n'
    [[ "$1" == "-" ]] || cat "$1"
    printf 'packages:\n\n  foo@1.0.0:\n    resolution: {integrity: sha512-aaa}\n\n'
    [[ "$2" == "-" ]] || cat "$2"
  } >"$T/pnpm-lock.yaml"
}
BLK="$T/blk.txt"
cat >"$BLK" <<'BLOCK'
  packages/foo:
    devDependencies:
      '@ne/tsconfig':
        specifier: workspace:*
        version: link:../tsconfig
      typescript:
        specifier: 'catalog:'
        version: 6.0.3
      vitest:
        specifier: 'catalog:'
        version: 5.1.1(@types/node@26.6.6)

BLOCK
BIG="$T/big.txt"; { head -n 11 "$BLK"; printf '      left-pad:\n        specifier: 1.3.0\n        version: 1.3.0\n\n'; } >"$BIG"
# 夹具算术自检：BLK=12 行（11 内容+1 空行）；BIG=11+4=15 行；夹具写错会让测试在正确实现下仍失败。
[[ "$(wc -l <"$BLK")" == 12 && "$(wc -l <"$BIG")" == 15 ]] || { echo "FIXTURE ERROR: BLK/BIG line counts" >&2; exit 9; }
RES="$T/res.txt"; printf '  left-pad@1.3.0:\n    resolution: {integrity: sha512-bbb}\n\n' >"$RES"
reset_base() { write_lock - -; git -C "$T" add -A >/dev/null 2>&1 || true; git -C "$T" commit -q --allow-empty -m "base-$RANDOM" 2>/dev/null || true; }
delta() { REPO_ROOT="$T" lockfile_delta "$1" 2>/dev/null || true; }   # 取输出，不让非零退出码污染管道

write_lock - -; git -C "$T" add pnpm-lock.yaml && git -C "$T" commit -q -m base
write_lock "$BLK" -
check "delta: real-shaped block (11 lines + blank = 12 added) -> ok" \
  "delta foo | jq -e '.ok==true and .added==12 and .removed==0 and .hunks==1' >/dev/null"
check "delta: exit status is 0 when ok" "REPO_ROOT=$T lockfile_delta foo >/dev/null"
check "delta: wrong expected package name -> not ok" "delta bar | jq -e '.ok==false' >/dev/null"
check "delta: wrong name returns non-zero exit" "! REPO_ROOT=$T lockfile_delta bar >/dev/null"

write_lock "$BIG" -
check "delta: legit importer with one more dependency (still one additive hunk) -> ok" \
  "delta foo | jq -e '.ok==true and .added==15 and .hunks==1' >/dev/null"

# 反例 1：新 importer + 新增一条解析条目（第二个 hunk）→ 解析结果有扩散，必须停下审查
write_lock "$BIG" "$RES"
check "delta: importer + new resolution entry (2 hunks) -> not ok" \
  "delta foo | jq -e '.ok==false and .hunks==2 and .removed==0' >/dev/null"

# 反例 2：除新 importer 外还改了一个已锁版本
write_lock "$BLK" -; sed -i 's/foo@1.0.0:/foo@1.0.1:/' "$T/pnpm-lock.yaml"
check "delta: extra change of a locked version -> not ok, removed>=1" \
  "delta foo | jq -e '.ok==false and .removed>=1' >/dev/null"

# 反例 3：单个 hunk 内混入顶层键（非缩进行）
{ cat "$BLK"; printf 'snapshots:\n\n'; } >"$T/blk-bad.txt"; write_lock "$T/blk-bad.txt" -
check "delta: top-level key smuggled into the hunk -> not ok" \
  "delta foo | jq -e '.ok==false and .nonIndentedAdded>=1' >/dev/null"

# 反例 4：无任何变化
git -C "$T" checkout -q -- pnpm-lock.yaml
check "delta: no change at all -> not ok" "delta foo | jq -e '.ok==false and .added==0' >/dev/null"

# ---------------------------------------------------------------- make_offline_dockerfile
REPO_ROOT="$PROD_REPO"
OUT="$(mktemp)"
check "offline dockerfile: production file derives successfully" "make_offline_dockerfile $OUT"
check "offline dockerfile: --network=none on the store-mounted RUN only" \
  "[ \"\$(grep -c -e '--network=none' $OUT)\" = 1 ] && grep -e '--network=none' $OUT | grep -q 'id=\${PNPM_STORE_CACHE_ID}'"
check "offline dockerfile: pnpm --offline present exactly once" "[ \"\$(grep -c -e ' --offline ' $OUT)\" = 1 ]"
check "offline dockerfile: lockgen stage keeps its network (no --network=none near 'lockfile-only')" \
  "! grep -e 'lockfile-only' $OUT | grep -q -e '--network=none'"
# 反例：源文件没有缓存挂载（基线 Dockerfile）→ 必须拒绝，而不是静默产出“带网络的离线靶”
BASELINE_DF="$(mktemp -d)"; mkdir -p "$BASELINE_DF/devenv"
git -C "$PROD_REPO" show 1486f5b:devenv/workspace.Dockerfile >"$BASELINE_DF/devenv/workspace.Dockerfile"
REPO_ROOT="$BASELINE_DF"
check "offline dockerfile: baseline file (no cache mount) -> refused (exit != 0)" "! make_offline_dockerfile $OUT 2>/dev/null"
REPO_ROOT="$PROD_REPO"

# ---------------------------------------------------------------- step() 幂等性 + 失败即停
# step 必须被“普通语句”调用（不在 || / if / ! 中），此时 errexit 才对步骤体生效；
# 测试用子 bash 进程复现该调用形态（子进程不受本脚本 errexit 上下文影响）。
run_step_case() { # run_step_case <evidence-dir> <name> <body-function-src> -> 子进程退出码
  EVIDENCE_DIR="$1" bash -c "set -Eeuo pipefail; source '$HERE/lib.sh'; $3; step $2 body" >/dev/null 2>&1
}
capture() { # capture <var> <cmd...>：把命令退出码写入变量，且不触发本脚本的 errexit
  local __n="$1" __rc=0
  shift
  "$@" || __rc=$?
  printf -v "$__n" '%s' "$__rc"
}
SD="$(mktemp -d)"
capture rc_ok    run_step_case "$SD" ok 'body() { echo ran >>"$EVIDENCE_DIR/ok.log"; }'
capture rc_again run_step_case "$SD" ok 'body() { echo ran >>"$EVIDENCE_DIR/ok.log"; }'
check "step: success -> exit 0 and a done-marker" "[ $rc_ok = 0 ] && [ -f $SD/.done-ok ]"
check "step: second call skipped (body ran exactly once)" "[ $rc_again = 0 ] && [ \"\$(wc -l <$SD/ok.log)\" = 1 ]"

capture rc_mid run_step_case "$SD" mid 'body() { echo started >"$EVIDENCE_DIR/mid.started"; false; echo continued >>"$EVIDENCE_DIR/mid.log"; }'
check "step: failing command MID-body stops the body (body DID start; nothing after the failure ran)" \
  "[ -e $SD/mid.started ] && [ ! -e $SD/mid.log ]"
check "step: mid-body failure -> non-zero exit and NO done-marker" "[ $rc_mid != 0 ] && [ ! -f $SD/.done-mid ]"

capture rc_last run_step_case "$SD" last 'body() { true; return 3; }'
check "step: failing last command -> exit status propagated (3), no marker" "[ $rc_last = 3 ] && [ ! -f $SD/.done-last ]"

RETRY_BODY='body() { if [ -e "$EVIDENCE_DIR/retry.flag" ]; then echo ok >"$EVIDENCE_DIR/retry.out"; else return 1; fi; }'
capture rc_r1 run_step_case "$SD" retry "$RETRY_BODY"
touch "$SD/retry.flag"
capture rc_r2 run_step_case "$SD" retry "$RETRY_BODY"
check "step: fail then retry -> first fails, second runs the body and marks done" \
  "[ $rc_r1 != 0 ] && [ $rc_r2 = 0 ] && [ -f $SD/retry.out ] && [ -f $SD/.done-retry ]"

FORCE_OUT="$SD/force.log"
capture rc_f1 run_step_case "$SD" f1 "body() { echo x >>'$FORCE_OUT'; }"
capture rc_f2 env EVIDENCE_DIR="$SD" FORCE=1 bash -c "set -Eeuo pipefail; source '$HERE/lib.sh'; body() { echo x >>'$FORCE_OUT'; }; step f1 body" 
check "step: FORCE=1 reruns an already-done step" "[ $rc_f1 = 0 ] && [ $rc_f2 = 0 ] && [ \"\$(wc -l <$FORCE_OUT)\" = 2 ]"

# step 被放在 errexit 被忽略的位置（|| / if）时的安全性：不得跑过失败命令、不得误标完成。
run_step_ctx() { # run_step_ctx <dir> <name> <form> <body-src>：form = or | if
  local form_src
  case "$3" in
    or) form_src="step $2 body || true" ;;
    if) form_src="if step $2 body; then :; fi" ;;
  esac
  EVIDENCE_DIR="$1" bash -c "set -Eeuo pipefail; source '$HERE/lib.sh'; $4; $form_src" >/dev/null 2>&1
}
for form in or if; do
  capture rc_ctx run_step_ctx "$SD" "ctx-$form" "$form" 'body() { echo started >"$EVIDENCE_DIR/ctx-'"$form"'.started"; false; echo continued >>"$EVIDENCE_DIR/ctx.log"; }'
  check "step in '$form' context: body DID start, and nothing runs past a failed command" \
    "[ -e $SD/ctx-$form.started ] && [ ! -e $SD/ctx.log ]"
  check "step in '$form' context: failed body leaves NO done-marker" "[ ! -f $SD/.done-ctx-$form ]"
done
capture rc_ctx_ok run_step_ctx "$SD" ctx-ok-or or 'body() { echo fine >"$EVIDENCE_DIR/ctxok.out"; }'
check "step in '||' context: a fully successful body still works and is marked done" \
  "[ -f $SD/ctxok.out ] && [ -f $SD/.done-ctx-ok-or ]"

# ---------------------------------------------------------------- assert_evidence
AE="$(mktemp)"; printf '{"verdict":"downloaded","fetchedPackages":600}\n' >"$AE"
capture rc_a1 assert_evidence "$AE" '.verdict=="downloaded" and .fetchedPackages==600' "cold run"
check "assert_evidence: matching expression -> exit 0" "[ $rc_a1 = 0 ]"
capture rc_a2 assert_evidence "$AE" '.fetchedPackages==0' "zero download"
check "assert_evidence: non-matching expression -> exit exactly 1 (not 127 = function missing)" "[ $rc_a2 = 1 ]"
ERR="$(assert_evidence "$AE" '.fetchedPackages==0' 'zero download' 2>&1 || true)"
check "assert_evidence: failure message names the assertion and prints the evidence" \
  "grep -q 'zero download' <<<\"\$ERR\" && grep -q 'fetchedPackages' <<<\"\$ERR\""
capture rc_a3 assert_evidence "$SD/does-not-exist.json" '.x==1' "missing file"
check "assert_evidence: missing evidence file -> exit exactly 2 (no evidence != pass)" "[ $rc_a3 = 2 ]"
printf 'not json\n' >"$AE"
capture rc_a4 assert_evidence "$AE" '.x==1' "garbage"
check "assert_evidence: unparseable evidence -> exit exactly 2" "[ $rc_a4 = 2 ]"

# ---------------------------------------------------------------- claim（软断言：记录结论，永不中止运行）
CD="$(mktemp -d)"; CE="$CD/ev.json"; printf '{"verdict":"zero-download","fetchedPackages":0}\n' >"$CE"
capture rc_c1 env EVIDENCE_DIR="$CD" bash -c "source '$HERE/lib.sh'; claim 'warm-install-zero-fetch' '$CE' '.fetchedPackages==0' 2>/dev/null"
capture rc_c2 env EVIDENCE_DIR="$CD" bash -c "source '$HERE/lib.sh'; claim 'warm-install-verdict-downloaded' '$CE' '.verdict==\"downloaded\"' 2>/dev/null"
capture rc_c3 env EVIDENCE_DIR="$CD" bash -c "source '$HERE/lib.sh'; claim 'missing-evidence' '$CD/nope.json' '.x==1' 2>/dev/null"
check "claim: returns 0 for true, false AND missing evidence (never aborts the run)" "[ $rc_c1 = 0 ] && [ $rc_c2 = 0 ] && [ $rc_c3 = 0 ]"
check "claim: 3 claims recorded, one JSON line each" "[ \"\$(jq -s length $CD/claims.jsonl)\" = 3 ]"
check "claim: true  -> pass:true"  "jq -se '.[] | select(.name==\"warm-install-zero-fetch\") | .pass==true' $CD/claims.jsonl >/dev/null"
check "claim: false -> pass:false (not null)" "jq -se '.[] | select(.name==\"warm-install-verdict-downloaded\") | .pass==false' $CD/claims.jsonl >/dev/null"
check "claim: missing evidence -> pass:null (unverifiable, distinct from false)" \
  "jq -se '.[] | select(.name==\"missing-evidence\") | .pass==null' $CD/claims.jsonl >/dev/null"
check "claim: records the expression and the evidence file" \
  "jq -se '.[] | select(.name==\"warm-install-zero-fetch\") | .expr==\".fetchedPackages==0\" and (.evidence|endswith(\"ev.json\"))' $CD/claims.jsonl >/dev/null"

# ---------------------------------------------------------------- step 体可调用 lib 的任意函数（含后加的）
XE="$(mktemp -d)"; printf '{"fetchedPackages":0}\n' >"$XE/ev.json"
capture rc_x run_step_case "$XE" usehelpers \
  'body() { claim from-step "$EVIDENCE_DIR/ev.json" ".fetchedPackages==0"; assert_evidence "$EVIDENCE_DIR/ev.json" ".fetchedPackages==0" inline; echo reached >"$EVIDENCE_DIR/reached"; }'
check "step body can call claim() and assert_evidence() (every lib function is visible in the child)" \
  "[ $rc_x = 0 ] && [ -e $XE/reached ] && jq -se '.[0].name==\"from-step\" and .[0].pass==true' $XE/claims.jsonl >/dev/null"

echo "---- lib selftest exit=$fail ----"
exit "$fail"
