#!/usr/bin/env bash
# E1：一次运行从空环境拉起全套（容器起 → 迁移完 → 种子进 → health 绿）。
# 毁数范围声明：本用例销毁的数据仅限本项目 compose 数据卷（${COMPOSE_PROJECT_NAME}_pgdata /
# _rustfs-data），等价 dev db reset 级的从零语义；并行工作区凭 COMPOSE_PROJECT_NAME 隔离互不影响。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEV="$ROOT/dev"
cd "$ROOT"
PROJECT="${COMPOSE_PROJECT_NAME:-natural-enforcement}"
COMPOSE=(docker compose -p "$PROJECT" -f infra/docker-compose.yml)
psql_db() { "${COMPOSE[@]}" exec -T db psql -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-postgres}" "$@" 2>/dev/null; }

echo "[e2e] E1 从零拉起：清空环境（down + 销毁本项目数据卷）…"
"$DEV" down >/dev/null 2>&1 || true
docker volume rm -f "${PROJECT}_pgdata" "${PROJECT}_rustfs-data" >/dev/null 2>&1 || true
# 从零前提只断言数据卷销毁；frontend-health 是面板快照卷（非数据），down 后允许在场
for vol in pgdata rustfs-data; do
  if docker volume inspect "${PROJECT}_${vol}" >/dev/null 2>&1; then
    echo "[FAIL] 数据卷 ${PROJECT}_${vol} 未销毁，不满足从零前提" >&2
    exit 1
  fi
done

echo "[e2e] E1 容器起（dev up：幂等拉起 + 迁移 + 种子 + 面板快照）…"
"$DEV" up

echo "[e2e] E1 迁移完：断言迁移历史第一条为 CREATE EXTENSION postgis…"
[ "$(psql_db -tA -c 'SELECT migration_name FROM _prisma_migrations ORDER BY started_at LIMIT 1;')" = "0001_postgis_extension" ] \
  || { echo "[FAIL] 迁移历史第一条不是 postgis 扩展" >&2; exit 1; }

echo "[e2e] E1 种子进：断言种子数据可查询…"
[ "$(psql_db -tA -c 'SELECT note FROM migration_probe;')" = "seed-probe" ] \
  || { echo "[FAIL] 种子数据缺失" >&2; exit 1; }
[ "$(psql_db -tA -c "SELECT 1 FROM pg_extension WHERE extname='postgis';")" = "1" ] \
  || { echo "[FAIL] postgis 扩展缺失" >&2; exit 1; }

echo "[e2e] E1 health 绿：四依赖逐行检查…"
"$DEV" health

echo "[e2e] E1 用例通过：容器起 → 迁移完 → 种子进 → health 绿，从零环境一次就绪。"
