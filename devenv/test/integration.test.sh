#!/usr/bin/env bash
# ============================================================================
# 真实 GitHub 集成测试（访问 api.github.com / github.com）
#
# 默认只读：核实 App 身份、安装、仓库范围，以及 gh 入口确实以 App token 认证
# （匿名访问同一端点作对照，排除"公开仓库谁都能读"的假阳性）。
#
# 写操作需显式旗标（每次运行前应已获指挥者确认）：
#   --issue-comment N    在 issue N 发一条评论，并核验作者为 App bot
#   --push-test-branch   向 test/app-auth-push 推送一个测试提交，并核验推送者为 App bot
#   --key-outage         临时使私钥不可用，验证 gh/git-push 双路径均失败
#                        （个人 gh 登录仍在），随后自动恢复
# ============================================================================
set -Eeuo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TEST_DIR/../.." && pwd)"
DEVENV="$REPO_ROOT/devenv/devenv"
# shellcheck source=../lib/github-app-auth.sh
source "$REPO_ROOT/devenv/lib/github-app-auth.sh"

ISSUE=""; DO_PUSH=0; DO_OUTAGE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --issue-comment) ISSUE="${2:?--issue-comment 需要 issue 编号}"; shift 2 ;;
    --push-test-branch) DO_PUSH=1; shift ;;
    --key-outage) DO_OUTAGE=1; shift ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
done

FAILURES=0; PASS_COUNT=0
pass() { printf 'PASS: %s\n' "$1"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { printf 'FAIL: %s —— %s\n' "$1" "$2"; FAILURES=$((FAILURES + 1)); }
info() { printf '[integration] %s\n' "$1"; }

EXPECTED_PERMISSIONS="actions:read checks:read contents:write issues:write metadata:read pull_requests:write security_events:read statuses:read"

# ---------------------------------------------------------------------------
# 只读部分
# ---------------------------------------------------------------------------
info "加载并校验 仓库声明 + 本机授权"
gha_load_config "$REPO_ROOT" || { fail "配置加载" "gha_load_config 失败"; exit 1; }
pass "配置匹配（app_id=$GHA_APP_ID slug=$GHA_APP_SLUG repo=$GHA_REPO）"

info "JWT → GET /app（核实 App 身份，只读）"
jwt=$(gha_make_jwt)
app_json=$(curl -sf -H "Authorization: Bearer $jwt" -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" "$GHA_API/app") || { fail "GET /app" "请求失败"; exit 1; }
[[ "$(jq -r .id <<< "$app_json")" == "$GHA_APP_ID" && "$(jq -r .slug <<< "$app_json")" == "$GHA_APP_SLUG" ]] \
  && pass "App 身份核实（id/slug 一致）" || fail "App 身份" "id/slug 不符"

info "GET /repos/$GHA_REPO/installation（核实安装与权限，只读）"
inst_json=$(curl -sf -H "Authorization: Bearer $jwt" -H "Accept: application/vnd.github+json" \
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
set +e
repos_json=$("$DEVENV" gh api /installation/repositories --jq '[.repositories[].full_name] | sort | join(" ")' 2>"$REPO_ROOT/.git/gha-int.err")
rc=$?
set -e
[[ $rc == 0 ]] && pass "gh 入口认证成功" || fail "gh 入口" "退出码 $rc：$(tail -1 "$REPO_ROOT/.git/gha-int.err")"
[[ "$repos_json" == "$GHA_REPO" ]] \
  && pass "token 仓库范围限定为 $GHA_REPO" || fail "token 范围" "可见仓库：$repos_json"
rm -f "$REPO_ROOT/.git/gha-int.err"

# ---------------------------------------------------------------------------
# 写操作：issue 评论
# ---------------------------------------------------------------------------
if [[ -n "$ISSUE" ]]; then
  info "写操作：在 issue #$ISSUE 发测试评论（已获指挥者确认）"
  body="认证入口集成测试评论（GitHub App 身份验证，可删除）。时间：$(date -Iseconds)"
  "$DEVENV" gh issue comment "$ISSUE" --body "$body" >/dev/null \
    && pass "评论已发布" || fail "评论发布" "gh issue comment 失败"
  author=$("$DEVENV" gh api "repos/$GHA_REPO/issues/$ISSUE/comments" \
    --jq "[.[] | select(.body | startswith(\"认证入口集成测试评论\"))] | last | .user.login")
  [[ "$author" == "$GHA_APP_SLUG[bot]" ]] \
    && pass "评论作者为 $author（App bot）" || fail "评论作者" "实际：$author"
fi

# ---------------------------------------------------------------------------
# 写操作：推送测试分支
# ---------------------------------------------------------------------------
if [[ "$DO_PUSH" == 1 ]]; then
  info "写操作：向 test/app-auth-push 推送测试提交（已获指挥者确认）"
  tmp=$(mktemp -d /tmp/gha-push-test.XXXXXX)
  git clone -q --no-local --branch "$(git -C "$REPO_ROOT" branch --show-current)" --single-branch "$REPO_ROOT" "$tmp/repo"
  git -C "$tmp/repo" remote set-url origin "https://github.com/$GHA_REPO.git"
  git -C "$tmp/repo" checkout -q -b test/app-auth-push
  git -C "$tmp/repo" commit -q --allow-empty -m "test: GitHub App 认证入口推送验证（可删除）"
  sha_before=$(git -C "$tmp/repo" rev-parse HEAD)
  set +e
  "$tmp/repo/devenv/devenv" git-push origin test/app-auth-push > "$tmp/push.out" 2> "$tmp/push.err"
  rc=$?
  set -e
  [[ $rc == 0 ]] && pass "测试分支推送成功（commit ${sha_before:0:8}）" \
    || fail "推送" "退出码 $rc：$(tail -2 "$tmp/push.err")"
  # 推送身份证据：repository activity 的 actor（commit author 不作数；
  # events API 的 PushEvent 有延迟，activity 端点更及时）
  actor=""
  for _ in 1 2 3 4 5 6; do
    actor=$("$DEVENV" gh api "repos/$GHA_REPO/activity?per_page=20" \
      --jq '[.[] | select((.activity_type=="push" or .activity_type=="branch_creation") and .ref=="refs/heads/test/app-auth-push")] | last | .actor.login' 2>/dev/null || true)
    [[ -n "$actor" && "$actor" != "null" ]] && break
    sleep 5
  done
  [[ "$actor" == "$GHA_APP_SLUG[bot]" ]] \
    && pass "推送者身份为 $actor（App bot，activity actor）" || fail "推送身份" "实际：${actor:-未查到}"
  rm -rf "$tmp"
  info "注意：远端测试分支 test/app-auth-push 的删除需另行确认"
fi

# ---------------------------------------------------------------------------
# 私钥不可用：双路径均失败（个人 gh 登录仍在），随后恢复
# ---------------------------------------------------------------------------
if [[ "$DO_OUTAGE" == 1 ]]; then
  info "私钥不可用测试（将临时 chmod 000，随后恢复 600）"
  key="$GHA_KEY_PATH"
  chmod 000 "$key"
  restore() { chmod 600 "$key"; }
  trap restore EXIT

  personal=$(gh api /user --jq .login 2>/dev/null || echo "<失败>")
  [[ "$personal" == "bbhl79" ]] && pass "对照：个人 gh 登录仍有效（$personal）" \
    || info "对照：个人 gh 登录状态：$personal"

  set +e
  "$DEVENV" gh api /installation/repositories >/dev/null 2>&1; rc_gh=$?
  "$DEVENV" git-push origin HEAD:refs/heads/should-not-exist >/dev/null 2>&1; rc_push=$?
  set -e
  [[ $rc_gh != 0 ]] && pass "私钥不可用时 gh 路径失败（rc=$rc_gh）" || fail "gh 路径" "竟然成功"
  [[ $rc_push != 0 ]] && pass "私钥不可用时 git-push 路径失败（rc=$rc_push）" || fail "git-push 路径" "竟然成功"

  restore; trap - EXIT
  [[ "$(stat -c '%a' "$key")" == "600" ]] && pass "私钥权限已恢复 600" || fail "恢复" "权限异常"
  set +e
  "$DEVENV" gh api /installation/repositories >/dev/null 2>&1; rc_after=$?
  set -e
  [[ $rc_after == 0 ]] && pass "恢复后 gh 路径正常" || fail "恢复后验证" "rc=$rc_after"
fi

# ---------------------------------------------------------------------------
echo "------------------------------------------------------------"
echo "集成测试完成：$PASS_COUNT 通过，$FAILURES 失败"
[[ "$FAILURES" == 0 ]]
