#!/usr/bin/env bash
# 云端或本机开发栈上的自动核查验证入口。
# 顺序：协议自检 → dev up → 空地址失败路径（含当时的页面）→ 假图层成功／部分命中／疑似重复（含页面）→ 卸掉 overlay。
# 页面只用 headless。证据在 .run/verify-<日期>-auto-verification-dev-layers/。
set -euo pipefail

ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/../../../.." && pwd)"
cd "$ROOT"
RUN_ID="${VERIFY_RUN_ID:-$(TZ=Asia/Shanghai date +%Y%m%d)-auto-verification-dev-layers}"
RUN_DIR="$ROOT/.run/verify-${RUN_ID}"
mkdir -p "$RUN_DIR"
HOOK="$ROOT/.cursor/skills/verify-natural-enforcement/harness/ui/run-ui-auto-verification.sh"
OVERLAY="$ROOT/.cursor/skills/verify-natural-enforcement/harness/layers/apply-layer-overlay.sh"
CERT="${HOME}/.local/share/natural-enforcement/dev-certs/localhost.crt"

echo "[auto-verification] run=$RUN_DIR host=$(uname -a)"
node --experimental-transform-types --disable-warning=ExperimentalWarning \
  "$ROOT/.cursor/skills/verify-natural-enforcement/harness/layers/protocol-self-check.mjs" \
  >"$RUN_DIR/protocol-self-check.json"

if ! command -v docker >/dev/null 2>&1; then
  echo "[FAIL] 本机没有 docker，业务栈未启动" | tee "$RUN_DIR/stack-blocked.txt"
  exit 1
fi

./dev up
TOUCHED=1
restore() {
  local rc=$?
  if [[ "$TOUCHED" == "1" ]]; then
    bash "$OVERLAY" restore || echo "[WARN] 恢复产品 compose 失败，server 可能仍带着验证补丁" >&2
  fi
  exit "$rc"
}
trap restore EXIT

export NODE_EXTRA_CA_CERTS="$CERT"
export VERIFY_BASE_URL="${VERIFY_BASE_URL:-https://localhost:8080}"
export VERIFY_UI_HOOK="$HOOK"
node --experimental-transform-types --disable-warning=ExperimentalWarning \
  "$ROOT/.cursor/skills/verify-natural-enforcement/harness/run-auto-verification.ts" \
  --run-id "$RUN_ID"
