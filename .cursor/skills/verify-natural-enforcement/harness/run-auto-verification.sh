#!/usr/bin/env bash
# 云端或本机开发栈上的自动核查验证入口。
# 缺省顺序：协议自检 → dev up → 空地址失败路径（含当时的页面）→ 假图层成功／部分命中／疑似重复（含页面）→ 卸掉 overlay。
# VERIFY_PHASE=journey：先跑隔离门禁。未通过则 blocked，不调用 ./dev up。
# 基础编排保留 NE_SOURCE_GATE_ALLOWED_SOURCES。VERIFY_FAULT 不在基础编排里。
# 页面只用 headless。证据在 .run/verify-<runId>/。发现器报告在 .run/discover/<runId>/。
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

ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/../../../.." && pwd)"
cd "$ROOT"
PHASE="${VERIFY_PHASE:-}"
if [[ "$PHASE" == "journey" ]]; then
  if [[ -n "${VERIFY_RUN_ID:-}" ]]; then
    RUN_ID="$VERIFY_RUN_ID"
  else
    PASS="baseline"
    if [[ "${VERIFY_PASS:-}" == "restore" ]]; then
      PASS="restore"
    elif [[ -n "${VERIFY_FAULT:-}" ]]; then
      PASS="inject"
    elif [[ -n "${VERIFY_PASS:-}" ]]; then
      PASS="$VERIFY_PASS"
    fi
    RAND="$(od -An -N2 -tx1 /dev/urandom | tr -d ' \n')"
    RUN_ID="journey-${PASS}-$(date -u +%Y%m%dT%H%M%SZ)-${RAND}"
  fi
else
  RUN_ID="${VERIFY_RUN_ID:-$(TZ=Asia/Shanghai date +%Y%m%d)-auto-verification-dev-layers}"
fi
RUN_DIR="$ROOT/.run/verify-${RUN_ID}"
if [[ "$PHASE" == "journey" && -f "$RUN_DIR/summary.json" ]]; then
  EXISTING_STATUS="$(node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(String(s.status??""));' "$RUN_DIR/summary.json")"
  if [[ "$EXISTING_STATUS" == "passed" || "$EXISTING_STATUS" == "failed" ]]; then
    echo "[FAIL] 拒绝覆写已完成跑次 $RUN_ID status=$EXISTING_STATUS" >&2
    exit 1
  fi
fi
mkdir -p "$RUN_DIR"
HOOK="$ROOT/.cursor/skills/verify-natural-enforcement/harness/ui/run-ui-auto-verification.sh"
OVERLAY="$ROOT/.cursor/skills/verify-natural-enforcement/harness/layers/apply-layer-overlay.sh"
CERT="${HOME}/.local/share/natural-enforcement/dev-certs/localhost.crt"

echo "[auto-verification] run=$RUN_DIR host=$(uname -a)"
node --experimental-transform-types --disable-warning=ExperimentalWarning \
  "$ROOT/.cursor/skills/verify-natural-enforcement/harness/layers/protocol-self-check.mjs" \
  >"$RUN_DIR/protocol-self-check.json"

if [[ "$PHASE" == "journey" ]]; then
  set +e
  node --experimental-transform-types --disable-warning=ExperimentalWarning \
    "$ROOT/.cursor/skills/verify-natural-enforcement/harness/journey-isolation-gate.ts" \
    >"$RUN_DIR/isolation-gate.json"
  GATE_RC=$?
  set -e
  if [[ "$GATE_RC" != "0" ]]; then
    echo "[FAIL] 旅程隔离门禁未通过，不执行 dev up" | tee "$RUN_DIR/stack-blocked.txt"
    export VERIFY_STACK=unavailable
    node --experimental-transform-types --disable-warning=ExperimentalWarning \
      "$ROOT/.cursor/skills/verify-natural-enforcement/harness/run-auto-verification.ts" \
      --run-id "$RUN_ID"
    exit $?
  fi
  if ! command -v docker >/dev/null 2>&1; then
    echo "[FAIL] 本机没有 docker，隔离门禁虽通过也不启动栈" | tee "$RUN_DIR/stack-blocked.txt"
    export VERIFY_STACK=unavailable
    node --experimental-transform-types --disable-warning=ExperimentalWarning \
      "$ROOT/.cursor/skills/verify-natural-enforcement/harness/run-auto-verification.ts" \
      --run-id "$RUN_ID"
    exit $?
  fi
  export COMPOSE_PROJECT_NAME
  export NE_DEPLOYMENT=verify
  export VERIFY_ISOLATION=dedicated
  if [[ "${COMPOSE_PROJECT_NAME:-}" == "" || "${COMPOSE_PROJECT_NAME:-}" == "natural-enforcement" ]]; then
    echo "[FAIL] 拒绝默认项目名，不执行 dev up" | tee "$RUN_DIR/stack-blocked.txt"
    exit 1
  fi
  # dev 把 COMPOSE_FILE 固定为基础编排，故障 overlay 不会被这次 up 带入。
  ./dev up
  if [[ -n "${VERIFY_FAULT:-}" ]]; then
    docker compose -p "$COMPOSE_PROJECT_NAME" \
      -f "$ROOT/infra/docker-compose.yml" \
      -f "$ROOT/.cursor/skills/verify-natural-enforcement/harness/layers/docker-compose.verify-fault.yml" \
      up -d --no-deps --force-recreate server
  else
    docker compose -p "$COMPOSE_PROJECT_NAME" \
      -f "$ROOT/infra/docker-compose.yml" \
      up -d --no-deps --force-recreate server
  fi
  for _ in $(seq 1 40); do
    cid="$(docker compose -p "$COMPOSE_PROJECT_NAME" -f "$ROOT/infra/docker-compose.yml" ps -q server || true)"
    health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null || true)"
    if [[ "$health" == "healthy" ]]; then
      break
    fi
    sleep 3
  done
  if [[ "${health:-}" != "healthy" ]]; then
    echo "[FAIL] 隔离 server 未进入 healthy，不发业务请求" | tee "$RUN_DIR/stack-blocked.txt"
    export VERIFY_STACK=unavailable
    node --experimental-transform-types --disable-warning=ExperimentalWarning \
      "$ROOT/.cursor/skills/verify-natural-enforcement/harness/run-auto-verification.ts" \
      --run-id "$RUN_ID"
    exit $?
  fi
  export NODE_EXTRA_CA_CERTS="$CERT"
  export VERIFY_BASE_URL="https://localhost:${NGINX_PORT}"
  # shellcheck source=transport-gate.sh
  . "$ROOT/.cursor/skills/verify-natural-enforcement/harness/transport-gate.sh"
  verify_transport_or_block "$VERIFY_BASE_URL" ""
  node --experimental-transform-types --disable-warning=ExperimentalWarning \
    "$ROOT/.cursor/skills/verify-natural-enforcement/harness/run-auto-verification.ts" \
    --run-id "$RUN_ID"
  exit $?
fi

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
# shellcheck source=transport-gate.sh
. "$ROOT/.cursor/skills/verify-natural-enforcement/harness/transport-gate.sh"
verify_transport_or_block "$VERIFY_BASE_URL" ""
export VERIFY_UI_HOOK="$HOOK"
node --experimental-transform-types --disable-warning=ExperimentalWarning \
  "$ROOT/.cursor/skills/verify-natural-enforcement/harness/run-auto-verification.ts" \
  --run-id "$RUN_ID"
