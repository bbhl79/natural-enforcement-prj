#!/usr/bin/env bash
# 自动核查页面取证。只跑 headless。
# Podman machine / Docker Desktop 看不见 WSL home bind-mount：
# 证据与脚本先落 /mnt/c/.../ne-verify-ui 再回拷仓库 .run/（对齐 run-ui-p0.sh）。
# 参数：failure 或 layers。由 run-auto-verification.ts 经 VERIFY_UI_HOOK 调用。
set -euo pipefail

# Podman machine：非登录壳也要接上 DOCKER_HOST（见 ~/.config/podman/docker-env.sh）。
if [ -f "${HOME}/.config/podman/docker-env.sh" ]; then
  # shellcheck disable=SC1091
  . "${HOME}/.config/podman/docker-env.sh"
fi

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
STAGE_ROOT="${VF_UI_STAGE_ROOT:-/mnt/c/Users/bbhl7/AppData/Local/Temp/ne-verify-ui}"
STAGE_DIR="$STAGE_ROOT/auto-verification-$(basename "$RUN_DIR")-$ONLY"
mkdir -p "$UI_DIR" "$STAGE_DIR"
cp "$ROOT/.cursor/skills/verify-natural-enforcement/harness/ui/run-ui-auto-verification.cjs" "$STAGE_DIR/run-ui-auto-verification.cjs"
cp "$ROOT/.cursor/skills/verify-natural-enforcement/harness/auth-gate.cjs" "$STAGE_DIR/auth-gate.cjs"
cp "$RUN_DIR/clue-manifest.json" "$STAGE_DIR/clue-manifest.json"

BASE_URL_HOST="${BASE_URL:-https://localhost:8080}"
BASE_URL_CTR="$BASE_URL_HOST"
case "$BASE_URL_CTR" in
  https://localhost:*|http://localhost:*)
    BASE_URL_CTR="${BASE_URL_CTR/localhost/host.docker.internal}"
    ;;
esac

# Podman machine / Docker Desktop + WSL2：用 WSL eth0 IP，不用 Windows 默认网关。
HOST_IP="${VF_HOST_IP:-$(ip -4 addr show eth0 | awk '/inet /{print $2}' | cut -d/ -f1)}"
if [[ -z "$HOST_IP" ]]; then
  echo "[FAIL] cannot resolve WSL eth0 IPv4 for host.docker.internal" >&2
  exit 1
fi

# shellcheck source=../transport-gate.sh
. "$ROOT/.cursor/skills/verify-natural-enforcement/harness/transport-gate.sh"
verify_transport_or_block "$BASE_URL_CTR" "$HOST_IP"

echo "[ui-auto-verification] only=$ONLY headless stage=$STAGE_DIR evidence=$UI_DIR base=$BASE_URL_CTR host=$HOST_IP"
LOGIN_ENV=()
if [[ -n "${VERIFY_LOGIN_PASSWORD:-}" ]]; then
  LOGIN_ENV+=(-e "VERIFY_LOGIN_PASSWORD=${VERIFY_LOGIN_PASSWORD}")
fi
set +e
docker run --rm \
  --add-host "host.docker.internal:${HOST_IP}" \
  -v "$STAGE_DIR:/work/evidence" \
  -e "EVIDENCE_DIR=/work/evidence" \
  -e "BASE_URL=$BASE_URL_CTR" \
  -e "VERIFY_UI_ONLY=$ONLY" \
  -e "SEED_PASSWORD=${SEED_PASSWORD:-Seed-pass-52}" \
  -e "HEADED=0" \
  -e "PW_HEADED=0" \
  -e "PLAYWRIGHT_BROWSERS_PATH=/ms-playwright" \
  -e "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1" \
  -e "npm_config_cache=/tmp/npm-cache" \
  "${LOGIN_ENV[@]}" \
  "$BROWSER_IMAGE" \
  bash -lc 'cd /work/evidence && npm init -y >/dev/null 2>&1 && npm install --no-fund --no-audit playwright@1.64.1 && node run-ui-auto-verification.cjs'
RC=$?
set -e

if command -v rsync >/dev/null 2>&1; then
  rsync -a --exclude node_modules --exclude package-lock.json --exclude package.json "$STAGE_DIR/" "$UI_DIR/"
else
  # 无 rsync 时用 tar 回拷，仍避开 WSL home bind。
  tar -C "$STAGE_DIR" --exclude=node_modules --exclude=package-lock.json --exclude=package.json -cf - . \
    | tar -C "$UI_DIR" -xf -
fi
echo "[ui-auto-verification] exit=$RC only=$ONLY evidence=$UI_DIR"
exit "$RC"
