# shellcheck shell=bash
# ============================================================================
# devenv 锁库（被 devenv/devenv source，不直接执行）
#
# Spec-工程基座 §4：宿主侧 POSIX 原子目录锁（mkdir），不依赖 flock（macOS 默认无
# flock）；锁目录含持有者 pid + 启动时间；失效判定以持有进程存活为准（kill -0），
# 不单纯按超时删锁——慢构建仍活着时锁有效，第二个进程不得闯入；进程被杀留下锁
# 目录 → 识别持有者已死 → 清理失效锁后后续可取得。
#
# 锁命名空间：/tmp/natural-enforcement-locks（机器级，跨 worktree 共享目录；
# 锁名分派 #59：stack-<suffix>/migrate-<suffix> per-worktree，lockgen/prefetch 机器级——
# 跨 worktree 互斥的共享资源是 lockgen 靶容器/标签与基础镜像拉取）。
#
# 共享栈使用租约（#61，Spec-工程基座 §4「正在使用环境」协调）：
#   - 读者（test/verify/lint/typecheck/test:unit/seed）持 <name>.lease 下的独立
#     持有者槽（共享，可并行）；写者（build/up/down/restart/web/migrate*）持
#     <name>.lock（排他）。
#   - 读写进入决策由短临界区门 <name>.gate 串行化：读者在门下确认无排他锁后入槽；
#     写者在门下确认无存活租约后建锁。门持有者带唯一 token，释放时校验 token；
#     取得后复核 token，极端 ABA 下失去门则撤销本次登记并重试。
#   - 写者遇到活跃租约 → 等待至超时后 exit 6（不在测试中途拆栈/迁移/替换服务）；
#     读者遇到排他锁 → 同样等待至超时后 exit 6。等待上限按调用方传入秒数；
#     DEVENV_LOCK_TIMEOUT（整数秒）为测试/故障演练覆盖上限的显式入口。
#   - 租约槽含 owner（pid + 启动时间 + 槽名），失效判定与锁同口径（kill -0）；
#     持有进程被 kill 后，下一次写者取得或读者登记时清理失效槽，不永久阻塞环境。
#   - 机器级锁（lockgen 容器锁、prefetch 基础镜像拉取锁）与租约机制正交：机器级
#     命令不取栈使用租约，租约只协调 per-worktree 的栈使用。
# ============================================================================

LOCK_ROOT="${DEVENV_LOCK_ROOT:-/tmp/natural-enforcement-locks}"
declare -a HELD_LOCKS=()
declare -a HELD_LEASES=()
LOCK_TIMEOUT_EFFECTIVE=""
LOCK_GATE_TOKEN=""

lock_release_all() {
  local d
  for d in ${HELD_LOCKS[@]+"${HELD_LOCKS[@]}"}; do
    rm -rf "$d"
  done
  HELD_LOCKS=()
}

lease_release_all() {
  local d
  for d in ${HELD_LEASES[@]+"${HELD_LEASES[@]}"}; do
    rm -rf "$d"
    rmdir "${d%/*}" 2>/dev/null || true  # 空则顺手回收；其他读者可能在用则保留
  done
  HELD_LEASES=()
}

# 本次等待上限：默认取调用方值；DEVENV_LOCK_TIMEOUT 显式覆盖（测试/故障演练）。
lock_timeout_effective() { # <默认秒> → $LOCK_TIMEOUT_EFFECTIVE
  if [[ -n "${DEVENV_LOCK_TIMEOUT:-}" ]]; then
    [[ "$DEVENV_LOCK_TIMEOUT" =~ ^[0-9]+$ ]] \
      || die 2 "DEVENV_LOCK_TIMEOUT 需为非负整数秒：$DEVENV_LOCK_TIMEOUT"
    LOCK_TIMEOUT_EFFECTIVE="$DEVENV_LOCK_TIMEOUT"
  else
    LOCK_TIMEOUT_EFFECTIVE="$1"
  fi
}

_lock_write_owner() { # <dir> [token]
  if [[ -n "${2:-}" ]]; then
    printf '%s %s %s\n' "$$" "$(date +%s)" "$2" > "$1/owner"
  else
    printf '%s %s\n' "$$" "$(date +%s)" > "$1/owner"
  fi
}

# 锁目录是否失效：持有者 pid 已死 → 失效。owner 文件缺失或为空给 1s 宽限
# （创建者 mkdir 后立即写入，竞态窗口极短），宽限后仍无有效 pid 视为失效
# （创建者已崩溃）。空文件不能立即判失效——否则会误删正被写入的活锁/活门。
lock_is_stale() {
  local dir="$1"
  local owner="$dir/owner"
  local pid=""
  if [[ -f "$owner" ]]; then
    pid="$(awk '{print $1}' "$owner" 2>/dev/null)"
    if [[ -n "$pid" ]]; then
      kill -0 "$pid" 2>/dev/null && return 1 || return 0
    fi
  fi
  sleep 1
  if [[ -f "$owner" ]]; then
    pid="$(awk '{print $1}' "$owner" 2>/dev/null)"
    [[ -n "$pid" ]] || return 0
    kill -0 "$pid" 2>/dev/null && return 1 || return 0
  fi
  return 0
}

_lock_owner_token_is() { # <dir> <token>
  [[ "$(awk '{print $3}' "$1/owner" 2>/dev/null)" == "$2" ]]
}

_lock_gate_held() { # <gate>：本次进程仍持有该门
  [[ -n "$LOCK_GATE_TOKEN" ]] && _lock_owner_token_is "$1" "$LOCK_GATE_TOKEN"
}

_lock_remove_own_lock() { # <lock-dir> <token>：仅撤销本次登记，不误删他人
  _lock_owner_token_is "$1" "$2" && rm -rf "$1"
  return 0
}

_lock_remove_own_slot() { # <slot-dir>：槽名唯一，校验 owner pid
  [[ "$(awk '{print $1}' "$1/owner" 2>/dev/null)" == "$$" ]] && rm -rf "$1"
  return 0
}

# 短临界区门（读写进入决策的原子串行化）。成功 0；占用 1（失效门清理后重试一次）。
_lock_gate_try() { # <gate-dir>
  local gate="$1"
  local token="$$.$(date +%s).$RANDOM"
  local pid=""
  LOCK_GATE_TOKEN=""
  if mkdir "$gate" 2>/dev/null; then
    _lock_write_owner "$gate" "$token"
    if _lock_owner_token_is "$gate" "$token"; then
      LOCK_GATE_TOKEN="$token"
      return 0
    fi
    return 1
  fi
  if lock_is_stale "$gate"; then
    warn "锁门 [${gate##*/}] 持有者已死，清理：$gate"
    # 再读一次 owner：若已有活 pid 出现则放弃移除（缩小 ABA 窗口——避免把
    # 另一进程刚重建的活门当失效门删掉）
    pid="$(awk '{print $1}' "$gate/owner" 2>/dev/null)"
    if [[ -z "$pid" ]] || ! kill -0 "$pid" 2>/dev/null; then
      rm -rf "$gate"
      if mkdir "$gate" 2>/dev/null; then
        _lock_write_owner "$gate" "$token"
        if _lock_owner_token_is "$gate" "$token"; then
          LOCK_GATE_TOKEN="$token"
          return 0
        fi
      fi
    fi
  fi
  return 1
}

_lock_gate_release() { # <gate>
  if _lock_gate_held "$1"; then
    rm -rf "$1"
  fi
  LOCK_GATE_TOKEN=""
  return 0
}

# 清理失效租约槽（不输出；读者登记路径与写者取得路径共用）。
lease_clean_stale() { # <锁名>
  local name="$1"
  local base="$LOCK_ROOT/$name.lease"
  local d
  [[ -d "$base" ]] || return 0
  for d in "$base"/*; do
    [[ -d "$d" ]] || continue
    if lock_is_stale "$d"; then
      warn "租约 [$name] 持有者已死，清理失效租约：$d"
      rm -rf "$d"
    fi
  done
  return 0
}

# 存活租约持有者（pid starttime slot；仅活跃者）。顺带清理失效槽——调用方须处于
# 写者取得路径（本次取得会改变状态），只读命令用 lease_report_all。
lease_active_holders() { # <锁名>
  local name="$1"
  local base="$LOCK_ROOT/$name.lease"
  local d pid st
  [[ -d "$base" ]] || return 0
  lease_clean_stale "$name"
  for d in "$base"/*; do
    [[ -d "$d" ]] || continue
    pid="$(awk '{print $1}' "$d/owner" 2>/dev/null)"
    st="$(awk '{print $2}' "$d/owner" 2>/dev/null)"
    [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null \
      && printf '%s %s %s\n' "$pid" "$st" "${d##*/}"
  done
  return 0
}

# 只读报告全部租约槽（status 用；不清理失效槽，保持只读语义）。
lease_report_all() {
  local d base name pid st state
  for d in "$LOCK_ROOT"/*.lease; do
    [[ -d "$d" ]] || continue
    name="${d##*/}"; name="${name%.lease}"
    for base in "$d"/*; do
      [[ -d "$base" ]] || continue
      pid="$(awk '{print $1}' "$base/owner" 2>/dev/null)"
      st="$(awk '{print $2}' "$base/owner" 2>/dev/null)"
      if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then state=active; else state=stale; fi
      printf '%s pid=%s start=%s %s\n' "$name" "${pid:-?}" "${st:-?}" "$state"
    done
  done
  return 0
}

# 取得独占锁（写者）：lock_acquire <名> <超时秒>。
# 活跃共享租约在场时等待（不在测试中途拆栈/迁移/替换服务）；超时 → 退出码 6。
lock_acquire() {
  local name="$1"
  local default_timeout="${2:-60}"
  lock_timeout_effective "$default_timeout"
  local timeout="$LOCK_TIMEOUT_EFFECTIVE"
  local waited=0
  local dir="$LOCK_ROOT/$name.lock"
  local gate="$LOCK_ROOT/$name.gate"
  local holder="" active="" token=""
  mkdir -p "$LOCK_ROOT"
  while true; do
    if ! _lock_gate_try "$gate"; then
      if (( waited >= timeout )); then
        die 6 "独占锁 [$name] 等待锁门超时（${timeout}s）。锁门目录：$gate。修复：确认持有进程已死后重跑（失效锁自动清理）"
      fi
      sleep 1; waited=$((waited + 1)); continue
    fi
    # 已有排他锁：失效则清理，存活则退让
    if [[ -d "$dir" ]] && lock_is_stale "$dir"; then
      warn "锁 [$name] 持有者已死，清理失效锁：$dir"
      rm -rf "$dir"
    fi
    if [[ -d "$dir" ]]; then
      holder="$(cat "$dir/owner" 2>/dev/null || true)"
      _lock_gate_release "$gate"
      if (( waited >= timeout )); then
        die 6 "独占锁 [$name] 被占用（持有者 pid/启动时间：${holder:-未知}），等待 ${timeout}s 超时。锁目录：$dir。修复：等待持有者结束，或确认其已死后重跑（失效锁自动清理）"
      fi
      sleep 1; waited=$((waited + 1)); continue
    fi
    # 活跃共享租约（测试/质量门运行期）：等待其释放
    active="$(lease_active_holders "$name")"
    if [[ -n "$active" ]]; then
      _lock_gate_release "$gate"
      if (( waited >= timeout )); then
        die 6 "独占锁 [$name] 有活跃栈使用租约（持有者 pid/启动时间/槽：$(printf '%s' "$active" | tr '\n' ';')），等待 ${timeout}s 超时。修复：等待测试/质量门结束，或确认持有进程已死后重跑（失效租约自动清理）"
      fi
      sleep 1; waited=$((waited + 1)); continue
    fi
    if mkdir "$dir" 2>/dev/null; then
      token="$$.$(date +%s).$RANDOM"
      _lock_write_owner "$dir" "$token"
      if ! _lock_gate_held "$gate"; then
        # 极端 ABA：门在临界区期间被夺走。撤销本次登记（仅限自己的 token）后重试
        _lock_remove_own_lock "$dir" "$token"
        _lock_gate_release "$gate"
        if (( waited >= timeout )); then
          die 6 "独占锁 [$name] 取得失败（门被并发夺走），等待 ${timeout}s 超时。修复：重跑命令（本次未产生半状态）"
        fi
        sleep 1; waited=$((waited + 1)); continue
      fi
      HELD_LOCKS+=("$dir")
      _lock_gate_release "$gate"
      return 0
    fi
    _lock_gate_release "$gate"
    if (( waited >= timeout )); then
      die 6 "独占锁 [$name] 取得失败（并发竞态），等待 ${timeout}s 超时。锁目录：$dir。修复：重跑命令（本次未产生半状态）"
    fi
    sleep 1; waited=$((waited + 1))
  done
}

# 取得共享栈使用租约（读者）：lease_acquire <名> <超时秒>。
# 排他锁在场时等待；超时 → 退出码 6。多个读者可在同一资源上并行；
# 读者登记时清理失效租约槽（进程被 kill 后不永久阻塞）。
lease_acquire() {
  local name="$1"
  local default_timeout="${2:-120}"
  lock_timeout_effective "$default_timeout"
  local timeout="$LOCK_TIMEOUT_EFFECTIVE"
  local waited=0
  local gate="$LOCK_ROOT/$name.gate"
  local base="$LOCK_ROOT/$name.lease"
  local dir="$LOCK_ROOT/$name.lock"
  local holder="" slot=""
  mkdir -p "$LOCK_ROOT"
  while true; do
    if ! _lock_gate_try "$gate"; then
      if (( waited >= timeout )); then
        die 6 "共享租约 [$name] 等待锁门超时（${timeout}s）。锁门目录：$gate。修复：确认持有进程已死后重跑（失效锁自动清理）"
      fi
      sleep 1; waited=$((waited + 1)); continue
    fi
    # 排他锁在场：读者退让（失效锁由本函数清理，避免仅读者时环境永久阻塞）
    if [[ -d "$dir" ]] && lock_is_stale "$dir"; then
      warn "排他锁 [$name] 持有者已死，清理失效锁：$dir"
      rm -rf "$dir"
    fi
    if [[ -d "$dir" ]]; then
      holder="$(cat "$dir/owner" 2>/dev/null || true)"
      _lock_gate_release "$gate"
      if (( waited >= timeout )); then
        die 6 "共享租约 [$name] 被排他锁占用（持有者 pid/启动时间：${holder:-未知}），等待 ${timeout}s 超时。修复：等待排他命令结束，或确认持有进程已死后重跑（失效锁自动清理）"
      fi
      sleep 1; waited=$((waited + 1)); continue
    fi
    # 读者登记时也清理失效租约槽（#61：进程被 kill 后由下一次取得清理）
    lease_clean_stale "$name"
    mkdir -p "$base"
    slot="$base/$$.$(date +%s).$RANDOM"
    if mkdir "$slot" 2>/dev/null; then
      printf '%s %s %s\n' "$$" "$(date +%s)" "${slot##*/}" > "$slot/owner"
      if ! _lock_gate_held "$gate"; then
        _lock_remove_own_slot "$slot"
        _lock_gate_release "$gate"
        if (( waited >= timeout )); then
          die 6 "共享租约 [$name] 取得失败（门被并发夺走），等待 ${timeout}s 超时。修复：重跑命令（本次未产生半状态）"
        fi
        sleep 1; waited=$((waited + 1)); continue
      fi
      HELD_LEASES+=("$slot")
      _lock_gate_release "$gate"
      return 0
    fi
    _lock_gate_release "$gate"
    if (( waited >= timeout )); then
      die 6 "共享租约 [$name] 创建持有者槽失败（并发竞态），等待 ${timeout}s 超时。租约目录：$base。修复：重跑命令（本次未产生半状态）"
    fi
    sleep 1; waited=$((waited + 1))
  done
}
