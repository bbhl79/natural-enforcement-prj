#!/usr/bin/env bash
# 传输门禁。地址偏离或不可达则退出。本文件不加入 compose 网络。
set -euo pipefail

verify_transport_or_block() {
  local url="$1"
  local probe_ip="${2:-}"
  local gate
  gate="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)/transport-gate.cjs"
  node "$gate" "$url" "$probe_ip"
}
