#!/usr/bin/env bash
# ============================================================================
# 命令面离线测试：引擎端点解析 / 矩阵校验 / mkdir 锁 / 输出协议
# （不访问真实引擎——docker 全部 mock；Spec-工程基座「支持环境」节与 §4 的可测部分）
#
# 覆盖：
#   1. DEVENV_DOCKER_HOST 显式覆盖优先并报告覆盖关系（覆盖与默认不同不报错）
#   2. DOCKER_HOST 环境变量次之；平台默认发现兜底
#   3. 选定端点连接失败即报错（exit 3），绝不偷换下一个候选
#   4. 矩阵校验：podman 开发机通过；moby 非 CI 拒绝；moby + CI 通过；未识别拒绝
#   5. doctor --json 输出为可解析 JSON，含引擎身份/版本/架构/端点
#   6. mkdir 原子锁：互斥（exit 6）、失效锁（持有者已死）可清理取得、
#      慢构建存活时锁不被误清
#   7. 输出协议：进度走 stderr，stdout 只放 JSON；未知子命令 exit 2
#   8. DEVENV_DB_IMAGE 覆盖生效并报告来源；非法格式 exit 2
# ============================================================================
set -Eeuo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TEST_DIR/../.." && pwd)"

FAILURES=0
PASS_COUNT=0
pass() { printf 'PASS: %s\n' "$1"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { printf 'FAIL: %s —— %s\n' "$1" "$2"; FAILURES=$((FAILURES + 1)); }

# ---------------------------------------------------------------------------
# 沙箱与 mock docker
# ---------------------------------------------------------------------------
setup() {
  SANDBOX=$(mktemp -d /tmp/devenv-stack-offline.XXXXXX)
  OUT="$SANDBOX/out"
  mkdir -p "$SANDBOX/stubbin" "$OUT"
  cp -r "$REPO_ROOT/devenv" "$SANDBOX/devenv"

  # mock docker：version 输出可配置 JSON；compose version 正常；ps 空；image inspect 未构建
  cat > "$SANDBOX/stubbin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  version)
    [[ "${MOCK_DOCKER_DOWN:-}" == "1" ]] && exit 1
    cat "${MOCK_DOCKER_VERSION_JSON:?}"
    ;;
  compose)
    [[ "${2:-}" == "version" ]] && { echo "2.40.3"; exit 0; }
    exit 0 ;;
  ps)     exit 0 ;;
  image)  exit 1 ;;  # 未构建
  info)   exit 0 ;;
  *)      exit 0 ;;
esac
EOF
  chmod +x "$SANDBOX/stubbin/docker"

  cat > "$SANDBOX/version-podman.json" <<'EOF'
{"Client":{"Version":"29.1.3"},"Server":{"Version":"6.1.4","Os":"linux","Arch":"amd64","Components":[{"Name":"Podman Engine","Version":"6.1.4"}]}}
EOF
  cat > "$SANDBOX/version-moby.json" <<'EOF'
{"Client":{"Version":"29.1.3"},"Server":{"Version":"28.0.4","Os":"linux","Arch":"amd64","Components":[{"Name":"Engine","Version":"28.0.4"}]}}
EOF
  cat > "$SANDBOX/version-unknown.json" <<'EOF'
{"Client":{},"Server":{"Version":"1.0","Os":"linux","Arch":"amd64","Components":[{"Name":"WeirdEngine"}]}}
EOF

  export PATH="$SANDBOX/stubbin:$PATH"
  DEVENV="$SANDBOX/devenv/devenv"
}

run() { # run <name> <cmd...>；记录 RC 与输出
  local name="$1"; shift
  set +e
  "$@" > "$OUT/$name.out" 2> "$OUT/$name.err"
  RC=$?
  set -e
}

expect_rc() { [[ "$RC" == "$2" ]] && pass "$1" || fail "$1" "期望退出码 $2，实际 $RC（stderr: $(tail -1 "$OUT/$3.err" 2>/dev/null)）"; }

setup
trap 'rm -rf "$SANDBOX"' EXIT
echo "沙箱：$SANDBOX"

# ---------------------------------------------------------------------------
# 引擎端点解析（经真实入口 devenv doctor）
# ---------------------------------------------------------------------------

# T1 DEVENV_DOCKER_HOST 显式覆盖优先于 DOCKER_HOST，并报告覆盖关系
export MOCK_DOCKER_VERSION_JSON="$SANDBOX/version-podman.json"
run t1 env DEVENV_DOCKER_HOST="unix:///override.sock" DOCKER_HOST="unix:///env.sock" "$DEVENV" doctor
expect_rc "T1 覆盖后端点可用 doctor 通过" 0 t1
grep -q 'DEVENV_DOCKER_HOST（显式覆盖）' "$OUT/t1.err" \
  && pass "T1 报告覆盖关系" || fail "T1" "未报告覆盖来源（stderr: $(cat "$OUT/t1.err")）"
grep -q 'unix:///override.sock' "$OUT/t1.err" \
  && pass "T1 使用覆盖端点" || fail "T1" "未使用覆盖端点"

# T2 无覆盖时 DOCKER_HOST 环境变量生效
run t2 env DOCKER_HOST="unix:///env.sock" "$DEVENV" doctor
expect_rc "T2 DOCKER_HOST 生效 doctor 通过" 0 t2
grep -q 'DOCKER_HOST 环境变量' "$OUT/t2.err" \
  && pass "T2 报告环境变量来源" || fail "T2" "未报告 DOCKER_HOST 来源"

# T3 选定端点连接失败即报错，绝不偷换下一个候选：
#     覆盖端点已死 + DOCKER_HOST 指向"可用"端点 → 仍失败（不回落）
run t3 env DEVENV_DOCKER_HOST="unix:///dead.sock" DOCKER_HOST="unix:///env.sock" MOCK_DOCKER_DOWN=1 "$DEVENV" doctor
expect_rc "T3 端点连接失败 exit 3" 3 t3
grep -q 'unix:///dead.sock' "$OUT/t3.err" \
  && pass "T3 报告失败端点" || fail "T3" "未报告失败端点"
grep -q 'env.sock' "$OUT/t3.err" \
  && fail "T3 偷换候选" "错误文本出现回落端点" || pass "T3 未偷换下一个候选"

# T4 矩阵：moby + 非 CI → exit 3
run t4 env DOCKER_HOST="unix:///env.sock" MOCK_DOCKER_VERSION_JSON="$SANDBOX/version-moby.json" "$DEVENV" doctor
expect_rc "T4 moby 非 CI 拒绝 exit 3" 3 t4
grep -q '不在支持矩阵' "$OUT/t4.err" \
  && pass "T4 报告矩阵拒绝" || fail "T4" "未报告矩阵拒绝"

# T5 矩阵：moby + CI（GITHUB_ACTIONS=true）→ 通过
run t5 env DOCKER_HOST="unix:///env.sock" MOCK_DOCKER_VERSION_JSON="$SANDBOX/version-moby.json" GITHUB_ACTIONS=true "$DEVENV" doctor
expect_rc "T5 moby + CI 通过" 0 t5

# T6 矩阵：未识别引擎 → exit 3
run t6 env DOCKER_HOST="unix:///env.sock" MOCK_DOCKER_VERSION_JSON="$SANDBOX/version-unknown.json" "$DEVENV" doctor
expect_rc "T6 未识别引擎 exit 3" 3 t6

# T7 podman 开发机：doctor --json 输出可解析 JSON，含引擎身份/版本/架构/端点
run t7 env DOCKER_HOST="unix:///env.sock" "$DEVENV" --json doctor
expect_rc "T7 podman doctor --json 通过" 0 t7
if jq -e '.command == "doctor" and .exitCode == 0
          and ([.checks[] | select(.check == "engine-endpoint" and .result == "ok")] | length) == 1' \
     "$OUT/t7.out" >/dev/null 2>&1; then
  pass "T7 JSON 可解析且引擎检查 ok"
else
  fail "T7" "JSON 结构不符：$(cat "$OUT/t7.out")"
fi
grep -q '"event":"engine"' "$OUT/t7.out" \
  && pass "T7 JSONL 含 engine 事件（身份/版本/架构/端点）" || fail "T7" "缺 engine 事件"

# T8 输出协议：--json 时 stdout 无 [devenv] 进度行（进度全走 stderr）
if grep -q '^\[devenv\]' "$OUT/t7.out"; then
  fail "T8 进度混入结果流" "stdout 出现 [devenv] 行"
else
  pass "T8 进度不混入结果流"
fi
grep -q '^\[devenv\]' "$OUT/t7.err" \
  && pass "T8 进度走 stderr" || fail "T8" "stderr 无进度行"

# T9 未知子命令 → exit 2
run t9 "$DEVENV" frobnicate
expect_rc "T9 未知子命令 exit 2" 2 t9

# T10 images.lock 缺失 → doctor exit 3（fail-closed）
mv "$SANDBOX/devenv/images.lock" "$SANDBOX/images.lock.bak"
run t10 env DOCKER_HOST="unix:///env.sock" "$DEVENV" doctor
expect_rc "T10 锁文件缺失 exit 3" 3 t10
mv "$SANDBOX/images.lock.bak" "$SANDBOX/devenv/images.lock"

# T11 DEVENV_DB_IMAGE 覆盖生效并报告来源（可配置输入，不写死单一平台路线）
FAKE_DIGEST="5fa6f8e228a7$(printf '0%.0s' {1..52})"  # 64 hex
run t11 env DOCKER_HOST="unix:///env.sock" DEVENV_DB_IMAGE="kartoza/postgis:18.6-3.6.4@sha256:$FAKE_DIGEST" "$DEVENV" doctor
expect_rc "T11 DB 镜像覆盖 doctor 通过" 0 t11
grep -q 'DEVENV_DB_IMAGE（显式覆盖' "$OUT/t11.err" \
  && pass "T11 报告 DB 镜像覆盖来源" || fail "T11" "未报告覆盖来源（stderr: $(cat "$OUT/t11.err")）"

# T12 DEVENV_DB_IMAGE 非法格式 → exit 2（用法错误；经 images 命令硬失败路径——
#     doctor 会把同类错误软化为体检 fail/exit 3，硬路径由 images/prefetch 等命令承担）
run t12 env DOCKER_HOST="unix:///env.sock" DEVENV_DB_IMAGE="no-tag-here" "$DEVENV" images
expect_rc "T12 DB 镜像覆盖格式非法 exit 2" 2 t12

# ---------------------------------------------------------------------------
# mkdir 原子锁（直接 source 库做单元级验证）
# ---------------------------------------------------------------------------
export DEVENV_LOCK_ROOT="$SANDBOX/locks"  # 必须先于 source（LOCK_ROOT 在 source 时定型）
# shellcheck source=../lib/output.sh
source "$REPO_ROOT/devenv/lib/output.sh"
# shellcheck source=../lib/lock.sh
source "$REPO_ROOT/devenv/lib/lock.sh"

# T13 互斥：持锁期间第二个取得超时 → exit 6；持锁方退出（trap）后锁释放
(
  trap lock_release_all EXIT  # 与 dispatcher 同款 EXIT 释放
  lock_acquire demo 5
  set +e
  ( lock_acquire demo 2 ) 2>/dev/null
  rc=$?
  set -e
  [[ "$rc" == 6 ]] || { echo "内层 rc=$rc"; exit 1; }
) && pass "T13 持锁期间第二个取得 exit 6" || fail "T13" "互斥语义不符"
[[ -d "$SANDBOX/locks/demo.lock" ]] && fail "T13 锁未释放" "子shell 退出后锁目录残留" || pass "T13 退出后锁释放"

# T14 失效锁：持有者已死 → 清理后可取得
mkdir -p "$SANDBOX/locks/stale.lock"
echo "99999999 $(date +%s)" > "$SANDBOX/locks/stale.lock/owner"  # 不存在的 pid
(
  lock_acquire stale 5
) && pass "T14 失效锁清理后可取得" || fail "T14" "失效锁未取得"

# T15 慢构建存活：锁不被误清（持有进程活着，第二个取得超时 exit 6）
sleep 30 &
SLEEP_PID=$!
mkdir -p "$SANDBOX/locks/live.lock"
echo "$SLEEP_PID $(date +%s)" > "$SANDBOX/locks/live.lock/owner"
set +e
( lock_acquire live 2 ) 2>/dev/null
rc=$?
set -e
kill "$SLEEP_PID" 2>/dev/null; wait "$SLEEP_PID" 2>/dev/null || true
[[ "$rc" == 6 ]] && pass "T15 存活持有者锁不被误清（exit 6）" || fail "T15" "rc=$rc（期望 6）"
[[ -d "$SANDBOX/locks/live.lock" ]] && pass "T15 锁目录仍在（未误清）" || fail "T15" "锁目录被误清"
rm -rf "$SANDBOX/locks/live.lock"

# ---------------------------------------------------------------------------
echo "------------------------------------------------------------"
echo "命令面离线测试完成：$PASS_COUNT 通过，$FAILURES 失败"
[[ "$FAILURES" == 0 ]]
