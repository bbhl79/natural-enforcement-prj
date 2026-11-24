#!/usr/bin/env bash
# lib.sh 辅助函数自检（regen_lockfile_direct 部分用 alpine 微型构建，需要 docker）。每条断言都有可能失败；含反例。
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

# ---------------------------------------------------------------- result_json（从 results.jsonl 取某一步的记录）
RD="$(mktemp -d)"
printf '%s\n' \
  '{"name":"b7-offline","startMs":1,"endMs":2,"durationMs":100,"exitCode":1}' \
  '{"name":"b7-offline-extra","startMs":1,"endMs":2,"durationMs":5,"exitCode":9}' \
  '{"name":"b7-offline","startMs":3,"endMs":4,"durationMs":200,"exitCode":0}' >"$RD/results.jsonl"
capture rc_rj1 env EVIDENCE_DIR="$RD" bash -c "source '$HERE/lib.sh'; result_json b7-offline '$RD/out.json'"
check "result_json: found -> exit 0 and the LAST record for that exact name (rerun wins, no prefix match)" \
  "[ $rc_rj1 = 0 ] && jq -e '.durationMs==200 and .exitCode==0' $RD/out.json >/dev/null"
capture rc_rj2 env EVIDENCE_DIR="$RD" bash -c "source '$HERE/lib.sh'; result_json nope '$RD/none.json'"
check "result_json: absent -> exit 1 and NO file written (so claim() reads it as unverifiable, not false)" \
  "[ $rc_rj2 = 1 ] && [ ! -e $RD/none.json ]"
capture rc_rj3 env EVIDENCE_DIR="$RD/no-such-dir" bash -c "source '$HERE/lib.sh'; result_json b7-offline '$RD/none2.json'"
check "result_json: missing results.jsonl -> exit 1 and no file" "[ $rc_rj3 = 1 ] && [ ! -e $RD/none2.json ]"

# ---------------------------------------------------------------- regen_lockfile_direct：失败不得伪装成功（用 alpine 微型构建，需 docker）
RG="$(mktemp -d)"
mk_regen_repo() { # mk_regen_repo <dir> <lockgen 靶里的 RUN 命令>：旧 lockfile + 最小 Dockerfile
  mkdir -p "$1/devenv"
  printf 'OLD-LOCKFILE\n' >"$1/pnpm-lock.yaml"
  printf 'FROM alpine:3.21 AS lockgen\nWORKDIR /workspace\nRUN %s\n' "$2" >"$1/devenv/workspace.Dockerfile"
}
run_regen() { # run_regen <repo-dir> <tag> -> 子进程退出码（REPO_ROOT 必须在 source 之后覆盖）
  mkdir -p "$1/ev"
  EVIDENCE_DIR="$1/ev" DEVENV_LOCKGEN_TAG="$2" bash -c "source '$HERE/lib.sh'; REPO_ROOT='$1'; regen_lockfile_direct" >/dev/null 2>&1
}
mk_regen_repo "$RG/fail" 'false'
capture rc_rg1 run_regen "$RG/fail" ne-exp54-selftest-lockgen:fail
check "regen: failing lockgen build -> exit exactly 11" "[ $rc_rg1 = 11 ]"
check "regen: failing lockgen build leaves the OLD lockfile untouched" "[ \"\$(cat $RG/fail/pnpm-lock.yaml)\" = OLD-LOCKFILE ]"

mk_regen_repo "$RG/nolock" 'true'
capture rc_rg2 run_regen "$RG/nolock" ne-exp54-selftest-lockgen:nolock
check "regen: build ok but no lockfile produced (docker cp fails) -> exit exactly 14" "[ $rc_rg2 = 14 ]"
check "regen: cp failure leaves the OLD lockfile untouched" "[ \"\$(cat $RG/nolock/pnpm-lock.yaml)\" = OLD-LOCKFILE ]"

mk_regen_repo "$RG/ok" 'echo NEW-LOCKFILE > /workspace/pnpm-lock.yaml'
capture rc_rg3 run_regen "$RG/ok" ne-exp54-selftest-lockgen:ok
check "regen: successful lockgen -> exit 0 and the lockfile is replaced" \
  "[ $rc_rg3 = 0 ] && [ \"\$(cat $RG/ok/pnpm-lock.yaml)\" = NEW-LOCKFILE ]"
check "regen: success removes its temporary lockgen image" "! docker image inspect ne-exp54-selftest-lockgen:ok >/dev/null 2>&1"
check "regen: a record with the real exit code is appended to results.jsonl" \
  "jq -se 'map(select(.name==\"lockgen-direct\")) | last | .exitCode==0' $RG/ok/ev/results.jsonl >/dev/null"

mk_regen_repo "$RG/shared" 'echo SHOULD-NOT-RUN > /workspace/pnpm-lock.yaml'
capture rc_rg4 run_regen "$RG/shared" ne-lockgen:tmp
check "regen: refuses the shared tag ne-lockgen:tmp (exit 2) and does not touch the lockfile" \
  "[ $rc_rg4 = 2 ] && [ \"\$(cat $RG/shared/pnpm-lock.yaml)\" = OLD-LOCKFILE ]"

# ---- 引擎事实（实测）：失败的构建会泄漏 buildah working container；它钉住共享祖先层，使对兄弟镜像的 `docker rmi`
# 退出码为 1（"in use"）——但标签其实已被删除。所以判据必须是“标签是否还在”，不能是 rmi 的退出码。
# 复现：先用失败构建泄漏容器，再让 regen 的临时镜像与它共享前缀。
PIN="$(mktemp -d)"; NONCE="selftest-pin-$RANDOM$RANDOM"
printf 'FROM alpine:3.21 AS lockgen\nLABEL nonce=%s\nWORKDIR /workspace\nRUN false\n' "$NONCE" >"$PIN/Dockerfile.leak"
docker build -f "$PIN/Dockerfile.leak" -t ne-exp54-selftest-leak:x "$PIN" >/dev/null 2>&1 || true   # 故意失败 → 泄漏
mkdir -p "$PIN/repo/devenv" && printf 'OLD-LOCKFILE\n' >"$PIN/repo/pnpm-lock.yaml"
printf 'FROM alpine:3.21 AS lockgen\nLABEL nonce=%s\nWORKDIR /workspace\nRUN echo NEW-LOCKFILE > /workspace/pnpm-lock.yaml\n' "$NONCE" >"$PIN/repo/devenv/workspace.Dockerfile"
capture rc_pin run_regen "$PIN/repo" ne-exp54-selftest-lockgen:pinned
check "regen: succeeds (exit 0) even when a leaked build container pins the image's ancestor layers" "[ $rc_pin = 0 ]"
check "regen: lockfile replaced in the pinned-ancestor case" "[ \"\$(cat $PIN/repo/pnpm-lock.yaml)\" = NEW-LOCKFILE ]"
check "regen: temporary image tag is gone in the pinned-ancestor case" "! docker image inspect ne-exp54-selftest-lockgen:pinned >/dev/null 2>&1"

# ---------------------------------------------------------------- compare_trees（null==null 陷阱：两侧都没有哈希不得算“相同”）
CT="$(mktemp -d)"
H1="$(printf 'a%.0s' $(seq 1 64))"; H2="$(printf 'b%.0s' $(seq 1 64))"; H3="$(printf 'c%.0s' $(seq 1 64))"
mk_tree() { # mk_tree <file> <files> <content> <modes> <links>
  jq -nc --argjson f "$2" --arg c "$3" --arg m "$4" --arg l "$5" '{label:"t",image:"i",files:$f,content:$c,modes:$m,links:$l}' >"$1"
}
mk_tree "$CT/base.json" 52116 "$H1" "$H2" "$H3"
mk_tree "$CT/same.json" 52116 "$H1" "$H2" "$H3"
mk_tree "$CT/dcontent.json" 52116 "$H2" "$H2" "$H3"
mk_tree "$CT/dlinks.json" 52116 "$H1" "$H2" "$H1"
mk_tree "$CT/dfiles.json" 52117 "$H1" "$H2" "$H3"
printf '{"label":"t","image":"i","error":"tree hash failed"}\n' >"$CT/err.json"
printf 'not json\n' >"$CT/garbage.json"

capture rc_t1 compare_trees "$CT/base.json" "$CT/same.json" "$CT/o1.json"
check "compare_trees: identical -> exit 0, identical:true, differs:[]" \
  "[ $rc_t1 = 0 ] && jq -e '.identical==true and .differs==[]' $CT/o1.json >/dev/null"
capture rc_t2 compare_trees "$CT/base.json" "$CT/dcontent.json" "$CT/o2.json"
check "compare_trees: content differs -> exit 1, differs==[content]" \
  "[ $rc_t2 = 1 ] && jq -e '.identical==false and .differs==[\"content\"]' $CT/o2.json >/dev/null"
capture rc_t3 compare_trees "$CT/base.json" "$CT/dlinks.json" "$CT/o3.json"
check "compare_trees: only links differ -> differs==[links]" "[ $rc_t3 = 1 ] && jq -e '.differs==[\"links\"]' $CT/o3.json >/dev/null"
capture rc_t4 compare_trees "$CT/base.json" "$CT/dfiles.json" "$CT/o4.json"
check "compare_trees: file count differs -> differs==[files]" "[ $rc_t4 = 1 ] && jq -e '.differs==[\"files\"]' $CT/o4.json >/dev/null"

capture rc_t5 compare_trees "$CT/err.json" "$CT/err.json" "$CT/o5.json"
check "compare_trees: BOTH sides failed (null==null) -> exit 2, NOT identical" "[ $rc_t5 = 2 ]"
check "compare_trees: ...and writes no evidence (empty file => claim() reads it as unverifiable)" "[ ! -s $CT/o5.json ]"
capture rc_t6 compare_trees "$CT/base.json" "$CT/err.json" "$CT/o6.json"
check "compare_trees: one side failed -> exit 2" "[ $rc_t6 = 2 ] && [ ! -s $CT/o6.json ]"
capture rc_t7 compare_trees "$CT/base.json" "$CT/garbage.json" "$CT/o7.json"
check "compare_trees: unparseable input -> exit 2" "[ $rc_t7 = 2 ]"
capture rc_t8 compare_trees "$CT/base.json" "$CT/nope.json" "$CT/o8.json"
check "compare_trees: missing input -> exit 2" "[ $rc_t8 = 2 ]"
# 陈旧证据：先产生一份有效输出，再用失败输入重跑同一输出路径 → 旧内容必须被清空
capture rc_t9a compare_trees "$CT/base.json" "$CT/same.json" "$CT/o9.json"
capture rc_t9b compare_trees "$CT/err.json" "$CT/err.json" "$CT/o9.json"
check "compare_trees: a failed rerun truncates the stale evidence from the earlier valid run" \
  "[ $rc_t9a = 0 ] && [ $rc_t9b = 2 ] && [ ! -s $CT/o9.json ]"
# 与 claim 的衔接：空文件 → null（不是 false，更不是 true）
capture rc_t10 env EVIDENCE_DIR="$CT" bash -c "source '$HERE/lib.sh'; claim tree-identical '$CT/o5.json' '.identical==true' 2>/dev/null"
check "compare_trees + claim: failed comparison is recorded as pass:null" \
  "[ $rc_t10 = 0 ] && jq -se '.[0].name==\"tree-identical\" and .[0].pass==null' $CT/claims.jsonl >/dev/null"

# ---------------------------------------------------------------- concurrency_report（pnpm 自报区间 → 是否串行）
CR="$(mktemp -d)"
mk_ev() { # mk_ev <file> <verdict> <startedAt|null> <endedAt|null>
  jq -nc --arg v "$2" --argjson s "$3" --argjson e "$4" '{stage:"deps",verdict:$v,startedAt:$s,endedAt:$e}' >"$1"
}
run_cr() { # run_cr <tag> <a-ev> <b-ev> <rcA> <rcB> -> 退出码；输出到 $CR/<tag>.raw.json / $CR/<tag>.json
  concurrency_report "$2" "$3" "$4" "$5" "$CR/$1.raw.json" "$CR/$1.json"
}
mk_ev "$CR/a1.json" zero-download 100 200; mk_ev "$CR/b1.json" zero-download 250 400
capture rc_c1 run_cr gap "$CR/a1.json" "$CR/b1.json" 0 0
check "concurrency: disjoint (A 100-200, B 250-400): overlap -50 -> serialized:true" \
  "[ $rc_c1 = 0 ] && jq -e '.overlapMs==-50 and .serialized==true and .exitCodes==[0,0] and .bothZeroDownload==true' $CR/gap.json >/dev/null"
mk_ev "$CR/a2.json" zero-download 100 300; mk_ev "$CR/b2.json" zero-download 200 400
capture rc_c2 run_cr overlap "$CR/a2.json" "$CR/b2.json" 0 0
check "concurrency: overlapping (A 100-300, B 200-400): overlap 100 -> serialized:false" \
  "jq -e '.overlapMs==100 and .serialized==false' $CR/overlap.json >/dev/null"
mk_ev "$CR/a3.json" zero-download 100 200; mk_ev "$CR/b3.json" zero-download 200 300
capture rc_c3 run_cr touch "$CR/a3.json" "$CR/b3.json" 0 0
check "concurrency: touching intervals (A ends 200, B starts 200): overlap 0 -> serialized:true" \
  "jq -e '.overlapMs==0 and .serialized==true' $CR/touch.json >/dev/null"
mk_ev "$CR/a4.json" zero-download 100 200; mk_ev "$CR/b4.json" zero-download 50 400
capture rc_c4 run_cr nested "$CR/a4.json" "$CR/b4.json" 0 0
check "concurrency: nested (A inside B): overlap 100 -> serialized:false" "jq -e '.overlapMs==100 and .serialized==false' $CR/nested.json >/dev/null"

# 缺区间（层缓存命中 / 失败 → 证据里没有 startedAt）：不得报成“未串行(false)”——输出空文件，使 claim 判 null
printf '{"stage":"deps","verdict":"layer-cache-hit","installExecuted":false}\n' >"$CR/a5.json"
capture rc_c5 run_cr nointerval "$CR/a5.json" "$CR/b1.json" 0 0
check "concurrency: one side has no interval -> overlapMs:null in the raw file" "jq -e '.overlapMs==null' $CR/nointerval.raw.json >/dev/null"
check "concurrency: ...and the verdict file is EMPTY (serialized is unverifiable, not false)" "[ ! -s $CR/nointerval.json ]"
mk_ev "$CR/a6.json" zero-download 100 null
capture rc_c6 run_cr noend "$CR/a6.json" "$CR/b1.json" 0 0
check "concurrency: a null endedAt also yields no verdict (never treats null as 0)" "[ ! -s $CR/noend.json ]"

# 其余字段：退出码照录；bothZeroDownload 仅当两侧都是 zero-download
capture rc_c7 run_cr rcs "$CR/a1.json" "$CR/b1.json" 0 1
check "concurrency: exit codes are recorded verbatim ([0,1])" "jq -e '.exitCodes==[0,1]' $CR/rcs.json >/dev/null"
mk_ev "$CR/b8.json" downloaded 250 400
capture rc_c8 run_cr notboth "$CR/a1.json" "$CR/b8.json" 0 0
check "concurrency: bothZeroDownload is false when one side downloaded" "jq -e '.bothZeroDownload==false and .verdicts==[\"zero-download\",\"downloaded\"]' $CR/notboth.json >/dev/null"
# 证据文件缺失 → 退出 2 且不写 verdict 文件（旧的有效结果也要被清掉）
capture rc_c9a run_cr stale "$CR/a1.json" "$CR/b1.json" 0 0
capture rc_c9b run_cr stale "$CR/a1.json" "$CR/missing.json" 0 0
check "concurrency: missing evidence file -> exit 2 and stale verdict from an earlier run is truncated" \
  "[ $rc_c9a = 0 ] && [ $rc_c9b = 2 ] && [ ! -s $CR/stale.json ] && [ ! -s $CR/stale.raw.json ]"

# ---------------------------------------------------------------- loop_total（闭环总耗时：从 gen 起点到最后一个门终点）
LT="$(mktemp -d)"
printf '%s\n' \
  '{"name":"loop1-gen","startMs":1000,"endMs":1400,"durationMs":400,"exitCode":0}' \
  '{"name":"loop1-lint","startMs":1500,"endMs":2000,"durationMs":500,"exitCode":0}' \
  '{"name":"loop1-typecheck","startMs":2000,"endMs":2600,"durationMs":600,"exitCode":0}' \
  '{"name":"loop1-testunit","startMs":2700,"endMs":3500,"durationMs":800,"exitCode":0}' >"$LT/results.jsonl"
capture rc_lt1 env EVIDENCE_DIR="$LT" bash -c "source '$HERE/lib.sh'; loop_total 1 '$LT/loop1-total.json'"
check "loop_total: wall = last gate end - gen start (3500-1000=2500), NOT the sum of step durations (2300)" \
  "[ $rc_lt1 = 0 ] && jq -e '.durationMs==2500 and .exitCode==0 and .startMs==1000 and .endMs==3500' $LT/loop1-total.json >/dev/null"
printf '%s\n' \
  '{"name":"loop2-gen","startMs":10,"endMs":20,"durationMs":10,"exitCode":0}' \
  '{"name":"loop2-lint","startMs":20,"endMs":90,"durationMs":70,"exitCode":1}' >"$LT/results.jsonl"
capture rc_lt2 env EVIDENCE_DIR="$LT" bash -c "source '$HERE/lib.sh'; loop_total 2 '$LT/loop2-total.json'"
check "loop_total: a failed gate makes the loop non-passing (exitCode=1) even though it ran" \
  "[ $rc_lt2 = 1 ] && jq -e '.exitCode==1 and .durationMs==80' $LT/loop2-total.json >/dev/null"
printf '%s\n' '{"name":"loop3-gen","startMs":10,"endMs":20,"durationMs":10,"exitCode":0}' >"$LT/results.jsonl"
capture rc_lt3 env EVIDENCE_DIR="$LT" bash -c "source '$HERE/lib.sh'; loop_total 3 '$LT/loop3-total.json'"
check "loop_total: gen done but gates missing (incomplete loop) -> exit 2 and NO total file (not a short 'success')" \
  "[ $rc_lt3 = 2 ] && [ ! -s $LT/loop3-total.json ]"
capture rc_lt4 env EVIDENCE_DIR="$LT" bash -c "source '$HERE/lib.sh'; loop_total 9 '$LT/loop9-total.json'"
check "loop_total: unknown loop -> exit 2 and no file" "[ $rc_lt4 = 2 ] && [ ! -s $LT/loop9-total.json ]"

# ---------------------------------------------------------------- loop_summary（只统计通过的闭环；失败/不完整如实计数）
LS="$(mktemp -d)"
# 5 次闭环：耗时 300/100/500/200/400，其中第 3 次（500）门失败、第 5 次只跑了 gen（不完整）
for spec in "1 300 0" "2 100 0" "3 500 1" "4 200 0"; do
  set -- $spec
  jq -nc --arg n "$1" --argjson d "$2" --argjson e "$3" '{name:"loop\($n)-total",startMs:0,endMs:$d,durationMs:$d,exitCode:$e}' >"$LS/loop$1-total.json"
done
: >"$LS/loop5-total.json"
capture rc_ls1 loop_summary 5 "$LS" "$LS/summary.json"
check "loop_summary: passing loops only -> median over {300,100,200}=200, worst=300 (failed 500 excluded from both)" \
  "jq -e '.passed.n==3 and .passed.median==200 and .passed.worst==300 and .passed.all==[100,200,300]' $LS/summary.json >/dev/null"
check "loop_summary: failed loop counted separately, with its own duration kept for the record" \
  "jq -e '.failed.n==1 and .failed.durationsMs==[500]' $LS/summary.json >/dev/null"
check "loop_summary: incomplete loop (no total) counted as incomplete, never as a passing zero" \
  "jq -e '.incomplete.n==1 and .incomplete.loops==[5] and .runs==5' $LS/summary.json >/dev/null"
check "loop_summary: NOT a clean pass overall -> exit 1 (SPEC: unreliable/failed evidence is not acceptance)" "[ $rc_ls1 = 1 ]"
check "loop_summary: reports the worst over ALL completed loops too (500), since the SPEC asks for 'the worst'" \
  "jq -e '.allCompleted.worst==500 and .allCompleted.n==4' $LS/summary.json >/dev/null"

LS2="$(mktemp -d)"
for spec in "1 90" "2 110" "3 100"; do set -- $spec; jq -nc --arg n "$1" --argjson d "$2" '{name:"loop\($n)-total",startMs:0,endMs:$d,durationMs:$d,exitCode:0}' >"$LS2/loop$1-total.json"; done
capture rc_ls2 loop_summary 3 "$LS2" "$LS2/summary.json"
check "loop_summary: all loops pass -> exit 0, median=100 worst=110" \
  "[ $rc_ls2 = 0 ] && jq -e '.passed.n==3 and .passed.median==100 and .passed.worst==110 and .failed.n==0 and .incomplete.n==0' $LS2/summary.json >/dev/null"
LS3="$(mktemp -d)"; : >"$LS3/loop1-total.json"
capture rc_ls3 loop_summary 1 "$LS3" "$LS3/summary.json"
check "loop_summary: nothing passed -> median is null (not 0), exit 1" \
  "[ $rc_ls3 = 1 ] && jq -e '.passed.n==0 and .passed.median==null and .passed.worst==null' $LS3/summary.json >/dev/null"

# ---------------------------------------------------------------- lint-local.awk（防止“同条 local 引用前变量”复发）
LC="$(mktemp -d)"
printf '%s\n' 'f() {' '  local i="$1" pkg="x-$i"' '}' >"$LC/bad.sh"
printf '%s\n' 'f() {' '  local i="$1"' '  local pkg="x-$i"' '}' >"$LC/ok.sh"
capture rc_lint_bad  awk -f "$HERE/lint-local.awk" "$LC/bad.sh" >/dev/null 2>&1
capture rc_lint_ok   awk -f "$HERE/lint-local.awk" "$LC/ok.sh"  >/dev/null 2>&1
check "lint-local: catches same-statement forward reference (exit 1)" "[ $rc_lint_bad = 1 ]"
check "lint-local: split statements are clean (exit 0)" "[ $rc_lint_ok = 0 ]"
check "lint-local: the whole experiment codebase is clean" \
  "awk -f '$HERE/lint-local.awk' '$HERE'/*.sh '$HERE/../devenv' 2>/dev/null"

echo "---- lib selftest exit=$fail ----"
exit "$fail"
