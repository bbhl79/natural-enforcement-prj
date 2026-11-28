#!/usr/bin/env bash
# ============================================================================
# 分支清理与原型归档保护受控验收 harness（#74；Spec-工程基座 §7 / 验收清单项 11）
#
# 形态：分阶段执行（阶段间与指挥者的 GitHub Web UI 操作交错）。每阶段把命令、
# 退出码、GitHub 响应捕获进证据目录（默认 .artifacts/74-branch-cleanup/，gitignored），
# 对「应拒」/「应成」做 PASS/FAIL 断言，并**记录提交哈希**（以哈希为最终定位依据）。
# 本 harness 只做 App 身份能做的部分（经 ./devenv/devenv 唯一入口）；开启自动删除、
# 创建 archive 标签规则集、批准/合入探针 PR 是指挥者本人步骤，见 docs/agents/branch-cleanup.md。
#
# 与离线测试的分工（验收覆盖分类：项 11「一次 + 一平台」）：
#   - 清理逻辑反例（未提交文件/未推送提交/合入后新增提交/prototype 豁免/无强制路径）
#     由 branch-cleanup-offline.test.sh 以真实 git 沙箱 + mock GitHub 覆盖（一平台，代码逻辑）。
#   - 本 harness 覆盖真实 GitHub 配置面（一次）：自动删除实际生效、archive 标签保护
#     实际禁止更新/删除、真实合入 PR 的本地清理正例、提交哈希留档。
#
# 安全口径：
#   - archive 标签反例（更新/删除尝试）**前置断言保护规则集已 active 且 App 无绕过权**，
#     否则不尝试（避免在无保护时误改真实归档标签）；被拒即零写入，前后核对标签哈希不动。
#   - 探针 PR 靶分支为专用测试分支（不向 dev 写入无效变更）；合入由指挥者执行。
#   - 不承诺旧环境永远可重建——归档只保证源码经标签/提交哈希可追溯。
#
# 阶段（devenv test:branch-cleanup <阶段>）：
#   status            只读总览（自动删除设置 / archive 规则集 / archive 标签+哈希 / 清理候选）
#   prepare           建测试分支 + 探针分支（本地 worktree）+ 探针 PR（App）；指挥者随后合入
#   verify-config     dev 两层 + archive 标签规则集 + 自动删除设置 ↔ 保存配置核对（App）
#   negatives         archive 标签更新/删除尝试应拒（零写入，哈希不动）
#   cleanup-positive  探针 PR 合入后：远端分支自动删除断言 + 本地 branch-cleanup --apply 正例
#   cleanup-test      关探针 PR、删测试分支（探针分支已在 cleanup-positive 清理）
#   summary           AC1–5 映射 + 提交哈希汇总到 summary.txt
#
# 默认（无参数）= status（只读安全）。所有 GitHub 操作经 ./devenv/devenv（App 身份）。
# ============================================================================
set -Eeuo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TEST_DIR/../.." && pwd)"
DEVENV="$REPO_ROOT/devenv/devenv"
# shellcheck source=../lib/github-app-auth.sh
source "$REPO_ROOT/devenv/lib/github-app-auth.sh"
# shellcheck source=../lib/branch-protection.sh
source "$REPO_ROOT/devenv/lib/branch-protection.sh"
# shellcheck source=../lib/branch-cleanup.sh
source "$REPO_ROOT/devenv/lib/branch-cleanup.sh"
# shellcheck source=lib-evidence.sh
source "$TEST_DIR/lib-evidence.sh"
# shellcheck source=../lib/output.sh
source "$REPO_ROOT/devenv/lib/output.sh"

STAGE="${1:-status}"; shift || true
EVIDENCE_DIR=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --evidence-dir) [[ $# -ge 2 ]] || { echo "--evidence-dir 需要路径" >&2; exit 2; }; EVIDENCE_DIR="$2"; shift 2 ;;
    *) echo "未知参数：$1（用法见文件头）" >&2; exit 2 ;;
  esac
done

gha_load_config "$REPO_ROOT" || { echo "[bc] 认证配置加载失败（App 入口不可用）" >&2; exit 1; }
cd "$REPO_ROOT"
[[ -n "$EVIDENCE_DIR" ]] || EVIDENCE_DIR="$REPO_ROOT/.artifacts/74-branch-cleanup"
mkdir -p "$EVIDENCE_DIR"
EV_DIR="$EVIDENCE_DIR"
[[ -f "$EV_DIR/evidence.log" ]] || : > "$EV_DIR/evidence.log"
ev_log "阶段=$STAGE 证据目录=$EV_DIR"
STATE="$EVIDENCE_DIR/state.json"

TEST_BRANCH="test/bc-74-acceptance"
PROBE_BRANCH="test/bc74-probe"

FAILURES=0; PASS_COUNT=0
pass() { printf 'PASS: %s\n' "$1"; ev_log_file "PASS: $1"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { printf 'FAIL: %s —— %s\n' "$1" "$2"; ev_log_file "FAIL: $1 —— $2"; FAILURES=$((FAILURES + 1)); }
info() { printf '[bc] %s\n' "$1"; ev_log_file "$1"; }
human_next() { printf '\n[下一步·指挥者] %s\n' "$1" | tee -a "$EV_DIR/human-steps.log" >&2; }
label_of() { printf '%s' "$1" | tr '/' '-'; }

state_load() { [[ -f "$STATE" ]] && cat "$STATE" || echo '{}'; }
state_set() { # state_set [jq 旗标...] <jq 赋值表达式>（对 state.json 原地更新；缺失时从 {} 起步）
  local tmp="$STATE.tmp"
  if ! state_load | jq "$@" > "$tmp" 2>/dev/null; then echo "state.json 更新失败：$*" >&2; rm -f "$tmp"; exit 1; fi
  mv "$tmp" "$STATE"
}

remote_ref_sha() { "$DEVENV" gh api "repos/$GHA_REPO/git/ref/heads/$1" --jq '.object.sha' 2>/dev/null; }

# archive_tag_commit <tag> → stdout 标签最终指向的提交哈希（ annotated 标签 peel 到 commit）
archive_tag_commit() {
  local tag="$1" obj sha typ
  obj=$("$DEVENV" gh api "repos/$GHA_REPO/git/ref/tags/$tag" --jq '.object.sha' 2>/dev/null) || return 1
  typ=$("$DEVENV" gh api "repos/$GHA_REPO/git/ref/tags/$tag" --jq '.object.type' 2>/dev/null) || return 1
  sha="$obj"
  # annotated tag（type=tag）需 peel 一层到 commit
  if [[ "$typ" == "tag" ]]; then
    sha=$("$DEVENV" gh api "repos/$GHA_REPO/git/tags/$obj" --jq '.object.sha' 2>/dev/null) || return 1
  fi
  printf '%s' "$sha"
}

# 应拒断言（与 #73 同口径）：rc≠0 + 非认证入口失败（20–23）+ stderr 含拒绝特征
expect_reject() {
  local desc="$1" rc="$2" errf="$3" reason=""
  if [[ $rc == 0 ]]; then fail "$desc" "操作竟成功（rc=0）——规则未拦截"; return 1; fi
  if [[ $rc -ge 20 && $rc -le 23 ]]; then fail "$desc" "拒绝源于认证入口（rc=$rc）——非规则拒绝"; return 1; fi
  if ! grep -qiE 'rejected|protected|ruleset|rule violation|GH0[0-9]{2}|HTTP 40[35]|HTTP 422' "$errf" 2>/dev/null; then
    fail "$desc" "rc=$rc 但拒绝特征不明确（须 ruleset/protected 类特征，非 generic denied/auth）——见 $(basename "$errf")，不判通过"; return 1
  fi
  reason=$(grep -ioE '(remote rejected[^)]*\)|protected[^\"]*|HTTP [0-9]+[^)]*\)|GH0[0-9]{2}[^\"]*)' "$errf" 2>/dev/null | head -1 || true)
  pass "$desc：被拒（rc=$rc；${reason:-特征见 $(basename "$errf")}）"
}

# ---------------------------------------------------------------------------
# status：只读总览
# ---------------------------------------------------------------------------
stage_status() {
  local rc=0
  ev_run repo-settings "$DEVENV" gh api "repos/$GHA_REPO" --jq '{delete_branch_on_merge, default_branch}' || rc=$?
  [[ $rc == 0 ]] && info "仓库设置：$(cat "$EV_DIR/repo-settings.out")" || fail "仓库设置读取" "rc=$rc"
  rc=0
  ev_run rs-list "$DEVENV" gh api "repos/$GHA_REPO/rulesets" || rc=$?
  if [[ $rc == 0 ]]; then
    jq -r '.[] | "\(.id)\t\(.name)\t\(.target)\t\(.enforcement)"' "$EV_DIR/rs-list.out" \
      | while IFS=$'\t' read -r id name target enf; do info "规则集 id=$id name=$name target=$target enforcement=$enf"; done
  else fail "规则集列表读取" "rc=$rc"; fi
  # archive 标签 + 提交哈希（以哈希为最终定位依据）
  rc=0
  ev_run tag-list "$DEVENV" gh api "repos/$GHA_REPO/git/matching-refs/tags/archive/" || rc=$?
  if [[ $rc == 0 ]]; then
    local tag sha
    while IFS= read -r tag; do
      [[ -n "$tag" ]] || continue
      sha=$(archive_tag_commit "$tag") && info "archive 标签 $tag → 提交哈希 $sha" || info "archive 标签 $tag（哈希读取失败）"
    done < <(jq -r '.[].ref | sub("^refs/tags/"; "")' "$EV_DIR/tag-list.out")
  else info "无 archive/* 标签（或读取失败 rc=$rc）"; fi
  info "提示：配置核对用 verify-config；archive 反例用 negatives；清理正例用 cleanup-positive"
  [[ "$FAILURES" == 0 ]]
}

# ---------------------------------------------------------------------------
# prepare：测试分支 + 探针分支（本地 worktree）+ 探针 PR
# ---------------------------------------------------------------------------
stage_prepare() {
  local base local_dev
  base=$(remote_ref_sha dev) || { fail "prepare" "无法读取远端 dev HEAD"; exit 1; }
  local_dev=$(git -C "$REPO_ROOT" rev-parse dev)
  [[ "$local_dev" == "$base" ]] || { fail "prepare" "本地 dev($local_dev) ≠ 远端 dev($base)——先同步再跑"; exit 1; }

  # 测试分支（靶分支，从 dev 切出；本地 ref + App 推送）
  git -C "$REPO_ROOT" branch -f "$TEST_BRANCH" dev
  local rc=0
  ev_run push-test "$DEVENV" git-push origin "+$TEST_BRANCH:refs/heads/$TEST_BRANCH" || rc=$?
  [[ $rc == 0 ]] || { fail "prepare" "测试分支推送失败 rc=$rc：$(tail -2 "$EV_DIR/push-test.err")"; exit 1; }
  pass "测试分支 $TEST_BRANCH 已创建（基于 dev @ ${base:0:8}）"

  # 探针分支：本地 linked worktree（不切换当前工作树）+ 真实内容提交
  # 注：以下 worktree remove --force / branch -D / branch -f 是 harness 自身的
  # 测试装置复位（幂等重跑），作用于专用测试分支，**非** branch-cleanup 命令面——
  # 命令面的无强制路径/双重判断闸门见 lib/branch-cleanup.sh（AC2/AC3 约束的是命令面）。
  local wt; wt="$REPO_ROOT/.devenv-state/bc74-probe-wt"
  git -C "$REPO_ROOT" worktree remove --force "$wt" 2>/dev/null || true
  git -C "$REPO_ROOT" branch -D "$PROBE_BRANCH" 2>/dev/null || true
  git -C "$REPO_ROOT" worktree add -q -b "$PROBE_BRANCH" "$wt" "$TEST_BRANCH"
  printf '# #74 受控验收探针（可关闭）\n\n探针提交：验证合入后自动删除 + 本地清理。\n' > "$wt/BC74-PROBE.md"
  git -C "$wt" add BC74-PROBE.md
  git -C "$wt" commit -qm "test: #74 受控验收探针（真实内容变更，可关闭）"
  local psha; psha=$(git -C "$wt" rev-parse HEAD)
  rc=0
  ev_run push-probe "$DEVENV" git-push origin "+$PROBE_BRANCH:refs/heads/$PROBE_BRANCH" || rc=$?
  [[ $rc == 0 ]] || { fail "prepare" "探针分支推送失败 rc=$rc"; exit 1; }
  pass "探针分支 $PROBE_BRANCH 已推送（head=${psha:0:8}；本地 worktree=$wt）"

  # 探针 PR（靶=测试分支，不触碰 dev；App 创建）
  local url pr
  rc=0
  ev_run pr-create "$DEVENV" gh pr create --base "$TEST_BRANCH" --head "$PROBE_BRANCH" \
    --title "test: #74 受控验收探针（可关闭）" \
    --body "#74 分支清理与归档保护受控验收探针：真实内容变更。指挥者批准并以 squash 合入（靶为测试分支，不触碰 dev）——验证合入后远端分支自动删除 + 本地 branch-cleanup 正例。" \
    || rc=$?
  [[ $rc == 0 ]] || { fail "prepare" "探针 PR 创建失败：$(tail -2 "$EV_DIR/pr-create.err")"; exit 1; }
  url=$(tail -1 "$EV_DIR/pr-create.out"); pr="${url##*/}"
  pass "探针 PR #$pr 已创建（App bot 作者）"

  jq -n --arg tb "$TEST_BRANCH" --arg pb "$PROBE_BRANCH" --arg wt "$wt" \
       --argjson pr "$pr" --arg ps "$psha" --arg base "$base" \
       '{test_branch: $tb, probe_branch: $pb, probe_worktree: $wt, probe_pr: $pr,
         probe_sha: $ps, dev_baseline_sha: $base, prepared_at: (now | todateiso8601)}' > "$STATE"
  ev_log "state.json 已写入（探针 PR #$pr）"
  human_next "① 按 docs/agents/branch-cleanup.md 在 GitHub UI 开启「Automatically delete head branches」并创建 protect-archive-tags 规则集（target=tag，include=archive/*，rules=Restrict updates+Restrict deletions，无绕过）；② 运行 ./devenv/devenv test:branch-cleanup verify-config 核对；③ 批准并以 squash 合入探针 PR #$pr（靶为测试分支）；④ 运行 ./devenv/devenv test:branch-cleanup cleanup-positive"
  [[ "$FAILURES" == 0 ]]
}

# ---------------------------------------------------------------------------
# verify-config：dev 两层 + archive 标签规则集 + 自动删除设置核对
# ---------------------------------------------------------------------------
stage_verify_config() {
  BP_FINDINGS=(); BP_NOTES=()
  # App token 经环境变量传给漂移核对（delete_branch_on_merge 需 push 权限可见）；
  # 换取失败即 fail（不静默回退匿名——匿名读不到自动删除设置）。
  local tok rc=0 rc2=0
  tok=$(gha_mint_token) || { fail "verify-config" "App token 换取失败"; exit 1; }
  BP_GITHUB_TOKEN="$tok" bp_check_drift ${BP_DURABLE_RULESETS[@]+"${BP_DURABLE_RULESETS[@]}"} || rc=$?
  BP_GITHUB_TOKEN="$tok" bp_check_repo_settings || rc2=$?
  unset BP_GITHUB_TOKEN tok
  local f
  for f in ${BP_FINDINGS[@]+"${BP_FINDINGS[@]}"}; do warn "$f"; ev_log_file "FINDING: $f"; done
  for f in ${BP_NOTES[@]+"${BP_NOTES[@]}"}; do info "NOTE: $f"; done
  rc=$(bp_merge_rc "$rc" "$rc2")
  if [[ $rc == 0 ]]; then
    pass "verify-config：dev 两层 + archive 标签规则集 + 自动删除设置与保存配置一致（App 身份）"
  else
    fail "verify-config" "rc=$rc（漂移或无法核查）——指挥者须先应用配置（见 human-steps）"
    human_next "按 docs/agents/branch-cleanup.md 应用：开启自动删除 + 创建 protect-archive-tags 规则集；应用后重跑 verify-config"
  fi
  # App 对 archive 规则集无绕过权断言（读取失败不静默跳过——显式 fail）
  local aid cub rcf=0
  ev_run rs-list "$DEVENV" gh api "repos/$GHA_REPO/rulesets" || rcf=$?
  if [[ $rcf != 0 ]]; then
    fail "verify-config 绕过权断言" "规则集列表读取失败 rc=$rcf——无法断言 current_user_can_bypass"
  else
    aid=$(jq -r '.[] | select(.name == "protect-archive-tags") | .id' "$EV_DIR/rs-list.out" 2>/dev/null || true)
    if [[ -z "$aid" ]]; then
      fail "verify-config 绕过权断言" "protect-archive-tags 未见于规则集列表——无法断言（须先应用配置）"
    else
      rc=0; ev_run archive-rs "$DEVENV" gh api "repos/$GHA_REPO/rulesets/$aid" || rc=$?
      if [[ $rc != 0 ]]; then
        fail "verify-config 绕过权断言" "archive 规则集详情读取失败 rc=$rc——无法断言"
      else
        cub=$(jq -r '.current_user_can_bypass // ""' "$EV_DIR/archive-rs.out")
        [[ "$cub" == "never" ]] && pass "App 对 archive 规则集 current_user_can_bypass=never（无绕过权）" \
          || fail "archive 绕过权" "current_user_can_bypass=$cub（App 不应有绕过权）"
      fi
    fi
  fi
  [[ "$FAILURES" == 0 ]]
}

# ---------------------------------------------------------------------------
# negatives：archive 标签更新/删除尝试应拒（前置：保护已 active 且内容匹配保存配置）
# ---------------------------------------------------------------------------
stage_negatives() {
  # 选一个真实 archive 标签做靶（不创建新永久标签）
  local rc=0 tag
  ev_run tag-list "$DEVENV" gh api "repos/$GHA_REPO/git/matching-refs/tags/archive/" || rc=$?
  [[ $rc == 0 ]] || { fail "negatives" "archive 标签列表读取失败 rc=$rc"; exit 1; }
  tag=$(jq -r '.[0].ref | sub("^refs/tags/"; "")' "$EV_DIR/tag-list.out" 2>/dev/null || true)
  if [[ -z "$tag" || "$tag" == "null" ]]; then
    fail "negatives" "无 archive/* 标签可作靶——先创建一个归档标签"
    exit 1
  fi

  # 安全前置（全字段，防 UI 误配后误改真实归档）：protect-archive-tags 必须
  # 存在、active、内容与保存配置逐字段一致（target=tag / update+deletion / 无绕过）、
  # 条件实际覆盖 refs/tags/$tag、且 App current_user_can_bypass=never——任一不符
  # fail closed 不尝试（避免双前缀坑/漏勾规则时覆写或永久删除真实归档标签）。
  local aid enf cub live_json
  rc=0; ev_run rs-list "$DEVENV" gh api "repos/$GHA_REPO/rulesets" || rc=$?
  [[ $rc == 0 ]] || { fail "negatives" "规则集列表读取失败 rc=$rc——fail closed 不尝试"; exit 1; }
  aid=$(jq -r '.[] | select(.name == "protect-archive-tags") | .id' "$EV_DIR/rs-list.out" 2>/dev/null || true)
  if [[ -z "$aid" ]]; then
    fail "negatives" "protect-archive-tags 规则集不存在——不尝试（无保护时尝试会误改真实归档标签）"
    human_next "先创建 protect-archive-tags 规则集（verify-config 通过）再跑 negatives"
    exit 1
  fi
  rc=0; ev_run archive-rs "$DEVENV" gh api "repos/$GHA_REPO/rulesets/$aid" || rc=$?
  [[ $rc == 0 ]] || { fail "negatives" "archive 规则集详情读取失败 rc=$rc——fail closed 不尝试"; exit 1; }
  live_json=$(cat "$EV_DIR/archive-rs.out")
  enf=$(jq -r '.enforcement // ""' <<< "$live_json"); cub=$(jq -r '.current_user_can_bypass // ""' <<< "$live_json")
  local prefail="" cf
  BP_FINDINGS=(); BP_NOTES=()
  bp_compare_ruleset "protect-archive-tags" "$BP_RULESETS_DIR/protect-archive-tags.json" "$live_json" || prefail="内容与保存配置不一致"
  for cf in ${BP_FINDINGS[@]+"${BP_FINDINGS[@]}"}; do ev_log_file "前置 FINDING: $cf"; done
  [[ "$enf" == "active" ]] || prefail="${prefail:+$prefail;}enforcement=$enf（非 active）"
  [[ "$cub" == "never" ]] || prefail="${prefail:+$prefail;}current_user_can_bypass=$cub（App 应 never）"
  if [[ -z "$prefail" ]]; then
    bp_ruleset_covers_ref "$live_json" "refs/tags/$tag" "$tag" || prefail="条件不覆盖 refs/tags/$tag"
  fi
  if [[ -n "$prefail" ]]; then
    fail "negatives 安全前置" "$prefail——fail closed 不尝试（防误改真实归档标签）"
    human_next "按 docs/agents/branch-cleanup.md 逐字段对齐 protect-archive-tags（target=tag / include=archive/* / update+deletion / 无绕过 / active）后重跑 negatives"
    exit 1
  fi
  pass "negatives 前置：archive 规则集 active + 内容与保存配置一致 + 覆盖 refs/tags/$tag + App 无绕过权（尝试被拒即零写入）"

  local before; before=$(archive_tag_commit "$tag") || { fail "negatives" "无法读取标签 $tag 哈希"; exit 1; }
  info "靶 archive 标签 $tag → 提交哈希 $before（反例前后核对不动）"
  state_set --arg t "$tag" --arg h "$before" '.archive_probe = {tag: $t, commit: $h}'

  # 推送一致性：所推提交须与远端 dev 一致（确保确实是移动标签到新位置），
  # 且不得等于 $before（否则 no-op rc=0 误当成功/或无关拒绝）。
  local devsha localdev
  devsha=$(remote_ref_sha dev) || { fail "negatives" "无法读取远端 dev HEAD"; exit 1; }
  localdev=$(git -C "$REPO_ROOT" rev-parse refs/heads/dev 2>/dev/null) || { fail "negatives" "本地无 refs/heads/dev"; exit 1; }
  if [[ "$localdev" != "$devsha" ]]; then
    fail "negatives" "本地 dev($localdev) ≠ 远端 dev($devsha)——先同步再跑（推送须确实移动标签）"
    exit 1
  fi
  [[ "$devsha" != "$before" ]] || { fail "negatives" "dev HEAD 恰等于靶标签提交——无法构造有效移动探针"; exit 1; }

  # 反例 1：更新（强制移动标签到 dev HEAD）应拒
  rc=0
  ev_run tag-update "$DEVENV" git-push origin "+refs/heads/dev:refs/tags/$tag" || rc=$?
  expect_reject "项 11 archive 标签更新（移动 $tag → dev ${devsha:0:8}）" "$rc" "$EV_DIR/tag-update.err" || true

  # 反例 2：删除标签应拒
  rc=0
  ev_run tag-delete "$DEVENV" git-push origin ":refs/tags/$tag" || rc=$?
  expect_reject "项 11 archive 标签删除（$tag）" "$rc" "$EV_DIR/tag-delete.err" || true

  # 零写入核对：标签仍在且哈希不动
  local after; after=$(archive_tag_commit "$tag") || after=""
  [[ "$after" == "$before" ]] && pass "archive 标签 $tag 反例后哈希不动（$before）——零写入" \
    || fail "archive 零写入" "标签哈希 before=$before after=$after（被改动！）"
  [[ "$FAILURES" == 0 ]]
}

# ---------------------------------------------------------------------------
# cleanup-positive：探针 PR 合入后自动删除 + 本地清理正例
# ---------------------------------------------------------------------------
stage_cleanup_positive() {
  local st pr pb wt
  st=$(state_load)
  pr=$(jq -r '.probe_pr // empty' <<< "$st"); pb=$(jq -r '.probe_branch // empty' <<< "$st"); wt=$(jq -r '.probe_worktree // empty' <<< "$st")
  [[ -n "$pr" ]] || { fail "cleanup-positive" "state.json 无探针 PR——先跑 prepare"; exit 1; }

  # PR 必须已合入（指挥者步骤）
  local rc=0 merged mc head
  ev_run pr-meta "$DEVENV" gh api "repos/$GHA_REPO/pulls/$pr" --jq '{merged, merge_commit_sha, head: .head.sha}' || rc=$?
  [[ $rc == 0 ]] || { fail "cleanup-positive" "PR #$pr 读取失败"; exit 1; }
  merged=$(jq -r '.merged' "$EV_DIR/pr-meta.out"); mc=$(jq -r '.merge_commit_sha // empty' "$EV_DIR/pr-meta.out"); head=$(jq -r '.head' "$EV_DIR/pr-meta.out")
  if [[ "$merged" != "true" ]]; then
    fail "cleanup-positive" "PR #$pr 尚未合入（merged=$merged）——指挥者须先批准并 squash 合入"
    human_next "批准并以 squash 合入探针 PR #$pr，再跑 cleanup-positive"
    exit 1
  fi
  pass "探针 PR #$pr 已 squash 合入（merge_commit=$mc head=$head）——以哈希定位"
  state_set --arg mc "$mc" --arg h "$head" '.probe_merged = {merge_commit: $mc, head: $h}'

  # AC1 远端：合入后头分支自动删除（delete_branch_on_merge 生效）——必须确证 HTTP 404：
  # 任意 rc!=0（网络超时/HTTP 403/500）不作 404 证据，判 fail。
  rc=0
  ev_run probe-ref "$DEVENV" gh api "repos/$GHA_REPO/git/ref/heads/$pb" || rc=$?
  if [[ $rc == 0 ]]; then
    fail "AC1 远端自动删除" "探针分支 $pb 远端仍存在（rc=0）——确认 delete_branch_on_merge 已开启（verify-config）"
  elif grep -q 'HTTP 404' "$EV_DIR/probe-ref.err" 2>/dev/null; then
    pass "AC1 远端：探针分支 $pb 合入后已自动删除（git/ref/heads 读取 HTTP 404 确证）"
  else
    fail "AC1 远端自动删除" "读取 rc=$rc 但非 HTTP 404 确证（err 尾部：$(tail -1 "$EV_DIR/probe-ref.err" 2>/dev/null)）——无法判定自动删除已生效，不判通过"
  fi

  # AC1 本地：branch-cleanup 双重判断（真实 PR 状态）→ dry-run 安全 → --apply 清理
  rc=0
  ev_run cleanup-dry "$DEVENV" branch-cleanup "$pb" || rc=$?
  [[ $rc == 0 ]] && pass "AC1 本地：branch-cleanup $pb dry-run 判定可清理（真实 PR 已合入 + 本地无未保存内容）" \
    || fail "AC1 本地 dry-run" "rc=$rc：$(tail -3 "$EV_DIR/cleanup-dry.err")"
  rc=0
  ev_run cleanup-apply "$DEVENV" branch-cleanup "$pb" --apply || rc=$?
  if [[ $rc == 0 ]] && ! git -C "$REPO_ROOT" show-ref --verify --quiet "refs/heads/$pb" && [[ -z "$wt" || ! -d "$wt" ]]; then
    pass "AC1 本地：branch-cleanup $pb --apply 已删除本地分支（worktree=$wt 一并移除，实测不存在）"
  else
    fail "AC1 本地 --apply" "rc=$rc 或分支/worktree 残留（wt=$wt）：$(tail -3 "$EV_DIR/cleanup-apply.err")"
  fi
  [[ "$FAILURES" == 0 ]]
}

# ---------------------------------------------------------------------------
# cleanup-test：关探针 PR、删测试分支
# ---------------------------------------------------------------------------
stage_cleanup_test() {
  local st pr tb rc
  st=$(state_load)
  pr=$(jq -r '.probe_pr // empty' <<< "$st"); tb=$(jq -r '.test_branch // empty' <<< "$st")
  if [[ -n "$pr" ]]; then
    rc=0; ev_run "close-$pr" "$DEVENV" gh pr close "$pr" || rc=$?
    [[ $rc == 0 ]] && pass "探针 PR #$pr 已关闭" || info "探针 PR #$pr 关闭失败（可能已合并/不存在）"
  fi
  # 删测试分支（远端 + 本地）；探针分支已在 cleanup-positive 清理
  if [[ -n "$tb" ]]; then
    rc=0; ev_run del-test "$DEVENV" git-push origin ":refs/heads/$tb" || rc=$?
    [[ $rc == 0 ]] && pass "测试分支 $tb 远端已删除" || info "测试分支 $tb 远端删除失败 rc=$rc（可能已不存在）"
    git -C "$REPO_ROOT" branch -D "$tb" 2>/dev/null && pass "测试分支 $tb 本地已删除" || info "测试分支 $tb 本地不存在"
  fi
  state_set '.cleaned = true'
  [[ "$FAILURES" == 0 ]]
}

# ---------------------------------------------------------------------------
# summary：AC1–5 映射 + 提交哈希
# ---------------------------------------------------------------------------
stage_summary() {
  local log="$EV_DIR/evidence.log" sum="$EVIDENCE_DIR/summary.txt" st
  st=$(state_load)
  local accept_lines="" l
  while IFS= read -r l; do
    case "$l" in *"PASS: "*"AC1"*|*"FAIL: "*"AC1"*|*"PASS: 项 11"*|*"FAIL: 项 11"*|*"PASS: verify-config"*|*"FAIL: verify-config"*|*"PASS: negatives"*|*"FAIL: negatives"*) accept_lines+="$l"$'\n';; esac
  done < "$log"
  {
    echo "分支清理与原型归档保护受控验收（#74；spec #23 验收清单项 11）"
    echo "证据目录：$EVIDENCE_DIR"
    echo "时间：$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "---- 提交哈希（以哈希为最终定位依据）----"
    echo "探针 PR 合入：$(jq -c '.probe_merged // {}' <<< "$st")"
    echo "archive 标签靶：$(jq -c '.archive_probe // {}' <<< "$st")"
    echo "dev 基线：$(jq -r '.dev_baseline_sha // "未记录"' <<< "$st")"
    echo "---- 机器断言（本 harness）----"
    if [[ -n "$accept_lines" ]]; then printf '%s' "$accept_lines"; else echo "（无——先跑 verify-config / negatives / cleanup-positive）"; fi
    echo "---- 人工面（指挥者 UI 操作记录）----"
    if [[ -f "$EV_DIR/human-actions.md" ]]; then cat "$EV_DIR/human-actions.md"; else echo "（未见 human-actions.md——开启自动删除/创建规则集/合入探针 PR 人工步骤尚未记录）"; fi
    echo "---- AC 映射 ----"
    echo "AC1 远端合入后自动删除 + 本地双重判断：cleanup-positive（远端 ref 404 + branch-cleanup 正例）；配置面 verify-config（delete_branch_on_merge=true）"
    echo "AC2 未提交/未推送/合入后新增分别拒绝 + 无强制路径：branch-cleanup-offline.test.sh（BC3/BC4/BC5/BC1b，一平台代码逻辑）"
    echo "AC3 prototype 豁免 + 非通用 worktree 管理器：branch-cleanup-offline.test.sh（BC2a）；命令面仅 branch-cleanup <branch> [--apply]"
    echo "AC4 archive 标签禁更新/删除 + 哈希定位：negatives（更新/删除被拒，哈希不动）+ 本 summary 提交哈希"
    echo "AC5 agent 实现+自动反例（离线测试）；人类账号/管理员配置受控验收由指挥者（verify-config/cleanup-positive 人工步骤）；不承诺旧环境永远可重建"
    echo "诚实口径：归档保证源码经 archive 标签/提交哈希可追溯，不承诺旧镜像/外部依赖永远可下载或未来可重跑"
  } | tee "$sum"
  ev_log "summary 已写入 $sum"
  [[ "$FAILURES" == 0 ]]
}

case "$STAGE" in
  status)           stage_status ;;
  prepare)          stage_prepare ;;
  verify-config)    stage_verify_config ;;
  negatives)        stage_negatives ;;
  cleanup-positive) stage_cleanup_positive ;;
  cleanup-test)     stage_cleanup_test ;;
  summary)          stage_summary ;;
  *) echo "未知阶段：$STAGE（可用：status prepare verify-config negatives cleanup-positive cleanup-test summary）" >&2; exit 2 ;;
esac
ev_log "阶段 $STAGE 完成：$PASS_COUNT 通过，$FAILURES 失败"
printf '阶段 %s 完成：%s 通过，%s 失败\n' "$STAGE" "$PASS_COUNT" "$FAILURES"
[[ "$FAILURES" == 0 ]]