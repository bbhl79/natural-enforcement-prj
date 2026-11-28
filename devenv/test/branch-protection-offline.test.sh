#!/usr/bin/env bash
# ============================================================================
# 分支保护两层规则集漂移核对离线测试（#73）——不访问真实 GitHub（curl 全 mock）
#
# 覆盖：
#   1. 保存配置自检（4 个 JSON 均为合法规则集语义：必填参数齐全、必需检查锁定
#      integration_id、绕过者点名正确、dev 两层与验收测试分支对目标正确）
#   2. 漂移核对行为：一致（含规则顺序/冗余字段归一化）/ 规则缺失 / 参数漂移 /
#      绕过名单可见性分层（缺失=公开面跳过+NOTE；--require-bypass-actors=缺失
#      判漂移；存在=严格比对）/ 规则集缺失 / 额外规则集覆盖 dev（精确、通配、
#      ~DEFAULT_BRANCH、~ALL）不误报（验收期 transient 测试分支规则集、exclude
#      摘除 dev）
#   3. fail-closed 语义与退出码优先级：fetch 失败 / 响应畸形（非数组/非 JSON）
#      → exit 3；漂移+读取失败并存 → 3（不降级）；读取失败不产生假「未见于远端」
#   4. 读取身份绕过权（current_user_can_bypass 非 never → 判漂移）
#   5. --json 输出结构化（事件 + 终值含 findings/notes 计数）；用法错误与
#      --require-bypass-actors 缺令牌 → exit 2
#   6. BP_GITHUB_TOKEN 存在时走带凭据路径（stub 同样可用）
# ============================================================================
set -Eeuo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TEST_DIR/../.." && pwd)"

FAILURES=0
PASS_COUNT=0
pass() { printf 'PASS: %s\n' "$1"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { printf 'FAIL: %s —— %s\n' "$1" "$2"; FAILURES=$((FAILURES + 1)); }

SANDBOX=$(mktemp -d /tmp/devenv-bp-offline.XXXXXX)
trap 'rm -rf "$SANDBOX"' EXIT
OUT="$SANDBOX/out"; mkdir -p "$OUT"
cp -r "$REPO_ROOT/devenv" "$SANDBOX/devenv"

# mock curl：按 URL 路由到 $BP_FIXTURE_DIR 下夹具；BP_CURL_FAIL=1 时统一失败；
# BP_CURL_FAIL_RULESET=<id> 时该 id 的单规则集 GET 失败（部分失败注入）
mkdir -p "$SANDBOX/stubbin"
cat > "$SANDBOX/stubbin/curl" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${BP_CURL_FAIL:-}" == "1" ]]; then echo "stub: transport error" >&2; exit 7; fi
url=""
for a in "$@"; do case "$a" in http*) url="$a";; esac; done
[[ -n "$url" ]] || { echo "stub: no url in args" >&2; exit 2; }
path="${url#https://api.github.com}"
case "$path" in
  /repos/bbhl79/natural-enforcement-prj)          cat "${BP_FIXTURE_DIR:?}/repo.json";;
  /repos/bbhl79/natural-enforcement-prj/rulesets) cat "${BP_FIXTURE_DIR}/rulesets-list.json";;
  /repos/bbhl79/natural-enforcement-prj/rulesets/*)
    id="${path##*/}"
    if [[ "${BP_CURL_FAIL_RULESET:-}" == "$id" ]]; then echo "stub: transport error for ruleset $id" >&2; exit 7; fi
    cat "${BP_FIXTURE_DIR}/ruleset-${id}.json";;
  *) echo "stub: no fixture for $path" >&2; exit 22;;
esac
STUB
chmod +x "$SANDBOX/stubbin/curl"

DEVENV="$SANDBOX/devenv/devenv"
FIX="$SANDBOX/fixtures"; mkdir -p "$FIX"

# run_case <label> <env assignments...>：沙箱内运行 branch-protection，捕获 rc/out/err
run_case() {
  local label="$1"; shift
  local rc=0
  PATH="$SANDBOX/stubbin:$PATH" env "$@" "$DEVENV" branch-protection \
    > "$OUT/$label.out" 2> "$OUT/$label.err" || rc=$?
  echo "$rc" > "$OUT/$label.rc"
}

# ---------------------------------------------------------------------------
# 1. 保存配置自检（语义合法性：作为 API 负载与设计意图的双向校验）
# ---------------------------------------------------------------------------
rs_dir="$REPO_ROOT/devenv/rulesets"
for f in protect-dev-base protect-dev-approval protect-bp73-test-base protect-bp73-test-approval; do
  jq -e --arg f "$f" '
    (.name == $f) and (.target == "branch") and (.enforcement == "active") and
    (.conditions.ref_name.include | length == 1) and (.conditions.ref_name.exclude == []) and
    (all(.rules[] | select(.type == "pull_request"); (.parameters | has("dismiss_stale_reviews_on_push")
      and has("require_code_owner_review") and has("require_last_push_approval")
      and has("required_approving_review_count") and has("required_review_thread_resolution"))))
  ' "$rs_dir/$f.json" > /dev/null 2>&1 \
    && pass "BP0 $f：保存配置语义自检（命名/target/enforcement/条件/pull_request 必填参数）" \
    || fail "BP0 $f" "保存配置不满足语义约束：$(jq -c . "$rs_dir/$f.json" 2>&1 | head -c 300)"
done

jq -e '.rules[] | select(.type == "required_status_checks") | .parameters.required_status_checks[0]
         == {"context": "quality-gate", "integration_id": 15368}
       and (.parameters.strict_required_status_checks_policy == false)' "$rs_dir/protect-dev-base.json" > /dev/null \
  && pass "BP0 base：必需检查 quality-gate 锁定 integration_id 15368（github-actions，防同名检查被其他 App 伪造）" \
  || fail "BP0 base" "必需检查配置不符"
jq -e '(.bypass_actors // []) | length == 0' "$rs_dir/protect-dev-base.json" > /dev/null \
  && pass "BP0 base：基础层无绕过名单（含指挥者——直推/强推/删分支一律走规则）" \
  || fail "BP0 base" "基础层不应有绕过名单"
jq -e '.bypass_actors == [{"actor_id": 3615225, "actor_type": "User", "bypass_mode": "pull_request"}]
       and .rules[0].parameters.required_approving_review_count == 1
       and .rules[0].parameters.dismiss_stale_reviews_on_push == true' "$rs_dir/protect-dev-approval.json" > /dev/null \
  && pass "BP0 approval：1 批准 + 新推送失效 + 绕过仅点名指挥者（User 3615225，pull_request 模式）" \
  || fail "BP0 approval" "审批层参数与设计意图不符"
for f in protect-bp73-test-base protect-bp73-test-approval; do
  jq -e '.conditions.ref_name.include == ["refs/heads/test/bp-73-acceptance"]' "$rs_dir/$f.json" > /dev/null \
    && pass "BP0 $f：验收 transient 规则集只指向测试分支" \
    || fail "BP0 $f" "include 应为 refs/heads/test/bp-73-acceptance"
done

# ---------------------------------------------------------------------------
# 夹具构造：live 规则集 = 保存配置 + 实时专属字段 + 规则乱序（测归一化）。
# 真实非管理员读取不含 bypass_actors——夹具由 --admin-view 控制保留与否。
# ---------------------------------------------------------------------------
live_of() { # live_of <saved-file> <id> [admin-view] → stdout live JSON
  # 管理员视角的 current_user_can_bypass 须真实：保存配置含绕过者的层（审批层）
  # 对名单内管理员返回 pull_request（GitHub 实测口径——此前硬编码 never 掩盖了
  # 管理员强校验的假漂移）；无绕过者层（基础层）任何身份为 never。
  local f="$1" id="$2" admin="${3:-}"
  # admin 视角按文档口径物化该字段（空名单 → []；对规则集写权限者返回）；
  # 非管理员视角一律剥离（实测：匿名/App/CI 均不可见）
  local keep='del(.bypass_actors)'
  [[ "$admin" == "admin-view" ]] && keep='.bypass_actors = ((.bypass_actors // []))'
  local cub="never"
  if [[ "$admin" == "admin-view" ]] && jq -e '(.bypass_actors // []) | length > 0' "$f" >/dev/null 2>&1; then
    cub="pull_requests_only"
  fi
  # 程序串经 bash 双引号插值（沿用原实现）：$cub 需带引号成为 jq 字符串字面量
  jq --argjson id "$id" "$keep | . + {id: $id, node_id: \"RRS_x\", source_type: \"Repository\",
         source: \"bbhl79/natural-enforcement-prj\", enforcement: .enforcement,
         current_user_can_bypass: \"$cub\", _links: {self: {href: \"x\"}, html: {href: \"x\"}},
         created_at: \"2026-11-28T00:00:00Z\", updated_at: \"2026-11-28T00:00:00Z\"}
    | .rules = (.rules | reverse)
  " "$f"
}

write_match_fixtures() { # 一致场景（管理员视角读取：bypass_actors 可见）
  printf '{"default_branch": "dev", "full_name": "bbhl79/natural-enforcement-prj", "delete_branch_on_merge": true}' > "$FIX/repo.json"
  live_of "$rs_dir/protect-dev-base.json" 101 admin-view > "$FIX/ruleset-101.json"
  live_of "$rs_dir/protect-dev-approval.json" 102 admin-view > "$FIX/ruleset-102.json"
  live_of "$rs_dir/protect-archive-tags.json" 201 admin-view > "$FIX/ruleset-201.json"   # #74 archive 标签保护层
  printf '[{"id":101,"name":"protect-dev-base","target":"branch","enforcement":"active"},{"id":102,"name":"protect-dev-approval","target":"branch","enforcement":"active"},{"id":201,"name":"protect-archive-tags","target":"tag","enforcement":"active"}]' > "$FIX/rulesets-list.json"
}

write_public_fixtures() { # 一致场景（公开面读取：bypass_actors 不可见——非管理员真实形态）
  printf '{"default_branch": "dev", "full_name": "bbhl79/natural-enforcement-prj", "delete_branch_on_merge": true}' > "$FIX/repo.json"
  live_of "$rs_dir/protect-dev-base.json" 101 > "$FIX/ruleset-101.json"
  live_of "$rs_dir/protect-dev-approval.json" 102 > "$FIX/ruleset-102.json"
  live_of "$rs_dir/protect-archive-tags.json" 201 > "$FIX/ruleset-201.json"   # #74 archive 标签保护层
  printf '[{"id":101,"name":"protect-dev-base","target":"branch","enforcement":"active"},{"id":102,"name":"protect-dev-approval","target":"branch","enforcement":"active"},{"id":201,"name":"protect-archive-tags","target":"tag","enforcement":"active"}]' > "$FIX/rulesets-list.json"
}

# ---------------------------------------------------------------------------
# 2. 一致（BP1）与归一化（乱序/冗余字段不误报）
# ---------------------------------------------------------------------------
write_match_fixtures
run_case bp1 BP_FIXTURE_DIR="$FIX"
[[ "$(cat "$OUT/bp1.rc")" == "0" ]] && grep -q "一致" "$OUT/bp1.err" \
  && pass "BP1 管理员视角实时与保存一致（规则乱序/实时专属字段归一化后逐字段相同）→ exit 0" \
  || fail "BP1" "rc=$(cat "$OUT/bp1.rc")：$(head -5 "$OUT/bp1.err")"

# BP1b：--json 结构化输出（事件 + 终值含 findings/notes）
BP_FIXTURE_DIR="$FIX" PATH="$SANDBOX/stubbin:$PATH" "$DEVENV" --json branch-protection \
  > "$OUT/bp1b.out" 2> "$OUT/bp1b.err" || true
jq -e 'select(.command == "branch-protection") | .status == "ok" and .exitCode == 0 and .findings == "0"' \
  <(grep -v '^{"event"' "$OUT/bp1b.out") > /dev/null 2>&1 \
  && pass "BP1b --json 终值结构化（status/exitCode/findings）" \
  || fail "BP1b" "终值事件异常：$(cat "$OUT/bp1b.out")"

# BP1c：BP_GITHUB_TOKEN 存在时走带凭据 fetch 路径（stub 不读 stdin 也成立）
run_case bp1c BP_FIXTURE_DIR="$FIX" BP_GITHUB_TOKEN=stub-token
[[ "$(cat "$OUT/bp1c.rc")" == "0" ]] \
  && pass "BP1c BP_GITHUB_TOKEN 存在时带凭据路径同样一致（token 经 stdin -H @-，不进 argv）" \
  || fail "BP1c" "rc=$(cat "$OUT/bp1c.rc")：$(head -5 "$OUT/bp1c.err")"

# ---------------------------------------------------------------------------
# 3. 绕过名单可见性分层（BP4 系——评审整改核心）
# ---------------------------------------------------------------------------
# BP4：公开面读取（非管理员真实形态）缺失 bypass_actors → 不判漂移 + NOTE 提示（不死锁 CI）；
# 三层（dev 两层 + archive 标签层，含保存侧为 [] 的 base/archive）各记一条 NOTE——不静默漏检
write_public_fixtures
run_case bp4 BP_FIXTURE_DIR="$FIX"
note_count=$(grep -c "bypass_actors 对当前读取身份不可见" "$OUT/bp4.err" || true)
[[ "$(cat "$OUT/bp4.rc")" == "0" && "$note_count" == "3" ]] \
  && pass "BP4 公开面读取缺失 bypass_actors → 跳过该字段（exit 0，不死锁 CI），三层各记 NOTE（${note_count} 项——不谎报已核对）" \
  || fail "BP4" "rc=$(cat "$OUT/bp4.rc") notes=$note_count：$(head -5 "$OUT/bp4.err")"

# BP4b：管理员强校验（--require-bypass-actors）缺失 bypass_actors → fail closed 判漂移
run_case bp4b BP_FIXTURE_DIR="$FIX" BP_GITHUB_TOKEN=stub-admin BP_REQUIRE_BYPASS_ACTORS=1
[[ "$(cat "$OUT/bp4b.rc")" == "1" ]] && grep -q "管理员强校验" "$OUT/bp4b.err" \
  && pass "BP4b --require-bypass-actors 且响应缺失 bypass_actors → fail closed（exit 1）" \
  || fail "BP4b" "rc=$(cat "$OUT/bp4b.rc")：$(head -5 "$OUT/bp4b.err")"

# BP4c：--require-bypass-actors 无令牌 → 用法错误 exit 2（bypass_actors 仅写权限者可见）
rc=0
PATH="$SANDBOX/stubbin:$PATH" BP_FIXTURE_DIR="$FIX" "$DEVENV" branch-protection --require-bypass-actors \
  > "$OUT/bp4c.out" 2> "$OUT/bp4c.err" || rc=$?
[[ "$rc" == "2" ]] && grep -q "管理员" "$OUT/bp4c.err" \
  && pass "BP4c --require-bypass-actors 缺管理员令牌 → exit 2" || fail "BP4c" "rc=$rc"

# BP4d：管理员视角（字段存在）严格比对：内容不符 → 漂移
write_match_fixtures
jq '.bypass_actors[0].bypass_mode = "always"' "$FIX/ruleset-102.json" > "$FIX/x" && mv "$FIX/x" "$FIX/ruleset-102.json"
run_case bp4d BP_FIXTURE_DIR="$FIX" BP_GITHUB_TOKEN=stub-admin
[[ "$(cat "$OUT/bp4d.rc")" == "1" ]] && grep -q "绕过名单不一致" "$OUT/bp4d.err" \
  && pass "BP4d bypass_actors 可见且不符（always ≠ pull_request）→ 漂移（点名绕过模式被改动）" \
  || fail "BP4d" "rc=$(cat "$OUT/bp4d.rc")：$(head -5 "$OUT/bp4d.err")"

# BP4e：CLI --require-bypass-actors + 真实管理员夹具（base=never、approval=pull_request）
# → exit 0（管理员本人即在名单中，GitHub 如实返回 pull_request——不得判假漂移）
write_match_fixtures
rc=0
PATH="$SANDBOX/stubbin:$PATH" env BP_FIXTURE_DIR="$FIX" BP_GITHUB_TOKEN=stub-admin \
  "$DEVENV" branch-protection --require-bypass-actors > "$OUT/bp4e.out" 2> "$OUT/bp4e.err" || rc=$?
[[ "$rc" == "0" ]] \
  && pass "BP4e CLI --require-bypass-actors + 真实管理员视角（approval current_user_can_bypass=pull_request）→ exit 0（不假漂移）" \
  || fail "BP4e" "rc=$rc：$(head -5 "$OUT/bp4e.err")"

# BP4f：仅 base 缺失 bypass_actors（approval 字段在）——公开面两层的 NOTE 数=2；
# 强校验模式即使 approval 字段存在，base 缺失仍 fail closed（可见性先于内容比对）
write_match_fixtures
jq 'del(.bypass_actors)' "$FIX/ruleset-101.json" > "$FIX/x" && mv "$FIX/x" "$FIX/ruleset-101.json"
run_case bp4f BP_FIXTURE_DIR="$FIX"
note_count=$(grep -c "bypass_actors 对当前读取身份不可见" "$OUT/bp4f.err" || true)
[[ "$(cat "$OUT/bp4f.rc")" == "0" && "$note_count" == "1" ]] \
  && pass "BP4f 仅 base 缺失 bypass_actors（approval 字段在且严格比对）：公开面 base 记 NOTE（${note_count} 项——保存侧为 [] 也记，不静默漏检）→ exit 0" \
  || fail "BP4f" "rc=$(cat "$OUT/bp4f.rc") notes=$note_count：$(head -5 "$OUT/bp4f.err")"
run_case bp4f2 BP_FIXTURE_DIR="$FIX" BP_GITHUB_TOKEN=stub-admin BP_REQUIRE_BYPASS_ACTORS=1
[[ "$(cat "$OUT/bp4f2.rc")" == "1" ]] && grep -q "管理员强校验" "$OUT/bp4f2.err" \
  && pass "BP4f2 强校验模式下仅 base 缺失 bypass_actors（approval 字段在）→ 仍 fail closed（exit 1）" \
  || fail "BP4f2" "rc=$(cat "$OUT/bp4f2.rc")：$(head -5 "$OUT/bp4f2.err")"

# BP4g：公开面模式不得打印管理员强校验字样（mode_note 回归——CI 日志曾误印）
write_public_fixtures
run_case bp4g BP_FIXTURE_DIR="$FIX"
[[ "$(cat "$OUT/bp4g.rc")" == "0" ]] && ! grep -q "管理员强校验" "$OUT/bp4g.err" \
  && pass "BP4g 公开面（默认）模式输出不含「管理员强校验绕过名单」（mode_note 回归守卫）" \
  || fail "BP4g" "rc=$(cat "$OUT/bp4g.rc")：$(head -5 "$OUT/bp4g.err")"

# ---------------------------------------------------------------------------
# 4. 漂移检出（BP2–BP5）
# ---------------------------------------------------------------------------
write_match_fixtures
jq '.rules |= map(select(.type != "required_status_checks"))' "$FIX/ruleset-101.json" > "$FIX/x" && mv "$FIX/x" "$FIX/ruleset-101.json"
run_case bp2 BP_FIXTURE_DIR="$FIX"
[[ "$(cat "$OUT/bp2.rc")" == "1" ]] && grep -q "规则集内容不一致" "$OUT/bp2.err" \
  && pass "BP2 基础层缺必需检查规则 → 漂移（exit 1）并指明规则集内容不一致" \
  || fail "BP2" "rc=$(cat "$OUT/bp2.rc")：$(head -5 "$OUT/bp2.err")"

write_match_fixtures
jq '(.rules[] | select(.type == "pull_request") | .parameters.dismiss_stale_reviews_on_push) = false' \
  "$FIX/ruleset-102.json" > "$FIX/x" && mv "$FIX/x" "$FIX/ruleset-102.json"
run_case bp3 BP_FIXTURE_DIR="$FIX"
[[ "$(cat "$OUT/bp3.rc")" == "1" ]] && grep -qE "protect-dev-approval：|规则集内容不一致" "$OUT/bp3.err" \
  && pass "BP3 审批层 dismiss_stale 实际为 false（应为 true）→ 漂移（新推送未使旧批准失效即配置漂移）" \
  || fail "BP3" "rc=$(cat "$OUT/bp3.rc")：$(head -5 "$OUT/bp3.err")"

write_match_fixtures
jq '.bypass_actors = []' "$FIX/ruleset-102.json" > "$FIX/x" && mv "$FIX/x" "$FIX/ruleset-102.json"
run_case bp5 BP_FIXTURE_DIR="$FIX"
[[ "$(cat "$OUT/bp5.rc")" == "1" ]] && grep -q "绕过名单不一致" "$OUT/bp5.err" \
  && pass "BP5 实际绕过名单为空（保存配置点名指挥者；字段可见）→ 漂移" \
  || fail "BP5" "rc=$(cat "$OUT/bp5.rc")：$(head -5 "$OUT/bp5.err")"

write_match_fixtures
jq '(.rules[] | select(.type == "pull_request") | .parameters.dismiss_stale_reviews_on_push) = false' \
  "$FIX/ruleset-102.json" > "$FIX/x" && mv "$FIX/x" "$FIX/ruleset-102.json"
run_case bp5b BP_FIXTURE_DIR="$FIX"
[[ "$(cat "$OUT/bp5b.rc")" == "1" ]] \
  && pass "BP5b 参数漂移（管理员视角另有 bypass 面）exit 1" \
  || fail "BP5b" "rc=$(cat "$OUT/bp5b.rc")"

# ---------------------------------------------------------------------------
# 5. 额外规则集覆盖 dev（BP6）与不误报（BP7）
# ---------------------------------------------------------------------------
write_match_fixtures
jq --argjson id 103 '. + {id: $id, node_id: "RRS_y", source_type: "Repository", source: "bbhl79/natural-enforcement-prj", current_user_can_bypass: "never", _links: {}, created_at: "t", updated_at: "t"}' \
  "$rs_dir/protect-dev-base.json" | jq '.name = "rogue-extra" | .conditions.ref_name.include = ["refs/heads/dev"]' > "$FIX/ruleset-103.json"
jq '. + [{id: 103, name: "rogue-extra", target: "branch", enforcement: "active"}]' "$FIX/rulesets-list.json" > "$FIX/x" && mv "$FIX/x" "$FIX/rulesets-list.json"
run_case bp6 BP_FIXTURE_DIR="$FIX"
[[ "$(cat "$OUT/bp6.rc")" == "1" ]] && grep -q "额外规则集 rogue-extra" "$OUT/bp6.err" \
  && pass "BP6 额外规则集精确覆盖 dev（不在保存配置）→ 漂移并点名" \
  || fail "BP6" "rc=$(cat "$OUT/bp6.rc")：$(head -5 "$OUT/bp6.err")"

# BP6b（沿用 BP6 的 3 规则集现场：write_match_fixtures 会重置列表孤立 103 夹具）
jq '.name = "catch-all" | .conditions.ref_name.include = ["refs/heads/*"]' "$FIX/ruleset-103.json" > "$FIX/x" && mv "$FIX/x" "$FIX/ruleset-103.json"
jq 'map(if .id == 103 then .name = "catch-all" else . end)' "$FIX/rulesets-list.json" > "$FIX/y" && mv "$FIX/y" "$FIX/rulesets-list.json"
run_case bp6b BP_FIXTURE_DIR="$FIX"
[[ "$(cat "$OUT/bp6b.rc")" == "1" ]] && grep -q "额外规则集 catch-all" "$OUT/bp6b.err" \
  && pass "BP6b 通配 refs/heads/* 覆盖 dev → 漂移" \
  || fail "BP6b" "rc=$(cat "$OUT/bp6b.rc")"

# BP6c（沿用同上现场）
jq '.name = "default-branch-target" | .conditions.ref_name.include = ["~DEFAULT_BRANCH"]' "$FIX/ruleset-103.json" > "$FIX/x" && mv "$FIX/x" "$FIX/ruleset-103.json"
jq 'map(if .id == 103 then .name = "default-branch-target" else . end)' "$FIX/rulesets-list.json" > "$FIX/y" && mv "$FIX/y" "$FIX/rulesets-list.json"
run_case bp6c BP_FIXTURE_DIR="$FIX"
[[ "$(cat "$OUT/bp6c.rc")" == "1" ]] && grep -q "额外规则集 default-branch-target" "$OUT/bp6c.err" \
  && pass "BP6c ~DEFAULT_BRANCH 指向实际默认分支（夹具 default_branch=dev）→ 漂移" \
  || fail "BP6c" "rc=$(cat "$OUT/bp6c.rc")"

# BP6d：~ALL（UI「Include all branches」）覆盖一切 ref → 漂移
jq '.name = "all-branches" | .conditions.ref_name.include = ["~ALL"]' "$FIX/ruleset-103.json" > "$FIX/x" && mv "$FIX/x" "$FIX/ruleset-103.json"
jq 'map(if .id == 103 then .name = "all-branches" else . end)' "$FIX/rulesets-list.json" > "$FIX/y" && mv "$FIX/y" "$FIX/rulesets-list.json"
run_case bp6d BP_FIXTURE_DIR="$FIX"
[[ "$(cat "$OUT/bp6d.rc")" == "1" ]] && grep -q "额外规则集 all-branches" "$OUT/bp6d.err" \
  && pass "BP6d ~ALL 覆盖所有分支（含 dev）→ 漂移" \
  || fail "BP6d" "rc=$(cat "$OUT/bp6d.rc")"

# BP7a：验收期 transient 测试分支规则集（不覆盖 dev）不误报
write_match_fixtures
live_of "$rs_dir/protect-bp73-test-base.json" 103 admin-view > "$FIX/ruleset-103.json"
live_of "$rs_dir/protect-bp73-test-approval.json" 104 admin-view > "$FIX/ruleset-104.json"
printf '[{"id":101,"name":"protect-dev-base","target":"branch","enforcement":"active"},{"id":102,"name":"protect-dev-approval","target":"branch","enforcement":"active"},{"id":201,"name":"protect-archive-tags","target":"tag","enforcement":"active"},{"id":103,"name":"protect-bp73-test-base","target":"branch","enforcement":"active"},{"id":104,"name":"protect-bp73-test-approval","target":"branch","enforcement":"active"}]' > "$FIX/rulesets-list.json"
run_case bp7a BP_FIXTURE_DIR="$FIX"
[[ "$(cat "$OUT/bp7a.rc")" == "0" ]] \
  && pass "BP7a 验收期 transient 测试分支规则集存在且不指向 dev → 常驻核对不误报（exit 0）" \
  || fail "BP7a" "rc=$(cat "$OUT/bp7a.rc")：$(head -5 "$OUT/bp7a.err")"

# BP7b：catch-all 但 exclude 摘除 dev → 不覆盖 dev，不误报
jq '.name = "catch-all-exclude" | .conditions.ref_name.include = ["refs/heads/*"] | .conditions.ref_name.exclude = ["refs/heads/dev"]' \
  "$FIX/ruleset-103.json" > "$FIX/x" && mv "$FIX/x" "$FIX/ruleset-103.json"
jq 'map(if .id == 103 then .name = "catch-all-exclude" else . end)' "$FIX/rulesets-list.json" > "$FIX/y" && mv "$FIX/y" "$FIX/rulesets-list.json"
run_case bp7b BP_FIXTURE_DIR="$FIX"
[[ "$(cat "$OUT/bp7b.rc")" == "0" ]] \
  && pass "BP7b 通配但 exclude 摘除 dev → 不算覆盖 dev，不误报" \
  || fail "BP7b" "rc=$(cat "$OUT/bp7b.rc")：$(head -5 "$OUT/bp7b.err")"

# BP8：保存配置中的规则集在远端缺失（未应用）→ 漂移
write_match_fixtures
jq 'map(select(.id != 102))' "$FIX/rulesets-list.json" > "$FIX/x" && mv "$FIX/x" "$FIX/rulesets-list.json"
run_case bp8 BP_FIXTURE_DIR="$FIX"
[[ "$(cat "$OUT/bp8.rc")" == "1" ]] && grep -q "protect-dev-approval 未见于远端" "$OUT/bp8.err" \
  && pass "BP8 审批层未应用于远端 → 漂移（保存配置与实时缺一层）" \
  || fail "BP8" "rc=$(cat "$OUT/bp8.rc")：$(head -5 "$OUT/bp8.err")"

# ---------------------------------------------------------------------------
# 6. fail closed 与退出码优先级（BP9–BP12）
# ---------------------------------------------------------------------------
write_match_fixtures
run_case bp9 BP_FIXTURE_DIR="$FIX" BP_CURL_FAIL=1
[[ "$(cat "$OUT/bp9.rc")" == "3" ]] && grep -q "fail closed" "$OUT/bp9.err" \
  && pass "BP9 fetch 失败（传输错误）→ exit 3 fail closed，不判一致" \
  || fail "BP9" "rc=$(cat "$OUT/bp9.rc")：$(head -5 "$OUT/bp9.err")"

write_match_fixtures
printf 'not json at all' > "$FIX/rulesets-list.json"
run_case bp10 BP_FIXTURE_DIR="$FIX"
[[ "$(cat "$OUT/bp10.rc")" == "3" ]] \
  && pass "BP10 规则集列表响应畸形 → exit 3 fail closed" \
  || fail "BP10" "rc=$(cat "$OUT/bp10.rc")：$(head -5 "$OUT/bp10.err")"

# BP10b：列表为对象（非数组）→ fail closed 3（不误判为空列表漂移 1）
write_match_fixtures
printf '{}' > "$FIX/rulesets-list.json"
run_case bp10b BP_FIXTURE_DIR="$FIX"
[[ "$(cat "$OUT/bp10b.rc")" == "3" ]] && grep -q "非数组" "$OUT/bp10b.err" \
  && pass "BP10b 规则集列表响应为对象（非数组）→ exit 3 fail closed（不降级为「未见于远端」漂移）" \
  || fail "BP10b" "rc=$(cat "$OUT/bp10b.rc")：$(head -5 "$OUT/bp10b.err")"

# BP11：单规则集读取失败 → 3 不降级、不产生假「未见于远端」
write_match_fixtures
run_case bp11 BP_FIXTURE_DIR="$FIX" BP_CURL_FAIL_RULESET=102
[[ "$(cat "$OUT/bp11.rc")" == "3" ]] \
  && ! grep -q "protect-dev-approval 未见于远端" "$OUT/bp11.err" \
  && grep -q "无法读取规则集 protect-dev-approval" "$OUT/bp11.err" \
  && pass "BP11 单规则集读取失败 → exit 3（不降级为 1），且不产生假「未见于远端」" \
  || fail "BP11" "rc=$(cat "$OUT/bp11.rc")：$(head -5 "$OUT/bp11.err")"

# BP11b：漂移与读取失败并存 → 3 优先（不降级）
write_match_fixtures
jq '(.rules[] | select(.type == "pull_request") | .parameters.required_approving_review_count) = 2' \
  "$FIX/ruleset-102.json" > "$FIX/x" && mv "$FIX/x" "$FIX/ruleset-102.json"
run_case bp11b BP_FIXTURE_DIR="$FIX" BP_CURL_FAIL_RULESET=101
[[ "$(cat "$OUT/bp11b.rc")" == "3" ]] && grep -q "required_approving_review_count" "$OUT/bp11b.err" \
  && pass "BP11b 漂移（批准数 2≠1）与规则集读取失败并存 → exit 3 优先（3 > 1 > 0，不降级）" \
  || fail "BP11b" "rc=$(cat "$OUT/bp11b.rc")：$(head -5 "$OUT/bp11b.err")"

# BP11c：保存文件缺失（沙箱内删一个）→ 无法核对 fail closed 3
write_match_fixtures
rm "$SANDBOX/devenv/rulesets/protect-dev-approval.json"
run_case bp11c BP_FIXTURE_DIR="$FIX"
[[ "$(cat "$OUT/bp11c.rc")" == "3" ]] && grep -q "缺失或解析失败" "$OUT/bp11c.err" \
  && pass "BP11c 保存配置文件缺失 → exit 3 fail closed（并指明文件）" \
  || fail "BP11c" "rc=$(cat "$OUT/bp11c.rc")：$(head -5 "$OUT/bp11c.err")"
cp "$REPO_ROOT/devenv/rulesets/protect-dev-approval.json" "$SANDBOX/devenv/rulesets/"

# ---------------------------------------------------------------------------
# 7. 读取身份绕过权断言（BP12）：current_user_can_bypass 非 never → 漂移
# ---------------------------------------------------------------------------
write_match_fixtures
jq '.current_user_can_bypass = "always"' "$FIX/ruleset-101.json" > "$FIX/x" && mv "$FIX/x" "$FIX/ruleset-101.json"
run_case bp12 BP_FIXTURE_DIR="$FIX" BP_GITHUB_TOKEN=stub-token
[[ "$(cat "$OUT/bp12.rc")" == "1" ]] && grep -q "current_user_can_bypass=always" "$OUT/bp12.err" \
  && pass "BP12 读取身份 current_user_can_bypass=always（读取者意外获得绕过权）→ 判漂移（App 在绕过名单属配置错误）" \
  || fail "BP12" "rc=$(cat "$OUT/bp12.rc")：$(head -5 "$OUT/bp12.err")"

# ---------------------------------------------------------------------------
# 8. 用法错误（BP13）
# ---------------------------------------------------------------------------
rc=0
PATH="$SANDBOX/stubbin:$PATH" BP_FIXTURE_DIR="$FIX" "$DEVENV" branch-protection bogus > "$OUT/bp13.out" 2> "$OUT/bp13.err" || rc=$?
[[ "$rc" == "2" ]] && pass "BP13 多余位置参数 → exit 2 用法错误" || fail "BP13" "rc=$rc"
rc=0
PATH="$SANDBOX/stubbin:$PATH" BP_FIXTURE_DIR="$FIX" "$DEVENV" branch-protection --verify extra > "$OUT/bp13b.out" 2> "$OUT/bp13b.err" || rc=$?
[[ "$rc" == "2" ]] && pass "BP13b --verify 后多余参数 → exit 2（不静默放行）" || fail "BP13b" "rc=$rc"

# ---------------------------------------------------------------------------
echo "------------------------------------------------------------"
echo "分支保护漂移核对离线测试完成：$PASS_COUNT 通过，$FAILURES 失败"
[[ "$FAILURES" == 0 ]]
