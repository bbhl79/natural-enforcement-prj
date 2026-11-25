#!/usr/bin/env bash
# ============================================================================
# per-worktree 运行资源隔离离线测试（#59）——不访问真实引擎（docker 全部 mock）
#
# 覆盖（Spec-工程基座 硬不变量 4「每 worktree 一套完整隔离环境」）：
#   1. worktree 身份推导：git 目录哈希稳定、不同 worktree 不同名、非 git 上下文
#      回退工作树根路径哈希（不 die）
#   2. compose 项目名 per-worktree：compose 注入 -p natural-enforcement-<suffix>，
#      不再使用共享项目名 natural-enforcement（第 2 节）
#   3. 数据库凭据 per-worktree：首调用生成随机口令（32 hex）持久化到
#      .devenv-state/db-credentials.env（0600），二次调用稳定，不同 worktree 不同口令
#   4. 锁分派：stack/migrate 锁 per-worktree（同名后缀的活跃锁只阻塞本 worktree），
#      lockgen 机器级（经真实入口 build --lockgen 时锁在场断言）
#   5. down 只作用本 worktree 项目（compose 参数断言，经真实入口）
#   6. doctor：报告 worktree 身份；#59 前共享项目遗留容器 → warn（exit 仍 0）
# ============================================================================
set -Eeuo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TEST_DIR/../.." && pwd)"

FAILURES=0
PASS_COUNT=0
pass() { printf 'PASS: %s\n' "$1"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { printf 'FAIL: %s —— %s\n' "$1" "$2"; FAILURES=$((FAILURES + 1)); }

# ---------------------------------------------------------------------------
# 沙箱：mini git 仓库（含 devenv 副本）+ mock docker
# ---------------------------------------------------------------------------
SANDBOX=$(mktemp -d /tmp/devenv-isolation-offline.XXXXXX)
trap 'rm -rf "$SANDBOX"' EXIT
echo "沙箱：$SANDBOX"

MINI="$SANDBOX/mini"
mkdir -p "$MINI"
cp -r "$REPO_ROOT/devenv" "$MINI/devenv"
mkdir -p "$MINI/apps/api" "$MINI/apps/web" "$MINI/packages/contracts" "$MINI/packages/tsconfig"
printf 'node_modules/\n.devenv-state/\n' > "$MINI/.gitignore"
printf '{"name":"mini","private":true}\n' > "$MINI/package.json"
printf 'lockfileVersion: "9.0"\n' > "$MINI/pnpm-lock.yaml"
printf 'packages: []\n' > "$MINI/pnpm-workspace.yaml"
printf '{"name":"@ne/api"}\n' > "$MINI/apps/api/package.json"
printf '{"name":"@ne/web"}\n' > "$MINI/apps/web/package.json"
printf '{"name":"@ne/contracts"}\n' > "$MINI/packages/contracts/package.json"
printf '{"name":"@ne/tsconfig"}\n' > "$MINI/packages/tsconfig/package.json"
printf '{"compilerOptions":{}}\n' > "$MINI/packages/tsconfig/tsconfig.json"
git -C "$MINI" init -q
git -C "$MINI" config user.email "offline@test"
git -C "$MINI" config user.name "offline"
git -C "$MINI" add -A
git -C "$MINI" commit -qm init

# mock docker：build 落假镜像；compose 记录注入环境；image inspect 应答 label；
# create 断言 lockgen 机器级锁在场；ps 支撑遗留共享项目 warn。
MOCK_DOCKER_STATE="$SANDBOX/docker-state"
mkdir -p "$MOCK_DOCKER_STATE/images" "$MOCK_DOCKER_STATE/tags" "$SANDBOX/stubbin"
cat > "$SANDBOX/stubbin/docker" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
STATE="${MOCK_DOCKER_STATE:?}"
mkdir -p "$STATE/images" "$STATE/tags"
cmd="${1:-}"; [[ $# -gt 0 ]] && shift
case "$cmd" in
  version)
    [[ "${MOCK_ENGINE_DOWN:-}" == "1" ]] && exit 1
    cat "${MOCK_DOCKER_VERSION_JSON:?}" ;;
  compose)
    {
      printf 'compose args:'
      for a in "$@"; do printf ' %q' "$a"; done
      printf ' | WORKSPACE_IMAGE=%s DB_IMAGE=%s DB_PASSWORD=%s WEB_PORT=%s\n' \
        "${WORKSPACE_IMAGE:-}" "${DB_IMAGE:-}" "${DB_PASSWORD:-}" "${WEB_PORT:-}"
    } >> "$STATE/calls.log"
    [[ "${1:-}" == "version" ]] && echo "2.40.3"
    exit 0 ;;
  build)
    tag=""; snap=""; target=""; base=""; toolshash=""; bargs=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        -t) tag="$2"; shift 2 ;;
        --label)
          case "$2" in
            devenv.snapshot.hash=*) snap="${2#devenv.snapshot.hash=}" ;;
            devenv.base.image=*) base="${2#devenv.base.image=}" ;;
            devenv.tools.input-hash=*) toolshash="${2#devenv.tools.input-hash=}" ;;
          esac
          shift 2 ;;
        --target) target="$2"; shift 2 ;;
        --build-arg) bargs="$bargs$2;"; shift 2 ;;
        -f) shift 2 ;;
        *) shift ;;
      esac
    done
    # lockgen 靶断言：机器级锁须在创建 lockgen 容器时在场（#59）
    if [[ "$target" == lockgen* && -n "${MOCK_ASSERT_LOCKGEN_LOCK:-}" ]]; then
      if [[ -d "${DEVENV_LOCK_ROOT:-/tmp/natural-enforcement-locks}/lockgen.lock" ]]; then
        printf 'lockgen-lock-held\n' >> "$STATE/lockgen-lock-check.txt"
      else
        printf 'lockgen-lock-MISSING\n' >> "$STATE/lockgen-lock-check.txt"
      fi
    fi
    id="sha256:$(printf '%s|%s|%s|%s' "$tag" "$snap" "$target" "$bargs" | sha256sum | awk '{print $1}')"
    printf 'SNAPSHOT_HASH=%s\nBASE_IMAGE=%s\nTOOLS_HASH=%s\nTAG=%s\n' \
      "$snap" "$base" "$toolshash" "$tag" > "$STATE/images/$id"
    if [[ -n "$tag" ]]; then
      printf '%s\n' "$id" > "$STATE/tags/$(printf '%s' "$tag" | tr '/:' '__')"
    fi
    printf '%s\n' "${id#sha256:}" ;;
  image)
    sub="${1:-}"; [[ $# -gt 0 ]] && shift
    [[ "$sub" == "inspect" ]] || exit 0
    ref=""; fmt=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --format) fmt="$2"; shift 2 ;;
        *) ref="$1"; shift ;;
      esac
    done
    id="$ref"
    if [[ "$ref" != sha256:* ]]; then
      tf="$STATE/tags/$(printf '%s' "$ref" | tr '/:' '__')"
      [[ -f "$tf" ]] || exit 1
      id="$(cat "$tf")"
    fi
    [[ -f "$STATE/images/$id" ]] || exit 1
    case "$fmt" in
      *devenv.snapshot.hash*) awk -F= '/^SNAPSHOT_HASH=/{print $2}' "$STATE/images/$id" ;;
      *devenv.tools.input-hash*) awk -F= '/^TOOLS_HASH=/{print $2}' "$STATE/images/$id" ;;
      *) printf '\n' ;;
    esac ;;
  create) printf 'cid-mock\n' ;;
  cp|rm|rmi) exit 0 ;;
  ps)
    # 遗留共享项目容器 fixture（#59 前 natural-enforcement 项目）
    if [[ "${MOCK_LEGACY_RUNNING:-}" == "1" ]]; then
      for a in "$@"; do
        if [[ "$a" == "label=com.docker.compose.project=natural-enforcement" ]]; then
          printf 'natural-enforcement-api-1\n'
        fi
      done
    fi
    exit 0 ;;
  *) exit 0 ;;
esac
MOCK
chmod +x "$SANDBOX/stubbin/docker"

cat > "$SANDBOX/version-podman.json" <<'EOF'
{"Client":{"Version":"29.1.3"},"Server":{"Version":"6.1.4","Os":"linux","Arch":"amd64","Components":[{"Name":"Podman Engine","Version":"6.1.4"}]}}
EOF

export PATH="$SANDBOX/stubbin:$PATH"
export MOCK_DOCKER_STATE
export DEVENV_LOCK_ROOT="$SANDBOX/locks"
export DOCKER_HOST="unix:///mock.sock"
export MOCK_DOCKER_VERSION_JSON="$SANDBOX/version-podman.json"

DEVENV="$MINI/devenv/devenv"

run() { # run <name> <cmd...>；记录 RC 与输出
  local name="$1"; shift
  set +e
  "$@" > "$SANDBOX/$name.out" 2> "$SANDBOX/$name.err"
  RC=$?
  set -e
}

runsub() { # runsub <name> <cmd...>；子 shell 执行（保留严格模式）
  local name="$1"; shift
  set +e
  ( set -Eeuo pipefail; "$@" ) > "$SANDBOX/$name.out" 2> "$SANDBOX/$name.err"
  RC=$?
  set -e
}

# 以指定 worktree 身份 source 库并执行片段（subshell 隔离）
wt_bash() { # wt_bash <wt-id> <bash-script> [args...]
  local wt="$1" script="$2"; shift 2
  DEVENV_WORKTREE_ID="$wt" bash -c "$script" _ "$MINI" "$@"
}

# ---------------------------------------------------------------------------
# 1. worktree 身份推导（subshell source 库，隔离变量）
# ---------------------------------------------------------------------------
SRC_LIBS='REPO_ROOT="$1"; source "$1/devenv/lib/output.sh"; source "$1/devenv/lib/stack.sh"; printf "%s %s %s\n" "$PROJECT_NAME" "$TOOLS_IMAGE" "$WS_IMAGE"'

A1="$(wt_bash wt-alpha "$SRC_LIBS")"
A2="$(wt_bash wt-alpha "$SRC_LIBS")"
B1="$(wt_bash wt-beta "$SRC_LIBS")"
A_PROJ="${A1%% *}"; B_PROJ="${B1%% *}"; A_SUFFIX="${A_PROJ##*-}"
[[ "$A_PROJ" =~ ^natural-enforcement-[0-9a-f]{8}$ ]] \
  && pass "I1a 项目名 = natural-enforcement-<8hex>" || fail "I1a" "项目名格式不符：$A_PROJ"
[[ "$(wt_bash wt-alpha 'REPO_ROOT="$1"; source "$1/devenv/lib/output.sh"; source "$1/devenv/lib/stack.sh"; printf "%s" "$PROJECT_NAME"')" == "$A_PROJ" ]] \
  && pass "I1a 身份推导确定性（同输入同名）" || fail "I1a" "同名两次推导不同"
[[ "$A_PROJ" != "$B_PROJ" ]] \
  && pass "I1b 不同 worktree → 不同项目名" || fail "I1b" "不同 worktree 同名：$A_PROJ"
[[ "$A1" == *"tools:wt-$A_SUFFIX"* && "$A1" == *"workspace:wt-$A_SUFFIX"* ]] \
  && pass "I1c 镜像 tag per-worktree（wt-<suffix>）" || fail "I1c" "tag 未带后缀：$A1"

# 默认身份：mini git 仓库 → git 目录哈希
GIT_DIR_ID="$(git -C "$MINI" rev-parse --absolute-git-dir)"
EXPECT_PROJ="natural-enforcement-$(printf '%s' "$GIT_DIR_ID" | sha256sum | awk '{print $1}' | cut -c1-8)"
REAL_PROJ="$(bash -c 'REPO_ROOT="$1"; source "$1/devenv/lib/output.sh"; source "$1/devenv/lib/stack.sh"; printf "%s" "$PROJECT_NAME"' _ "$MINI")"
[[ "$REAL_PROJ" == "$EXPECT_PROJ" ]] \
  && pass "I1d 默认身份 = git 目录哈希" || fail "I1d" "期望 $EXPECT_PROJ 实际 $REAL_PROJ"

# 非 git 上下文 → 回退工作树根路径哈希（不 die）。库从 mini 的 devenv 副本 source，
# REPO_ROOT 指向无 .git 的目录（等价 stack-offline 沙箱：devenv 副本无 git 仓库）。
NOGIT="$SANDBOX/no-git-dir"
mkdir -p "$NOGIT"
NOGIT_PROJ="$(bash -c 'REPO_ROOT="$1"; source "$2/devenv/lib/output.sh"; source "$2/devenv/lib/stack.sh"; printf "%s" "$PROJECT_NAME"' _ "$NOGIT" "$MINI")"
NOGIT_EXPECT="natural-enforcement-$(printf '%s' "$NOGIT" | sha256sum | awk '{print $1}' | cut -c1-8)"
[[ "$NOGIT_PROJ" == "$NOGIT_EXPECT" ]] \
  && pass "I1e 非 git 上下文回退路径哈希（不 die）" || fail "I1e" "期望 $NOGIT_EXPECT 实际 $NOGIT_PROJ"

# ---------------------------------------------------------------------------
# 2-3. compose 注入项目名 + 数据库凭据（source 库直接调用 compose）
# ---------------------------------------------------------------------------
# shellcheck source=../lib/output.sh
source "$REPO_ROOT/devenv/lib/output.sh"
# shellcheck source=../lib/lock.sh
source "$REPO_ROOT/devenv/lib/lock.sh"
# shellcheck source=../lib/snapshot.sh
source "$REPO_ROOT/devenv/lib/snapshot.sh"
# shellcheck source=../lib/stack.sh
source "$REPO_ROOT/devenv/lib/stack.sh"
REPO_ROOT="$MINI"  # lib 函数运行时读 REPO_ROOT——指向 mini 仓库

DB_FILE="$MINI/.devenv-state/db-credentials.env"
rm -f "$DB_FILE"
: > "$MOCK_DOCKER_STATE/calls.log"
runsub i2 compose ps
[[ "$RC" == 0 ]] && pass "I2 compose 调用成功" || fail "I2" "rc=$RC err=$(cat "$SANDBOX/i2.err")"
grep -q -- "-p $PROJECT_NAME " "$MOCK_DOCKER_STATE/calls.log" \
  && pass "I2 compose 注入 per-worktree 项目名（-p $PROJECT_NAME）" \
  || fail "I2" "未注入项目名：$(cat "$MOCK_DOCKER_STATE/calls.log")"
# 提取最后一次 compose 调用的口令（compose() 前置 version 检查也落日志，env 为空——取尾行）
extract_pw() { grep -o 'DB_PASSWORD=[^ ]*' "$MOCK_DOCKER_STATE/calls.log" | tail -1 | cut -d= -f2; }
I2_PW="$(extract_pw)"
[[ "$I2_PW" =~ ^[0-9a-f]{32}$ ]] \
  && pass "I2 首调用生成随机口令（32 hex）" || fail "I2" "口令不符：$I2_PW"
[[ -f "$DB_FILE" ]] && pass "I2 凭据持久化到 .devenv-state" || fail "I2" "凭据文件未创建"
PERM="$(stat -c '%a' "$DB_FILE" 2>/dev/null || stat -f '%Lp' "$DB_FILE")"
[[ "$PERM" == "600" ]] && pass "I2 凭据文件权限 600" || fail "I2" "权限=$PERM"
grep -q "DB_PASSWORD=$I2_PW" "$DB_FILE" \
  && pass "I2 文件记录同口令" || fail "I2" "文件口令不符：$(cat "$DB_FILE")"

runsub i2b compose ps
I2_PW2="$(extract_pw)"
[[ "$RC" == 0 && "$I2_PW2" == "$I2_PW" ]] \
  && pass "I3 二次调用口令稳定" || fail "I3" "二次口令变化：$I2_PW vs $I2_PW2"

# 不同 worktree（不同状态目录）→ 不同口令
PW_B="$(DEVENV_WORKTREE_ID="wt-beta" DEVENV_STATE_DIR="$SANDBOX/state-beta" bash -c '
  REPO_ROOT="$1"; source "$1/devenv/lib/output.sh"; source "$1/devenv/lib/stack.sh"; REPO_ROOT="$1"
  db_credentials_ensure; printf "%s" "$DB_PASSWORD_EFFECTIVE"' _ "$MINI")"
[[ "$PW_B" =~ ^[0-9a-f]{32}$ && "$PW_B" != "$I2_PW" ]] \
  && pass "I3 不同 worktree 口令独立" || fail "I3" "B 口令异常：$PW_B"

# ---------------------------------------------------------------------------
# 4. 锁分派：活跃的本 worktree 锁只阻塞本 worktree；lockgen 机器级
# ---------------------------------------------------------------------------
mkdir -p "$DEVENV_LOCK_ROOT"
# 活跃持锁者（复用 lock.sh owner 格式：活 pid）占住 alpha 的 stack 锁名
sleep 30 &
HOLDER_PID=$!
mkdir -p "$DEVENV_LOCK_ROOT/stack-$A_SUFFIX.lock"
printf '%s %s\n' "$HOLDER_PID" "$(date +%s)" > "$DEVENV_LOCK_ROOT/stack-$A_SUFFIX.lock/owner"

# beta 身份取自己的 stack 锁 → 不被 alpha 阻塞
wt_bash wt-beta 'REPO_ROOT="$1"; source "$1/devenv/lib/output.sh"; source "$1/devenv/lib/lock.sh"; source "$1/devenv/lib/snapshot.sh"; source "$1/devenv/lib/stack.sh"; REPO_ROOT="$1"; lock_acquire "stack-$WT_SUFFIX" 5' \
  && pass "I4 per-worktree stack 锁互不阻塞（B 取得 exit 0）" \
  || fail "I4" "B 被 alpha 活跃锁阻塞"

# alpha 身份取自己的 stack 锁 → 活跃持有者 → exit 6（同 worktree 互斥语义保留）
set +e
wt_bash wt-alpha 'REPO_ROOT="$1"; source "$1/devenv/lib/output.sh"; source "$1/devenv/lib/lock.sh"; source "$1/devenv/lib/snapshot.sh"; source "$1/devenv/lib/stack.sh"; REPO_ROOT="$1"; lock_acquire "stack-$WT_SUFFIX" 2' 2>/dev/null
I4A_RC=$?
set -e
kill "$HOLDER_PID" 2>/dev/null; wait "$HOLDER_PID" 2>/dev/null || true
[[ "$I4A_RC" == 6 ]] \
  && pass "I4 同 worktree 活跃锁仍互斥（alpha exit 6）" || fail "I4" "alpha rc=$I4A_RC（期望 6）"

# lockgen 机器级锁：经真实入口 build --lockgen，lockgen 靶构建期间锁在场
: > "$MOCK_DOCKER_STATE/calls.log"
rm -f "$MOCK_DOCKER_STATE/lockgen-lock-check.txt"
run i4b env MOCK_ASSERT_LOCKGEN_LOCK=1 DEVENV_STATE_DIR="$SANDBOX/state-lg" "$DEVENV" build --lockgen
[[ "$RC" == 0 ]] && pass "I4b build --lockgen 成功" || fail "I4b" "rc=$RC err=$(tail -3 "$SANDBOX/i4b.err")"
grep -q 'lockgen-lock-held' "$MOCK_DOCKER_STATE/lockgen-lock-check.txt" \
  && pass "I4b lockgen 段持机器级锁（跨 worktree 互斥）" \
  || fail "I4b" "锁未在场：$(cat "$MOCK_DOCKER_STATE/lockgen-lock-check.txt" 2>/dev/null)"

# ---------------------------------------------------------------------------
# 5. down 只作用本 worktree 项目（compose 参数断言，经真实入口）
# ---------------------------------------------------------------------------
: > "$MOCK_DOCKER_STATE/calls.log"
run i5 env DEVENV_WORKTREE_ID="wt-alpha" DEVENV_STATE_DIR="$SANDBOX/state-down" "$DEVENV" down
[[ "$RC" == 0 ]] && pass "I5 down 成功" || fail "I5" "rc=$RC err=$(tail -2 "$SANDBOX/i5.err")"
grep -q -- "-p natural-enforcement-[0-9a-f]\{8\} " "$MOCK_DOCKER_STATE/calls.log" \
  && pass "I5 down 携带 per-worktree 项目名" || fail "I5" "参数：$(cat "$MOCK_DOCKER_STATE/calls.log")"
if grep -qE -- '-p natural-enforcement ' "$MOCK_DOCKER_STATE/calls.log"; then
  fail "I5" "仍使用共享项目名 natural-enforcement"
else
  pass "I5 不再使用共享项目名"
fi
grep -q -- "--remove-orphans" "$MOCK_DOCKER_STATE/calls.log" \
  && pass "I5 --remove-orphans 保留（仅本 worktree 项目范围）" || fail "I5" "缺 --remove-orphans"

# ---------------------------------------------------------------------------
# 6. doctor：worktree 身份报告 + 遗留共享项目 warn
# ---------------------------------------------------------------------------
run i6 env DEVENV_WORKTREE_ID="wt-alpha" DEVENV_STATE_DIR="$SANDBOX/state-doc" "$DEVENV" --json doctor
[[ "$RC" == 0 ]] && pass "I6 doctor 通过" || fail "I6" "rc=$RC err=$(tail -3 "$SANDBOX/i6.err")"
if jq -e '[.checks[] | select(.check == "worktree" and .result == "ok")] | length == 1' \
     "$SANDBOX/i6.out" >/dev/null 2>&1; then
  pass "I6 doctor JSON 含 worktree 检查项"
else
  fail "I6" "缺 worktree 检查：$(cat "$SANDBOX/i6.out")"
fi
# --json 模式 chk 人类行抑制（输出协议）——项目名在 JSON detail 中断言
# （i6 以 wt-alpha 身份运行，期望项目名按该身份派生，与主 shell 的真实仓库身份不同）
I6_EXPECT="natural-enforcement-$(printf '%s' 'wt-alpha' | sha256sum | awk '{print $1}' | cut -c1-8)"
if jq -e --arg p "$I6_EXPECT" '[.checks[] | select(.check == "worktree" and (.detail | contains($p)))] | length == 1' \
     "$SANDBOX/i6.out" >/dev/null 2>&1; then
  pass "I6 检查 detail 报告 per-worktree 项目名"
else
  fail "I6" "detail 无项目名（期望 $I6_EXPECT）：$(cat "$SANDBOX/i6.out")"
fi

run i6b env MOCK_LEGACY_RUNNING=1 DEVENV_WORKTREE_ID="wt-alpha" DEVENV_STATE_DIR="$SANDBOX/state-doc" "$DEVENV" --json doctor
[[ "$RC" == 0 ]] \
  && pass "I6b 遗留共享项目容器存在时 doctor 仍 exit 0（warn 不失败）" || fail "I6b" "rc=$RC"
if jq -e '[.checks[] | select(.check == "legacy-project" and .result == "warn")] | length == 1' \
     "$SANDBOX/i6b.out" >/dev/null 2>&1; then
  pass "I6b 遗留共享项目 → warn 检查项"
else
  fail "I6b" "缺 legacy-project warn：$(cat "$SANDBOX/i6b.out")"
fi

# ---------------------------------------------------------------------------
echo "------------------------------------------------------------"
echo "per-worktree 隔离离线测试完成：$PASS_COUNT 通过，$FAILURES 失败"
[[ "$FAILURES" == 0 ]]
