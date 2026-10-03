#!/bin/sh
# 依赖装进命名卷，不落到宿主机目录。
set -eu

cd /workspace
stamp=$(sha256sum pnpm-lock.yaml | awk '{print $1}')
current=$(cat node_modules/.install-stamp 2>/dev/null || true)
if [ "$current" != "$stamp" ]; then
  pnpm install --frozen-lockfile
  echo "$stamp" > node_modules/.install-stamp
fi
