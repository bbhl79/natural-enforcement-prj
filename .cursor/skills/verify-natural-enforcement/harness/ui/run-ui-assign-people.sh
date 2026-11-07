#!/usr/bin/env bash
# 承办机构内勤点击「派出承办人」直到 handler_assigned。默认 headless。
# 证据先写入 .run/verify-assign-people-*，再用 cp 复制到工作区 artifacts/。不用 rsync。
set -euo pipefail
ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/../../../../.." && pwd)"
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

RUN_ID="${VERIFY_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-uid$(head -c 2 /dev/urandom | od -An -tx1 | tr -d ' ')}"
EVIDENCE_HOST="$ROOT/.run/verify-assign-people-${RUN_ID}"
mkdir -p "$EVIDENCE_HOST/evidence"

BASE_URL_HOST="${BASE_URL:-https://localhost:8080}"
BASE_URL_CTR="$BASE_URL_HOST"
case "$BASE_URL_CTR" in
  https://localhost:*|http://localhost:*)
    BASE_URL_CTR="${BASE_URL_CTR/localhost/host.docker.internal}"
    ;;
esac

echo "[ui-assign-people] headless evidence=$EVIDENCE_HOST base=$BASE_URL_CTR"
set +e
docker run --rm \
  --add-host "host.docker.internal:host-gateway" \
  -v "$EVIDENCE_HOST:/work/evidence" \
  -v "$ROOT/.cursor/skills/verify-natural-enforcement/harness/ui/run-ui-assign-people.cjs:/work/run-ui-assign-people.cjs:ro" \
  -e EVIDENCE_DIR=/work/evidence \
  -e "BASE_URL=$BASE_URL_CTR" \
  -e "SEED_PASSWORD=${SEED_PASSWORD:-Seed-pass-52}" \
  -e "VERIFY_NEW_PASSWORD=${VERIFY_NEW_PASSWORD:-Verify-assign-52!}" \
  -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  -e PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
  -e NODE_TLS_REJECT_UNAUTHORIZED=0 \
  -e npm_config_cache=/tmp/npm-cache \
  "$BROWSER_IMAGE" \
  bash -lc 'mkdir -p /tmp/pw && cd /tmp/pw && npm init -y >/dev/null 2>&1 && npm install --no-fund --no-audit playwright@1.64.1 && NODE_PATH=/tmp/pw/node_modules node /work/run-ui-assign-people.cjs'
RC=$?
set -e

ARTIFACT_DIR="$ROOT/artifacts/assign-people-${RUN_ID}"
mkdir -p "$ARTIFACT_DIR"
cp -r "$EVIDENCE_HOST/." "$ARTIFACT_DIR/"
if [ -d /opt/cursor/artifacts ]; then
  mkdir -p "/opt/cursor/artifacts/assign-people-${RUN_ID}"
  cp -r "$EVIDENCE_HOST/." "/opt/cursor/artifacts/assign-people-${RUN_ID}/" || true
fi
echo "[ui-assign-people] exit=$RC evidence=$EVIDENCE_HOST artifacts=$ARTIFACT_DIR"
exit "$RC"
