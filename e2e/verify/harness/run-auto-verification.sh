#!/usr/bin/env bash
# 用途：开发栈上的自动核查验证入口，串联协议自检、两阶段 API 跑次与页面取证。
# 用法：bash e2e/verify/harness/run-auto-verification.sh
# 退出码：0 全绿；1 失败、blocked 或本机没有 docker。
# 云端或本机开发栈上的自动核查验证入口。
# 顺序：协议自检 → dev up → 空地址失败路径（含当时的页面）→ 假图层成功／部分命中／疑似重复（含页面）→ 卸掉 overlay。
# 页面只用 headless。证据在 e2e/results/verify-<日期>-auto-verification-dev-layers/。
set -euo pipefail

# Podman machine：非登录壳也要接上 DOCKER_HOST（见 ~/.config/podman/docker-env.sh）。
if [ -f "${HOME}/.config/podman/docker-env.sh" ]; then
  # shellcheck disable=SC1091
  . "${HOME}/.config/podman/docker-env.sh"
fi

# 宿主 apt 可能是 Node 22（无 --experimental-transform-types）。优先本机钉定的 Node 24。
if [ -x "${HOME}/.local/node-v24.21.0/bin/node" ]; then
  export PATH="${HOME}/.local/node-v24.21.0/bin:${PATH}"
fi

ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/../../.." && pwd)"
cd "$ROOT"
RUN_ID="${VERIFY_RUN_ID:-$(TZ=Asia/Shanghai date +%Y%m%d)-auto-verification-dev-layers}"
RUN_DIR="$ROOT/e2e/results/verify-${RUN_ID}"
mkdir -p "$RUN_DIR"
HOOK="$ROOT/e2e/verify/harness/ui/run-ui-auto-verification.sh"
OVERLAY="$ROOT/e2e/verify/harness/layers/apply-layer-overlay.sh"
CERT="${HOME}/.local/share/natural-enforcement/dev-certs/localhost.crt"

echo "[auto-verification] run=$RUN_DIR host=$(uname -a)"
node --experimental-transform-types --disable-warning=ExperimentalWarning \
  "$ROOT/e2e/verify/harness/layers/protocol-self-check.mjs" \
  >"$RUN_DIR/protocol-self-check.json"

if ! command -v docker >/dev/null 2>&1; then
  echo "[FAIL] 本机没有 docker，业务栈未启动" | tee "$RUN_DIR/stack-blocked.txt"
  exit 1
fi

./dev up
TOUCHED=1
# 退出时恢复产品 compose；仅在已执行 dev up 后动作，并沿用原退出码。
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
# shellcheck source=transport-gate.sh
. "$ROOT/e2e/verify/harness/transport-gate.sh"
verify_transport_or_block "$VERIFY_BASE_URL" ""
export VERIFY_UI_HOOK="$HOOK"
node --experimental-transform-types --disable-warning=ExperimentalWarning \
  "$ROOT/e2e/verify/harness/run-auto-verification.ts" \
  --run-id "$RUN_ID"
