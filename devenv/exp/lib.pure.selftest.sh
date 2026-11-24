#!/usr/bin/env bash
# 仅含纯文件逻辑的自检片段（不碰容器引擎），用于在测量进行中安全地跑：不会和计时中的构建抢资源。
set -Eeuo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export EVIDENCE_DIR="${EVIDENCE_DIR:-$(mktemp -d)}"
# shellcheck source=lib.sh
source "$HERE/lib.sh"
fail=0
check() { if eval "$2"; then echo "PASS  $1"; else echo "FAIL  $1"; fail=1; fi; }
capture() { local __n="$1" __rc=0; shift; "$@" || __rc=$?; printf -v "$__n" '%s' "$__rc"; }
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

echo "---- pure-file selftest exit=$fail ----"; exit "$fail"
