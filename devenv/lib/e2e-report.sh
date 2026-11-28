# shellcheck shell=bash
# ============================================================================
# e2e report 实测复现门禁与缺陷登记（#109；被 devenv/devenv source，不直接执行）
#
# Spec-e2e §5「门禁由 report 命令**实测**（起隔离栈跑 replayCommand N 次，回填
# gate 证据），非自查申报」/ GLOSSARY「复现门禁：次数是检查预算而非证明」：
#   - 按**被测路径**分类：kind=pure → 1 轮；kind=external-state → ≥3 轮，
#     **每轮一个独立 run id → 独立库/bucket/队列键空间**（#70 机制），每轮从
#     明确前置状态开始（空库 DROP FORCE+CREATE → migrate deploy → 空桶/空队列）。
#   - 逐轮失败签名经 #108 同一原语比对（同一断言处因同一原因失败）；任一轮不符
#     或 errorClass=unknown/infrastructure → **门禁不过 exit 8、零登记**。
#   - 并发缺陷的 replayCommand 须保留触发操作顺序与时序条件（载荷 concurrency
#     声明；约定见 COMMANDS.md「e2e report」节）。
#
# 三段式（决策在容器内纯引擎，落盘在宿主原子应用）：
#   ① report plan     只读事实源取号 + 门禁下限 + 脚本字节（此时脚本尚未入库）
#   ② 宿主实测 N 轮   复用 #108 per-run 编排（命名/准入/所有权/登记册/回收）
#   ③ report register 携实测轮次 → 判定 → 过则记录+脚本+缓存同一事务原子应用
#
# 并发：门禁轮次持 stack-<wt> **共享租约**（全程）+ 每轮 e2e-owner/e2e-admit；
#   登记持 e2e-lifecycle-<wt> **排他写锁**（取锁到 op 应用结束同一临界区）。
#   锁序：stack 租约 → lifecycle 写锁（无反向持有者，故无环）。
#
# 退出码：0 登记成功 | 2 用法/输入契约 | 3 环境未就绪 | 4 任务失败（容器/落盘）|
#   5 超时 | 6 锁/租约冲突 | 8 **门禁未过或前置不符**（零登记）| 10 事实源损坏。
# ============================================================================

E2E_REPORT_REFUSAL=""     # 拒绝原因（人类可读）
E2E_REPORT_ID=""          # 本次取号结果
E2E_REPORT_KIND=""        # 被测路径分类
E2E_REPORT_MIN=""         # 门禁下限（引擎按 kind 给出）
E2E_REPORT_CMD=""         # 容器内可执行 replayCommand（{ID} 已替换）
E2E_REPORT_SCRIPT_REL=""  # 脚本入库相对路径（相对 apps/e2e）
E2E_REPORT_TITLE=""       # 缺陷标题（留痕）
E2E_REPORT_PRECOND=""     # 前置状态声明（压平，供留痕）
E2E_REPORT_VERDICT=""     # 引擎判定证据（单行紧凑 JSON）
E2E_REPORT_FINDING=""     # 发现载荷（单行紧凑 JSON；--from-results 已合并属性发现）
E2E_REPORT_SCRIPT_B64=""  # 计划输出的脚本字节（base64；实测与入库同一份）
E2E_REPORT_DATA=""        # 查询命令的数据载荷（非协议行）

# 每轮**实际建立**的前置状态（#70 机制；与载荷声明互为证据）
E2E_REPORT_PRECOND_ESTABLISHED='空库（DROP DATABASE WITH FORCE + CREATE）→ prisma migrate deploy 至最新 → 空 bucket → 空队列键空间；无种子数据'

# --- 引擎桥：树 tar + 载荷**同一 stdin 通道**（report 既需事实源又需发现载荷）---
# #108 签名桥只送载荷（无状态）；report 的取号/编号占用核对/缓存重建都需事实源树，
# 故把载荷作为 tar 成员 `.report-payload.json` 与树同批只读进容器，容器内解包后
# 以该成员为 stdin  exec 引擎（--root 指向解包目录）。无 bind 架构的读取通道不变。
E2E_REPORT_OPS=""

e2e_report_cli() { # <payload-file> <args...> → 引擎退出码（协议输出入 $E2E_REPORT_OPS）
  local payload="$1"; shift
  [[ -n "${WS_IMAGE_EFFECTIVE:-}" ]] || die 3 "report 引擎需要 workspace 镜像（先 ensure_fresh_workspace）"
  local tarfile stagedir p
  tarfile="$(mktemp)" || die 4 "无法创建 report 树 tar 临时文件"
  stagedir="$(mktemp -d)" || { rm -f "$tarfile"; die 4 "无法创建 report 载荷暂存目录"; }
  if ! cp "$payload" "$stagedir/.report-payload.json"; then
    rm -rf "$stagedir"; rm -f "$tarfile"; die 4 "report 载荷暂存失败：$payload"
  fi
  local -a tar_paths=()
  for p in defects replay tests "$E2E_LIFECYCLE_REGISTRY"; do
    if [[ -e "$E2E_LIFECYCLE_DIR/$p" ]]; then tar_paths+=("$p"); fi
  done
  if (( ${#tar_paths[@]} > 0 )); then
    (cd "$E2E_LIFECYCLE_DIR" && tar -cf "$tarfile" "${tar_paths[@]}") \
      || { rm -rf "$stagedir"; rm -f "$tarfile"; die 4 "report 事实源树打包失败"; }
  else
    tar -cf "$tarfile" -T /dev/null \
      || { rm -rf "$stagedir"; rm -f "$tarfile"; die 4 "report 空树打包失败"; }
  fi
  (cd "$stagedir" && tar -rf "$tarfile" .report-payload.json) \
    || { rm -rf "$stagedir"; rm -f "$tarfile"; die 4 "report 载荷入 tar 失败"; }
  rm -rf "$stagedir"
  E2E_REPORT_OPS="$(mktemp)"
  local inner='mkdir -p /tmp/in && tar -x -C /tmp/in && exec node /workspace/apps/e2e/dist/main.js --root /tmp/in "$@" < /tmp/in/.report-payload.json'
  local rc=0
  compose run --rm -T tools bash -c "$inner" _ "$@" < "$tarfile" > "$E2E_REPORT_OPS" || rc=$?
  rm -f "$tarfile"
  return "$rc"
}

# 查询收口（先捕获 rc 再判协议，set -e 不吞 END 诊断）：数据入 E2E_REPORT_DATA
e2e_report_query() { # <payload-file> <args...> → 0 数据已入全局 / 非 0 拒绝码
  local payload="$1"; shift
  local rc=0
  E2E_REPORT_REFUSAL=""
  E2E_REPORT_DATA=""
  e2e_report_cli "$payload" "$@" || rc=$?
  local ops="$E2E_REPORT_OPS"
  if (( rc != 0 )); then
    local endline
    endline="$(e2e_lifecycle_ops_end "$ops")"
    rm -f "$ops"
    if [[ -n "$endline" ]]; then
      local _t status code msg
      IFS=$'\t' read -r _t status code msg <<<"$endline"
      E2E_REPORT_REFUSAL="${msg:-report 引擎拒绝（无消息）}"
      if [[ ! "$code" =~ ^[0-9]+$ ]] || (( code == 0 )); then code="$rc"; fi
      return "$code"
    fi
    E2E_REPORT_REFUSAL="report 引擎异常退出（exit ${rc}，无 END 行——容器/构建问题？）"
    return 4
  fi
  E2E_REPORT_DATA="$(e2e_lifecycle_data "$ops")"
  rm -f "$ops"
  return 0
}

# --- 发现载荷装配（--from-results 时经引擎提取 #107 属性发现附件）--------------
e2e_report_load_finding() { # <finding-file> <from-results|-> <property|-> → 0 载荷入 E2E_REPORT_FINDING
  local file="$1" results="$2" property="$3" rc=0
  [[ -f "$file" ]] || die 2 "发现载荷文件不存在：$file（用法：e2e report --finding <file.json>）"
  E2E_REPORT_FINDING="$(jq -c . "$file")" || die 2 "发现载荷非合法 JSON：$file"
  if [[ "$results" != "-" ]]; then
    [[ -f "$results" ]] || die 2 "results.json 不存在：$results"
    local -a fargs=(report finding-from-results)
    if [[ "$property" != "-" ]]; then fargs+=(--property "$property"); fi
    e2e_report_query "$results" "${fargs[@]}" || rc=$?
    if (( rc != 0 )); then return "$rc"; fi
    local pf
    pf="$(printf '%s\n' "$E2E_REPORT_DATA" | awk -F'\t' '$1=="FINDING"{print $2}')"
    if [[ -z "$pf" ]]; then
      E2E_REPORT_REFUSAL="引擎未输出属性发现数据线（协议通道被污染？）"
      return 4
    fi
    # --from-results 的 provenance 即属性发现：source 随之定型（seed/反例无损携带）
    E2E_REPORT_FINDING="$(printf '%s' "$E2E_REPORT_FINDING" \
      | jq -c --argjson pf "$pf" '.finding = $pf | .source = "property-finding"')" \
      || { E2E_REPORT_REFUSAL="发现载荷与属性发现合并失败"; return 2; }
  fi
  return 0
}

# --- ① 计划：取号 + 门禁下限 + 脚本字节（只读事实源，零落盘）-------------------
e2e_report_plan() { # <remote-max> → 0 计划入 E2E_REPORT_* / 非 0 拒绝码
  local rmax="$1" payload rc=0
  payload="$(mktemp)" || die 4 "无法创建 report 计划载荷临时文件"
  jq -cn --argjson finding "$E2E_REPORT_FINDING" --arg rmax "$rmax" \
    '{finding:$finding,remoteMax:($rmax|tonumber)}' > "$payload" || { rm -f "$payload"; die 4 "report 计划载荷装配失败"; }
  e2e_report_query "$payload" report plan || rc=$?
  rm -f "$payload"
  if (( rc != 0 )); then return "$rc"; fi
  local line k v
  E2E_REPORT_ID=""; E2E_REPORT_KIND=""; E2E_REPORT_MIN=""; E2E_REPORT_CMD=""
  E2E_REPORT_SCRIPT_REL=""; E2E_REPORT_TITLE=""; E2E_REPORT_PRECOND=""
  E2E_REPORT_SCRIPT_B64=""
  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    IFS=$'\t' read -r k v <<<"$line"
    case "$k" in
      ID) E2E_REPORT_ID="$v" ;;
      KIND) E2E_REPORT_KIND="$v" ;;
      ATTEMPTS) E2E_REPORT_MIN="$v" ;;
      CMD) E2E_REPORT_CMD="$v" ;;
      SCRIPT) E2E_REPORT_SCRIPT_REL="$v" ;;
      SCRIPT_B64) E2E_REPORT_SCRIPT_B64="$v" ;;
      TITLE) E2E_REPORT_TITLE="$v" ;;
      PRECONDITION) E2E_REPORT_PRECOND="$v" ;;
    esac
  done <<<"$E2E_REPORT_DATA"
  if [[ -z "$E2E_REPORT_ID" || -z "$E2E_REPORT_CMD" || -z "$E2E_REPORT_SCRIPT_B64" ]]; then
    E2E_REPORT_REFUSAL="report 计划缺 ID/replayCommand/脚本字节（引擎协议不完整）"
    return 4
  fi
  return 0
}

# --- ② 单轮实测：脚本注入执行器（与入库同一份字节）→ 跑 replayCommand ----------
# 脚本此时尚未入库（门禁在登记前实测）：经 stdin tar 注入容器 overlay 的入库路径，
# 使实测行使的正是登记后 `node apps/e2e/replay/<ID>.mjs` 那条命令。无 bind 架构。
e2e_report_run_script() { # <outdir> <script-staging-dir> <filename> → 脚本退出码
  local outdir="$1" stagedir="$2" fname="$3" rc=0
  (cd "$stagedir" && tar -cf - "$fname") \
    | e2e_compose run --rm -T e2e bash -c \
      'mkdir -p /workspace/apps/e2e/replay && tar -x -C /workspace/apps/e2e/replay && cd /workspace && exec bash -c "$1"' \
      _ "$E2E_REPORT_CMD" \
      > "$outdir/replay.out" 2> "$outdir/replay.err" || rc=$?
  # 脚本 stdout 是签名载荷通道（落盘后交引擎提取）；人类诊断走 stderr（输出协议）
  if [[ -s "$outdir/replay.err" ]]; then cat "$outdir/replay.err" >&2; fi
  if [[ -s "$outdir/replay.out" ]]; then cat "$outdir/replay.out" >&2; fi
  return "$rc"
}

# --- ③ 登记：生命周期写锁单一临界区 → 引擎判定 → 宿主原子应用 ------------------
e2e_report_register() { # <payload-file> → 0 已登记 / 非 0 拒绝码（原因入 E2E_REPORT_REFUSAL）
  local payload="$1" rc=0
  E2E_REPORT_REFUSAL=""
  E2E_REPORT_VERDICT=""
  e2e_lifecycle_write_lock
  e2e_report_cli "$payload" report register || rc=$?
  local ops="$E2E_REPORT_OPS"
  # 先捕获 rc 再判协议（set -e 不吞 END 诊断）：无 END = 容器/构建问题
  if (( rc != 0 )) && ! e2e_lifecycle_ops_has_end "$ops"; then
    rm -f "$ops"
    E2E_REPORT_REFUSAL="report 引擎异常退出（exit ${rc}，无 END 行——容器/构建问题？）"
    return 4
  fi
  E2E_REPORT_VERDICT="$(awk -F'\t' '$1=="GATE"{print $2}' "$ops")"
  local apply_rc=0
  e2e_ops_apply "$ops" || apply_rc=$?
  rm -f "$ops"
  if (( apply_rc != 0 )); then E2E_REPORT_REFUSAL="$E2E_LIFECYCLE_REFUSAL"; fi
  return "$apply_rc"
}

# --- 运行登记册关联（登记成功后才写：门禁不过零登记，亦不留缺陷关联）-----------
e2e_report_associate_runs() { # <id> <rounds-json-file>
  local id="$1" rounds="$2" rid tmp
  while IFS= read -r rid; do
    [[ -n "$rid" ]] || continue
    local reg="$E2E_REGISTRY_DIR/$rid.json"
    [[ -f "$reg" ]] || continue
    tmp="$E2E_REGISTRY_DIR/.$rid.$$.tmp"
    if jq --arg id "$id" '. + {defectId:$id, gateRole:"report-gate-round"}' "$reg" > "$tmp" 2>/dev/null; then
      mv "$tmp" "$reg"
    else
      rm -f "$tmp"
      warn "运行登记册关联写入失败（跳过）：$reg"
    fi
  done < <(jq -r '.runId' "$rounds")
}

# --- 命令面 -------------------------------------------------------------------
cmd_e2e_report() { # e2e report --finding <file> [--from-results <results.json>] [--property NAME]
                   #            [--attempts N] [--run-id BASE] [--by WHO] [--remote] [--remote-ref REF]
  local finding_file="" from_results="-" property="-" attempts="" base="" by="" remote=0
  local ref="${DEVENV_E2E_NUMBER_REMOTE_REF:-dev}"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --finding) finding_file="${2:?--finding 需要值}"; shift 2 ;;
      --from-results) from_results="${2:?--from-results 需要值}"; shift 2 ;;
      --property) property="${2:?--property 需要值}"; shift 2 ;;
      --attempts) attempts="${2:?--attempts 需要值}"; shift 2 ;;
      --run-id) base="${2:?--run-id 需要值}"; shift 2 ;;
      --by) by="${2:?--by 需要值}"; shift 2 ;;
      --remote) remote=1; shift ;;
      --remote-ref) ref="${2:?--remote-ref 需要值}"; shift 2 ;;
      *) die 2 "未知参数：$1（用法：e2e report --finding <file.json> [--from-results <results.json>] [--attempts N]）" ;;
    esac
  done
  [[ -n "$finding_file" ]] || die 2 "缺 --finding <file.json>（发现载荷：report 的唯一输入面）"
  if [[ -n "$attempts" ]]; then
    [[ "$attempts" =~ ^[1-9][0-9]*$ ]] || die 2 "--attempts 需为正整数（当前：${attempts}）"
  fi
  [[ -n "$by" ]] || by="${NE_AGENT:-${USER:-unknown}}"

  # 1) 栈使用租约 + 共享基础设施 + 镜像（门禁轮次全生命周期持租约，#61）
  lease_acquire "stack-$WT_SUFFIX" 120
  require_services db redis rustfs
  ensure_fresh_workspace
  e2e_build_image "$ENSURE_SNAPSHOT_HASH"

  # 2) 发现载荷（--from-results 时经引擎提取属性发现）+ 远端编号叠读（best-effort）
  local load_rc=0
  e2e_report_load_finding "$finding_file" "$from_results" "$property" || load_rc=$?
  if (( load_rc != 0 )); then
    final failed "$load_rc" reason="$E2E_REPORT_REFUSAL"
    die "$load_rc" "$E2E_REPORT_REFUSAL"
  fi
  local rmax=0 rstatus="skipped" rnames=""
  if (( remote )); then
    if rnames="$(e2e_remote_defect_max "$ref")"; then rmax="$rnames"; rstatus="ok"
    else rmax=0; rstatus="unavailable"
      warn "远端编号叠读失败（ref=${ref}，best-effort）：只用本地 max+1；撞号由后合入方机械重排（#116 renumber）"
    fi
  fi

  # 3) 计划（只读事实源取号；输入契约违规 → 2，事实源损坏 → 10，零资源创建）
  local plan_rc=0
  e2e_report_plan "$rmax" || plan_rc=$?
  if (( plan_rc != 0 )); then
    final failed "$plan_rc" reason="$E2E_REPORT_REFUSAL"
    die "$plan_rc" "$E2E_REPORT_REFUSAL"
  fi
  local id="$E2E_REPORT_ID" kind="$E2E_REPORT_KIND" min="$E2E_REPORT_MIN"
  [[ -n "$attempts" ]] || attempts="$min"
  if (( attempts < min )); then
    final failed 2 reason="门禁轮次低于被测路径下限" kind="$kind" attempts="$attempts" minAttempts="$min"
    die 2 "--attempts ${attempts} 低于 kind=${kind} 的门禁下限 ${min}（次数是检查预算不是证明，不得下调）"
  fi
  [[ -n "$base" ]] || base="rpt-${WT_SUFFIX}-$(date +%s)-${RANDOM}"
  e2e_run_id_validate "$base"
  if (( ${#base} + 4 > 40 )); then
    die 2 "--run-id 过长（${#base} 字符）：每轮追加 -a<k> 后超出 run id 上限 40，请缩短"
  fi

  # 4) 脚本暂存（gitignored 证据区外的临时目录；实测与入库同一份字节）
  local stagedir scriptfile script_sha
  stagedir="$(mktemp -d)" || die 4 "无法创建脚本暂存目录"
  scriptfile="$stagedir/$(basename "$E2E_REPORT_SCRIPT_REL")"
  if ! printf '%s' "$E2E_REPORT_SCRIPT_B64" | openssl base64 -d -A > "$scriptfile" 2>/dev/null; then
    rm -rf "$stagedir"
    die 4 "计划脚本字节 base64 解码失败（$id）"
  fi
  script_sha="$(sha256sum "$scriptfile" | awk '{print $1}')"

  note "登记 ${id}：${E2E_REPORT_TITLE}"
  note "门禁：kind=${kind}（按被测路径分类），下限 ${min} 轮，本次 ${attempts} 轮独立键空间；操作者 ${by}"
  note "前置状态声明：${E2E_REPORT_PRECOND}"
  note "replayCommand：${E2E_REPORT_CMD}（脚本 sha256=${script_sha:0:12}…；exit 0 = 复现）"
  ev step.started target="report gate" defect="$id" kind="$kind" attempts="$attempts" minAttempts="$min"

  # 5) 逐轮实测（每轮独立 run id → 独立库/bucket/队列；轮次间串行）
  local rounds_file k rid rc sig_rc sig_json verdict status code err_class
  rounds_file="$(mktemp)" || { rm -rf "$stagedir"; die 4 "无法创建门禁轮次汇总临时文件"; }
  local infra_seen=0 export_failed=0 reproduced_all=1
  for ((k = 1; k <= attempts; k++)); do
    rid="${base}-a${k}"
    e2e_derive_names "$rid" "report"
    E2E_ACTIVE_RUN_ID=""
    mkdir -p "$E2E_RUN_DIR" || { rm -rf "$stagedir"; die 4 "run 产物目录不可写：$E2E_RUN_DIR"; }
    e2e_admission_begin
    note "门禁轮次 ${k}/${attempts}：run=${rid} db=${E2E_DB_NAME} bucket=${E2E_BUCKET} queue=${E2E_QUEUE_NAME}（独立键空间）"

    e2e_connect_infra
    ev step.started target="e2e database" runId="$rid" attempt="$k"
    e2e_db_purge
    e2e_migrate
    ev step.completed target="e2e database" runId="$rid" attempt="$k" precondition="fresh-database+migrate-deploy+empty-bucket+empty-queue"
    e2e_stack_start

    ev step.started target="report gate round" defect="$id" runId="$rid" attempt="$k"
    rc=0
    e2e_report_run_script "$E2E_RUN_DIR" "$stagedir" "$(basename "$scriptfile")" || rc=$?

    sig_rc=0
    e2e_signature_query "$E2E_RUN_DIR/replay.out" signature extract --source replay || sig_rc=$?
    if (( sig_rc != 0 )); then
      warn "签名提取被拒（退出码 ${sig_rc}）：${E2E_SIG_REFUSAL}——本轮按无签名处理（不编造）"
      sig_json='null'
    else
      sig_json="$(printf '%s' "$E2E_SIG_DATA" | jq -c '.signature // null' 2>/dev/null || printf 'null')"
    fi
    err_class="$(printf '%s' "$sig_json" | jq -r '.errorClass // "null"' 2>/dev/null || printf 'null')"
    if (( rc == 2 )) || [[ "$err_class" == "infrastructure" ]]; then
      verdict="infrastructure"; status="failed"; code=8; infra_seen=1
    elif (( rc == 0 )); then
      verdict="reproduced"; status="ok"; code=0
    else
      verdict="not-reproduced"; status="failed"; code=8; reproduced_all=0
    fi
    ev step.completed target="report gate round" defect="$id" runId="$rid" attempt="$k" \
      verdict="$verdict" scriptExitCode="$rc" errorClass="$err_class"

    # 本轮证据（与 #108 replay.json 同形，记录 evidence URI 指向此处）
    jq -cn --arg defectId "$id" --arg attempt "$k" --arg runId "$rid" \
      --arg replayCommand "$E2E_REPORT_CMD" --arg scriptExitCode "$rc" \
      --arg verdict "$verdict" --arg kind "$kind" --arg precondition "$E2E_REPORT_PRECOND_ESTABLISHED" \
      --arg database "$E2E_DB_NAME" --arg bucket "$E2E_BUCKET" --arg queue "$E2E_QUEUE_NAME" \
      --argjson signature "$sig_json" \
      '{schemaVersion:1,defectId:$defectId,attempt:($attempt|tonumber),runId:$runId,
        replayCommand:$replayCommand,kind:$kind,scriptExitCode:($scriptExitCode|tonumber),
        verdict:$verdict,precondition:$precondition,
        keySpace:{database:$database,bucket:$bucket,queue:$queue},signature:$signature}' \
      > "$E2E_RUN_DIR/replay.json" || warn "replay.json 写入失败：$E2E_RUN_DIR/replay.json"

    local export_rc=0
    e2e_export_artifacts || export_rc=$?
    if (( export_rc != 0 )); then
      warn "门禁产物导出失败（退出码 ${export_rc}）：$E2E_RUN_DIR"
      export_failed=1
      if [[ "$status" == "ok" ]]; then status="failed"; code=8; fi
    fi
    e2e_write_manifest "$rc" "$status" || warn "run.json 写入失败：$E2E_RUN_DIR/run.json"

    printf '%s\n' "$(jq -cn --arg attempt "$k" --arg runId "$rid" --arg scriptExitCode "$rc" \
      --arg precondition "$E2E_REPORT_PRECOND_ESTABLISHED" \
      --arg database "$E2E_DB_NAME" --arg bucket "$E2E_BUCKET" --arg queue "$E2E_QUEUE_NAME" \
      --argjson signature "$sig_json" \
      '{attempt:($attempt|tonumber),runId:$runId,scriptExitCode:($scriptExitCode|tonumber),
        precondition:$precondition,keySpace:{database:$database,bucket:$bucket,queue:$queue},
        signature:$signature}')" >> "$rounds_file"

    e2e_teardown
    e2e_registry_write "$status" "$code"
    E2E_ACTIVE_RUN_ID=""
    lock_release_one "$(e2e_owner_lock_name)"
  done
  rm -rf "$stagedir"

  local rounds
  rounds="$(jq -s '.' "$rounds_file")"
  ev step.completed target="report gate" defect="$id" kind="$kind" attempts="$attempts" \
    reproducedAll="$([[ $reproduced_all == 1 ]] && printf true || printf false)" \
    infrastructureSeen="$([[ $infra_seen == 1 ]] && printf true || printf false)"

  # 6) 登记（生命周期写锁临界区；门禁不过 → 8 零落盘）
  local reg_payload reg_rc=0 measured_at
  measured_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  reg_payload="$(mktemp)" || { rm -f "$rounds_file"; die 4 "无法创建登记载荷临时文件"; }
  jq -cn --argjson finding "$E2E_REPORT_FINDING" --arg id "$id" --argjson rounds "$rounds" \
    --arg measuredAt "$measured_at" --arg scriptSha256 "$script_sha" --arg rmax "$rmax" --arg by "$by" \
    '{finding:($finding + (if ($finding.discoveredBy // "") == "" then {discoveredBy:$by} else {} end)
                          + (if ($finding.discoveredAt // "") == "" then {discoveredAt:$measuredAt} else {} end)),
      id:$id,remoteMax:($rmax|tonumber),
      gate:{rounds:$rounds,measuredAt:$measuredAt,scriptSha256:$scriptSha256}}' \
    > "$reg_payload" || { rm -f "$rounds_file" "$reg_payload"; die 4 "登记载荷装配失败"; }
  ev step.started target="report register" defect="$id"
  e2e_report_register "$reg_payload" || reg_rc=$?
  rm -f "$reg_payload"

  local gate_json="null"
  if [[ -n "$E2E_REPORT_VERDICT" ]]; then gate_json="$E2E_REPORT_VERDICT"; fi

  # 7) 终值与退出码（门禁不过 → 8，零登记；环境/落盘问题保持各自码段）
  local final_code=0 final_status="ok" registered="false" hint=""
  if (( reg_rc == 0 )); then
    registered="true"
    e2e_report_associate_runs "$id" "$rounds_file"
    ev step.completed target="report register" defect="$id" verdict="registered"
    hint="已登记 ${id}（reported）：apps/e2e/defects/${id}.json + apps/e2e/replay/${id}.mjs（同一 commit 入库；issue 回链位留空，写入归 #114）"
  else
    final_code="$reg_rc"; final_status="failed"
    if (( reg_rc == 8 )); then
      ev step.completed target="report register" defect="$id" verdict="gate-failed"
      hint="门禁未过或前置不符——**零登记**（工作区无改动）：核对各轮 .artifacts/e2e/<run-id>/replay.json 的 signature 与 verdict；次数是检查预算不是证明，每轮须同一断言处因同一原因失败"
    else
      ev step.completed target="report register" defect="$id" verdict="refused" exitCode="$reg_rc"
      hint="$E2E_REPORT_REFUSAL"
    fi
  fi
  if (( export_failed == 1 )) && (( reg_rc == 0 )); then
    note "WARN: 部分轮次产物导出失败——记录已登记，但证据 URI 可能不可解析（核对 .artifacts/e2e/）"
  fi
  rm -f "$rounds_file"

  if (( JSON )); then
    jq -cn --arg status "$final_status" --arg exitCode "$final_code" --arg defectId "$id" \
      --arg kind "$kind" --arg attempts "$attempts" --arg min "$min" --arg registered "$registered" \
      --arg hint "$hint" --arg reason "$E2E_REPORT_REFUSAL" --arg remoteStatus "$rstatus" \
      --arg recordPath "apps/e2e/defects/${id}.json" --arg replayPath "apps/e2e/${E2E_REPORT_SCRIPT_REL}" \
      --argjson gate "$gate_json" --argjson runs "$rounds" \
      '{command:"e2e",subcommand:"report",status:$status,exitCode:($exitCode|tonumber),
        defectId:$defectId,kind:$kind,attempts:($attempts|tonumber),minAttempts:($min|tonumber),
        registered:($registered=="true"),recordPath:$recordPath,replayPath:$replayPath,
        remoteNumbering:$remoteStatus,gate:$gate,runs:$runs,reason:$reason,hint:$hint}'
  fi
  if (( final_code != 0 )); then
    note "$hint"
    note "证据：各轮 .artifacts/e2e/<run-id>/（replay.out/replay.err/replay.json/run.json/logs/）"
    exit "$final_code"
  fi
  note "$hint"
  note "门禁证据已回填 reproducibility.gate（轮次/键空间/逐轮签名比对/前置状态声明）"
  note "证据：各轮 .artifacts/e2e/<run-id>/；运行登记册 .devenv-state/e2e-runs/<run-id>.json（defectId 关联）"
}