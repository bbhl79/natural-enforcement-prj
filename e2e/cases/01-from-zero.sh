#!/usr/bin/env bash
# E1：一次运行从空环境拉起全套（毁卷重建 → 容器起 → 迁移完 → 种子进 → health 绿）。
# 毁数入口收敛（代码评审必修）：从零前提只经 dev db reset（全系统唯一毁数入口）达成，
# e2e 不再直删任何数据卷（此前的 docker volume rm -f 直删已移除）；
# E1 语义 = 从零建库，与 rustfs 无关（rustfs-data 卷不参与本用例，也不参与销毁）。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEV="$ROOT/dev"
cd "$ROOT"
PROJECT="${COMPOSE_PROJECT_NAME:-natural-enforcement}"
COMPOSE=(docker compose -p "$PROJECT" -f infra/docker-compose.yml)
psql_db() { "${COMPOSE[@]}" exec -T db psql -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-postgres}" "$@" 2>/dev/null; }

echo "[e2e] E1 从零建库：经唯一毁数入口 dev db reset（数据卷销毁重建 → 迁移 → 种子）…"
"$DEV" db reset

echo "[e2e] E1 容器起（dev up：幂等拉起 + 迁移 + 种子 + 面板快照，含健康检查）…"
"$DEV" up

echo "[e2e] E1 迁移完：断言迁移历史第一条为 CREATE EXTENSION postgis（迁移链从零完整重放）…"
[ "$(psql_db -tA -c 'SELECT migration_name FROM _prisma_migrations ORDER BY started_at LIMIT 1;')" = "0001_postgis_extension" ] \
  || { echo "[FAIL] 迁移历史第一条不是 postgis 扩展" >&2; exit 1; }

echo "[e2e] E1 种子进：断言种子数据可查询…"
[ "$(psql_db -tA -c 'SELECT note FROM migration_probe;')" = "seed-probe" ] \
  || { echo "[FAIL] 种子数据缺失" >&2; exit 1; }
[ "$(psql_db -tA -c "SELECT 1 FROM pg_extension WHERE extname='postgis';")" = "1" ] \
  || { echo "[FAIL] postgis 扩展缺失" >&2; exit 1; }

echo "[e2e] E1 health 绿：四依赖逐行检查…"
"$DEV" health

echo "[e2e] E1 用例通过：毁卷重建 → 容器起 → 迁移完 → 种子进 → health 绿，从零环境一次就绪。"
