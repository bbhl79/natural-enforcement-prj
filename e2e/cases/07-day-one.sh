#!/usr/bin/env bash
# 「上线首日」端到端（#134，本期准出条件；#105「Testing Decisions」首日 e2e、故事 1、8、9）。
# 在独立的首日库上按生产顺序串起整条路线，全程经 nginx：
#   空库 → 引导（根机构＋首个系统管理人员）→ 首登强制改密 →
#   首屏三步引导的三个数字（机构 1、人员 1、有执法资格 0；画面由前端单测 router.test.tsx 覆盖）→
#   建区分局和所 → 登记区里的经办（含角色）→ 登记执法证 → 经办登录具备执法资格。
# 写法沿用 06-bootstrap.sh：独立库不动开发库；server 临时指向首日库，用例结束恢复并重启 nginx。
# 执法资格的事实进身份上下文（identity 的 hasEnforcementQualification），业务切片消费；
# 本用例的外部观察 = 名单与卡片交出证件状态「有效」、经办会话正常建立、库行证件三列齐。
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

DAY_DB="e2e_dayone_134"
ROOT_CODE="ORG-E2E-134"
ADMIN_CODE="SJ1340"
ADMIN_PHONE="13800013431"
CLERK_CODE="JB1340"
CLERK_PHONE="13800013432"
ADMIN_PASSWORD="Dayone-adm-134!"
ADMIN_NEW_PASSWORD="Dayone-adm-new-92!"
CLERK_PASSWORD="Dayone-clk-134!"
CLERK_NEW_PASSWORD="Dayone-clk-new-77!"
CERT_NO="44010020261340"
CERT_EXPIRES="2031-12-31"
ARGS=(--root-code "$ROOT_CODE" --root-name 市局 --admin-code "$ADMIN_CODE" --admin-name 首日管理 --admin-mobile "$ADMIN_PHONE")

fail() {
  echo "[FAIL] $1" >&2
  exit 1
}

[ -n "${DATABASE_URL:-}" ] || fail "缺少 DATABASE_URL（由 dev 从 infra/runtime.env 算出）"
DEV_DATABASE_URL="$DATABASE_URL"
day_url() { printf '%s' "${DEV_DATABASE_URL%/*}/${DAY_DB}"; }

work="$(mktemp -d)"
containers=()
server_switched=0

psql_db() { # $1 库名，其余为 psql 参数
  local db="$1"
  shift
  "${COMPOSE[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U "$PG_USER" -d "$db" "$@"
}

restore_server() {
  if [ "$server_switched" -eq 1 ]; then
    echo "[e2e] 首日：server 恢复指向开发库…"
    # cleanup 以 if 调用本函数，errexit 被禁用；失败须显式回传，避免清标志后仍删库。
    DATABASE_URL="$DEV_DATABASE_URL" "${COMPOSE[@]}" up -d --no-deps --wait --wait-timeout 120 server >/dev/null || return
    "${COMPOSE[@]}" restart nginx >/dev/null || return
    server_switched=0
  fi
}

cleanup() {
  local status=$?
  if ! restore_server; then
    echo "[FAIL] 首日：server 恢复流程失败，保留库 ${DAY_DB}、用例容器与产物 ${work} 供排查。" >&2
    exit 1
  fi
  for name in "${containers[@]}"; do
    docker rm -f "$name" >/dev/null 2>&1 || true
  done
  psql_db "$PG_DB" -q -c "DROP DATABASE IF EXISTS ${DAY_DB} WITH (FORCE)" >/dev/null 2>&1 || true
  rm -rf "$work"
  exit "$status"
}
trap cleanup EXIT

echo "[e2e] 首日：拉起入口 ${BASE} …"
"$DEV" up
[ -s "$CERT" ] || fail "缺少 localhost 证书 ${CERT}"

printf '%s\n' "$ADMIN_PASSWORD" >"$work/bootstrap-password"
chmod 0644 "$work/bootstrap-password"

in_image() { # $1 容器名，$2 库连接串，其余为容器内命令
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

echo "[e2e] 首日：准备空库（迁移 → 参照种子）…"
URL="$(day_url)"
psql_db "$PG_DB" -q -c "DROP DATABASE IF EXISTS ${DAY_DB} WITH (FORCE)" -c "CREATE DATABASE ${DAY_DB}" >/dev/null
in_image "day-migrate-$$" "$URL" /work/node_modules/.bin/prisma migrate deploy >"$work/migrate.log" 2>&1 \
  || fail "迁移失败：$(cat "$work/migrate.log")"
containers+=("day-seed-$$")
docker run --name "day-seed-$$" --pull=never --network "$NETWORK" \
  -e DATABASE_URL="$URL" -e NODE_ENV=production -w /work/backend/prisma \
  "$SERVER_IMAGE" /work/node_modules/.bin/prisma db seed >"$work/seed.log" 2>&1 \
  || fail "参照种子失败：$(cat "$work/seed.log")"

echo "[e2e] 首日：空库引导（根机构＋首个系统管理人员）…"
in_image "day-bootstrap-$$" "$URL" node --import /work/backend/server/register.mjs \
  /work/backend/server/src/bootstrap-command.ts "${ARGS[@]}" >"$work/bootstrap.out" 2>"$work/bootstrap.err" \
  || fail "空库引导失败：$(cat "$work/bootstrap.out" "$work/bootstrap.err")"
grep -q '引导完成' "$work/bootstrap.out" || fail "空库引导未输出「引导完成」：$(cat "$work/bootstrap.out")"
rows="$(psql_db "$DAY_DB" -tA -c "SELECT (SELECT count(*) FROM org_unit) || '/' || (SELECT count(*) FROM personnel) || '/' ||
  (SELECT count(*) FROM personnel_assignment) || '/' || (SELECT count(*) FROM personnel_role) || '/' ||
  (SELECT count(*) FROM audit_trail)")"
[ "$rows" = "1/1/1/1/2" ] || fail "空库引导后的行数不对：${rows}"

echo "[e2e] 首日：server 临时指向首日库，经 nginx 走整条路线…"
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

cookie_of() { # $1 头文件：取首个 __Host- 会话 Cookie 对
  grep -i '^set-cookie:' "$1" | tr -d '\r' | grep '__Host-' | head -1 \
    | sed -E 's/^[Ss]et-[Cc]ookie:[[:space:]]*//; s/;.*$//'
}

count_of() { # $1 文件 $2 键：数 JSON 里键出现次数
  grep -o "\"$2\":" "$1" | wc -l | tr -d ' '
}

echo "[e2e] 首日：首个系统管理人员首登强制改密…"
printf '%s' "{\"mobilePhone\":\"${ADMIN_PHONE}\",\"password\":\"${ADMIN_PASSWORD}\",\"rememberMe\":false}" >"$work/admin-login.json"
code="$(request "$work/admin-login.body" "$work/admin-login.hdr" /api/auth/login "$work/admin-login.json")"
[ "$code" = "200" ] || fail "初始口令登录状态码是 ${code}：$(cat "$work/admin-login.body")"
grep -q '"result":"password-change-required"' "$work/admin-login.body" \
  || fail "初始口令登录未得到强制改密：$(cat "$work/admin-login.body")"
admin_cookie="$(cookie_of "$work/admin-login.hdr")"
[ -n "$admin_cookie" ] || fail "登录响应没有 __Host- 会话 Cookie"

printf '%s' "{\"currentPassword\":\"${ADMIN_PASSWORD}\",\"newPassword\":\"${ADMIN_NEW_PASSWORD}\"}" >"$work/admin-password.json"
code="$(request "$work/admin-password.body" "$work/admin-password.hdr" /api/auth/password "$work/admin-password.json" "$admin_cookie")"
[ "$code" = "200" ] || fail "改口令状态码是 ${code}：$(cat "$work/admin-password.body")"
grep -q '"result":"established"' "$work/admin-password.body" || fail "改口令未成功：$(cat "$work/admin-password.body")"

code="$(request "$work/admin-session.body" "$work/admin-session.hdr" /api/auth/session "" "$admin_cookie")"
[ "$code" = "200" ] || fail "会话查询状态码是 ${code}：$(cat "$work/admin-session.body")"
grep -q "\"code\":\"${ADMIN_CODE}\"" "$work/admin-session.body" || fail "会话不是首个系统管理人员：$(cat "$work/admin-session.body")"
grep -q '"passwordChangeRequired":false' "$work/admin-session.body" || fail "改密后仍强制改密：$(cat "$work/admin-session.body")"
for opcode in org.unit.register personnel.profile.register personnel.cert.update; do
  grep -q "\"${opcode}\"" "$work/admin-session.body" || fail "首个系统管理人员缺操作码 ${opcode}：$(cat "$work/admin-session.body")"
done

echo "[e2e] 首日：首屏三步引导的三个数字（机构 1、人员 1、有执法资格 0）…"
# 前端 firstDayPending 按这三个数判引导（frontend/src/admin/adminHome.ts）；引导画面由前端单测覆盖。
code="$(request "$work/orgs.body" "$work/orgs.hdr" /api/org-units "" "$admin_cookie")"
[ "$code" = "200" ] || fail "机构树读取状态码是 ${code}：$(cat "$work/orgs.body")"
[ "$(count_of "$work/orgs.body" id)" = "1" ] || fail "首日机构数不是 1：$(cat "$work/orgs.body")"
root_id="$(grep -oE '"rootId":"[^"]+"' "$work/orgs.body" | head -1 | cut -d'"' -f4)"
[ -n "$root_id" ] || fail "机构树没有交出根机构标识：$(cat "$work/orgs.body")"

code="$(request "$work/persons0.body" "$work/persons0.hdr" /api/admin/personnel "" "$admin_cookie")"
[ "$code" = "200" ] || fail "人员名单读取状态码是 ${code}：$(cat "$work/persons0.body")"
[ "$(count_of "$work/persons0.body" code)" = "1" ] || fail "首日人员数不是 1：$(cat "$work/persons0.body")"
grep -q '"certStatus":"none"' "$work/persons0.body" || fail "首日唯一人员的执法证不是未登记：$(cat "$work/persons0.body")"

code="$(request "$work/locked0.body" "$work/locked0.hdr" /api/admin/locked-personnel "" "$admin_cookie")"
[ "$code" = "200" ] || fail "被锁人员读取状态码是 ${code}：$(cat "$work/locked0.body")"
grep -q '"personnel":\[\]' "$work/locked0.body" || fail "首日被锁人员不是空：$(cat "$work/locked0.body")"

echo "[e2e] 首日：建区分局和所…"
printf '%s' "{\"parentId\":\"${root_id}\",\"name\":\"天河区分局\",\"level\":\"district\"}" >"$work/district.json"
code="$(request "$work/district.body" "$work/district.hdr" /api/admin/org-units "$work/district.json" "$admin_cookie")"
[ "$code" = "200" ] || fail "建区分局状态码是 ${code}：$(cat "$work/district.body")"
grep -q '"result":"registered"' "$work/district.body" || fail "建区分局未成功：$(cat "$work/district.body")"
district_id="$(grep -oE '"id":"[^"]+"' "$work/district.body" | head -1 | cut -d'"' -f4)"
[ -n "$district_id" ] || fail "建区分局没有交出机构标识：$(cat "$work/district.body")"

printf '%s' "{\"parentId\":\"${district_id}\",\"name\":\"石牌自然资源所\",\"level\":\"station\"}" >"$work/station.json"
code="$(request "$work/station.body" "$work/station.hdr" /api/admin/org-units "$work/station.json" "$admin_cookie")"
[ "$code" = "200" ] || fail "建所状态码是 ${code}：$(cat "$work/station.body")"
grep -q '"result":"registered"' "$work/station.body" || fail "建所未成功：$(cat "$work/station.body")"

echo "[e2e] 首日：登记区里的经办（含角色）…"
printf '%s' "{\"code\":\"${CLERK_CODE}\",\"name\":\"区经办\",\"orgUnitId\":\"${district_id}\",\"mobilePhone\":\"${CLERK_PHONE}\",\"initialPassword\":\"${CLERK_PASSWORD}\",\"roles\":[\"经办\"]}" >"$work/clerk.json"
code="$(request "$work/clerk.body" "$work/clerk.hdr" /api/admin/personnel "$work/clerk.json" "$admin_cookie")"
[ "$code" = "200" ] || fail "登记经办状态码是 ${code}：$(cat "$work/clerk.body")"
grep -q '"result":"registered"' "$work/clerk.body" || fail "登记经办未成功：$(cat "$work/clerk.body")"
clerk_id="$(grep -oE '"id":"[^"]+"' "$work/clerk.body" | head -1 | cut -d'"' -f4)"
[ -n "$clerk_id" ] || fail "登记经办没有交出人员标识：$(cat "$work/clerk.body")"

echo "[e2e] 首日：为经办登记执法证…"
printf '%s' "{\"certNo\":\"${CERT_NO}\",\"certExpiresOn\":\"${CERT_EXPIRES}\",\"certStatus\":\"valid\"}" >"$work/cert.json"
code="$(request "$work/cert.body" "$work/cert.hdr" "/api/admin/personnel/${clerk_id}/cert" "$work/cert.json" "$admin_cookie")"
[ "$code" = "200" ] || fail "登记执法证状态码是 ${code}：$(cat "$work/cert.body")"
grep -q '"result":"updated"' "$work/cert.body" || fail "登记执法证未成功：$(cat "$work/cert.body")"

echo "[e2e] 首日：引导条件解除——名单两人、经办证件状态有效…"
code="$(request "$work/persons1.body" "$work/persons1.hdr" /api/admin/personnel "" "$admin_cookie")"
[ "$code" = "200" ] || fail "登记后名单读取状态码是 ${code}：$(cat "$work/persons1.body")"
[ "$(count_of "$work/persons1.body" code)" = "2" ] || fail "登记后人员数不是 2：$(cat "$work/persons1.body")"
clerk_row="$(grep -oE "\{[^{}]*\"code\":\"${CLERK_CODE}\"[^{}]*\}" "$work/persons1.body" || true)"
[ -n "$clerk_row" ] || fail "名单里没有经办的行：$(cat "$work/persons1.body")"
grep -q '"certStatus":"valid"' <<<"$clerk_row" || fail "经办的执法证情况不是有效：${clerk_row}"

code="$(request "$work/card.body" "$work/card.hdr" "/api/admin/personnel/${clerk_id}" "" "$admin_cookie")"
[ "$code" = "200" ] || fail "人员卡片读取状态码是 ${code}：$(cat "$work/card.body")"
grep -q "\"no\":\"${CERT_NO}\"" "$work/card.body" || fail "卡片没有交出登记的证号：$(cat "$work/card.body")"
grep -q '"status":"valid"' "$work/card.body" || fail "卡片证件状态不是有效：$(cat "$work/card.body")"

echo "[e2e] 首日：经办登录并具备执法资格…"
printf '%s' "{\"mobilePhone\":\"${CLERK_PHONE}\",\"password\":\"${CLERK_PASSWORD}\",\"rememberMe\":false}" >"$work/clerk-login.json"
code="$(request "$work/clerk-login.body" "$work/clerk-login.hdr" /api/auth/login "$work/clerk-login.json")"
[ "$code" = "200" ] || fail "经办初始口令登录状态码是 ${code}：$(cat "$work/clerk-login.body")"
grep -q '"result":"password-change-required"' "$work/clerk-login.body" \
  || fail "经办首登未得到强制改密：$(cat "$work/clerk-login.body")"
clerk_cookie="$(cookie_of "$work/clerk-login.hdr")"
[ -n "$clerk_cookie" ] || fail "经办登录响应没有 __Host- 会话 Cookie"

printf '%s' "{\"currentPassword\":\"${CLERK_PASSWORD}\",\"newPassword\":\"${CLERK_NEW_PASSWORD}\"}" >"$work/clerk-password.json"
code="$(request "$work/clerk-password.body" "$work/clerk-password.hdr" /api/auth/password "$work/clerk-password.json" "$clerk_cookie")"
[ "$code" = "200" ] || fail "经办改口令状态码是 ${code}：$(cat "$work/clerk-password.body")"
grep -q '"result":"established"' "$work/clerk-password.body" || fail "经办改口令未成功：$(cat "$work/clerk-password.body")"

code="$(request "$work/clerk-session.body" "$work/clerk-session.hdr" /api/auth/session "" "$clerk_cookie")"
[ "$code" = "200" ] || fail "经办会话查询状态码是 ${code}：$(cat "$work/clerk-session.body")"
grep -q "\"code\":\"${CLERK_CODE}\"" "$work/clerk-session.body" || fail "会话不是经办：$(cat "$work/clerk-session.body")"
grep -q '"passwordChangeRequired":false' "$work/clerk-session.body" || fail "经办改密后仍强制改密：$(cat "$work/clerk-session.body")"
grep -q '"clue.verify.start"' "$work/clerk-session.body" || fail "经办会话没有启动核查码：$(cat "$work/clerk-session.body")"
# 资格由证件三列推导（identity 的 hasEnforcementQualification，fail-closed）；库行是它的事实源。
cert_row="$(psql_db "$DAY_DB" -tA -c "SELECT enforcement_cert_no || '/' || enforcement_cert_status || '/' || (enforcement_cert_expires_on IS NOT NULL)
  FROM personnel WHERE code = '${CLERK_CODE}'")"
[ "$cert_row" = "${CERT_NO}/valid/true" ] || fail "经办的库行证件三列不对：${cert_row}"

echo "[e2e] 首日：核对留痕行…"
audit="$(psql_db "$DAY_DB" -tA -c "SELECT string_agg(action || ':' || n, ',' ORDER BY action) FROM (
  SELECT action, count(*)::text AS n FROM audit_trail WHERE outcome = 'succeeded'
    AND action IN ('bootstrap.root-registered','bootstrap.admin-registered','org.unit.registered','personnel.registered','cert.updated')
  GROUP BY action) t")"
[ "$audit" = "bootstrap.admin-registered:1,bootstrap.root-registered:1,cert.updated:1,org.unit.registered:2,personnel.registered:1" ] \
  || fail "首日留痕动作不对：${audit}"

echo "[e2e] 首日：核对口令不出现在命令行、环境变量、输出、日志与留痕里…"
assert_no_password() { # $1 描述，$2 文件
  local secret
  for secret in "$ADMIN_PASSWORD" "$ADMIN_NEW_PASSWORD" "$CLERK_PASSWORD" "$CLERK_NEW_PASSWORD"; do
    if grep -qF -- "$secret" "$2"; then
      fail "口令出现在${1}里"
    fi
  done
}
for name in "${containers[@]}"; do
  docker inspect --format '{{json .Config.Cmd}} {{json .Args}} {{json .Path}} {{json .Config.Env}} {{json .Config.Entrypoint}}' \
    "$name" >"$work/inspect-${name}.txt"
  assert_no_password "容器 ${name} 的命令行或环境变量" "$work/inspect-${name}.txt"
  docker logs "$name" >"$work/logs-${name}.txt" 2>&1
  assert_no_password "容器 ${name} 的日志" "$work/logs-${name}.txt"
done
for file in "$work"/*.out "$work"/*.err "$work"/*.body; do
  assert_no_password "用例产物 ${file##*/}" "$file"
done
"${COMPOSE[@]}" logs --no-color server >"$work/server.log" 2>&1
assert_no_password "server 日志" "$work/server.log"
psql_db "$DAY_DB" -tA -c "SELECT row_to_json(a)::text FROM audit_trail a" >"$work/audit.txt"
assert_no_password "首日库的留痕" "$work/audit.txt"

restore_server
echo "[e2e] 首日通过：空库引导 → 首登改密 → 三步引导数字 → 建区分局和所 → 登记经办与执法证 → 经办登录具备执法资格；留痕齐、口令未外泄。"
