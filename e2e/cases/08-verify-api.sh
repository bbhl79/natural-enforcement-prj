#!/usr/bin/env bash
# 验证资产的 API 稳定用例：在独立库上经 nginx 跑 e2e/verify 的 API scenario 与负例。
# 场景清单在 e2e/verify/harness/run-api-suite.ts 的 API_SUITE，判据是各 scenario 的 oracle。
# 驱动在工具链容器里运行（不用宿主 node），容器走宿主网络，访问地址仍是 https://localhost。
#
# 独立库（与 07-day-one.sh 同一手法）：迁移 → 开发种子 → server 临时指向该库 → 用例结束恢复。
# 独立库带来两个稳定性质：
# - 不依赖用例执行顺序。e2e 层前面的用例改过谁的口令，都不影响本用例。
# - 可重复跑。每次新建库，种子口令一致，首登改密只发生一次。
#   （驱动把 clerk-a 的口令改成固定新口令后，旧库不再可登；本用例每次用新库，故无此问题。）
#
# 只增不改：经管理台接口种入三名内勤（已存在视为完成），登记若干线索。开发库不受影响。
# 证据：产物目录下的 verify-<runId>/（summary / steps / evidence）。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEV="$ROOT/dev"
cd "$ROOT"

RESULTS="${E2E_RESULTS:-$ROOT/e2e/results}"
HTTPS_PORT="${NGINX_PORT:-8080}"
BASE="https://localhost:${HTTPS_PORT}"
CERT="${HOME}/.local/share/natural-enforcement/dev-certs/localhost.crt"
PROJECT="${COMPOSE_PROJECT_NAME:-natural-enforcement}"
COMPOSE=(docker compose -p "$PROJECT" -f infra/docker-compose.yml)
NETWORK="${PROJECT}_default"
SERVER_IMAGE='natural-enforcement/server:dev'
PG_USER="${POSTGRES_USER:-postgres}"
PG_DB="${POSTGRES_DB:-postgres}"
API_DB="e2e_verify_api"
# 工具链镜像与 dev 同一钉定（dev 的 LINT_IMAGE）；驱动只用 node 内建模块，不装依赖。
TOOLCHAIN_IMAGE="$(sed -n "s/^LINT_IMAGE='\(.*\)'$/\1/p" "$DEV")"
RUN_ID="e2e-$(date -u +%Y%m%dT%H%M%SZ)-$$"

fail() {
  echo "[FAIL] $1" >&2
  exit 1
}

[ -n "$TOOLCHAIN_IMAGE" ] || fail "无法从 dev 读出工具链镜像（LINT_IMAGE）"
[ -n "${DATABASE_URL:-}" ] || fail "缺少 DATABASE_URL（由 dev 从 infra/runtime.env 算出）"
DEV_DATABASE_URL="$DATABASE_URL"
api_url() { printf '%s' "${DEV_DATABASE_URL%/*}/${API_DB}"; }

psql_db() { # $1 库名，其余为 psql 参数
  local db="$1"
  shift
  "${COMPOSE[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U "$PG_USER" -d "$db" "$@"
}

work="$(mktemp -d)"
containers=()
server_switched=0

restore_server() {
  if [ "$server_switched" = "1" ]; then
    echo "[e2e] 验证 API：server 恢复指向开发库…"
    # cleanup 以 if 调用本函数，errexit 被禁用；失败须显式回传，避免清标志后仍删库。
    DATABASE_URL="$DEV_DATABASE_URL" "${COMPOSE[@]}" up -d --no-deps --wait --wait-timeout 120 server >/dev/null || return
    "${COMPOSE[@]}" restart nginx >/dev/null || return
    server_switched=0
  fi
}

cleanup() {
  local status=$?
  if ! restore_server; then
    echo "[FAIL] 验证 API：server 恢复流程失败，保留库 ${API_DB}、用例容器与产物 ${work} 供排查。" >&2
    exit 1
  fi
  for name in "${containers[@]}"; do
    docker rm -f "$name" >/dev/null 2>&1 || true
  done
  psql_db "$PG_DB" -q -c "DROP DATABASE IF EXISTS ${API_DB} WITH (FORCE)" >/dev/null 2>&1 || true
  rm -rf "$work"
  exit "$status"
}
trap cleanup EXIT

echo "[e2e] 验证 API：拉起入口 ${BASE} …"
"$DEV" up
[ -s "$CERT" ] || fail "缺少 localhost 证书 ${CERT}"

echo "[e2e] 验证 API：准备独立库（迁移 → 开发种子）…"
URL="$(api_url)"
psql_db "$PG_DB" -q -c "DROP DATABASE IF EXISTS ${API_DB} WITH (FORCE)" -c "CREATE DATABASE ${API_DB}" >/dev/null
containers+=("api-migrate-$$")
docker run --name "api-migrate-$$" --pull=never --network "$NETWORK" \
  -e DATABASE_URL="$URL" -w /work/backend/prisma \
  "$SERVER_IMAGE" /work/node_modules/.bin/prisma migrate deploy >"$work/migrate.log" 2>&1 \
  || fail "迁移失败：$(cat "$work/migrate.log")"
containers+=("api-seed-$$")
docker run --name "api-seed-$$" --pull=never --network "$NETWORK" \
  -e DATABASE_URL="$URL" -w /work/backend/prisma \
  "$SERVER_IMAGE" /work/node_modules/.bin/prisma db seed >"$work/seed.log" 2>&1 \
  || fail "开发种子失败：$(cat "$work/seed.log")"

echo "[e2e] 验证 API：server 临时指向独立库，经 nginx 跑 API 场景与负例…"
server_switched=1
DATABASE_URL="$URL" "${COMPOSE[@]}" up -d --no-deps --wait --wait-timeout 120 server >/dev/null
"${COMPOSE[@]}" restart nginx >/dev/null
for _ in $(seq 1 30); do
  curl -fsS --max-time 5 --cacert "$CERT" -o /dev/null "${BASE}/api/health" 2>/dev/null && break
  sleep 1
done

# 灌入驱动所需的源码与夹具（tar 经 stdin，与 dev 灌源同理：WSL bind 只见残缺视图）；
# 证据从容器 tar 回宿主产物目录。stdout 只留给证据 tar，驱动日志走 stderr。
mkdir -p "$RESULTS" "$work/seed/e2e/verify"
cp -R "$ROOT/e2e/verify/harness" "$ROOT/e2e/verify/fixtures" "$work/seed/e2e/verify/"
cp "$CERT" "$work/seed/$(basename "$CERT")"
set +e
# 一个归档灌入：工具链镜像是 BusyBox tar，不支持 -i 拼接多段归档。
tar -C "$work/seed" --format=ustar -cf - . \
  | docker run --rm --pull=never -i --network host \
    -e VERIFY_BASE_URL="$BASE" \
    -e VERIFY_RUN_ID="$RUN_ID" \
    -e VERIFY_SPATIAL_SALT="$RUN_ID" \
    -e NODE_EXTRA_CA_CERTS="/work/$(basename "$CERT")" \
    -w /work \
    "$TOOLCHAIN_IMAGE" \
    sh -c 'set -e; tar -xf - -C /work; rc=0;
      node --experimental-transform-types --disable-warning=ExperimentalWarning \
        e2e/verify/harness/run-api-suite.ts >&2 || rc=$?;
      tar -C /work/e2e/results -cf - .; exit $rc' \
    | tar -x -f - -C "$RESULTS"
codes=("${PIPESTATUS[@]}")
set -e

run_dir="$RESULTS/verify-${RUN_ID}"
[ -s "$run_dir/summary.json" ] || fail "驱动未写出 summary.json（容器退出码 ${codes[1]}）"
status="$(sed -n 's/^  "status": "\([a-z]*\)",$/\1/p' "$run_dir/summary.json" | head -1)"
echo "[e2e] 验证 API：summary=${status}，证据 ${run_dir}"
if [ "$status" != "passed" ] || [ "${codes[1]}" != "0" ]; then
  sed -n '/"failed": \[/,/\]/p' "$run_dir/summary.json" >&2
  fail "验证 API 用例未全绿（summary=${status}，容器退出码 ${codes[1]}）"
fi

restore_server
echo "[e2e] 验证 API 通过：API 场景与负例按各自 oracle 全绿；证据 ${run_dir}。"
