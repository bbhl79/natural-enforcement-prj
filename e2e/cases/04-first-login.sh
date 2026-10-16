#!/usr/bin/env bash
# 经 nginx 的首登冒烟。只用专用夹具人员，不做跨账号试错。
# 四步：初始口令登录得到强制改密；提交合规新口令；带原会话调用受保护接口成功；
# 再用初始口令登录，得到口令错误。同一条用例核对会话 Cookie 经过入口后的属性。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEV="$ROOT/dev"
cd "$ROOT"

HTTPS_PORT="${NGINX_PORT:-8080}"
BASE="https://localhost:${HTTPS_PORT}"
CERT="${HOME}/.local/share/natural-enforcement/dev-certs/localhost.crt"
PHONE="13800001010"
INITIAL_PASSWORD="Seed-pass-52"
NEW_PASSWORD="Smoke-pass-99"

fail() {
  echo "[FAIL] $1" >&2
  exit 1
}

echo "[e2e] 首登冒烟：拉起入口 ${BASE} …"
"$DEV" up

[ -s "$CERT" ] || fail "缺少 localhost 证书 ${CERT}，无法校验证书"

echo "[e2e] 首登冒烟：不携带开发证书时，证书校验必须失败…"
if curl -fsS --max-time 10 -o /dev/null "${BASE}/api/health" 2>"${TMPDIR:-/tmp}/e2e-99-cert-err"; then
  fail "未携带开发证书时请求不应成功（${BASE}/api/health）"
fi
grep -qi 'certificate\|SSL' "${TMPDIR:-/tmp}/e2e-99-cert-err" \
  || fail "未携带开发证书时的失败原因不是证书校验：$(tr '\n' ' ' < "${TMPDIR:-/tmp}/e2e-99-cert-err")"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

request() { # $1 输出正文 $2 输出头 $3 路径 $4 请求体文件或空 $5 Cookie 或空
  local body_file="$1" header_file="$2" path="$3" payload="${4:-}" cookie="${5:-}"
  local args=(-sS --max-time 20 --cacert "$CERT" -D "$header_file" -o "$body_file" -w '%{http_code}')
  if [ -n "$payload" ]; then
    args+=(-H 'content-type: application/json' --data-binary "@${payload}")
  fi
  if [ -n "$cookie" ]; then
    args+=(-H "cookie: ${cookie}")
  fi
  curl "${args[@]}" "${BASE}${path}"
}

assert_session_cookie() {
  local line="$1" name attrs pair
  printf '%s\n' "$line" | grep -q '__Host-' || fail "会话 Cookie 缺少 __Host- 前缀：${line}"
  name="${line%%;*}"
  attrs="${line#*;}"
  printf '%s' "$name" | grep -Eq '__Host-[^=]+=' || fail "会话 Cookie 名字不是 __Host- 前缀：${line}"
  printf '%s' "$attrs" | grep -q 'HttpOnly' || fail "会话 Cookie 缺少 HttpOnly：${line}"
  printf '%s' "$attrs" | grep -q 'Secure' || fail "会话 Cookie 缺少 Secure：${line}"
  printf '%s' "$attrs" | grep -q 'SameSite=Lax' || fail "会话 Cookie 缺少 SameSite=Lax：${line}"
  printf '%s' "$attrs" | grep -Eq '(^|[[:space:];])Path=/($|[[:space:];])' \
    || fail "会话 Cookie 的 Path 不是 /：${line}"
  if printf '%s' "$attrs" | grep -qi 'Domain='; then
    fail "会话 Cookie 不应带 Domain：${line}"
  fi
  pair="$(printf '%s' "$name" | sed -E 's/^[Ss]et-[Cc]ookie:[[:space:]]*//')"
  case "$pair" in
    __Host-*=*) printf '%s' "$pair" ;;
    *) fail "无法从 Set-Cookie 取出会话对：${line}" ;;
  esac
}

echo "[e2e] 首登冒烟：初始口令登录，期望强制改密…"
printf '%s' "{\"mobilePhone\":\"${PHONE}\",\"password\":\"${INITIAL_PASSWORD}\",\"rememberMe\":false}" >"$work/login.json"
login_code="$(request "$work/login.body" "$work/login.hdr" /api/auth/login "$work/login.json")"
[ "$login_code" = "200" ] || fail "初始口令登录状态码是 ${login_code}，正文：$(cat "$work/login.body")"
grep -q '"result":"password-change-required"' "$work/login.body" \
  || fail "初始口令登录未得到强制改密：$(cat "$work/login.body")"

cookie_line="$(grep -i '^set-cookie:' "$work/login.hdr" | tr -d '\r' | grep '__Host-' | head -1 || true)"
[ -n "$cookie_line" ] || fail "入口响应没有 __Host- 会话 Cookie。响应头：$(tr '\n' ' ' < "$work/login.hdr")"
session_cookie="$(assert_session_cookie "$cookie_line")"

echo "[e2e] 首登冒烟：提交合规新口令…"
printf '%s' "{\"currentPassword\":\"${INITIAL_PASSWORD}\",\"newPassword\":\"${NEW_PASSWORD}\"}" >"$work/password.json"
password_code="$(request "$work/password.body" "$work/password.hdr" /api/auth/password "$work/password.json" "$session_cookie")"
[ "$password_code" = "200" ] || fail "改口令状态码是 ${password_code}，正文：$(cat "$work/password.body")"
grep -q '"result":"established"' "$work/password.body" \
  || fail "改口令未成功：$(cat "$work/password.body")"

echo "[e2e] 首登冒烟：带原会话调用受保护接口…"
health_code="$(request "$work/health.body" "$work/health.hdr" /api/health "" "$session_cookie")"
[ "$health_code" = "200" ] || fail "带原会话调用受保护接口状态码是 ${health_code}，正文：$(cat "$work/health.body")"
grep -q '"status":"ok"' "$work/health.body" \
  || fail "带原会话调用受保护接口未成功：$(cat "$work/health.body")"

echo "[e2e] 首登冒烟：再用初始口令登录，期望口令错误…"
again_code="$(request "$work/again.body" "$work/again.hdr" /api/auth/login "$work/login.json")"
[ "$again_code" = "401" ] || fail "初始口令再次登录状态码是 ${again_code}，正文：$(cat "$work/again.body")"
grep -q '"result":"invalid-credential"' "$work/again.body" \
  || fail "初始口令再次登录不是口令错误：$(cat "$work/again.body")"

echo "[e2e] 首登冒烟通过：经 ${BASE} 完成强制改密，会话 Cookie 属性保持 __Host-、HttpOnly、Secure、SameSite=Lax、Path=/，且无 Domain。"
