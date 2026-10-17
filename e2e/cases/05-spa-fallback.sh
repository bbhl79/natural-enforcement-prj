#!/usr/bin/env bash
# 经 nginx 的页面路径回落（#91 约定第 5 条，#122）：认证页、管理台页、未知路径都返回入口页，
# 由前端路由决定显示什么；缺失的静态资源照常 404；接口路径不被回落吞掉。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEV="$ROOT/dev"
cd "$ROOT"

HTTPS_PORT="${NGINX_PORT:-8080}"
BASE="https://localhost:${HTTPS_PORT}"
CERT="${HOME}/.local/share/natural-enforcement/dev-certs/localhost.crt"

fail() {
  echo "[FAIL] $1" >&2
  exit 1
}

echo "[e2e] 页面路径回落：拉起入口 ${BASE} …"
"$DEV" up

[ -s "$CERT" ] || fail "缺少 localhost 证书 ${CERT}，无法校验证书"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

fetch() { # $1 路径 $2 正文输出文件；打印状态码
  curl -sS --max-time 20 --cacert "$CERT" -o "$2" -w '%{http_code}' "${BASE}$1"
}

for path in /auth/login /auth/password '/auth/login?next=%2Fadmin' /admin /admin/locked-personnel /no/such/page; do
  echo "[e2e] 页面路径回落：${path} 期望 200 入口页…"
  code="$(fetch "$path" "$work/page")"
  [ "$code" = "200" ] || fail "${path} 状态码是 ${code}，期望 200（入口页回落）"
  grep -q 'id="root"' "$work/page" || fail "${path} 返回的不是入口页：$(head -c 200 "$work/page")"
done

echo "[e2e] 页面路径回落：缺失的静态资源期望 404…"
code="$(fetch /assets/no-such-chunk.js "$work/asset")"
[ "$code" = "404" ] || fail "缺失的静态资源状态码是 ${code}，期望 404（不应回落到入口页）"

echo "[e2e] 页面路径回落：接口路径不回落…"
code="$(fetch /api/auth/session "$work/session")"
[ "$code" = "200" ] || fail "/api/auth/session 状态码是 ${code}"
grep -q '"result":"anonymous"' "$work/session" || fail "/api/auth/session 正文不是会话结果：$(head -c 200 "$work/session")"
if grep -q 'id="root"' "$work/session"; then
  fail "/api/auth/session 被回落成了入口页"
fi

echo "[e2e] 页面路径回落：通过。"
