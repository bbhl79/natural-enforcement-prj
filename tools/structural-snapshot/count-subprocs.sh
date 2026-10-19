#!/usr/bin/env bash
# 兜底闸子进程预算计数（#176；父规格 #168 改造项 3 的守门量纲载体）。
#
# 干什么：用 PATH 前置 shim 的办法，数清跑一次兜底闸起了多少个外部子进程、分别是哪些命令，
# 与 tools/structural-test.sh 头注释里的子进程预算比对，超预算即非 0 退出。
# 为什么用子进程数而不是耗时：子进程数由闸的形态决定，与机器快慢无关，是确定性的守门量纲；
# 耗时受机器负载影响，只能当粗兜底（依据见 docs/research/structural-test-speedup.md §6.2）。
#
# 计数方式不改闸本身：shim 是临时目录里的一次性包装脚本，先记一笔再 exec 真身；
# 真身路径在造 shim 时用 command -v 解析成绝对路径写死，故不会自调造成递归。
#
# 用法：
#   tools/structural-snapshot/count-subprocs.sh [--max-total N] [--max-grep-sed N] <闸脚本路径> [闸参数...]
# 例：
#   tools/structural-snapshot/count-subprocs.sh tools/structural-test.sh
#   tools/structural-snapshot/count-subprocs.sh --max-total 3600 --max-grep-sed 300 tools/structural-test.sh
#   tools/structural-snapshot/count-subprocs.sh tools/structural-test.sh --rule module-public-entry
#
# 输出：逐命令计数（降序）、子进程总数、grep+sed 小计、闸退出码、墙钟秒数。
# 退出码：0 = 计数完成且未超预算（不带 --max-* 时只计数）；1 = 超预算；2 = 用法或环境不成立。
# 依赖：宿主侧纯源码扫描，无容器、无网络。shim 用 /bin/sh，只依赖 printf 与 exec 两个内建。
set -uo pipefail

SELF_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
ROOT="$(cd "$SELF_DIR/../.." && pwd)"

# 计数口径 = docs/research/structural-test-speedup.md §1.1 的 shim 清单。
# 改这个清单会让改前改后的数字不可比，要改必须两边同批重测。
SHIM_CMDS=(
  grep sed awk find realpath dirname basename readlink tr cut xargs sort uniq wc comm
  mktemp cp rm mv cat head tail stat env node
)

usage() {
  cat <<EOF
用法：$0 [--max-total N] [--max-grep-sed N] <闸脚本路径> [闸参数...]

  --max-total N      子进程总数预算，超过即退出 1（不带 = 只计数不判定）
  --max-grep-sed N   grep + sed 合计预算，超过即退出 1（不带 = 只计数不判定）
  闸脚本路径         tools/structural-test.sh 的路径
  闸参数             原样转给闸（例如 --rule module-public-entry）
EOF
}

die() { echo "[失败] $1" >&2; exit 2; }

MAX_TOTAL=""
MAX_GREP_SED=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --max-total)    MAX_TOTAL="${2:-}";    [ -n "$MAX_TOTAL" ]    || die "--max-total 缺取值";    shift 2 ;;
    --max-grep-sed) MAX_GREP_SED="${2:-}"; [ -n "$MAX_GREP_SED" ] || die "--max-grep-sed 缺取值"; shift 2 ;;
    -h|--help)      usage; exit 0 ;;
    *)              break ;;
  esac
done

[ "$#" -ge 1 ] || { usage >&2; exit 2; }
GATE="$1"; shift
[ -f "$GATE" ] || die "闸脚本不存在：$GATE"
GATE="$(readlink -f "$GATE")"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/gate-subproc-XXXXXX")" || die "创建临时工作区失败"
SHIM_DIR="$WORK/shim"
LOG="$WORK/calls.log"
mkdir -p "$SHIM_DIR" || die "创建 shim 目录失败"
: > "$LOG"

for cmd in "${SHIM_CMDS[@]}"; do
  real="$(command -v "$cmd" 2>/dev/null)" || continue
  [ -n "$real" ] || continue
  case "$real" in "$SHIM_DIR"/*) continue ;; esac   # 重复调用本脚本时不自调
  cat > "$SHIM_DIR/$cmd" <<EOF
#!/bin/sh
printf '%s\n' "$cmd" >> "\$SUBPROC_LOG"
exec "$real" "\$@"
EOF
  chmod +x "$SHIM_DIR/$cmd" || die "shim 不可执行：$cmd"
done

echo "子进程计数开始"
echo "  闸：$GATE${*:+ 参数：$*}"
echo "  shim 命令：${#SHIM_CMDS[@]} 个（$SHIM_DIR）"

started="$(date +%s.%N)"
( export SUBPROC_LOG="$LOG" PATH="$SHIM_DIR:$PATH"; "$GATE" "$@" > "$WORK/gate.out" 2>&1 )
gate_rc=$?
ended="$(date +%s.%N)"
elapsed="$(awk -v a="$started" -v b="$ended" 'BEGIN { printf "%.2f", b - a }')"

total="$(grep -c . "$LOG" || true)"
echo "  闸退出码：$gate_rc"
echo "  墙钟：${elapsed} 秒"
echo "  逐命令计数（降序）："
if [ "$total" -eq 0 ]; then
  echo "    （没有任何子进程被记到：shim 未生效或闸没跑起来，计数不成立）"
  sed 's/^/    /' "$WORK/gate.out" >&2
  rm -rf "$WORK"
  exit 2
fi
LC_ALL=C sort "$LOG" | LC_ALL=C uniq -c | LC_ALL=C sort -rn | LC_ALL=C awk '{ printf "    %-12s %s\n", $2, $1 }'
grep_sed="$(LC_ALL=C grep -cxE 'grep|sed' "$LOG" || true)"
echo "  子进程总数：$total"
echo "  grep + sed 小计：$grep_sed"

over=0
if [ -n "$MAX_TOTAL" ] && [ "$total" -gt "$MAX_TOTAL" ]; then
  echo "[失败] 子进程总数 $total 超预算 $MAX_TOTAL（形态退化：逐文件扫描回来了）" >&2
  over=1
fi
if [ -n "$MAX_GREP_SED" ] && [ "$grep_sed" -gt "$MAX_GREP_SED" ]; then
  echo "[失败] grep + sed 合计 $grep_sed 超预算 $MAX_GREP_SED" >&2
  over=1
fi
if [ "$over" -eq 0 ]; then
  echo "预算判定：${MAX_TOTAL:-未设}/${MAX_GREP_SED:-未设}（总数/grep+sed）均在预算内"
fi

rm -rf "$WORK"
[ "$over" -eq 0 ] || exit 1
exit 0
