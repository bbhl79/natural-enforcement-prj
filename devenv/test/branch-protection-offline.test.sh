#!/usr/bin/env bash
# ============================================================================
# 分支保护两层规则集漂移核对离线测试（#73）——不访问真实 GitHub（curl 全 mock）
#
# 覆盖：
#   1. 保存配置自检（4 个 JSON 均为合法规则集语义：必填参数齐全、绕过者
#      点名正确、dev 两层与验收测试分支对目标正确）
#   2. 漂移核对行为：一致（含规则顺序/冗余字段归一化）/ 规则缺失 / 参数漂移 /
#      绕过名单缺失 / bypass_actors 字段不可见（fail closed）/ 规则集缺失 /
#      额外规则集覆盖 dev（精确、通配、~DEFAULT_BRANCH）不误报（验收期
#      transient 测试分支规则集、exclude 摘除 dev）
#   3. fetch 失败与响应畸形 → fail closed（exit 3，不判一致）
#   4. --json 输出结构化（事件 + 终值含 findings 计数）
#   5. BP_GITHUB_TOKEN 存在时走带凭据路径（stub 同样可用）
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

# mock curl：按 URL 路由到 $BP_FIXTURE_DIR 下夹具；BP_CURL_FAIL=1 时统一失败
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
  /repos/bbhl79/natural-enforcement-prj/rulesets/*) id="${path##*/}"; cat "${BP_FIXTURE_DIR}/ruleset-${id}.json";;
  *) echo "stub: no fixture for $path" >&2; exit 22;;
esac
STUB
chmod +x "$SANDBOX/stubbin/curl"

DEVENV="$SANDBOX/devenv/devenv"
FIX="$SANDBOX/fixtures"; mkdir -p "$FIX"

# run_case <label> <env assignments...>：沙箱内运行 branch-protection，捕获 rc/out/err
run_case() { # run_case <label> <env assignments...>
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

jq -e '.rules[] | select(.type == "required_status_checks") | .parameters.required_status_checks[0].context == "quality-gate"
       and (.parameters.strict_required_status_checks_policy == false)' "$rs_dir/protect-dev-base.json" > /dev/null \
  && pass "BP0 base：必需检查 quality-gate 登记（#71 实际检查名）" \
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
# 夹具构造：live 规则集 = 保存配置 + 实时专属字段 + 规则乱序（测归一化）
# ---------------------------------------------------------------------------
live_of() { # live_of <saved-file> <id> → stdout live JSON
  jq --argjson id "$2" '
    . + {id: $id, node_id: "RRS_x", source_type: "Repository",
         source: "bbhl79/natural-enforcement-prj", enforcement: .enforcement,
         current_user_can_bypass: "never", _links: {self: {href: "x"}, html: {href: "x"}},
         created_at: "2026-11-28T00:00:00Z", updated_at: "2026-11-28T00:00:00Z"}
    | .rules = (.rules | reverse)
  ' "$1"
}

write_match_fixtures() { # 一致场景：dev 两层与远端逐字段一致（无额外）
  printf '{"default_branch": "dev", "full_name": "bbhl79/natural-enforcement-prj"}' > "$FIX/repo.json"
  live_of "$rs_dir/protect-dev-base.json" 101 > "$FIX/ruleset-101.json"
  live_of "$rs_dir/protect-dev-approval.json" 102 > "$FIX/ruleset-102.json"
  printf '[{"id":101,"name":"protect-dev-base","target":"branch","enforcement":"active"},{"id":102,"name":"protect-dev-approval","target":"branch","enforcement":"active"}]' > "$FIX/rulesets-list.json"
}

# ---------------------------------------------------------------------------
# 2. 一致（BP1）与归一化（乱序/冗余字段不误报）
# ---------------------------------------------------------------------------
write_match_fixtures
run_case bp1 BP_FIXTURE_DIR="$FIX"
[[ "$(cat "$OUT/bp1.rc")" == "0" ]] && grep -q "一致" "$OUT/bp1.err" \
  && pass "BP1 实时与保存一致（规则乱序/实时专属字段归一化后逐字段相同）→ exit 0" \
  || fail "BP1" "rc=$(cat "$OUT/bp1.rc")：$(head -5 "$OUT/bp1.err")"

# BP1b：--json 结构化输出（事件 + 终值含 findings）
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
# 3. 漂移检出（BP2–BP6）
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
[[ "$(cat "$OUT/bp3.rc")" == "1" ]] && grep -q "审批层\|规则集内容不一致" "$OUT/bp3.err" \
  && pass "BP3 审批层 dismiss_stale 实际为 false（应为 true）→ 漂移（新推送未使旧批准失效即配置漂移）" \
  || fail "BP3" "rc=$(cat "$OUT/bp3.rc")：$(head -5 "$OUT/bp3.err")"

write_match_fixtures
jq 'del(.bypass_actors)' "$FIX/ruleset-102.json" > "$FIX/x" && mv "$FIX/x" "$FIX/ruleset-102.json"
run_case bp4 BP_FIXTURE_DIR="$FIX"
[[ "$(cat "$OUT/bp4.rc")" == "1" ]] && grep -q "bypass_actors 字段" "$OUT/bp4.err" \
  && pass "BP4 实际响应无 bypass_actors 字段而保存配置预期绕过名单 → fail closed 漂移 + 人工核对指引" \
  || fail "BP4" "rc=$(cat "$OUT/bp4.rc")：$(head -5 "$OUT/bp4.err")"

write_match_fixtures
jq '.bypass_actors = []' "$FIX/ruleset-102.json" > "$FIX/x" && mv "$FIX/x" "$FIX/ruleset-102.json"
run_case bp5 BP_FIXTURE_DIR="$FIX"
[[ "$(cat "$OUT/bp5.rc")" == "1" ]] && grep -q "绕过名单不一致" "$OUT/bp5.err" \
  && pass "BP5 实际绕过名单为空（保存配置点名指挥者）→ 漂移" \
  || fail "BP5" "rc=$(cat "$OUT/bp5.rc")：$(head -5 "$OUT/bp5.err")"

write_match_fixtures
jq 'del(.bypass_actors) | (.rules[] | select(.type == "pull_request") | .parameters.dismiss_stale_reviews_on_push) = false' \
  "$FIX/ruleset-102.json" > "$FIX/x" && mv "$FIX/x" "$FIX/ruleset-102.json"
run_case bp5b BP_FIXTURE_DIR="$FIX"
[[ "$(cat "$OUT/bp5b.rc")" == "1" ]] \
  && pass "BP5b 多项漂移同报（绕过名单缺失 + 参数漂移），exit 1" \
  || fail "BP5b" "rc=$(cat "$OUT/bp5b.rc")"

# ---------------------------------------------------------------------------
# 4. 额外规则集覆盖 dev（BP6）与不误报（BP7）
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

# BP7a：验收期 transient 测试分支规则集（不覆盖 dev）不误报
write_match_fixtures
live_of "$rs_dir/protect-bp73-test-base.json" 103 > "$FIX/x"
jq '.name = "protect-bp73-test-base"' "$FIX/x" > "$FIX/ruleset-103.json"
live_of "$rs_dir/protect-bp73-test-approval.json" 104 > "$FIX/x"
jq '.name = "protect-bp73-test-approval"' "$FIX/x" > "$FIX/ruleset-104.json"
printf '[{"id":101,"name":"protect-dev-base","target":"branch","enforcement":"active"},{"id":102,"name":"protect-dev-approval","target":"branch","enforcement":"active"},{"id":103,"name":"protect-bp73-test-base","target":"branch","enforcement":"active"},{"id":104,"name":"protect-bp73-test-approval","target":"branch","enforcement":"active"}]' > "$FIX/rulesets-list.json"
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
# 5. fetch 失败 / 响应畸形 → fail closed（BP9–BP10）
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

# BP11：用法错误（多余参数）
rc=0; PATH="$SANDBOX/stubbin:$PATH" "$DEVENV" branch-protection bogus > "$OUT/bp11.out" 2> "$OUT/bp11.err" || rc=$?
[[ "$rc" == "2" ]] && pass "BP11 多余参数 → exit 2 用法错误" || fail "BP11" "rc=$rc"

# ---------------------------------------------------------------------------
echo "------------------------------------------------------------"
echo "分支保护漂移核对离线测试完成：$PASS_COUNT 通过，$FAILURES 失败"
[[ "$FAILURES" == 0 ]]
