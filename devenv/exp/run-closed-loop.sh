#!/usr/bin/env bash
# 实验（#54）阶段 C：新增包闭环 5 次测量（候选方案）。
#
# SPEC §测量通用协议：同一机器、同一 worktree 连测 5 次取中位数并记录最差；每次记录平台/缓存状态/实际网络；
# 新增包测量“每次从同一源码基线 + 约定缓存状态出发，不累积”。
#   起点 = `devenv gen package <名>`；终点 = 质量门 lint → typecheck → test:unit 全部 exit 0
#   （原型尚无 `verify`；SPEC 的 verify = lint + typecheck + test:unit + 生命周期校验，落地后由 #58/#61 统一）。
#   不调用 `devenv build`：真实消费路径里每个质量门命令自己会 ensure_fresh_workspace，首个门承担 deps 层重建。
#
# 约定缓存状态（写进证据）：store 已由 B1 填满 + 元数据缓存已由一次预热 gen 填充；各次闭环前后记录
# cache_state，用“清单哈希不变”证明没有跨次累积。
#
# 用法：EVIDENCE_DIR=... ./devenv/exp/run-closed-loop.sh [次数，默认 5]
#
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
EVIDENCE_DIR="${EVIDENCE_DIR:-$HOME/ne-deps-evidence/closed-loop}"
mkdir -p "$EVIDENCE_DIR"
export EVIDENCE_DIR
exp_names
cd "$REPO_ROOT"

RUNS="${1:-5}"
export DEVENV_BUILD_VERBOSE=1   # 保留构建日志，证据行（EVIDENCE）才可见

timed() { # timed <name> <cmd...>：计时；失败不中止（失败本身是结果，由 loop_total 记为非通过）
  run_logged "$1" "$EVIDENCE_DIR/$1.log" "${@:2}" || true
}

warmup() {
  # 预热 gen（不计入 5 次）：填充元数据缓存，并让隔离的 workspace 镜像存在、层缓存处于约定状态。
  git_reset
  record_env closed-loop
  save_state closed-loop-before
  run_logged w0-warmup-gen "$EVIDENCE_DIR/w0-warmup-gen.log" "$REPO_ROOT/devenv/devenv" gen package exp-warmup
  git_reset
  cache_state w0-agreed
}

loop_once() { # loop_once <i>
  local i="$1" pkg="exp-loop-$i"
  git_reset
  cache_state "loop$i-before"
  timed "loop$i-gen"       "$REPO_ROOT/devenv/devenv" --json gen package "$pkg"
  lockfile_delta "$pkg" >"$EVIDENCE_DIR/loop$i-lockfile-delta.json" || true
  timed "loop$i-lint"      "$REPO_ROOT/devenv/devenv" --json lint
  timed "loop$i-typecheck" "$REPO_ROOT/devenv/devenv" --json typecheck
  timed "loop$i-testunit"  "$REPO_ROOT/devenv/devenv" --json test:unit
  # 总耗时与是否通过：缺门/失败都会被如实标出（loop_total 退出 1/2），不会被当成一次快速成功
  local rc=0
  loop_total "$i" "$EVIDENCE_DIR/loop$i-total.json" || rc=$?
  # 每次闭环里 deps 层的下载证据：取该次构建日志里的 deps 阶段 EVIDENCE（层缓存命中则如实标 layer-cache-hit）
  local log ev
  for log in lint typecheck testunit; do
    save_evidence "loop$i-$log" "$EVIDENCE_DIR/loop$i-$log.log" deps
  done
  cache_state "loop$i-after"
  git -C "$REPO_ROOT" diff --stat >"$EVIDENCE_DIR/loop$i-git-diff-stat.txt" || true
  claim "loop$i-lockfile-only-new-importer" "$EVIDENCE_DIR/loop$i-lockfile-delta.json" '.ok==true'
  claim "loop$i-store-unchanged-by-loop"    "$EVIDENCE_DIR/cache-loop$i-after.json" \
    ".s.listingSha256==\"$(jq -r .s.listingSha256 "$EVIDENCE_DIR/cache-loop$i-before.json")\""
  return 0
}

step closed-loop-warmup warmup
printf '{"experiment":"closed-loop","runs":%s,"baselineCommit":"%s","host":"%s"}\n' \
  "$RUNS" "$(git -C "$REPO_ROOT" rev-parse HEAD)" "$(uname -srm)" >"$EVIDENCE_DIR/closed-loop-meta.json"
for ((i = 1; i <= RUNS; i++)); do
  step "closed-loop-$i" loop_once "$i"
done

git_reset
echo "[exp] closed loop complete; evidence in $EVIDENCE_DIR" >&2
# 通过 / 失败 / 不完整分开统计；中位数只含通过的闭环（loop_summary，有自检）。非零退出表示“不是干净通过”，不是脚本出错。
rc_sum=0
loop_summary "$RUNS" "$EVIDENCE_DIR" "$EVIDENCE_DIR/closed-loop-summary.json" || rc_sum=$?
cat "$EVIDENCE_DIR/closed-loop-summary.json" >&2
echo "[exp] loop_summary exit=$rc_sum (0 = all $RUNS loops complete and passing; 1 = failures/incomplete present; 2 = invalid input)" >&2
