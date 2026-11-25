#!/usr/bin/env bash
# ============================================================================
# 离线测试：GitHub App 认证入口（不访问 GitHub；curl/gh/push 全部 mock）
#
# 覆盖：
#   1. 仓库声明与本机授权不匹配（app_id 不符 / 仓库不在允许清单）→ 拒绝
#   2. 私钥缺失 / 签名失败 / GitHub 错误 / 超时 → 非零退出且不执行目标操作
#   3. 继承的个人 GH_TOKEN/GITHUB_TOKEN/GH_CONFIG_DIR 不被兜底使用
#   4. 换取 token 的请求体显式限定目标仓库
#   5. 连续与并发调用各自持有独立 token，不串用、不依赖启动时注入的旧 token
#   6. gh 与 git-push 两条路径分别测试
#   7. 虚构 token 不出现在 stdout/stderr/日志/临时文件
# ============================================================================
set -Eeuo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TEST_DIR/../.." && pwd)"
# shellcheck source=lib-evidence.sh
source "$TEST_DIR/lib-evidence.sh"

FAILURES=0
PASS_COUNT=0
pass() { printf 'PASS: %s\n' "$1"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { printf 'FAIL: %s —— %s\n' "$1" "$2"; FAILURES=$((FAILURES + 1)); }

# ---------------------------------------------------------------------------
# mock 工具
# ---------------------------------------------------------------------------
write_mocks() {
  cat > "$SANDBOX/stubbin/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
body=""; prev=""
for a in "$@"; do
  [[ "$prev" == "-d" ]] && body="$a"
  prev="$a"
done
printf '%s\n' "$body" >> "${MOCK_CURL_BODIES:?}"
case "${MOCK_CURL_MODE:-ok}" in
  fail)    exit 22 ;;
  timeout) exit 28 ;;
esac
exec 9>>"${MOCK_CURL_COUNTER:?}.lock"
flock 9
n=$(( $(cat "$MOCK_CURL_COUNTER" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "$MOCK_CURL_COUNTER"
flock -u 9
printf '{"token":"FAKETOKEN_%s","expires_at":"2026-11-24T16:00:00Z","permissions":{"contents":"write"}}\n' "$n"
EOF

  cat > "$SANDBOX/stubbin/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
log="${MOCK_GH_LOG_DIR:?}/gh.$$.log"
{
  echo "args: $*"
  echo "GH_TOKEN_SHA256: $(printf '%s' "${GH_TOKEN:-}" | sha256sum | awk '{print $1}')"
  echo "GITHUB_TOKEN: ${GITHUB_TOKEN:+SET}"
  echo "GH_CONFIG_DIR: ${GH_CONFIG_DIR:+SET}"
  echo "GH_HOST: ${GH_HOST:+SET}"
} > "$log"
exit 0
EOF

  # mock git：非 push 操作委派给真 git；push 只模拟 credential 协商并记录证据。
  cat > "$SANDBOX/stubbin/git" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
REAL_GIT=/usr/bin/git
is_push=0
for a in "$@"; do [[ "$a" == "push" ]] && is_push=1; done
[[ "$is_push" == 0 ]] && exec "$REAL_GIT" "$@"
{
  echo "PUSH_ARGS: $*"
  echo "GIT_TERMINAL_PROMPT=${GIT_TERMINAL_PROMPT:-<unset>}"
  echo "GH_TOKEN=${GH_TOKEN:+SET}"
  echo "GITHUB_TOKEN=${GITHUB_TOKEN:+SET}"
  echo "GH_APP_INSTALLATION_TOKEN_SHA256: $(printf '%s' "${GH_APP_INSTALLATION_TOKEN:-}" | sha256sum | awk '{print $1}')"
} >> "${MOCK_GIT_LOG:?}"
helper=""
for a in "$@"; do
  case "$a" in credential.https://github.com.helper=\!*) helper="${a#credential.https://github.com.helper=}" ;; esac
done
[[ -n "$helper" ]] || { echo "NO_CRED_HELPER_OVERRIDE" >> "$MOCK_GIT_LOG"; exit 1; }
out=$(eval "${helper#!}" get <<< $'protocol=https\nhost=github.com\n')
pw=$(printf '%s\n' "$out" | sed -n 's/^password=//p')
echo "HELPER_PASSWORD_SHA256: $(printf '%s' "$pw" | sha256sum | awk '{print $1}')" >> "$MOCK_GIT_LOG"
echo "PUSH_SIMULATED_OK" >> "$MOCK_GIT_LOG"
exit 0
EOF
  chmod +x "$SANDBOX/stubbin/"*
}

write_authz() { # write_authz <app_id> <key_path> <allowed_repo>
  cat > "$SANDBOX/authorization.json" <<EOF
{"app_id":$1,"app_slug":"bbhl79-agent","installation_id":185275262,
 "private_key_path":"$2","allowed_repositories":["$3"]}
EOF
}

# ---------------------------------------------------------------------------
# 沙箱：复制 devenv 脚本到临时 git 仓库，配一次性 RSA 测试密钥
# ---------------------------------------------------------------------------
setup() {
  SANDBOX=$(mktemp -d /tmp/gha-offline-test.XXXXXX)
  OUT="$SANDBOX/out"
  mkdir -p "$SANDBOX/stubbin" "$SANDBOX/ghlogs" "$OUT"
  cp -r "$REPO_ROOT/devenv" "$SANDBOX/devenv"
  git init -q "$SANDBOX"
  git -C "$SANDBOX" remote add origin "https://github.com/bbhl79/natural-enforcement-prj.git"
  openssl genrsa -out "$SANDBOX/test-key.pem" 2048 2>/dev/null
  chmod 600 "$SANDBOX/test-key.pem"
  write_authz 5899686 "$SANDBOX/test-key.pem" "bbhl79/natural-enforcement-prj"
  write_mocks

  export GHA_AUTHZ_FILE="$SANDBOX/authorization.json"
  export PATH="$SANDBOX/stubbin:$PATH"
  export MOCK_CURL_BODIES="$SANDBOX/curl-bodies.log"
  export MOCK_CURL_COUNTER="$SANDBOX/curl-counter"
  export MOCK_GH_LOG_DIR="$SANDBOX/ghlogs"
  export MOCK_GIT_LOG="$SANDBOX/git.log"
  DEVENV="$SANDBOX/devenv/devenv"

  [[ "$(command -v curl)" == "$SANDBOX/stubbin/curl" ]] || { echo "mock curl 未生效"; exit 1; }
  [[ "$(command -v gh)" == "$SANDBOX/stubbin/gh" ]] || { echo "mock gh 未生效"; exit 1; }
}

reset_mocks() {
  rm -f "$MOCK_CURL_BODIES" "$MOCK_CURL_COUNTER" "$MOCK_CURL_COUNTER.lock" "$MOCK_GIT_LOG"
  rm -rf "$MOCK_GH_LOG_DIR"; mkdir -p "$MOCK_GH_LOG_DIR"
}

# 运行入口并记录 RC；输出进 $OUT/<name>.{out,err}
run() {
  local name="$1"; shift
  set +e
  "$@" > "$OUT/$name.out" 2> "$OUT/$name.err"
  RC=$?
  set -e
}

expect_rc() { [[ "$RC" == "$2" ]] && pass "$1" || fail "$1" "期望退出码 $2，实际 $RC（stderr: $(tail -1 "$OUT/$3.err" 2>/dev/null)）"; }
sha() { printf '%s' "$1" | sha256sum | awk '{print $1}'; }
no_gh_called() { [[ -z "$(ls -A "$MOCK_GH_LOG_DIR")" ]] && pass "$1" || fail "$1" "gh 被执行了"; }
no_curl_called() { [[ ! -f "$MOCK_CURL_COUNTER" ]] && pass "$1" || fail "$1" "curl 被调用了"; }

# ---------------------------------------------------------------------------
setup
trap 'rm -rf "$SANDBOX"' EXIT
echo "沙箱：$SANDBOX"

# T1 授权 app_id 不符 → 20，不执行 gh
reset_mocks
write_authz 9999999 "$SANDBOX/test-key.pem" "bbhl79/natural-enforcement-prj"
run t1 "$DEVENV" gh api /user
expect_rc "T1 app_id 不符拒绝" 20 t1
no_gh_called "T1 未执行 gh"

# T2 仓库不在本机授权清单 → 23
reset_mocks
write_authz 5899686 "$SANDBOX/test-key.pem" "bbhl79/other-repo"
run t2 "$DEVENV" gh api /user
expect_rc "T2 仓库未授权拒绝" 23 t2
no_gh_called "T2 未执行 gh"

# T2b 仓库声明被分支篡改（声明指向别的仓库）→ 拒绝
reset_mocks
write_authz 5899686 "$SANDBOX/test-key.pem" "bbhl79/natural-enforcement-prj"
jq '.repositories = ["bbhl79/other-repo"]' "$SANDBOX/devenv/github-app.json" > "$SANDBOX/tmp.json" && mv "$SANDBOX/tmp.json" "$SANDBOX/devenv/github-app.json"
run t2b "$DEVENV" gh api /user
expect_rc "T2b 声明被篡改拒绝" 23 t2b
no_gh_called "T2b 未执行 gh"
jq '.repositories = ["bbhl79/natural-enforcement-prj"]' "$SANDBOX/devenv/github-app.json" > "$SANDBOX/tmp.json" && mv "$SANDBOX/tmp.json" "$SANDBOX/devenv/github-app.json"

# T3 私钥缺失 → 21，不换取 token
reset_mocks
write_authz 5899686 "$SANDBOX/no-such-key.pem" "bbhl79/natural-enforcement-prj"
run t3 "$DEVENV" gh api /user
expect_rc "T3 私钥缺失" 21 t3
no_curl_called "T3 未请求 token"
no_gh_called "T3 未执行 gh"

# T4 私钥损坏（签名失败）→ 21
reset_mocks
echo "not a private key" > "$SANDBOX/bad-key.pem"; chmod 600 "$SANDBOX/bad-key.pem"
write_authz 5899686 "$SANDBOX/bad-key.pem" "bbhl79/natural-enforcement-prj"
run t4 "$DEVENV" gh api /user
expect_rc "T4 签名失败" 21 t4
no_gh_called "T4 未执行 gh"

# T4b 私钥权限过宽 → 21
reset_mocks
chmod 644 "$SANDBOX/test-key.pem"
write_authz 5899686 "$SANDBOX/test-key.pem" "bbhl79/natural-enforcement-prj"
run t4b "$DEVENV" gh api /user
expect_rc "T4b 私钥权限 644 拒绝" 21 t4b
chmod 600 "$SANDBOX/test-key.pem"

# T5 GitHub 返回错误 → 22，不执行 gh
reset_mocks
write_authz 5899686 "$SANDBOX/test-key.pem" "bbhl79/natural-enforcement-prj"
MOCK_CURL_MODE=fail run t5 "$DEVENV" gh api /user
expect_rc "T5 GitHub 错误" 22 t5
no_gh_called "T5 未执行 gh"

# T6 网络超时 → 22
reset_mocks
MOCK_CURL_MODE=timeout run t6 "$DEVENV" gh api /user
expect_rc "T6 超时" 22 t6
no_gh_called "T6 未执行 gh"

# T7 继承的个人凭据变量不被兜底
reset_mocks
export GITHUB_TOKEN="personal-gho-fake" GH_TOKEN="personal-gho-fake2" GH_CONFIG_DIR="/tmp/fake-gh-config"
run t7 "$DEVENV" gh api /user
expect_rc "T7 gh 路径成功" 0 t7
ghlog=$(cat "$MOCK_GH_LOG_DIR"/gh.*.log)
[[ "$(grep 'GH_TOKEN_SHA256:' <<< "$ghlog" | awk '{print $2}')" == "$(sha FAKETOKEN_1)" ]] \
  && pass "T7 子进程 GH_TOKEN 是 App token" || fail "T7" "GH_TOKEN 不是本次 App token"
[[ -z "$(grep 'GITHUB_TOKEN:' <<< "$ghlog" | awk '{print $2}')" ]] \
  && pass "T7 个人 GITHUB_TOKEN 已排除" || fail "T7" "GITHUB_TOKEN 泄漏进子进程"
[[ -z "$(grep 'GH_CONFIG_DIR:' <<< "$ghlog" | awk '{print $2}')" ]] \
  && pass "T7 GH_CONFIG_DIR 已排除" || fail "T7" "GH_CONFIG_DIR 泄漏进子进程"
unset GITHUB_TOKEN GH_TOKEN GH_CONFIG_DIR

# T8 换取 token 的请求体显式限定目标仓库
body=$(tail -1 "$MOCK_CURL_BODIES")
[[ "$body" == '{"repositories":["natural-enforcement-prj"]}' ]] \
  && pass "T8 请求体限定目标仓库" || fail "T8" "请求体异常：$body"

# T9 拒绝 gh auth 系列
reset_mocks
run t9 "$DEVENV" gh auth status
expect_rc "T9 拒绝 gh auth" 2 t9
no_curl_called "T9 未换取 token"
no_gh_called "T9 未执行 gh"

# T10 -R/--repo 指向未授权仓库 → 23；指向授权仓库 → 放行
reset_mocks
run t10a "$DEVENV" gh issue list -R bbhl79/other-repo
expect_rc "T10 -R 未授权仓库拒绝" 23 t10a
no_gh_called "T10 未执行 gh"
run t10b "$DEVENV" gh issue list --repo=bbhl79/other-repo
expect_rc "T10 --repo= 未授权拒绝" 23 t10b
run t10c "$DEVENV" gh issue list -R bbhl79/natural-enforcement-prj
expect_rc "T10 -R 授权仓库放行" 0 t10c

# T11 并发 8 路：各自独立 token，互不串用
reset_mocks
for i in 1 2 3 4 5 6 7 8; do
  "$DEVENV" gh api "/marker/$i" > "$OUT/t11.$i.out" 2> "$OUT/t11.$i.err" &
done
wait
logs=( "$MOCK_GH_LOG_DIR"/gh.*.log )
[[ "${#logs[@]}" == 8 ]] && pass "T11 8 路全部执行" || fail "T11" "gh 日志数 ${#logs[@]} != 8"
distinct=$(grep -h 'GH_TOKEN_SHA256:' "${logs[@]}" | awk '{print $2}' | sort -u | wc -l)
[[ "$distinct" == 8 ]] && pass "T11 8 个 token 互不相同" || fail "T11" "distinct=$distinct"
expected=$(for n in 1 2 3 4 5 6 7 8; do sha "FAKETOKEN_$n"; done | sort)
actual=$(grep -h 'GH_TOKEN_SHA256:' "${logs[@]}" | awk '{print $2}' | sort)
[[ "$actual" == "$expected" ]] && pass "T11 token 均来自本次换取" || fail "T11" "token 集合不符"
for i in 1 2 3 4 5 6 7 8; do
  grep -q "args: api /marker/$i" "${logs[@]}" || fail "T11" "marker $i 缺失"
done
pass "T11 每个并发调用参数完整"

# T12 git-push 成功路径：credential 覆盖、禁交互、helper 提供 App token
reset_mocks
run t12 "$DEVENV" git-push origin HEAD:refs/heads/test-x
expect_rc "T12 git-push 成功" 0 t12
grep -q 'GIT_TERMINAL_PROMPT=0' "$MOCK_GIT_LOG" && pass "T12 交互提示已禁用" || fail "T12" "GIT_TERMINAL_PROMPT 未禁用"
grep -q '^GH_TOKEN=$' "$MOCK_GIT_LOG" && pass "T12 GH_TOKEN 未传入 git" || fail "T12" "GH_TOKEN 传入 git"
grep -q '^GITHUB_TOKEN=$' "$MOCK_GIT_LOG" && pass "T12 GITHUB_TOKEN 未传入 git" || fail "T12" "GITHUB_TOKEN 传入 git"
[[ "$(grep 'HELPER_PASSWORD_SHA256:' "$MOCK_GIT_LOG" | awk '{print $2}')" == "$(sha FAKETOKEN_1)" ]] \
  && pass "T12 helper 提供 App token" || fail "T12" "helper token 不符"
[[ "$(grep 'GH_APP_INSTALLATION_TOKEN_SHA256:' "$MOCK_GIT_LOG" | awk '{print $2}')" == "$(sha FAKETOKEN_1)" ]] \
  && pass "T12 环境 token 与 helper 一致" || fail "T12" "环境 token 不符"
grep -q 'PUSH_ARGS: .*push origin HEAD:refs/heads/test-x' "$MOCK_GIT_LOG" \
  && pass "T12 push 参数正确" || fail "T12" "push 参数异常"
grep -q 'FAKETOKEN' "$MOCK_GIT_LOG" && fail "T12" "token 出现在 git 参数/日志" || pass "T12 token 不在 git 参数与日志"
grep -q 'credential.helper= -c credential.https://github.com.helper= -c ' "$MOCK_GIT_LOG" \
  && pass "T12 credential helper 继承已清空并替换" || fail "T12" "credential helper 覆盖链不完整"

# T13 push URL 指向未授权仓库 → 23，不执行 push
reset_mocks
git -C "$SANDBOX" remote set-url --push origin "https://github.com/bbhl79/other-repo.git"
run t13 "$DEVENV" git-push origin HEAD:refs/heads/test-x
expect_rc "T13 未授权 push URL 拒绝" 23 t13
[[ ! -f "$MOCK_GIT_LOG" ]] && pass "T13 未执行 push" || fail "T13" "push 被执行"
git -C "$SANDBOX" remote set-url --push origin "https://github.com/bbhl79/natural-enforcement-prj.git"

# T14 拒绝把 URL 当 remote 参数
reset_mocks
run t14 "$DEVENV" git-push "https://github.com/bbhl79/natural-enforcement-prj.git" main
[[ "$RC" != 0 ]] && pass "T14 URL 参数拒绝（rc=$RC）" || fail "T14" "URL 参数被接受"
[[ ! -f "$MOCK_GIT_LOG" ]] && pass "T14 未执行 push" || fail "T14" "push 被执行"

# T15 启动时注入的旧 token 不被沿用（每次重新换取）
reset_mocks
export GH_APP_INSTALLATION_TOKEN="STALE_TOKEN_FROM_STARTUP"
run t15 "$DEVENV" git-push origin HEAD:refs/heads/test-y
expect_rc "T15 git-push 成功" 0 t15
[[ "$(grep 'HELPER_PASSWORD_SHA256:' "$MOCK_GIT_LOG" | awk '{print $2}')" == "$(sha FAKETOKEN_1)" ]] \
  && pass "T15 旧 token 被忽略，使用新换取 token" || fail "T15" "沿用了启动时 token"
unset GH_APP_INSTALLATION_TOKEN

# T16 SSH push URL 必须被拒（exit 23，不回退个人 SSH 密钥）
reset_mocks
git -C "$SANDBOX" remote set-url --push origin "git@github.com:bbhl79/natural-enforcement-prj.git"
run t16a "$DEVENV" git-push origin HEAD:refs/heads/test-z
expect_rc "T16 scp 式 SSH URL 拒绝" 23 t16a
[[ ! -f "$MOCK_GIT_LOG" ]] && pass "T16 SSH 未执行 push" || fail "T16" "push 被执行"
grep -q 'HTTPS' "$OUT/t16a.err" && pass "T16 提示改用 HTTPS remote" || fail "T16" "缺少 HTTPS 提示"

git -C "$SANDBOX" remote set-url --push origin "ssh://git@github.com/bbhl79/natural-enforcement-prj.git"
run t16b "$DEVENV" git-push origin HEAD:refs/heads/test-z
expect_rc "T16 ssh:// URL 拒绝" 23 t16b
git -C "$SANDBOX" remote set-url --push origin "https://github.com/bbhl79/natural-enforcement-prj.git"

# T17 insteadOf / pushInsteadOf 把 HTTPS 改写成 SSH 后，按实际推送地址拒绝
reset_mocks
git -C "$SANDBOX" config url."git@github.com:".insteadOf "https://github.com/"
run t17a "$DEVENV" git-push origin HEAD:refs/heads/test-z
expect_rc "T17 insteadOf 改写为 SSH 拒绝" 23 t17a
[[ ! -f "$MOCK_GIT_LOG" ]] && pass "T17 insteadOf 未执行 push" || fail "T17" "push 被执行"
git -C "$SANDBOX" config --unset url."git@github.com:".insteadOf

# pushInsteadOf 不改写显式 pushurl（git 语义），先移除 T16 留下的显式 pushurl，
# 使推送地址回到 url 派生，pushInsteadOf 才会生效
git -C "$SANDBOX" config --unset remote.origin.pushurl
git -C "$SANDBOX" config url."git@github.com:".pushInsteadOf "https://github.com/"
run t17b "$DEVENV" git-push origin HEAD:refs/heads/test-z
expect_rc "T17 pushInsteadOf 改写为 SSH 拒绝" 23 t17b
[[ ! -f "$MOCK_GIT_LOG" ]] && pass "T17 pushInsteadOf 未执行 push" || fail "T17" "push 被执行"
git -C "$SANDBOX" config --unset url."git@github.com:".pushInsteadOf
git -C "$SANDBOX" remote set-url --push origin "https://github.com/bbhl79/natural-enforcement-prj.git"

# T18 泄露扫描：虚构 token 与测试私钥不出现在任何输出/日志/临时文件
leak=$(grep -rl 'FAKETOKEN\|STALE_TOKEN\|PRIVATE KEY' "$OUT" "$MOCK_GH_LOG_DIR" \
        "$MOCK_GIT_LOG" "$MOCK_CURL_BODIES" 2>/dev/null || true)
[[ -z "$leak" ]] && pass "T18 输出/日志/临时文件无 token 与私钥泄露" || fail "T18" "泄露于：$leak"

# ---------------------------------------------------------------------------
# 证据助手（devenv/test/lib-evidence.sh，供集成测试留存验收证据）
# ---------------------------------------------------------------------------

# T19 ev_run：记录命令文本与退出码，捕获 stdout/stderr，返回命令退出码
ev_init "$SANDBOX/evidence"
set +e
ev_run demo bash -c 'echo out-line; echo err-line >&2; exit 3'
rc=$?
set -e
[[ "$rc" == 3 ]] && pass "T19 ev_run 透传退出码" || fail "T19" "rc=$rc"
[[ "$(cat "$SANDBOX/evidence/demo.out")" == "out-line" && "$(cat "$SANDBOX/evidence/demo.err")" == "err-line" ]] \
  && pass "T19 stdout/stderr 分别捕获" || fail "T19" "捕获内容不符"
grep -q 'cmd\[demo\]: bash -c .* → rc=3' "$SANDBOX/evidence/evidence.log" \
  && pass "T19 证据日志含命令与退出码" || fail "T19" "evidence.log 缺少命令记录"

# T20 ev_scan_paths：活 token 精确值可被检出（token 经 stdin 传递，不落盘）
mkdir -p "$SANDBOX/scan-clean" "$SANDBOX/scan-leak"
echo "ordinary log line, no secrets" > "$SANDBOX/scan-clean/a.log"
echo "oops token=FAKETOKEN_LEAKED_123" > "$SANDBOX/scan-leak/b.log"
set +e
ev_scan_paths "FAKETOKEN_LEAKED_123" "$SANDBOX/scan-leak" >/dev/null 2>&1; rc=$?
set -e
[[ "$rc" == 1 ]] && pass "T20 活 token 精确值检出" || fail "T20" "rc=$rc（期望 1）"

# T21 installation token 通用形态（ghs_ 前缀）检出；字面量拼接构造，本文件不含可命中串
fake_tok="gh""s_$(printf 'F%.0s' {1..30})"
echo "leaked: $fake_tok" > "$SANDBOX/scan-leak/c.log"
set +e
ev_scan_paths "-" "$SANDBOX/scan-leak" >/dev/null 2>&1; rc=$?
set -e
[[ "$rc" == 1 ]] && pass "T21 ghs_ 形态检出" || fail "T21" "rc=$rc（期望 1）"
grep -q "LEAK: installation token" "$SANDBOX/evidence/evidence.log" \
  && pass "T21 命中写入证据日志" || fail "T21" "证据日志缺命中记录"

# T22 PEM 私钥标记检出（字面量拼接构造）
echo "-----BEGIN RSA PRIVATE"" KEY-----" > "$SANDBOX/scan-leak/d.pem"
set +e
ev_scan_paths "-" "$SANDBOX/scan-leak" >/dev/null 2>&1; rc=$?
set -e
[[ "$rc" == 1 ]] && pass "T22 PEM 标记检出" || fail "T22" "rc=$rc（期望 1）"

# T23 干净目录通过；活 token 不在其中也通过
set +e
ev_scan_paths "FAKETOKEN_LEAKED_123" "$SANDBOX/scan-clean" >/dev/null 2>&1; rc=$?
set -e
[[ "$rc" == 0 ]] && pass "T23 干净目录扫描通过" || fail "T23" "rc=$rc（期望 0）"

# T24 ev_ancestry：进程链写入证据日志（验收项 j 的会话宿主证据）
ev_ancestry >/dev/null 2>&1
grep -q 'ancestry (from pid' "$SANDBOX/evidence/evidence.log" \
  && grep -q 'pid=[0-9]* comm=' "$SANDBOX/evidence/evidence.log" \
  && pass "T24 进程链证据已记录" || fail "T24" "evidence.log 缺进程链"

# T25 ev_scan_paths fail-closed：缺失路径 → rc=2（扫描失败不得报成功）
set +e
ev_scan_paths "-" "$SANDBOX/no-such-dir" >/dev/null 2>&1; rc=$?
set -e
[[ "$rc" == 2 ]] && pass "T25 缺失路径扫描失败（rc=2，fail-closed）" || fail "T25" "rc=$rc（期望 2）"
grep -q 'SCAN-ERROR' "$SANDBOX/evidence/evidence.log" \
  && pass "T25 扫描失败写入 SCAN-ERROR" || fail "T25" "缺 SCAN-ERROR 记录"

# T26 ev_scan_paths fail-closed：不可读目录 → rc=2
mkdir -p "$SANDBOX/scan-noperm"; echo x > "$SANDBOX/scan-noperm/f"; chmod 000 "$SANDBOX/scan-noperm"
set +e
ev_scan_paths "-" "$SANDBOX/scan-noperm" >/dev/null 2>&1; rc=$?
set -e
chmod 755 "$SANDBOX/scan-noperm"
[[ "$rc" == 2 ]] && pass "T26 不可读目录扫描失败（rc=2，fail-closed）" || fail "T26" "rc=$rc（期望 2）"

# T27 ev_run 以 %q 记录命令：含空格参数边界可还原
set +e
ev_run demoq bash -c 'true' 'arg with space' >/dev/null 2>&1
set -e
grep -qF 'cmd[demoq]: bash -c true arg\ with\ space → rc=0' "$SANDBOX/evidence/evidence.log" \
  && pass "T27 ev_run 参数边界可还原（%q 记录）" || fail "T27" "参数边界记录异常"

# T28 集成测试参数校验：--issue-comment / --evidence-dir 缺值 → 退出码 2
run t28a "$DEVENV" test:auth:integration --issue-comment
expect_rc "T28 --issue-comment 缺值返回 2" 2 t28a
run t28b "$DEVENV" test:auth:integration --evidence-dir
expect_rc "T28 --evidence-dir 缺值返回 2" 2 t28b

# ---------------------------------------------------------------------------
echo "------------------------------------------------------------"
echo "离线测试完成：$PASS_COUNT 通过，$FAILURES 失败"
[[ "$FAILURES" == 0 ]]
