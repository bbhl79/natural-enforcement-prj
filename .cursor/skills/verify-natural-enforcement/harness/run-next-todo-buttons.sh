#!/usr/bin/env bash
# 下一待办按钮：API 矩阵 + headless 页面。不改业务权限，不改工作台过滤。
set -euo pipefail

ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/../../../.." && pwd)"
cd "$ROOT"
RUN_ID="${VERIFY_RUN_ID:-$(TZ=Asia/Shanghai date +%Y%m%dT%H%M)-next-todo-buttons}"
RUN_DIR="$ROOT/.run/verify-${RUN_ID}"
mkdir -p "$RUN_DIR"
CERT="${HOME}/.local/share/natural-enforcement/dev-certs/localhost.crt"

echo "[next-todo-buttons] run=$RUN_DIR"
if ! command -v docker >/dev/null 2>&1; then
  echo "[FAIL] 本机没有 docker" | tee "$RUN_DIR/stack-blocked.txt"
  exit 1
fi

OVERLAY="$ROOT/.cursor/skills/verify-natural-enforcement/harness/layers/apply-layer-overlay.sh"
./dev up
# 产品 compose 不把对象存储参数送进 server。登记空间文件会 500。
# 这里只叠既有验证运行时补丁，不改产品编排，不接假图层。结束时卸掉。
bash "$OVERLAY" off
TOUCHED=1
restore() {
  local rc=$?
  if [[ "$TOUCHED" == "1" ]]; then
    bash "$OVERLAY" restore || echo "[WARN] 恢复产品 compose 失败" >&2
  fi
  exit "$rc"
}
trap restore EXIT

export NODE_EXTRA_CA_CERTS="$CERT"
export VERIFY_BASE_URL="${VERIFY_BASE_URL:-https://localhost:8080}"
set +e
node --experimental-transform-types --disable-warning=ExperimentalWarning \
  "$ROOT/.cursor/skills/verify-natural-enforcement/harness/run-next-todo-buttons.ts" \
  --run-id "$RUN_ID"
API_RC=$?
set -e

MANIFEST="$RUN_DIR/clue-manifest.json"
UI_RC=0
if [[ -f "$MANIFEST" ]]; then
  set +e
  VERIFY_RUN_DIR="$RUN_DIR" \
    "$ROOT/.cursor/skills/verify-natural-enforcement/harness/ui/run-ui-next-todo-buttons.sh" \
    "$MANIFEST"
  UI_RC=$?
  set -e
fi
if [[ "$API_RC" -ne 0 || "$UI_RC" -ne 0 ]]; then
  echo "[next-todo-buttons] api=$API_RC ui=$UI_RC" >&2
  exit 1
fi
