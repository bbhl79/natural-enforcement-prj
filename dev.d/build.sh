#!/usr/bin/env bash
# A09／A10：构建 backend 或 frontend。不依赖数据库。
set -euo pipefail

cd "$(dirname "$0")/.."
# 构建只用开发档。联调档没有 deps 服务，不能跟着外部 GZGT_PROFILE 走。
GZGT_PROFILE=dev
export GZGT_PROFILE
# shellcheck source=dev.d/compose.sh
source dev.d/compose.sh

if ! command -v docker >/dev/null 2>&1; then
  echo "./dev: 需要容器运行时（docker compose）" >&2
  exit 1
fi

target=${1:?}
case "$target" in
  backend | frontend) ;;
  *)
    echo "./dev: 未知 build 目标: $target" >&2
    exit 2
    ;;
esac

compose run --rm --no-deps deps
compose run --rm --no-deps --entrypoint pnpm "$target" --filter "@gzgt/${target}" build
