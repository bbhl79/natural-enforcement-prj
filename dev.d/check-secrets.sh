#!/usr/bin/env bash
# A12：扫描已跟踪文件。白名单见 infras/secrets.allow。
set -euo pipefail

cd "$(dirname "$0")/.."

allow_file=infras/secrets.allow
if [[ ! -f "$allow_file" ]]; then
  echo "./dev: 缺少 $allow_file" >&2
  exit 1
fi

allowed() {
  local path=$1
  local line
  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
      ''|\#*) continue ;;
    esac
    if [[ "$path" == "$line" || "$path" == "$line"* ]]; then
      return 0
    fi
  done < "$allow_file"
  return 1
}

hit=0
while IFS= read -r path; do
  [[ -z "$path" ]] && continue
  base=${path##*/}
  if [[ "$base" == ".env" || "$path" == *.pem || "$path" == *.key ]]; then
    if allowed "$path"; then
      continue
    fi
    echo "secrets: 实密文件 $path" >&2
    hit=1
    continue
  fi
  if allowed "$path"; then
    continue
  fi
  if [[ ! -f "$path" ]]; then
    continue
  fi
  if grep -Eq 'BEGIN (RSA |OPENSSH |EC |DSA )?PRIVATE KEY' "$path"; then
    echo "secrets: 私钥 $path" >&2
    hit=1
  fi
  if grep -Eq 'AKIA[0-9A-Z]{16}' "$path"; then
    echo "secrets: 访问密钥 $path" >&2
    hit=1
  fi
done < <(git ls-files)

if [[ "$hit" -ne 0 ]]; then
  echo "secrets: 未通过。例外只写在 $allow_file。" >&2
  exit 1
fi

echo "secrets: ok"
