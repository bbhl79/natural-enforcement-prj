#!/usr/bin/env bash
# 实验（#54）阶段 C：新增包闭环 5 次测量（候选方案，阶段 B 的同一候选 Dockerfile）。
# 每次从同一源码基线（git reset --hard HEAD）+ 约定缓存状态（基线 workspace 镜像层 +
# 已填充的 pnpm store cache）出发，不同包名；起点 gen，终点 test:unit exit 0。
# 质量门口径：原型尚无 verify；SPEC 交付定义的质量门 = lint + typecheck + test:unit
# （devenv verify 落地后由 #58/#61 统一）。
# 用法：./devenv/exp/run-closed-loop.sh [次数，默认 5]
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

RUNS="${1:-5}"
cd "$REPO_ROOT"
git_reset

# ---- 基线 workspace 镜像预热（不计入 5 次；保证每次从同一层缓存状态出发） ----
run_logged w0-baseline-workspace "$EVIDENCE_DIR/w0-baseline-workspace.log" \
  env DEVENV_BUILD_VERBOSE=1 "$REPO_ROOT/devenv/devenv" build

run_json() { # run_json <name> <stdout.jsonl> <stderr.log> <cmd...>
  local name="$1" out="$2" err="$3"
  shift 3
  local t0 t1 rc
  t0="$(now_ms)"
  set +e
  "$@" >"$out" 2>"$err"
  rc=$?
  set -e
  t1="$(now_ms)"
  record "$name" "$t0" "$t1" "$rc"
  printf '[exp] %-34s exit=%s duration=%sms\n' "$name" "$rc" "$((t1 - t0))" >&2
  return "$rc"
}

printf '{"experiment":"closed-loop","runs":%s,"storeId":"%s","baselineCommit":"%s","host":"%s"}\n' \
  "$RUNS" "$STORE_ID" "$(git -C "$REPO_ROOT" rev-parse HEAD)" "$(uname -srm)" \
  >"$EVIDENCE_DIR/closed-loop-meta.json"

for ((i = 1; i <= RUNS; i++)); do
  git_reset
  local_t0="$(now_ms)"
  run_json "loop$i-gen" "$EVIDENCE_DIR/loop$i-gen.out.jsonl" "$EVIDENCE_DIR/loop$i-gen.err.log" \
    env DEVENV_BUILD_VERBOSE=1 "$REPO_ROOT/devenv/devenv" --json gen package "exp-loop-$i"
  save_state "loop$i-after-gen"
  run_json "loop$i-build" "$EVIDENCE_DIR/loop$i-build.out.jsonl" "$EVIDENCE_DIR/loop$i-build.err.log" \
    env DEVENV_BUILD_VERBOSE=1 "$REPO_ROOT/devenv/devenv" --json build
  save_evidence "loop$i-build" "$EVIDENCE_DIR/loop$i-build.err.log"
  run_json "loop$i-lint" "$EVIDENCE_DIR/loop$i-lint.out.jsonl" "$EVIDENCE_DIR/loop$i-lint.err.log" \
    env DEVENV_BUILD_VERBOSE=1 "$REPO_ROOT/devenv/devenv" --json lint
  run_json "loop$i-typecheck" "$EVIDENCE_DIR/loop$i-typecheck.out.jsonl" "$EVIDENCE_DIR/loop$i-typecheck.err.log" \
    env DEVENV_BUILD_VERBOSE=1 "$REPO_ROOT/devenv/devenv" --json typecheck
  run_json "loop$i-testunit" "$EVIDENCE_DIR/loop$i-testunit.out.jsonl" "$EVIDENCE_DIR/loop$i-testunit.err.log" \
    env DEVENV_BUILD_VERBOSE=1 "$REPO_ROOT/devenv/devenv" --json test:unit
  local_t1="$(now_ms)"
  record "loop$i-total" "$local_t0" "$local_t1" 0
  # 本轮 lockfile 差异（应只含新 importer；否则按 SPEC 停止审查）
  git -C "$REPO_ROOT" diff -- pnpm-lock.yaml >"$EVIDENCE_DIR/loop$i-lockfile.diff"
  git -C "$REPO_ROOT" diff --stat >"$EVIDENCE_DIR/loop$i-git-diff-stat.txt"
done

git_reset
echo "[exp] closed loop complete; evidence in $EVIDENCE_DIR" >&2