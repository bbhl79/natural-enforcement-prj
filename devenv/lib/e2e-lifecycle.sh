# shellcheck shell=bash
# ============================================================================
# e2e 生命周期决策引擎宿主桥（#106；被 devenv/devenv source，不直接执行）
#
# Spec-e2e §3 事实源分层 / §4 缺陷报告 schema / §10 命令面：
#   - 每缺陷一个入库 JSON（apps/e2e/defects/DEF-NNNN.json）是生命周期唯一事实源；
#     注册表（apps/e2e/.registry.json）是派生缓存，不入库，始终重建、漂移仅 WARN。
#   - 生命周期 CLI 是**纯决策引擎**（apps/e2e/src/cli.ts，容器内运行）：宿主树经
#     stdin tar 只读进容器 /tmp/in（无 bind 架构的读取通道），CLI 不落盘，写/删/
#     校验运行以 op 行协议输出，由本库在**宿主侧原子应用**（全有或全无）：
#       W\t<relpath>\t<base64>   写文件（relpath 相对 apps/e2e）
#       D\t<relpath>             删文件
#       V\t<id数字段>\t<expect>\t<b64>  校验运行载荷（devenv 真跑一次，expect=fail|pass）
#       END\t<status>\t<code>\t<message> 终值（status=ok|error）
#     V 判定不符 → exit 9 零落盘；END error → 透传码零落盘；拒绝原因透出 stderr。
#   - 原型坑收口（NOTES-e2e §5.2）：`set -e` + 命令替换会吞掉 END 行诊断——
#     先捕获 rc，再判协议：有 END 行按协议拒绝（透传码 + 消息），无 END 行 =
#     容器/构建问题（映射 exit 4，子进程码入 taskRc，不外逸枚举）。
#   - 生命周期写锁 per-worktree（mkdir 目录锁，lib/lock.sh；**不是 flock**）：
#     写命令从取锁到应用结束持同一把 e2e-lifecycle-<wt>（校验与写入之间无间隙）。
#     与栈锁/租约正交（决策命令不做栈变更）；V 校验运行所在的 run 另持栈租约。
#
# 退出码（COMMANDS.md 枚举）：0 成功 | 2 用法 | 3 环境未就绪 | 4 任务失败 |
#   5 超时 | 6 锁冲突 | 9 毕业校验运行判定不符 | 10 缺陷不存在或 schema 不符。
#   7/8 由后续票（#116 校验器 / #109 门禁）登记；END error 的码由引擎声明并透传。
# ============================================================================

# 事实源根（宿主）；DEVENV_E2E_LIFECYCLE_DIR 仅供离线测试注入临时树
E2E_LIFECYCLE_DIR="${DEVENV_E2E_LIFECYCLE_DIR:-$REPO_ROOT/apps/e2e}"
E2E_LIFECYCLE_REGISTRY=".registry.json"   # 派生缓存（.gitignore 排除，不入库）
E2E_LIFECYCLE_OPS=""                      # 本次 CLI 协议输出临时文件
E2E_LIFECYCLE_DATA=""                     # 查询命令的数据载荷（非协议行）
E2E_LIFECYCLE_REFUSAL=""                  # 拒绝原因（人类可读，透出 stderr/终值）
E2E_LIFECYCLE_TASK_RC=""                  # 容器侧原始退出码（诊断用，不外逸枚举）

e2e_lifecycle_write_lock() { # 生命周期写锁：per-worktree 排他（mkdir 基，非 flock）
  lock_acquire "e2e-lifecycle-$WT_SUFFIX" 60
}

# --- 容器桥：宿主树 stdin tar 只读进容器，协议 stdout 捕获到临时文件 -----------
e2e_lifecycle_cli() { # <args...> → 返回 CLI 退出码（不 die；协议输出入 $E2E_LIFECYCLE_OPS）
  ensure_fresh_workspace
  local -a tar_paths=()
  local p
  for p in defects replay tests "$E2E_LIFECYCLE_REGISTRY"; do
    if [[ -e "$E2E_LIFECYCLE_DIR/$p" ]]; then tar_paths+=("$p"); fi
  done
  E2E_LIFECYCLE_OPS="$(mktemp)"
  # 容器内脚本：解包到 /tmp/in（容器 overlay，只读语义——无宿主写通道），
  # exec 决策引擎；人类可读摘要走 stderr（不污染协议通道）。
  local inner='mkdir -p /tmp/in && tar -x -C /tmp/in && exec node /workspace/apps/e2e/dist/main.js --root /tmp/in "$@"'
  local rc=0
  if (( ${#tar_paths[@]} > 0 )); then
    (cd "$E2E_LIFECYCLE_DIR" && tar -cf - "${tar_paths[@]}") \
      | compose run --rm -T tools bash -c "$inner" _ "$@" > "$E2E_LIFECYCLE_OPS" || rc=$?
  else
    # 空树（绿地无缺陷记录）：空 tar 仍进容器，CLI 以空树工作
    tar -cf - -T /dev/null \
      | compose run --rm -T tools bash -c "$inner" _ "$@" > "$E2E_LIFECYCLE_OPS" || rc=$?
  fi
  return "$rc"
}

# 协议行提取用 awk（POSIX，macOS 可用）——不用 grep -P（BSD grep 无 -P，原型坑）
e2e_lifecycle_ops_end() { # <opsfile> → 最后一行 END（无则空）
  awk -F'\t' '$1=="END"{l=$0} END{if(l!="")print l}' "$1"
}

e2e_lifecycle_ops_has_end() { # <opsfile>
  awk -F'\t' '$1=="END"{found=1} END{exit found?0:1}' "$1"
}

e2e_lifecycle_data() { # <opsfile> → 查询数据行（非协议行；查询命令的数据直接走 stdout）
  awk -F'\t' '$1!="W" && $1!="D" && $1!="V" && $1!="END"' "$1"
}

# --- op 路径守卫：只允许 apps/e2e 内相对路径（协议不可写工作树之外）-----------
e2e_ops_path_check() { # <relpath> → 0 合法 / 1 越界
  local p="$1" seg
  [[ -n "$p" ]] || return 1
  [[ "$p" != /* ]] || return 1
  case "$p" in *$'\t'*|*$'\n'*|*$'\r'*) return 1 ;; esac
  local IFS='/'
  for seg in $p; do
    [[ "$seg" != ".." ]] || return 1
  done
  return 0
}

# 路径分量含符号链接即拒绝（防经 symlink 逃出 apps/e2e）
e2e_ops_path_symlink_check() { # <relpath> → 0 安全 / 1 有符号链接分量
  local rel="$1" acc="$E2E_LIFECYCLE_DIR" seg
  local IFS='/'
  for seg in $rel; do
    [[ -n "$seg" && "$seg" != "." ]] || continue
    acc="$acc/$seg"
    [[ ! -L "$acc" ]] || return 1
  done
  return 0
}

# --- V 载荷：宿主生成 .verify-run → tar 注入执行器 → 真跑一次 → 判定 -----------
e2e_verify_payload_run() { # <id数字段> <expect:fail|pass> <b64> → 0 判定相符 / 9 不符
  local vid="$1" expect="$2" b64="$3"
  [[ -n "${E2E_PROJECT:-}" && -n "${E2E_IMAGE_EFFECTIVE:-}" ]] \
    || die 3 "校验运行需要 per-run 隔离栈（api/worker/web + 执行器镜像）；V 载荷由毕业命令在 run 内驱动（#110）。修复：先起 run（devenv explore / 后续 graduate）"
  # 前置健康检查（v1 失败归因靠前置健康 + 日志判读，Spec-e2e 风险节）
  e2e_wait_healthy api 120
  local tmpd="$E2E_LIFECYCLE_DIR/.verify-run"
  rm -rf "$tmpd"
  mkdir -p "$tmpd" || die 4 "校验运行临时目录不可写：$tmpd"
  if ! printf '%s' "$b64" | openssl base64 -d -A > "$tmpd/def-$vid.verify.spec.ts" 2>/dev/null; then
    rm -rf "$tmpd"
    die 4 "V 载荷 base64 解码失败（def-${vid}）"
  fi
  ev step.started target="graduate verify-run" defect="$vid" expect="$expect"
  local rc=0
  (cd "$tmpd" && tar -cf - .) \
    | e2e_compose run --rm -T e2e bash -c \
      'mkdir -p /workspace/apps/e2e/.verify-run && tar -x -C /workspace/apps/e2e/.verify-run && cd /workspace/apps/e2e && pnpm --filter @ne/e2e exec playwright test --config=playwright.verify.config.ts' >&2 || rc=$?
  rm -rf "$tmpd"
  E2E_LIFECYCLE_TASK_RC="$rc"
  if [[ "$expect" == "fail" ]]; then
    if (( rc != 0 )); then
      ev step.completed target="graduate verify-run" verdict="reproduced" expect="$expect" taskRc="$rc"
      return 0
    fi
    ev step.completed target="graduate verify-run" verdict="did-not-fail" expect="$expect" taskRc="$rc"
    return 9
  fi
  if (( rc == 0 )); then
    ev step.completed target="graduate verify-run" verdict="passed" expect="$expect" taskRc="$rc"
    return 0
  fi
  ev step.completed target="graduate verify-run" verdict="still-failing" expect="$expect" taskRc="$rc"
  return 9
}

# --- 宿主侧原子应用：先 V 后 END 后 W/D；任一拒绝 → 零落盘 + 原因 --------------
e2e_ops_apply() { # <opsfile> → 0 已应用 / 非 0 拒绝码（原因入 E2E_LIFECYCLE_REFUSAL）
  local ops="$1"
  E2E_LIFECYCLE_REFUSAL=""
  local vline endline
  vline="$(awk -F'\t' '$1=="V"{print; exit}' "$ops")"
  endline="$(e2e_lifecycle_ops_end "$ops")"

  # 1) V 载荷先真跑：判定不符 → 9，工作区零改动
  if [[ -n "$vline" ]]; then
    local _t vid vexpect vb64 vrc=0
    IFS=$'\t' read -r _t vid vexpect vb64 <<<"$vline"
    e2e_verify_payload_run "$vid" "$vexpect" "$vb64" || vrc=$?
    if (( vrc != 0 )); then
      E2E_LIFECYCLE_REFUSAL="毕业校验运行判定不符（expect=${vexpect}，实际判定见上方 verdict 事件）——工作区零改动（全有或全无）"
      return 9
    fi
  fi

  # 2) END error → 透传引擎声明的退出码，零落盘
  if [[ -n "$endline" ]]; then
    local _t status code msg
    IFS=$'\t' read -r _t status code msg <<<"$endline"
    if [[ "$status" != "ok" ]]; then
      E2E_LIFECYCLE_REFUSAL="${msg:-生命周期引擎拒绝（无消息）}"
      return "${code:-8}"
    fi
  fi

  # 3) 收集 W/D：路径守卫 + 载荷预解码全部通过后才动工作树
  local -a kinds=() paths=() payloads=()
  local line op f1 f2
  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    IFS=$'\t' read -r op f1 f2 <<<"$line"
    case "$op" in W|D) ;; *) continue ;; esac
    if ! e2e_ops_path_check "$f1" || ! e2e_ops_path_symlink_check "$f1"; then
      E2E_LIFECYCLE_REFUSAL="op 路径越界或含符号链接（只允许 apps/e2e 内相对路径）：$f1——工作区零改动"
      return 4
    fi
    if [[ "$op" == "W" && ! "${f2:-}" =~ ^[A-Za-z0-9+/]*={0,2}$ ]]; then
      E2E_LIFECYCLE_REFUSAL="op 载荷非 base64：$f1——工作区零改动"
      return 4
    fi
    kinds+=("$op"); paths+=("$f1"); payloads+=("${f2:-}")
  done < <(awk -F'\t' '$1=="W"||$1=="D"{print}' "$ops")

  local n=${#kinds[@]}
  if (( n == 0 )); then
    note "生命周期引擎未产生文件操作（0 项）"
    return 0
  fi

  local stage backup
  stage="$(mktemp -d)" || die 4 "无法创建 op 暂存目录"
  backup="$(mktemp -d)" || { rm -rf "$stage"; die 4 "无法创建 op 备份目录"; }

  # 预解码到暂存区（解码失败 = 零落盘）
  local i rel
  for ((i = 0; i < n; i++)); do
    rel="${paths[$i]}"
    if [[ "${kinds[$i]}" == "W" ]]; then
      mkdir -p "$stage/$(dirname "$rel")" 2>/dev/null || { rm -rf "$stage" "$backup"; E2E_LIFECYCLE_REFUSAL="op 暂存目录创建失败：$rel"; return 4; }
      if ! printf '%s' "${payloads[$i]}" | openssl base64 -d -A > "$stage/$rel" 2>/dev/null; then
        rm -rf "$stage" "$backup"
        E2E_LIFECYCLE_REFUSAL="op 载荷解码失败：$rel——工作区零改动"
        return 4
      fi
    fi
  done

  # 备份既有目标（回滚依据）
  local -a existed=()
  local target
  for ((i = 0; i < n; i++)); do
    rel="${paths[$i]}"; target="$E2E_LIFECYCLE_DIR/$rel"
    if [[ -e "$target" ]]; then
      existed+=("1")
      mkdir -p "$backup/$(dirname "$rel")" 2>/dev/null && cp -p "$target" "$backup/$rel" 2>/dev/null || {
        rm -rf "$stage" "$backup"
        E2E_LIFECYCLE_REFUSAL="op 备份失败：$rel——工作区零改动"
        return 4
      }
    else
      existed+=("0")
    fi
  done

  # 应用；任一步失败 → 全量还原（不留半成品）
  local applied=0
  for ((i = 0; i < n; i++)); do
    rel="${paths[$i]}"; target="$E2E_LIFECYCLE_DIR/$rel"
    local ok=0
    if [[ "${kinds[$i]}" == "W" ]]; then
      if mkdir -p "$(dirname "$target")" 2>/dev/null && cp "$stage/$rel" "$target" 2>/dev/null; then ok=1; fi
    else
      rm -f "$target" 2>/dev/null && ok=1
    fi
    if (( ok == 0 )); then
      # 回滚 0..i（含失败项）：既有文件还原，新建文件删除
      local j r t
      for ((j = 0; j <= i; j++)); do
        r="${paths[$j]}"; t="$E2E_LIFECYCLE_DIR/$r"
        if [[ "${existed[$j]}" == "1" ]]; then
          mkdir -p "$(dirname "$t")" 2>/dev/null || true
          cp -p "$backup/$r" "$t" 2>/dev/null || true
        else
          rm -f "$t" 2>/dev/null || true
        fi
      done
      rm -rf "$stage" "$backup"
      E2E_LIFECYCLE_REFUSAL="op 应用失败（$rel）——工作区已全量还原（原子性：不留半成品）"
      return 4
    fi
    applied=$((applied + 1))
  done
  rm -rf "$stage" "$backup"
  note "生命周期落账：${applied} 项文件操作已原子应用到 apps/e2e/"
  return 0
}

# --- 写命令收口：写锁单一临界区 → CLI → 原子应用（拒绝即零落盘）---------------
e2e_lifecycle_write() { # <args...>：失败自终值 + 退出；成功返回 0
  e2e_lifecycle_write_lock
  local rc=0
  e2e_lifecycle_cli "$@" || rc=$?
  local ops="$E2E_LIFECYCLE_OPS"
  E2E_LIFECYCLE_TASK_RC="$rc"
  # 先捕获 rc 再判协议（set -e 不吞 END 诊断）：无 END = 容器/构建问题
  if (( rc != 0 )) && ! e2e_lifecycle_ops_has_end "$ops"; then
    rm -f "$ops"
    final failed 4 taskRc="$rc" hint="生命周期 CLI 异常退出（无 END 行——容器/构建问题？）"
    die 4 "生命周期 CLI 异常退出（exit ${rc}，无 END 行——容器/构建问题？）"
  fi
  local apply_rc=0
  e2e_ops_apply "$ops" || apply_rc=$?
  rm -f "$ops"
  if (( apply_rc != 0 )); then
    final failed "$apply_rc" reason="$E2E_LIFECYCLE_REFUSAL"
    die "$apply_rc" "$E2E_LIFECYCLE_REFUSAL"
  fi
  return 0
}

# --- 查询命令收口：数据入 E2E_LIFECYCLE_DATA；拒绝原因入 E2E_LIFECYCLE_REFUSAL --
# 注意：数据经全局变量回传，**不经函数 stdout**——ensure_fresh_workspace 的 JSONL
# 事件必须留在命令的结果流里，不能被查询数据的命令替换吞掉（输出协议三类）。
e2e_lifecycle_query() { # <args...> → 0 数据已入全局 / 非 0 拒绝码
  local rc=0
  E2E_LIFECYCLE_REFUSAL=""
  E2E_LIFECYCLE_DATA=""
  e2e_lifecycle_cli "$@" || rc=$?
  local ops="$E2E_LIFECYCLE_OPS"
  E2E_LIFECYCLE_TASK_RC="$rc"
  if (( rc != 0 )); then
    local endline
    endline="$(e2e_lifecycle_ops_end "$ops")"
    rm -f "$ops"
    if [[ -n "$endline" ]]; then
      local _t status code msg
      IFS=$'\t' read -r _t status code msg <<<"$endline"
      E2E_LIFECYCLE_REFUSAL="${msg:-生命周期引擎拒绝（无消息）}"
      return "${code:-$rc}"
    fi
    E2E_LIFECYCLE_REFUSAL="生命周期 CLI 异常退出（exit ${rc}，无 END 行——容器/构建问题？）"
    return 4
  fi
  E2E_LIFECYCLE_DATA="$(e2e_lifecycle_data "$ops")"
  rm -f "$ops"
  return 0
}

# 查询拒绝的统一收口：终值事件（机器可解析）+ stderr 原因 + 退出码
e2e_lifecycle_refuse() { # <code>
  local code="$1"
  final failed "$code" reason="$E2E_LIFECYCLE_REFUSAL" taskRc="$E2E_LIFECYCLE_TASK_RC"
  die "$code" "$E2E_LIFECYCLE_REFUSAL"
}

# --- 远端编号叠读（best-effort，经 devenv gh 入口；失败回退本地）---------------
e2e_remote_defect_max() { # <ref> → 远端 defects/ 下最大编号（十进制）；读不到返回非 0
  local ref="$1" names rc=0
  names="$( (cd "$REPO_ROOT" && gha_cmd_gh api "repos/{owner}/{repo}/contents/apps/e2e/defects?ref=$ref" --jq '.[].name') 2>/dev/null )" || rc=$?
  if (( rc != 0 )); then return 1; fi
  printf '%s\n' "$names" | awk '/^DEF-[0-9][0-9][0-9][0-9]\.json$/ { n=substr($0,5,4)+0; if(n>m)m=n } END{ print m+0 }'
}

# --- 命令面 -------------------------------------------------------------------
cmd_e2e_defect_show() {
  local id="${1:-}"
  [[ -n "$id" ]] || die 2 "缺 ID（用法：e2e defect show <DEF-NNNN>）"
  shift
  [[ $# -eq 0 ]] || die 2 "多余参数：$1（用法：e2e defect show <DEF-NNNN>）"
  [[ "$id" =~ ^DEF-[0-9]{4}$ ]] || die 2 "ID 格式应为 DEF-NNNN：$id"
  local -a qargs=(defect show "$id")
  (( JSON )) && qargs+=(--json)
  local rc=0
  e2e_lifecycle_query "${qargs[@]}" || rc=$?
  if (( rc != 0 )); then e2e_lifecycle_refuse "$rc"; fi
  local data="$E2E_LIFECYCLE_DATA"
  if (( JSON )); then
    printf '%s' "$data" | jq -e . >/dev/null 2>&1 || die 4 "生命周期引擎输出非 JSON（协议通道被污染？）"
    jq -n --argjson defect "$data" \
      '{command:"e2e",subcommand:"defect",action:"show",status:"ok",exitCode:0,defect:$defect}'
  else
    printf '%s\n' "$data"
  fi
}

cmd_e2e_defect_list() {
  [[ $# -eq 0 ]] || die 2 "多余参数：$1（用法：e2e defect list）"
  local -a qargs=(defect list)
  (( JSON )) && qargs+=(--json)
  local rc=0
  e2e_lifecycle_query "${qargs[@]}" || rc=$?
  if (( rc != 0 )); then e2e_lifecycle_refuse "$rc"; fi
  local data="$E2E_LIFECYCLE_DATA"
  if (( JSON )); then
    printf '%s' "$data" | jq -e 'type == "array"' >/dev/null 2>&1 || die 4 "生命周期引擎输出非缺陷数组（协议通道被污染？）"
    jq -n --argjson defects "$data" \
      '{command:"e2e",subcommand:"defect",action:"list",status:"ok",exitCode:0,defects:$defects}'
  else
    printf '%s\n' "$data"
  fi
}

cmd_e2e_defect_next_id() { # 取号：本地 max+1；--remote 叠读远端已有编号（best-effort）
  local remote=0 ref="${DEVENV_E2E_NUMBER_REMOTE_REF:-dev}"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --remote) remote=1; shift ;;
      --remote-ref) ref="${2:?--remote-ref 需要值}"; shift 2 ;;
      *) die 2 "未知参数：$1（用法：e2e defect next-id [--remote] [--remote-ref REF]）" ;;
    esac
  done
  local rmax="" rstatus="skipped"
  if (( remote )); then
    if rmax="$(e2e_remote_defect_max "$ref")"; then
      rstatus="ok"
    else
      rmax=""; rstatus="unavailable"
      warn "远端编号叠读失败（ref=${ref}，best-effort）：只用本地 max+1；撞号由后合入方机械重排（#116 renumber）"
    fi
  fi
  local -a qargs=(next-id)
  (( JSON )) && qargs+=(--json)
  if [[ -n "$rmax" ]]; then qargs+=(--remote-max "$rmax"); fi
  local rc=0
  e2e_lifecycle_query "${qargs[@]}" || rc=$?
  if (( rc != 0 )); then e2e_lifecycle_refuse "$rc"; fi
  local data="$E2E_LIFECYCLE_DATA"
  if (( JSON )); then
    printf '%s' "$data" | jq -e '.id' >/dev/null 2>&1 || die 4 "生命周期引擎取号输出非法（协议通道被污染？）"
    jq -n --argjson r "$data" --arg ref "$ref" --arg rs "$rstatus" \
      '{command:"e2e",subcommand:"defect",action:"next-id",status:"ok",exitCode:0,
        id:$r.id,localMax:$r.localMax,remoteMax:$r.remoteMax,remoteRef:$ref,remoteStatus:$rs}'
  else
    printf '%s\n' "$(printf '%s' "$data" | jq -r '.id' 2>/dev/null || printf '%s' "$data")"
  fi
}

cmd_e2e_defect() {
  local action="${1:-}"
  [[ -n "$action" ]] || die 2 "用法：e2e defect <show <ID>|list|next-id [--remote]>"
  shift
  case "$action" in
    show)    cmd_e2e_defect_show "$@" ;;
    list)    cmd_e2e_defect_list "$@" ;;
    next-id) cmd_e2e_defect_next_id "$@" ;;
    *) die 2 "未知 defect 动作：${action}（当前：show | list | next-id）" ;;
  esac
}

cmd_e2e_registry_rebuild() { # 注册表 = 派生缓存：始终重建；漂移仅 WARN，不硬门禁
  [[ $# -eq 0 ]] || die 2 "多余参数：$1（用法：e2e registry rebuild）"
  local reg="$E2E_LIFECYCLE_DIR/$E2E_LIFECYCLE_REGISTRY"
  local had=0 before="" after="" drift="no"
  if [[ -f "$reg" ]]; then
    had=1
    before="$(sha256sum "$reg" | awk '{print $1}')"
  fi
  e2e_lifecycle_write registry rebuild
  if [[ -f "$reg" ]]; then after="$(sha256sum "$reg" | awk '{print $1}')"; fi
  if (( had )) && [[ "$before" != "$after" ]]; then drift="yes"; fi
  if [[ "$drift" == "yes" ]]; then
    warn "注册表缓存过期或被手改，已自动重建；完整性以入库缺陷记录（apps/e2e/defects/*.json）与 git 历史为准（漂移不作硬门禁）"
  fi
  local count="0"
  if [[ -f "$reg" ]]; then count="$(jq '.defects | length' "$reg" 2>/dev/null || printf '0')"; fi
  ev registry.rebuilt drift="$drift" defects="$count" path="$reg"
  note "注册表已重建（派生缓存，不入库）：${reg}（${count} 条）"
  final ok 0 drift="$drift" defects="$count"
}

cmd_e2e_registry() {
  local action="${1:-}"
  [[ -n "$action" ]] || die 2 "用法：e2e registry rebuild"
  shift
  case "$action" in
    rebuild) cmd_e2e_registry_rebuild "$@" ;;
    *) die 2 "未知 registry 动作：${action}（当前：rebuild）" ;;
  esac
}