#!/usr/bin/env bash
# ============================================================================
# 分支保护两层规则集受控验收 harness（#73；Spec-工程基座 §7 / 验收清单项 10 a–i）
#
# 形态：分阶段执行（阶段间与指挥者的 GitHub Web UI 操作交错）。每个阶段把
# 命令、退出码、GitHub 响应捕获进证据目录（默认 .artifacts/73-branch-protection/，
# gitignored），并对「应拒」/「应成」做 PASS/FAIL 断言。本 harness 只做 App 身份
# 能做的部分（经 ./devenv/devenv 唯一入口）；规则集配置、批准、bypass 合入、
# 直推尝试、rule-suites 管理员读取是指挥者本人步骤，见 docs/agents/branch-protection.md。
#
# 阶段（devenv test:branch-protection <阶段>）：
#   status            只读总览（实时规则集 / 覆盖面 / 探针 PR 状态）
#   prepare           建 test/bp-73-acceptance + 绿/红探针分支与 PR（红探针=workflow
#                     静态门禁故意违规，CI 必红）
#   verify-config     4 个保存规则集（dev 两层 + 测试分支 transient 对）↔ 实时逐字段核对；
#                     并断言 App 的 current_user_can_bypass=never（App 不在绕过名单）
#   negatives         App 侧反例（测试分支靶）：直推拒 / 红探针无批准合入拒 /
#                     绿探针 bypass_rules=true 合入拒（先等两 PR 检查完成）
#   negatives-dev --pr N   App 侧 dev 反例：直推 dev 拒 / PR N 未批准时合入拒 +
#                     bypass_rules=true 拒；前后断言 dev HEAD 不动（无效验证不写入 dev）
#   g --pr N          项 g：向 PR N（指挥者已批准）推新提交 → 断言旧批准已 DISMISSED →
#                     App 合入尝试应拒（须重新批准）
#   probe-audit --pr N    项 i/d' 机器面：PR 合并状态/合并者/评论/时间线/活动事件 +
#                     rule-suites 管理员端点对 App 的可见性（如实记录）；输出指挥者
#                     管理员侧核对的指令
#   cleanup-test      关闭探针 PR、删探针/测试分支（前置：指挥者已删两个 transient 规则集）
#   summary           汇总 a–i 验收映射到证据文件，写 summary.txt
#
# 默认（无参数）= status（只读安全）。
# 所有 GitHub 操作经 ./devenv/devenv（App 身份）；本进程不接触 token
# （token 由认证入口在子进程内换取，见 docs/agents/github-app-auth.md）。
# ============================================================================
set -Eeuo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TEST_DIR/../.." && pwd)"
DEVENV="$REPO_ROOT/devenv/devenv"
# shellcheck source=../lib/github-app-auth.sh
source "$REPO_ROOT/devenv/lib/github-app-auth.sh"
# shellcheck source=../lib/branch-protection.sh
source "$REPO_ROOT/devenv/lib/branch-protection.sh"
# shellcheck source=lib-evidence.sh
source "$TEST_DIR/lib-evidence.sh"

STAGE="${1:-status}"; shift || true
PR_ARG=""
EVIDENCE_DIR=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --pr) [[ $# -ge 2 ]] || { echo "--pr 需要 PR 编号" >&2; exit 2; }; PR_ARG="$2"; shift 2 ;;
    --evidence-dir) [[ $# -ge 2 ]] || { echo "--evidence-dir 需要路径" >&2; exit 2; }; EVIDENCE_DIR="$2"; shift 2 ;;
    *) echo "未知参数：$1（用法见文件头）" >&2; exit 2 ;;
  esac
done

gha_load_config "$REPO_ROOT" || { echo "[bp] 认证配置加载失败（App 入口不可用）" >&2; exit 1; }
cd "$REPO_ROOT"   # gh 的仓库探测依赖 cwd 处于仓库内（本 harness 可从任意目录被调用）
[[ -n "$EVIDENCE_DIR" ]] || EVIDENCE_DIR="$REPO_ROOT/.artifacts/73-branch-protection"
mkdir -p "$EVIDENCE_DIR"
EV_DIR="$EVIDENCE_DIR"   # ev_* 助手直接使用；多阶段共用一目录，evidence.log 追加
[[ -f "$EV_DIR/evidence.log" ]] || : > "$EV_DIR/evidence.log"
ev_log "阶段=$STAGE pr=${PR_ARG:-无} 证据目录=$EV_DIR"
STATE="$EVIDENCE_DIR/state.json"

TEST_BRANCH="test/bp-73-acceptance"
GREEN_BRANCH="test/bp73-probe-green"
RED_BRANCH="test/bp73-probe-red"
ALL_SAVED=(protect-dev-base protect-dev-approval protect-bp73-test-base protect-bp73-test-approval)

FAILURES=0; PASS_COUNT=0
pass() { printf 'PASS: %s\n' "$1"; ev_log_file "PASS: $1"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { printf 'FAIL: %s —— %s\n' "$1" "$2"; ev_log_file "FAIL: $1 —— $2"; FAILURES=$((FAILURES + 1)); }
info() { printf '[bp] %s\n' "$1"; ev_log_file "$1"; }
human_next() { printf '\n[下一步·指挥者] %s\n' "$1" | tee -a "$EV_DIR/human-steps.log" >&2; }

state_load()  { [[ -f "$STATE" ]] && cat "$STATE" || echo '{}'; }
state_set() { # state_set <jq-path-assignment 表达式>（对 state.json 原地更新）
  local expr="$1"
  jq "$expr" "$STATE" > "$STATE.tmp" 2>/dev/null && mv "$STATE.tmp" "$STATE" \
    || { echo "state.json 更新失败：$expr" >&2; exit 1; }
}

remote_ref_sha() { # remote_ref_sha <branch> → sha（失败输出空）
  local b="$1" rc=0
  "$DEVENV" gh api "repos/$GHA_REPO/git/ref/heads/$b" --jq '.object.sha' 2>/dev/null || rc=$?
  [[ $rc == 0 ]]
}

# ---------------------------------------------------------------------------
# status：只读总览
# ---------------------------------------------------------------------------
stage_status() {
  info "实时规则集（App 身份读取）"
  local rc=0
  ev_run rs-list "$DEVENV" gh api "repos/$GHA_REPO/rulesets" || rc=$?
  if [[ $rc == 0 ]]; then
    jq -r '.[] | "\(.id)\t\(.name)\t\(.target)\t\(.enforcement)"' "$EV_DIR/rs-list.out" \
      | while IFS=$'\t' read -r id name target enf; do
          info "规则集 id=$id name=$name target=$target enforcement=$enf"
        done
  else
    fail "规则集列表读取" "rc=$rc"
  fi
  for b in dev "$TEST_BRANCH"; do
    rc=0
    local lbl; lbl="rules-$(printf '%s' "$b" | tr '/' '-')"
    ev_run "$lbl" "$DEVENV" gh api "repos/$GHA_REPO/rules/branches/$b" || rc=$?
    if [[ $rc == 0 ]]; then
      info "分支 $b 实际生效规则（rules/branches 联合视图）：$(jq -r '[.[].type] | unique | join("+")' "$EV_DIR/$lbl.out")"
    else
      info "分支 $b 无生效规则（或读取失败 rc=$rc）"
    fi
  done
  local st; st=$(state_load)
  local g r
  g=$(jq -r '.probe_green.pr // empty' <<< "$st"); r=$(jq -r '.probe_red.pr // empty' <<< "$st")
  for pr in $g $r; do
    [[ -n "$pr" ]] || continue
    rc=0
    ev_run "pr-$pr" "$DEVENV" gh api "repos/$GHA_REPO/pulls/$pr" \
      --jq '{number, state, merged, merged_by: .merged_by.login, head: .head.sha[0:8]}' || rc=$?
    [[ $rc == 0 ]] && info "探针 PR #$pr：$(cat "$EV_DIR/pr-$pr.out")" || info "探针 PR #$pr 读取失败"
  done
  info "提示：配置核对用 verify-config；反例执行用 negatives / negatives-dev --pr N"
  [[ "$FAILURES" == 0 ]]
}

# ---------------------------------------------------------------------------
# prepare：测试分支 + 探针分支 + 探针 PR
# ---------------------------------------------------------------------------
stage_prepare() {
  local base
  base=$(remote_ref_sha dev) || { fail "prepare" "无法读取远端 dev HEAD"; exit 1; }
  # 本地 dev 必须与远端一致（探针从 dev 切出）
  local local_dev; local_dev=$(git -C "$REPO_ROOT" rev-parse dev)
  [[ "$local_dev" == "$base" ]] \
    || { fail "prepare" "本地 dev($local_dev) ≠ 远端 dev($base)——先同步再跑"; exit 1; }

  local tmp; tmp=$(mktemp -d /tmp/devenv-bp73.XXXXXX)
  git clone -q --no-local --branch dev --single-branch "$REPO_ROOT" "$tmp/repo"
  git -C "$tmp/repo" remote set-url origin "https://github.com/$GHA_REPO.git"

  # 测试分支（靶分支，从 dev 切出）
  git -C "$tmp/repo" checkout -q -b "$TEST_BRANCH"
  local rc=0
  ev_run push-test-branch "$tmp/repo/devenv/devenv" git-push origin \
    "+$TEST_BRANCH:refs/heads/$TEST_BRANCH" || rc=$?
  [[ $rc == 0 ]] || { fail "prepare" "测试分支推送失败 rc=$rc：$(tail -2 "$EV_DIR/push-test-branch.err")"; rm -rf "$tmp"; exit 1; }
  pass "测试分支 $TEST_BRANCH 已创建（基于 dev @ ${base:0:8}）"

  # 绿探针：空提交（CI 走正常质量门 → 绿）
  git -C "$tmp/repo" checkout -q -b "$GREEN_BRANCH" "$TEST_BRANCH"
  git -C "$tmp/repo" commit -q --allow-empty -m "test: #73 受控验收绿探针（可关闭；空提交，CI 走正常质量门）"
  local gsha; gsha=$(git -C "$tmp/repo" rev-parse HEAD)
  rc=0
  ev_run push-green "$tmp/repo/devenv/devenv" git-push origin \
    "+$GREEN_BRANCH:refs/heads/$GREEN_BRANCH" || rc=$?
  [[ $rc == 0 ]] || { fail "prepare" "绿探针分支推送失败 rc=$rc"; rm -rf "$tmp"; exit 1; }

  # 红探针：workflow 静态门禁故意违规（doctor 即拒，CI 必红且快）
  git -C "$tmp/repo" checkout -q -b "$RED_BRANCH" "$TEST_BRANCH"
  mkdir -p "$tmp/repo/.github/workflows"
  cat > "$tmp/repo/.github/workflows/bp73-red-probe.yml" <<'YML'
# #73 受控验收红探针：故意直接调用 compose（#71 静态门禁即拒，CI 必红）。
# 仅 workflow_dispatch 触发且从不派发；本文件只为让 quality-gate 检查变红。
name: bp73-red-probe
on: workflow_dispatch
jobs:
  probe:
    runs-on: ubuntu-24.04
    steps:
      - run: docker compose ps
YML
  git -C "$tmp/repo" add .github/workflows/bp73-red-probe.yml
  git -C "$tmp/repo" commit -q -m "test: #73 受控验收红探针（workflow 静态门禁故意违规，CI 必红；可关闭）"
  local rsha; rsha=$(git -C "$tmp/repo" rev-parse HEAD)
  rc=0
  ev_run push-red "$tmp/repo/devenv/devenv" git-push origin \
    "+$RED_BRANCH:refs/heads/$RED_BRANCH" || rc=$?
  [[ $rc == 0 ]] || { fail "prepare" "红探针分支推送失败 rc=$rc"; rm -rf "$tmp"; exit 1; }
  pass "绿/红探针分支已推送（green=${gsha:0:8} red=${rsha:0:8}）"
  rm -rf "$tmp"

  # 探针 PR（指向测试分支；App 身份创建 → 项 h 作者面证据）
  local url pr
  rc=0
  ev_run pr-green "$DEVENV" gh pr create --base "$TEST_BRANCH" --head "$GREEN_BRANCH" \
    --title "test: #73 受控验收绿探针（可关闭）" \
    --body "#73 分支保护受控验收绿探针：空提交，CI 走正常质量门（预期绿）。合并仅用于验收 bypass 行为（靶分支为测试分支，不触碰 dev）。" \
    || rc=$?
  [[ $rc == 0 ]] || { fail "prepare" "绿探针 PR 创建失败：$(tail -2 "$EV_DIR/pr-green.err")"; exit 1; }
  url=$(tail -1 "$EV_DIR/pr-green.out"); pr="${url##*/}"
  ev_run pr-green-meta "$DEVENV" gh api "repos/$GHA_REPO/pulls/$pr" --jq '{number, author: .user.login, state}' || true
  pass "绿探针 PR #$pr 已创建（作者 $(jq -r .author "$EV_DIR/pr-green-meta.out")，App bot —— 项 h）"
  local gpr="$pr"

  rc=0
  ev_run pr-red "$DEVENV" gh pr create --base "$TEST_BRANCH" --head "$RED_BRANCH" \
    --title "test: #73 受控验收红探针（检查必红，可关闭）" \
    --body "#73 分支保护受控验收红探针：workflow 静态门禁故意违规 → doctor 拒 → quality-gate 检查红。用于验收「检查失败仍拒」。**永不合并**。" \
    || rc=$?
  [[ $rc == 0 ]] || { fail "prepare" "红探针 PR 创建失败：$(tail -2 "$EV_DIR/pr-red.err")"; exit 1; }
  url=$(tail -1 "$EV_DIR/pr-red.out"); pr="${url##*/}"
  pass "红探针 PR #$pr 已创建（预期 quality-gate 红）"

  jq -n --arg tb "$TEST_BRANCH" --arg base "$base" \
       --arg gb "$GREEN_BRANCH" --argjson gp "$gpr" --arg gs "$gsha" \
       --arg rb "$RED_BRANCH" --argjson rp "$pr" --arg rs "$rsha" \
       '{test_branch: $tb, dev_baseline_sha: $base,
         probe_green: {branch: $gb, pr: $gp, sha: $gs},
         probe_red:  {branch: $rb, pr: $rp, sha: $rs},
         prepared_at: (now | todateiso8601)}' > "$STATE"
  ev_log "state.json 已写入（green PR #$gpr / red PR #$pr）"
  human_next "在 GitHub Web UI 按保存配置创建 4 个规则集（字段映射见 docs/agents/branch-protection.md「首次应用」；JSON 即 devenv/rulesets/*.json）：先建 dev 两层（protect-dev-base、protect-dev-approval），再建测试分支 transient 对（protect-bp73-test-base、protect-bp73-test-approval），最后删除旧规则集 protect-dev。应用后运行：./devenv/devenv test:branch-protection verify-config"
  [[ "$FAILURES" == 0 ]]
}

# ---------------------------------------------------------------------------
# verify-config：4 保存规则集 ↔ 实时逐字段核对（App 身份读取）+ App 绕过面断言
# ---------------------------------------------------------------------------
stage_verify_config() {
  local list rc=0
  ev_run vc-list "$DEVENV" gh api "repos/$GHA_REPO/rulesets" || rc=$?
  [[ $rc == 0 ]] || { fail "verify-config" "规则集列表读取失败"; exit 1; }
  local ids
  ids=$(jq -r '[.[] | select(.target == "branch")] | .[] | "\(.id) \(.name)"' "$EV_DIR/vc-list.out")
  BP_FINDINGS=()
  local seen=" " line id name live_json found
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    id="${line%% *}"; name="${line#* }"
    rc=0
    ev_run "vc-$id" "$DEVENV" gh api "repos/$GHA_REPO/rulesets/$id" || rc=$?
    [[ $rc == 0 ]] || { BP_FINDINGS+=("规则集 $name（id=$id）读取失败"); continue; }
    live_json=$(cat "$EV_DIR/vc-$id.out")
    seen="$seen$name "
    found=""
    local n
    for n in ${ALL_SAVED[@]+"${ALL_SAVED[@]}"}; do
      [[ "$n" == "$name" ]] && found=1 && break
    done
    if [[ -n "$found" ]]; then
      local crc=0
      bp_compare_ruleset "规则集 $name" "$BP_RULESETS_DIR/$name.json" "$live_json" || crc=$?
      if [[ $crc == 0 ]]; then
        pass "verify-config：$name 与保存配置逐字段一致"
        # App 绕过面断言：App 不在任何规则集绕过名单（spec 安全基线）
        local cub
        cub=$(jq -r '.current_user_can_bypass // "不可见"' "$EV_DIR/vc-$id.out")
        if [[ "$cub" == "never" ]]; then
          pass "verify-config：$name 对 App 身份 current_user_can_bypass=never（App 不在绕过名单）"
        else
          fail "verify-config：$name" "App 的 current_user_can_bypass=$cub（预期 never——App 不得有绕过权）"
        fi
      else
        fail "verify-config：$name 与保存配置不一致" "$(printf '%s' "${BP_FINDINGS[@]+"${BP_FINDINGS[@]}"}")"
        BP_FINDINGS=()
      fi
    elif bp_ruleset_covers_ref "$live_json" "refs/heads/dev" "dev"; then
      BP_FINDINGS+=("额外规则集 $name 覆盖 dev（不在保存配置）——若为旧 protect-dev 未删或意外新增，为漂移")
    else
      info "规则集 $name 不指向 dev（transient/其他目标），不进 dev 两层核对"
    fi
  done <<< "$ids"
  local n
  for n in ${ALL_SAVED[@]+"${ALL_SAVED[@]}"}; do
    [[ "$seen" == *" $n "* ]] || { BP_FINDINGS+=("保存配置 $n 未见于远端"); fail "verify-config：$n" "未应用于远端"; }
  done
  local f
  for f in ${BP_FINDINGS[@]+"${BP_FINDINGS[@]}"}; do
    [[ "$f" == 额外规则集* ]] && fail "verify-config：额外规则集" "$f"
  done
  [[ "$FAILURES" == 0 ]] && info "4 个保存规则集与实时一致（dev 两层 + 测试分支 transient 对）" \
    || human_next "修复配置差异（UI 逐字段对齐 devenv/rulesets/*.json）后重跑 verify-config；确认旧 protect-dev 已删除"
  [[ "$FAILURES" == 0 ]]
}

# 等待 PR 检查完成（completed）——超时 15 分钟（GHA 排队另计）。
# 轮询静默进行（等待不是证据），完成态用 ev_run 留最终一次捕获。
wait_checks() { # wait_checks <pr>
  local pr="$1" sha done t0
  t0=$(date +%s)
  while :; do
    sha=$("$DEVENV" gh api "repos/$GHA_REPO/pulls/$pr" --jq '.head.sha' 2>/dev/null) || { sleep 20; continue; }
    done=$("$DEVENV" gh api "repos/$GHA_REPO/commits/$sha/check-runs" \
      --jq '[.check_runs[] | .status] | all(. == "completed")' 2>/dev/null) || { sleep 20; continue; }
    if [[ "$done" == "true" ]]; then
      ev_run "wait-final-$pr" "$DEVENV" gh api "repos/$GHA_REPO/commits/$sha/check-runs" \
        --jq '[.check_runs[] | {name, status, conclusion}]' || true
      return 0
    fi
    if (( $(date +%s) - t0 > 900 )); then
      return 1
    fi
    sleep 20
  done
}

# 前置断言：分支实际生效规则含必需检查与 PR 要求（rules/branches 联合视图）
assert_branch_rules() { # assert_branch_rules <branch> <label>
  local b="$1" label="$2" rc=0
  ev_run "pre-$b" "$DEVENV" gh api "repos/$GHA_REPO/rules/branches/$b" || rc=$?
  [[ $rc == 0 ]] || { fail "$label 前置" "无法读取 $b 生效规则（规则集未应用？）"; return 1; }
  local rules; rules=$(cat "$EV_DIR/pre-$b.out")
  printf '%s' "$rules" | jq -e 'map(select(.type == "required_status_checks")) | length >= 1' >/dev/null \
    || { fail "$label 前置" "$b 生效规则无必需检查——两层未生效，反例会误判（先跑 verify-config 并修复）"; return 1; }
  printf '%s' "$rules" | jq -e 'map(select(.type == "pull_request")) | length >= 2' >/dev/null \
    || { fail "$label 前置" "$b 生效规则 pull_request 层数 < 2（基础层 PR 要求 + 审批层缺一不可）"; return 1; }
  printf '%s' "$rules" | jq -e 'map(select(.type == "pull_request") | .parameters.dismiss_stale_reviews_on_push) | any(. == true)' >/dev/null \
    || { fail "$label 前置" "$b 生效规则未含 dismiss_stale（新推送应使旧批准失效）"; return 1; }
  pass "$label 前置：$b 生效规则含必需检查 + 两层 pull_request + dismiss_stale"
  return 0
}

# ---------------------------------------------------------------------------
# negatives：App 侧反例（测试分支靶；项 a' b' c'）
# ---------------------------------------------------------------------------
stage_negatives() {
  assert_branch_rules "$TEST_BRANCH" "negatives" || exit 1
  local st; st=$(state_load)
  local gpr rpr
  gpr=$(jq -r '.probe_green.pr // empty' <<< "$st"); rpr=$(jq -r '.probe_red.pr // empty' <<< "$st")
  [[ -n "$gpr" && -n "$rpr" ]] || { fail "negatives" "state.json 无探针 PR（先跑 prepare）"; exit 1; }

  info "等待两探针 PR 检查完成（绿探针走全量质量门）"
  if wait_checks "$gpr" && wait_checks "$rpr"; then
    pass "两探针 PR 检查均完成（最终态见 wait-final-$gpr.out / wait-final-$rpr.out）"
  else
    fail "negatives" "探针检查 15 分钟未完成（GHA 排队/失败？）——检查 PR #$gpr #$rpr"
  fi
  local rc=0
  ev_run "neg-green-conc" "$DEVENV" gh api "repos/$GHA_REPO/commits/$(jq -r .probe_green.sha "$STATE")/check-runs" \
    --jq '[.check_runs[] | .conclusion] | join(",")' || rc=$?
  [[ "$(cat "$EV_DIR/neg-green-conc.out" 2>/dev/null)" == "success" ]] \
    && pass "绿探针检查 success（项 d' 的检查绿前提成立）" \
    || fail "negatives" "绿探针检查非 success：$(cat "$EV_DIR/neg-green-conc.out" 2>/dev/null)"
  rc=0
  ev_run "neg-red-conc" "$DEVENV" gh api "repos/$GHA_REPO/commits/$(jq -r .probe_red.sha "$STATE")/check-runs" \
    --jq '[.check_runs[] | .conclusion] | join(",")' || rc=$?
  [[ "$(cat "$EV_DIR/neg-red-conc.out" 2>/dev/null)" == "failure" ]] \
    && pass "红探针检查 failure（workflow 静态门禁违规被 doctor 拒——项 e' 的检查红前提成立）" \
    || fail "negatives" "红探针检查非 failure：$(cat "$EV_DIR/neg-red-conc.out" 2>/dev/null)"

  local tb_before
  tb_before=$(remote_ref_sha "$TEST_BRANCH") || { fail "negatives" "读测试分支 HEAD 失败"; exit 1; }

  # a'：App 直推测试分支（新提交，FF）→ 应拒
  # 测试分支只存在于远端（主仓无该 ref）：克隆后显式 fetch 远端分支
  local tmp; tmp=$(mktemp -d /tmp/devenv-bp73.XXXXXX)
  git clone -q --no-local "$REPO_ROOT" "$tmp/repo"
  git -C "$tmp/repo" remote set-url origin "https://github.com/$GHA_REPO.git"
  git -C "$tmp/repo" fetch -q origin "$TEST_BRANCH"
  git -C "$tmp/repo" checkout -q -B t FETCH_HEAD
  git -C "$tmp/repo" commit -q --allow-empty -m "test: #73 项 a'——App 直推测试分支应拒（探针，不入库）"
  local psha; psha=$(git -C "$tmp/repo" rev-parse HEAD)
  rc=0
  ev_run push-a-test "$tmp/repo/devenv/devenv" git-push origin "$psha:refs/heads/$TEST_BRANCH" || rc=$?
  if [[ $rc != 0 ]]; then
    pass "项 a'：App 直推 $TEST_BRANCH 被拒（rc=$rc；$(grep -o 'remote rejected.*' "$EV_DIR/push-a-test.err" | head -1)）"
  else
    fail "项 a'" "App 直推测试分支竟成功——PR 规则未生效"
  fi
  rm -rf "$tmp"
  local tb_after; tb_after=$(remote_ref_sha "$TEST_BRANCH") || tb_after=""
  [[ "$tb_before" == "$tb_after" ]] \
    && pass "项 a' 后测试分支 HEAD 未动（${tb_after:0:8}——无效验证零写入）" \
    || fail "项 a'" "测试分支 HEAD 变了：$tb_before → $tb_after"

  # b'：红探针 PR（检查红 + 无批准）App 合入 → 应拒（两层均不满足）
  rc=0
  ev_run merge-b-red "$DEVENV" gh pr merge "$rpr" --squash || rc=$?
  if [[ $rc != 0 ]]; then
    pass "项 b'：App 对检查红且无批准的 PR #$rpr 合入被拒（rc=$rc：$(grep -io 'not mergeable[^\"]*' "$EV_DIR/merge-b-red.err" | head -1)）"
  else
    fail "项 b'" "红探针 PR 竟被合入——规则失效"
  fi

  # c'：绿探针 PR（检查绿 + 无批准）App 带 bypass_rules=true 合入 → 应拒（App 无绕过权）
  rc=0
  ev_run merge-c-async "$DEVENV" gh api --method PUT "repos/$GHA_REPO/pulls/$gpr/merge-async" \
    -F merge_method=squash -F merge_action=direct_merge -F bypass_rules=true || rc=$?
  if [[ $rc != 0 ]]; then
    pass "项 c'：App 以 bypass_rules=true 尝试合入绿探针 PR #$gpr 被拒（rc=$rc；HTTP $(grep -o 'HTTP [0-9]*' "$EV_DIR/merge-c-async.err" | head -1)——App 不在绕过名单）"
  else
    fail "项 c'" "App bypass 竟成功——绕过名单配错（App 不得在名单）"
  fi
  # c''：同 PR 普通合入（无 bypass）→ 应拒（审批层）
  rc=0
  ev_run merge-c-plain "$DEVENV" gh pr merge "$gpr" --squash || rc=$?
  [[ $rc != 0 ]] \
    && pass "项 c''：App 普通合入（无批准）被拒（$(grep -io 'not mergeable[^\"]*' "$EV_DIR/merge-c-plain.err" | head -1)）" \
    || fail "项 c''" "无批准竟可合入"

  tb_after=$(remote_ref_sha "$TEST_BRANCH") || tb_after=""
  [[ "$tb_before" == "$tb_after" ]] \
    && pass "negatives 收尾：测试分支全程未动（${tb_after:0:8}）" \
    || fail "negatives" "测试分支 HEAD 变了：$tb_before → $tb_after"

  human_next "项 d'/e'/f'（人类步骤，详见 docs/agents/branch-protection.md「验收流程」）：在 PR #${gpr}（绿）合并框以绕过方式合入（应成功，落测试分支）；在 PR #${rpr}（红）尝试绕过合入（应被拒，检查失败不可绕）；在 Web 编辑器直接改 $TEST_BRANCH 上文件提交（应被拒）。完成后运行：./devenv/devenv test:branch-protection probe-audit --pr $gpr 与 --pr $rpr"
  [[ "$FAILURES" == 0 ]]
}

# ---------------------------------------------------------------------------
# negatives-dev：App 侧 dev 反例（项 a + b/c on dev PR）+ dev HEAD 不动断言
# ---------------------------------------------------------------------------
stage_negatives_dev() {
  assert_branch_rules dev "negatives-dev" || exit 1
  [[ -n "$PR_ARG" ]] || { echo "negatives-dev 需要 --pr N（交付 PR 编号）" >&2; exit 2; }
  local pr="$PR_ARG"
  local rc=0
  ev_run nd-pr "$DEVENV" gh api "repos/$GHA_REPO/pulls/$pr" \
    --jq '{state, merged, head: .head.sha[0:8], approvals: ([.requested_reviewers[]?.login] | length)}' || rc=$?
  [[ $rc == 0 ]] || { fail "negatives-dev" "PR #$pr 读取失败"; exit 1; }
  info "PR #$pr 状态：$(cat "$EV_DIR/nd-pr.out")"
  local merged state
  merged=$(jq -r .merged "$EV_DIR/nd-pr.out"); state=$(jq -r .state "$EV_DIR/nd-pr.out")
  [[ "$state" == "open" && "$merged" == "false" ]] \
    || { fail "negatives-dev" "PR #$pr 非开放状态（$state/merged=$merged）——b/c 需在批准与合入之前运行"; exit 1; }
  # 前置：不得存在已批准评审（否则合入会成功）
  rc=0
  ev_run nd-reviews "$DEVENV" gh api "repos/$GHA_REPO/pulls/$pr/reviews" \
    --jq '[.[] | select(.state == "APPROVED")] | length' || rc=$?
  [[ "$(cat "$EV_DIR/nd-reviews.out")" == "0" ]] \
    || { fail "negatives-dev" "PR #$pr 已有批准——请先跑本阶段再批准（b/c 是无批准反例）"; exit 1; }

  local dev_before
  dev_before=$(remote_ref_sha dev) || { fail "negatives-dev" "读 dev HEAD 失败"; exit 1; }
  info "dev 基线 HEAD：${dev_before:0:8}"

  # a：App 直推 dev（新提交，FF）→ 应拒（PR 规则；对任何人成立，含 App）
  local tmp; tmp=$(mktemp -d /tmp/devenv-bp73d.XXXXXX)
  git clone -q --no-local --branch dev --single-branch "$REPO_ROOT" "$tmp/repo"
  git -C "$tmp/repo" remote set-url origin "https://github.com/$GHA_REPO.git"
  git -C "$tmp/repo" commit -q --allow-empty -m "test: #73 项 a——App 直推 dev 应拒（探针，不入库）"
  local psha; psha=$(git -C "$tmp/repo" rev-parse HEAD)
  rc=0
  ev_run push-a-dev "$tmp/repo/devenv/devenv" git-push origin "$psha:refs/heads/dev" || rc=$?
  if [[ $rc != 0 ]]; then
    pass "项 a：App 直推 dev 被拒（rc=$rc；$(grep -o 'remote rejected.*' "$EV_DIR/push-a-dev.err" | head -1)）"
  else
    fail "项 a" "App 直推 dev 竟成功——基础层 PR 规则未生效"
  fi
  rm -rf "$tmp"

  # c：交付 PR（无批准）bypass_rules=true → 应拒；普通合入 → 应拒
  rc=0
  ev_run merge-c-async-dev "$DEVENV" gh api --method PUT "repos/$GHA_REPO/pulls/$pr/merge-async" \
    -F merge_method=squash -F merge_action=direct_merge -F bypass_rules=true || rc=$?
  if [[ $rc != 0 ]]; then
    pass "项 c(dev)：App 以 bypass_rules=true 尝试合入 PR #$pr 被拒（rc=$rc；HTTP $(grep -o 'HTTP [0-9]*' "$EV_DIR/merge-c-async-dev.err" | head -1)）"
  else
    fail "项 c(dev)" "App bypass 竟成功——绕过名单含 App（配置错误）"
  fi
  rc=0
  ev_run merge-b-dev "$DEVENV" gh pr merge "$pr" --squash || rc=$?
  [[ $rc != 0 ]] \
    && pass "项 b(dev)：App 无批准合入 PR #$pr 被拒（$(grep -io 'not mergeable[^\"]*' "$EV_DIR/merge-b-dev.err" | head -1)）" \
    || fail "项 b(dev)" "无批准竟可合入 PR #$pr"

  local dev_after; dev_after=$(remote_ref_sha dev) || dev_after=""
  [[ "$dev_before" == "$dev_after" ]] \
    && pass "项 a/b/c 后 dev HEAD 未动（${dev_after:0:8}——无效验证零写入 dev）" \
    || fail "negatives-dev" "dev HEAD 变了：$dev_before → $dev_after"

  human_next "项 f（人类步骤）：在 Web 编辑器打开 dev 上任一文件尝试直接提交（应被拒，提示走分支/PR）；结果记入 $EVIDENCE_DIR/human-actions.md。随后批准 PR #$pr 并运行：./devenv/devenv test:branch-protection g --pr $pr"
  [[ "$FAILURES" == 0 ]]
}

# ---------------------------------------------------------------------------
# g：批准后新推送使旧批准失效（项 g）
# ---------------------------------------------------------------------------
stage_g() {
  [[ -n "$PR_ARG" ]] || { echo "g 需要 --pr N（交付 PR 编号）" >&2; exit 2; }
  local pr="$PR_ARG"
  # 前置：存在人类批准
  local rc=0
  ev_run g-reviews0 "$DEVENV" gh api "repos/$GHA_REPO/pulls/$pr/reviews" \
    --jq '[.[] | select(.state == "APPROVED") | .user.login] | join(",")' || rc=$?
  local approvers; approvers=$(cat "$EV_DIR/g-reviews0.out")
  [[ -n "$approvers" && "$approvers" != "null" ]] \
    || { fail "项 g 前置" "PR #$pr 无批准（先由指挥者批准再跑 g）"; exit 1; }
  pass "项 g 前置：PR #$pr 已有批准（$approvers）"

  local dev_before; dev_before=$(remote_ref_sha dev) || true
  local branch; branch=$(git -C "$REPO_ROOT" branch --show-current)
  [[ -z "$(git -C "$REPO_ROOT" status --porcelain)" ]] \
    || { fail "项 g" "工作树不干净（先提交/贮藏再跑 g——g 会向当前分支推新提交）"; exit 1; }

  # 推新提交到 PR 分支（App 身份；本仓库当前分支即 PR head）
  git -C "$REPO_ROOT" commit -q --allow-empty -m "test: #73 项 g——批准后新推送（触发旧批准失效）"
  local nsha; nsha=$(git -C "$REPO_ROOT" rev-parse HEAD)
  rc=0
  ev_run g-push "$DEVENV" git-push origin "HEAD:refs/heads/$branch" || rc=$?
  [[ $rc == 0 ]] || { fail "项 g" "向 PR 分支 $branch 推送失败 rc=$rc"; exit 1; }
  pass "项 g：已向 PR #$pr 分支推新提交（${nsha:0:8}，App 身份——项 h）"

  # 旧批准应已 DISMISSED（dismiss_stale_reviews_on_push）
  local dismissed=0 t0; t0=$(date +%s)
  while :; do
    rc=0
    ev_run g-reviews1 "$DEVENV" gh api "repos/$GHA_REPO/pulls/$pr/reviews" \
      --jq '[.[] | select(.state == "DISMISSED") | .user.login] | join(",")' || rc=$?
    [[ -n "$(cat "$EV_DIR/g-reviews1.out" 2>/dev/null)" ]] && { dismissed=1; break; }
    (( $(date +%s) - t0 > 120 )) && break
    sleep 10
  done
  if (( dismissed )); then
    pass "项 g：旧批准已被新推送失效（DISMISSED：$(cat "$EV_DIR/g-reviews1.out")——合入的须是被看过的版本）"
  else
    fail "项 g" "新推送后未观察到 DISMISSED 评审（dismiss_stale 未生效？）"
  fi

  # App 合入尝试 → 应拒（须重新批准）
  rc=0
  ev_run g-merge "$DEVENV" gh pr merge "$pr" --squash || rc=$?
  [[ $rc != 0 ]] \
    && pass "项 g：批准失效后 App 合入被拒（须重新批准；$(grep -io 'not mergeable[^\"]*' "$EV_DIR/g-merge.err" | head -1)）" \
    || fail "项 g" "批准失效后竟可合入——dismiss_stale 配置失效"

  local dev_after; dev_after=$(remote_ref_sha dev) || true
  [[ "$dev_before" == "$dev_after" ]] \
    && pass "项 g 全程 dev HEAD 未动（${dev_after:0:8}）" \
    || info "dev HEAD 有变化（$dev_before → $dev_after；若为合法合入属预期）"

  human_next "项 g 收尾（人类步骤）：重新批准 PR #$pr（旧批准已失效），然后正常合入（squash/merge 均在允许列表）；或以绕过方式合入（项 d）。合入后可运行：./devenv/devenv test:branch-protection probe-audit --pr $pr"
  [[ "$FAILURES" == 0 ]]
}

# ---------------------------------------------------------------------------
# probe-audit：项 i（审计面）+ d'（bypass 合并的机器可查面）
# ---------------------------------------------------------------------------
stage_probe_audit() {
  [[ -n "$PR_ARG" ]] || { echo "probe-audit 需要 --pr N" >&2; exit 2; }
  local pr="$PR_ARG" rc=0
  ev_run pa-pr "$DEVENV" gh api "repos/$GHA_REPO/pulls/$pr" \
    --jq '{number, state, merged, merged_by: .merged_by.login, merge_commit_sha: .merge_commit_sha[0:10],
            author: .user.login, head: .head.sha[0:8], base: .base.ref}' || rc=$?
  [[ $rc == 0 ]] || { fail "probe-audit" "PR #$pr 读取失败"; exit 1; }
  info "PR #$pr：$(cat "$EV_DIR/pa-pr.out")"

  local author merged merged_by base
  author=$(jq -r .author "$EV_DIR/pa-pr.out")
  merged=$(jq -r .merged "$EV_DIR/pa-pr.out")
  merged_by=$(jq -r .merged_by "$EV_DIR/pa-pr.out")
  base=$(jq -r .base "$EV_DIR/pa-pr.out")
  [[ "$author" == "${GHA_APP_SLUG}[bot]" ]] \
    && pass "项 h：PR #$pr 作者为 ${author}（App bot；默认身份路径=GitHub App）" \
    || info "项 h：PR #$pr 作者为 $author（本项对 App 建的 PR 断言；人类建的 PR 记录为人工面）"

  ev_run pa-reviews "$DEVENV" gh api "repos/$GHA_REPO/pulls/$pr/reviews" \
    --jq '[.[] | {user: .user.login, state}]' || true
  info "PR #$pr 评审记录（合并时刻的状态快照）：$(cat "$EV_DIR/pa-reviews.out")"

  ev_run pa-timeline "$DEVENV" gh api "repos/$GHA_REPO/issues/$pr/timeline?per_page=100" \
    --jq '[.[] | {event, actor: (.actor.login // .user.login // null)}] | map(select(.event != null))' || true
  info "PR #$pr 时间线事件类型：$(jq -c 'map(.event) | unique' "$EV_DIR/pa-timeline.out" 2>/dev/null || echo '读取失败')"

  ev_run pa-activity "$DEVENV" gh api "repos/$GHA_REPO/activity?per_page=50" \
    --jq '[.[] | {activity_type, actor: .actor.login, ref, before: (.before // null | if . then .[0:8] else null end), after: (.after // null | if . then .[0:8] else null end), timestamp}] | map(select(.ref == "refs/heads/'"$base"'" or .ref == null))' || true
  info "仓库活动事件（含 $base）：$(cat "$EV_DIR/pa-activity.out")"

  if [[ "$merged" == "true" ]]; then
    local approvals_at_merge
    approvals_at_merge=$(jq -r '[.[] | select(.state == "APPROVED")] | length' "$EV_DIR/pa-reviews.out" 2>/dev/null || echo '?')
    if [[ "$approvals_at_merge" == "0" ]]; then
      pass "项 d'（机器面）：PR #$pr 已合入且无批准评审（合并者 $merged_by —— 经绕过合入的机器可查特征）"
    else
      info "PR #$pr 合入时有 $approvals_at_merge 个批准（正常批准路径，非 bypass 面）"
    fi
    [[ "$merged_by" == "bbhl79" ]] \
      && info "合并者 $merged_by（指挥者本人账号——绕过权仅点名该账号）" \
      || info "合并者 $merged_by"
  else
    info "PR #$pr 未合入（e' 拒绝面：未合入 + 检查红 即拒绝证据；人工面见 human-actions.md）"
  fi

  # rule-suites（审计面）：App 无 Administration 读权限——如实记录
  rc=0
  ev_run pa-rulesuites "$DEVENV" gh api "repos/$GHA_REPO/rulesets/rule-suites?time_period=month" || rc=$?
  if [[ $rc != 0 ]]; then
    pass "项 i（边界）：rule-suites 端点对 App 拒绝（$(grep -o 'HTTP [0-9]*' "$EV_DIR/pa-rulesuites.err" | head -1)——App 无 Administration 读权限，规范刻意如此；管理员读取归指挥者）"
  else
    info "项 i：rule-suites 对 App 可读（意外——如实记录内容）：$(head -c 400 "$EV_DIR/pa-rulesuites.out")"
  fi

  human_next "项 i（人类管理员步骤，读操作）：以指挥者身份读取 rule-suites 并把输出保存到 $EVIDENCE_DIR/rule-suites-admin.txt（curl -s -H 'Accept: application/vnd.github+json' 'https://api.github.com/repos/$GHA_REPO/rulesets/rule-suites?rule_suite_result=bypass&time_period=month' 于浏览器登录态或本人令牌；或在 Settings→Rules 的 insights 页查看截图）。同时把 d'/e'/f' 的 UI 实况（按钮形态/拒绝提示原文）记入 $EVIDENCE_DIR/human-actions.md——验收只对已确认字段下结论，不预设审计位置/内容/保留期，不声称能区分冒用"
  [[ "$FAILURES" == 0 ]]
}

# ---------------------------------------------------------------------------
# cleanup-test：删测试分支与探针（前置：transient 规则集已删）
# ---------------------------------------------------------------------------
stage_cleanup_test() {
  local rc=0 list transient
  ev_run cu-list "$DEVENV" gh api "repos/$GHA_REPO/rulesets" || rc=$?
  [[ $rc == 0 ]] || { fail "cleanup-test" "规则集列表读取失败"; exit 1; }
  transient=$(jq -r '[.[] | select(.name | startswith("protect-bp73-test-"))] | length' "$EV_DIR/cu-list.out")
  if [[ "$transient" =~ ^[0-9]+$ && "$transient" -gt 0 ]]; then
    human_next "先在 GitHub UI 删除两个 transient 规则集（protect-bp73-test-base / protect-bp73-test-approval，Settings → Rules → 各规则集 Delete）——测试分支受 deletion 规则保护，删分支须先删规则集；删完重跑本阶段"
    fail "cleanup-test" "远端仍有 $transient 个 transient 规则集"
    exit 1
  fi
  local st; st=$(state_load)
  local gpr rpr gbranch rbranch
  gpr=$(jq -r '.probe_green.pr // empty' <<< "$st"); rpr=$(jq -r '.probe_red.pr // empty' <<< "$st")
  gbranch=$(jq -r '.probe_green.branch // empty' <<< "$st"); rbranch=$(jq -r '.probe_red.branch // empty' <<< "$st")

  for pr in "$gpr" "$rpr"; do
    [[ -n "$pr" ]] || continue
    rc=0
    ev_run "close-$pr" "$DEVENV" gh pr close "$pr" || rc=$?
    [[ $rc == 0 ]] && pass "探针 PR #$pr 已关闭" || info "探针 PR #$pr 关闭失败（可能已合并/不存在）"
  done

  local tmp; tmp=$(mktemp -d /tmp/devenv-bp73c.XXXXXX)
  git clone -q --no-local "$REPO_ROOT" "$tmp/repo"
  git -C "$tmp/repo" remote set-url origin "https://github.com/$GHA_REPO.git"
  local b
  for b in "$gbranch" "$rbranch" "$TEST_BRANCH"; do
    [[ -n "$b" ]] || continue
    rc=0
    ev_run "del-$b" "$tmp/repo/devenv/devenv" git-push origin ":refs/heads/$b" || rc=$?
    [[ $rc == 0 ]] && pass "分支 $b 已删除" || fail "cleanup-test" "分支 $b 删除失败 rc=$rc：$(tail -2 "$EV_DIR/del-$b.err")"
  done
  rm -rf "$tmp"
  state_set '.cleaned = true'
  info "清理完成（探针 PR 关闭 + 分支删除；transient 规则集已由指挥者先行删除）"
  [[ "$FAILURES" == 0 ]]
}

# ---------------------------------------------------------------------------
# summary：a–i 验收映射
# ---------------------------------------------------------------------------
stage_summary() {
  local log="$EV_DIR/evidence.log" sum="$EVIDENCE_DIR/summary.txt"
  local accept_lines="" l
  while IFS= read -r l; do
    case "$l" in *"PASS: 项"*|*"FAIL: 项"*) accept_lines+="$l"$'\n';; esac
  done < "$log"
  {
    echo "分支保护两层规则集受控验收（#73；spec #23 验收清单项 10 a–i；j–m 归 #55）"
    echo "证据目录：$EVIDENCE_DIR"
    echo "时间：$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "---- 机器断言（本 harness）----"
    if [[ -n "$accept_lines" ]]; then printf '%s' "$accept_lines"; else echo "（无——先跑 negatives / negatives-dev / g / probe-audit）"; fi
    echo "---- 人工面（指挥者 UI 操作记录）----"
    if [[ -f "$EV_DIR/human-actions.md" ]]; then cat "$EV_DIR/human-actions.md"; else echo "（未见 human-actions.md——d'/e'/f'/i 人工步骤尚未记录）"; fi
    echo "---- 映射提示 ----"
    echo "a App 直推 dev 拒：negatives-dev 项 a | b 无批准合入拒：negatives 项 b' + negatives-dev 项 b(dev)"
    echo "c App 尝试绕过拒：negatives 项 c' + negatives-dev 项 c(dev) | d 指挥者绕过合入（绿）成功：人工 d' + probe-audit"
    echo "e 绕过但检查失败仍拒：人工 e'（红探针 PR 保持未合入即证据）| f 指挥者直推拒：人工 f'（测试分支）+ f（dev）"
    echo "g 批准后新推送失效：g 阶段 | h 默认身份=App：探针 PR/推送作者 + current_user_can_bypass=never"
    echo "i 人类绕过审计字段：probe-audit + rule-suites-admin.txt（管理员读）——只对已确认字段下结论"
    echo "无效验证零写入 dev：negatives-dev / g 的 dev HEAD 不动断言"
  } | tee "$sum"
  ev_log "summary 已写入 $sum"
  [[ "$FAILURES" == 0 ]]
}

case "$STAGE" in
  status)         stage_status ;;
  prepare)        stage_prepare ;;
  verify-config)  stage_verify_config ;;
  negatives)      stage_negatives ;;
  negatives-dev)  stage_negatives_dev ;;
  g)              stage_g ;;
  probe-audit)    stage_probe_audit ;;
  cleanup-test)   stage_cleanup_test ;;
  summary)        stage_summary ;;
  *) echo "未知阶段：$STAGE（可用：status prepare verify-config negatives negatives-dev g probe-audit cleanup-test summary）" >&2; exit 2 ;;
esac
ev_log "阶段 $STAGE 完成：$PASS_COUNT 通过，$FAILURES 失败"
printf '阶段 %s 完成：%s 通过，%s 失败\n' "$STAGE" "$PASS_COUNT" "$FAILURES"
[[ "$FAILURES" == 0 ]]
