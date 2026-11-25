# shellcheck shell=bash
# ============================================================================
# devenv 快照库（被 devenv/devenv source，不直接执行）
#
# Spec-工程基座 §3「ensure_fresh_workspace（固定输入快照）」（#58 落地）：
#   - 采集：git 临时索引 add -A + write-tree——内容寻址树哈希即快照标识，覆盖
#     未提交修改、新增、删除，以及 Dockerfile、构建脚本、锁文件等构建输入
#     （gitignored 内容——node_modules、.devenv-state 等——不进入快照）。
#   - 采集后构建只读快照（git 对象库），不再读取活工作树。
#   - 竞态口径：采集期间工作树再变 → 双采集比对，不一致即重试；持续不稳定 →
#     明确拒绝（exit 4），不产生混合内容却报告来源一致。
#   - 状态：.devenv-state/workspace-image.env（gitignored）记录 快照哈希 ↔
#     不可变镜像标识（image ID）；镜像 label 另记快照哈希 + 构建输入清单。
#   - 诚实口径：检查来源一致性、减少运行旧代码，不声称完整构建证明。
# ============================================================================

SNAPSHOT_TMPDIRS=()

snapshot_tree_once() { # 单次采集：打印当前工作树的 git 树哈希（临时索引，不动用户索引）
  local tmp_index tree rc=0
  tmp_index="$(mktemp /tmp/ne-snapshot-index.XXXXXX)"
  rm -f "$tmp_index"  # 不存在的索引文件 = 空索引（0 字节文件会被 git 判为损坏）
  GIT_INDEX_FILE="$tmp_index" git -C "$REPO_ROOT" add -A || rc=$?
  if (( rc == 0 )); then
    tree="$(GIT_INDEX_FILE="$tmp_index" git -C "$REPO_ROOT" write-tree)" || rc=$?
  fi
  rm -f "$tmp_index"
  (( rc == 0 )) || die 4 "快照采集失败（git add -A / write-tree 退出码 $rc）"
  printf '%s\n' "$tree"
}

snapshot_capture() { # 双采集一致才接受；持续变化 → 明确拒绝（die 4）
  local attempt s1 s2
  for attempt in 1 2 3; do
    s1="$(snapshot_tree_once)"
    s2="$(snapshot_tree_once)"
    if [[ "$s1" == "$s2" ]]; then
      if (( attempt > 1 )); then
        note "快照采集第 $attempt 次尝试后稳定（$s1）"
      fi
      printf '%s\n' "$s1"
      return 0
    fi
    warn "快照采集期间工作树发生变化（第 $attempt 次双采集不一致），重试…"
  done
  die 4 "工作树在快照采集期间持续变化（3 次双采集均不一致）——明确拒绝，不产生混合内容却报告来源一致。请暂停文件修改后重试。"
}

snapshot_materialize() { # <tree> <destdir>：把快照展开为构建上下文目录
  local tree="$1" dest="$2"
  git -C "$REPO_ROOT" archive "$tree" | tar -x -C "$dest"
  # mtime 归一到固定纪元：跨构建缓存稳定（无论引擎 COPY 缓存键是否含 mtime），且产物可复现
  find "$dest" \( -type f -o -type d \) -exec touch -t 197001010000 {} +
}

snapshot_materialize_new() { # <tree> → 结果在 SNAPSHOT_MATERIALIZED_DIR（登记 EXIT 清理）
  # 不用 stdout 返回：调用方经 $(...) 接收会让数组登记丢进子 shell（EXIT 清理失效）
  SNAPSHOT_MATERIALIZED_DIR="$(mktemp -d /tmp/ne-snapshot.XXXXXX)"
  SNAPSHOT_TMPDIRS+=("$SNAPSHOT_MATERIALIZED_DIR")
  snapshot_materialize "$1" "$SNAPSHOT_MATERIALIZED_DIR"
}

snapshot_discard() { rm -rf "$1"; }

snapshot_cleanup() {
  local d
  for d in ${SNAPSHOT_TMPDIRS[@]+"${SNAPSHOT_TMPDIRS[@]}"}; do
    rm -rf "$d"
  done
  SNAPSHOT_TMPDIRS=()
}

snapshot_inputs_manifest() { # <tree> → "path=blobsha;..."（关键构建输入清单，镜像 label 用）
  # package.json 按路径模式动态覆盖（新增 workspace 包免同步清单）；
  # 与 workspace.Dockerfile 的 manifest COPY 清单是不同用途（审计记录，不参与新鲜度比对）
  git -C "$REPO_ROOT" ls-tree -r "$1" | awk -F'\t' '
    { split($1, a, " "); path=$2; sha=a[3] }
    path ~ /^devenv\// || path == "pnpm-lock.yaml" || path == "pnpm-workspace.yaml" || path ~ /(^|\/)package\.json$/ {
      printf "%s=%s;", path, sha
    }'
  printf '\n'
}

# --- 状态文件（快照哈希 ↔ 不可变镜像标识）-----------------------------------

snapshot_state_file() { printf '%s/workspace-image.env' "${DEVENV_STATE_DIR:-$REPO_ROOT/.devenv-state}"; }

snapshot_state_load() { # → STATE_SNAPSHOT_HASH / STATE_IMAGE_ID（无状态文件则为空）
  STATE_SNAPSHOT_HASH=""; STATE_IMAGE_ID=""
  local f SNAPSHOT_HASH="" IMAGE_ID="" BUILT_AT=""
  f="$(snapshot_state_file)"
  if [[ -f "$f" ]]; then
    # 状态文件为 devenv 自写的 KEY=VALUE（与 images.lock 同口径 source 加载）
    . "$f"
    STATE_SNAPSHOT_HASH="$SNAPSHOT_HASH"; STATE_IMAGE_ID="$IMAGE_ID"
  fi
}

snapshot_state_write() { # <snapshotHash> <imageId>
  local f
  f="$(snapshot_state_file)"
  mkdir -p "$(dirname "$f")"
  printf '# devenv workspace 镜像状态（devenv 维护，勿手改；SNAPSHOT_HASH=git 树哈希）\nSNAPSHOT_HASH=%s\nIMAGE_ID=%s\nBUILT_AT=%s\n' \
    "$1" "$2" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$f"
}
