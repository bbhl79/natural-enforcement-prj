#!/usr/bin/env bash
# A11：shield 可构建、导出面单测通过。依赖走开发镜像，不要求宿主机安装 pnpm。
set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=dev.d/compose.sh
source dev.d/compose.sh

if ! command -v docker >/dev/null 2>&1; then
  echo "./dev: 需要容器运行时（docker compose）" >&2
  exit 1
fi

compose run --rm --no-deps deps
compose run --rm --no-deps --entrypoint pnpm backend --filter @gzgt/shield typecheck
compose run --rm --no-deps --entrypoint pnpm backend --filter @gzgt/shield test
