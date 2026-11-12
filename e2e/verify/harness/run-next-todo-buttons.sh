#!/usr/bin/env bash
# 用途：下一待办按钮的验证入口，先跑 API 矩阵，再按 manifest 跑 headless 页面取证。
# 用法：bash e2e/verify/harness/run-next-todo-buttons.sh
# 退出码：0 全绿；1 API 或页面失败、blocked，或本机没有 docker。
# 下一待办按钮：API 矩阵 + headless 页面。
# 不改产品权限。不叠假图层。不改产品编排。
set -euo pipefail

ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/../../.." && pwd)"
cd "$ROOT"
RUN_ID="${VERIFY_RUN_ID:-$(TZ=Asia/Shanghai date +%Y%m%dT%H%M%S)-next-todo-buttons}"
RUN_DIR="$ROOT/e2e/results/verify-${RUN_ID}"
mkdir -p "$RUN_DIR"
CERT="${HOME}/.local/share/natural-enforcement/dev-certs/localhost.crt"

echo "[next-todo-buttons] run=$RUN_DIR"
if ! command -v docker >/dev/null 2>&1; then
  echo "[FAIL] 本机没有 docker" | tee "$RUN_DIR/stack-blocked.txt"
  exit 1
fi

./dev up

export NODE_EXTRA_CA_CERTS="$CERT"
export VERIFY_BASE_URL="${VERIFY_BASE_URL:-https://localhost:8080}"
export VERIFY_SPATIAL_SALT="$RUN_ID"
# shellcheck source=transport-gate.sh
. "$ROOT/e2e/verify/harness/transport-gate.sh"
verify_transport_or_block "$VERIFY_BASE_URL" ""
set +e
node --experimental-transform-types --disable-warning=ExperimentalWarning \
  "$ROOT/e2e/verify/harness/run-next-todo-buttons.ts" \
  --run-id "$RUN_ID"
API_RC=$?
set -e

SUMMARY="$RUN_DIR/summary.json"
if [[ -f "$SUMMARY" ]]; then
  STATUS="$(node -e 'const fs=require("node:fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(String(s.status??""));' "$SUMMARY")"
  if [[ "$STATUS" == "blocked" ]]; then
    echo "[next-todo-buttons] summary=blocked 停止。不启动页面取证。" >&2
    exit 1
  fi
fi

MANIFEST="$RUN_DIR/clue-manifest.json"
UI_RC=0
if [[ -f "$MANIFEST" ]]; then
  set +e
  VERIFY_RUN_DIR="$RUN_DIR" \
    "$ROOT/e2e/verify/harness/ui/run-ui-next-todo-buttons.sh" \
    "$MANIFEST"
  UI_RC=$?
  set -e
fi
if [[ "$API_RC" -ne 0 || "$UI_RC" -ne 0 ]]; then
  echo "[next-todo-buttons] api=$API_RC ui=$UI_RC" >&2
  exit 1
fi
