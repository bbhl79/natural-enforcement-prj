# shellcheck shell=bash
# ============================================================================
# dev 分支保护两层规则集漂移核对（#73；Spec-工程基座 §7 Git 规范）
#
# 事实源：devenv/rulesets/*.json（保存配置，随分支走）↔ GitHub 实时规则集。
# 两层设计：
#   - protect-dev-base     基础层：PR + 必需检查（quality-gate）+ 禁删/禁强推，
#                          无任何绕过名单（含指挥者——直推/强推一律拒）。
#   - protect-dev-approval 审批层：1 个批准 + 新推送使旧批准失效；绕过名单仅
#                          点名指挥者（User 3615225）且 bypass_mode=pull_request
#                          （仅 PR 合入时可绕过，直推不可）。
# 绕过只存在于审批层——基础层的 PR/检查要求对所有人（含绕过者）恒成立，
# 这正是拆两层而不是单规则集的原因（详见 docs/adr/ 分支保护两层规则集）。
#
# 读取身份（诚实边界）：
#   - 只读端点 rulesets / rules/branches 对公开仓库匿名可读；本核对默认匿名
#     （零凭据参与，不涉身份归属）。BP_GITHUB_TOKEN / GITHUB_TOKEN 存在时优先
#     使用（CI 用 github.token 换限额余量；本地通常两者皆无 → 匿名）。
#   - installation token 形态对 ruleset 单读端点是否可见 bypass_actors 未预先
#     假设：字段存在即机械比对；缺失且保存配置预期有绕过者 → 判漂移（fail
#     closed，附人工核对指引）。行为面验证（App 绕过尝试被拒 / 指挥者直推被拒
#     / 指挥者 PR 合入绕过成功）在受控验收 harness 中覆盖。
# ============================================================================
BP_API="${BP_API:-https://api.github.com}"
BP_RULESETS_DIR="${BP_RULESETS_DIR:-$REPO_ROOT/devenv/rulesets}"
# 持久（durable）规则集 = dev 两层，进 CI 常驻核对；其余保存文件（验收期
# transient 测试分支对）只在受控验收 harness 中核对，不进日常门禁。
BP_DURABLE_RULESETS=(protect-dev-base protect-dev-approval)

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
  #   全 ref 形（refs/heads/dev）与裸名形（dev）都尝试；glob 按原样匹配。
  # 注意：[[ == ]] 右侧引号会使比较退化为字面串（bash 手册行为），模式变量
  # 不加引号才启用 glob 语义（[[ ]] 内无分词，安全）。
  local ref="$1" bare="$2" pat="$3"
  [[ -z "$pat" ]] && return 1
  if [[ "$pat" == "~DEFAULT_BRANCH" ]]; then
    [[ "$ref" == "refs/heads/$bare" || "$ref" == "$bare" ]] && return 0
    return 1
  fi
  # shellcheck disable=SC2053
  [[ "$ref" == $pat ]] && return 0
  # shellcheck disable=SC2053
  [[ "$bare" == $pat ]] && return 0
  return 1
}

bp_ruleset_covers_ref() { # <ruleset-json> <full-ref> <bare-name> → 0 覆盖
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
#   逐段比对，漂移发现写入全局数组 BP_FINDINGS（人类可读行），rc 0=一致。
bp_compare_ruleset() {
  local label="$1" saved_file="$2" live_json="$3"
  local saved_norm live_norm
  saved_norm=$(bp_norm_ruleset < "$saved_file") || return 3
  live_norm=$(printf '%s' "$live_json" | bp_norm_ruleset) || return 3
  [[ "$saved_norm" == "$live_norm" ]] && return 0

  # 不一致 → 定位差异段（enforcement / 条件 / 规则 / 绕过名单）
  local s l
  for field in enforcement include exclude target; do
    s=$(jq -r --arg f "$field" 'getpath([$f]) | tojson' <<< "$saved_norm")
    l=$(jq -r --arg f "$field" 'getpath([$f]) | tojson' <<< "$live_norm")
    [[ "$s" != "$l" ]] && BP_FINDINGS+=("$label：$field 不一致（保存=$s 实际=$l）")
  done
  s=$(jq -r '.rules | tojson' <<< "$saved_norm"); l=$(jq -r '.rules | tojson' <<< "$live_norm")
  if [[ "$s" != "$l" ]]; then
    BP_FINDINGS+=("$label：规则集内容不一致——保存值：$s / 实际值：$l（含规则类型差异与参数差异）")
  fi
  s=$(jq -r '.bypass_actors | tojson' <<< "$saved_norm"); l=$(jq -r '.bypass_actors | tojson' <<< "$live_norm")
  if [[ "$s" != "$l" ]]; then
    if ! printf '%s' "$live_json" | jq -e 'has("bypass_actors")' >/dev/null 2>&1; then
      BP_FINDINGS+=("$label：实际响应不含 bypass_actors 字段而保存配置预期绕过名单（$s）。fail closed 判漂移：先在 GitHub UI 核对该规则集绕过名单；若读取身份确实不可见该字段，以行为验收（App 绕过被拒/指挥者直推被拒）与指挥者 UI 核对为准并记录于验收证据。")
    else
      BP_FINDINGS+=("$label：绕过名单不一致（保存=$s 实际=$l）")
    fi
  fi
  return 1
}

# bp_check_drift <ruleset-names...>：主核对。fetch 实时 → 比对保存 →
#   追加发现到 BP_FINDINGS。rc：0 一致 | 1 漂移 | 3 无法核查（fail closed）。
bp_check_drift() {
  local names=("$@") repo default_branch list ids
  repo=$(bp_repo) || return 3
  if ! default_branch=$(bp_api_get "/repos/$repo" | jq -r '.default_branch // empty'); then
    BP_FINDINGS+=("无法读取仓库默认分支（GET /repos/$repo 失败）——fail closed，不判一致")
    return 3
  fi
  [[ -n "$default_branch" ]] || { BP_FINDINGS+=("默认分支响应缺失字段"); return 3; }
  if ! list=$(bp_api_get "/repos/$repo/rulesets"); then
    BP_FINDINGS+=("无法读取规则集列表（GET /repos/$repo/rulesets 失败）——fail closed，不判一致")
    return 3
  fi
  ids=$(jq -r '[.[] | select(.target == "branch")] | .[] | "\(.id) \(.name)"' <<< "$list") \
    || { BP_FINDINGS+=("规则集列表解析失败"); return 3; }
  [[ -n "$ids" ]] || warn "远端无任何 branch 目标规则集"

  local rc=0 line id live_name live_json found seen_names=" "
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    id="${line%% *}"; live_name="${line#* }"
    if ! live_json=$(bp_api_get "/repos/$repo/rulesets/$id"); then
      BP_FINDINGS+=("无法读取规则集 $live_name（id=$id）——fail closed，不判一致")
      rc=3; continue
    fi
    if ! jq -e . >/dev/null 2>&1 <<< "$live_json"; then
      BP_FINDINGS+=("规则集 $live_name 响应畸形（非 JSON）——fail closed，不判一致")
      rc=3; continue
    fi
    seen_names="$seen_names$live_name "
    found=""
    local n
    for n in ${names[@]+"${names[@]}"}; do
      [[ "$n" == "$live_name" ]] && found=1 && break
    done
    if [[ -n "$found" ]]; then
      local crc=0
      bp_compare_ruleset "规则集 $live_name" "$BP_RULESETS_DIR/$live_name.json" "$live_json" || crc=$?
      [[ $crc == 3 ]] && rc=3
      [[ $crc == 1 ]] && rc=1
    elif bp_ruleset_covers_ref "$live_json" "refs/heads/$default_branch" "$default_branch"; then
      BP_FINDINGS+=("额外规则集 $live_name 覆盖默认分支 $default_branch（不在保存配置中）——若为受控验收 transient 规则集请确认目标；否则为配置漂移")
      rc=1
    fi
  done <<< "$ids"

  local n
  for n in ${names[@]+"${names[@]}"}; do
    [[ "$seen_names" == *" $n "* ]] || { BP_FINDINGS+=("保存配置中的规则集 $n 未见于远端（缺失或未启用）"); rc=1; }
  done
  return "$rc"
}
