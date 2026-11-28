# shellcheck shell=bash
# ============================================================================
# dev 分支保护两层规则集漂移核对（#73；Spec-工程基座 §7 Git 规范）
#
# 事实源：devenv/rulesets/*.json（保存配置，随分支走）↔ GitHub 实时规则集。
# 两层设计：
#   - protect-dev-base     基础层：PR + 必需检查（quality-gate，锁定来自
#                          github-actions integration 15368）+ 禁删/禁强推，
#                          无任何绕过名单（含指挥者——直推/强推一律拒）。
#   - protect-dev-approval 审批层：1 个批准 + 新推送使旧批准失效；绕过名单仅
#                          点名指挥者（User 3615225）且 bypass_mode=pull_request
#                          （仅 PR 合入时可绕过，直推不可）。
# 绕过只存在于审批层——基础层的 PR/检查要求对所有人（含绕过者）恒成立，
# 这正是拆两层而不是单规则集的原因（详见 docs/adr/ 分支保护两层规则集）。
#
# bypass_actors 可见性（实测口径，fail 方向如实拆分公开面与管理员面）：
#   - GitHub 只对具备规则集写权限（Administration）的调用者返回 bypass_actors；
#     匿名、App installation token、CI GITHUB_TOKEN 均不可见。
#   - 默认（公开面）模式：响应含 bypass_actors 时严格比对；不含时跳过该字段
#     并记录 NOTE（不谎报「已核对绕过名单」，也不死锁 CI）。
#   - BP_REQUIRE_BYPASS_ACTORS=1（管理员强校验，指挥者带管理员
#     BP_GITHUB_TOKEN 运行）：任一被核对规则集缺失 bypass_actors 一律 fail
#     closed 判漂移。
#   - 公开面的绕过名单间接覆盖：响应的 current_user_can_bypass 存在且非
#     never → 判漂移（读取身份意外获得绕过权）。
# ============================================================================
BP_API="${BP_API:-https://api.github.com}"
BP_RULESETS_DIR="${BP_RULESETS_DIR:-$REPO_ROOT/devenv/rulesets}"
# 持久（durable）规则集 = dev 两层 + archive 标签保护层（#74），进 CI 常驻核对；
# 其余保存文件（验收期 transient 测试分支对）只在受控验收 harness 中核对，不进日常门禁。
BP_DURABLE_RULESETS=(protect-dev-base protect-dev-approval protect-archive-tags)
# archive 标签保护代表性 ref（额外 tag 规则集覆盖面判定用；模式 refs/tags/archive/* 命中）
BP_ARCHIVE_PROBE_REF="refs/tags/archive/probe"
BP_ARCHIVE_PROBE_BARE="archive/probe"

# 发现（漂移）与提示（未核对/非阻断）双桶；BP_ECHO_FINDINGS=1 时同步 echo 到
# stdout（命令替换子进程捕获用——env 前缀只作用于子进程，不影响进程内调用方
# 的结构化 stdout 协议）。
bp_add_finding() { BP_FINDINGS+=("$1"); [[ "${BP_ECHO_FINDINGS:-0}" == "1" ]] && printf '%s\n' "$1"; return 0; }
bp_add_note()    { BP_NOTES+=("$1");     [[ "${BP_ECHO_FINDINGS:-0}" == "1" ]] && printf 'NOTE: %s\n' "$1"; return 0; }

bp_repo() { # 仓库全名（身份声明文件，非敏感，随分支走）
  local repo
  repo=$(jq -r '.repositories[0] // empty' "$REPO_ROOT/devenv/github-app.json" 2>/dev/null) \
    || { warn "无法读取 devenv/github-app.json（身份声明）"; return 3; }
  [[ -n "$repo" ]] || { warn "devenv/github-app.json 缺 repositories[0]"; return 3; }
  printf '%s' "$repo"
}

bp_api_get() { # bp_api_get <path> → stdout JSON；非 2xx/传输失败 rc!=0（fail closed）
  local path="$1" token="${BP_GITHUB_TOKEN:-${GITHUB_TOKEN:-}}"
  if [[ -n "$token" ]]; then
    # token 经 stdin 交 curl（-H @-），不进 argv/不落盘（同 github-app-auth 约定）
    printf 'Authorization: Bearer %s\n' "$token" | curl -sf --max-time 30 -H @- \
      -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
      "$BP_API$path"
  else
    curl -sf --max-time 30 \
      -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
      "$BP_API$path"
  fi
}

bp_norm_ruleset() { # stdin 规则集 JSON → stdout 归一化语义视图（排序，可比对）
  jq -Sc '{
    name: .name,
    target: .target,
    enforcement: .enforcement,
    include: ((.conditions.ref_name.include // []) | sort),
    exclude: ((.conditions.ref_name.exclude // []) | sort),
    rules: ([(.rules // [])[] | {type, parameters: (.parameters // null)}] | sort_by(.type)),
    bypass_actors: ([(.bypass_actors // [])[] | {actor_type, actor_id, bypass_mode}]
      | sort_by((.actor_type // "") + ":" + ((.actor_id // 0) | tostring)))
  }'
}

bp_ref_matches_pattern() { # <full-ref> <bare-name> <pattern> → 0 匹配
  # 规则集 ref_name 模式语义（如实近似，宁过报不漏报）：
  #   ~DEFAULT_BRANCH → 匹配默认分支（调用方以 bare 名传入）；
  #   ~ALL → 匹配所有 ref（UI「Include all branches」）；
  #   全 ref 形（refs/heads/dev）与裸名形（dev）都尝试；glob 按原样匹配。
  # 注意：[[ == ]] 右侧引号会使比较退化为字面串（bash 手册行为），模式变量
  # 不加引号才启用 glob 语义（[[ ]] 内无分词，安全）。
  local ref="$1" bare="$2" pat="$3"
  [[ -z "$pat" ]] && return 1
  case "$pat" in
    "~DEFAULT_BRANCH") [[ "$ref" == "refs/heads/$bare" || "$ref" == "$bare" ]] && return 0; return 1 ;;
    "~ALL") return 0 ;;
  esac
  # shellcheck disable=SC2053
  [[ "$ref" == $pat ]] && return 0
  # shellcheck disable=SC2053
  [[ "$bare" == $pat ]] && return 0
  return 1
}

bp_ruleset_covers_ref() { # <ruleset-json> <full-ref> <bare-name> → 0 覆盖 | 1 不覆盖 | 2 解析失败
  local json="$1" ref="$2" bare="$3" pats
  pats=$(jq -r '(.conditions.ref_name.include // []) | .[]' <<< "$json" 2>/dev/null) || return 2
  local covered=0 p
  while IFS= read -r p; do
    [[ -z "$p" ]] && continue
    if bp_ref_matches_pattern "$ref" "$bare" "$p"; then covered=1; break; fi
  done <<< "$pats"
  (( covered )) || return 1
  while IFS= read -r p; do
    [[ -z "$p" ]] && continue
    bp_ref_matches_pattern "$ref" "$bare" "$p" && return 1
  done < <(jq -r '(.conditions.ref_name.exclude // []) | .[]' <<< "$json" 2>/dev/null)
  return 0
}

# bp_compare_ruleset <label> <saved-file> <live-json>：
#   核心字段（name/target/enforcement/条件/规则）严格比对；bypass_actors 按
#   可见性优先于内容处理（见文件头）。rc：0 一致 | 1 漂移 | 3 无法核对（保存/实时侧失效）。
bp_compare_ruleset() {
  local label="$1" saved_file="$2" live_json="$3"
  local saved_norm live_norm
  if ! saved_norm=$(bp_norm_ruleset < "$saved_file" 2>/dev/null); then
    bp_add_finding "$label：保存配置 $saved_file 缺失或解析失败——无法核对（fail closed）"
    return 3
  fi
  if ! live_norm=$(printf '%s' "$live_json" | bp_norm_ruleset 2>/dev/null); then
    bp_add_finding "$label：实时响应解析失败（非 JSON/结构异常）——无法核对（fail closed）"
    return 3
  fi

  local rc=0 s l field
  # 核心字段（不含 bypass_actors）逐段比对
  for field in name target enforcement include exclude; do
    s=$(jq -r --arg f "$field" 'getpath([$f]) | tojson' <<< "$saved_norm")
    l=$(jq -r --arg f "$field" 'getpath([$f]) | tojson' <<< "$live_norm")
    [[ "$s" != "$l" ]] && { bp_add_finding "$label：$field 不一致（保存=$s 实际=$l）"; rc=1; }
  done
  s=$(jq -r '.rules | tojson' <<< "$saved_norm"); l=$(jq -r '.rules | tojson' <<< "$live_norm")
  if [[ "$s" != "$l" ]]; then
    bp_add_finding "$label：规则集内容不一致——保存值：$s / 实际值：$l（含规则类型差异与参数差异）"
    rc=1
  fi

  # bypass_actors：可见性判断先于内容比对（字段缺失 ≠ 空名单——保存侧为 []
  # 时同样按缺失处理：公开面记 NOTE 未核对；强校验 fail closed）
  s=$(jq -r '.bypass_actors | tojson' <<< "$saved_norm")
  if ! printf '%s' "$live_json" | jq -e 'has("bypass_actors")' >/dev/null 2>&1; then
    if [[ "${BP_REQUIRE_BYPASS_ACTORS:-0}" == "1" ]]; then
      bp_add_finding "$label：管理员强校验模式下实际响应不含 bypass_actors（保存配置预期 $s）——fail closed 判漂移；确认读取凭据具备 Administration"
      rc=1
    else
      bp_add_note "$label：bypass_actors 对当前读取身份不可见——该字段未核对（非管理员面）。绕过名单靠指挥者管理员核对（--require-bypass-actors）+ App current_user_can_bypass=never + 行为验收覆盖"
    fi
  else
    l=$(jq -r '.bypass_actors | tojson' <<< "$live_norm")
    if [[ "$s" != "$l" ]]; then
      bp_add_finding "$label：绕过名单不一致（保存=$s 实际=$l）"
      rc=1
    fi
  fi
  return "$rc"
}

# bp_check_drift <ruleset-names...>：主核对。fetch 实时 → 比对保存 →
#   发现（BP_FINDINGS/BP_NOTES，同时 echo stdout）。rc：0 一致 | 1 漂移 |
#   3 无法核查（fetch/解析失败，优先级高于漂移，不降级）。
bp_check_drift() {
  local names=("$@") repo default_branch list
  repo=$(bp_repo) || return 3
  if ! default_branch=$(bp_api_get "/repos/$repo" | jq -r '.default_branch // empty'); then
    bp_add_finding "无法读取仓库默认分支（GET /repos/$repo 失败）——fail closed，不判一致"
    return 3
  fi
  [[ -n "$default_branch" ]] || { bp_add_finding "默认分支响应缺失字段"; return 3; }
  if ! list=$(bp_api_get "/repos/$repo/rulesets"); then
    bp_add_finding "无法读取规则集列表（GET /repos/$repo/rulesets 失败）——fail closed，不判一致"
    return 3
  fi
  if ! printf '%s' "$list" | jq -e 'type == "array"' >/dev/null 2>&1; then
    bp_add_finding "规则集列表响应非数组——fail closed，不判一致"
    return 3
  fi
  local ids
  if ! ids=$(jq -r '[.[] | select(.target == "branch" or .target == "tag")] | .[] | "\(.id) \(.target) \(.name)"' <<< "$list" 2>/dev/null); then
    bp_add_finding "规则集列表解析失败——fail closed，不判一致"
    return 3
  fi
  [[ -n "$ids" ]] || warn "远端无任何 branch/tag 目标规则集"

  local rc=0 rc_drift=0 line id live_target live_name live_json found
  local seen_names=$'\n'   # 换行分隔（规则集名可含空格，不可用空格分隔）
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    id="${line%% *}"; live_target="${line#* }"; live_name="${live_target#* }"; live_target="${live_target%% *}"
    seen_names="$seen_names$live_name"$'\n'   # 列表已见即记（读取失败不产生假「未见于远端」）
    if ! live_json=$(bp_api_get "/repos/$repo/rulesets/$id"); then
      bp_add_finding "无法读取规则集 $live_name（id=$id）——fail closed，不判一致"
      rc=3; continue
    fi
    if ! jq -e . >/dev/null 2>&1 <<< "$live_json"; then
      bp_add_finding "规则集 $live_name 响应畸形（非 JSON）——fail closed，不判一致"
      rc=3; continue
    fi
    found=""
    local n
    for n in ${names[@]+"${names[@]}"}; do
      [[ "$n" == "$live_name" ]] && found=1 && break
    done
    if [[ -n "$found" ]]; then
      local crc=0
      bp_compare_ruleset "规则集 $live_name" "$BP_RULESETS_DIR/$live_name.json" "$live_json" || crc=$?
      [[ $crc == 1 ]] && rc_drift=1
      [[ $crc == 3 ]] && rc=3
      # current_user_can_bypass 断言（身份/层区分，避免管理员视角假漂移）：
      #   保存侧无绕过者（基础层）——任何读取身份不得非 never；
      #   保存侧含绕过者（审批层）——仅非管理员视图（响应无 bypass_actors）时
      #   断言 never（管理员本人恰在名单中，GitHub 会如实返回 pull_requests_only；
      #   该视图已直接逐字段比对名单本身，断言无必要）。
      # crc==3（保存侧失效）时跳过——saved_bypass_n 回退 0 会产生多余发现。
      if [[ $crc != 3 ]]; then
        local saved_bypass_n=0 cub has_field=0
        saved_bypass_n=$(jq -r '(.bypass_actors // []) | length' "$BP_RULESETS_DIR/$live_name.json" 2>/dev/null || printf '0')
        printf '%s' "$live_json" | jq -e 'has("bypass_actors")' >/dev/null 2>&1 && has_field=1
        cub=$(jq -r '.current_user_can_bypass // ""' <<< "$live_json" 2>/dev/null || true)
        if [[ -n "$cub" && "$cub" != "never" && ( "$saved_bypass_n" == "0" || "$has_field" == "0" ) ]]; then
          bp_add_finding "规则集 $live_name：当前读取身份 current_user_can_bypass=$cub（该层保存配置无绕过者，或读取身份本应不可见名单——读取身份不得持有绕过权；App 在绕过名单属配置错误）"
          rc_drift=1
        fi
      fi
    else
      # 额外规则集（不在本次核对名单）：已知 durable 配置只是未被本调用方请求，
      # 跳过覆盖面判定（如 #73 harness 只核对 dev 两层时不请求 archive 层）；
      # 其余按 target 判定是否覆盖受保护命名空间（dev 分支 / archive/* 标签）。
      local is_durable=0 d
      for d in ${BP_DURABLE_RULESETS[@]+"${BP_DURABLE_RULESETS[@]}"}; do
        [[ "$d" == "$live_name" ]] && is_durable=1 && break
      done
      if [[ $is_durable == 0 ]]; then
        local crc2=1 probe_ref probe_bare
        if [[ "$live_target" == "tag" ]]; then
          probe_ref="$BP_ARCHIVE_PROBE_REF"; probe_bare="$BP_ARCHIVE_PROBE_BARE"
        else
          probe_ref="refs/heads/$default_branch"; probe_bare="$default_branch"
        fi
        bp_ruleset_covers_ref "$live_json" "$probe_ref" "$probe_bare" && crc2=0 || crc2=$?
        if [[ $crc2 == 2 ]]; then
          bp_add_finding "规则集 $live_name（id=$id）条件解析失败——fail closed，不判一致"
          rc=3
        elif [[ $crc2 == 0 ]]; then
          if [[ "$live_target" == "tag" ]]; then
            bp_add_finding "额外 tag 规则集 $live_name 覆盖 archive/* 命名空间（不在保存配置中）——可能削弱原型归档保护，配置漂移"
          else
            bp_add_finding "额外规则集 $live_name 覆盖默认分支 $default_branch（不在保存配置中）——若为受控验收 transient 规则集请确认目标；否则为配置漂移"
          fi
          rc_drift=1
        fi
      fi
    fi
  done <<< "$ids"

  local n
  for n in ${names[@]+"${names[@]}"}; do
    [[ "$seen_names" == *$'\n'"$n"$'\n'* ]] \
      || { bp_add_finding "保存配置中的规则集 $n 未见于远端（缺失或未启用）"; rc_drift=1; }
  done
  # 优先级：3（无法核查）> 1（漂移）> 0
  [[ $rc == 3 ]] && return 3
  [[ $rc_drift == 1 ]] && return 1
  return 0
}

# bp_check_repo_settings：合入后自动删除头分支设置核对（#74 AC1 远端）。
#   delete_branch_on_merge=true 是「远端 PR 分支合入后自动删除」的仓库级开关，
#   需管理员（Administration）开启——App 无此权限，由指挥者在 Web UI 勾选。
#   可见性（实测，与 bypass_actors 同口径）：匿名 GET /repos **不返回**该字段，
#   带 push 权限的令牌（App installation token / CI github.token）才返回。据此拆分：
#     - 公开面（字段缺失）：记 NOTE 跳过（不谎报已核对，也不死锁匿名本地核对）；
#     - 管理员强校验（BP_REQUIRE_BYPASS_ACTORS=1）字段缺失：fail closed 判漂移；
#     - 字段存在：严格核对 true（开启）/ false（漂移）。
#   rc：0 开启或公开面跳过 | 1 关闭/强校验缺失（漂移）| 3 无法核查（fetch/解析失败）。
bp_check_repo_settings() {
  local repo json setting
  repo=$(bp_repo) || return 3
  if ! json=$(bp_api_get "/repos/$repo"); then
    bp_add_finding "无法读取仓库设置（GET /repos/$repo 失败）——fail closed，不判一致"
    return 3
  fi
  if ! printf '%s' "$json" | jq -e 'type == "object"' >/dev/null 2>&1; then
    bp_add_finding "仓库设置响应非 JSON 对象——fail closed，不判一致"
    return 3
  fi
  if ! printf '%s' "$json" | jq -e 'has("delete_branch_on_merge")' >/dev/null 2>&1; then
    if [[ "${BP_REQUIRE_BYPASS_ACTORS:-0}" == "1" ]]; then
      bp_add_finding "管理员强校验模式下仓库设置不含 delete_branch_on_merge——fail closed 判漂移；确认读取凭据具备 push 权限"
      return 1
    fi
    bp_add_note "delete_branch_on_merge 对当前读取身份不可见（匿名/无 push 权限）——合入后自动删除设置未核对；CI 带 github.token 核对，本地可用 BP_GITHUB_TOKEN=<令牌> 核对"
    return 0
  fi
  # false 是合法值（关闭）——字段存在时直接 tostring，不用 `// empty`（会吞 false）
  setting=$(jq -r '.delete_branch_on_merge | tostring' <<< "$json" 2>/dev/null) \
    || { bp_add_finding "delete_branch_on_merge 字段解析失败——无法核对（fail closed）"; return 3; }
  if [[ "$setting" != "true" ]]; then
    bp_add_finding "合入后自动删除头分支未开启（delete_branch_on_merge=$setting，期望 true）——远端 PR 分支合入后不会自动删除（修复：指挥者 Settings → General → Pull Requests 勾选 Automatically delete head branches）"
    return 1
  fi
  return 0
}

# bp_merge_rc <rc1> <rc2> → stdout 合并退出码（优先级 3 无法核查 > 1 漂移 > 0）。
# 漂移核对与仓库设置核对共用，避免两处重复同一优先级逻辑。
bp_merge_rc() {
  local a="$1" b="$2"
  if [[ "$a" == 3 || "$b" == 3 ]]; then printf '3'
  elif [[ "$a" == 1 || "$b" == 1 ]]; then printf '1'
  else printf '0'; fi
}

# g-probe 2026-11-28T14:50:49Z（#73 项 g 新推送探针，触发 dismiss-stale）
