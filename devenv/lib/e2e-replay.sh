# shellcheck shell=bash
# ============================================================================
# e2e replay 重放编排（#108；被 devenv/devenv source，不直接执行）
#
# Spec-e2e §4「replayCommand：exit 0 = 复现，修复后语义自动反转」/ §5「门禁每次
# 从明确前置状态开始、同一断言处因同一原因失败」/ §7「失败签名闭环」：
#   - `devenv e2e replay <ID>` 起**隔离栈**真跑记录内 replayCommand：复用 #70
#     per-run 机制（e2e_derive_names / admission / owner 锁 / 运行登记册 / teardown）
#     与 #61 共享栈使用租约；不复活原型单项目 compose/profile 模式。
#   - 每轮 attempt 一个**独立 run id → 独立库/bucket/队列键空间**：replay 会写数据，
#     同库重复 attempt 撞 name 唯一约束（409）会伪装成「未复现」（note 04 §3 坑）。
#   - 判定：全部轮次 exit 0 = 复现（本命令 exit 0）；未复现 → exit 4 + 语义反转提示
#     「环境漂移或已修复？」；基础设施错误 → exit 3（环境未就绪，**不是**未复现）；
#     未知 ID / 非法记录 / 复现脚本缺失 → exit 10。
#   - 失败签名：每轮从脚本输出按约定提取（哨兵行 NE-E2E-SIGNATURE），多轮经**同一
#     比对原语**（apps/e2e/src/signature/）判定「同一断言处因同一原因失败」——
#     该原语为 #109 门禁与 #112 CI 判定共用（本地与 CI 同一判定器）。
#   - 诊断与修复确认共用同一命令：本命令**只读事实源**，不改缺陷记录（门禁回填归
#     #109 report，修复确认归 #111 confirm-fix）。
#
# 签名引擎桥：载荷走 **stdin**（不是 #106 的树 tar 通道），协议字节格式与
# e2e-lifecycle.sh 完全一致（W/D/V/END + 数据行），复用其 END/数据行解析助手。
# ============================================================================

E2E_SIG_OPS=""          # 本次签名引擎协议输出临时文件
E2E_SIG_DATA=""         # 签名引擎结果（单行紧凑 JSON）
E2E_SIG_REFUSAL=""      # 拒绝原因（人类可读）
E2E_REPLAY_ID=""        # 本次重放的缺陷 ID
E2E_REPLAY_CMD=""       # 记录内 replayCommand（容器内可执行）
E2E_REPLAY_KIND=""      # 被测路径分类 pure|external-state
E2E_REPLAY_GATE_MIN=""  # 门禁下限（供 #109 消费；本命令默认只跑 1 轮）
E2E_REPLAY_SCRIPT=""    # 复现脚本仓库相对路径
E2E_REPLAY_TITLE=""     # 缺陷标题（人类可读留痕）

# --- 签名引擎桥（stdin 载荷通道）---------------------------------------------
# 前置：调用方已 ensure_fresh_workspace（WS_IMAGE_EFFECTIVE 已绑定）；本函数不
# 重复采集快照——多轮重放里每轮都采集会无谓拖慢且可能撞工作树变化拒绝。
e2e_signature_cli() { # <payload-file> <args...> → 引擎退出码（协议输出入 $E2E_SIG_OPS）
  local payload="$1"; shift
  [[ -n "${WS_IMAGE_EFFECTIVE:-}" ]] || die 3 "签名引擎需要 workspace 镜像（先 ensure_fresh_workspace）"
  E2E_SIG_OPS="$(mktemp)"
  local inner='exec node /workspace/apps/e2e/dist/main.js "$@"'
  local rc=0
  compose run --rm -T tools bash -c "$inner" _ "$@" < "$payload" > "$E2E_SIG_OPS" || rc=$?
  return "$rc"
}

# 收口口径与 e2e_lifecycle_query 一致：先捕获 rc 再判协议（set -e 不吞 END 诊断）；
# 无 END 行 = 容器/构建问题 → 4（子进程码不外逸枚举）。
e2e_signature_query() { # <payload-file> <args...> → 0 结果入 E2E_SIG_DATA / 非 0 拒绝码
  local payload="$1"; shift
  local rc=0
  E2E_SIG_REFUSAL=""
  E2E_SIG_DATA=""
  e2e_signature_cli "$payload" "$@" || rc=$?
  local ops="$E2E_SIG_OPS"
  if (( rc != 0 )); then
    local endline
    endline="$(e2e_lifecycle_ops_end "$ops")"
    rm -f "$ops"
    if [[ -n "$endline" ]]; then
      local _t status code msg
      IFS=$'\t' read -r _t status code msg <<<"$endline"
      E2E_SIG_REFUSAL="${msg:-签名引擎拒绝（无消息）}"
      if [[ ! "$code" =~ ^[0-9]+$ ]] || (( code == 0 )); then code="$rc"; fi
      return "$code"
    fi
    E2E_SIG_REFUSAL="签名引擎异常退出（exit ${rc}，无 END 行——容器/构建问题？）"
    return 4
  fi
  E2E_SIG_DATA="$(e2e_lifecycle_data "$ops")"
  rm -f "$ops"
  return 0
}

# --- 重放计划（只读事实源，经 #106 决策引擎；未知 ID/非法记录 → 10）-----------
e2e_replay_plan() { # <ID> → 0 计划入 E2E_REPLAY_* / 非 0 拒绝码（原因入 E2E_LIFECYCLE_REFUSAL）
  local id="$1" rc=0
  local -a qargs=(replay-plan "$id")
  e2e_lifecycle_query "${qargs[@]}" || rc=$?
  if (( rc != 0 )); then return "$rc"; fi
  local data="$E2E_LIFECYCLE_DATA" line k v
  E2E_REPLAY_ID="$id"
  E2E_REPLAY_CMD=""; E2E_REPLAY_KIND=""; E2E_REPLAY_GATE_MIN=""; E2E_REPLAY_SCRIPT=""; E2E_REPLAY_TITLE=""
  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    IFS=$'\t' read -r k v <<<"$line"
    case "$k" in
      CMD) E2E_REPLAY_CMD="$v" ;;
      KIND) E2E_REPLAY_KIND="$v" ;;
      ATTEMPTS) E2E_REPLAY_GATE_MIN="$v" ;;
      SCRIPT) E2E_REPLAY_SCRIPT="$v" ;;
      TITLE) E2E_REPLAY_TITLE="$v" ;;
    esac
  done <<<"$data"
  if [[ -z "$E2E_REPLAY_CMD" ]]; then
    E2E_LIFECYCLE_REFUSAL="重放计划缺 replayCommand（事实源损坏？）：$id"
    return 10
  fi
  return 0
}

# --- 单轮重放：在 per-run 执行器内跑 replayCommand，捕获输出与退出码 -----------
e2e_replay_run_script() { # <outdir> → 脚本退出码（stdout/stderr 落盘，诊断分流 stderr）
  local outdir="$1" rc=0
  # 脚本 stdout 是签名载荷通道（落盘后交引擎提取）；人类诊断走 stderr（输出协议）
  e2e_compose run --rm -T e2e bash -c "$E2E_REPLAY_CMD" \
    > "$outdir/replay.out" 2> "$outdir/replay.err" || rc=$?
  if [[ -s "$outdir/replay.err" ]]; then cat "$outdir/replay.err" >&2; fi
  if [[ -s "$outdir/replay.out" ]]; then cat "$outdir/replay.out" >&2; fi
  return "$rc"
}

# --- 命令面 -------------------------------------------------------------------
cmd_e2e_replay() { # e2e replay <DEF-NNNN> [--attempts N] [--run-id BASE]
  local id="" attempts="" base=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --attempts) attempts="${2:?--attempts 需要值}"; shift 2 ;;
      --run-id) base="${2:?--run-id 需要值}"; shift 2 ;;
      -*) die 2 "未知参数：$1（用法：e2e replay <DEF-NNNN> [--attempts N] [--run-id BASE]）" ;;
      *)
        [[ -z "$id" ]] || die 2 "多余参数：$1（用法：e2e replay <DEF-NNNN> [--attempts N]）"
        id="$1"; shift ;;
    esac
  done
  [[ -n "$id" ]] || die 2 "缺 ID（用法：e2e replay <DEF-NNNN> [--attempts N] [--run-id BASE]）"
  [[ "$id" =~ ^DEF-[0-9]{4}$ ]] || die 2 "ID 格式应为 DEF-NNNN：$id"
  if [[ -n "$attempts" ]]; then
    [[ "$attempts" =~ ^[1-9][0-9]*$ ]] || die 2 "--attempts 需为正整数（当前：${attempts}）"
  fi

  # 1) 重放计划（只读事实源；未知 ID/非法记录/脚本缺失 → 10，零资源创建）
  local plan_rc=0
  e2e_replay_plan "$id" || plan_rc=$?
  if (( plan_rc != 0 )); then e2e_lifecycle_refuse "$plan_rc"; fi
  [[ -n "$attempts" ]] || attempts=1   # 默认单轮（诊断/修复确认）；门禁预算由 #109 显式传入
  [[ -n "$base" ]] || base="rep-${WT_SUFFIX}-$(date +%s)-${RANDOM}"
  e2e_run_id_validate "$base"
  # 每轮 run id = <base>-a<k>：长度须仍满足 run id 上限（40）
  if (( ${#base} + 4 > 40 )); then
    die 2 "--run-id 过长（${#base} 字符）：每轮追加 -a<k> 后超出 run id 上限 40，请缩短"
  fi
  note "重放 ${id}：${E2E_REPLAY_TITLE}（kind=${E2E_REPLAY_KIND}，门禁下限 ${E2E_REPLAY_GATE_MIN} 轮，本次 ${attempts} 轮）"
  note "replayCommand：${E2E_REPLAY_CMD}（零第三方依赖脚本随记录入库；exit 0 = 复现）"

  # 2) 栈使用租约 + 共享基础设施 + 镜像（run 全生命周期持租约，#61）
  lease_acquire "stack-$WT_SUFFIX" 120
  require_services db redis rustfs
  ensure_fresh_workspace
  e2e_build_image "$ENSURE_SNAPSHOT_HASH"

  local rounds_file attempt rid rc sig_rc sig_json verdict status code
  rounds_file="$(mktemp)" || die 4 "无法创建重放轮次汇总临时文件"
  local infra_seen=0 reproduced_all=1 export_failed=0 k
  for ((k = 1; k <= attempts; k++)); do
    attempt="$k"
    rid="${base}-a${k}"
    e2e_derive_names "$rid" "replay"
    E2E_ACTIVE_RUN_ID=""
    mkdir -p "$E2E_RUN_DIR" || die 4 "run 产物目录不可写：$E2E_RUN_DIR"
    e2e_admission_begin   # 所有权 + 并发上限（含启动预留）→ 登记 running
    note "重放轮次 ${k}/${attempts}：run=${rid} db=${E2E_DB_NAME} bucket=${E2E_BUCKET} queue=${E2E_QUEUE_NAME}（独立键空间，前置状态明确）"

    e2e_connect_infra
    ev step.started target="e2e database" runId="$rid" attempt="$k"
    e2e_db_purge
    e2e_migrate
    ev step.completed target="e2e database" runId="$rid" attempt="$k"
    e2e_stack_start

    ev step.started target="replay" defect="$id" runId="$rid" attempt="$k"
    rc=0
    e2e_replay_run_script "$E2E_RUN_DIR" || rc=$?

    # 3) 签名提取（约定哨兵行；无标记 → signature=null，不编造）
    sig_rc=0
    e2e_signature_query "$E2E_RUN_DIR/replay.out" signature extract --source replay || sig_rc=$?
    if (( sig_rc != 0 )); then
      warn "签名提取被拒（退出码 ${sig_rc}）：${E2E_SIG_REFUSAL}——本轮按无签名处理（不编造）"
      sig_json='null'
    else
      sig_json="$(printf '%s' "$E2E_SIG_DATA" | jq -c '.signature // null' 2>/dev/null || printf 'null')"
    fi

    # 4) 本轮判定：退出码是权威（0 复现 / 2 基础设施 / 其余未复现）；标记的
    #    errorClass=infrastructure 同样归环境档（脚本自述与退出码互为证据）
    local err_class="null"
    err_class="$(printf '%s' "$sig_json" | jq -r '.errorClass // "null"' 2>/dev/null || printf 'null')"
    if (( rc == 2 )) || [[ "$err_class" == "infrastructure" ]]; then
      verdict="infrastructure"; status="failed"; code=3; infra_seen=1
    elif (( rc == 0 )); then
      verdict="reproduced"; status="ok"; code=0
    else
      verdict="not-reproduced"; status="failed"; code=4; reproduced_all=0
    fi
    ev step.completed target="replay" defect="$id" runId="$rid" attempt="$k" \
      verdict="$verdict" scriptExitCode="$rc" errorClass="$err_class"

    # 5) 本轮证据落盘（gitignored 证据区）+ 产物导出 + run.json + 回收
    jq -cn --arg defectId "$id" --arg attempt "$k" --arg runId "$rid" \
      --arg replayCommand "$E2E_REPLAY_CMD" --arg scriptExitCode "$rc" \
      --arg verdict "$verdict" --arg kind "$E2E_REPLAY_KIND" \
      --argjson signature "$sig_json" \
      '{schemaVersion:1,defectId:$defectId,attempt:($attempt|tonumber),runId:$runId,
        replayCommand:$replayCommand,kind:$kind,scriptExitCode:($scriptExitCode|tonumber),
        verdict:$verdict,signature:$signature}' \
      > "$E2E_RUN_DIR/replay.json" || warn "replay.json 写入失败：$E2E_RUN_DIR/replay.json"
    local export_rc=0
    e2e_export_artifacts || export_rc=$?
    if (( export_rc != 0 )); then
      warn "重放产物导出失败（退出码 ${export_rc}）：$E2E_RUN_DIR"
      export_failed=1
      if [[ "$status" == "ok" ]]; then status="failed"; code=4; fi
    fi
    e2e_write_manifest "$rc" "$status" || warn "run.json 写入失败：$E2E_RUN_DIR/run.json"

    printf '%s\n' "$(jq -cn --arg runId "$rid" --arg attempt "$k" --arg scriptExitCode "$rc" \
      --arg verdict "$verdict" --arg artifacts "$E2E_RUN_DIR" --argjson signature "$sig_json" \
      '{runId:$runId,attempt:($attempt|tonumber),scriptExitCode:($scriptExitCode|tonumber),
        verdict:$verdict,artifacts:$artifacts,signature:$signature}')" >> "$rounds_file"

    e2e_teardown
    e2e_registry_write "$status" "$code"
    E2E_ACTIVE_RUN_ID=""
    lock_release_one "$(e2e_owner_lock_name)"   # 回收结束后才释放本轮所有权
  done

  # 6) 多轮签名比对（同一原语；单轮无从比对 → null，不是 true）
  local rounds sig_match="null" compare_reason="n/a"
  rounds="$(jq -s '.' "$rounds_file")"
  rm -f "$rounds_file"
  if (( attempts > 1 )); then
    local cmp_payload cmp_rc=0
    cmp_payload="$(mktemp)" || die 4 "无法创建签名比对载荷临时文件"
    printf '%s' "$rounds" | jq -c '{baseline:(.[0].signature // null),candidates:[.[1:][].signature // null]}' > "$cmp_payload"
    e2e_signature_query "$cmp_payload" signature compare || cmp_rc=$?
    rm -f "$cmp_payload"
    if (( cmp_rc != 0 )); then
      warn "签名比对被拒（退出码 ${cmp_rc}）：${E2E_SIG_REFUSAL}——按不匹配处理（无证据不得判同一失败）"
      sig_match="false"; compare_reason="compare-refused"
    else
      sig_match="$(printf '%s' "$E2E_SIG_DATA" | jq -r '.allMatched' 2>/dev/null || printf 'false')"
      compare_reason="$(printf '%s' "$E2E_SIG_DATA" | jq -r '.reason' 2>/dev/null || printf 'unknown')"
    fi
    ev replay.signatures defect="$id" attempts="$attempts" allMatched="$sig_match" reason="$compare_reason"
  fi

  # 7) 终值与退出码（语义反转提示是诊断/修复确认共用的关键口径）
  local hint="" final_code=0 final_status="ok" reproduced="false"
  (( reproduced_all == 1 )) && reproduced="true"
  if (( infra_seen == 1 )); then
    final_code=3; final_status="failed"
    hint="基础设施错误（连接失败/超时/服务不健康）——不是「未复现」：先按证据修运行环境（logs/ 与 run.json），再重放"
  elif (( reproduced_all == 0 )); then
    final_code=4; final_status="failed"
    hint="未复现：环境漂移或已修复？（修复确认后走 confirm-fix 摘预期失败注解；记录与脚本永不删除）"
  elif [[ "$sig_match" == "false" ]]; then
    final_code=4; final_status="failed"
    hint="多轮失败签名不一致或缺失（不是同一断言处因同一原因失败）：核对各轮 replay.json 的 signature；脚本须按失败输出约定打 NE-E2E-SIGNATURE 标记"
  elif (( export_failed == 1 )); then
    final_code=4; final_status="failed"
    hint="重放已复现但产物导出失败——无法留存证据，判任务失败（与 explore 同口径）"
  fi

  local terminal
  terminal="$(jq -cn --arg defectId "$id" --arg status "$final_status" --arg exitCode "$final_code" \
    --arg replayCommand "$E2E_REPLAY_CMD" --arg kind "$E2E_REPLAY_KIND" --arg gateMin "$E2E_REPLAY_GATE_MIN" \
    --arg attempts "$attempts" --arg reproduced "$reproduced" --arg sigMatched "$sig_match" \
    --arg compareReason "$compare_reason" --arg hint "$hint" --argjson runs "$rounds" \
    '{command:"e2e",subcommand:"replay",status:$status,exitCode:($exitCode|tonumber),
      defectId:$defectId,replayCommand:$replayCommand,kind:$kind,gateMinAttempts:($gateMin|tonumber),
      attempts:($attempts|tonumber),reproduced:($reproduced=="true"),
      signatureMatched:(if $sigMatched=="null" then null else ($sigMatched=="true") end),
      compareReason:$compareReason,hint:$hint,runs:$runs}')"
  printf '%s\n' "$terminal"

  if (( final_code != 0 )); then
    note "$hint"
    note "证据：各轮 .artifacts/e2e/<run-id>/（replay.out/replay.err/replay.json/run.json/logs/）"
    exit "$final_code"
  fi
  if [[ "$sig_match" == "null" ]]; then
    note "复现成功（${attempts} 轮全部 exit 0）：${id}"
  else
    note "复现成功（${attempts} 轮全部 exit 0，签名比对 allMatched=${sig_match}）：${id}"
  fi
  note "证据：各轮 .artifacts/e2e/<run-id>/（replay.json 含本轮签名）"
}