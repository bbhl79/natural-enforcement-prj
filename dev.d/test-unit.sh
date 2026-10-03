#!/usr/bin/env bash
# A08：backend 与 shield 单测。不依赖数据库。
set -euo pipefail

cd "$(dirname "$0")/.."
# 检查只用开发档。联调档没有 deps 服务，不能跟着外部 GZGT_PROFILE 走。
GZGT_PROFILE=dev
export GZGT_PROFILE
# shellcheck source=dev.d/compose.sh
source dev.d/compose.sh

if ! command -v docker >/dev/null 2>&1; then
  echo "./dev: 需要容器运行时（docker compose）" >&2
  exit 1
fi

compose run --rm --no-deps deps
compose run --rm --no-deps --entrypoint pnpm backend --filter @gzgt/backend test
compose run --rm --no-deps --entrypoint pnpm backend --filter @gzgt/shield test
