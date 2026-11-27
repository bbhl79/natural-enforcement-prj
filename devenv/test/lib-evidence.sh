# shellcheck shell=bash
# ============================================================================
# 集成测试证据助手（被 devenv/test/*.test.sh source，不直接执行）
#
# 用途：为 GitHub App 认证验收获批项（spec #23 项 10 j–m，issue #55）留存
# 真实命令、退出码与 GitHub 侧证据。
#
# 安全约束：
#   - 证据文件只记录命令文本、退出码与 stdout/stderr 捕获；调用方保证被记录
#     的命令行本身不含 token（devenv 入口的 token 只经环境变量传递，见
#     lib/github-app-auth.sh）。
#   - 泄露扫描的活 token 只经内存与 stdin 传递（grep -f -），不写文件、
#     不进命令参数、不进日志。
# ============================================================================

EV_DIR=""

ev_init() { # ev_init <dir>
  EV_DIR="$1"
  mkdir -p "$EV_DIR"
  : > "$EV_DIR/evidence.log"
  ev_log "evidence dir: $EV_DIR"
}

ev_log_file() { # 仅写 evidence.log（结果行用，避免 stderr 重复）
  [[ -n "$EV_DIR" ]] && printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >> "$EV_DIR/evidence.log"
  return 0
}

ev_log() { # 时间戳行 → stderr + evidence.log
  local line="$*"
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$line" >&2
  ev_log_file "$line"
}

# ev_run <label> <cmd...>：执行命令，stdout/stderr 捕获到 <label>.out/.err，
# 证据日志记录命令与退出码；返回命令退出码。
# 命令经 printf %q 逐参数引用记录，参数边界可还原（含空格/特殊字符的参数
# 不会与相邻参数混淆）。
ev_run() {
  local label="$1"; shift
  local rc=0 quoted
  "$@" > "$EV_DIR/$label.out" 2> "$EV_DIR/$label.err" || rc=$?
  printf -v quoted '%q ' "$@"
  ev_log "cmd[$label]: ${quoted% } → rc=$rc"
  return "$rc"
}

# ev_ancestry：记录当前进程链（pid + comm），供验收项 j 判定会话宿主
# （正常启动的 IDE 插件 / 终端 / 其他编排器由指挥者据证据判定）。
ev_ancestry() {
  local p=$$ ppid comm
  ev_log "ancestry (from pid $$):"
  while [[ -n "$p" && "$p" != "0" && "$p" != "1" ]]; do
    read -r ppid comm < <(ps -o ppid=,comm= -p "$p" 2>/dev/null) || break
    [[ -n "${comm:-}" ]] || break
    ev_log "  pid=$p comm=$comm"
    p="$ppid"
  done
}

# ev_scan_paths <token|-> <path...>：泄露扫描（fail-closed）。返回码：
#   0 = 三类扫描全部完成且无命中
#   1 = 存在命中（证据日志逐条记录 LEAK 行）
#   2 = 扫描失败（grep rc>=2：路径缺失/不可读等；证据日志记录 SCAN-ERROR，
#       调用方不得视为通过）
# 三类扫描：
#   1. 活 token 精确值（stdin 传给 grep -F，不进 argv/文件）
#   2. installation token 通用形态（ghs_ 前缀，-E）
#   3. PEM 私钥标记（-----BEGIN ... PRIVATE KEY-----，-E）
# 覆盖仓库全部明文内容（含 .git 的 config/reflog 等明文文件；压缩对象为
# 二进制，grep -I 自动跳过）。
# 模式串经拼接构造，使本文件自身不含可被扫描命中的字面量。
ev_scan_paths() {
  local token="$1"; shift
  local hits=0 f rc out
  local pat_tok='gh''s_[A-Za-z0-9]{20,}'
  local pat_pem='-----BEGIN [A-Z ]*PRIVATE'' KEY-----'
  if [[ "$token" != "-" && -n "$token" ]]; then
    out=$(printf '%s' "$token" | grep -rIFl -f - "$@" 2>&1) && rc=0 || rc=$?
    if [[ $rc -ge 2 ]]; then
      ev_log "SCAN-ERROR: 活 token 精确值扫描失败（grep rc=${rc}）：$out"; return 2
    elif [[ $rc -eq 0 ]]; then
      while IFS= read -r f; do
        ev_log "LEAK: 活 token 精确值出现于 $f"; hits=1
      done <<< "$out"
    fi
  fi
  out=$(grep -rIEl -- "$pat_tok" "$@" 2>&1) && rc=0 || rc=$?
  if [[ $rc -ge 2 ]]; then
    ev_log "SCAN-ERROR: installation token 形态扫描失败（grep rc=${rc}）：$out"; return 2
  elif [[ $rc -eq 0 ]]; then
    while IFS= read -r f; do
      ev_log "LEAK: installation token 形态（ghs_…）出现于 $f"; hits=1
    done <<< "$out"
  fi
  out=$(grep -rIEl -- "$pat_pem" "$@" 2>&1) && rc=0 || rc=$?
  if [[ $rc -ge 2 ]]; then
    ev_log "SCAN-ERROR: PEM 私钥标记扫描失败（grep rc=${rc}）：$out"; return 2
  elif [[ $rc -eq 0 ]]; then
    while IFS= read -r f; do
      ev_log "LEAK: PEM 私钥标记出现于 $f"; hits=1
    done <<< "$out"
  fi
  [[ "$hits" == 0 ]]
}
