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
# 断言口径（评审整改后）：
#   - 应拒断言 = rc≠0 且 rc∉20–23（认证入口失败不作反例证据）且 stderr 含拒绝
#     特征（rejected / not mergeable / HTTP 4xx）；特征不明 → 不判通过。
#   - merge-async 是异步接口（202+UUID，规则在后台阶段判定）：受理后轮询终态，
#     断言 status=failed 且 PR 未合入；端点不可用/轮询超时 → 如实「无法判定」。
#   - bypass_actors 仅规则集写权限者可见（实测）：App/匿名核对拆「公开面」，
#     缺失不判漂移、显式记 NOTE；强校验归指挥者管理员令牌。
#   - 含 / 的分支名先清洗为安全标签再作 ev_run 文件名。
#
# 阶段（devenv test:branch-protection <阶段>）：
#   status            只读总览（实时规则集 / 覆盖面 / 探针 PR 状态）
#   prepare           建 test/bp-73-acceptance + 绿/红探针分支与 PR（红探针=workflow
#                     静态门禁故意违规，CI 必红）
#   verify-config     4 个保存规则集（dev 两层 + 测试分支 transient 对）↔ 实时逐字段核对
#                     （App 身份；公开面语义）+ current_user_can_bypass=never 断言 + 证据 dump
#   negatives         App 侧反例（测试分支靶）：直推拒 / 红探针无批准合入拒 /
#                     绿探针 bypass_rules=true 异步合入终态 failed（先等检查完成）
#   negatives-dev --pr N   App 侧 dev 反例：直推 dev 拒 / PR N 未批准时合入拒 +
#                     bypass_rules=true 拒；前后断言 dev HEAD 不动（无效验证不写入 dev）
#   g --pr N          项 g：向 PR N（指挥者已批准）推新提交 → 断言既有批准评审已
#                     DISMISSED（按评审 ID 绑定）→ App 合入尝试应拒（须重新批准）
#   probe-audit --pr N    项 i/d' 机器面：PR 合并状态/合并者/评审/时间线/活动事件 +
#                     rule-suites 管理员端点对 App 的可见性（如实记录）；输出指挥者
#                     管理员侧核对的指令
#   cleanup-test      关闭探针 PR、删探针/测试分支（前置：指挥者已删两个 transient 规则集）
#   summary           汇总 a–i 验收映射到证据文件，写 summary.txt
#
# 默认（无参数）= status（只读安全）。
# 所有 GitHub 操作经 ./devenv/devenv（App 身份）；本进程不把 token 写进任何
# 命令行参数/日志（漂移核对的 App token 经环境变量传递给 curl 的 stdin 头，
# 见 lib/branch-protection.sh；换取后即 unset）。
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
note2() { printf '[bp] NOTE: %s\n' "$1"; ev_log_file "NOTE: $1"; }
human_next() { printf '\n[下一步·指挥者] %s\n' "$1" | tee -a "$EV_DIR/human-steps.log" >&2; }

label_of() { printf '%s' "$1" | tr '/' '-'; }   # 含 / 的分支名 → 安全证据文件名标签

state_load()  { [[ -f "$STATE" ]] && cat "$STATE" || echo '{}'; }
state_set() { # state_set <jq 赋值表达式>（对 state.json 原地更新；缺失时从 {} 起步）
  local expr="$1" tmp="$STATE.tmp"
  if ! state_load | jq "$expr" > "$tmp" 2>/dev/null; then
    echo "state.json 更新失败：$expr" >&2; rm -f "$tmp"; exit 1
  fi
  mv "$tmp" "$STATE"
}

remote_ref_sha() { # remote_ref_sha <branch> → stdout sha（失败无输出、rc≠0——调用方 fail closed）
  "$DEVENV" gh api "repos/$GHA_REPO/git/ref/heads/$1" --jq '.object.sha' 2>/dev/null
}

# 应拒断言：rc≠0 + 非认证入口失败（20–23）+ stderr 含拒绝特征（不判特征不明）
expect_reject() { # expect_reject <描述> <rc> <errfile>
  local desc="$1" rc="$2" errf="$3" reason=""
  if [[ $rc == 0 ]]; then
    fail "$desc" "操作竟成功（rc=0）——规则未拦截"
    return 1
  fi
  if [[ $rc -ge 20 && $rc -le 23 ]]; then
    fail "$desc" "拒绝源于认证入口（rc=$rc，20–23）——非规则拒绝，不能作反例证据"
    return 1
  fi
  if ! grep -qiE 'rejected|not mergeable|HTTP 40[0-9]|protected|ruleset' "$errf" 2>/dev/null; then
    fail "$desc" "rc=$rc 但拒绝特征不明确（stderr 无 rejected/not mergeable/HTTP 4xx 标记）——见 $(basename "$errf")，不判通过"
    return 1
  fi
  reason=$(grep -oE '(remote rejected[^)]*\)|not mergeable[^\"]*|HTTP [0-9]+[^)]*\)' "$errf" 2>/dev/null | head -1)
  [[ -z "$reason" ]] && reason=$(grep -o 'HTTP [0-9]*' "$errf" 2>/dev/null | head -1)
  pass "$desc：被拒（rc=$rc；${reason:-特征见 $(basename "$errf")}）"
  return 0
}

# ---------------------------------------------------------------------------
# merge-async bypass 尝试（异步接口：202 受理 → 轮询终态）
# 返回：0=被拒（终态 failed）| 1=竟成功 | 2=无法判定（端点不可用/轮询超时/态异常）
# ---------------------------------------------------------------------------
attempt_bypass_merge_async() { # <pr> <label>
  local pr="$1" lbl="$2" rc=0 body status uuid t0
  ev_run "$lbl-put" "$DEVENV" gh api --method PUT "repos/$GHA_REPO/pulls/$pr/merge-async" \
    -F merge_method=squash -F merge_action=direct_merge -F bypass_rules=true || rc=$?
  if [[ $rc == 0 ]]; then
    body=$(cat "$EV_DIR/$lbl-put.out" 2>/dev/null || printf '{}')
    status=$(jq -r '.status // empty' <<< "$body" 2>/dev/null)
    uuid=$(jq -r '.details.uuid // empty' <<< "$body" 2>/dev/null)
    if [[ "$status" == "merged" ]]; then return 1; fi
    if [[ "$status" != "pending" || -z "$uuid" ]]; then return 2; fi
    t0=$(date +%s)
    while :; do
      if (( $(date +%s) - t0 > 300 )); then return 2; fi
      sleep 10
      rc=0
      ev_run "$lbl-poll" "$DEVENV" gh api "repos/$GHA_REPO/pulls/$pr/merge-async/$uuid" || rc=$?
      [[ $rc != 0 ]] && continue
      status=$(jq -r '.status // empty' < "$EV_DIR/$lbl-poll.out" 2>/dev/null)
      [[ "$status" == "pending" || "$status" == "enqueued" || -z "$status" ]] && continue
      break
    done
    case "$status" in
      merged) return 1 ;;
      failed) return 0 ;;
      *) return 2 ;;
    esac
  fi
  # 同步报错分类：403/405=请求时拒绝（PASS 方向）；404/其他=无法判定（认证码 20–23 由调用方 expect_reject 语义处理，此处如实 2）
  local http
  http=$(grep -o 'HTTP [0-9]*' "$EV_DIR/$lbl-put.err" 2>/dev/null | head -1)
  case "$http" in
    "HTTP 403"|"HTTP 405") return 0 ;;
    *) return 2 ;;
  esac
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
  local b lbl
  for b in dev "$TEST_BRANCH"; do
    rc=0
    lbl="rules-$(label_of "$b")"
    ev_run "$lbl" "$DEVENV" gh api "repos/$GHA_REPO/rules/branches/$b" || rc=$?
    if [[ $rc == 0 ]]; then
      info "分支 $b 实际生效规则（rules/branches 联合视图）：$(jq -r '[.[].type] | unique | join("+")' "$EV_DIR/$lbl.out")"
    else
      info "分支 $b 无生效规则（或读取失败 rc=$rc）"
    fi
  done
  local st g r
  st=$(state_load)
  g=$(jq -r '.probe_green.pr // empty' <<< "$st"); r=$(jq -r '.probe_red.pr // empty' <<< "$st")
  local pr
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
# verify-config：4 保存规则集 ↔ 实时逐字段核对（App 身份，公开面语义）
# ---------------------------------------------------------------------------
stage_verify_config() {
  info "漂移核对引擎（App token 经环境变量传给 curl stdin 头，不进 argv/日志；核对后即 unset）"
  local tok rc=0 out
  tok=$(gha_mint_token) || { fail "verify-config" "App token 换取失败"; exit 1; }
  BP_GITHUB_TOKEN="$tok"
  out=$(BP_ECHO_FINDINGS=1 bp_check_drift ${ALL_SAVED[@]+"${ALL_SAVED[@]}"}) || rc=$?
  unset BP_GITHUB_TOKEN tok
  local line notes=0
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    if [[ "$line" == NOTE:* ]]; then
      note2 "${line#NOTE: }"
      notes=$((notes + 1))
    else
      fail "verify-config" "$line"
    fi
  done <<< "$out"
  case "$rc" in
    0) [[ $FAILURES == 0 ]] && pass "verify-config：4 个保存规则集与实时一致（${notes} 项 bypass 名单未核对面提示——绕过名单的核对归管理员强校验与行为验收）" ;;
    1) fail "verify-config" "漂移（rc=1，见上各发现；修复后重跑）" ;;
    *) fail "verify-config" "无法核查（rc=$rc；fetch/解析失败，fail closed 不判一致）" ;;
  esac

  # 证据 dump + App 绕过面正断言（current_user_can_bypass 逐规则集 = never）
  local list rc2=0 line2 id name found
  ev_run vc-dump-list "$DEVENV" gh api "repos/$GHA_REPO/rulesets" || rc2=$?
  if [[ $rc2 == 0 ]]; then
    while IFS= read -r line2; do
      [[ -z "$line2" ]] && continue
      id="${line2%% *}"; name="${line2#* }"
      found=""
      local n
      for n in ${ALL_SAVED[@]+"${ALL_SAVED[@]}"}; do
        [[ "$n" == "$name" ]] && found=1 && break
      done
      [[ -z "$found" ]] && continue
      local r3=0
      ev_run "vc-dump-$name" "$DEVENV" gh api "repos/$GHA_REPO/rulesets/$id" || r3=$?
      if [[ $r3 == 0 ]]; then
        local cub
        cub=$(jq -r '.current_user_can_bypass // "不可见"' "$EV_DIR/vc-dump-$name.out")
        if [[ "$cub" == "never" ]]; then
          pass "verify-config：$name 对 App 身份 current_user_can_bypass=never（App 不在绕过名单）"
        else
          fail "verify-config：$name" "App 的 current_user_can_bypass=$cub（预期 never——App 不得有绕过权）"
        fi
      else
        fail "verify-config" "规则集 $name 证据 dump 读取失败（rc=$r3）"
      fi
    done < <(jq -r '[.[] | select(.target == "branch")] | .[] | "\(.id) \(.name)"' "$EV_DIR/vc-dump-list.out")
  else
    fail "verify-config" "证据 dump 的规则集列表读取失败（rc=$rc2）"
  fi
  human_next "配置差异修复（UI 逐字段对齐 devenv/rulesets/*.json）后重跑 verify-config；确认旧 protect-dev 已删除。绕过名单的强校验（可选但建议）：BP_GITHUB_TOKEN=<管理员令牌> ./devenv/devenv branch-protection --require-bypass-actors（缺失 bypass_actors 即 fail closed）"
  [[ "$FAILURES" == 0 ]]
}

# 等待 PR 的 quality-gate 检查完成（存在且 completed）——超时 15 分钟（排队另计）。
# 超时判断在循环顶；API 异常不构成提前退出；空集合（check-run 未注册）不算完成。
# 轮询静默进行（等待不是证据），完成态用 ev_run 留最终一次捕获。
wait_checks() { # wait_checks <pr>
  local pr="$1" sha done t0
  t0=$(date +%s)
  while :; do
    if (( $(date +%s) - t0 > 900 )); then return 1; fi
    sha=$("$DEVENV" gh api "repos/$GHA_REPO/pulls/$pr" --jq '.head.sha' 2>/dev/null) || { sleep 20; continue; }
    done=$("$DEVENV" gh api "repos/$GHA_REPO/commits/$sha/check-runs" \
      --jq '[.check_runs[] | select(.name == "quality-gate")] | (length > 0) and all(.status == "completed")' 2>/dev/null) || { sleep 20; continue; }
    if [[ "$done" == "true" ]]; then
      ev_run "wait-final-$pr" "$DEVENV" gh api "repos/$GHA_REPO/commits/$sha/check-runs" \
        --jq '[.check_runs[] | select(.name == "quality-gate") | {name, status, conclusion}]' || true
      return 0
    fi
    sleep 20
  done
}

probe_conclusion() { # probe_conclusion <pr> <sha> <期望(success|failure)> <描述>
  local pr="$1" sha="$2" want="$3" desc="$4" rc=0
  ev_run "conc-$pr" "$DEVENV" gh api "repos/$GHA_REPO/commits/$sha/check-runs" \
    --jq '[.check_runs[] | select(.name == "quality-gate") | .conclusion] | join(",")' || rc=$?
  local got; got=$(cat "$EV_DIR/conc-$pr.out" 2>/dev/null)
  [[ $rc == 0 && "$got" == "$want" ]] \
    && pass "$desc（quality-gate conclusion=$got）" \
    || fail "$desc" "quality-gate conclusion=$got（期望 $want；rc=$rc）"
}

# 前置断言：分支实际生效规则含必需检查与两层 PR 要求（rules/branches 联合视图）
assert_branch_rules() { # assert_branch_rules <branch> <label>
  local b="$1" label="$2" rc=0 lbl
  lbl="pre-$(label_of "$b")"
  ev_run "$lbl" "$DEVENV" gh api "repos/$GHA_REPO/rules/branches/$b" || rc=$?
  [[ $rc == 0 ]] || { fail "$label 前置" "无法读取 $b 生效规则（规则集未应用？）"; return 1; }
  local rules; rules=$(cat "$EV_DIR/$lbl.out")
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
  local gpr rpr gsha rsha
  gpr=$(jq -r '.probe_green.pr // empty' <<< "$st"); rpr=$(jq -r '.probe_red.pr // empty' <<< "$st")
  gsha=$(jq -r '.probe_green.sha // empty' <<< "$st"); rsha=$(jq -r '.probe_red.sha // empty' <<< "$st")
  [[ -n "$gpr" && -n "$rpr" && -n "$gsha" && -n "$rsha" ]] \
    || { fail "negatives" "state.json 无探针 PR/SHA（先跑 prepare）"; exit 1; }

  info "等待两探针 PR 的 quality-gate 检查完成（绿探针走全量质量门）"
  if wait_checks "$gpr" && wait_checks "$rpr"; then
    pass "两探针 PR 的 quality-gate 检查均完成（最终态见 wait-final-$gpr.out / wait-final-$rpr.out）"
  else
    fail "negatives" "探针检查 15 分钟未完成（GHA 排队/失败？）——检查 PR #$gpr #$rpr"
  fi
  probe_conclusion "$gpr" "$gsha" success "项 d' 前提：绿探针检查 success"
  probe_conclusion "$rpr" "$rsha" failure "项 e' 前提：红探针检查 failure（workflow 静态门禁违规被 doctor 拒）"

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
  local rc=0
  ev_run push-a-test "$tmp/repo/devenv/devenv" git-push origin "$psha:refs/heads/$TEST_BRANCH" || rc=$?
  expect_reject "项 a'：App 直推 $TEST_BRANCH" "$rc" "$EV_DIR/push-a-test.err" \
    || fail "项 a'" "直推测试分支未被规则拦截（见上）"
  rm -rf "$tmp"
  local tb_after
  tb_after=$(remote_ref_sha "$TEST_BRANCH") || tb_after=""
  [[ -n "$tb_after" && "$tb_before" == "$tb_after" ]] \
    && pass "项 a' 后测试分支 HEAD 未动（${tb_after:0:8}——无效验证零写入）" \
    || fail "项 a'" "测试分支 HEAD 变了或读取失败：$tb_before → $tb_after"

  # b'：红探针 PR（检查红 + 无批准）App 合入 → 应拒（两层均不满足）
  rc=0
  ev_run merge-b-red "$DEVENV" gh pr merge "$rpr" --squash || rc=$?
  expect_reject "项 b'：App 对检查红且无批准的 PR #$rpr 合入" "$rc" "$EV_DIR/merge-b-red.err" \
    || fail "项 b'" "红探针 PR 未被规则拦截（竟可合入？——规则失效）"

  # c'：绿探针 PR（检查绿 + 无批准）App 带 bypass_rules=true 异步合入 → 终态 failed
  local br=0
  attempt_bypass_merge_async "$gpr" "c-async" && br=0 || br=$?
  case "$br" in
    0) pass "项 c'：App 以 bypass_rules=true 尝试合入绿探针 PR #$gpr，异步终态 failed（被拒——App 不在绕过名单）" ;;
    1) fail "项 c'" "App bypass 竟成功——绕过名单配错（App 不得在名单）" ;;
    *) fail "项 c'" "无法判定（端点不可用/轮询超时/态异常——见 c-async-* 证据）；以 c'' 同步拒绝为有效反例" ;;
  esac
  # c''：同 PR 普通合入（无 bypass）→ 应拒（审批层）
  rc=0
  ev_run merge-c-plain "$DEVENV" gh pr merge "$gpr" --squash || rc=$?
  expect_reject "项 c''：App 普通合入（无批准）绿探针 PR #$gpr" "$rc" "$EV_DIR/merge-c-plain.err" \
    || fail "项 c''" "无批准竟可合入"

  tb_after=$(remote_ref_sha "$TEST_BRANCH") || tb_after=""
  [[ -n "$tb_after" && "$tb_before" == "$tb_after" ]] \
    && pass "negatives 收尾：测试分支全程未动（${tb_after:0:8}）" \
    || fail "negatives" "测试分支 HEAD 变了或读取失败：$tb_before → $tb_after"

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
    --jq '{state, merged, base: .base.ref, head_ref: .head.ref, head: .head.sha[0:8]}' || rc=$?
  [[ $rc == 0 ]] || { fail "negatives-dev" "PR #$pr 读取失败"; exit 1; }
  info "PR #$pr 状态：$(cat "$EV_DIR/nd-pr.out")"
  local merged state base
  merged=$(jq -r .merged "$EV_DIR/nd-pr.out"); state=$(jq -r .state "$EV_DIR/nd-pr.out")
  base=$(jq -r .base "$EV_DIR/nd-pr.out")
  [[ "$state" == "open" && "$merged" == "false" ]] \
    || { fail "negatives-dev" "PR #$pr 非开放状态（$state/merged=$merged）——b/c 需在批准与合入之前运行"; exit 1; }
  [[ "$base" == "dev" ]] \
    || { fail "negatives-dev" "PR #$pr base=$base（应为 dev——dev 反例须指向 dev）"; exit 1; }
  # 前置：不得存在已批准评审（否则合入会成功）
  rc=0
  ev_run nd-reviews "$DEVENV" gh api "repos/$GHA_REPO/pulls/$pr/reviews" \
    --jq '[.[] | select(.state == "APPROVED")] | length' || rc=$?
  [[ "$(cat "$EV_DIR/nd-reviews.out")" == "0" ]] \
    || { fail "negatives-dev" "PR #$pr 已有批准——请先跑本阶段再批准（b/c 是无批准反例）"; exit 1; }

  local dev_before
  dev_before=$(remote_ref_sha dev) || { fail "negatives-dev" "读 dev HEAD 失败（fail closed）"; exit 1; }
  info "dev 基线 HEAD：${dev_before:0:8}"

  # a：App 直推 dev（新提交，FF）→ 应拒（PR 规则；对任何人成立，含 App）
  # 基线取远端 dev（fetch 后），与本地 dev 状态无关——确保被拒原因是规则而非 non-fast-forward
  local tmp; tmp=$(mktemp -d /tmp/devenv-bp73d.XXXXXX)
  git clone -q --no-local "$REPO_ROOT" "$tmp/repo"
  git -C "$tmp/repo" remote set-url origin "https://github.com/$GHA_REPO.git"
  git -C "$tmp/repo" fetch -q origin dev
  local odev; odev=$(git -C "$tmp/repo" rev-parse origin/dev)
  [[ "$odev" == "$dev_before" ]] \
    || { fail "negatives-dev" "fetch 后 origin/dev($odev) ≠ 基线($dev_before)——dev 在核对后移动，重跑本阶段"; rm -rf "$tmp"; exit 1; }
  git -C "$tmp/repo" checkout -q -B d FETCH_HEAD
  git -C "$tmp/repo" commit -q --allow-empty -m "test: #73 项 a——App 直推 dev 应拒（探针，不入库）"
  local psha; psha=$(git -C "$tmp/repo" rev-parse HEAD)
  rc=0
  ev_run push-a-dev "$tmp/repo/devenv/devenv" git-push origin "$psha:refs/heads/dev" || rc=$?
  expect_reject "项 a：App 直推 dev" "$rc" "$EV_DIR/push-a-dev.err" \
    || fail "项 a" "直推 dev 未被规则拦截"
  rm -rf "$tmp"

  # c：交付 PR（无批准）bypass_rules=true 异步合入 → 终态 failed
  local br=0
  attempt_bypass_merge_async "$pr" "c-async-dev" && br=0 || br=$?
  case "$br" in
    0) pass "项 c(dev)：App 以 bypass_rules=true 尝试合入 PR #$pr，异步终态 failed（被拒）" ;;
    1) fail "项 c(dev)" "App bypass 竟成功——绕过名单含 App（配置错误）" ;;
    *) fail "项 c(dev)" "无法判定（见 c-async-dev-* 证据）；以 b(dev) 同步拒绝为有效反例" ;;
  esac
  rc=0
  ev_run merge-b-dev "$DEVENV" gh pr merge "$pr" --squash || rc=$?
  expect_reject "项 b(dev)：App 无批准合入 PR #$pr" "$rc" "$EV_DIR/merge-b-dev.err" \
    || fail "项 b(dev)" "无批准竟可合入 PR #$pr"

  local dev_after
  dev_after=$(remote_ref_sha dev) || dev_after=""
  [[ -n "$dev_after" && "$dev_before" == "$dev_after" ]] \
    && pass "项 a/b/c 后 dev HEAD 未动（${dev_after:0:8}——无效验证零写入 dev）" \
    || fail "negatives-dev" "dev HEAD 变了或读取失败：$dev_before → $dev_after"

  human_next "项 f（人类步骤）：在 Web 编辑器打开 dev 上任一文件尝试直接提交（应被拒，提示走分支/PR）；结果记入 $EVIDENCE_DIR/human-actions.md。随后批准 PR #$pr 并运行：./devenv/devenv test:branch-protection g --pr $pr"
  [[ "$FAILURES" == 0 ]]
}

# ---------------------------------------------------------------------------
# g：批准后新推送使旧批准失效（项 g）
# ---------------------------------------------------------------------------
stage_g() {
  [[ -n "$PR_ARG" ]] || { echo "g 需要 --pr N（交付 PR 编号）" >&2; exit 2; }
  local pr="$PR_ARG" rc=0
  # 前置：PR 开放、base=dev、head 与当前分支一致（防止把空提交推错分支）
  ev_run g-pr "$DEVENV" gh api "repos/$GHA_REPO/pulls/$pr" \
    --jq '{state, base: .base.ref, head_ref: .head.ref}' || rc=$?
  [[ $rc == 0 ]] || { fail "项 g 前置" "PR #$pr 读取失败"; exit 1; }
  local pstate pbase head_ref
  pstate=$(jq -r .state "$EV_DIR/g-pr.out"); pbase=$(jq -r .base "$EV_DIR/g-pr.out")
  head_ref=$(jq -r .head_ref "$EV_DIR/g-pr.out")
  [[ "$pstate" == "open" && "$pbase" == "dev" ]] \
    || { fail "项 g 前置" "PR #$pr state=$pstate base=$pbase（须开放且指向 dev）"; exit 1; }
  local branch; branch=$(git -C "$REPO_ROOT" branch --show-current)
  [[ -n "$branch" && "$branch" != "dev" && "$branch" == "$head_ref" ]] \
    || { fail "项 g 前置" "当前分支=$branch，PR #$pr head=$head_ref（g 会向当前分支推空提交——切到 PR head 分支再跑，且不得是 dev）"; exit 1; }
  [[ -z "$(git -C "$REPO_ROOT" status --porcelain)" ]] \
    || { fail "项 g" "工作树不干净（先提交/贮藏再跑 g）"; exit 1; }

  # 前置：存在人类批准（记录评审 ID——新推送后按 ID 断言其状态变 DISMISSED）
  rc=0
  ev_run g-reviews0 "$DEVENV" gh api "repos/$GHA_REPO/pulls/$pr/reviews" \
    --jq '[.[] | select(.state == "APPROVED") | {id, user: .user.login}]' || rc=$?
  local approved_json approved_ids approvers
  approved_json=$(cat "$EV_DIR/g-reviews0.out")
  approved_ids=$(jq -c '[.[].id]' <<< "$approved_json")
  approvers=$(jq -r 'map(.user) | join(",")' <<< "$approved_json")
  [[ "$approvers" != "" && "$approvers" != "null" ]] \
    || { fail "项 g 前置" "PR #$pr 无批准（先由指挥者批准再跑 g）"; exit 1; }
  pass "项 g 前置：PR #$pr 已有批准（$approvers；评审 ID $approved_ids）"

  local dev_before
  dev_before=$(remote_ref_sha dev) || { fail "项 g" "读 dev HEAD 失败（fail closed）"; exit 1; }

  # 推新提交到 PR 分支（App 身份；本仓库当前分支即 PR head）
  git -C "$REPO_ROOT" commit -q --allow-empty -m "test: #73 项 g——批准后新推送（触发旧批准失效）"
  local nsha; nsha=$(git -C "$REPO_ROOT" rev-parse HEAD)
  rc=0
  ev_run g-push "$DEVENV" git-push origin "HEAD:refs/heads/$branch" || rc=$?
  [[ $rc == 0 ]] || { fail "项 g" "向 PR 分支 $branch 推送失败 rc=$rc"; exit 1; }
  pass "项 g：已向 PR #$pr 分支推新提交（${nsha:0:8}，App 身份——项 h）"

  # 旧批准（按评审 ID 绑定）应已 DISMISSED（dismiss_stale_reviews_on_push）
  # （gh api 的 --jq 不支持变量注入：原始响应落盘后本地 jq 处理）
  local dismissed=0 t0; t0=$(date +%s)
  local states=""
  while :; do
    if (( $(date +%s) - t0 > 120 )); then break; fi
    rc=0
    ev_run g-reviews1 "$DEVENV" gh api "repos/$GHA_REPO/pulls/$pr/reviews" || rc=$?
    if [[ $rc == 0 ]]; then
      states=$(jq -r --argjson ids "$approved_ids" \
        '[.[] | select(.id | IN($ids[])) | .state] | join(",")' "$EV_DIR/g-reviews1.out" 2>/dev/null || true)
      if [[ -n "$states" && "$states" != "null" && "$states" != *APPROVED* && "$states" == *DISMISSED* ]]; then
        dismissed=1; break
      fi
    fi
    sleep 10
  done
  if (( dismissed )); then
    pass "项 g：旧批准评审已因新推送失效（评审 $approved_ids → $states——合入的须是被看过的版本）"
  else
    fail "项 g" "新推送后未观察到既有批准评审转为 DISMISSED（dismiss_stale 未生效？）"
  fi

  # App 合入尝试 → 应拒（须重新批准）
  rc=0
  ev_run g-merge "$DEVENV" gh pr merge "$pr" --squash || rc=$?
  expect_reject "项 g：批准失效后 App 合入 PR #$pr" "$rc" "$EV_DIR/g-merge.err" \
    || fail "项 g" "批准失效后竟可合入——dismiss_stale 配置失效"

  local dev_after
  dev_after=$(remote_ref_sha dev) || dev_after=""
  [[ -n "$dev_after" && "$dev_before" == "$dev_after" ]] \
    && pass "项 g 全程 dev HEAD 未动（${dev_after:0:8}）" \
    || fail "项 g" "dev HEAD 读取失败或变化（$dev_before → $dev_after；若为合法合入属预期，否则为无效写入）"

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
    --jq '[.[] | {id, user: .user.login, state}]' || true
  info "PR #$pr 评审记录（合并时刻的状态快照）：$(cat "$EV_DIR/pa-reviews.out")"

  ev_run pa-timeline "$DEVENV" gh api "repos/$GHA_REPO/issues/$pr/timeline?per_page=100" \
    --jq '[.[] | {event, actor: (.actor.login // .user.login // null)}] | map(select(.event != null))' || true
  info "PR #$pr 时间线事件类型：$(jq -c 'map(.event) | unique' "$EV_DIR/pa-timeline.out" 2>/dev/null || echo '读取失败')"

  local lbl="pa-activity-$(label_of "$base")"
  # gh api 的 --jq 不支持 --arg 注入：base 值（分支名，安全字符集）shell 插值进过滤串
  ev_run "$lbl" "$DEVENV" gh api "repos/$GHA_REPO/activity?per_page=50" \
    --jq '[.[] | select(.ref == "refs/heads/'"$base"'" or .ref == null) | {activity_type, actor: .actor.login, after: (.after // null | if . then .[0:8] else null end), timestamp}]' || true
  info "仓库活动事件（含 refs/heads/$base）：$(cat "$EV_DIR/$lbl.out")"

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

  human_next "项 i（人类管理员步骤，读操作）：以指挥者本人身份读取 rule-suites 并保存到 $EVIDENCE_DIR/rule-suites-admin.txt——在本人登录态终端运行：gh api 'repos/$GHA_REPO/rulesets/rule-suites?rule_suite_result=bypass&time_period=month'（管理员读取为指挥者本人权限，非 agent 路径；或 Settings→Rules 的 insights 视图截图）。同时把 d'/e'/f' 的 UI 实况（按钮形态/拒绝提示原文）记入 $EVIDENCE_DIR/human-actions.md——验收只对已确认字段下结论，不预设审计位置/内容/保留期，不声称能区分冒用"
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

  local pr
  for pr in "$gpr" "$rpr"; do
    [[ -n "$pr" ]] || continue
    rc=0
    ev_run "close-$pr" "$DEVENV" gh pr close "$pr" || rc=$?
    [[ $rc == 0 ]] && pass "探针 PR #$pr 已关闭" || info "探针 PR #$pr 关闭失败（可能已合并/不存在）"
  done

  local tmp; tmp=$(mktemp -d /tmp/devenv-bp73c.XXXXXX)
  git clone -q --no-local "$REPO_ROOT" "$tmp/repo"
  git -C "$tmp/repo" remote set-url origin "https://github.com/$GHA_REPO.git"
  local b lbl
  for b in "$gbranch" "$rbranch" "$TEST_BRANCH"; do
    [[ -n "$b" ]] || continue
    lbl="del-$(label_of "$b")"
    rc=0
    ev_run "$lbl" "$tmp/repo/devenv/devenv" git-push origin ":refs/heads/$b" || rc=$?
    [[ $rc == 0 ]] && pass "分支 $b 已删除" \
      || fail "cleanup-test" "分支 $b 删除失败 rc=$rc：$(tail -2 "$EV_DIR/$lbl.err")"
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
    case "$l" in *"PASS: 项"*|*"FAIL: 项"*|*"PASS: verify-config"*|*"FAIL: verify-config"*) accept_lines+="$l"$'\n';; esac
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
    echo "c App 尝试绕过拒：negatives 项 c'/c'' + negatives-dev 项 c(dev) | d 指挥者绕过合入（绿）成功：人工 d' + probe-audit"
    echo "e 绕过但检查失败仍拒：人工 e'（红探针 PR 保持未合入即证据）| f 指挥者直推拒：人工 f'（测试分支）+ f（dev）"
    echo "g 批准后新推送失效：g 阶段（按评审 ID 绑定 DISMISSED）| h 默认身份=App：探针 PR/推送作者 + current_user_can_bypass=never"
    echo "i 人类绕过审计字段：probe-audit + rule-suites-admin.txt（管理员读）——只对已确认字段下结论"
    echo "无效验证零写入 dev：negatives-dev / g 的 dev HEAD 不动断言"
    echo "bypass 名单机械核对面：bypass_actors 仅规则集写权限者可见（实测）——App/CI 拆公开面（NOTE 提示），强校验为指挥者 --require-bypass-actors"
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
