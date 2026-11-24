#!/usr/bin/env bash
# 实验（#54）阶段 B：候选方案（pnpm store + 元数据走引擎原生 cache mount）。可恢复：每步 step() 落标记。
#
# 对照（与阶段 A 同源同 lockfile，只差 deps 层 store 复用）：
#   B0  冷门禁：cache mount 必须为空（否则 B1 不是冷启动）——断言在 B1 步骤内，重试也生效
#   B1  首次冷启动（空 store）：全量下载并填充 store
#   B2  同输入重建：层缓存命中
#   B3  新增 workspace 包 → 重建 deps 层：期望 store 全命中，零下载
#   B4  新增包 + 一个全新外部依赖（left-pad@1.3.0）：期望只下载该依赖
#   B5  离线证明：RUN --network=none + pnpm --offline（含 lifecycle 脚本，如 Prisma 引擎）
#   B6  确定性：热 store 构建 vs 基线冷构建的 node_modules 内容树哈希
#   B7  并发：两个构建同时用同一 store（sharing=locked），按 pnpm 自报区间判串行
# 用法：EVIDENCE_DIR=... ./devenv/exp/run-candidate.sh
# 判断都用 claim()（软断言）记录：不成立本身就是发现，不能让它中止后续对照。

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
EVIDENCE_DIR="${EVIDENCE_DIR:-$HOME/ne-deps-evidence/candidate}"
mkdir -p "$EVIDENCE_DIR"
export EVIDENCE_DIR
exp_names                       # 隔离的镜像标签 / compose 项目名 / lockgen 标签
cd "$REPO_ROOT"

export IMG="ne-exp54/deps"      # 实验专属镜像仓库名（绝不碰 natural-enforcement/*）；export：step 体在子进程里运行
export BASE_TREE_COLD="${BASE_TREE_COLD:-$HOME/ne-deps-evidence/baseline/tree-baseline-cold.json}"
export BASE_TREE_ADD1="${BASE_TREE_ADD1:-$HOME/ne-deps-evidence/baseline/tree-baseline-add1.json}"

build_deps() { # build_deps <label> <tag> [docker build 额外参数...]：计时 + 取证（deps 阶段，按 stage 选取）
  local label="$1" tag="$2"
  shift 2
  run_logged "$label" "$EVIDENCE_DIR/$label.log" docker_build_deps "$tag" "$@"
  save_evidence "$label" "$EVIDENCE_DIR/$label.log" deps
}

# ---------------------------------------------------------------------------------------------
b1_cold() {
  # 冷门禁放在步骤体内：若上次中途失败、store 已被部分填充，这里会拒绝把它当冷启动。
  cache_state b0-before-cold
  assert_evidence "$EVIDENCE_DIR/cache-b0-before-cold.json" '.s.files==0 and .m.files==0' \
    "cold start requires EMPTY store and metadata caches"
  git_reset
  record_env candidate
  save_state candidate-before
  build_deps b1-cold "$IMG:cold" --no-cache
  extract_raw "$IMG:cold" b1-cold
  cache_state b1-after-cold
  tree_hash "$IMG:cold" b1-cold
  claim "b1-cold-downloaded-everything"   "$EVIDENCE_DIR/b1-cold.evidence.json" '.verdict=="downloaded" and .fetchedPackages>=600'
  claim "b1-cold-store-populated"         "$EVIDENCE_DIR/cache-b1-after-cold.json" '.s.files>0'
}

b2_warm() {
  build_deps b2-warm "$IMG:warm"
  claim "b2-warm-layer-cache-hit" "$EVIDENCE_DIR/b2-warm.evidence.json" '.verdict=="layer-cache-hit" and .installExecuted==false'
}

b3_add_package() {
  git_reset
  # 包名与基线 A3/A4 相同（exp-base-one）：工作区符号链接按包名生成，名字不同会让 tree 哈希的 links 字段必然不同，
  # 比较就不是 like-for-like。用生产路径（不带 --no-refresh）：先构建隔离的 workspace 镜像，再生成。
  run_logged b3-gen "$EVIDENCE_DIR/b3-gen.log" env DEVENV_BUILD_VERBOSE=1 "$REPO_ROOT/devenv/devenv" gen package exp-base-one
  save_state candidate-after-gen1
  lockfile_delta exp-base-one >"$EVIDENCE_DIR/b3-lockfile-delta.json" || true
  claim "b3-lockfile-delta-only-new-importer" "$EVIDENCE_DIR/b3-lockfile-delta.json" '.ok==true'
  cache_state b3-before-rebuild
  build_deps b4-add "$IMG:add1"
  extract_raw "$IMG:add1" b4-add
  cache_state b4-after-rebuild
  claim "b4-add-zero-download"            "$EVIDENCE_DIR/b4-add.evidence.json" '.verdict=="zero-download" and .fetchedPackages==0'
  claim "b4-add-no-lifecycle-scripts-ran" "$EVIDENCE_DIR/b4-add.evidence.json" '.lifecycleScripts==[]'
  claim "b4-store-unchanged"              "$EVIDENCE_DIR/cache-b4-after-rebuild.json" ".s.listingSha256==\"$(jq -r .s.listingSha256 "$EVIDENCE_DIR/cache-b3-before-rebuild.json")\""
}

b4_new_external_dep() {
  git_reset
  run_logged b5-gen "$EVIDENCE_DIR/b5-gen.log" env DEVENV_BUILD_VERBOSE=1 "$REPO_ROOT/devenv/devenv" gen package exp-cand-ext
  # 生成器不支持外部依赖：用 jq 在生成物上追加一个全新依赖，再单独重生成 lockfile
  local pj="$REPO_ROOT/packages/exp-cand-ext/package.json"
  jq --indent 2 '.dependencies = ((.dependencies // {}) + {"left-pad": "1.3.0"})' "$pj" >"$pj.tmp" && mv "$pj.tmp" "$pj"
  regen_lockfile_direct
  build_deps b6-ext "$IMG:ext"
  extract_raw "$IMG:ext" b6-ext
  claim "b6-ext-downloaded-only-left-pad" "$EVIDENCE_DIR/b6-ext.evidence.json" '.verdict=="downloaded" and .fetchedPackages==1 and (.fetchedIds|length==1) and (.fetchedIds[0]|startswith("left-pad@1.3.0"))'
}

b5_offline_proof() {
  git_reset
  local df="$EVIDENCE_DIR/workspace-offline.Dockerfile"
  make_offline_dockerfile "$df"
  # 构建上下文仍是仓库根；用派生 Dockerfile，且对 deps 阶段断网（RUN 级，docker build --network=none 在本引擎不生效）。
  # 离线构建失败本身就是发现（例如 lifecycle 脚本需要联网）：这里不让失败中止步骤，而是记录结论。
  run_logged b7-offline "$EVIDENCE_DIR/b7-offline.log" \
    docker build --force-rm --no-cache --target deps -t "$IMG:offline" -f "$df" "$REPO_ROOT" || true
  save_evidence b7-offline "$EVIDENCE_DIR/b7-offline.log" offline
  result_json b7-offline "$EVIDENCE_DIR/b7-offline.result.json" || true   # 缺记录 → 无文件 → claim 判 null
  claim "b7-offline-build-succeeded"      "$EVIDENCE_DIR/b7-offline.result.json" '.exitCode==0'
  claim "b7-offline-install-zero-fetch-no-scripts" "$EVIDENCE_DIR/b7-offline.evidence.json" '.verdict=="zero-download"'
}

b6_determinism() {
  # 两组 like-for-like 比较（各自对照“干净下载”的基线，且工作区内容一致，所以 links 字段也可比）：
  #  ① 候选冷构建（空 store、带 cache mount） vs 基线冷构建      → cache mount 机制本身不改变产物
  #  ② 候选 add1（热 store 命中）            vs 基线 add1（干净下载）→ 热 store 不改变产物
  # 两侧缺失/失败 → compare_trees 退出 2 → determinism-*.json 为空 → claim 记 null（绝不是“相同”）。
  tree_hash "$IMG:add1" b6-candidate-add1
  compare_trees "$BASE_TREE_COLD" "$EVIDENCE_DIR/tree-b1-cold.json"        "$EVIDENCE_DIR/determinism-cold.json" || true
  compare_trees "$BASE_TREE_ADD1" "$EVIDENCE_DIR/tree-b6-candidate-add1.json" "$EVIDENCE_DIR/determinism-add1.json" || true
  claim "b6-cold-with-cache-mount-tree-identical-to-baseline-cold" "$EVIDENCE_DIR/determinism-cold.json" '.identical==true'
  claim "b6-warm-store-tree-identical-to-baseline-clean-download"  "$EVIDENCE_DIR/determinism-add1.json" '.identical==true'
}

b7_concurrency() {
  git_reset
  local t0 t1 rc_a=0 rc_b=0
  t0="$(now_ms)"
  # 两个构建同时使用同一个 store；--no-cache 迫使两者都真正执行 install（命中层缓存就没有并发可言）
  ( docker_build_deps "$IMG:conc-a" --no-cache >"$EVIDENCE_DIR/b8-conc-a.log" 2>&1 ) & local pa=$!
  ( docker_build_deps "$IMG:conc-b" --no-cache >"$EVIDENCE_DIR/b8-conc-b.log" 2>&1 ) & local pb=$!
  wait "$pa" || rc_a=$?
  wait "$pb" || rc_b=$?
  t1="$(now_ms)"
  record b8-conc-a "$t0" "$t1" "$rc_a" ',"parallel":true'
  record b8-conc-b "$t0" "$t1" "$rc_b" ',"parallel":true'
  save_evidence b8-conc-a "$EVIDENCE_DIR/b8-conc-a.log" deps
  save_evidence b8-conc-b "$EVIDENCE_DIR/b8-conc-b.log" deps
  # 汇总与“是否串行”的判定都在 lib 里（concurrency_report，有自检）：缺区间 → verdict 文件为空 → claim 记 null。
  concurrency_report "$EVIDENCE_DIR/b8-conc-a.evidence.json" "$EVIDENCE_DIR/b8-conc-b.evidence.json" "$rc_a" "$rc_b" \
    "$EVIDENCE_DIR/concurrency.raw.json" "$EVIDENCE_DIR/concurrency.json" || true
  claim "b8-concurrent-builds-both-succeeded" "$EVIDENCE_DIR/concurrency.raw.json" '.exitCodes==[0,0]'
  claim "b8-concurrent-builds-zero-download"  "$EVIDENCE_DIR/concurrency.raw.json" '.bothZeroDownload==true'
  claim "b8-concurrent-builds-serialized"     "$EVIDENCE_DIR/concurrency.json" '.serialized==true'
}

# ---------------------------------------------------------------------------------------------

step b1-cold              b1_cold
step b2-warm              b2_warm
step b3-add-package       b3_add_package
step b4-new-external-dep  b4_new_external_dep
step b5-offline-proof     b5_offline_proof
step b6-determinism       b6_determinism
step b7-concurrency       b7_concurrency

git_reset
echo "[exp] candidate phase complete; evidence in $EVIDENCE_DIR" >&2
if [[ -s "$EVIDENCE_DIR/claims.jsonl" ]]; then
  jq -s '{claims: length, true: (map(select(.pass==true))|length), false: (map(select(.pass==false))|length), unverifiable: (map(select(.pass==null))|length)}' \
    "$EVIDENCE_DIR/claims.jsonl" >&2
else
  echo "[exp] no claims recorded (every step was already done and skipped)" >&2
fi
