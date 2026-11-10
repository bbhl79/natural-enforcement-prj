#!/usr/bin/env bash
# 下一待办按钮的 headless 页面。证据先落阶段目录，再拷回 e2e/results。
# 没有 rsync 时用 cp。
set -euo pipefail
ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/../../../.." && pwd)"
MANIFEST="${1:-${CLUE_MANIFEST:-}}"
if [[ -z "$MANIFEST" || ! -f "$MANIFEST" ]]; then
  echo "[FAIL] 需要 clue-manifest.json 路径" >&2
  exit 1
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

RUN_DIR="${VERIFY_RUN_DIR:-$(cd "$(dirname "$MANIFEST")" && pwd)}"
EVIDENCE_HOST="$RUN_DIR/ui"
STAGE_ROOT="${VF_UI_STAGE_ROOT:-/tmp/ne-verify-ui}"
STAGE_DIR="$STAGE_ROOT/next-todo-buttons-$(date +%H%M%S)-$$"
mkdir -p "$EVIDENCE_HOST/evidence" "$EVIDENCE_HOST/steps" "$STAGE_DIR/evidence" "$STAGE_DIR/steps"
cp "$ROOT/e2e/verify/harness/ui/run-ui-next-todo-buttons.cjs" "$STAGE_DIR/run-ui-next-todo-buttons.cjs"
cp "$ROOT/e2e/verify/harness/auth-gate.cjs" "$STAGE_DIR/auth-gate.cjs"
cp "$MANIFEST" "$STAGE_DIR/clue-manifest.json"

BASE_URL_HOST="${BASE_URL:-https://localhost:8080}"
BASE_URL_CTR="$BASE_URL_HOST"
case "$BASE_URL_CTR" in
  https://localhost:*|http://localhost:*)
    BASE_URL_CTR="${BASE_URL_CTR/localhost/host.docker.internal}"
    ;;
esac

echo "[ui-next-todo-buttons] headless stage=$STAGE_DIR evidence=$EVIDENCE_HOST base=$BASE_URL_CTR"
HOST_IP="${VF_HOST_IP:-$(ip -4 addr show eth0 2>/dev/null | awk '/inet /{print $2}' | cut -d/ -f1)}"
if [[ -z "$HOST_IP" ]]; then
  echo "[BLOCKED] host.docker.internal 缺少可达的 VF_HOST_IP。停止。" >&2
  exit 1
fi
# shellcheck source=../transport-gate.sh
. "$ROOT/e2e/verify/harness/transport-gate.sh"
verify_transport_or_block "$BASE_URL_CTR" "$HOST_IP"
LOGIN_ENV=()
if [[ -n "${VERIFY_LOGIN_PASSWORD:-}" ]]; then
  LOGIN_ENV+=(-e "VERIFY_LOGIN_PASSWORD=${VERIFY_LOGIN_PASSWORD}")
fi
set +e
docker run --rm \
  --add-host "host.docker.internal:${HOST_IP}" \
  -v "$STAGE_DIR:/work/evidence" \
  -e "EVIDENCE_DIR=/work/evidence" \
  -e "MANIFEST=/work/evidence/clue-manifest.json" \
  -e "BASE_URL=$BASE_URL_CTR" \
  -e "SEED_PASSWORD=${SEED_PASSWORD:-Seed-pass-52}" \
  -e "VERIFY_NEW_PASSWORD=${VERIFY_NEW_PASSWORD:-Verify-skill-loop-52!}" \
  -e "HEADED=0" \
  -e "PLAYWRIGHT_BROWSERS_PATH=/ms-playwright" \
  -e "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1" \
  -e "npm_config_cache=/tmp/npm-cache" \
  "${LOGIN_ENV[@]}" \
  "$BROWSER_IMAGE" \
  bash -lc 'cd /work/evidence && npm init -y >/dev/null 2>&1 && npm install --no-fund --no-audit playwright@1.64.1 && node run-ui-next-todo-buttons.cjs'
RC=$?
set -e

mkdir -p "$EVIDENCE_HOST/evidence" "$EVIDENCE_HOST/steps"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --exclude node_modules --exclude package-lock.json --exclude package.json "$STAGE_DIR/" "$EVIDENCE_HOST/"
else
  cp -a "$STAGE_DIR/summary.json" "$EVIDENCE_HOST/summary.json" 2>/dev/null || true
  cp -a "$STAGE_DIR/steps/." "$EVIDENCE_HOST/steps/"
  cp -a "$STAGE_DIR/evidence/." "$EVIDENCE_HOST/evidence/"
fi
echo "[ui-next-todo-buttons] exit=$RC summary=$EVIDENCE_HOST/summary.json"
exit "$RC"
