#!/usr/bin/env bash
# 用途：提供传输门禁函数，地址偏离或不可达时使调用方停止。
# 用法：由其他验证脚本 source 后调用 verify_transport_or_block <URL> [探测 IP]。
# 退出码：函数返回 transport-gate.cjs 的退出码；0 可达，1 偏离或不可达，2 缺少地址。
# 传输门禁。地址偏离或不可达则退出。本文件不加入 compose 网络。
set -euo pipefail

# 调用传输门禁脚本；地址偏离或不可达时返回非零，由调用方决定停止。
verify_transport_or_block() {
  local url="$1"
  local probe_ip="${2:-}"
  local gate
  gate="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)/transport-gate.cjs"
  node "$gate" "$url" "$probe_ip"
}
