# shellcheck shell=bash
# ============================================================================
# devenv 输出协议库（被 devenv/devenv source，不直接执行）
#
# 协议（Spec-工程基座 §4「输出协议三类」）：
#   - 结构化命令（build/up/test/verify/gen 等）--json：stdout 只放 JSON/JSONL
#     （长命令 = JSONL 事件流，终值事件含 command/status/exitCode）；
#     人类可读进度一律走 stderr；子进程原始输出捕获分流，不得混入结果流。
#   - 透传命令（exec/shell/logs）：输出为子进程原始流，--json 仅包装终值元数据。
#
# 退出码枚举（总表归 Spec-工程基座；7–10 为 e2e 专用码段，本骨架不用）：
#   0 成功 | 2 用法错误 | 3 环境未就绪 | 4 任务失败 | 5 超时 | 6 独占锁冲突
#   20–23 GitHub App 认证入口（见 lib/github-app-auth.sh）
# ============================================================================

JSON=0
CMD=""

note() { printf '[devenv] %s\n' "$*" >&2; }
warn() { printf '[devenv] WARN: %s\n' "$*" >&2; }
die()  { local code="$1"; shift; printf '[devenv] ERROR: %s\n' "$*" >&2; exit "$code"; }

jstr() { # JSON 字符串转义（覆盖常见控制字符）
  local s="$1"
  s="${s//\\/\\\\}"; s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"; s="${s//$'\t'/\\t}"; s="${s//$'\r'/\\r}"
  printf '%s' "$s"
}

json_pairs() { # k=v... → ,"k":"v"...（ev/final 共用）
  local pairs="" kv k v
  for kv in "$@"; do
    k="${kv%%=*}"; v="${kv#*=}"
    pairs+=",\"$k\":\"$(jstr "$v")\""
  done
  printf '%s' "$pairs"
}

ev() { # JSONL 事件（仅 --json 时输出到 stdout）：ev <name> [k=v]...
  (( JSON )) || return 0
  local name="$1"; shift
  printf '{"event":"%s"%s}\n' "$name" "$(json_pairs "$@")"
}

final() { # 终值（仅 --json 时输出单 JSON）：final <status> <exitCode> [k=v...]
  local status="$1" exit_code="$2"; shift 2
  (( JSON )) || return 0
  printf '{"command":"%s","status":"%s","exitCode":%s%s}\n' "$CMD" "$status" "$exit_code" "$(json_pairs "$@")"
}

# 透传命令（exec/shell/logs）统一包装（Spec §4 第 2 类，#62）：
#   - 默认：子进程原始流保持原通道（stdout/stderr 原样透传，可管道消费），退出码
#     = 子进程码（set -e 原样传播）。
#   - --json：子进程 stdout 分流到 stderr（原始流走独立通道，不污染结果流），
#     stdout 只放终值元数据（command/status/exitCode=子进程码）；退出码仍是子进程码。
run_passthrough() { # run_passthrough <cmd...>
  if (( JSON )); then
    local rc=0
    "$@" 1>&2 || rc=$?
    if (( rc )); then final failed "$rc"; else final ok 0; fi
    exit "$rc"
  fi
  "$@"
}
