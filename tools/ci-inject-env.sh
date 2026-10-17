#!/usr/bin/env bash
# CI 凭据注入（#57 --ci 凭据注入回收；ADR 0008、#80：开发与 CI 用仓库夹具值）。
# 用法：bash tools/ci-inject-env.sh <名字>…（只在 GitHub Actions 步骤里运行）。
# 每个名字必须登记在 infra/runtime.env，且不是 derived 项。
# 环境里已有非空值（来自 secrets）时用环境值，并用 ::add-mask:: 遮蔽密钥类值。
# 环境里没有值时取 infra/runtime.env 的夹具值。夹具值已在仓库里公开，不遮蔽。
# 结果逐行写入 $GITHUB_ENV，后续步骤从环境读到。日志只写来源，不写值。
set -euo pipefail

ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
RUNTIME_ENV_FILE="$ROOT/infra/runtime.env"
# shellcheck source=tools/runtime-env-lib.sh
. "$ROOT/tools/runtime-env-lib.sh"

if [ -z "${GITHUB_ENV:-}" ]; then
  echo "[FAIL] ci-inject-env：缺 GITHUB_ENV。本脚本只在 GitHub Actions 里运行。" >&2
  exit 1
fi
if [ $# -eq 0 ]; then
  echo "[FAIL] ci-inject-env：至少给一个变量名。" >&2
  exit 1
fi

table="$(runtime_env_table)"
for name in "$@"; do
  class="$(awk -F'\t' -v n="$name" '$1 == n { print $2 }' <<< "$table")"
  if [ -z "$class" ] || [ "$class" = derived ]; then
    echo "[FAIL] ci-inject-env：$name 不在 infra/runtime.env，或是 derived 项。" >&2
    exit 1
  fi
  value="${!name:-}"
  origin="secrets"
  if [ -z "$value" ]; then
    value="$(runtime_env_value "$name")"
    origin="infra/runtime.env 夹具值"
  elif [ "$class" = secret ]; then
    echo "::add-mask::$value"
  fi
  if [ -z "$value" ]; then
    echo "[FAIL] ci-inject-env：$name 在环境和 infra/runtime.env 里都没有值。" >&2
    exit 1
  fi
  case "$value" in
    *$'\n'*|*$'\r'*)
      echo "[FAIL] ci-inject-env：$name 的值含换行，不能写入 GITHUB_ENV。" >&2
      exit 1 ;;
  esac
  printf '%s=%s\n' "$name" "$value" >> "$GITHUB_ENV"
  echo "ci-inject-env：$name 取自 $origin。"
done
