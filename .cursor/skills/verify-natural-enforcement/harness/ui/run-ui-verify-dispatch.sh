#!/usr/bin/env bash
# Verification step2／step3 UI 探活 — Playwright in pinned MCR image (headless default).
# Docker Desktop 看不见 WSL home bind-mount：证据先落 /mnt/c/... 再拷回仓库 .run/。
# Usage:
#   CLUE_ID=<id> .cursor/skills/verify-natural-enforcement/harness/ui/run-ui-verify-dispatch.sh
#   CLUE_ID=<id> EXPECT_STATUS=in_pool .../run-ui-verify-dispatch.sh
#   HEADED=1 / PW_HEADED=1 / --headed  （默认 headless）
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

HEADED_FLAG=0
for arg in "$@"; do
  case "$arg" in
    --headed) HEADED_FLAG=1 ;;
  esac
done
if [[ "${HEADED:-0}" == "1" || "${PW_HEADED:-0}" == "1" ]]; then
  HEADED_FLAG=1
fi

RUN_ID="${VERIFY_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-uid$(head -c 2 /dev/urandom | od -An -tx1 | tr -d ' ')}"
EVIDENCE_HOST="$ROOT/.run/verify-${RUN_ID}"
STAGE_ROOT="${VF_UI_STAGE_ROOT:-/mnt/c/Users/bbhl7/AppData/Local/Temp/ne-verify-ui}"
STAGE_DIR="$STAGE_ROOT/verify-${RUN_ID}"
mkdir -p "$EVIDENCE_HOST/evidence" "$EVIDENCE_HOST/steps" "$STAGE_DIR/evidence" "$STAGE_DIR/steps"
cp "$ROOT/.cursor/skills/verify-natural-enforcement/harness/ui/run-ui-verify-dispatch.cjs" "$STAGE_DIR/run-ui-verify-dispatch.cjs"

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

DOCKER_ARGS=(
  --rm
  --add-host "host.docker.internal:${HOST_IP}"
  -v "$STAGE_DIR:/work/evidence"
  -e "EVIDENCE_DIR=/work/evidence"
  -e "UI_SCENARIO_ID=${UI_SCENARIO_ID:-}"
  -e "BASE_URL=$BASE_URL_CTR"
  -e "SEED_PASSWORD=${SEED_PASSWORD:-Seed-pass-52}"
  -e "VERIFY_MOBILE=${VERIFY_MOBILE:-13800001002}"
  -e "CLUE_ID=${CLUE_ID:-}"
  -e "UI_CLICK_WRITE=${UI_CLICK_WRITE:-1}"
  -e "ASSIGN_ORG_NAME=${ASSIGN_ORG_NAME:-第一执法支队}"
  -e "VERIFY_NEW_PASSWORD=${VERIFY_NEW_PASSWORD:-Verify-skill-loop-52!}"
  -e "EXPECT_STATUS=${EXPECT_STATUS:-}"
  -e "HEADED=$HEADED_FLAG"
  -e "PW_HEADED=$HEADED_FLAG"
)

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

echo "[ui-verify-dispatch] mode=$([[ $HEADED_FLAG == 1 ]] && echo headed || echo headless) clue=${CLUE_ID:-<none>} stage=$STAGE_DIR evidence=$EVIDENCE_HOST base=$BASE_URL_CTR"
set +e
docker run "${DOCKER_ARGS[@]}" "$BROWSER_IMAGE" \
  bash -lc 'cd /work/evidence && npm init -y >/dev/null 2>&1 && npm install --no-fund --no-audit playwright@1.64.1 && node run-ui-verify-dispatch.cjs'
RC=$?
set -e

# copy evidence back into repo .run (gitignored)
rsync -a --exclude node_modules --exclude package-lock.json --exclude package.json "$STAGE_DIR/" "$EVIDENCE_HOST/"
echo "[ui-verify-dispatch] exit=$RC summary=$EVIDENCE_HOST/summary.json mode=$([[ $HEADED_FLAG == 1 ]] && echo headed || echo headless) runner=docker-playwright-on-wsl-via-/mnt/c"
exit "$RC"