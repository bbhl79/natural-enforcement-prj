# shellcheck shell=bash
# ============================================================================
# devenv 快照库（被 devenv/devenv source，不直接执行）
#
# Spec-工程基座 §3「ensure_fresh_workspace（固定输入快照）」（#58 落地）：
#   - 采集：git 临时索引 add -A + write-tree——内容寻址树哈希即快照标识，覆盖
#     未提交修改、新增、删除，以及 Dockerfile、构建脚本、锁文件等构建输入
#     （gitignored 内容——node_modules、.devenv-state 等——不进入快照）。
#   - 采集后构建只读快照（git 对象库），不再读取活工作树。
#   - 采集一致性（机制与成立条件见 docs/adr/2026-11-25-21-19-快照采集一致性机制.md）：
#     stat 括号（文件清单 + 逐文件 (mtime,size,inode,mode) 端点比对）+ 内容双读
#     （两遍全量读取的 mode+blob 清单比对）——窗口内任何未完美复原的写入（含
#     mtime 恢复型等长覆写）都被检出 → 重试；3 次均不稳 → 明确拒绝（exit 4），
#     不产生混合内容却报告来源一致。
#   - 状态：.devenv-state/workspace-image.env（gitignored）记录 快照哈希 ↔
#     workspace 不可变镜像标识 + tools 输入哈希 ↔ tools 不可变镜像标识；
#     镜像 label 另记快照哈希 / 构建输入清单 / 基础镜像 ID（可核对链路）。
#   - 诚实口径：检查来源一致性、减少运行旧代码，不声称完整构建证明。
# ============================================================================

SNAPSHOT_TMPDIRS=()
SNAPSHOT_MATERIALIZED_DIR=""

snapshot_tree_once() { # 单次树计算：打印当前工作树的 git 树哈希（临时索引，不动用户索引）
  local tmp_index tree rc=0
  tmp_index="$(mktemp /tmp/ne-snapshot-index.XXXXXX)"
  rm -f "$tmp_index"  # 不存在的索引文件 = 空索引（0 字节文件会被 git 判为损坏）
  GIT_INDEX_FILE="$tmp_index" git -C "$REPO_ROOT" add -A || rc=$?
  if (( rc == 0 )); then
    tree="$(GIT_INDEX_FILE="$tmp_index" git -C "$REPO_ROOT" write-tree)" || rc=$?
  fi
  rm -f "$tmp_index"
  (( rc == 0 )) || die 4 "快照采集失败（git add -A / write-tree 退出码 ${rc}）"
  printf '%s\n' "$tree"
}

snapshot_stat_bin() { # GNU stat（macOS 为 coreutils 的 gstat）；缺失 → die 3
  if stat -c '%Y' / >/dev/null 2>&1; then
    printf 'stat'
  elif gstat -c '%Y' / >/dev/null 2>&1; then
    printf 'gstat'
  else
    die 3 "缺少 GNU stat（coreutils；macOS：brew install coreutils）"
  fi
}

snapshot_stat_files() { # $@=仓库相对路径（数组传参，空格/通配符安全）→ 排序 stat 行
  # rc 0=成功（含空集合）；rc 1=stat 执行失败（调用方按不稳定重试）；rc 3=无 GNU stat（硬错误）
  # 失败不吞：任何 stat 错误都显式传播，不落入「两次都漏检查却判定稳定」
  local bin f rc=0
  local out=""
  local -a args=() missing=()
  bin="$(snapshot_stat_bin)" || return 3
  for f in "$@"; do
    if [[ -e "$REPO_ROOT/$f" || -L "$REPO_ROOT/$f" ]]; then
      args+=("$REPO_ROOT/$f")
    else
      missing+=("$f")  # 枚举后消失：记 MISSING——两端一致则稳定，不一致即检出
    fi
  done
  if (( ${#args[@]} > 0 )); then
    out="$("$bin" -c '%n|%y|%s|%i|%a' "${args[@]}")" || rc=$?
    (( rc == 0 )) || return 1
  fi
  for f in ${missing[@]+"${missing[@]}"}; do
    out+="${out:+$'\n'}$REPO_ROOT/$f|MISSING"
  done
  if [[ -n "$out" ]]; then
    printf '%s\n' "$out" | sort
  fi
  return 0
}

snapshot_capture_once() { # 一致 → 打印树哈希 rc 0；窗口内写入/读取失败 → rc 1；硬错误 → die/返回非 1
  # 机制（ADR 2026-11-25-21-19）：stat 括号（端点）+ 内容双读（两遍全量读取的
  # mode+blob 清单比对）+ 文件清单复核。接受 ⟺ 三者一致——窗口内任何未完美复原
  # 的写入（含 mtime 恢复型等长覆写）都被检出；完美往返（内容+stat 复原）为原理性
  # 盲区（任何只读机制不可检出，但捕获内容即盘上内容）。
  # 注意：本函数经 $(...) 在 || 守卫下调用，set -e 在其内部被抑制——每步失败必须
  # 显式处理，不得依赖 set -e 兜底。
  local rc=0 list_tmp list_sha1 list_sha2
  # 枚举：NUL 分隔清单不能过 bash 变量（命令替换丢 NUL）——落临时文件，rc 显式检查
  list_tmp="$(mktemp /tmp/ne-snapshot-list.XXXXXX)"
  git -C "$REPO_ROOT" ls-files -c -o --exclude-standard -z > "$list_tmp" || rc=$?
  if (( rc != 0 )); then
    rm -f "$list_tmp"
    die 4 "快照采集失败（git ls-files 枚举退出码 ${rc}——非 git 仓库或索引损坏）"
  fi
  local -a files=()
  local f
  while IFS= read -r -d '' f; do files+=("$f"); done < "$list_tmp"
  list_sha1="$(sha256sum < "$list_tmp" | awk '{print $1}')"
  rm -f "$list_tmp"

  local stats1 stats2 m1 m2 tree idx
  rc=0
  stats1="$(snapshot_stat_files ${files[@]+"${files[@]}"})" || rc=$?
  if (( rc != 0 )); then
    (( rc == 1 )) && return 1
    return "$rc"
  fi

  # 第一遍读取（分两批，批间为「读取交错」测试缝；生产语义与单次 add -A 等价）
  idx="$(mktemp /tmp/ne-snapshot-index.XXXXXX)"
  rm -f "$idx"  # 不存在的索引文件 = 空索引
  # 批次 pathspec 只收当前存在的文件：空临时索引下「已删除文件」无需 add（缺席即
  # 删除），且空索引里 pathspec 匹配不到它会报 did not match（实测）
  local -a batch1=() batch2=()
  local half=$(( ${#files[@]} / 2 )) i=0
  for f in ${files[@]+"${files[@]}"}; do
    if [[ -e "$REPO_ROOT/$f" || -L "$REPO_ROOT/$f" ]]; then
      if (( i < half )); then batch1+=("$f"); else batch2+=("$f"); fi
      i=$((i + 1))
    fi
  done
  if (( ${#batch1[@]} > 0 )); then
    rc=0
    GIT_INDEX_FILE="$idx" git -C "$REPO_ROOT" --literal-pathspecs add -A -- "${batch1[@]}" || rc=$?
    if (( rc != 0 )); then rm -f "$idx"; return 1; fi  # 多为窗口内文件消失（瞬态）→ 重试
  fi
  # 测试钩子（仅离线测试注入确定性读取交错；生产未定义即为空操作）
  if declare -F snapshot_test_hook >/dev/null 2>&1; then snapshot_test_hook read-interleave || return 1; fi
  if (( ${#batch2[@]} > 0 )); then
    rc=0
    GIT_INDEX_FILE="$idx" git -C "$REPO_ROOT" --literal-pathspecs add -A -- "${batch2[@]}" || rc=$?
    if (( rc != 0 )); then rm -f "$idx"; return 1; fi
  fi
  rc=0
  m1="$(GIT_INDEX_FILE="$idx" git -C "$REPO_ROOT" ls-files -s)" || rc=$?
  if (( rc != 0 )); then rm -f "$idx"; die 4 "快照采集失败（读取索引清单退出码 ${rc}）"; fi

  # 第二遍全量重读（内容双读：抓 mtime 恢复型等长覆写——stat 盲区）
  rc=0
  GIT_INDEX_FILE="$idx" git -C "$REPO_ROOT" read-tree --empty || rc=$?
  if (( rc != 0 )); then rm -f "$idx"; die 4 "快照采集失败（索引重置退出码 ${rc}）"; fi
  rc=0
  GIT_INDEX_FILE="$idx" git -C "$REPO_ROOT" add -A || rc=$?
  if (( rc != 0 )); then rm -f "$idx"; return 1; fi
  rc=0
  m2="$(GIT_INDEX_FILE="$idx" git -C "$REPO_ROOT" ls-files -s)" || rc=$?
  if (( rc != 0 )); then rm -f "$idx"; die 4 "快照采集失败（读取索引清单退出码 ${rc}）"; fi
  rc=0
  tree="$(GIT_INDEX_FILE="$idx" git -C "$REPO_ROOT" write-tree)" || rc=$?
  rm -f "$idx"
  (( rc == 0 )) || die 4 "快照采集失败（write-tree 退出码 ${rc}）"

  # 端点 stat 括号 + 文件清单复核
  rc=0
  stats2="$(snapshot_stat_files ${files[@]+"${files[@]}"})" || rc=$?
  if (( rc != 0 )); then
    (( rc == 1 )) && return 1
    return "$rc"
  fi
  rc=0
  list_sha2="$(git -C "$REPO_ROOT" ls-files -c -o --exclude-standard -z | sha256sum | awk '{print $1}')" || rc=$?
  (( rc == 0 )) || die 4 "快照采集失败（git ls-files 复核退出码 ${rc}）"

  if [[ "$m1" != "$m2" || "$stats1" != "$stats2" || "$list_sha1" != "$list_sha2" ]]; then
    return 1
  fi
  printf '%s\n' "$tree"
  return 0
}

snapshot_capture() { # 重试 3 次；均不稳 → 明确拒绝（die 4）；硬错误直接传播
  local attempt tree rc
  for attempt in 1 2 3; do
    rc=0
    tree="$(snapshot_capture_once)" || rc=$?
    if (( rc == 0 )); then
      if (( attempt > 1 )); then
        note "快照采集第 $attempt 次尝试后稳定"
      fi
      printf '%s\n' "$tree"
      return 0
    elif (( rc == 1 )); then
      warn "快照采集窗口内检测到工作树写入或读取失败（第 $attempt 次），重试…"
    else
      return "$rc"  # 硬错误（枚举失败/无 GNU stat 等）：不重试，直接传播
    fi
  done
  die 4 "工作树在快照采集期间持续变化或无法读取（3 次采集窗口均不稳定）——明确拒绝，不产生混合内容却报告来源一致。请暂停文件修改后重试。"
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
