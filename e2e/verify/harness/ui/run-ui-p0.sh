#!/usr/bin/env bash
# Verification UI P0 runner — Playwright in pinned MCR image (headless default).
# Docker Desktop 看不见 WSL home bind-mount：证据先落 /mnt/c/... 再拷回仓库 e2e/results/。
# Usage:
#   e2e/verify/harness/ui/run-ui-p0.sh
#   HEADED=1 / PW_HEADED=1 / --headed  （本轮 USER LOCK＝B 不用）
#   UI_FILL=1
set -euo pipefail
ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/../../../.." && pwd)"
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

HEADED_FLAG=0
for arg in "$@"; do
  case "$arg" in
    --headed) HEADED_FLAG=1 ;;
  esac
done
if [[ "${HEADED:-0}" == "1" || "${PW_HEADED:-0}" == "1" ]]; then
  HEADED_FLAG=1
fi

RUN_ID="${VERIFY_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-ui$(head -c 2 /dev/urandom | od -An -tx1 | tr -d ' ')}"
EVIDENCE_HOST="$ROOT/e2e/results/verify-${RUN_ID}"
# Docker-visible staging (Windows path via /mnt/c)
STAGE_ROOT="${VF_UI_STAGE_ROOT:-/mnt/c/Users/bbhl7/AppData/Local/Temp/ne-verify-ui}"
STAGE_DIR="$STAGE_ROOT/verify-${RUN_ID}"
mkdir -p "$EVIDENCE_HOST/evidence" "$EVIDENCE_HOST/steps" "$STAGE_DIR/evidence" "$STAGE_DIR/steps"
cp "$ROOT/e2e/verify/harness/ui/run-ui-p0.cjs" "$STAGE_DIR/run-ui-p0.cjs"
cp "$ROOT/e2e/verify/harness/auth-gate.cjs" "$STAGE_DIR/auth-gate.cjs"

cp "$ROOT/e2e/verify/harness/ui/register-full.cjs" "$STAGE_DIR/register-full.cjs"
cp "$ROOT/e2e/verify/fixtures/journeys/register-full-click-write/input.json" "$STAGE_DIR/register-full-input.json"

BASE_URL_HOST="${BASE_URL:-https://localhost:8080}"
BASE_URL_CTR="$BASE_URL_HOST"
case "$BASE_URL_CTR" in
  https://localhost:*|http://localhost:*)
    BASE_URL_CTR="${BASE_URL_CTR/localhost/host.docker.internal}"
    ;;
esac

# Docker Desktop + WSL2: published ports reachable via WSL eth0 IP, not Windows default GW.
HOST_IP="${VF_HOST_IP:-$(ip -4 addr show eth0 | awk "/inet /{print \$2}" | cut -d/ -f1)}"
if [[ -z "$HOST_IP" ]]; then
  echo "[FAIL] cannot resolve WSL eth0 IPv4 for host.docker.internal" >&2
  exit 1
fi

# shellcheck source=../transport-gate.sh
. "$ROOT/e2e/verify/harness/transport-gate.sh"
verify_transport_or_block "$BASE_URL_CTR" "$HOST_IP"

DOCKER_ARGS=(
  --rm
  --add-host "host.docker.internal:${HOST_IP}"
  -v "$STAGE_DIR:/work/evidence"
  -e "EVIDENCE_DIR=/work/evidence"
  -e "UI_SCENARIO_ID=${UI_SCENARIO_ID:-}"
  -e "BASE_URL=$BASE_URL_CTR"
  -e "SEED_PASSWORD=${SEED_PASSWORD:-Seed-pass-52}"
  -e "UI_FILL=${UI_FILL:-0}"
  -e "UI_SUBMIT=${UI_SUBMIT:-0}"
  -e "VERIFY_NEW_PASSWORD=${VERIFY_NEW_PASSWORD:-Verify-skill-loop-52!}"
  -e "VERIFY_MOBILE=${VERIFY_MOBILE:-13800001002}"
  -e "HEADED=$HEADED_FLAG"
  -e "PW_HEADED=$HEADED_FLAG"
)

if [[ -n "${VERIFY_LOGIN_PASSWORD:-}" ]]; then
  DOCKER_ARGS+=(-e "VERIFY_LOGIN_PASSWORD=${VERIFY_LOGIN_PASSWORD}")
fi

if [[ "$HEADED_FLAG" == "1" ]]; then
  DOCKER_ARGS+=(-e "DISPLAY=${DISPLAY:-:0}")
  if [[ -d /mnt/wslg ]]; then
    DOCKER_ARGS+=(-v /mnt/wslg:/mnt/wslg -v /tmp/.X11-unix:/tmp/.X11-unix)
  fi
fi

DOCKER_ARGS+=(
  -e "PLAYWRIGHT_BROWSERS_PATH=/ms-playwright"
  -e "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1"
  -e "npm_config_cache=/tmp/npm-cache"
)

echo "[ui-p0] mode=$([[ $HEADED_FLAG == 1 ]] && echo headed || echo headless) stage=$STAGE_DIR evidence=$EVIDENCE_HOST base=$BASE_URL_CTR"
set +e
docker run "${DOCKER_ARGS[@]}" "$BROWSER_IMAGE" \
  bash -lc 'cd /work/evidence && npm init -y >/dev/null 2>&1 && npm install --no-fund --no-audit playwright@1.64.1 && node run-ui-p0.cjs'
RC=$?
set -e

# copy evidence back into repo e2e/results (gitignored)
rsync -a --exclude node_modules --exclude package-lock.json --exclude package.json "$STAGE_DIR/" "$EVIDENCE_HOST/"
echo "[ui-p0] exit=$RC summary=$EVIDENCE_HOST/summary.json mode=$([[ $HEADED_FLAG == 1 ]] && echo headed || echo headless) runner=docker-playwright-on-wsl-via-/mnt/c"
exit "$RC"
