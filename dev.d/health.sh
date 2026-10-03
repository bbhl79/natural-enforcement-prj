#!/usr/bin/env bash
# 对已拉起的当前档做健康检查。目标由 ./dev health 传入。
set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=compose.sh
source dev.d/compose.sh

target=$1

node_fetch() {
  local service=$1
  local url=$2
  compose exec -T "$service" node -e \
    "fetch(process.argv[1]).then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
    "$url"
}

case "$target" in
  backend)
    node_fetch backend "http://127.0.0.1:3000/health"
    ;;
  frontend)
    if [[ "$GZGT_PROFILE" == "dev" ]]; then
      node_fetch frontend "http://127.0.0.1:5173/"
    else
      compose exec -T frontend wget -q -O /dev/null "http://127.0.0.1/"
    fi
    ;;
  db)
    result=$(compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT CASE WHEN current_setting('"'"'server_version'"'"') LIKE '"'"'16%'"'"' AND EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = '"'"'postgis'"'"' AND default_version LIKE '"'"'3.5%'"'"') THEN 1 ELSE 0 END"')
    result=${result//$'\r'/}
    [[ "$result" == "1" ]]
    ;;
  minio)
    compose run --rm --no-deps --entrypoint /bin/sh minio-init -c \
      'mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" && mc ready local'
    ;;
  doc-render)
    compose exec -T doc-render libreoffice --version >/dev/null
    ;;
  *)
    echo "./dev: 未知 health 目标: $target" >&2
    exit 2
    ;;
esac
