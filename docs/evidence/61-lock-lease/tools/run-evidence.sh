#!/usr/bin/env bash
# #61 锁与栈使用租约 — Windows(WSL2) 实机证据驱动（归档副本，可复跑）。
# 日志先落 /tmp，避免证据文件进入快照改变构建输入；跑完后整体拷入仓库。
# 用法：run-evidence.sh <section...|all>（默认 all；会覆盖 /tmp/ne61-evidence，
# 故障演练章节会真实 down/up 栈，请先在可丢弃的本机栈上运行）。
set -Eeuo pipefail

REPO="${REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)}"
DEVENV="$REPO/devenv/devenv"
EV="${EV:-/tmp/ne61-evidence}"
HOLD="$REPO/docs/evidence/61-lock-lease/tools/ne61-hold.sh"
LOCKROOT="${DEVENV_LOCK_ROOT:-/tmp/natural-enforcement-locks}"
SUFFIX="$(printf '%s' "$(git -C "$REPO" rev-parse --absolute-git-dir)" | sha256sum | awk '{print $1}' | cut -c1-8)"
STACK="stack-$SUFFIX"
RESULTS="$EV/results.tsv"
HOLDER_PID=""
PA=""; PB=""

mkdir -p "$EV"
: > "$RESULTS"

log() { printf '[evidence] %s\n' "$*" >&2; }
record() { printf '%s\trc=%s\n' "$1" "$2" >> "$RESULTS"; }

run_log() { # run_log <名> <cmd...>
  local f="$1"; shift
  set +e
  "$@" > "$EV/$f.out" 2> "$EV/$f.err"
  local rc=$?
  set -e
  record "$f" "$rc"
  log "$f rc=$rc"
  return 0
}

start_holder() { # start_holder <lock|lease> <锁名> <tag>
  local mode="$1" name="$2" tag="$3" i
  rm -f "/tmp/ne61-$tag.ready" "/tmp/ne61-$tag.stop"
  DEVENV_LOCK_ROOT="$LOCKROOT" bash "$HOLD" \
    "$mode" "$name" "/tmp/ne61-$tag.ready" "/tmp/ne61-$tag.stop" "$REPO" 600 &
  HOLDER_PID=$!
  for i in $(seq 1 100); do
    [[ -f "/tmp/ne61-$tag.ready" ]] && { log "holder $tag ready (pid=$HOLDER_PID)"; return 0; }
    sleep 0.1
  done
  log "ERROR: holder $tag 未就绪"
  kill -9 "$HOLDER_PID" 2>/dev/null || true
  HOLDER_PID=""
  return 1
}

stop_holder() { # stop_holder <tag>
  local tag="$1"
  : > "/tmp/ne61-$tag.stop"
  wait "$HOLDER_PID" 2>/dev/null || true
  HOLDER_PID=""
  log "holder $tag stopped"
}

wait_for_lease() { # wait_for_lease <秒上限（×0.2）>
  local n="${1:-200}" i
  for ((i = 0; i < n; i++)); do
    if find "$LOCKROOT/$STACK.lease" -maxdepth 2 -name owner -type f 2>/dev/null | grep -q .; then
      return 0
    fi
    sleep 0.2
  done
  return 1
}

wait_for_lock() { # wait_for_lock <秒上限（×0.05）>；等到 owner 落盘（持有者完整登记）
  local n="${1:-200}" i
  for ((i = 0; i < n; i++)); do
    [[ -f "$LOCKROOT/$STACK.lock/owner" ]] && return 0
    sleep 0.05
  done
  return 1
}

section_00() {
  log "00 基线"
  run_log 00-doctor "$DEVENV" doctor
  run_log 00-status "$DEVENV" --json status
  run_log 00-ps "$DEVENV" ps -a
}

section_02() {
  log "02 读者并行（两个真实 verify + 运行期 status）"
  local a0 a1 b0 b1 rca rcb
  set +e
  a0="$(date +%s)"
  "$DEVENV" verify > "$EV/02-verify-a.log" 2>&1 & PA=$!
  b0="$(date +%s)"
  "$DEVENV" verify > "$EV/02-verify-b.log" 2>&1 & PB=$!
  set -e
  if wait_for_lease 200; then
    run_log 02-status-during-lease "$DEVENV" --json status
  else
    log "WARN: 未观察到租约（verify 可能已结束）"
  fi
  set +e
  wait "$PA"; rca=$?; a1="$(date +%s)"
  wait "$PB"; rcb=$?; b1="$(date +%s)"
  set -e
  {
    echo "A verify: start=$a0 end=$a1 rc=$rca"
    echo "B verify: start=$b0 end=$b1 rc=$rcb"
    if (( a0 < b1 && b0 < a1 )); then echo "overlap=yes"; else echo "overlap=no"; fi
  } > "$EV/02-readers-parallel.txt"
  record 02-readers-parallel 0
  log "02 完成：A rc=$rca B rc=$rcb"
}

section_03() {
  log "03 写者 vs 活跃租约（8 个真实命令）"
  start_holder lease "$STACK" leasewr
  run_log 03-ps-before "$DEVENV" ps -a
  run_log 03-build env DEVENV_LOCK_TIMEOUT=2 "$DEVENV" build
  run_log 03-up env DEVENV_LOCK_TIMEOUT=2 "$DEVENV" up
  run_log 03-down env DEVENV_LOCK_TIMEOUT=2 "$DEVENV" down
  run_log 03-restart env DEVENV_LOCK_TIMEOUT=2 "$DEVENV" restart
  run_log 03-web env DEVENV_LOCK_TIMEOUT=2 "$DEVENV" web --port 5199
  run_log 03-web-down env DEVENV_LOCK_TIMEOUT=2 "$DEVENV" web --down
  run_log 03-migrate env DEVENV_LOCK_TIMEOUT=2 "$DEVENV" migrate
  run_log 03-migrate-create env DEVENV_LOCK_TIMEOUT=2 "$DEVENV" migrate:create --name evidence_61
  run_log 03-status-during-lease "$DEVENV" --json status
  stop_holder leasewr
  run_log 03-ps-after "$DEVENV" ps -a
  run_log 03-status-after "$DEVENV" --json status
}

section_04() {
  log "04 读者 vs 活跃排他锁（6 个真实命令）"
  start_holder lock "$STACK" lockwr
  run_log 04-test env DEVENV_LOCK_TIMEOUT=2 "$DEVENV" test
  run_log 04-test-unit env DEVENV_LOCK_TIMEOUT=2 "$DEVENV" test:unit
  run_log 04-lint env DEVENV_LOCK_TIMEOUT=2 "$DEVENV" lint
  run_log 04-typecheck env DEVENV_LOCK_TIMEOUT=2 "$DEVENV" typecheck
  run_log 04-verify env DEVENV_LOCK_TIMEOUT=2 "$DEVENV" verify
  run_log 04-seed env DEVENV_LOCK_TIMEOUT=2 "$DEVENV" seed
  stop_holder lockwr
}

section_05() {
  log "05 跨 worktree 与机器级锁"
  local B="/tmp/ne-61-evidence-b"
  git -C "$REPO" worktree remove --force "$B" >/dev/null 2>&1 || true
  rm -rf "$B"
  git -C "$REPO" worktree add --detach "$B" HEAD > "$EV/05-worktree-add.log" 2>&1
  local BDEVENV="$B/devenv/devenv"
  local BSUFFIX
  BSUFFIX="$(printf '%s' "$(git -C "$B" rev-parse --absolute-git-dir)" | sha256sum | awk '{print $1}' | cut -c1-8)"
  {
    echo "A suffix=$SUFFIX project=natural-enforcement-$SUFFIX"
    echo "B suffix=$BSUFFIX project=natural-enforcement-$BSUFFIX"
  } > "$EV/05-worktrees.txt"
  run_log 05-b-doctor "$BDEVENV" doctor
  # A 租约不阻塞 B 的排他命令
  start_holder lease "$STACK" wt-lease
  run_log 05-b-down-vs-a-lease env DEVENV_LOCK_TIMEOUT=2 "$BDEVENV" down
  stop_holder wt-lease
  # A 排他锁不阻塞 B 的排他命令
  start_holder lock "$STACK" wt-lock
  run_log 05-b-down-vs-a-lock env DEVENV_LOCK_TIMEOUT=2 "$BDEVENV" down
  stop_holder wt-lock
  # 机器级 prefetch：双向
  start_holder lock prefetch pf-a
  run_log 05-b-prefetch-vs-a-prefetch env DEVENV_LOCK_TIMEOUT=2 "$BDEVENV" prefetch
  stop_holder pf-a
  start_holder lock prefetch pf-b
  run_log 05-a-prefetch-vs-b-prefetch env DEVENV_LOCK_TIMEOUT=2 "$DEVENV" prefetch
  stop_holder pf-b
  # 机器级 lockgen：A 持有 → B build --lockgen 冲突
  start_holder lock lockgen lg-a
  run_log 05-b-build-lockgen-vs-a-lockgen env DEVENV_LOCK_TIMEOUT=2 "$BDEVENV" build --lockgen
  stop_holder lg-a
  run_log 05-b-status "$BDEVENV" --json status
  git -C "$REPO" worktree remove --force "$B" > "$EV/05-worktree-remove.log" 2>&1
  git -C "$REPO" worktree prune
  record 05-cross-worktree 0
}

section_06() {
  log "06 故障演练：kill 持锁进程后恢复"
  local f="$EV/06-kill-lock.txt"
  : > "$f"
  set +e
  "$DEVENV" build > "$EV/06-build-killed.log" 2>&1 & local bp=$!
  set -e
  if wait_for_lock 200; then
    echo "stack lock 出现在 kill 前（pid=$bp）" >> "$f"
    kill -0 "$bp" 2>/dev/null && echo "进程仍存活：yes" >> "$f" || echo "进程仍存活：no" >> "$f"
  else
    echo "ERROR: 未在超时内观察到 stack lock" >> "$f"
  fi
  kill -9 "$bp" 2>/dev/null || true
  wait "$bp" 2>/dev/null || true
  sleep 0.3
  { echo "--- kill 后锁目录 ---"; ls -la "$LOCKROOT/$STACK.lock" 2>&1 || true; echo "--- owner ---"; cat "$LOCKROOT/$STACK.lock/owner" 2>&1 || true; } >> "$f"
  run_log 06-down-recover env DEVENV_LOCK_TIMEOUT=10 "$DEVENV" down
  grep -q '持有者已死' "$EV/06-down-recover.err" \
    && echo "失效锁清理警告：yes" >> "$f" || echo "失效锁清理警告：NO" >> "$f"
  run_log 06-up-restore "$DEVENV" up
}

section_07() {
  log "07 故障演练：kill 租约持有进程后恢复"
  local f="$EV/07-kill-lease.txt"
  : > "$f"
  set +e
  "$DEVENV" verify > "$EV/07-verify-killed.log" 2>&1 & local vp=$!
  set -e
  if wait_for_lease 200; then
    echo "租约槽出现在 kill 前（pid=$vp）" >> "$f"
    kill -0 "$vp" 2>/dev/null && echo "进程仍存活：yes" >> "$f" || echo "进程仍存活：no" >> "$f"
  else
    echo "ERROR: 未在超时内观察到租约槽" >> "$f"
  fi
  kill -9 "$vp" 2>/dev/null || true
  wait "$vp" 2>/dev/null || true
  sleep 0.3
  { echo "--- kill 后租约槽 ---"; find "$LOCKROOT/$STACK.lease" -maxdepth 2 -type f -o -type d 2>&1 || true; } >> "$f"
  run_log 07-down-recover env DEVENV_LOCK_TIMEOUT=10 "$DEVENV" down
  grep -q '失效租约' "$EV/07-down-recover.err" \
    && echo "失效租约清理警告：yes" >> "$f" || echo "失效租约清理警告：NO" >> "$f"
  run_log 07-up-restore "$DEVENV" up
  run_log 07-ps-after "$DEVENV" ps -a
}

section_08() {
  log "08 故障反例：持有者仍存活时锁/租约不被误清"
  start_holder lock "$STACK" live-lock
  run_log 08-down-vs-live-lock env DEVENV_LOCK_TIMEOUT=2 "$DEVENV" down
  { echo "live lock 目录仍在："; ls -la "$LOCKROOT/$STACK.lock" 2>&1; } > "$EV/08-live-lock.txt"
  stop_holder live-lock
  start_holder lease "$STACK" live-lease
  run_log 08-down-vs-live-lease env DEVENV_LOCK_TIMEOUT=2 "$DEVENV" down
  { echo "live lease 槽仍在："; find "$LOCKROOT/$STACK.lease" -maxdepth 2 -type f 2>&1; } > "$EV/08-live-lease.txt"
  stop_holder live-lease
}

section_09() {
  log "09 收尾：栈恢复与终态"
  run_log 09-up "$DEVENV" up
  run_log 09-doctor "$DEVENV" doctor
  run_log 09-status "$DEVENV" --json status
  run_log 09-ps "$DEVENV" ps -a
}

summary() {
  {
    echo "# #61 证据运行结果（driver 自动生成）"
    printf '%-40s %s\n' "file" "rc"
    while IFS=$'\t' read -r f rc; do printf '%-40s %s\n' "$f" "$rc"; done < "$RESULTS"
    echo
    echo "expected rc=6 files:"
    awk -F'\t' '$2=="rc=6"{print $1}' "$RESULTS"
  } > "$EV/90-results.txt"
  log "汇总写入 $EV/90-results.txt"
}

SECTIONS="${*:-all}"
if [[ "$SECTIONS" == "all" ]]; then
  SECTIONS="00 02 03 04 05 06 07 08 09"
fi
for s in $SECTIONS; do
  "section_$s"
done
summary