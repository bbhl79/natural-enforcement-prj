#!/usr/bin/env bash
# #61 证据辅助：以真实锁库入口持有排他锁或共享租约，直到 STOP 文件出现。
# 用途：让冲突窗口确定（被阻塞一侧始终是真实 devenv 命令）；
#       真实 verify/build 持有者在 02/06/07 章节单独覆盖。
# 用法：ne61-hold.sh <lock|lease> <锁名> <READY文件> <STOP文件> <仓库根> [最长秒]
set -Eeuo pipefail
MODE="$1"; NAME="$2"; READY="$3"; STOP="$4"; REPO="$5"; MAX="${6:-600}"
REPO_ROOT="$REPO"
# shellcheck source=/dev/null
source "$REPO/devenv/lib/output.sh"
# shellcheck source=/dev/null
source "$REPO/devenv/lib/lock.sh"
# shellcheck source=/dev/null
source "$REPO/devenv/lib/snapshot.sh"
# shellcheck source=/dev/null
source "$REPO/devenv/lib/stack.sh"
trap 'lease_release_all; lock_release_all' EXIT
if [[ "$MODE" == lease ]]; then
  lease_acquire "$NAME" 10
else
  lock_acquire "$NAME" 10
fi
printf 'pid=%s mode=%s name=%s lockroot=%s\n' "$$" "$MODE" "$NAME" "$LOCK_ROOT" > "$READY"
waited=0
while [[ ! -f "$STOP" && "$waited" -lt "$MAX" ]]; do
  sleep 1; waited=$((waited + 1))
done