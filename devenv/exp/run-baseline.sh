#!/usr/bin/env bash
# 实验（#54）阶段 A：基线归因（原型无 store 复用）。
# 对照：
#   A1 首次冷启动（--no-cache，deps 靶）——全量网络下载
#   A2 同输入重建（无 --no-cache）——层缓存命中，install 不执行
#   A3 新增 workspace 包（gen + lockgen）——Dockerfile/lockfile 变化
#   A4 新增包后重建——deps 层失效，观察是否全量重下
#   A5/A6 第二个包重复一次，确认可复现
# 用法：./devenv/exp/run-baseline.sh
# 证据：$EVIDENCE_DIR（默认 $HOME/ne-deps-evidence）
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

cd "$REPO_ROOT"
git_reset
record_env baseline
save_state baseline-before

# ---- A1 首次冷启动 ----
run_logged a1-baseline-cold "$EVIDENCE_DIR/a1-baseline-cold.log" \
  docker build --no-cache --target deps -t ne-exp-baseline:cold \
  -f "$REPO_ROOT/devenv/workspace.Dockerfile" "$REPO_ROOT"
save_evidence a1-baseline-cold "$EVIDENCE_DIR/a1-baseline-cold.log"
save_state baseline-after-cold

# ---- A2 同输入重建（层缓存命中） ----
run_logged a2-baseline-warm "$EVIDENCE_DIR/a2-baseline-warm.log" \
  docker build --target deps -t ne-exp-baseline:warm \
  -f "$REPO_ROOT/devenv/workspace.Dockerfile" "$REPO_ROOT"
save_evidence a2-baseline-warm "$EVIDENCE_DIR/a2-baseline-warm.log"
grep -c 'Using cache' "$EVIDENCE_DIR/a2-baseline-warm.log" >"$EVIDENCE_DIR/a2-cache-lines.txt" || true

# ---- A3/A4 新增包 → 重建 ----
git_reset
run_logged a3-baseline-gen "$EVIDENCE_DIR/a3-baseline-gen.log" \
  env DEVENV_BUILD_VERBOSE=1 "$REPO_ROOT/devenv/devenv" gen --no-refresh package exp-base-one
save_state baseline-after-gen1

run_logged a4-baseline-add "$EVIDENCE_DIR/a4-baseline-add.log" \
  docker build --target deps -t ne-exp-baseline:add1 \
  -f "$REPO_ROOT/devenv/workspace.Dockerfile" "$REPO_ROOT"
save_evidence a4-baseline-add "$EVIDENCE_DIR/a4-baseline-add.log"

# ---- A5/A6 第二个包重复（可选：BASELINE_REPEAT=1；慢网下默认跳过以节省一次全量下载） ----
if [[ "${BASELINE_REPEAT:-0}" == "1" ]]; then
  git_reset
  run_logged a5-baseline-gen2 "$EVIDENCE_DIR/a5-baseline-gen2.log" \
    env DEVENV_BUILD_VERBOSE=1 "$REPO_ROOT/devenv/devenv" gen --no-refresh package exp-base-two
  save_state baseline-after-gen2

  run_logged a6-baseline-add2 "$EVIDENCE_DIR/a6-baseline-add2.log" \
    docker build --target deps -t ne-exp-baseline:add2 \
    -f "$REPO_ROOT/devenv/workspace.Dockerfile" "$REPO_ROOT"
  save_evidence a6-baseline-add2 "$EVIDENCE_DIR/a6-baseline-add2.log"
fi

git_reset
echo "[exp] baseline phase complete; evidence in $EVIDENCE_DIR" >&2
cat "$EVIDENCE_DIR"/a1-baseline-cold.evidence.json "$EVIDENCE_DIR"/a4-baseline-add.evidence.json >&2
[[ -f "$EVIDENCE_DIR/a6-baseline-add2.evidence.json" ]] && cat "$EVIDENCE_DIR/a6-baseline-add2.evidence.json" >&2 || true