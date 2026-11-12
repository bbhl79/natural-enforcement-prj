#!/usr/bin/env bash
# 用途：只读检查身份准备的前后快照，不连接数据库、不重启服务。
# 用法：check-identity-prep.sh <快照目录>
# 退出码：0 通过；1 校验失败；2 用法错误。
# 只读检查身份准备的前后快照。不连接数据库。不重启服务。不清 Redis。
set -euo pipefail
if [[ $# -ne 1 ]]; then
  echo "[FAIL] 用法: check-identity-prep.sh <快照目录>" >&2
  exit 2
fi
ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
node "$ROOT/check-identity-prep.cjs" "$1"
