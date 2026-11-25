#!/usr/bin/env bash
# ============================================================================
# 真实 GitHub 集成测试（访问 api.github.com / github.com）
#
# 用途：spec #23 验收项 10 的 j–m（issue #55）真实证据留存。
# 授权口径：写操作（评论 / 推送测试分支 / 私钥不可用演练）须由指挥者在每次
# 运行前显式授权；issue #55 的授权范围仅限本仓库验收项 10 j–m 所需的测试
# 评论与专用草稿分支推送，不构成对任意 issue / 任意写操作的默认授权。
#
# 默认只读：核实 App 身份、安装、仓库范围，以及 gh 入口确实以 App token 认证
# （匿名访问同一端点作对照，排除"公开仓库谁都能读"的假阳性）。
#
# 旗标：
#   --issue-comment N     在 issue N 发一条评论，按评论 ID 核验作者为 App bot
#   --push-test-branch    向 test/app-auth-push 强推一个测试提交（专用草稿分支，
#                         +refspec 覆盖使本测试可重入），按 after==本次 sha 核验推送者
#   --key-outage          临时使私钥不可用，验证 gh/git-push 双路径均以 21 失败
#                         （个人 gh 登录仍在），恢复后验证远端未产生回退推送
#   --sustained[=N]       持续运行验收（项 k）：操作 → 等待 N 秒（默认 3700，
#                         须 >3600 才作项 k 证据）→ 再操作，证明两次调用各自
#                         重新换取 token（哈希比对）且跨 token 生命周期仍成功
#   --evidence-dir PATH   证据目录（默认 .artifacts/auth-acceptance/<UTC 时间戳>，
#                         .artifacts/ 已 gitignore）
#
# 每次运行均记录：进程链（项 j 会话宿主证据）、全部命令与退出码；
# 结尾对证据目录与仓库工作树做泄露扫描（活 token 精确值 / ghs_ 形态 / PEM
# 标记，项 m），并输出 j–m 验收映射摘要。
# ============================================================================
set -Eeuo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TEST_DIR/../.." && pwd)"
DEVENV="$REPO_ROOT/devenv/devenv"
# shellcheck source=../lib/github-app-auth.sh
source "$REPO_ROOT/devenv/lib/github-app-auth.sh"
# shellcheck source=lib-evidence.sh
source "$TEST_DIR/lib-evidence.sh"

ISSUE=""; DO_PUSH=0; DO_OUTAGE=0; SUSTAINED=0; SUSTAINED_SECS=3700; EVIDENCE_DIR=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --issue-comment) [[ $# -ge 2 && "$2" != -* ]] || { echo "--issue-comment 需要 issue 编号" >&2; exit 2; }; ISSUE="$2"; shift 2 ;;
    --push-test-branch) DO_PUSH=1; shift ;;
    --key-outage) DO_OUTAGE=1; shift ;;
    --sustained) SUSTAINED=1; shift ;;
    --sustained=*) SUSTAINED=1; SUSTAINED_SECS="${1#--sustained=}"; shift ;;
    --evidence-dir) [[ $# -ge 2 && "$2" != -* ]] || { echo "--evidence-dir 需要路径" >&2; exit 2; }; EVIDENCE_DIR="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,30p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
done
[[ "$SUSTAINED_SECS" =~ ^[0-9]+$ ]] || { echo "--sustained 秒数须为整数：$SUSTAINED_SECS" >&2; exit 2; }

[[ -n "$EVIDENCE_DIR" ]] || EVIDENCE_DIR="$REPO_ROOT/.artifacts/auth-acceptance/$(date -u +%Y%m%dT%H%M%SZ)"
ev_init "$EVIDENCE_DIR"
ev_log "授权口径：写操作须指挥者每次运行前显式授权；issue #55 仅覆盖本仓库验收项 10 j–m 所需操作，不默认覆盖任意 issue/写操作"
ev_log "旗标：issue-comment=${ISSUE:-无} push=$DO_PUSH key-outage=$DO_OUTAGE sustained=$SUSTAINED(${SUSTAINED_SECS}s)"
ev_ancestry

FAILURES=0; PASS_COUNT=0
pass() { printf 'PASS: %s\n' "$1"; ev_log_file "PASS: $1"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { printf 'FAIL: %s —— %s\n' "$1" "$2"; ev_log_file "FAIL: $1 —— $2"; FAILURES=$((FAILURES + 1)); }
info() { printf '[integration] %s\n' "$1"; ev_log_file "$1"; }

# 验收映射（j–m），未运行的项保持「未覆盖」，摘要如实呈现
EV_J="未覆盖（需 --issue-comment 或 --push-test-branch）"
EV_K="未覆盖（需 --sustained）"
EV_L="未覆盖（需 --key-outage）"
EV_M="未覆盖"

EXPECTED_PERMISSIONS="actions:read checks:read contents:write issues:write metadata:read pull_requests:write security_events:read statuses:read"

# ---------------------------------------------------------------------------
# 只读部分
# ---------------------------------------------------------------------------
info "加载并校验 仓库声明 + 本机授权"
gha_load_config "$REPO_ROOT" || { fail "配置加载" "gha_load_config 失败"; exit 1; }
pass "配置匹配（app_id=$GHA_APP_ID slug=$GHA_APP_SLUG repo=$GHA_REPO）"

info "JWT → GET /app（核实 App 身份，只读；JWT 经 stdin 交 curl，不进 argv）"
jwt=$(gha_make_jwt)
app_json=$(printf 'Authorization: Bearer %s\n' "$jwt" | curl -sf -H @- \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" "$GHA_API/app") || { fail "GET /app" "请求失败"; exit 1; }
[[ "$(jq -r .id <<< "$app_json")" == "$GHA_APP_ID" && "$(jq -r .slug <<< "$app_json")" == "$GHA_APP_SLUG" ]] \
  && pass "App 身份核实（id/slug 一致）" || fail "App 身份" "id/slug 不符"

info "GET /repos/$GHA_REPO/installation（核实安装与权限，只读；JWT 经 stdin 交 curl）"
inst_json=$(printf 'Authorization: Bearer %s\n' "$jwt" | curl -sf -H @- \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" "$GHA_API/repos/$GHA_REPO/installation") \
  || { fail "installation 查询" "App 未安装到 $GHA_REPO 或查询失败"; exit 1; }
[[ "$(jq -r .app_id <<< "$inst_json")" == "$GHA_APP_ID" ]] \
  && pass "安装归属核实（installation_id=$(jq -r .id <<< "$inst_json")）" || fail "安装归属" "app_id 不符"
sel=$(jq -r .repository_selection <<< "$inst_json")
info "repository_selection=$sel（授权仓库范围以本机授权文件为准；token 按仓库限定换取）"
actual_perms=$(jq -r '.permissions | to_entries | map("\(.key):\(.value)") | sort | join(" ")' <<< "$inst_json")
expected_perms=$(tr ' ' '\n' <<< "$EXPECTED_PERMISSIONS" | sort | tr '\n' ' ' | sed 's/ $//')
[[ "$actual_perms" == "$expected_perms" ]] \
  && pass "已授予权限与预期一致" \
  || fail "权限差异" "实际：$actual_perms / 预期：$expected_perms（仅报告，不调整）"

info "对照：匿名访问 /installation/repositories（应 401/403，证明该端点必须认证）"
anon_code=$(curl -s -o /dev/null -w '%{http_code}' "$GHA_API/installation/repositories")
[[ "$anon_code" == "401" || "$anon_code" == "403" ]] \
  && pass "匿名对照被拒绝（HTTP $anon_code）" || fail "匿名对照" "HTTP $anon_code（端点行为异常）"

info "经 devenv gh 入口访问 /installation/repositories（验证 gh 路径以 App token 认证且限定仓库）"
rc=0; ev_run gh-repos "$DEVENV" gh api /installation/repositories \
  --jq '[.repositories[].full_name] | sort | join(" ")' || rc=$?
[[ $rc == 0 ]] && pass "gh 入口认证成功" || fail "gh 入口" "退出码 $rc：$(tail -1 "$EV_DIR/gh-repos.err")"
repos_json=$(cat "$EV_DIR/gh-repos.out")
[[ "$repos_json" == "$GHA_REPO" ]] \
  && pass "token 仓库范围限定为 $GHA_REPO" || fail "token 范围" "可见仓库：$repos_json"

# ---------------------------------------------------------------------------
# 写操作：issue 评论（项 j 证据之一；按评论 ID 绑定作者，杜绝假阳性）
# ---------------------------------------------------------------------------
if [[ -n "$ISSUE" ]]; then
  info "写操作：在 issue #$ISSUE 发测试评论（运行者须已获指挥者对该 issue 的显式授权）"
  body="认证入口集成测试评论（GitHub App 身份验证，可删除）。时间：$(date -Iseconds)"
  rc=0; ev_run comment "$DEVENV" gh issue comment "$ISSUE" --body "$body" || rc=$?
  if [[ $rc == 0 ]]; then
    pass "评论已发布"
    url=$(head -1 "$EV_DIR/comment.out")
    cid="${url##*#issuecomment-}"
    rc=0; ev_run comment-author "$DEVENV" gh api "repos/$GHA_REPO/issues/comments/$cid" --jq .user.login || rc=$?
    author=$(cat "$EV_DIR/comment-author.out")
    [[ $rc == 0 && "$author" == "$GHA_APP_SLUG[bot]" ]] \
      && pass "评论作者为 $author（App bot，按评论 ID $cid 绑定）" \
      || fail "评论作者" "实际：$author（rc=$rc）"
    ev_log "GitHub 侧证据：$url （作者 $author）"
    EV_J="评论 $url 作者 $author（App bot）；会话进程链见 evidence.log"
  else
    fail "评论发布" "退出码 $rc：$(tail -1 "$EV_DIR/comment.err")"
  fi
fi

# ---------------------------------------------------------------------------
# 写操作：推送测试分支（可重入：+refspec 覆盖专用草稿分支；
# 身份按 after==本次 sha 绑定，杜绝假阳性）
# ---------------------------------------------------------------------------
if [[ "$DO_PUSH" == 1 ]]; then
  info "写操作：向 test/app-auth-push 推送测试提交（运行者须已获指挥者显式授权）"
  tmp=$(mktemp -d /tmp/gha-push-test.XXXXXX)
  git clone -q --no-local --branch "$(git -C "$REPO_ROOT" branch --show-current)" --single-branch "$REPO_ROOT" "$tmp/repo"
  git -C "$tmp/repo" remote set-url origin "https://github.com/$GHA_REPO.git"
  git -C "$tmp/repo" checkout -q -b test/app-auth-push
  git -C "$tmp/repo" commit -q --allow-empty -m "test: GitHub App 认证入口推送验证（可删除）"
  sha_before=$(git -C "$tmp/repo" rev-parse HEAD)
  rc=0; ev_run push "$tmp/repo/devenv/devenv" git-push origin \
    "+test/app-auth-push:refs/heads/test/app-auth-push" || rc=$?
  [[ $rc == 0 ]] && pass "测试分支推送成功（commit ${sha_before:0:8}，+refspec 可重入覆盖）" \
    || fail "推送" "退出码 $rc：$(tail -2 "$EV_DIR/push.err")"
  # 推送身份证据：repository activity 的 actor，按 after==本次 sha 绑定
  # （commit author 不作数；events API 的 PushEvent 有延迟，activity 端点更及时；
  # +refspec 覆盖产生的活动类型是 force_push，首次创建是 branch_creation）
  actor=""
  for _ in 1 2 3 4 5 6; do
    actor=$("$DEVENV" gh api "repos/$GHA_REPO/activity?per_page=30" \
      --jq "[.[] | select((.activity_type==\"push\" or .activity_type==\"force_push\" or .activity_type==\"branch_creation\") and .ref==\"refs/heads/test/app-auth-push\" and .after==\"$sha_before\")] | last | .actor.login" 2>/dev/null || true)
    [[ -n "$actor" && "$actor" != "null" ]] && break
    sleep 5
  done
  rc=0; ev_run push-activity "$DEVENV" gh api "repos/$GHA_REPO/activity?per_page=30" \
    --jq "[.[] | select(.after==\"$sha_before\")] | last" || rc=$?
  [[ "$actor" == "$GHA_APP_SLUG[bot]" ]] \
    && pass "推送者身份为 $actor（App bot，activity actor 绑定 after=${sha_before:0:8}）" \
    || fail "推送身份" "实际：${actor:-未查到}"
  ev_log "GitHub 侧证据：refs/heads/test/app-auth-push @ $sha_before actor=$actor（push-activity.out）"
  [[ "$EV_J" == 未覆盖* ]] && EV_J="推送 after=$sha_before actor=$actor（App bot）；会话进程链见 evidence.log"
  rm -rf "$tmp"
  info "注意：远端草稿分支 test/app-auth-push 保留（下次运行 +refspec 覆盖），删除需另行确认"
fi

# ---------------------------------------------------------------------------
# 私钥不可用（项 l）：双路径均须以 21 失败（个人 gh 登录仍在），
# 恢复后验证远端未产生回退推送
# ---------------------------------------------------------------------------
if [[ "$DO_OUTAGE" == 1 ]]; then
  info "私钥不可用测试（将临时 chmod 000，随后恢复 600）"
  key="$GHA_KEY_PATH"
  chmod 000 "$key"
  restore() { chmod 600 "$key"; }
  trap restore EXIT

  # 项 l 摘要按真实断言组合：任一环节失败都记入 l_bad，摘要不得写通过
  l_bad=""
  rc=0; ev_run outage-personal gh api /user --jq .login || rc=$?
  personal=$(cat "$EV_DIR/outage-personal.out" 2>/dev/null || true)
  if [[ $rc == 0 && -n "$personal" ]]; then
    pass "前置成立：个人 gh 登录仍有效（$personal；命令与 rc 见 outage-personal）"
  else
    fail "前置" "无法证明个人账号在线（rc=$rc）——项 l「即使个人账号已登录」不成立"
    l_bad="${l_bad}个人登录未证明在线(rc=$rc)；"
  fi

  rc=0; ev_run outage-gh "$DEVENV" gh api /installation/repositories || rc=$?
  [[ $rc == 21 ]] && pass "私钥不可用时 gh 路径失败（rc=21）" \
    || { fail "gh 路径" "期望 rc=21，实际 $rc"; l_bad="${l_bad}gh 路径 rc=$rc（期望 21）；"; }
  rc=0; ev_run outage-push "$DEVENV" git-push origin HEAD:refs/heads/should-not-exist || rc=$?
  [[ $rc == 21 ]] && pass "私钥不可用时 git-push 路径失败（rc=21）" \
    || { fail "git-push 路径" "期望 rc=21，实际 $rc"; l_bad="${l_bad}git-push 路径 rc=$rc（期望 21）；"; }

  restore; trap - EXIT
  [[ "$(stat -c '%a' "$key")" == "600" ]] && pass "私钥权限已恢复 600" \
    || { fail "恢复" "权限异常"; l_bad="${l_bad}私钥权限恢复异常；"; }
  rc=0; ev_run outage-recover "$DEVENV" gh api /installation/repositories || rc=$?
  [[ $rc == 0 ]] && pass "恢复后 gh 路径正常" \
    || { fail "恢复后验证" "rc=$rc"; l_bad="${l_bad}恢复后 gh rc=$rc；"; }
  # 回退推送未发生：仅明确 HTTP 404 证明引用不存在；其他非零视为检查失败
  rc=0; ev_run outage-ref "$DEVENV" gh api "repos/$GHA_REPO/git/ref/heads/should-not-exist" || rc=$?
  if [[ $rc == 0 ]]; then
    fail "回退推送" "远端竟存在 should-not-exist 引用"
    l_bad="${l_bad}远端存在 should-not-exist 引用；"
  elif grep -q 'HTTP 404' "$EV_DIR/outage-ref.err"; then
    pass "远端无 should-not-exist 引用（HTTP 404 确认；私钥不可用期间无回退推送生效）"
  else
    fail "远端引用检查" "非 404 失败（rc=$rc）：$(tail -1 "$EV_DIR/outage-ref.err")——不能证明引用不存在"
    l_bad="${l_bad}远端引用检查失败(rc=$rc，非 404)；"
  fi
  if [[ -z "$l_bad" ]]; then
    EV_L="私钥 chmod 000 期间 gh/git-push 均 rc=21（个人登录 $personal 在线，命令与 rc 见 outage-personal）；恢复后远端无 should-not-exist 引用（HTTP 404 确认）"
  else
    EV_L="项 l 不通过：$l_bad"
  fi
fi

# ---------------------------------------------------------------------------
# 持续运行（项 k）：首次操作 → 等待（默认 3700s > token 1h 生命周期）→
# 再次操作仍成功。主证据：首次 token 已过 1h 生命周期，再次操作成功 ⟹
# 入口必然重新换取（复用旧 token 必然 401）；佐证：同一 mint 函数两次
# in-process 调用哈希不同（token 只存内存，证据只记哈希；每次调用重新
# 换取的结构性证明见离线测试 T11/T15）。
# ---------------------------------------------------------------------------
if [[ "$SUSTAINED" == 1 ]]; then
  info "持续运行验收：等待 ${SUSTAINED_SECS}s（token 生命周期 1h）"
  t0=$(date +%s)
  tok0=$(gha_mint_token) || { fail "项 k 首次换取 token" "gha_mint_token 失败"; exit 1; }
  h0=$(printf '%s' "$tok0" | sha256sum | awk '{print $1}')
  op0_rc=0; ev_run sustained-op0 "$DEVENV" gh api /installation/repositories \
    --jq '[.repositories[].full_name] | join(" ")' || op0_rc=$?
  [[ $op0_rc == 0 ]] && pass "项 k 首次操作成功（t0）" || fail "项 k 首次操作" "rc=$op0_rc"
  ev_log "项 k：t0=$(date -u -d "@$t0" +%Y-%m-%dT%H:%M:%SZ) token0 sha256=$h0"

  if [[ $op0_rc != 0 ]]; then
    EV_K="首次操作失败（rc=$op0_rc），项 k 不成立，跳过等待"
    info "项 k：首次操作失败，跳过 ${SUSTAINED_SECS}s 等待"
  else
    info "睡眠 ${SUSTAINED_SECS}s……"
    sleep "$SUSTAINED_SECS"

    op1_rc=0; ev_run sustained-op1 "$DEVENV" gh api /installation/repositories \
      --jq '[.repositories[].full_name] | join(" ")' || op1_rc=$?
    [[ $op1_rc == 0 ]] && pass "项 k 等待后再次操作成功（t1）" || fail "项 k 再次操作" "rc=$op1_rc"
    tok1=$(gha_mint_token) || { fail "项 k 再次换取 token" "gha_mint_token 失败"; exit 1; }
    h1=$(printf '%s' "$tok1" | sha256sum | awk '{print $1}')
    elapsed=$(( $(date +%s) - t0 ))
    ev_log "项 k：t1=$(date -u +%Y-%m-%dT%H:%M:%SZ) token1 sha256=$h1 elapsed=${elapsed}s"
    [[ "$h0" != "$h1" ]] && pass "mint 函数两次调用产生不同 token（佐证每次重新换取）" \
      || fail "token 比对" "两次哈希相同，疑似缓存复用"
    unset tok0 tok1
    if [[ $op1_rc == 0 && "$elapsed" -gt 3600 && "$h0" != "$h1" ]]; then
      EV_K="首次操作后 ${elapsed}s（>1h，跨过 token 生命周期）再次操作成功（复用旧 token 必然 401，成功即证明重新换取）；mint 函数两次调用哈希不同（${h0:0:12}… / ${h1:0:12}…）佐证"
    elif [[ "$elapsed" -le 3600 ]]; then
      EV_K="演练运行（${elapsed}s ≤ 1h），不作项 k 验收证据"
      info "项 k：等待 ${elapsed}s 未超过 1h，本次不作验收证据"
    else
      EV_K="再次操作失败或 token 比对异常（op1_rc=$op1_rc），项 k 不成立"
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 泄露扫描（项 m）：活 token 精确值 / ghs_ 形态 / PEM 标记，
# 范围 = 证据目录 + 仓库全部明文内容（含 .git 的 config/reflog 等）。
# 活 token 只经内存与 stdin（grep -f - / curl -H @-），不落盘、不进 argv。
# 顺序：初扫 → 写 summary.txt → 终扫覆盖 summary 与全部日志。
# ---------------------------------------------------------------------------
info "泄露扫描（项 m）：活 token 仅存内存，经 stdin 交 grep/curl，不落盘、不进 argv"
tok=$(gha_mint_token) || { fail "项 m 活 token 换取" "gha_mint_token 失败"; exit 1; }
if printf 'Authorization: Bearer %s\n' "$tok" | curl -sf -H @- \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" "$GHA_API/installation/repositories" >/dev/null; then
  info "活 token 已验证可用（仅内存持有）"
else
  fail "活 token 验证" "新换取 token 不可用"
fi
rc=0; ev_scan_paths "$tok" "$EV_DIR" "$REPO_ROOT" || rc=$?
unset tok
case "$rc" in
  0)
    pass "泄露扫描零命中（证据目录 + 仓库明文含 .git：无 token 精确值 / ghs_ 形态 / PEM 标记）"
    EV_M="初扫零命中（范围：证据目录 + 仓库明文含 .git config/reflog；活 token 仅经内存/stdin）；summary.txt 由终扫覆盖，结果见 evidence.log 末行" ;;
  1)
    fail "泄露扫描" "存在命中，见 evidence.log"
    EV_M="存在命中（见 evidence.log）——不通过" ;;
  *)
    fail "泄露扫描" "扫描失败（rc=$rc），不得视为通过；见 evidence.log 的 SCAN-ERROR"
    EV_M="扫描失败（rc=$rc）——不通过" ;;
esac

# ---------------------------------------------------------------------------
# 验收映射摘要（issue #55 / spec #23 项 10 j–m）
# ---------------------------------------------------------------------------
{
  echo "------------------------------------------------------------"
  echo "验收映射（issue #55 / spec #23 项 10 j–m）："
  echo "  j  IDE 插件入口操作者为 App bot：$EV_J"
  echo "     （会话宿主是否为正常启动的 IDE 插件，由指挥者据 evidence.log 进程链判定）"
  echo "  k  >1h 后操作仍成功且每次重新取令牌：$EV_K"
  echo "  l  私钥不可用时双路径失败不回退：$EV_L"
  echo "  m  输出/日志/仓库无 token 与私钥：$EV_M"
  echo "证据目录：$EV_DIR"
  echo "------------------------------------------------------------"
} | tee "$EV_DIR/summary.txt"

# 终扫（项 m）：覆盖 summary.txt 与此前全部证据内容；终扫结果行只含固定
# 字符串，不引入新的未扫描内容。扫描失败（rc>=2）不得视为通过。
rc=0; ev_scan_paths "-" "$EV_DIR" || rc=$?
case "$rc" in
  0) info "终扫零命中（覆盖 summary.txt 与全部证据文件）" ;;
  1) fail "终扫" "summary/日志存在命中，见 evidence.log" ;;
  *) fail "终扫" "扫描失败（rc=$rc），不得视为通过；见 evidence.log 的 SCAN-ERROR" ;;
esac

ev_log "集成测试完成：$PASS_COUNT 通过，$FAILURES 失败"
echo "集成测试完成：$PASS_COUNT 通过，$FAILURES 失败"
[[ "$FAILURES" == 0 ]]
