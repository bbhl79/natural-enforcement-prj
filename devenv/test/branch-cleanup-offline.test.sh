#!/usr/bin/env bash
# ============================================================================
# 分支清理与原型归档保护离线测试（#74）——不访问真实 GitHub（curl 全 mock）
#
# 接缝（Spec-工程基座 Testing Decisions）：devenv 命令面——命令输入 → 退出码/
# JSON/落盘结果。本地 git 用真实沙箱仓库（git 是白名单宿主工具），GitHub API
# 全 mock（curl stub 按 URL 路由夹具）。只测外部行为，不测实现细节。
#
# 覆盖：
#   1. 用法错误：缺分支 / --force（不存在强制删除路径）/ 未知旗标 / 本地分支不存在
#   2. prototype/* 留档豁免；dev/main/当前检出分支恒拒
#   3. 双重判断反例：未提交文件 / 未推送提交（无合入 PR）/ PR 合入后本地新增提交
#   4. 正例：PR 已 squash 合入 + 本地干净 + 无新增提交 → dry-run 可清理；--apply
#      删除 worktree + 分支（落盘结果核对）
#   5. fail-closed：PR 查询失败 → exit 3（不默认放行、不删除）
#   6. archive 标签规则集保存配置自检 + 漂移核对（target=tag）+ 自动删除设置核对
# ============================================================================
set -Eeuo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TEST_DIR/../.." && pwd)"

FAILURES=0
PASS_COUNT=0
pass() { printf 'PASS: %s\n' "$1"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { printf 'FAIL: %s —— %s\n' "$1" "$2"; FAILURES=$((FAILURES + 1)); }

SANDBOX=$(mktemp -d /tmp/devenv-bc-offline.XXXXXX)
trap 'rm -rf "$SANDBOX"' EXIT
OUT="$SANDBOX/out"; mkdir -p "$OUT"
cp -r "$REPO_ROOT/devenv" "$SANDBOX/devenv"
DEVENV="$SANDBOX/devenv/devenv"
FIX="$SANDBOX/fixtures"; mkdir -p "$FIX"

# 沙箱 = 真实 git 仓库（REPO_ROOT 即 devenv 副本的父目录）；dev 为默认分支。
git -C "$SANDBOX" init -q -b dev
git -C "$SANDBOX" config user.email "offline@test"
git -C "$SANDBOX" config user.name "offline"
git -C "$SANDBOX" config commit.gpgsign false
printf 'baseline\n' > "$SANDBOX/BASELINE.txt"
git -C "$SANDBOX" add -A
git -C "$SANDBOX" commit -qm "init baseline"
# 本地 bare origin（仅供 --remotes 未推送判定；GitHub PR 查询仍走 mock curl）
git init -q --bare "$SANDBOX/origin.git"
git -C "$SANDBOX" remote add origin "$SANDBOX/origin.git"
git -C "$SANDBOX" push -q origin dev

# mock curl：按 URL 路由到 $BP_FIXTURE_DIR 夹具；BP_CURL_FAIL=1 统一失败。
mkdir -p "$SANDBOX/stubbin"
cat > "$SANDBOX/stubbin/curl" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${BP_CURL_FAIL:-}" == "1" ]]; then echo "stub: transport error" >&2; exit 7; fi
url=""
for a in "$@"; do case "$a" in http*) url="$a";; esac; done
[[ -n "$url" ]] || { echo "stub: no url in args" >&2; exit 2; }
path="${url#https://api.github.com}"; path="${path%%\?*}"
case "$path" in
  /repos/bbhl79/natural-enforcement-prj)          cat "${BP_FIXTURE_DIR:?}/repo.json";;
  /repos/bbhl79/natural-enforcement-prj/pulls)    cat "${BP_FIXTURE_DIR}/pulls.json";;
  /repos/bbhl79/natural-enforcement-prj/rulesets) cat "${BP_FIXTURE_DIR}/rulesets-list.json";;
  /repos/bbhl79/natural-enforcement-prj/rulesets/*)
    id="${path##*/}"
    cat "${BP_FIXTURE_DIR}/ruleset-${id}.json";;
  *) echo "stub: no fixture for $path" >&2; exit 22;;
esac
STUB
chmod +x "$SANDBOX/stubbin/curl"

# 默认夹具：仓库默认分支 dev + 自动删除开启；空 PR 列表。
printf '{"default_branch": "dev", "full_name": "bbhl79/natural-enforcement-prj", "delete_branch_on_merge": true}' > "$FIX/repo.json"
printf '[]' > "$FIX/pulls.json"
printf '[]' > "$FIX/rulesets-list.json"

# run_cleanup <label> <args...>：沙箱内运行 branch-cleanup，捕获 rc/out/err
run_cleanup() {
  local label="$1"; shift
  local rc=0
  ( cd "$SANDBOX" && PATH="$SANDBOX/stubbin:$PATH" BP_FIXTURE_DIR="$FIX" "$DEVENV" branch-cleanup "$@" ) \
    > "$OUT/$label.out" 2> "$OUT/$label.err" || rc=$?
  echo "$rc" > "$OUT/$label.rc"
}

# commit_on <branch> <msg>：在分支上加一个真实提交（经临时 worktree），stdout 输出新 sha
commit_on() {
  local branch="$1" msg="$2" wt sha
  wt=$(mktemp -d /tmp/devenv-bc-wt.XXXXXX)
  git -C "$SANDBOX" worktree add -q "$wt" "$branch"
  printf '%s\n' "$msg" > "$wt/$msg.txt"
  git -C "$wt" add -A
  git -C "$wt" commit -qm "$msg"
  sha=$(git -C "$wt" rev-parse HEAD)
  git -C "$SANDBOX" worktree remove --force "$wt"
  rm -rf "$wt"
  printf '%s' "$sha"
}

# pr_fixture <head_sha> <merged true|false> [merge_commit_sha]：写 pulls.json
pr_fixture() {
  local head="$1" merged="$2" mc="${3:-}"
  if [[ "$merged" == "true" ]]; then
    jq -n --arg head "$head" --arg mc "$mc" \
      '[{number: 900, state: "closed", merged_at: "2026-11-28T00:00:00Z", merge_commit_sha: $mc, head: {sha: $head, ref: "feat/probe"}, base: {ref: "dev"}}]' > "$FIX/pulls.json"
  else
    printf '[]' > "$FIX/pulls.json"
  fi
}

# ---------------------------------------------------------------------------
# 1. 用法错误（BC1 系）
# ---------------------------------------------------------------------------
run_cleanup bc1a
[[ "$(cat "$OUT/bc1a.rc")" == "2" ]] \
  && pass "BC1a 缺分支参数 → exit 2 用法错误" \
  || fail "BC1a" "rc=$(cat "$OUT/bc1a.rc")：$(head -3 "$OUT/bc1a.err")"

run_cleanup bc1b feat/probe --force
[[ "$(cat "$OUT/bc1b.rc")" == "2" ]] && grep -qiE "强制|force" "$OUT/bc1b.err" \
  && pass "BC1b --force → exit 2（不存在强制删除路径）" \
  || fail "BC1b" "rc=$(cat "$OUT/bc1b.rc")：$(head -3 "$OUT/bc1b.err")"

run_cleanup bc1c feat/probe --bogus
[[ "$(cat "$OUT/bc1c.rc")" == "2" ]] \
  && pass "BC1c 未知旗标 → exit 2" \
  || fail "BC1c" "rc=$(cat "$OUT/bc1c.rc")：$(head -3 "$OUT/bc1c.err")"

run_cleanup bc1d no-such-branch
[[ "$(cat "$OUT/bc1d.rc")" == "2" ]] \
  && pass "BC1d 本地分支不存在 → exit 2" \
  || fail "BC1d" "rc=$(cat "$OUT/bc1d.rc")：$(head -3 "$OUT/bc1d.err")"

# ---------------------------------------------------------------------------
# 2. 豁免与恒拒（BC2 系）
# ---------------------------------------------------------------------------
git -C "$SANDBOX" branch prototype/foundation-slice-1 dev
run_cleanup bc2a prototype/foundation-slice-1
[[ "$(cat "$OUT/bc2a.rc")" == "4" ]] && grep -qiE "豁免|prototype" "$OUT/bc2a.err" \
  && pass "BC2a prototype/* 留档分支豁免 → exit 4 拒绝清理" \
  || fail "BC2a" "rc=$(cat "$OUT/bc2a.rc")：$(head -3 "$OUT/bc2a.err")"

run_cleanup bc2b dev
[[ "$(cat "$OUT/bc2b.rc")" == "4" ]] \
  && pass "BC2b dev（默认分支/当前检出）恒拒 → exit 4" \
  || fail "BC2b" "rc=$(cat "$OUT/bc2b.rc")：$(head -3 "$OUT/bc2b.err")"

# ---------------------------------------------------------------------------
# 3. 双重判断反例（BC3 系——AC2 核心）
# ---------------------------------------------------------------------------
# BC3 未提交文件：已合入 PR + 干净 tip，但 worktree 有未跟踪文件 → 拒绝
git -C "$SANDBOX" branch feat/bc3 dev
WT3="$SANDBOX/wt-bc3"
git -C "$SANDBOX" worktree add -q "$WT3" feat/bc3
printf 'a\n' > "$WT3/a.txt"; git -C "$WT3" add -A; git -C "$WT3" commit -qm a
HEAD3=$(git -C "$WT3" rev-parse HEAD)
pr_fixture "$HEAD3" true "$(git -C "$SANDBOX" rev-parse dev)"
printf 'dirty\n' > "$WT3/uncommitted.txt"   # 未提交（未跟踪）文件
run_cleanup bc3 feat/bc3
[[ "$(cat "$OUT/bc3.rc")" == "4" ]] && grep -q "未提交文件" "$OUT/bc3.err" \
  && pass "BC3 未提交文件（worktree 脏）→ exit 4 拒绝并列出原因" \
  || fail "BC3" "rc=$(cat "$OUT/bc3.rc")：$(head -4 "$OUT/bc3.err")"
run_cleanup bc3apply feat/bc3 --apply
[[ "$(cat "$OUT/bc3apply.rc")" == "4" ]] && git -C "$SANDBOX" show-ref --verify --quiet refs/heads/feat/bc3 && [[ -d "$WT3" ]] \
  && pass "BC3 --apply 同样拒绝（exit 4）且分支/worktree 均未删除（拒绝路径不破坏现场）" \
  || fail "BC3 apply" "rc=$(cat "$OUT/bc3apply.rc")"
git -C "$SANDBOX" worktree remove --force "$WT3"

# BC4 未推送提交（无合入 PR）：本地有远端不存在的提交 → 拒绝
git -C "$SANDBOX" branch feat/bc4 dev
commit_on feat/bc4 b4 >/dev/null
printf '[]' > "$FIX/pulls.json"
run_cleanup bc4 feat/bc4
[[ "$(cat "$OUT/bc4.rc")" == "4" ]] && grep -q "未推送提交" "$OUT/bc4.err" && grep -q "PR 未合入" "$OUT/bc4.err" \
  && pass "BC4 未推送提交 + 无合入 PR → exit 4 拒绝（双重判断不成立）" \
  || fail "BC4" "rc=$(cat "$OUT/bc4.rc")：$(head -4 "$OUT/bc4.err")"
run_cleanup bc4apply feat/bc4 --apply
[[ "$(cat "$OUT/bc4apply.rc")" == "4" ]] && git -C "$SANDBOX" show-ref --verify --quiet refs/heads/feat/bc4 \
  && pass "BC4 --apply 同样拒绝且分支未删除" \
  || fail "BC4 apply" "rc=$(cat "$OUT/bc4apply.rc")"

# BC5 PR 合入后本地新增提交：PR 已合（head=A），本地事后增提交 B → 拒绝
git -C "$SANDBOX" branch feat/bc5 dev
HEAD5=$(commit_on feat/bc5 b5a)
pr_fixture "$HEAD5" true "$(git -C "$SANDBOX" rev-parse dev)"
commit_on feat/bc5 b5b >/dev/null   # 合入后本地新增提交
run_cleanup bc5 feat/bc5
[[ "$(cat "$OUT/bc5.rc")" == "4" ]] && grep -q "合入后本地新增提交" "$OUT/bc5.err" \
  && pass "BC5 PR 已 squash 合入但本地事后增提交 → exit 4 拒绝（合入 head 基准比对）" \
  || fail "BC5" "rc=$(cat "$OUT/bc5.rc")：$(head -4 "$OUT/bc5.err")"
run_cleanup bc5apply feat/bc5 --apply
[[ "$(cat "$OUT/bc5apply.rc")" == "4" ]] && git -C "$SANDBOX" show-ref --verify --quiet refs/heads/feat/bc5 \
  && pass "BC5 --apply 同样拒绝且分支未删除（合入后新增提交不被强删）" \
  || fail "BC5 apply" "rc=$(cat "$OUT/bc5apply.rc")"

# ---------------------------------------------------------------------------
# 4. 正例（BC6 系）：已合入 + 干净 + 无新增 → dry-run 可清理；--apply 删除
# ---------------------------------------------------------------------------
git -C "$SANDBOX" branch feat/bc6 dev
HEAD6=$(commit_on feat/bc6 b6)
pr_fixture "$HEAD6" true "$(git -C "$SANDBOX" rev-parse dev)"
run_cleanup bc6dry feat/bc6
[[ "$(cat "$OUT/bc6dry.rc")" == "0" ]] && git -C "$SANDBOX" show-ref --verify --quiet refs/heads/feat/bc6 \
  && pass "BC6 dry-run：已合入+干净+无新增 → exit 0 可清理（默认不删除，分支仍在）" \
  || fail "BC6 dry" "rc=$(cat "$OUT/bc6dry.rc")：$(head -4 "$OUT/bc6dry.err")"
run_cleanup bc6apply feat/bc6 --apply
[[ "$(cat "$OUT/bc6apply.rc")" == "0" ]] && ! git -C "$SANDBOX" show-ref --verify --quiet refs/heads/feat/bc6 \
  && pass "BC6 --apply：判定通过后删除分支（落盘核对：分支已不存在）" \
  || fail "BC6 apply" "rc=$(cat "$OUT/bc6apply.rc")：$(head -4 "$OUT/bc6apply.err")"

# BC6c 带 worktree 的正例：--apply 同时移除 worktree + 分支
git -C "$SANDBOX" branch feat/bc6c dev
WT6="$SANDBOX/wt-bc6c"
git -C "$SANDBOX" worktree add -q "$WT6" feat/bc6c
printf 'c\n' > "$WT6/c.txt"; git -C "$WT6" add -A; git -C "$WT6" commit -qm c
HEAD6C=$(git -C "$WT6" rev-parse HEAD)
pr_fixture "$HEAD6C" true "$(git -C "$SANDBOX" rev-parse dev)"
run_cleanup bc6c feat/bc6c --apply
[[ "$(cat "$OUT/bc6c.rc")" == "0" ]] && [[ ! -d "$WT6" ]] && ! git -C "$SANDBOX" show-ref --verify --quiet refs/heads/feat/bc6c \
  && pass "BC6c --apply：干净 worktree + 分支一并移除（落盘核对）" \
  || fail "BC6c" "rc=$(cat "$OUT/bc6c.rc")：$(head -4 "$OUT/bc6c.err")"

# BC6d --json 终值结构化（含合入 head / squash 提交哈希——验收以哈希定位）
git -C "$SANDBOX" branch feat/bc6d dev
HEAD6D=$(commit_on feat/bc6d b6d)
pr_fixture "$HEAD6D" true "$(git -C "$SANDBOX" rev-parse dev)"
rc=0
( cd "$SANDBOX" && PATH="$SANDBOX/stubbin:$PATH" BP_FIXTURE_DIR="$FIX" "$DEVENV" --json branch-cleanup feat/bc6d ) \
  > "$OUT/bc6d.out" 2> "$OUT/bc6d.err" || rc=$?
jq -e --arg h "$HEAD6D" 'select(.command == "branch-cleanup") | .status == "ok" and .exitCode == 0 and .action == "dry-run" and .merged_head == $h' \
  <(grep -v '^{"event"' "$OUT/bc6d.out") >/dev/null 2>&1 \
  && pass "BC6d --json 终值含 merged_head 哈希（以提交哈希为定位依据）" \
  || fail "BC6d" "rc=$rc 终值异常：$(cat "$OUT/bc6d.out")"

# ---------------------------------------------------------------------------
# 5. fail-closed（BC7）：PR 查询失败 → exit 3，不删除
# ---------------------------------------------------------------------------
git -C "$SANDBOX" branch feat/bc7 dev
commit_on feat/bc7 b7 >/dev/null
rc=0
( cd "$SANDBOX" && PATH="$SANDBOX/stubbin:$PATH" BP_FIXTURE_DIR="$FIX" BP_CURL_FAIL=1 "$DEVENV" branch-cleanup feat/bc7 --apply ) \
  > "$OUT/bc7.out" 2> "$OUT/bc7.err" || rc=$?
[[ "$rc" == "3" ]] && git -C "$SANDBOX" show-ref --verify --quiet refs/heads/feat/bc7 \
  && pass "BC7 PR 查询失败 → exit 3 fail-closed（即便 --apply 也不删除，分支仍在）" \
  || fail "BC7" "rc=$rc：$(head -4 "$OUT/bc7.err")"

# ---------------------------------------------------------------------------
# 6. archive 标签规则集 + 合入后自动删除设置漂移核对（BC8 系——AC4 / AC1 远端）
# ---------------------------------------------------------------------------
rs_dir="$REPO_ROOT/devenv/rulesets"
# BC8a 保存配置自检：target=tag、include=refs/tags/archive/*、update+deletion、无绕过
jq -e '(.name == "protect-archive-tags") and (.target == "tag") and (.enforcement == "active")
       and (.conditions.ref_name.include == ["refs/tags/archive/*"]) and (.conditions.ref_name.exclude == [])
       and ([.rules[].type] | sort == ["deletion", "update"])
       and ((.bypass_actors // []) | length == 0)' "$rs_dir/protect-archive-tags.json" >/dev/null 2>&1 \
  && pass "BC8a protect-archive-tags 保存配置自检（tag/archive/*/update+deletion/无绕过——禁更新禁删除允许创建）" \
  || fail "BC8a" "保存配置不满足语义：$(jq -c . "$rs_dir/protect-archive-tags.json" 2>&1 | head -c 300)"

# live_of <saved-file> <id> → 公开面 live JSON（剥离 bypass_actors，cub=never，规则乱序测归一化）
live_of() {
  local f="$1" id="$2"
  jq --argjson id "$id" 'del(.bypass_actors)
    | . + {id: $id, node_id: "RRS_x", source_type: "Repository", source: "bbhl79/natural-enforcement-prj",
           current_user_can_bypass: "never", _links: {self: {href: "x"}, html: {href: "x"}},
           created_at: "2026-11-28T00:00:00Z", updated_at: "2026-11-28T00:00:00Z"}
    | .rules = (.rules | reverse)' "$f"
}
run_bp() {
  local label="$1"; shift
  local rc=0
  PATH="$SANDBOX/stubbin:$PATH" env "$@" "$DEVENV" branch-protection > "$OUT/$label.out" 2> "$OUT/$label.err" || rc=$?
  echo "$rc" > "$OUT/$label.rc"
}
# 一致夹具：dev 两层(101/102) + archive tag(201)，自动删除开启
write_bp_fixtures() {
  printf '{"default_branch": "dev", "full_name": "bbhl79/natural-enforcement-prj", "delete_branch_on_merge": true}' > "$FIX/repo.json"
  live_of "$rs_dir/protect-dev-base.json" 101 > "$FIX/ruleset-101.json"
  live_of "$rs_dir/protect-dev-approval.json" 102 > "$FIX/ruleset-102.json"
  live_of "$rs_dir/protect-archive-tags.json" 201 > "$FIX/ruleset-201.json"
  printf '[{"id":101,"name":"protect-dev-base","target":"branch","enforcement":"active"},{"id":102,"name":"protect-dev-approval","target":"branch","enforcement":"active"},{"id":201,"name":"protect-archive-tags","target":"tag","enforcement":"active"}]' > "$FIX/rulesets-list.json"
}

write_bp_fixtures
run_bp bp8b BP_FIXTURE_DIR="$FIX"
[[ "$(cat "$OUT/bp8b.rc")" == "0" ]] \
  && pass "BC8b dev 两层 + archive tag 规则集 + 自动删除开启，实时与保存一致 → exit 0" \
  || fail "BC8b" "rc=$(cat "$OUT/bp8b.rc")：$(head -5 "$OUT/bp8b.err")"

# BC8c archive tag 规则集远端缺失 → 漂移
write_bp_fixtures
printf '[{"id":101,"name":"protect-dev-base","target":"branch","enforcement":"active"},{"id":102,"name":"protect-dev-approval","target":"branch","enforcement":"active"}]' > "$FIX/rulesets-list.json"
rm -f "$FIX/ruleset-201.json"
run_bp bp8c BP_FIXTURE_DIR="$FIX"
[[ "$(cat "$OUT/bp8c.rc")" == "1" ]] && grep -q "protect-archive-tags" "$OUT/bp8c.err" \
  && pass "BC8c archive tag 规则集远端缺失 → exit 1 漂移（保存配置未见于远端）" \
  || fail "BC8c" "rc=$(cat "$OUT/bp8c.rc")：$(head -5 "$OUT/bp8c.err")"

# BC8d archive tag 规则集被削弱（删除 deletion 规则）→ 漂移
write_bp_fixtures
jq '.rules = [.rules[] | select(.type != "deletion")]' "$FIX/ruleset-201.json" > "$FIX/x" && mv "$FIX/x" "$FIX/ruleset-201.json"
run_bp bp8d BP_FIXTURE_DIR="$FIX"
[[ "$(cat "$OUT/bp8d.rc")" == "1" ]] && grep -q "protect-archive-tags" "$OUT/bp8d.err" \
  && pass "BC8d archive tag 规则集削弱（缺 deletion 规则）→ exit 1 漂移" \
  || fail "BC8d" "rc=$(cat "$OUT/bp8d.rc")：$(head -5 "$OUT/bp8d.err")"

# BC8e 自动删除关闭 → 漂移
write_bp_fixtures
printf '{"default_branch": "dev", "full_name": "bbhl79/natural-enforcement-prj", "delete_branch_on_merge": false}' > "$FIX/repo.json"
run_bp bp8e BP_FIXTURE_DIR="$FIX"
[[ "$(cat "$OUT/bp8e.rc")" == "1" ]] && grep -q "delete_branch_on_merge" "$OUT/bp8e.err" \
  && pass "BC8e 合入后自动删除关闭（delete_branch_on_merge=false）→ exit 1 漂移" \
  || fail "BC8e" "rc=$(cat "$OUT/bp8e.rc")：$(head -5 "$OUT/bp8e.err")"

# BC8f 自动删除字段对匿名不可见 → 公开面 NOTE 跳过（exit 0，不死锁匿名本地核对；与 bypass_actors 同口径）
write_bp_fixtures
printf '{"default_branch": "dev", "full_name": "bbhl79/natural-enforcement-prj"}' > "$FIX/repo.json"
run_bp bp8f BP_FIXTURE_DIR="$FIX"
[[ "$(cat "$OUT/bp8f.rc")" == "0" ]] && grep -q "delete_branch_on_merge 对当前读取身份不可见" "$OUT/bp8f.err" \
  && pass "BC8f 匿名读取缺 delete_branch_on_merge → 公开面 NOTE 跳过（exit 0，不谎报已核对也不死锁）" \
  || fail "BC8f" "rc=$(cat "$OUT/bp8f.rc")：$(head -5 "$OUT/bp8f.err")"

# BC8h 管理员强校验（--require-bypass-actors）+ 自动删除字段缺失 → fail closed 漂移
write_bp_fixtures
printf '{"default_branch": "dev", "full_name": "bbhl79/natural-enforcement-prj"}' > "$FIX/repo.json"
rc=0
PATH="$SANDBOX/stubbin:$PATH" env BP_FIXTURE_DIR="$FIX" BP_GITHUB_TOKEN=stub-admin "$DEVENV" branch-protection --require-bypass-actors \
  > "$OUT/bp8h.out" 2> "$OUT/bp8h.err" || rc=$?
[[ "$rc" == "1" ]] && grep -q "delete_branch_on_merge" "$OUT/bp8h.err" \
  && pass "BC8h 管理员强校验 + 自动删除字段缺失 → exit 1 fail-closed（确认凭据具备 push 权限）" \
  || fail "BC8h" "rc=$rc：$(head -5 "$OUT/bp8h.err")"

# BC8g 额外 tag 规则集覆盖 archive/*（非保存配置）→ 漂移
write_bp_fixtures
jq '. + {id: 202, name: "rogue-archive-bypass"}' "$FIX/ruleset-201.json" > "$FIX/ruleset-202.json"
jq '. + [{id:202,name:"rogue-archive-bypass",target:"tag",enforcement:"active"}]' "$FIX/rulesets-list.json" > "$FIX/x" && mv "$FIX/x" "$FIX/rulesets-list.json"
run_bp bp8g BP_FIXTURE_DIR="$FIX"
[[ "$(cat "$OUT/bp8g.rc")" == "1" ]] && grep -q "rogue-archive-bypass" "$OUT/bp8g.err" \
  && pass "BC8g 额外 tag 规则集覆盖 archive/* 命名空间 → exit 1 漂移（防削弱归档保护）" \
  || fail "BC8g" "rc=$(cat "$OUT/bp8g.rc")：$(head -5 "$OUT/bp8g.err")"

# ---------------------------------------------------------------------------
# 7. 活跃栈锁/租约保护 + fail-closed 补全 + 拒绝路径 --json 纯度（BC9–BC11）
# ---------------------------------------------------------------------------
# BC9 目标 worktree 持活跃栈锁 → exit 6 绝不强拆（gitignored .devenv-state 对 status 不可见）
git -C "$SANDBOX" branch feat/bc9 dev
WT9="$SANDBOX/wt-bc9"
git -C "$SANDBOX" worktree add -q "$WT9" feat/bc9
printf 'x\n' > "$WT9/x.txt"; git -C "$WT9" add -A; git -C "$WT9" commit -qm x
HEAD9=$(git -C "$WT9" rev-parse HEAD)
pr_fixture "$HEAD9" true "$(git -C "$SANDBOX" rev-parse dev)"
wtid=$(git -C "$WT9" rev-parse --absolute-git-dir)
suf=$(printf '%s' "$wtid" | sha256sum | awk '{print $1}' | cut -c1-8)
mkdir -p "$SANDBOX/locks/stack-$suf.lock"
printf '%s 0\n' "$$" > "$SANDBOX/locks/stack-$suf.lock/owner"   # 持有者=本测试进程（存活）
rc=0
( cd "$SANDBOX" && PATH="$SANDBOX/stubbin:$PATH" BP_FIXTURE_DIR="$FIX" DEVENV_LOCK_ROOT="$SANDBOX/locks" "$DEVENV" branch-cleanup feat/bc9 --apply ) \
  > "$OUT/bc9.out" 2> "$OUT/bc9.err" || rc=$?
[[ "$rc" == "6" ]] && git -C "$SANDBOX" show-ref --verify --quiet refs/heads/feat/bc9 && [[ -d "$WT9" ]] \
  && pass "BC9 目标 worktree 持活跃栈锁 → exit 6 拒绝（绝不强拆，分支/worktree 保留）" \
  || fail "BC9" "rc=$rc：$(head -4 "$OUT/bc9.err")"
rm -rf "$SANDBOX/locks"
git -C "$SANDBOX" worktree remove --force "$WT9"

# BC10 合入 head 不在本地对象库 → exit 3 fail-closed（先 fetch，不删除）
git -C "$SANDBOX" branch feat/bc10 dev
commit_on feat/bc10 b10 >/dev/null
pr_fixture "0000000000000000000000000000000000000000" true "$(git -C "$SANDBOX" rev-parse dev)"
run_cleanup bc10 feat/bc10 --apply
[[ "$(cat "$OUT/bc10.rc")" == "3" ]] && git -C "$SANDBOX" show-ref --verify --quiet refs/heads/feat/bc10 \
  && pass "BC10 合入 head 不在本地对象库 → exit 3 fail-closed（不删除）" \
  || fail "BC10" "rc=$(cat "$OUT/bc10.rc")：$(head -4 "$OUT/bc10.err")"

# BC11 拒绝路径 --json 纯度：stdout 仅 JSONL（事件+终值），原因走 stderr
rc=0
( cd "$SANDBOX" && PATH="$SANDBOX/stubbin:$PATH" BP_FIXTURE_DIR="$FIX" "$DEVENV" --json branch-cleanup prototype/foundation-slice-1 ) \
  > "$OUT/bc11.out" 2> "$OUT/bc11.err" || rc=$?
[[ "$rc" == "4" ]] && ! grep -q "WARN" "$OUT/bc11.out" && grep -q "豁免" "$OUT/bc11.err" \
  && jq -e 'select(.command == "branch-cleanup") | .status == "failed" and .exitCode == 4' \
       <(grep -v '^{"event"' "$OUT/bc11.out") >/dev/null 2>&1 \
  && pass "BC11 拒绝路径 --json：stdout 仅 JSONL 终值（failed/4），原因走 stderr（不污染结果流）" \
  || fail "BC11" "rc=$rc out=$(cat "$OUT/bc11.out")"

# ---------------------------------------------------------------------------
# 8. 锁族覆盖 / locked / 短旗标 / exit 6 协议（BC12 系——评审补漏）
# ---------------------------------------------------------------------------
# mk_busy_lock <wt> <锁目录相对名>：为 worktree 造一个活跃锁目录（持有者=本测试进程）
mk_busy_lock() {
  local wt="$1" rel="$2" wtid suf dir
  wtid=$(git -C "$wt" rev-parse --absolute-git-dir)
  suf=$(printf '%s' "$wtid" | sha256sum | awk '{print $1}' | cut -c1-8)
  dir="$SANDBOX/locks/$(printf '%s' "$rel" | sed "s/SUF/$suf/")"
  mkdir -p "$dir"
  printf '%s 0\n' "$$" > "$dir/owner"
}
# mk_busy_case <branch-prefix>：建分支+干净 worktree+已合入 PR 夹具
mk_busy_case() {
  local name="$1"
  git -C "$SANDBOX" branch "$name" dev
  local wt="$SANDBOX/wt-$name"
  git -C "$SANDBOX" worktree add -q "$wt" "$name"
  printf 'x\n' > "$wt/x.txt"; git -C "$wt" add -A; git -C "$wt" commit -qm x
  pr_fixture "$(git -C "$wt" rev-parse HEAD)" true "$(git -C "$SANDBOX" rev-parse dev)"
  printf '%s' "$wt"
}
run_cleanup_lockroot() { # run_cleanup_lockroot <label> <args...>：带 DEVENV_LOCK_ROOT 沙箱锁目录
  local label="$1"; shift
  local rc=0
  ( cd "$SANDBOX" && PATH="$SANDBOX/stubbin:$PATH" BP_FIXTURE_DIR="$FIX" DEVENV_LOCK_ROOT="$SANDBOX/locks" "$DEVENV" branch-cleanup "$@" ) \
    > "$OUT/$label.out" 2> "$OUT/$label.err" || rc=$?
  echo "$rc" > "$OUT/$label.rc"
}

# BC12a 活跃共享租约（.lease 槽）阻塞 → exit 6
WT=$(mk_busy_case feat-bc12a)
mk_busy_lock "$WT" "stack-SUF.lease/slot1.1.abc"
run_cleanup_lockroot bc12a feat-bc12a --apply
[[ "$(cat "$OUT/bc12a.rc")" == "6" ]] && git -C "$SANDBOX" show-ref --verify --quiet refs/heads/feat-bc12a \
  && pass "BC12a 活跃 stack 共享租约槽 → exit 6 拒绝（绝不强拆）" \
  || fail "BC12a" "rc=$(cat "$OUT/bc12a.rc")：$(head -4 "$OUT/bc12a.err")"
rm -rf "$SANDBOX/locks"; git -C "$SANDBOX" worktree remove --force "$WT" 2>/dev/null || true

# BC12b gen-<suffix> 锁阻塞 → exit 6（gen 不持 stack 锁，单独覆盖）
WT=$(mk_busy_case feat-bc12b)
mk_busy_lock "$WT" "gen-SUF.lock"
run_cleanup_lockroot bc12b feat-bc12b --apply
[[ "$(cat "$OUT/bc12b.rc")" == "6" ]] && git -C "$SANDBOX" show-ref --verify --quiet refs/heads/feat-bc12b \
  && pass "BC12b 活跃 gen-<wt> 锁 → exit 6 拒绝（非 stack 锁族也覆盖）" \
  || fail "BC12b" "rc=$(cat "$OUT/bc12b.rc")：$(head -4 "$OUT/bc12b.err")"
rm -rf "$SANDBOX/locks"; git -C "$SANDBOX" worktree remove --force "$WT" 2>/dev/null || true

# BC12c e2e-owner-<suffix>-<runid> 锁阻塞 → exit 6
WT=$(mk_busy_case feat-bc12c)
mk_busy_lock "$WT" "e2e-owner-SUF-runx.lock"
run_cleanup_lockroot bc12c feat-bc12c --apply
[[ "$(cat "$OUT/bc12c.rc")" == "6" ]] \
  && pass "BC12c 活跃 e2e-owner-<wt>-<runid> 锁 → exit 6 拒绝" \
  || fail "BC12c" "rc=$(cat "$OUT/bc12c.rc")：$(head -4 "$OUT/bc12c.err")"
rm -rf "$SANDBOX/locks"; git -C "$SANDBOX" worktree remove --force "$WT" 2>/dev/null || true

# BC12d locked worktree → dry-run 即 exit 4（与 --apply 判定一致，不拖到删除才报错）
WT=$(mk_busy_case feat-bc12d)
git -C "$SANDBOX" worktree lock "$WT"
run_cleanup bc12d feat-bc12d
[[ "$(cat "$OUT/bc12d.rc")" == "4" ]] && grep -q "lock" "$OUT/bc12d.err" \
  && pass "BC12d locked worktree → dry-run 即 exit 4 拒绝（判定前后一致）" \
  || fail "BC12d" "rc=$(cat "$OUT/bc12d.rc")：$(head -4 "$OUT/bc12d.err")"
git -C "$SANDBOX" worktree unlock "$WT" 2>/dev/null || true
git -C "$SANDBOX" worktree remove --force "$WT" 2>/dev/null || true

# BC12e 短旗标拒绝：-f/-F/-D → exit 2（不得落入「分支不存在」歧义）
for flag in -f -F -D; do
  run_cleanup "bc12e${flag#-}" feat/probe "$flag"
  [[ "$(cat "$OUT/bc12e${flag#-}.rc")" == "2" ]] && grep -qiE "强制|force" "$OUT/bc12e${flag#-}.err" \
    && pass "BC12e 短旗标 $flag → exit 2（拒绝强制路径）" \
    || fail "BC12e $flag" "rc=$(cat "$OUT/bc12e${flag#-}.rc")：$(head -2 "$OUT/bc12e${flag#-}.err")"
done

# BC12f exit 6 的 --json 终值协议：stdout 仅 JSONL 且终值 exitCode=6
WT=$(mk_busy_case feat-bc12f)
mk_busy_lock "$WT" "stack-SUF.lock"
rc=0
( cd "$SANDBOX" && PATH="$SANDBOX/stubbin:$PATH" BP_FIXTURE_DIR="$FIX" DEVENV_LOCK_ROOT="$SANDBOX/locks" "$DEVENV" --json branch-cleanup feat-bc12f --apply ) \
  > "$OUT/bc12f.out" 2> "$OUT/bc12f.err" || rc=$?
[[ "$rc" == "6" ]] && ! grep -q "WARN" "$OUT/bc12f.out" \
  && jq -e 'select(.command == "branch-cleanup") | .status == "failed" and .exitCode == 6' \
       <(grep -v '^{"event"' "$OUT/bc12f.out") >/dev/null 2>&1 \
  && pass "BC12f exit 6 拒绝 --json：stdout 仅 JSONL 且终值 exitCode=6（协议不破）" \
  || fail "BC12f" "rc=$rc out=$(cat "$OUT/bc12f.out")"
rm -rf "$SANDBOX/locks"; git -C "$SANDBOX" worktree remove --force "$WT" 2>/dev/null || true

echo "------------------------------------------------------------"
echo "分支清理离线测试完成：$PASS_COUNT 通过，$FAILURES 失败"
[[ "$FAILURES" == 0 ]]