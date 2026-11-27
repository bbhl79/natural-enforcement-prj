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
#   4. 新鲜度命中仍登记 per-worktree tag（采纳既有不可变镜像也执行 docker tag；
#      失败显式 exit 4）
#   5. 锁分派：stack/migrate 锁 per-worktree（同名后缀的活跃锁只阻塞本 worktree），
#      lockgen 机器级（经真实入口 build --lockgen 时锁在场断言）
#   6. down 只作用本 worktree 项目（compose 参数断言，经真实入口）
#   7. doctor：报告 worktree 身份；#59 前共享项目遗留容器 → warn（exit 仍 0）
#   8. 质量门容器命令回归：test:unit 的容器命令是 pnpm…而非宿主函数 run_gate
#      （#56 起潜伏 bug 的守卫——离线 mock 曾使其不可见）
#   9. 锁与栈使用租约（#61）：租约 per-worktree；真实入口读者命令持共享租约、
#      与排他命令互斥；prefetch 机器级拉取锁跨 worktree 生效；web --down 持栈锁
#  10. 并发 web 入口与可观察命令面（#62）：省略 --port 引擎运行时分配端口
#      （裸容器端口注入，不做"探测时空闲"式预占）、--port 显式值注入与绑定冲突
#      诊断（容器占用者/非容器占用者/通用失败三分）、实际端口回读进 --json 终值
#      与 status；exec/shell/logs 透传语义（原始流原通道；--json 仅包装终值元数据，
#      原始流分流 stderr）；零宿主端口不变量静态守卫（compose 仅 web 发布端口）
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
# 供应链静态门禁输入（#63）：doctor/build 预检要求 catalog 精确 pin、
# minimumReleaseAge 定值 + strict、allowBuilds 版本化键，且锁文件与声明一致。
printf 'lockfileVersion: "9.0"\ncatalogs:\n  default:\n    mini-probe:\n      specifier: 1.2.3\n      version: 1.2.3\nimporters:\n  .: {}\n' > "$MINI/pnpm-lock.yaml"
printf 'packages: []\nminimumReleaseAge: 1440\nminimumReleaseAgeStrict: true\nallowBuilds:\n  mini-probe@1.2.3: true\ncatalog:\n  mini-probe: "1.2.3"\n' > "$MINI/pnpm-workspace.yaml"
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
    # 读者命令持有共享栈使用租约的在场断言（#61）：run 容器创建时租约槽须存在
    # （compose 调用带 -p/-f 前置参数，run 不在固定位置——逐参扫描）
    if [[ "${MOCK_ASSERT_STACK_LEASE:-}" == "1" ]]; then
      has_run=0
      for a in "$@"; do
        if [[ "$a" == "run" ]]; then has_run=1; fi
      done
      if (( has_run )); then
        # 校验本 worktree 自己的租约目录（不是任意 stray lease）
        lease_root="${DEVENV_LOCK_ROOT:-/tmp/natural-enforcement-locks}"
        if [[ -n "${DEVENV_WORKTREE_ID:-}" ]]; then
          wt_hash="$(printf '%s' "$DEVENV_WORKTREE_ID" | sha256sum | awk '{print $1}' | cut -c1-8)"
          lease_dir="$lease_root/stack-$wt_hash.lease"
        else
          lease_dir="$lease_root"
        fi
        if find "$lease_dir" -maxdepth 2 -name owner -type f 2>/dev/null | grep -q .; then
          printf 'stack-lease-held\n' >> "$STATE/lease-check.txt"
        else
          printf 'stack-lease-MISSING\n' >> "$STATE/lease-check.txt"
        fi
      fi
    fi
    {
      printf 'compose args:'
      for a in "$@"; do printf ' %q' "$a"; done
      printf ' | WORKSPACE_IMAGE=%s DB_IMAGE=%s DB_PASSWORD=%s WEB_PORT_SPEC=%s\n' \
        "${WORKSPACE_IMAGE:-}" "${DB_IMAGE:-}" "${DB_PASSWORD:-}" "${WEB_PORT_SPEC:-}"
    } >> "$STATE/calls.log"
    [[ "${1:-}" == "version" ]] && echo "2.40.3"
    # web 绑定失败注入（#62）：显式端口冲突时 compose up -d web 非零退出
    if [[ "${MOCK_COMPOSE_WEB_FAIL:-}" == "1" ]]; then
      has_up=0; has_web=0
      for a in "$@"; do [[ "$a" == "up" ]] && has_up=1; [[ "$a" == "web" ]] && has_web=1; done
      if (( has_up && has_web )); then
        echo "Error response from daemon: Bind for 0.0.0.0:${MOCK_FAIL_PORT:-8080} failed: port is already allocated" >&2
        exit 1
      fi
    fi
    # 透传载荷执行（#62 测试）：run --rm <svc> <payload...> / exec <svc> <payload...>
    # 真实执行载荷命令，验证 exec/shell 的原始流走向与退出码传播
    if [[ "${MOCK_EXEC_PAYLOAD:-}" == "1" ]]; then
      mode=""; rest=()
      for a in "$@"; do
        if [[ -z "$mode" ]]; then
          case "$a" in run|exec) mode="$a" ;; esac
        else
          rest+=("$a")
        fi
      done
      if [[ -n "$mode" ]]; then
        [[ "${rest[0]:-}" == "--rm" ]] && rest=("${rest[@]:1}")
        rest=("${rest[@]:1}")  # 去 svc 名
        if ((${#rest[@]})); then "${rest[@]}" </dev/null; exit $?; fi
      fi
    fi
    # logs 透传 fixture（#62 测试）：打印原始日志行到 stdout
    if [[ -n "${MOCK_LOGS_LINE:-}" ]]; then
      for a in "$@"; do
        [[ "$a" == "logs" ]] && printf '%s\n' "$MOCK_LOGS_LINE"
      done
    fi
    exit 0 ;;
  pull)
    # 机器级基础镜像拉取锁（#61）：pull 期间 prefetch 锁须在场
    if [[ "${MOCK_ASSERT_PREFETCH_LOCK:-}" == "1" ]]; then
      if [[ -d "${DEVENV_LOCK_ROOT:-/tmp/natural-enforcement-locks}/prefetch.lock" ]]; then
        printf 'prefetch-lock-held\n' >> "$STATE/prefetch-lock-check.txt"
      else
        printf 'prefetch-lock-MISSING\n' >> "$STATE/prefetch-lock-check.txt"
      fi
    fi
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
      *devenv.snapshot.hash*devenv.base.image*)
        h="$(awk -F= '/^SNAPSHOT_HASH=/{print $2}' "$STATE/images/$id")"
        b="$(awk -F= '/^BASE_IMAGE=/{print $2}' "$STATE/images/$id")"
        printf '%s %s\n' "$h" "$b" ;;
      *devenv.snapshot.hash*) awk -F= '/^SNAPSHOT_HASH=/{print $2}' "$STATE/images/$id" ;;
      *devenv.tools.input-hash*) awk -F= '/^TOOLS_HASH=/{print $2}' "$STATE/images/$id" ;;
      *) printf '\n' ;;
    esac ;;
  tag)
    {
      printf 'tag'
      for a in "$@"; do printf ' %q' "$a"; done
      printf ' | WORKSPACE_IMAGE=%s\n' "${WORKSPACE_IMAGE:-}"
    } >> "$STATE/calls.log"
    [[ "${MOCK_TAG_FAIL:-}" == "1" ]] && exit 1
    exit 0 ;;
  create) printf 'cid-mock\n' ;;
  cp|rm|rmi) exit 0 ;;
  port)
    # docker port <cid> 4173/tcp → 引擎分配结果回读（#62 fixture）
    [[ "${MOCK_WEB_RUNNING:-}" == "1" ]] || exit 1
    printf '0.0.0.0:%s\n' "${MOCK_WEB_PORT:-49152}" ;;
  inspect)
    # 容器 inspect（与 image inspect 区分）：健康状态与容器固化镜像（#62 web 路径）
    fmt=""; ref=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --format) fmt="$2"; shift 2 ;;
        *) ref="$1"; shift ;;
      esac
    done
    case "$fmt" in
      *Health.Status*)
        [[ "${MOCK_WEB_RUNNING:-}" == "1" ]] && { printf 'healthy\n'; exit 0; }
        exit 1 ;;
      *'.Image'*)
        # 容器镜像 = 创建它的 compose 调用注入的 WORKSPACE_IMAGE（真实引擎语义：创建时固化）
        grep -o 'WORKSPACE_IMAGE=[^ ]*' "$STATE/calls.log" | tail -1 | cut -d= -f2- ;;
      *) exit 0 ;;
    esac ;;
  ps)
    fmt=""; want_web=0; prev=""
    for a in "$@"; do
      [[ "$prev" == "--format" ]] && fmt="$a"
      case "$a" in *service=web*) want_web=1 ;; esac
      prev="$a"
    done
    # web 容器 fixture（#62）：MOCK_WEB_RUNNING=1 时按格式回 ID 或名称
    if (( want_web )) && [[ "${MOCK_WEB_RUNNING:-}" == "1" ]]; then
      case "$fmt" in
        *ID*) printf 'webcid-mock\n' ;;
        *) printf 'web-1\n' ;;
      esac
    fi
    # 端口占用者 fixture（#62 绑定冲突诊断）：原始 Ports 文本行
    [[ -n "${MOCK_PS_LINES:-}" ]] && printf '%s\n' "$MOCK_PS_LINES"
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
  && pass "I2 compose 注入 per-worktree 项目名（-p ${PROJECT_NAME}）" \
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

# 4. 新鲜度命中仍登记 per-worktree tag（#59 评审修复：采纳既有不可变镜像也须
#    打 wt-<suffix> tag；失败显式 exit 4）
# ---------------------------------------------------------------------------

write_image() { # 镜像 fixture：write_image <id> <snapHash> <baseImage> <toolsHash>
  printf 'SNAPSHOT_HASH=%s\nINPUTS=\nBASE_IMAGE=%s\nTOOLS_HASH=%s\nTAG=\n' "$2" "$3" "$4" \
    > "$MOCK_DOCKER_STATE/images/$1"
}
ensure_and_echo() { # 子 shell 内跑新鲜度检查并回传绑定结果（供 runsub 调用）
  ensure_fresh_workspace
  printf 'EFFECTIVE=%s\n' "$WS_IMAGE_EFFECTIVE"
}

H_FRESH="$(snapshot_capture)"
TH_FRESH="$(tools_input_hash "$H_FRESH")"
TOOLS_ID_FRESH="sha256:$(printf 'tools-fresh-fixture' | sha256sum | awk '{print $1}')"
WS_ID_FRESH="sha256:$(printf 'ws-fresh-fixture' | sha256sum | awk '{print $1}')"
write_image "$TOOLS_ID_FRESH" "" "" "$TH_FRESH"
write_image "$WS_ID_FRESH" "$H_FRESH" "$TOOLS_ID_FRESH" ""
snapshot_state_store "$H_FRESH" "$WS_ID_FRESH" "$TH_FRESH" "$TOOLS_ID_FRESH"

: > "$MOCK_DOCKER_STATE/calls.log"
runsub i7 ensure_and_echo
I7_EFFECTIVE="$(awk -F= '/^EFFECTIVE=/{print $2}' "$SANDBOX/i7.out")"
if [[ "$RC" == 0 && "$I7_EFFECTIVE" == "$WS_ID_FRESH" ]] \
  && grep -q "tag $TOOLS_ID_FRESH $TOOLS_IMAGE" "$MOCK_DOCKER_STATE/calls.log" \
  && grep -q "tag $WS_ID_FRESH $WS_IMAGE" "$MOCK_DOCKER_STATE/calls.log" \
  && ! grep -q 'docker build' "$MOCK_DOCKER_STATE/calls.log"; then
  pass "I7 新鲜度命中登记 tools/workspace per-worktree tag（无构建纯采纳）"
else
  fail "I7" "rc=$RC effective=$I7_EFFECTIVE log=$(cat "$MOCK_DOCKER_STATE/calls.log")"
fi

export MOCK_TAG_FAIL=1
runsub i8 ensure_and_echo
unset MOCK_TAG_FAIL
[[ "$RC" == 4 ]] && pass "I8 tag 登记失败显式 exit 4（不静默跳过）" \
  || fail "I8" "rc=${RC}（期望 4）"
grep -q '登记 per-worktree 镜像 tag' "$SANDBOX/i8.err" \
  && pass "I8 失败步骤与原因入 stderr" || fail "I8" "stderr: $(tail -2 "$SANDBOX/i8.err")"

# ---------------------------------------------------------------------------
# 5. 锁分派：活跃的本 worktree 锁只阻塞本 worktree；lockgen 机器级
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
  && pass "I4 同 worktree 活跃锁仍互斥（alpha exit 6）" || fail "I4" "alpha rc=${I4A_RC}（期望 6）"

# lockgen 机器级锁：经真实入口 build --lockgen，lockgen 靶构建期间锁在场
: > "$MOCK_DOCKER_STATE/calls.log"
rm -f "$MOCK_DOCKER_STATE/lockgen-lock-check.txt"
run i4b env MOCK_ASSERT_LOCKGEN_LOCK=1 DEVENV_STATE_DIR="$SANDBOX/state-lg" "$DEVENV" build --lockgen
[[ "$RC" == 0 ]] && pass "I4b build --lockgen 成功" || fail "I4b" "rc=$RC err=$(tail -3 "$SANDBOX/i4b.err")"
grep -q 'lockgen-lock-held' "$MOCK_DOCKER_STATE/lockgen-lock-check.txt" \
  && pass "I4b lockgen 段持机器级锁（跨 worktree 互斥）" \
  || fail "I4b" "锁未在场：$(cat "$MOCK_DOCKER_STATE/lockgen-lock-check.txt" 2>/dev/null)"

# ---------------------------------------------------------------------------
# 6. down 只作用本 worktree 项目（compose 参数断言，经真实入口）
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
# 7. doctor：worktree 身份报告 + 遗留共享项目 warn
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
  fail "I6" "detail 无项目名（期望 ${I6_EXPECT}）：$(cat "$SANDBOX/i6.out")"
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
# 8. 质量门容器命令回归（#56 起潜伏 bug 守卫）：容器命令必须是真实可执行物
# ---------------------------------------------------------------------------

: > "$MOCK_DOCKER_STATE/calls.log"
run i9 env DEVENV_STATE_DIR="$SANDBOX/state-i9" "$DEVENV" test:unit
if [[ "$RC" == 0 ]] \
  && grep -q 'run --rm tools pnpm -r run test:unit' "$MOCK_DOCKER_STATE/calls.log" \
  && ! grep -q 'run --rm tools run_gate' "$MOCK_DOCKER_STATE/calls.log"; then
  pass "I9 test:unit 容器命令为 pnpm（宿主函数 run_gate 不再进容器）"
else
  fail "I9" "rc=$RC log=$(cat "$MOCK_DOCKER_STATE/calls.log")"
fi

# ---------------------------------------------------------------------------
# 9. 锁与栈使用租约（#61）
# ---------------------------------------------------------------------------
B_SUFFIX="${B_PROJ##*-}"

# I10 租约 per-worktree：alpha 活跃租约只阻塞 alpha 排他命令，不阻塞 beta
sleep 30 &
I10_HOLDER=$!
mkdir -p "$DEVENV_LOCK_ROOT/stack-$A_SUFFIX.lease/$I10_HOLDER.0"
printf '%s %s\n' "$I10_HOLDER" "$(date +%s)" > "$DEVENV_LOCK_ROOT/stack-$A_SUFFIX.lease/$I10_HOLDER.0/owner"
wt_bash wt-beta 'REPO_ROOT="$1"; source "$1/devenv/lib/output.sh"; source "$1/devenv/lib/lock.sh"; source "$1/devenv/lib/snapshot.sh"; source "$1/devenv/lib/stack.sh"; REPO_ROOT="$1"; lock_acquire "stack-$WT_SUFFIX" 5' \
  && pass "I10 租约 per-worktree：beta 排他锁不被 alpha 租约阻塞" \
  || fail "I10" "B 被 alpha 租约阻塞"
set +e
wt_bash wt-alpha 'REPO_ROOT="$1"; source "$1/devenv/lib/output.sh"; source "$1/devenv/lib/lock.sh"; source "$1/devenv/lib/snapshot.sh"; source "$1/devenv/lib/stack.sh"; REPO_ROOT="$1"; lock_acquire "stack-$WT_SUFFIX" 2' 2>/dev/null
I10_RC=$?
set -e
kill -9 "$I10_HOLDER" 2>/dev/null; wait "$I10_HOLDER" 2>/dev/null || true
rm -rf "$DEVENV_LOCK_ROOT/stack-$A_SUFFIX.lease"
[[ "$I10_RC" == 6 ]] \
  && pass "I10 alpha 排他锁被本 worktree 租约阻塞（exit 6）" || fail "I10" "alpha rc=${I10_RC}（期望 6）"

# I11 机器级 prefetch 锁：真实入口 pull 期间锁在场且退出后释放
: > "$MOCK_DOCKER_STATE/calls.log"
rm -f "$MOCK_DOCKER_STATE/prefetch-lock-check.txt"
run i11 env MOCK_ASSERT_PREFETCH_LOCK=1 DEVENV_STATE_DIR="$SANDBOX/state-pf" "$DEVENV" prefetch
[[ "$RC" == 0 ]] && pass "I11 prefetch 成功" || fail "I11" "rc=$RC err=$(tail -3 "$SANDBOX/i11.err")"
[[ "$(grep -c 'prefetch-lock-held' "$MOCK_DOCKER_STATE/prefetch-lock-check.txt" 2>/dev/null || true)" == 2 ]] \
  && pass "I11 两个镜像 pull 全程持机器级 prefetch 锁" \
  || fail "I11" "锁未在场：$(cat "$MOCK_DOCKER_STATE/prefetch-lock-check.txt" 2>/dev/null)"
[[ ! -d "$DEVENV_LOCK_ROOT/prefetch.lock" ]] \
  && pass "I11 prefetch 退出后机器级锁释放" || fail "I11" "锁目录残留"

# I11b 跨 worktree：机器级 prefetch 锁在另一 worktree 同样生效（等待超时 exit 6）
sleep 30 &
PF_HOLDER=$!
mkdir -p "$DEVENV_LOCK_ROOT/prefetch.lock"
printf '%s %s\n' "$PF_HOLDER" "$(date +%s)" > "$DEVENV_LOCK_ROOT/prefetch.lock/owner"
run i11b env DEVENV_LOCK_TIMEOUT=2 DEVENV_WORKTREE_ID="wt-beta" DEVENV_STATE_DIR="$SANDBOX/state-pf" "$DEVENV" prefetch
kill -9 "$PF_HOLDER" 2>/dev/null; wait "$PF_HOLDER" 2>/dev/null || true
rm -rf "$DEVENV_LOCK_ROOT/prefetch.lock"
[[ "$RC" == 6 ]] && pass "I11b 机器级 prefetch 锁跨 worktree 冲突 exit 6" \
  || fail "I11b" "rc=${RC}（期望 6）"
grep -q 'prefetch' "$SANDBOX/i11b.err" \
  && pass "I11b 错误消息指出 prefetch 锁与修复线索" || fail "I11b" "stderr: $(tail -2 "$SANDBOX/i11b.err")"

# I12 真实入口读者命令持共享租约：test:unit 的容器创建时租约在场，退出后释放
: > "$MOCK_DOCKER_STATE/calls.log"
rm -f "$MOCK_DOCKER_STATE/lease-check.txt"
run i12 env MOCK_ASSERT_STACK_LEASE=1 DEVENV_WORKTREE_ID="wt-alpha" DEVENV_STATE_DIR="$SANDBOX/state-lease" "$DEVENV" test:unit
[[ "$RC" == 0 ]] && pass "I12 test:unit 成功" || fail "I12" "rc=$RC err=$(tail -3 "$SANDBOX/i12.err")"
grep -q 'stack-lease-held' "$MOCK_DOCKER_STATE/lease-check.txt" 2>/dev/null \
  && ! grep -q 'stack-lease-MISSING' "$MOCK_DOCKER_STATE/lease-check.txt" 2>/dev/null \
  && pass "I12 test:unit 容器命令执行期间持共享栈使用租约" \
  || fail "I12" "租约不在场：$(cat "$MOCK_DOCKER_STATE/lease-check.txt" 2>/dev/null)"
[[ -z "$(find "$DEVENV_LOCK_ROOT" -maxdepth 3 -path '*.lease/*/owner' -type f 2>/dev/null)" ]] \
  && pass "I12 test:unit 退出后租约释放" || fail "I12" "租约残留"

# I13 真实入口读者被排他锁阻塞：活跃 stack 锁 → verify 等待超时 exit 6，不触 compose
sleep 30 &
I13_HOLDER=$!
mkdir -p "$DEVENV_LOCK_ROOT/stack-$A_SUFFIX.lock"
printf '%s %s\n' "$I13_HOLDER" "$(date +%s)" > "$DEVENV_LOCK_ROOT/stack-$A_SUFFIX.lock/owner"
: > "$MOCK_DOCKER_STATE/calls.log"
run i13 env DEVENV_LOCK_TIMEOUT=2 DEVENV_WORKTREE_ID="wt-alpha" DEVENV_STATE_DIR="$SANDBOX/state-lease" "$DEVENV" verify
kill -9 "$I13_HOLDER" 2>/dev/null; wait "$I13_HOLDER" 2>/dev/null || true
rm -rf "$DEVENV_LOCK_ROOT/stack-$A_SUFFIX.lock"
[[ "$RC" == 6 ]] && pass "I13 排他锁在场时 verify exit 6" || fail "I13" "rc=${RC}（期望 6）"
[[ ! -s "$MOCK_DOCKER_STATE/calls.log" ]] \
  && pass "I13 冲突时未执行任何 compose 步骤（不产生半状态）" \
  || fail "I13" "冲突前已触 compose：$(cat "$MOCK_DOCKER_STATE/calls.log")"
grep -q '共享租约' "$SANDBOX/i13.err" \
  && pass "I13 错误消息说明租约与排他锁冲突" || fail "I13" "stderr: $(tail -2 "$SANDBOX/i13.err")"

# I14 真实入口排他命令被活跃租约阻塞：down / migrate → exit 6，不触 compose
sleep 30 &
I14_HOLDER=$!
mkdir -p "$DEVENV_LOCK_ROOT/stack-$A_SUFFIX.lease/$I14_HOLDER.0"
printf '%s %s\n' "$I14_HOLDER" "$(date +%s)" > "$DEVENV_LOCK_ROOT/stack-$A_SUFFIX.lease/$I14_HOLDER.0/owner"
: > "$MOCK_DOCKER_STATE/calls.log"
run i14 env DEVENV_LOCK_TIMEOUT=2 DEVENV_WORKTREE_ID="wt-alpha" DEVENV_STATE_DIR="$SANDBOX/state-down2" "$DEVENV" down
[[ "$RC" == 6 ]] && pass "I14 活跃租约时 down exit 6" || fail "I14" "down rc=${RC}（期望 6）"
[[ ! -s "$MOCK_DOCKER_STATE/calls.log" ]] \
  && pass "I14 down 冲突时未执行 compose down" || fail "I14" "down 已触 compose"
grep -q '活跃栈使用租约' "$SANDBOX/i14.err" \
  && pass "I14 错误消息列出活跃租约持有者" || fail "I14" "stderr: $(tail -2 "$SANDBOX/i14.err")"

run i14b env DEVENV_LOCK_TIMEOUT=2 DEVENV_WORKTREE_ID="wt-alpha" DEVENV_STATE_DIR="$SANDBOX/state-mig2" "$DEVENV" migrate
[[ "$RC" == 6 ]] && pass "I14 活跃租约时 migrate exit 6" || fail "I14" "migrate rc=${RC}（期望 6）"
kill -9 "$I14_HOLDER" 2>/dev/null; wait "$I14_HOLDER" 2>/dev/null || true
rm -rf "$DEVENV_LOCK_ROOT/stack-$A_SUFFIX.lease"

# I15 web --down 也是栈变更：持本 worktree stack 锁；冲突 exit 6，无冲突时执行 rm
sleep 30 &
I15_HOLDER=$!
mkdir -p "$DEVENV_LOCK_ROOT/stack-$A_SUFFIX.lock"
printf '%s %s\n' "$I15_HOLDER" "$(date +%s)" > "$DEVENV_LOCK_ROOT/stack-$A_SUFFIX.lock/owner"
: > "$MOCK_DOCKER_STATE/calls.log"
run i15 env DEVENV_LOCK_TIMEOUT=2 DEVENV_WORKTREE_ID="wt-alpha" DEVENV_STATE_DIR="$SANDBOX/state-web" "$DEVENV" web --down
kill -9 "$I15_HOLDER" 2>/dev/null; wait "$I15_HOLDER" 2>/dev/null || true
rm -rf "$DEVENV_LOCK_ROOT/stack-$A_SUFFIX.lock"
[[ "$RC" == 6 ]] && pass "I15 web --down 持栈锁（冲突 exit 6）" || fail "I15" "rc=${RC}（期望 6）"
[[ ! -s "$MOCK_DOCKER_STATE/calls.log" ]] \
  && pass "I15 web --down 冲突时未触 compose" || fail "I15" "已触 compose"

: > "$MOCK_DOCKER_STATE/calls.log"
run i15b env DEVENV_WORKTREE_ID="wt-alpha" DEVENV_STATE_DIR="$SANDBOX/state-web" "$DEVENV" web --down
[[ "$RC" == 0 ]] && pass "I15 web --down 无冲突成功" || fail "I15" "rc=$RC err=$(tail -2 "$SANDBOX/i15b.err")"
grep -q -- '--profile web rm -sf web' "$MOCK_DOCKER_STATE/calls.log" \
  && pass "I15 web --down 执行 compose profile web rm" || fail "I15" "log=$(cat "$MOCK_DOCKER_STATE/calls.log")"

# ---------------------------------------------------------------------------
# 10. 并发 web 入口与可观察命令面（#62）
# ---------------------------------------------------------------------------

# T-W1 省略 --port：注入裸容器端口（引擎运行时分配宿主端口，原子绑定、无探测竞态）；
#     实际端口经 docker port 回读进 --json 终值
: > "$MOCK_DOCKER_STATE/calls.log"
run w1 env MOCK_WEB_RUNNING=1 MOCK_WEB_PORT=49152 DEVENV_WORKTREE_ID="wt-alpha" DEVENV_STATE_DIR="$SANDBOX/state-w1" "$DEVENV" --json web
[[ "$RC" == 0 ]] && pass "W1 自动分配 web 成功" || fail "W1" "rc=$RC err=$(tail -3 "$SANDBOX/w1.err")"
grep -- '--profile web up -d web' "$MOCK_DOCKER_STATE/calls.log" | grep -qE 'WEB_PORT_SPEC=4173$' \
  && pass "W1 注入裸容器端口（WEB_PORT_SPEC=4173，引擎分配）" \
  || fail "W1" "注入不符：$(grep -- '--profile web up' "$MOCK_DOCKER_STATE/calls.log")"
if tail -1 "$SANDBOX/w1.out" | jq -e '.command == "web" and .status == "ok" and .exitCode == 0 and .port == "49152" and .url == "http://localhost:49152"' >/dev/null 2>&1; then
  pass "W1 终值含回读实际端口与 url"
else
  fail "W1" "终值不符：$(tail -1 "$SANDBOX/w1.out")"
fi
if jq -c . "$SANDBOX/w1.out" >/dev/null 2>&1; then
  pass "W1 stdout 全为 JSONL（进度/子进程输出不污染结果流）"
else
  fail "W1" "stdout 含非 JSON 行：$(head -3 "$SANDBOX/w1.out")"
fi

# T-W2 显式 --port：注入 host:container 固定发布；终值回读同一端口
: > "$MOCK_DOCKER_STATE/calls.log"
run w2 env MOCK_WEB_RUNNING=1 MOCK_WEB_PORT=8080 DEVENV_WORKTREE_ID="wt-alpha" DEVENV_STATE_DIR="$SANDBOX/state-w2" "$DEVENV" --json web --port 8080
[[ "$RC" == 0 ]] && pass "W2 显式端口 web 成功" || fail "W2" "rc=$RC err=$(tail -3 "$SANDBOX/w2.err")"
grep -- '--profile web up -d web' "$MOCK_DOCKER_STATE/calls.log" | grep -qE 'WEB_PORT_SPEC=8080:4173$' \
  && pass "W2 注入固定发布（WEB_PORT_SPEC=8080:4173）" \
  || fail "W2" "注入不符：$(grep -- '--profile web up' "$MOCK_DOCKER_STATE/calls.log")"
tail -1 "$SANDBOX/w2.out" | jq -e '.port == "8080" and .url == "http://localhost:8080"' >/dev/null 2>&1 \
  && pass "W2 终值回读显式端口" || fail "W2" "终值：$(tail -1 "$SANDBOX/w2.out")"

# T-W2b --port 非法值 → exit 2（用法错误）
run w2b env DEVENV_WORKTREE_ID="wt-alpha" DEVENV_STATE_DIR="$SANDBOX/state-w2b" "$DEVENV" web --port abc
[[ "$RC" == 2 ]] && pass "W2b --port 非数字 exit 2" || fail "W2b" "rc=${RC}（期望 2）"
run w2c env DEVENV_WORKTREE_ID="wt-alpha" DEVENV_STATE_DIR="$SANDBOX/state-w2b" "$DEVENV" web --port 70000
[[ "$RC" == 2 ]] && pass "W2c --port 超范围 exit 2" || fail "W2c" "rc=${RC}（期望 2）"

# T-W3 显式端口被其它 worktree 容器占用：exit 3，错误含服务/端口/占用者/内嵌修复命令
run w3 env MOCK_COMPOSE_WEB_FAIL=1 MOCK_FAIL_PORT=8080 \
  MOCK_PS_LINES='natural-enforcement-deadbeef-web-1 (project=natural-enforcement-deadbeef) 0.0.0.0:8080->4173/tcp' \
  DEVENV_WORKTREE_ID="wt-beta" DEVENV_STATE_DIR="$SANDBOX/state-w3" "$DEVENV" web --port 8080
[[ "$RC" == 3 ]] && pass "W3 容器占用冲突 exit 3" || fail "W3" "rc=${RC}（期望 3）err=$(tail -2 "$SANDBOX/w3.err")"
grep -q 'web' "$SANDBOX/w3.err" && grep -q '8080' "$SANDBOX/w3.err" \
  && grep -q 'natural-enforcement-deadbeef' "$SANDBOX/w3.err" \
  && grep -q 'devenv web --down' "$SANDBOX/w3.err" \
  && pass "W3 错误含服务/端口/占用者/修复命令" || fail "W3" "err=$(tail -2 "$SANDBOX/w3.err")"

# T-W4 compose 失败但无占用者（非端口问题）→ 通用失败 exit 4，不谎报端口占用
run w4 env MOCK_COMPOSE_WEB_FAIL=1 MOCK_FAIL_PORT=8091 \
  DEVENV_WORKTREE_ID="wt-beta" DEVENV_STATE_DIR="$SANDBOX/state-w4" "$DEVENV" web --port 8091
[[ "$RC" == 4 ]] && pass "W4 无占用者时通用失败 exit 4" || fail "W4" "rc=${RC}（期望 4）err=$(tail -2 "$SANDBOX/w4.err")"
grep -q 'web 启动失败' "$SANDBOX/w4.err" \
  && pass "W4 通用失败消息不谎报占用" || fail "W4" "err=$(tail -2 "$SANDBOX/w4.err")"

# T-W5 显式端口被非容器进程占用（真实监听者）→ exit 3 并如实区分占用者类型
if command -v python3 >/dev/null 2>&1; then
  python3 -m http.server 8092 --bind 127.0.0.1 >/dev/null 2>&1 &
  W5_LISTENER=$!
  sleep 1
  run w5 env MOCK_COMPOSE_WEB_FAIL=1 MOCK_FAIL_PORT=8092 \
    DEVENV_WORKTREE_ID="wt-beta" DEVENV_STATE_DIR="$SANDBOX/state-w5" "$DEVENV" web --port 8092
  kill "$W5_LISTENER" 2>/dev/null; wait "$W5_LISTENER" 2>/dev/null || true
  [[ "$RC" == 3 ]] && pass "W5 非容器进程占用 exit 3" || fail "W5" "rc=${RC}（期望 3）err=$(tail -2 "$SANDBOX/w5.err")"
  grep -q '非容器进程' "$SANDBOX/w5.err" \
    && pass "W5 错误区分非容器占用者" || fail "W5" "err=$(tail -2 "$SANDBOX/w5.err")"
else
  # python3 不在宿主白名单内（仅作测试 fixture）：白名单纯净化宿主上本分支由实机证据覆盖
  printf 'SKIP: W5 非容器进程占用（无 python3；分支由 #62 实机证据覆盖，见 Issue #62 / PR #86）\n'
fi

# T-P1 exec --json：原始流分流 stderr，stdout 只放 JSON（引擎事件 + 终值元数据）
run p1 env MOCK_EXEC_PAYLOAD=1 DEVENV_WORKTREE_ID="wt-alpha" DEVENV_STATE_DIR="$SANDBOX/state-p1" "$DEVENV" --json exec -- echo hello-stdout
[[ "$RC" == 0 ]] && pass "P1 exec --json 成功" || fail "P1" "rc=$RC err=$(tail -2 "$SANDBOX/p1.err")"
if jq -c . "$SANDBOX/p1.out" >/dev/null 2>&1; then
  pass "P1 stdout 全为 JSONL"
else
  fail "P1" "stdout 含非 JSON 行：$(head -3 "$SANDBOX/p1.out")"
fi
tail -1 "$SANDBOX/p1.out" | jq -e '.command == "exec" and .status == "ok" and .exitCode == 0' >/dev/null 2>&1 \
  && pass "P1 终值元数据完整" || fail "P1" "终值：$(tail -1 "$SANDBOX/p1.out")"
if grep -q 'hello-stdout' "$SANDBOX/p1.out"; then
  fail "P1 原始流污染结果流" "stdout 出现 hello-stdout"
else
  pass "P1 子进程 stdout 不混入结果流"
fi
grep -q 'hello-stdout' "$SANDBOX/p1.err" \
  && pass "P1 原始流走 stderr 独立通道" || fail "P1" "stderr 无原始输出：$(cat "$SANDBOX/p1.err")"

# T-P2 exec 子进程失败：退出码原样传播，终值 status=failed
run p2 env MOCK_EXEC_PAYLOAD=1 DEVENV_WORKTREE_ID="wt-alpha" DEVENV_STATE_DIR="$SANDBOX/state-p2" \
  "$DEVENV" --json exec -- bash -c 'echo out1; echo err1 >&2; exit 7'
[[ "$RC" == 7 ]] && pass "P2 子进程退出码原样传播（7）" || fail "P2" "rc=${RC}（期望 7）"
tail -1 "$SANDBOX/p2.out" | jq -e '.command == "exec" and .status == "failed" and .exitCode == 7' >/dev/null 2>&1 \
  && pass "P2 终值报告失败与子进程码" || fail "P2" "终值：$(tail -1 "$SANDBOX/p2.out")"
grep -q 'out1' "$SANDBOX/p2.err" && grep -q 'err1' "$SANDBOX/p2.err" \
  && pass "P2 子进程两路原始流均走 stderr" || fail "P2" "stderr: $(cat "$SANDBOX/p2.err")"

# T-P3 非 --json exec：原始流保持原通道（stdout 仍是子进程 stdout，可管道消费）
run p3 env MOCK_EXEC_PAYLOAD=1 DEVENV_WORKTREE_ID="wt-alpha" DEVENV_STATE_DIR="$SANDBOX/state-p3" "$DEVENV" exec -- echo raw-stdout
[[ "$RC" == 0 ]] && grep -q '^raw-stdout$' "$SANDBOX/p3.out" \
  && pass "P3 非 --json 原始流保持 stdout 通道" || fail "P3" "rc=$RC out=$(cat "$SANDBOX/p3.out")"
grep -q '"command"' "$SANDBOX/p3.out" \
  && fail "P3 非 --json 混入终值" "stdout 出现 JSON" || pass "P3 非 --json 无终值包装"

# T-P4 logs --json：原始日志走 stderr，stdout 只放终值
run p4 env MOCK_LOGS_LINE='log-line-1' DEVENV_WORKTREE_ID="wt-alpha" DEVENV_STATE_DIR="$SANDBOX/state-p4" "$DEVENV" --json logs api
[[ "$RC" == 0 ]] && pass "P4 logs --json 成功" || fail "P4" "rc=$RC err=$(tail -2 "$SANDBOX/p4.err")"
if jq -c . "$SANDBOX/p4.out" >/dev/null 2>&1 && ! grep -q 'log-line-1' "$SANDBOX/p4.out"; then
  pass "P4 stdout 全 JSON 且无原始日志"
else
  fail "P4" "stdout: $(cat "$SANDBOX/p4.out")"
fi
tail -1 "$SANDBOX/p4.out" | jq -e '.command == "logs" and .status == "ok"' >/dev/null 2>&1 \
  && pass "P4 logs 终值元数据完整" || fail "P4" "终值：$(tail -1 "$SANDBOX/p4.out")"
grep -q 'log-line-1' "$SANDBOX/p4.err" \
  && pass "P4 原始日志走 stderr" || fail "P4" "stderr 无日志行"

# T-P5 shell --json：同一透传包装（payload bash 以 /dev/null 为 stdin 立即退出）
run p5 env MOCK_EXEC_PAYLOAD=1 DEVENV_WORKTREE_ID="wt-alpha" DEVENV_STATE_DIR="$SANDBOX/state-p5" "$DEVENV" --json shell
[[ "$RC" == 0 ]] && pass "P5 shell --json 成功" || fail "P5" "rc=$RC err=$(tail -2 "$SANDBOX/p5.err")"
if jq -c . "$SANDBOX/p5.out" >/dev/null 2>&1 \
  && tail -1 "$SANDBOX/p5.out" | jq -e '.command == "shell" and .status == "ok"' >/dev/null 2>&1; then
  pass "P5 shell 终值元数据完整"
else
  fail "P5" "stdout: $(cat "$SANDBOX/p5.out")"
fi

# T-S1 status --json：web 运行中 → 实际端口可按 worktree 查询（项目标签过滤回读）
run s1 env MOCK_WEB_RUNNING=1 MOCK_WEB_PORT=49321 DEVENV_WORKTREE_ID="wt-alpha" DEVENV_STATE_DIR="$SANDBOX/state-s1" "$DEVENV" --json status
[[ "$RC" == 0 ]] && pass "S1 status --json 成功" || fail "S1" "rc=$RC err=$(tail -2 "$SANDBOX/s1.err")"
tail -1 "$SANDBOX/s1.out" | jq -e '.web_port == "49321" and .web_url == "http://localhost:49321"' >/dev/null 2>&1 \
  && pass "S1 status 终值含 web 实际端口" || fail "S1" "终值：$(tail -1 "$SANDBOX/s1.out")"

run s1b env MOCK_WEB_RUNNING=1 MOCK_WEB_PORT=49321 DEVENV_WORKTREE_ID="wt-alpha" DEVENV_STATE_DIR="$SANDBOX/state-s1" "$DEVENV" status
grep -q 'http://localhost:49321' "$SANDBOX/s1b.err" \
  && pass "S1 人读 status 报告 web 地址" || fail "S1" "stderr: $(grep -i web "$SANDBOX/s1b.err")"

# T-S2 status --json：web 未运行 → web_port 如实报 none
run s2 env DEVENV_WORKTREE_ID="wt-alpha" DEVENV_STATE_DIR="$SANDBOX/state-s2" "$DEVENV" --json status
[[ "$RC" == 0 ]] && pass "S2 status --json 成功（web 未运行）" || fail "S2" "rc=$RC"
tail -1 "$SANDBOX/s2.out" | jq -e '.web_port == "none"' >/dev/null 2>&1 \
  && pass "S2 web 未运行时如实报告 none" || fail "S2" "终值：$(tail -1 "$SANDBOX/s2.out")"

# T-C1 零宿主端口不变量静态守卫：compose.yaml 仅 web 服务发布端口
C1_OWNERS="$(awk '/^  [a-z0-9]+:/{svc=$1} /^    ports:$/{print svc}' "$MINI/devenv/compose.yaml")"
[[ "$C1_OWNERS" == "web:" ]] \
  && pass "C1 compose 仅 web 发布宿主端口（调试零端口不变量）" \
  || fail "C1" "ports: 出现在：$C1_OWNERS"

# ---------------------------------------------------------------------------
echo "------------------------------------------------------------"
echo "per-worktree 隔离离线测试完成：$PASS_COUNT 通过，$FAILURES 失败"
[[ "$FAILURES" == 0 ]]
