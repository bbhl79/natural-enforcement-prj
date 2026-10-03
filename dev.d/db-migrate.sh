#!/usr/bin/env bash
# A06：把空库迁到当前档的数据库。迁移目录由主 agent 在合并阶段生成，本脚本不创建它。
set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=dev.d/compose.sh
source dev.d/compose.sh

if ! command -v docker >/dev/null 2>&1; then
  echo "./dev: 需要容器运行时（docker compose）" >&2
  exit 1
fi

# 先等到本档数据库健康，再跑迁移。
compose up -d --wait db

case "$GZGT_PROFILE" in
  dev)
    # 不用 --no-deps：开发档会先完成 deps 安装，并遵守 backend 对 db 的健康条件。
    compose run --rm --entrypoint pnpm backend \
      --filter @gzgt/backend exec prisma migrate deploy
    ;;
  integration)
    # 联调 backend 是制品镜像，没有 pnpm，也不含 devDependency 里的 Prisma CLI。
    # db-migrate 使用开发镜像，挂上 schema 与迁移文件，连的是联调档数据库。
    compose run --rm --build db-migrate
    ;;
esac
