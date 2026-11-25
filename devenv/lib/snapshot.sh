# shellcheck shell=bash
# ============================================================================
# devenv 快照库（被 devenv/devenv source，不直接执行）
#
# Spec-工程基座 §3「ensure_fresh_workspace（固定输入快照）」（#58 落地）：
#   - 采集：git 临时索引 add -A + write-tree——内容寻址树哈希即快照标识，覆盖
#     未提交修改、新增、删除，以及 Dockerfile、构建脚本、锁文件等构建输入
#     （gitignored 内容——node_modules、.devenv-state 等——不进入快照）。
#   - 采集后构建只读快照（git 对象库），不再读取活工作树。
#   - 采集一致性（机制与成立条件见 docs/adr/2026-11-25-快照采集一致性机制.md）：
#     读取窗口用 文件清单 + 逐文件 (mtime, size, inode)  stat 括号夹住——窗口内
#     任何写入（原地写/追加/原子重命名保存）都会改变 stat → 重试；3 次均不稳 →
#     明确拒绝（exit 4），不产生混合内容却报告来源一致。
#   - 状态：.devenv-state/workspace-image.env（gitignored）记录 快照哈希 ↔
#     workspace 不可变镜像标识 + tools 输入哈希 ↔ tools 不可变镜像标识；
#     镜像 label 另记快照哈希 / 构建输入清单 / 基础镜像 ID（可核对链路）。
#   - 诚实口径：检查来源一致性、减少运行旧代码，不声称完整构建证明。
# ============================================================================

SNAPSHOT_TMPDIRS=()
SNAPSHOT_MATERIALIZED_DIR=""
SNAPSHOT_STAT_BIN=""

snapshot_tree_once() { # 单次树计算：打印当前工作树的 git 树哈希（临时索引，不动用户索引）
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

snapshot_stat_bin() { # GNU stat（macOS 为 coreutils 的 gstat）；缺失 → die 3
  if [[ -z "$SNAPSHOT_STAT_BIN" ]]; then
    if stat -c '%Y' / >/dev/null 2>&1; then
      SNAPSHOT_STAT_BIN=stat
    elif gstat -c '%Y' / >/dev/null 2>&1; then
      SNAPSHOT_STAT_BIN=gstat
    else
      die 3 "缺少 GNU stat（coreutils；macOS：brew install coreutils）"
    fi
  fi
  printf '%s' "$SNAPSHOT_STAT_BIN"
}

snapshot_stat_files() { # $@=仓库相对路径 → 排序后的 "路径|mtime(ns)|size|inode" 行（读取窗口的 stat 括号）
  local bin out
  bin="$(snapshot_stat_bin)"
  # 缺失文件不出现在输出中——两次括号输出集合不同即判不稳定（语义正确）
  out="$("$bin" -c '%n|%y|%s|%i' ${@/#/$REPO_ROOT/} 2>/dev/null)" || true
  printf '%s\n' "$out" | sort
}

snapshot_capture_once() { # 稳定 → 打印树哈希 rc 0；采集窗口内检测到写入 → rc 1（无输出）
  # stat 括号：读取前记录 清单+stat，读取后复核——窗口内任何改变 (mtime,size,inode)
  # 或清单的写入都被检出（覆盖原地写/追加/原子重命名保存；成立条件与限制见 ADR）。
  local -a files=()
  local f tree list_sha1 list_sha2 stats1 stats2
  while IFS= read -r -d '' f; do files+=("$f"); done \
    < <(git -C "$REPO_ROOT" ls-files -c -o --exclude-standard -z | sort -z)
  list_sha1="$(printf '%s\0' ${files[@]+"${files[@]}"} | sha256sum | awk '{print $1}')"
  stats1="$(snapshot_stat_files ${files[@]+"${files[@]}"})"
  # 测试钩子（仅离线测试注入确定性竞态；生产未定义即为空操作）
  if declare -F snapshot_test_hook >/dev/null 2>&1; then snapshot_test_hook before-add; fi
  tree="$(snapshot_tree_once)"
  if declare -F snapshot_test_hook >/dev/null 2>&1; then snapshot_test_hook after-add; fi
  stats2="$(snapshot_stat_files ${files[@]+"${files[@]}"})"
  list_sha2="$(git -C "$REPO_ROOT" ls-files -c -o --exclude-standard -z | sort -z | sha256sum | awk '{print $1}')"
  if [[ "$stats1" != "$stats2" || "$list_sha1" != "$list_sha2" ]]; then
    return 1
  fi
  printf '%s\n' "$tree"
  return 0
}

snapshot_capture() { # stat 括号采集；窗口内有写入 → 重试；3 次均不稳 → 明确拒绝（die 4）
  local attempt tree
  for attempt in 1 2 3; do
    if tree="$(snapshot_capture_once)"; then
      if (( attempt > 1 )); then
        note "快照采集第 $attempt 次尝试后稳定"
      fi
      printf '%s\n' "$tree"
      return 0
    fi
    warn "快照采集窗口内检测到工作树写入（第 $attempt 次），重试…"
  done
  die 4 "工作树在快照采集期间持续变化（3 次采集窗口均检测到写入）——明确拒绝，不产生混合内容却报告来源一致。请暂停文件修改后重试。"
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

# --- 状态文件（快照哈希 ↔ workspace 镜像 ID；tools 输入哈希 ↔ tools 镜像 ID）-----

snapshot_state_file() { printf '%s/workspace-image.env' "${DEVENV_STATE_DIR:-$REPO_ROOT/.devenv-state}"; }

snapshot_state_load() { # → STATE_SNAPSHOT_HASH / STATE_IMAGE_ID / STATE_TOOLS_INPUT_HASH / STATE_TOOLS_IMAGE_ID
  STATE_SNAPSHOT_HASH=""; STATE_IMAGE_ID=""; STATE_TOOLS_INPUT_HASH=""; STATE_TOOLS_IMAGE_ID=""
  local f SNAPSHOT_HASH="" IMAGE_ID="" TOOLS_INPUT_HASH="" TOOLS_IMAGE_ID="" BUILT_AT=""
  f="$(snapshot_state_file)"
  if [[ -f "$f" ]]; then
    # 状态文件为 devenv 自写的 KEY=VALUE（与 images.lock 同口径 source 加载）
    . "$f"
    STATE_SNAPSHOT_HASH="$SNAPSHOT_HASH"; STATE_IMAGE_ID="$IMAGE_ID"
    STATE_TOOLS_INPUT_HASH="$TOOLS_INPUT_HASH"; STATE_TOOLS_IMAGE_ID="$TOOLS_IMAGE_ID"
  fi
}

snapshot_state_store() { # <wsHash> <wsImageId> <toolsInputHash> <toolsImageId>：全字段写
  local f
  f="$(snapshot_state_file)"
  mkdir -p "$(dirname "$f")"
  printf '# devenv workspace 镜像状态（devenv 维护，勿手改；SNAPSHOT_HASH=git 树哈希）\nSNAPSHOT_HASH=%s\nIMAGE_ID=%s\nTOOLS_INPUT_HASH=%s\nTOOLS_IMAGE_ID=%s\nBUILT_AT=%s\n' \
    "$1" "$2" "$3" "$4" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$f"
}

snapshot_state_write() { # <wsHash> <wsImageId>：写 workspace 绑定，保留 tools 字段
  snapshot_state_load
  snapshot_state_store "$1" "$2" "$STATE_TOOLS_INPUT_HASH" "$STATE_TOOLS_IMAGE_ID"
}

snapshot_state_write_tools() { # <toolsInputHash> <toolsImageId>：写 tools 绑定，保留 workspace 字段
  snapshot_state_load
  snapshot_state_store "$STATE_SNAPSHOT_HASH" "$STATE_IMAGE_ID" "$1" "$2"
}
