#!/usr/bin/env bash
# 在工具镜像内跑实验工具单测（宿主不跑项目 Node；bind mount 在 podman machine 下不可靠 → tar 经 stdin 传入）。
set -Eeuo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tar -C "$HERE" -cf - --exclude='*.sh' . \
  | docker run --rm -i natural-enforcement/tools:prototype1 \
      bash -c 'set -e; mkdir -p /t && tar -xf - -C /t && cd /t && node --test 2>&1'
