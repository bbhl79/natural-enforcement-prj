#!/usr/bin/env bash
# 在已有本机栈临时补存储配置；退出时用dev up恢复原编排。不部署、不删除数据。
set -euo pipefail
ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/../../../.." && pwd)"
cd "$ROOT"
if [[ "${COMPOSE_PROJECT_NAME:-natural-enforcement}" != natural-enforcement || "${NODE_ENV:-development}" == production ]]; then
  echo '此夹具只允许默认本机验证项目' >&2; exit 2
fi
RUNTIME_ENV_FILE="$ROOT/infra/runtime.env"
. "$ROOT/tools/runtime-env-lib.sh"
runtime_env_load
if [[ "$RUSTFS_ENDPOINT" != http://rustfs:9000 || "$POSTGRES_HOST" != db ]]; then
  echo '验证夹具拒绝非本机服务端点' >&2; exit 2
fi
# 与dev同样由运行参数构造容器内DB/队列地址，值不输出、不入证据。
export DATABASE_URL="$(python3 - <<'PY'
import os
from urllib.parse import quote
print('postgresql://'+quote(os.environ['POSTGRES_USER'],safe='')+':'+quote(os.environ['POSTGRES_PASSWORD'],safe='')+'@'+os.environ['POSTGRES_HOST']+':5432/'+quote(os.environ['POSTGRES_DB'],safe=''))
PY
)"
export REDIS_URL="redis://${REDIS_HOST}:6379"
restore() {
  local rc=$?
  trap - EXIT
  mkdir -p "$ROOT/e2e/results/verify-${VERIFY_RUN_ID:-full-loop}-fixture"
  ./dev logs --since 5m server > "$ROOT/e2e/results/verify-${VERIFY_RUN_ID:-full-loop}-fixture/server.log" 2>&1 || true
  if ! ./dev up; then echo '恢复本机原编排失败' >&2; exit 1; fi
  exit "$rc"
}
trap restore EXIT
# 仅验证存储参数和错误日志启动方式有临时差异。权限、角色与业务代码不变。
docker compose -p natural-enforcement -f "$ROOT/infra/docker-compose.yml" -f "$ROOT/e2e/verify/fixtures/local-ui-storage.yml" up -d server
./dev exec nginx nginx -s reload
./dev exec -T server node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { createS3Client } from './packages/storage/src/s3-client.ts';
const client = createS3Client({ endpoint: process.env.RUSTFS_ENDPOINT, region: process.env.RUSTFS_REGION, accessKey: process.env.RUSTFS_ACCESS_KEY, secretKey: process.env.RUSTFS_SECRET_KEY });
const bucket = process.env.RUSTFS_BUCKET;
assert.equal(bucket, 'ne-verify-ui');
if (!await client.bucketExists(bucket)) await client.createBucket(bucket, { objectLockEnabled: true });
await client.setVersioning(bucket, 'Enabled');
assert.equal(await client.getVersioning(bucket), 'Enabled');
await client.setDefaultRetention(bucket, { mode: 'COMPLIANCE', years: 1 });
console.log(JSON.stringify({ fixture: 'local-ui-storage', bucket, versioning: 'Enabled' }));
JS
bash "$ROOT/e2e/verify/harness/ui/run-ui-full-loop.sh"
