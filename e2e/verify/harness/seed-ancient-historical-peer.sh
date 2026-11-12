#!/usr/bin/env bash
# 用途：把超长期 transferred_out peer 写入当前开发库，只插入、不改写已有行。
# 用法：bash e2e/verify/harness/seed-ancient-historical-peer.sh [--check]
# 退出码：0 成功；1 校验或播种失败。
# 把超长期 transferred_out peer 写入当前开发库。
# 只插入。不改写已有行的时间戳。
# 前置：./dev up 已完成。开发种子里已有 P-CLERK-A 与 ORG-DEPT-A。
set -euo pipefail

if [ -f "${HOME}/.config/podman/docker-env.sh" ]; then
  # shellcheck disable=SC1091
  . "${HOME}/.config/podman/docker-env.sh"
fi

ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/../../.." && pwd)"
cd "$ROOT"
exec node "$ROOT/e2e/verify/harness/seed-ancient-historical-peer.mjs" "$@"
