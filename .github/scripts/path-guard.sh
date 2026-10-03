#!/usr/bin/env bash
# 业务 PR 路径守卫。命中 .github/path-guard.paths 中的前缀则退出码 1。
# 用法：path-guard.sh <paths-file> < changed-files.txt
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: path-guard.sh <paths-file>" >&2
  exit 2
fi

paths_file=$1
if [[ ! -f "$paths_file" ]]; then
  echo "path-guard: missing $paths_file" >&2
  exit 2
fi

prefixes=()
while IFS= read -r line || [[ -n "$line" ]]; do
  case "$line" in
    ''|\#*) continue ;;
  esac
  prefixes+=("$line")
done < "$paths_file"

if [[ ${#prefixes[@]} -eq 0 ]]; then
  echo "path-guard: no prefixes in $paths_file" >&2
  exit 2
fi

hit=0
while IFS= read -r changed || [[ -n "$changed" ]]; do
  [[ -z "$changed" ]] && continue
  for prefix in "${prefixes[@]}"; do
    # 前缀可出现在路径任意层级，以便 prisma/migrations/ 覆盖 apps/backend/prisma/migrations/。
    if [[ "$changed" == "$prefix" || "$changed" == "$prefix"* || "$changed" == *"/$prefix"* ]]; then
      echo "path-guard: forbidden $changed (prefix $prefix)"
      hit=1
    fi
  done
done

if [[ "$hit" -ne 0 ]]; then
  echo "path-guard: fail. 豁免仅限带 label channel:main-agent 的主 agent 通道 PR。"
  exit 1
fi

echo "path-guard: ok"
exit 0
