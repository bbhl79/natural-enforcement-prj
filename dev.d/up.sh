#!/usr/bin/env bash
# 拉起当前档，并等 MinIO 三桶初始化完成。
set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=compose.sh
source dev.d/compose.sh

wait_exit() {
  local service=$1
  local attempts=$2
  compose up -d --build --force-recreate --no-deps "$service"
  local cid=""
  local status=""
  local code=""
  local i
  cid=$(compose ps -aq "$service" | tail -n 1)
  if [[ -z "$cid" ]]; then
    echo "./dev: 没有容器: $service" >&2
    exit 1
  fi
  for ((i = 0; i < attempts; i++)); do
    status=$(docker inspect -f '{{.State.Status}}' "$cid")
    if [[ "$status" == "exited" ]]; then
      code=$(docker inspect -f '{{.State.ExitCode}}' "$cid")
      if [[ "$code" != "0" ]]; then
        compose logs "$service" >&2
        exit "$code"
      fi
      return 0
    fi
    sleep 2
  done
  echo "./dev: 超时: $service" >&2
  compose logs "$service" >&2
  exit 1
}

compose up -d --build --wait --wait-timeout 300 db doc-render
compose up -d minio
wait_exit minio-init 90

if [[ "$GZGT_PROFILE" == "dev" ]]; then
  wait_exit deps 300
fi

compose up -d --build --wait --wait-timeout 300 backend frontend nginx
