# 用途：08、09 共用：整栈上为单个用例建独立库、切 server、用例后恢复并清库。
# 用例辅助（`_` 前缀：不是可执行用例，由 08、09 用 source 引入）。
# 在整栈上为一个用例建独立库：迁移 → 开发种子 → server 临时指向该库 → 用例结束恢复并清库。
# 手法同 06/07：独立库不动开发库，不依赖用例执行顺序，首登改密只发生一次，所以可重复跑。
#
# 调用方在 source 之前设置：
#   ROOT、DEV         仓库根与 dev 脚本路径，调用方已 cd 到 ROOT
#   ISO_LABEL         日志前缀，例如「验证 API」
#   ISO_DB            独立库名
#   ISO_TAG           容器名前缀，例如 api
# source 之后调用：isolated_stack_up；失败路径由 trap 触发 cleanup。
# 调用方在用例成功收尾处调用 restore_server，再 echo 通过信息。

PROJECT="${COMPOSE_PROJECT_NAME:-natural-enforcement}"
COMPOSE=(docker compose -p "$PROJECT" -f infra/docker-compose.yml)
NETWORK="${PROJECT}_default"
SERVER_IMAGE='natural-enforcement/server:dev'
PG_USER="${POSTGRES_USER:-postgres}"
PG_DB="${POSTGRES_DB:-postgres}"
HTTPS_PORT="${NGINX_PORT:-8080}"
BASE="https://localhost:${HTTPS_PORT}"
CERT="${HOME}/.local/share/natural-enforcement/dev-certs/localhost.crt"
# 工具链镜像与 dev 同一钉定（dev 的 LINT_IMAGE）。
TOOLCHAIN_IMAGE="$(sed -n "s/^LINT_IMAGE='\(.*\)'$/\1/p" "$DEV")"

# 打印失败原因并以 1 退出。
fail() {
  echo "[FAIL] $1" >&2
  exit 1
}

[ -n "$TOOLCHAIN_IMAGE" ] || fail "无法从 dev 读出工具链镜像（LINT_IMAGE）"
[ -n "${DATABASE_URL:-}" ] || fail "缺少 DATABASE_URL（由 dev 从 infra/runtime.env 算出）"
DEV_DATABASE_URL="$DATABASE_URL"
ISO_URL="${DEV_DATABASE_URL%/*}/${ISO_DB}"

# 在 db 容器内对指定库执行 psql；出错即停。
psql_db() { # $1 库名，其余为 psql 参数
  local db="$1"
  shift
  "${COMPOSE[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U "$PG_USER" -d "$db" "$@"
}

work="$(mktemp -d)"
containers=()
server_switched=0

# 把 server 恢复指向开发库并重启 nginx；失败返回非 0，由调用方决定是否保留现场。
restore_server() {
  if [ "$server_switched" = "1" ]; then
    echo "[e2e] ${ISO_LABEL}：server 恢复指向开发库…"
    # cleanup 以 if 调用本函数，errexit 被禁用；失败须显式回传，避免清标志后仍删库。
    DATABASE_URL="$DEV_DATABASE_URL" "${COMPOSE[@]}" up -d --no-deps --wait --wait-timeout 120 server >/dev/null || return
    "${COMPOSE[@]}" restart nginx >/dev/null || return
    server_switched=0
  fi
}

# 用例收尾：恢复 server、删用例容器与独立库、删临时目录；恢复失败保留现场。
cleanup() {
  local status=$?
  if ! restore_server; then
    echo "[FAIL] ${ISO_LABEL}：server 恢复流程失败，保留库 ${ISO_DB}、用例容器与产物 ${work} 供排查。" >&2
    exit 1
  fi
  for name in "${containers[@]}"; do
    docker rm -f "$name" >/dev/null 2>&1 || true
  done
  psql_db "$PG_DB" -q -c "DROP DATABASE IF EXISTS ${ISO_DB} WITH (FORCE)" >/dev/null 2>&1 || true
  rm -rf "$work"
  exit "$status"
}
trap cleanup EXIT

# 拉起整栈并为本用例建独立库：迁移、开发种子，再让 server 临时指向该库。
isolated_stack_up() {
  echo "[e2e] ${ISO_LABEL}：拉起入口 ${BASE} …"
  "$DEV" up
  [ -s "$CERT" ] || fail "缺少 localhost 证书 ${CERT}"

  echo "[e2e] ${ISO_LABEL}：准备独立库（迁移 → 开发种子）…"
  psql_db "$PG_DB" -q -c "DROP DATABASE IF EXISTS ${ISO_DB} WITH (FORCE)" -c "CREATE DATABASE ${ISO_DB}" >/dev/null
  containers+=("${ISO_TAG}-migrate-$$")
  docker run --name "${ISO_TAG}-migrate-$$" --pull=never --network "$NETWORK" \
    -e DATABASE_URL="$ISO_URL" -w /work/backend/prisma \
    "$SERVER_IMAGE" /work/node_modules/.bin/prisma migrate deploy >"$work/migrate.log" 2>&1 \
    || fail "迁移失败：$(cat "$work/migrate.log")"
  containers+=("${ISO_TAG}-seed-$$")
  docker run --name "${ISO_TAG}-seed-$$" --pull=never --network "$NETWORK" \
    -e DATABASE_URL="$ISO_URL" -w /work/backend/prisma \
    "$SERVER_IMAGE" /work/node_modules/.bin/prisma db seed >"$work/seed.log" 2>&1 \
    || fail "开发种子失败：$(cat "$work/seed.log")"

  echo "[e2e] ${ISO_LABEL}：server 临时指向独立库…"
  server_switched=1
  DATABASE_URL="$ISO_URL" "${COMPOSE[@]}" up -d --no-deps --wait --wait-timeout 120 server >/dev/null
  "${COMPOSE[@]}" restart nginx >/dev/null
  for _ in $(seq 1 30); do
    curl -fsS --max-time 5 --cacert "$CERT" -o /dev/null "${BASE}/api/health" 2>/dev/null && break
    sleep 1
  done
}

# 读 summary.json 的顶层 status；文件缺失判红。$1 = 证据目录，$2 = 容器退出码
verify_summary() {
  local run_dir="$1" container_rc="$2" status
  [ -s "$run_dir/summary.json" ] || fail "驱动未写出 summary.json（容器退出码 ${container_rc}）"
  status="$(sed -n 's/^  "status": "\([a-z]*\)",$/\1/p' "$run_dir/summary.json" | head -1)"
  echo "[e2e] ${ISO_LABEL}：summary=${status}，证据 ${run_dir}"
  if [ "$status" != "passed" ] || [ "$container_rc" != "0" ]; then
    sed -n '/"failed": \[/,/\]/p' "$run_dir/summary.json" >&2
    fail "${ISO_LABEL}用例未全绿（summary=${status}，容器退出码 ${container_rc}）"
  fi
}
