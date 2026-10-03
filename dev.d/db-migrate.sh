#!/usr/bin/env bash
# A06：把空库迁到当前 schema。迁移目录由主 agent 在合并阶段生成，本脚本不创建它。
set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=dev.d/compose.sh
source dev.d/compose.sh

if ! command -v docker >/dev/null 2>&1; then
  echo "./dev: 需要容器运行时（docker compose）" >&2
  exit 1
fi

compose up -d db
compose run --rm --no-deps --entrypoint pnpm backend \
  --filter @gzgt/backend exec prisma migrate deploy
