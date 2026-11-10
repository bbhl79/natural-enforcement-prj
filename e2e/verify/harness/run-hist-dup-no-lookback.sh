#!/usr/bin/env bash
# 无回溯上限样本。
# 顺序：./dev up → 播种超长期 peer → 登记重叠面 → 读 historicalGroups。
# 不改产品时间戳。不清 Redis。不改运行中的时钟。
set -euo pipefail

if [ -f "${HOME}/.config/podman/docker-env.sh" ]; then
  # shellcheck disable=SC1091
  . "${HOME}/.config/podman/docker-env.sh"
fi

if [ -x "${HOME}/.local/node-v24.21.0/bin/node" ]; then
  export PATH="${HOME}/.local/node-v24.21.0/bin:${PATH}"
fi

ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/../../.." && pwd)"
cd "$ROOT"
RUN_ID="${VERIFY_RUN_ID:-$(TZ=Asia/Shanghai date +%Y%m%dT%H%M%S)-hist-dup-no-lookback}"
RUN_DIR="$ROOT/e2e/results/verify-${RUN_ID}"
mkdir -p "$RUN_DIR"
export VERIFY_RUN_DIR="$RUN_DIR"
CERT="${HOME}/.local/share/natural-enforcement/dev-certs/localhost.crt"

echo "[hist-dup-no-lookback] run=$RUN_DIR"
if ! command -v docker >/dev/null 2>&1; then
  echo "[FAIL] 本机没有 docker" | tee "$RUN_DIR/stack-blocked.txt"
  exit 1
fi

./dev up
"$ROOT/e2e/verify/harness/seed-ancient-historical-peer.sh"

if [ -f "$CERT" ]; then
  export NODE_EXTRA_CA_CERTS="$CERT"
fi
export VERIFY_BASE_URL="${VERIFY_BASE_URL:-https://localhost:8080}"
# shellcheck source=transport-gate.sh
. "$ROOT/e2e/verify/harness/transport-gate.sh"
if ! verify_transport_or_block "$VERIFY_BASE_URL" ""; then
  node -e 'const fs=require("node:fs"); fs.writeFileSync(process.env.VERIFY_RUN_DIR+"/summary.json", JSON.stringify({verdict:"blocked",kind:"blocked-transport",anyAncientPeerInHist:false,noLookbackVerified:false},null,2)+"\n");'
  exit 1
fi

node --experimental-transform-types --disable-warning=ExperimentalWarning \
  --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
  "$ROOT/e2e/verify/harness/probe-hist-dup-no-lookback.ts"
