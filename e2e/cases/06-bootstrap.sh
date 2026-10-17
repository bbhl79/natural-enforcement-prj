#!/usr/bin/env bash
# 生产引导命令（#131；#105「生产引导命令（D5）」，ADR 0013 第 3 条）。
# 在 server 镜像里按生产顺序执行：迁移 → 参照种子（NODE_ENV=production，不写开发夹具）→ 引导。
# 引导库是本用例新建的独立库，不动开发库。五个场景：
#   1. 空库：写入根机构（层级市）与首个系统管理人员，留痕两行，所属机构为根机构；
#   2. 重复执行：输出「已引导」，不写；
#   3. 两键不全：非 0 退出并输出差异，不写；
#   4. 首登强制改密：server 临时指向引导库，经 nginx 用初始口令登录得到强制改密，改密后会话持有机构维护码；
#   5. 两个进程并发：只有一次写入。
# 另核对：口令不出现在容器命令行、环境变量、命令输出、server 日志与留痕里。
# 用例结束时 server 恢复指向开发库，nginx 重启以重新解析 server。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEV="$ROOT/dev"
cd "$ROOT"

PROJECT="${COMPOSE_PROJECT_NAME:-natural-enforcement}"
COMPOSE=(docker compose -p "$PROJECT" -f infra/docker-compose.yml)
NETWORK="${PROJECT}_default"
SERVER_IMAGE='natural-enforcement/server:dev'
PG_USER="${POSTGRES_USER:-postgres}"
PG_DB="${POSTGRES_DB:-postgres}"
HTTPS_PORT="${NGINX_PORT:-8080}"
BASE="https://localhost:${HTTPS_PORT}"
CERT="${HOME}/.local/share/natural-enforcement/dev-certs/localhost.crt"
SECRET_PATH="${BOOTSTRAP_PASSWORD_FILE:-/run/secrets/bootstrap-password}"

BS_DB="e2e_bootstrap_131"
BS_DB_C="e2e_bootstrap_131_concurrent"
# 口令只写进挂载文件。下面的断言核对它不出现在任何可见位置。
PASSWORD="Boot-strap-e2e-41!"
NEW_PASSWORD="Fresh-e2e-pass-73!"
PHONE="13800013131"
ARGS=(--root-code ORG-E2E-131 --root-name 市局 --admin-code SJ0001 --admin-name 首个管理 --admin-mobile "$PHONE")

fail() {
  echo "[FAIL] $1" >&2
  exit 1
}

[ -n "${DATABASE_URL:-}" ] || fail "缺少 DATABASE_URL（由 dev 从 infra/runtime.env 算出）"
DEV_DATABASE_URL="$DATABASE_URL"
db_url() { # $1 库名：沿用开发库连接串，只换库名
  printf '%s' "${DEV_DATABASE_URL%/*}/$1"
}

work="$(mktemp -d)"
containers=()
server_switched=0

psql_db() { # $1 库名，其余为 psql 参数
  local db="$1"
  shift
  "${COMPOSE[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U "$PG_USER" -d "$db" "$@"
}

drop_databases() {
  for db in "$BS_DB" "$BS_DB_C"; do
    psql_db "$PG_DB" -q -c "DROP DATABASE IF EXISTS ${db} WITH (FORCE)" >/dev/null 2>&1 || true
  done
}

restore_server() {
  if [ "$server_switched" -eq 1 ]; then
    echo "[e2e] 引导：server 恢复指向开发库…"
    DATABASE_URL="$DEV_DATABASE_URL" "${COMPOSE[@]}" up -d --no-deps --wait --wait-timeout 120 server >/dev/null
    "${COMPOSE[@]}" restart nginx >/dev/null
    server_switched=0
  fi
}

cleanup() {
  local status=$?
  restore_server || status=1
  for name in "${containers[@]}"; do
    docker rm -f "$name" >/dev/null 2>&1 || true
  done
  drop_databases
  rm -rf "$work"
  exit "$status"
}
trap cleanup EXIT

echo "[e2e] 引导：拉起入口 ${BASE} …"
"$DEV" up
[ -s "$CERT" ] || fail "缺少 localhost 证书 ${CERT}"

printf '%s\n' "$PASSWORD" >"$work/bootstrap-password"
chmod 0644 "$work/bootstrap-password"

in_image() { # $1 容器名，$2 库连接串，其余为容器内命令。容器保留到用例结束，供 inspect 核对。
  local name="$1" url="$2"
  shift 2
  containers+=("$name")
  docker run --name "$name" --pull=never --network "$NETWORK" \
    -e DATABASE_URL="$url" \
    -e BOOTSTRAP_PASSWORD_FILE="$SECRET_PATH" \
    -v "$work/bootstrap-password:${SECRET_PATH}:ro" \
    -w /work/backend/prisma \
    "$SERVER_IMAGE" "$@"
}

bootstrap() { # $1 容器名，$2 库连接串，其余为引导参数
  local name="$1" url="$2"
  shift 2
  in_image "$name" "$url" node --import /work/backend/server/register.mjs \
    /work/backend/server/src/bootstrap-command.ts "$@"
}

prepare_database() { # $1 库名：建空库，迁移，参照种子
  local db="$1" url
  url="$(db_url "$db")"
  psql_db "$PG_DB" -q -c "DROP DATABASE IF EXISTS ${db} WITH (FORCE)" -c "CREATE DATABASE ${db}" >/dev/null
  in_image "migrate-${db}-$$" "$url" /work/node_modules/.bin/prisma migrate deploy >"$work/${db}.migrate.log" 2>&1 \
    || fail "迁移失败：$(cat "$work/${db}.migrate.log")"
  containers+=("seed-${db}-$$")
  docker run --name "seed-${db}-$$" --pull=never --network "$NETWORK" \
    -e DATABASE_URL="$url" -e NODE_ENV=production -w /work/backend/prisma \
    "$SERVER_IMAGE" /work/node_modules/.bin/prisma db seed >"$work/${db}.seed.log" 2>&1 \
    || fail "参照种子失败：$(cat "$work/${db}.seed.log")"
}

count_rows() { # $1 库名：机构/人员/任职/角色授予/留痕行数
  psql_db "$1" -tA -c "SELECT (SELECT count(*) FROM org_unit) || '/' || (SELECT count(*) FROM personnel) || '/' ||
    (SELECT count(*) FROM personnel_assignment) || '/' || (SELECT count(*) FROM personnel_role) || '/' ||
    (SELECT count(*) FROM audit_trail)"
}

assert_no_password() { # $1 描述，$2 文件
  if grep -qF -- "$PASSWORD" "$2" || grep -qF -- "$NEW_PASSWORD" "$2"; then
    fail "口令出现在${1}里"
  fi
}

drop_databases

echo "[e2e] 引导：准备空库（迁移 → 参照种子）…"
prepare_database "$BS_DB"
URL="$(db_url "$BS_DB")"
[ "$(count_rows "$BS_DB")" = "0/0/0/0/0" ] || fail "迁移与参照种子之后不是空库：$(count_rows "$BS_DB")"

echo "[e2e] 引导：场景 1 空库写入…"
bootstrap "bs-first-$$" "$URL" "${ARGS[@]}" >"$work/first.out" 2>"$work/first.err" \
  || fail "空库引导失败：$(cat "$work/first.out" "$work/first.err")"
grep -q '引导完成' "$work/first.out" || fail "空库引导未输出「引导完成」：$(cat "$work/first.out")"
[ "$(count_rows "$BS_DB")" = "1/1/1/1/2" ] || fail "空库引导后的行数不对：$(count_rows "$BS_DB")"
level="$(psql_db "$BS_DB" -tA -c "SELECT level || '/' || (parent_id IS NULL) FROM org_unit WHERE code = 'ORG-E2E-131'")"
[ "$level" = "city/t" ] || fail "根机构层级不是市或不是根：${level}"
audit="$(psql_db "$BS_DB" -tA -c "SELECT string_agg(a.action || ':' || a.outcome || ':' || (a.org_unit_id = o.id) || ':' || (a.actor_id IS NULL), ',' ORDER BY a.created_at, a.id)
  FROM audit_trail a CROSS JOIN org_unit o WHERE o.code = 'ORG-E2E-131'")"
[ "$audit" = "bootstrap.root-registered:succeeded:true:true,bootstrap.admin-registered:succeeded:true:true" ] \
  || fail "引导留痕不对：${audit}"

echo "[e2e] 引导：场景 2 重复执行…"
bootstrap "bs-repeat-$$" "$URL" "${ARGS[@]}" >"$work/repeat.out" 2>"$work/repeat.err" \
  || fail "重复引导应退出 0：$(cat "$work/repeat.out" "$work/repeat.err")"
grep -q '已引导' "$work/repeat.out" || fail "重复引导未输出「已引导」：$(cat "$work/repeat.out")"
[ "$(count_rows "$BS_DB")" = "1/1/1/1/2" ] || fail "重复引导写了数据：$(count_rows "$BS_DB")"

echo "[e2e] 引导：场景 3 两键不全被拒…"
partial=("${ARGS[@]}")
partial[5]=SJ0002
if bootstrap "bs-partial-$$" "$URL" "${partial[@]}" >"$work/partial.out" 2>"$work/partial.err"; then
  fail "两键不全时应非 0 退出"
fi
grep -q 'SJ0002' "$work/partial.err" || fail "两键不全时未输出差异：$(cat "$work/partial.err")"
[ "$(count_rows "$BS_DB")" = "1/1/1/1/2" ] || fail "两键不全时写了数据：$(count_rows "$BS_DB")"

echo "[e2e] 引导：场景 5 两个进程并发…"
prepare_database "$BS_DB_C"
URL_C="$(db_url "$BS_DB_C")"
bootstrap "bs-conc-a-$$" "$URL_C" "${ARGS[@]}" >"$work/conc-a.out" 2>"$work/conc-a.err" &
pid_a=$!
bootstrap "bs-conc-b-$$" "$URL_C" "${ARGS[@]}" >"$work/conc-b.out" 2>"$work/conc-b.err" &
pid_b=$!
wait "$pid_a" || fail "并发引导 A 失败：$(cat "$work/conc-a.out" "$work/conc-a.err")"
wait "$pid_b" || fail "并发引导 B 失败：$(cat "$work/conc-b.out" "$work/conc-b.err")"
written="$(cat "$work/conc-a.out" "$work/conc-b.out" | grep -c '引导完成' || true)"
already="$(cat "$work/conc-a.out" "$work/conc-b.out" | grep -c '已引导' || true)"
[ "$written" = "1" ] && [ "$already" = "1" ] \
  || fail "并发引导应一次写入、一次已引导：$(cat "$work/conc-a.out" "$work/conc-b.out")"
[ "$(count_rows "$BS_DB_C")" = "1/1/1/1/2" ] || fail "并发引导写了不止一次：$(count_rows "$BS_DB_C")"

echo "[e2e] 引导：场景 4 server 临时指向引导库，经 nginx 首登强制改密…"
server_switched=1
DATABASE_URL="$URL" "${COMPOSE[@]}" up -d --no-deps --wait --wait-timeout 120 server >/dev/null
"${COMPOSE[@]}" restart nginx >/dev/null
for _ in $(seq 1 30); do
  curl -fsS --max-time 5 --cacert "$CERT" -o /dev/null "${BASE}/api/health" 2>/dev/null && break
  sleep 1
done

request() { # $1 正文文件 $2 头文件 $3 路径 $4 请求体文件或空 $5 Cookie 或空
  local body_file="$1" header_file="$2" path="$3" payload="${4:-}" cookie="${5:-}"
  local args=(-sS --max-time 20 --cacert "$CERT" -D "$header_file" -o "$body_file" -w '%{http_code}')
  [ -n "$payload" ] && args+=(-H 'content-type: application/json' --data-binary "@${payload}")
  [ -n "$cookie" ] && args+=(-H "cookie: ${cookie}")
  curl "${args[@]}" "${BASE}${path}"
}

printf '%s' "{\"mobilePhone\":\"${PHONE}\",\"password\":\"${PASSWORD}\",\"rememberMe\":false}" >"$work/login.json"
code="$(request "$work/login.body" "$work/login.hdr" /api/auth/login "$work/login.json")"
[ "$code" = "200" ] || fail "初始口令登录状态码是 ${code}：$(cat "$work/login.body")"
grep -q '"result":"password-change-required"' "$work/login.body" \
  || fail "初始口令登录未得到强制改密：$(cat "$work/login.body")"
cookie="$(grep -i '^set-cookie:' "$work/login.hdr" | tr -d '\r' | grep '__Host-' | head -1 \
  | sed -E 's/^[Ss]et-[Cc]ookie:[[:space:]]*//; s/;.*$//')"
[ -n "$cookie" ] || fail "登录响应没有 __Host- 会话 Cookie"

printf '%s' "{\"currentPassword\":\"${PASSWORD}\",\"newPassword\":\"${NEW_PASSWORD}\"}" >"$work/password.json"
code="$(request "$work/password.body" "$work/password.hdr" /api/auth/password "$work/password.json" "$cookie")"
[ "$code" = "200" ] || fail "改口令状态码是 ${code}：$(cat "$work/password.body")"
grep -q '"result":"established"' "$work/password.body" || fail "改口令未成功：$(cat "$work/password.body")"

code="$(request "$work/session.body" "$work/session.hdr" /api/auth/session "" "$cookie")"
[ "$code" = "200" ] || fail "会话查询状态码是 ${code}：$(cat "$work/session.body")"
grep -q '"code":"SJ0001"' "$work/session.body" || fail "会话不是首个系统管理人员：$(cat "$work/session.body")"
grep -q '"passwordChangeRequired":false' "$work/session.body" || fail "改密后仍强制改密：$(cat "$work/session.body")"
grep -q '"org.unit.register"' "$work/session.body" || fail "首个系统管理人员没有机构维护码：$(cat "$work/session.body")"

code="$(request "$work/again.body" "$work/again.hdr" /api/auth/login "$work/login.json")"
[ "$code" = "401" ] || fail "初始口令改密后仍可登录（状态码 ${code}）"

echo "[e2e] 引导：核对口令不出现在命令行、环境变量、输出、日志与留痕里…"
for name in "${containers[@]}"; do
  docker inspect --format '{{json .Config.Cmd}} {{json .Args}} {{json .Path}} {{json .Config.Env}} {{json .Config.Entrypoint}}' \
    "$name" >"$work/inspect-${name}.txt"
  assert_no_password "容器 ${name} 的命令行或环境变量" "$work/inspect-${name}.txt"
  docker logs "$name" >"$work/logs-${name}.txt" 2>&1
  assert_no_password "容器 ${name} 的日志" "$work/logs-${name}.txt"
done
for file in "$work"/*.out "$work"/*.err; do
  assert_no_password "命令输出 ${file##*/}" "$file"
done
"${COMPOSE[@]}" logs --no-color server >"$work/server.log" 2>&1
assert_no_password "server 日志" "$work/server.log"
for db in "$BS_DB" "$BS_DB_C"; do
  psql_db "$db" -tA -c "SELECT row_to_json(a)::text FROM audit_trail a" >"$work/audit-${db}.txt"
  assert_no_password "库 ${db} 的留痕" "$work/audit-${db}.txt"
done

restore_server
echo "[e2e] 引导通过：空库写入、重复已引导、两键不全被拒、首登强制改密、并发只写一次；口令未出现在命令行、环境变量、输出、日志与留痕里。"
