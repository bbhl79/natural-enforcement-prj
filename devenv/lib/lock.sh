# shellcheck shell=bash
# ============================================================================
# devenv 锁库（被 devenv/devenv source，不直接执行）
#
# Spec-工程基座 §4：宿主侧 POSIX 原子目录锁（mkdir），不依赖 flock（macOS 默认无
# flock）；锁目录含持有者 pid + 启动时间；失效判定以持有进程存活为准（kill -0），
# 不单纯按超时删锁——慢构建仍活着时锁有效，第二个进程不得闯入；进程被杀留下锁
# 目录 → 识别持有者已死 → 清理失效锁后后续可取得。
#
# 锁命名空间：/tmp/natural-enforcement-locks（机器级，跨 worktree 共享；
# per-worktree 锁细分归 #59/#61，本票先保证互斥原语两平台可用）。
# ============================================================================

LOCK_ROOT="${DEVENV_LOCK_ROOT:-/tmp/natural-enforcement-locks}"
declare -a HELD_LOCKS=()

lock_release_all() {
  local d
  for d in ${HELD_LOCKS[@]+"${HELD_LOCKS[@]}"}; do
    rm -rf "$d"
  done
  HELD_LOCKS=()
}

# 锁目录是否失效：持有者 pid 已死 → 失效。owner 文件缺失给 1s 宽限（创建者
# mkdir 后立即写入，竞态窗口极短），宽限后仍缺失视为失效（创建者已崩溃）。
lock_is_stale() {
  local dir="$1" owner="$dir/owner" pid=""
  if [[ -f "$owner" ]]; then
    pid="$(awk '{print $1}' "$owner" 2>/dev/null)"
    [[ -n "$pid" ]] || return 0
    kill -0 "$pid" 2>/dev/null && return 1 || return 0
  fi
  sleep 1
  [[ -f "$owner" ]] || return 0
  pid="$(awk '{print $1}' "$owner" 2>/dev/null)"
  [[ -n "$pid" ]] || return 0
  kill -0 "$pid" 2>/dev/null && return 1 || return 0
}

# 取得独占锁：lock_acquire <名> <超时秒>。超时 → 退出码 6。
lock_acquire() {
  local name="$1" timeout="${2:-60}"
  local dir="$LOCK_ROOT/$name.lock"
  mkdir -p "$LOCK_ROOT"
  local waited=0
  while true; do
    if mkdir "$dir" 2>/dev/null; then
      printf '%s %s\n' "$$" "$(date +%s)" > "$dir/owner"
      HELD_LOCKS+=("$dir")
      return 0
    fi
    if lock_is_stale "$dir"; then
      warn "锁 [$name] 持有者已死，清理失效锁：$dir"
      rm -rf "$dir"
      continue
    fi
    if (( waited >= timeout )); then
      local holder=""
      [[ -f "$dir/owner" ]] && holder="$(cat "$dir/owner" 2>/dev/null)"
      die 6 "独占锁 [$name] 被占用（持有者 pid/启动时间：${holder:-未知}），等待 ${timeout}s 超时。锁目录：$dir"
    fi
    sleep 1; waited=$((waited + 1))
  done
}
