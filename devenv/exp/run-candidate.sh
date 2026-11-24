#!/usr/bin/env bash
# 实验（#54）阶段 B：候选方案（pnpm store 走构建缓存挂载）。
# 对照（与阶段 A 同源、同 lockgen 行为，只差 deps 层 store 复用）：
#   B1 首次冷启动（--no-cache，空 store cache）——全量下载并填充 store
#   B2 同输入重建——层缓存命中
#   B3 新增 workspace 包 → 重建——deps 层失效但 store 命中，期望 fetchedPackages=0
#   B4 新增包带一个全新外部依赖 → 重建——期望只下载该依赖
#   B5 离线证明：--network=none + pnpm --offline（store 完整性的行为证据）
#   B6 并发：两个 --no-cache 构建共享同一 store cache（sharing=locked）
# 用法：./devenv/exp/run-candidate.sh [--skip-cold]
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

SKIP_COLD=0
[[ "${1:-}" == "--skip-cold" ]] && SKIP_COLD=1

cd "$REPO_ROOT"
git_reset
record_env candidate
save_state candidate-before

# ---- B1 首次冷启动（空 store cache） ----
if (( SKIP_COLD )); then
  echo "[exp] B1 skipped (--skip-cold): 假定 store cache 已由先前冷构建填充" >&2
  record b1-candidate-cold-skipped "$(now_ms)" "$(now_ms)" 0 ',"note":"skipped by request"'
else
  run_logged b1-candidate-cold "$EVIDENCE_DIR/b1-candidate-cold.log" \
    docker build --no-cache --target deps -t ne-exp-candidate:cold \
    -f "$REPO_ROOT/devenv/workspace.Dockerfile" "$REPO_ROOT"
  save_evidence b1-candidate-cold "$EVIDENCE_DIR/b1-candidate-cold.log"
  save_state candidate-after-cold
fi

# ---- B2 同输入重建（层缓存命中） ----
run_logged b2-candidate-warm "$EVIDENCE_DIR/b2-candidate-warm.log" \
  docker build --target deps -t ne-exp-candidate:warm \
  -f "$REPO_ROOT/devenv/workspace.Dockerfile" "$REPO_ROOT"
save_evidence b2-candidate-warm "$EVIDENCE_DIR/b2-candidate-warm.log"
grep -c 'Using cache' "$EVIDENCE_DIR/b2-candidate-warm.log" >"$EVIDENCE_DIR/b2-cache-lines.txt" || true

# ---- B3 新增包（本地依赖只含既有 workspace/catalog 依赖）→ 期望零下载 ----
git_reset
run_logged b3-candidate-gen "$EVIDENCE_DIR/b3-candidate-gen.log" \
  env DEVENV_BUILD_VERBOSE=1 "$REPO_ROOT/devenv/devenv" gen --no-refresh package exp-cand-one
save_state candidate-after-gen1

run_logged b4-candidate-add "$EVIDENCE_DIR/b4-candidate-add.log" \
  docker build --target deps -t ne-exp-candidate:add1 \
  -f "$REPO_ROOT/devenv/workspace.Dockerfile" "$REPO_ROOT"
save_evidence b4-candidate-add "$EVIDENCE_DIR/b4-candidate-add.log"

# ---- B4 新增包 + 全新外部依赖（left-pad@1.3.0）→ 只应下载新依赖 ----
git_reset
run_logged b5-candidate-gen-ext "$EVIDENCE_DIR/b5-candidate-gen-ext.log" \
  env DEVENV_BUILD_VERBOSE=1 "$REPO_ROOT/devenv/devenv" gen --no-refresh package exp-cand-ext
# 生成器不支持加外部依赖；用 jq 在生成物上追加一个全新依赖，再单独重生成 lockfile
jq --indent 2 '.dependencies = ((.dependencies // {}) + {"left-pad": "1.3.0"})' \
  "$REPO_ROOT/packages/exp-cand-ext/package.json" >"$REPO_ROOT/packages/exp-cand-ext/package.json.tmp"
mv "$REPO_ROOT/packages/exp-cand-ext/package.json.tmp" "$REPO_ROOT/packages/exp-cand-ext/package.json"
regen_lockfile_direct
save_state candidate-after-gen-ext

run_logged b6-candidate-add-ext "$EVIDENCE_DIR/b6-candidate-add-ext.log" \
  docker build --target deps -t ne-exp-candidate:add-ext \
  -f "$REPO_ROOT/devenv/workspace.Dockerfile" "$REPO_ROOT"
save_evidence b6-candidate-add-ext "$EVIDENCE_DIR/b6-candidate-add-ext.log"

# ---- B5 离线证明（--network=none，pnpm --offline） ----
git_reset
run_logged b7-offline-network-none "$EVIDENCE_DIR/b7-offline-network-none.log" \
  docker build --no-cache --network=none --target deps -t ne-exp-offline:check \
  -f "$REPO_ROOT/devenv/exp/workspace-offline.Dockerfile" "$REPO_ROOT"
save_evidence b7-offline-network-none "$EVIDENCE_DIR/b7-offline-network-none.log"

# ---- B6 并发共享 cache ----
git_reset
t0="$(now_ms)"
set +e
docker build --no-cache --target deps -t ne-exp-conc:a \
  -f "$REPO_ROOT/devenv/workspace.Dockerfile" "$REPO_ROOT" \
  >"$EVIDENCE_DIR/b8-concurrency-a.log" 2>&1 &
pid_a=$!
docker build --no-cache --target deps -t ne-exp-conc:b \
  -f "$REPO_ROOT/devenv/workspace.Dockerfile" "$REPO_ROOT" \
  >"$EVIDENCE_DIR/b8-concurrency-b.log" 2>&1 &
pid_b=$!
wait "$pid_a"; rc_a=$?
wait "$pid_b"; rc_b=$?
set -e
t1="$(now_ms)"
record b8-concurrency-a "$t0" "$t1" "$rc_a" ',"parallel":true'
record b8-concurrency-b "$t0" "$t1" "$rc_b" ',"parallel":true'
save_evidence b8-concurrency-a "$EVIDENCE_DIR/b8-concurrency-a.log"
save_evidence b8-concurrency-b "$EVIDENCE_DIR/b8-concurrency-b.log"

git_reset
echo "[exp] candidate phase complete; evidence in $EVIDENCE_DIR" >&2
for f in b1-candidate-cold b4-candidate-add b6-candidate-add-ext b7-offline-network-none b8-concurrency-a b8-concurrency-b; do
  [[ -f "$EVIDENCE_DIR/$f.evidence.json" ]] && printf '%s: ' "$f" && cat "$EVIDENCE_DIR/$f.evidence.json"
done >&2