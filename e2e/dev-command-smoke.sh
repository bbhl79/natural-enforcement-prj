#!/usr/bin/env bash
# dev 命令行为契约冒烟测试（E7 子集 + E6 前半）。
# 只测外部可观察行为：命令退出码与人类可读输出。不测内部实现。
# 用法：e2e/dev-command-smoke.sh            常规冒烟（要求镜像已就绪）
#       SMOKE_MISSING_IMAGE=1 e2e/dev-command-smoke.sh   追加镜像缺失路径用例（会删除并恢复本地 redis 镜像）
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV="$ROOT/dev"
cd "$ROOT"
# 与 dev 脚本同一项目名解析：默认 natural-enforcement，并行工作区用 COMPOSE_PROJECT_NAME 隔离
PROJECT="${COMPOSE_PROJECT_NAME:-natural-enforcement}"
COMPOSE=(docker compose -p "$PROJECT" -f infra/docker-compose.yml)

PASS=0
FAIL=0

ok()   { PASS=$((PASS + 1)); echo "[通过] $1"; }
bad()  { FAIL=$((FAIL + 1)); echo "[失败] $1"; }
check() { # check <描述> <退出码>
  if [ "$2" -eq 0 ]; then ok "$1"; else bad "$1（退出码 $2）"; fi
}

# ---------- 1. 裸 dev = 帮助文本，退出 0 ----------
out="$("$DEV" 2>&1)"; rc=$?
check "裸 dev 退出 0" "$rc"
echo "$out" | grep -q 'up' && echo "$out" | grep -q 'health' && echo "$out" | grep -q 'lint' \
  && ok "裸 dev 输出帮助文本（含 up/health/lint）" || bad "裸 dev 帮助文本缺少命令说明"

out="$("$DEV" no-such-command 2>&1)"; rc=$?
[ "$rc" -ne 0 ] && echo "$out" | grep -qi 'help\|用法\|usage' \
  && ok "未知命令非 0 退出并提示用法" || bad "未知命令处理不符合契约（rc=$rc）"

# ---------- 2. dev up 幂等 + 数据不丢 ----------
"$DEV" down >/dev/null 2>&1
"$DEV" up >/tmp/smoke-up1.log 2>&1; check "首次 dev up 成功" "$?"
cid_before="$("${COMPOSE[@]}" ps -q db)"
"$DEV" up >/tmp/smoke-up2.log 2>&1; check "重复 dev up 成功（幂等）" "$?"
cid_after="$("${COMPOSE[@]}" ps -q db)"
[ -n "$cid_before" ] && [ "$cid_before" = "$cid_after" ] \
  && ok "重复 up 未重建容器（id 不变，无副作用）" || bad "重复 up 重建了容器（$cid_before -> $cid_after）"

"${COMPOSE[@]}" exec -T db \
  psql -U postgres -d postgres -c 'CREATE TABLE IF NOT EXISTS smoke_keep(v int); DELETE FROM smoke_keep; INSERT INTO smoke_keep VALUES (42);' >/dev/null 2>&1
"$DEV" down >/dev/null 2>&1; check "dev down 成功" "$?"
"$DEV" up >/dev/null 2>&1; check "down 后 dev up 成功" "$?"
kept="$("${COMPOSE[@]}" exec -T db psql -U postgres -d postgres -tA -c 'SELECT v FROM smoke_keep;' 2>/dev/null)"
[ "$kept" = "42" ] && ok "down/up 后数据仍在（数据卷未被删除）" || bad "数据丢失（smoke_keep=$kept）"

# ---------- 3. dev health 红绿 ----------
"$DEV" health >/tmp/smoke-health-green.log 2>&1; check "health 全绿退出 0" "$?"
"${COMPOSE[@]}" ps --services --filter status=running | while read -r s; do :; done
n_services="$("${COMPOSE[@]}" config --services | wc -l)"
n_ok="$(grep -c 'OK' /tmp/smoke-health-green.log || true)"
[ "$n_ok" -ge "$n_services" ] \
  && ok "health 逐行输出覆盖全部 $n_services 个服务" || bad "health 输出行数不足（OK=$n_ok 服务=$n_services）"
grep -q '数据库\|db' /tmp/smoke-health-green.log && ok "health 含 db 连通检查" || bad "health 缺少 db 连通检查"

"${COMPOSE[@]}" stop redis >/dev/null 2>&1
"$DEV" health >/tmp/smoke-health-red.log 2>&1; rc=$?
[ "$rc" -ne 0 ] && grep -q 'FAIL\|失败\|红' /tmp/smoke-health-red.log \
  && ok "redis 停止后 health 非 0 且逐行标红" || bad "health 未检出 redis 宕（rc=$rc）"
"${COMPOSE[@]}" start redis >/dev/null 2>&1
"$DEV" health >/dev/null 2>&1; check "恢复后 health 重新全绿" "$?"

# ---------- 4. dev lint 全量 + 依赖漏入库检查 ----------
"$DEV" lint >/tmp/smoke-lint.log 2>&1; check "dev lint 全绿" "$?"

mkdir -p "$ROOT/node_modules/.fake" "$ROOT/frontend/node_modules"
"$DEV" lint >/tmp/smoke-lint-leak.log 2>&1; rc=$?
[ "$rc" -ne 0 ] && grep -q 'node_modules' /tmp/smoke-lint-leak.log \
  && ok "检出 node_modules 漏入库即失败（非 0 + 人类可读输出）" || bad "lint 未检出 node_modules（rc=$rc）"
rm -rf "$ROOT/node_modules" "$ROOT/frontend/node_modules"
"$DEV" lint >/dev/null 2>&1; check "清除 node_modules 后 lint 恢复全绿" "$?"

# ---------- 5. 镜像缺失路径（可选：删除并恢复本地 redis 镜像） ----------
if [ "${SMOKE_MISSING_IMAGE:-0}" = "1" ]; then
  "$DEV" down >/dev/null 2>&1
  redis_img="$("${COMPOSE[@]}" config | grep -A2 'redis:' | grep 'image:' | awk '{print $2}')"
  docker rmi -f "$(docker image inspect -f '{{.Id}}' "$redis_img")" >/dev/null 2>&1
  if docker image inspect "$redis_img" >/dev/null 2>&1; then
    bad "前置条件未满足：redis 镜像仍可被 inspect，缺失路径用例无法执行"
  else
    "$DEV" up >/tmp/smoke-missing.log 2>&1; rc=$?
    [ "$rc" -ne 0 ] && grep -q 'dev build' /tmp/smoke-missing.log \
      && ok "镜像缺失时 up 非 0 并提示先 dev build（不隐式构建）" || bad "镜像缺失路径不符合契约（rc=$rc）"
  fi
  docker pull "${redis_img%%@*}" >/dev/null 2>&1
  docker image inspect "$redis_img" >/dev/null 2>&1 \
    && ok "补齐镜像后本地镜像恢复" || bad "镜像恢复失败"
  "$DEV" up >/dev/null 2>&1; check "补齐镜像后 up 恢复成功" "$?"
fi

# ---------- 6. down 清容器清网络、不动数据卷 ----------
"$DEV" down >/tmp/smoke-down.log 2>&1; check "dev down 退出 0" "$?"
leftover="$("${COMPOSE[@]}" ps -q | wc -l)"
[ "$leftover" -eq 0 ] && ok "down 后无残留容器" || bad "down 后仍有 $leftover 个容器"
docker volume ls --format '{{.Name}}' | grep -q 'pgdata' \
  && ok "down 后数据卷保留" || bad "down 后数据卷被删除"

# ---------- 收尾 ----------
[ ! -d "$ROOT/node_modules" ] && ok "仓库无 node_modules 残留" || bad "仓库存在 node_modules 残留"

echo
echo "========== 结果：$PASS 通过 / $FAIL 失败 =========="
[ "$FAIL" -eq 0 ]
