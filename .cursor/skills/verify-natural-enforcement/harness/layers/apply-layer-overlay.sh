#!/usr/bin/env bash
# 打开或关闭验证专用假图层 overlay。
# on：叠上假图层，重建 server 与 nginx。七个核查图层地址指向 compose 网络内的 verify-layers。
# off：卸掉假图层，按 infra/docker-compose.yml 重建 server。地址回到 runtime.env 的空值。
# 不改仓库里的产品编排文件。调用方在验证结束时必须再执行 off。
set -euo pipefail

MODE="${1:-}"
if [[ "$MODE" != "on" && "$MODE" != "off" && "$MODE" != "restore" ]]; then
  echo "用法：$0 on|off|restore" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/../../../../.." && pwd)"
RUNTIME_ENV_FILE="$ROOT/infra/runtime.env"
# shellcheck source=tools/runtime-env-lib.sh
. "$ROOT/tools/runtime-env-lib.sh"
runtime_env_load

percent_encode() {
  printf '%s' "$1" | od -An -tx1 | awk '{
    for (i = 1; i <= NF; i++) {
      c = strtonum("0x" $i)
      if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c == 45 || c == 46 || c == 95 || c == 126)
        printf "%c", c
      else
        printf "%%%s", toupper($i)
    }
  }'
}

export DATABASE_URL="postgresql://$(percent_encode "$POSTGRES_USER"):$(percent_encode "$POSTGRES_PASSWORD")@${POSTGRES_HOST}:5432/$(percent_encode "$POSTGRES_DB")"
export REDIS_URL="redis://${REDIS_HOST}:6379"
export VERIFY_FAKE_LAYER_FILE="$ROOT/.cursor/skills/verify-natural-enforcement/harness/layers/fake-layer-server.mjs"

PROJECT="${COMPOSE_PROJECT_NAME:-natural-enforcement}"
BASE="$ROOT/infra/docker-compose.yml"
RUNTIME="$ROOT/.cursor/skills/verify-natural-enforcement/harness/layers/docker-compose.verify-runtime.yml"
OVERLAY="$ROOT/.cursor/skills/verify-natural-enforcement/harness/layers/docker-compose.verify-layers.yml"
COMPOSE_BASE=(docker compose -p "$PROJECT" -f "$BASE")
COMPOSE_RUNTIME=(docker compose -p "$PROJECT" -f "$BASE" -f "$RUNTIME")
COMPOSE_OVER=(docker compose -p "$PROJECT" -f "$BASE" -f "$RUNTIME" -f "$OVERLAY")
CERT="${HOME}/.local/share/natural-enforcement/dev-certs/localhost.crt"

wait_api() {
  local i
  for i in $(seq 1 40); do
    if curl --cacert "$CERT" -fsS "https://localhost:${NGINX_PORT}/api/health" >/dev/null 2>&1; then
      echo "[overlay] api health ok mode=$MODE"
      return 0
    fi
    sleep 1
  done
  echo "[FAIL] overlay $MODE 后 /api/health 未就绪" >&2
  return 1
}

recreate_nginx() {
  "${COMPOSE_BASE[@]}" up -d --no-deps --force-recreate nginx
}

# 开发夹具桶。产品 compose 不建桶。登记写入要求 versioning，否则没有版本 id。
ensure_bucket() {
  timeout 30 docker exec -i -w /work natural-enforcement-server-1 \
    node --import ./backend/server/register.mjs --disable-warning=ExperimentalWarning --input-type=module <<'EOF'
import { createS3Client } from './packages/storage/src/s3-client.ts';
const client = createS3Client({
  endpoint: process.env.RUSTFS_ENDPOINT,
  region: process.env.RUSTFS_REGION || 'us-east-1',
  accessKey: process.env.RUSTFS_ACCESS_KEY,
  secretKey: process.env.RUSTFS_SECRET_KEY,
});
const bucket = process.env.RUSTFS_BUCKET || 'ne-files';
if (!(await client.bucketExists(bucket))) {
  await client.createBucket(bucket, { objectLockEnabled: true });
  console.log(JSON.stringify({ bucket, created: true }));
} else {
  console.log(JSON.stringify({ bucket, created: false }));
}
const versioning = await client.getVersioning(bucket);
if (versioning !== 'Enabled') {
  await client.setVersioning(bucket, 'Enabled');
}
await client.setDefaultRetention(bucket, { mode: 'COMPLIANCE', years: 100 });
console.log(JSON.stringify({ bucket, versioning: await client.getVersioning(bucket), retention: 'COMPLIANCE' }));
EOF
}

if [[ "$MODE" == "restore" ]]; then
  echo "[overlay] 恢复产品 compose：卸掉假图层和验证运行时补丁"
  "${COMPOSE_OVER[@]}" rm -sf verify-layers >/dev/null 2>&1 || true
  unset NE_LAYER_URL_PERMANENT_FARMLAND \
    NE_LAYER_URL_ECOLOGICAL_REDLINE \
    NE_LAYER_URL_URBAN_DEVELOPMENT_BOUNDARY \
    NE_LAYER_URL_CULTIVATED_LAND \
    NE_LAYER_URL_LAND_CONVERSION_APPROVAL \
    NE_LAYER_URL_CONSTRUCTION_LAND_PERMIT \
    NE_LAYER_URL_LAND_SUPPLY_REDLINE \
    NE_LAYER_URL_STREET_BOUNDARY
  runtime_env_load
  "${COMPOSE_BASE[@]}" up -d --no-deps --force-recreate --wait --wait-timeout 180 server
  recreate_nginx
  wait_api
  exit 0
fi

if [[ "$MODE" == "on" ]]; then
  echo "[overlay] 叠上假图层并重建 server"
  "${COMPOSE_OVER[@]}" up -d --wait --wait-timeout 180 verify-layers server
  recreate_nginx
  wait_api
  ensure_bucket
  exit 0
fi

echo "[overlay] 卸掉假图层。图层地址为空。对象存储参数仍由验证运行时补丁供给"
"${COMPOSE_OVER[@]}" rm -sf verify-layers >/dev/null 2>&1 || true
# 清掉调用方壳里可能残留的非空图层地址，避免空回落被环境值盖住。
unset NE_LAYER_URL_PERMANENT_FARMLAND \
  NE_LAYER_URL_ECOLOGICAL_REDLINE \
  NE_LAYER_URL_URBAN_DEVELOPMENT_BOUNDARY \
  NE_LAYER_URL_CULTIVATED_LAND \
  NE_LAYER_URL_LAND_CONVERSION_APPROVAL \
  NE_LAYER_URL_CONSTRUCTION_LAND_PERMIT \
  NE_LAYER_URL_LAND_SUPPLY_REDLINE \
  NE_LAYER_URL_STREET_BOUNDARY
runtime_env_load
"${COMPOSE_RUNTIME[@]}" up -d --no-deps --force-recreate --wait --wait-timeout 180 server
recreate_nginx
wait_api
ensure_bucket
