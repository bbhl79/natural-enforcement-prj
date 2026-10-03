#!/bin/sh
# 依赖装进命名卷，不落到宿主机目录。
set -eu

cd /workspace
stamp=$(sha256sum pnpm-lock.yaml | awk '{print $1}')
current=$(cat node_modules/.install-stamp 2>/dev/null || true)
# shield 与 e2e 依赖在独立命名卷。卷是空的时 lockfile 戳记仍可能匹配，必须重装。
if [ "$current" != "$stamp" ] \
  || [ ! -e packages/shield/node_modules/.bin/vitest ] \
  || [ ! -e e2e/node_modules/.bin/playwright ]; then
  pnpm install --frozen-lockfile
  echo "$stamp" > node_modules/.install-stamp
fi
