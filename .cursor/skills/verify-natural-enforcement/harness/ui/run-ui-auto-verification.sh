#!/usr/bin/env bash
# 自动核查页面取证。只跑 headless。证据写进本次 .run/verify-* ，不经 WSL 的 /mnt/c。
# 参数：failure 或 layers。由 run-auto-verification.ts 经 VERIFY_UI_HOOK 调用。
set -euo pipefail

ONLY="${1:-${VERIFY_UI_ONLY:-all}}"
ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/../../../../.." && pwd)"
RUN_DIR="${VERIFY_RUN_DIR:-}"
if [[ -z "$RUN_DIR" || ! -f "$RUN_DIR/clue-manifest.json" ]]; then
  echo "[FAIL] VERIFY_RUN_DIR 缺少 clue-manifest.json" >&2
  exit 2
fi

BROWSER_IMAGE='mcr.microsoft.com/playwright:v1.64.1-jammy-amd64@sha256:5eb4ef2b80d9c5af9dccb9155b29be324461c8bbaed41b989db5e86545e7fd38'
if ! grep -qF "$BROWSER_IMAGE" "$ROOT/infra/VERSIONS.md"; then
  echo "[FAIL] browser image not registered in infra/VERSIONS.md" >&2
  exit 1
fi
if ! docker image inspect "$BROWSER_IMAGE" >/dev/null 2>&1; then
  echo "[FAIL] browser image missing; pull once:" >&2
  echo "  docker pull $BROWSER_IMAGE" >&2
  exit 1
fi

UI_DIR="$RUN_DIR/ui/$ONLY"
mkdir -p "$UI_DIR"
cp "$ROOT/.cursor/skills/verify-natural-enforcement/harness/ui/run-ui-auto-verification.cjs" "$UI_DIR/run-ui-auto-verification.cjs"
cp "$RUN_DIR/clue-manifest.json" "$UI_DIR/clue-manifest.json"

BASE_URL_HOST="${BASE_URL:-https://localhost:8080}"
BASE_URL_CTR="${BASE_URL_HOST/localhost/host.docker.internal}"

echo "[ui-auto-verification] only=$ONLY headless evidence=$UI_DIR base=$BASE_URL_CTR"
set +e
docker run --rm \
  --add-host "host.docker.internal:host-gateway" \
  -v "$UI_DIR:/work/evidence" \
  -e "EVIDENCE_DIR=/work/evidence" \
  -e "BASE_URL=$BASE_URL_CTR" \
  -e "VERIFY_UI_ONLY=$ONLY" \
  -e "SEED_PASSWORD=${SEED_PASSWORD:-Seed-pass-52}" \
  -e "HEADED=0" \
  -e "PW_HEADED=0" \
  -e "PLAYWRIGHT_BROWSERS_PATH=/ms-playwright" \
  -e "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1" \
  -e "npm_config_cache=/tmp/npm-cache" \
  "$BROWSER_IMAGE" \
  bash -lc 'cd /work/evidence && npm init -y >/dev/null 2>&1 && npm install --no-fund --no-audit playwright@1.64.1 && node run-ui-auto-verification.cjs'
RC=$?
set -e
echo "[ui-auto-verification] exit=$RC only=$ONLY"
exit "$RC"
