#!/usr/bin/env bash
# ============================================================================
# 快照与不可变绑定离线测试（#58）——不访问真实引擎（docker 全部 mock）
#
# 覆盖（Spec-工程基座 §3 ensure_fresh_workspace 固定输入快照 + 不可变绑定）：
#   1. 快照采集：稳定工作树双采集一致；修改/新增/删除均反映到树哈希；
#      gitignored 内容（node_modules、.devenv-state）不进入快照
#   2. 采集竞态：工作树持续变化 → 明确拒绝（exit 4），不产生混合内容却报告
#      来源一致；重试后稳定 → 接受
#   3. 物化：快照目录含构建输入；mtime 归一（跨构建缓存稳定）
#   4. 构建输入清单：label 用 manifest 覆盖 Dockerfile/构建脚本/锁文件
#   5. 新鲜度：状态文件 + 镜像 label 一致 → 跳过重建；不符/无状态/镜像丢失 → 重建
#   6. 不可变绑定：compose 注入 image ID（非可变 tag）；build 记录状态
#   7. devenv build 全命令：快照构建 tools+workspace；lockgen 有/无 lockfile
#      双靶（lockgen / lockgen-fresh）；lockgen 后重新采集
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
SANDBOX=$(mktemp -d /tmp/devenv-snapshot-offline.XXXXXX)
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

# mock docker：build 记录标签并落假镜像（id=内容哈希）；image inspect 按格式串应答；
# compose 仅记录；create/cp/rm/rmi 支撑 lockgen 路径。
MOCK_DOCKER_STATE="$SANDBOX/docker-state"
mkdir -p "$MOCK_DOCKER_STATE/images" "$MOCK_DOCKER_STATE/tags" "$SANDBOX/stubbin"
cat > "$SANDBOX/stubbin/docker" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
STATE="${MOCK_DOCKER_STATE:?}"
mkdir -p "$STATE/images" "$STATE/tags"
{
  printf 'docker'
  for a in "$@"; do printf ' %q' "$a"; done
  printf ' | WORKSPACE_IMAGE=%s\n' "${WORKSPACE_IMAGE:-}"
} >> "$STATE/calls.log"
cmd="${1:-}"; [[ $# -gt 0 ]] && shift
case "$cmd" in
  version)
    cat "${MOCK_DOCKER_VERSION_JSON:?}" ;;
  compose)
    [[ "${1:-}" == "version" ]] && echo "2.40.3"
    exit 0 ;;
  build)
    tag=""; snap=""; inputs=""; target=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        -t) tag="$2"; shift 2 ;;
        --label)
          case "$2" in
            devenv.snapshot.hash=*) snap="${2#devenv.snapshot.hash=}" ;;
            devenv.snapshot.inputs=*) inputs="${2#devenv.snapshot.inputs=}" ;;
          esac
          shift 2 ;;
        --target) target="$2"; shift 2 ;;
        --build-arg|-f) shift 2 ;;
        *) shift ;;
      esac
    done
    id="sha256:$(printf '%s:%s:%s' "$tag" "$snap" "$target" | sha256sum | awk '{print $1}')"
    printf 'SNAPSHOT_HASH=%s\nINPUTS=%s\nTAG=%s\n' "$snap" "$inputs" "$tag" > "$STATE/images/$id"
    if [[ -n "$tag" ]]; then
      printf '%s\n' "$id" > "$STATE/tags/$(printf '%s' "$tag" | tr '/:' '__')"
    fi
    # podman 兼容层 -q 输出无前缀 64hex（实测），lib 负责归一；MOCK_BUILD_PREFIXED=1 模拟 docker 带前缀
    if [[ "${MOCK_BUILD_PREFIXED:-}" == "1" ]]; then printf '%s\n' "$id"; else printf '%s\n' "${id#sha256:}"; fi ;;
  image)
    [[ "${1:-}" == "inspect" ]] || exit 0
    shift
    ref=""; fmt=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --format) fmt="$2"; shift 2 ;;
        *) ref="$1"; shift ;;
      esac
    done
    id="$ref"
    if [[ "$ref" != sha256:* ]]; then
      local_tag_file="$STATE/tags/$(printf '%s' "$ref" | tr '/:' '__')"
      [[ -f "$local_tag_file" ]] || exit 1
      id="$(cat "$local_tag_file")"
    fi
    [[ -f "$STATE/images/$id" ]] || exit 1
    case "$fmt" in
      '{{.Id}}') printf '%s\n' "$id" ;;
      *devenv.snapshot.hash*) awk -F= '/^SNAPSHOT_HASH=/{print $2}' "$STATE/images/$id" ;;
      *devenv.snapshot.inputs*) awk -F= '/^INPUTS=/{print $2}' "$STATE/images/$id" ;;
      *) printf '\n' ;;
    esac ;;
  create) printf 'cid-mock\n' ;;
  cp)
    dest="${!#}"
    printf 'lockfileVersion: "9.0"\n# mock 导出\n' > "$dest" ;;
  rm|rmi) exit 0 ;;
  ps)
    # verify_svc_image 用：container fixture 在场时报告一个运行容器
    [[ -f "$STATE/container" ]] && printf 'cid-fixture\n'
    exit 0 ;;
  inspect)
    # 容器 inspect：返回 fixture 镜像 ID（image inspect 走上面 image 分支）
    [[ -f "$STATE/container-image" ]] && cat "$STATE/container-image"
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
export DEVENV_STATE_DIR="$MINI/.devenv-state"
export DOCKER_HOST="unix:///mock.sock"
export MOCK_DOCKER_VERSION_JSON="$SANDBOX/version-podman.json"

# 独立参照：用真实索引 git add -A + write-tree 计算期望树（与 lib 的临时索引路径不同实现）
expected_tree() { git -C "$MINI" add -A && git -C "$MINI" write-tree; }

# shellcheck source=../lib/output.sh
source "$REPO_ROOT/devenv/lib/output.sh"
# shellcheck source=../lib/lock.sh
source "$REPO_ROOT/devenv/lib/lock.sh"
# shellcheck source=../lib/snapshot.sh
source "$REPO_ROOT/devenv/lib/snapshot.sh"
# shellcheck source=../lib/stack.sh
source "$REPO_ROOT/devenv/lib/stack.sh"
REPO_ROOT="$MINI"  # lib 函数运行时读 REPO_ROOT——指向 mini 仓库

run() { # run <name> <cmd...>；当前 shell 执行（仅用于不会 die 的成功路径），记录 RC 与输出
  local name="$1"; shift
  set +e
  "$@" > "$SANDBOX/$name.out" 2> "$SANDBOX/$name.err"
  RC=$?
  set -e
}

runsub() { # runsub <name> <cmd...>；子 shell 执行（die/exit 不拖垮套件），记录 RC 与输出
  local name="$1"; shift
  set +e
  ( "$@" ) > "$SANDBOX/$name.out" 2> "$SANDBOX/$name.err"
  RC=$?
  set -e
}

ensure_and_echo() { # 子 shell 内跑新鲜度检查并回传绑定结果（供 runsub 调用）
  ensure_fresh_workspace
  printf 'EFFECTIVE=%s\n' "$WS_IMAGE_EFFECTIVE"
}

# ---------------------------------------------------------------------------
# 1. 快照采集语义
# ---------------------------------------------------------------------------

H0="$(snapshot_capture)"
[[ "$H0" =~ ^[0-9a-f]{40}$ ]] && pass "S1 采集返回 git 树哈希" || fail "S1" "非树哈希：$H0"
H0b="$(snapshot_capture)"
[[ "$H0" == "$H0b" ]] && pass "S1 稳定工作树双采集一致" || fail "S1" "双采集不一致：$H0 vs $H0b"
[[ "$H0" == "$(expected_tree)" ]] && pass "S1 快照==独立参照树（git add -A）" || fail "S1" "与独立参照不符"

printf '// change\n' >> "$MINI/package.json"
H1="$(snapshot_capture)"
[[ "$H1" != "$H0" && "$H1" == "$(expected_tree)" ]] && pass "S2 修改被快照覆盖" || fail "S2" "修改未反映：$H1"

printf 'probe\n' > "$MINI/newfile.txt"
H2="$(snapshot_capture)"
H2_LIST="$(git -C "$MINI" archive "$H2" | tar -t)"  # 先落变量再 grep：grep -q 早退会给 tar 发 SIGPIPE（pipefail 下抖动）
if [[ "$H2" != "$H1" ]] && grep -qx 'newfile.txt' <<< "$H2_LIST"; then
  pass "S3 新增（未跟踪）文件进入快照"
else
  fail "S3" "新增文件未进入快照"
fi

rm "$MINI/pnpm-lock.yaml"
H3="$(snapshot_capture)"
H3_LIST="$(git -C "$MINI" archive "$H3" | tar -t)"
if [[ "$H3" != "$H2" ]] && ! grep -qx 'pnpm-lock.yaml' <<< "$H3_LIST"; then
  pass "S4 删除被快照覆盖"
else
  fail "S4" "删除未反映到快照"
fi
git -C "$MINI" checkout -q -- pnpm-lock.yaml

mkdir -p "$MINI/node_modules/some-pkg" "$MINI/.devenv-state"
printf 'x\n' > "$MINI/node_modules/some-pkg/index.js"
printf 'y\n' > "$MINI/.devenv-state/scratch"
H4="$(snapshot_capture)"
[[ "$H4" == "$(snapshot_capture)" && "$H4" == "$(expected_tree)" ]] \
  && pass "S5 gitignored 内容不进入快照" || fail "S5" "gitignored 内容泄漏进快照"

# ---------------------------------------------------------------------------
# 2. 采集竞态：持续变化 → 明确拒绝（exit 4）；重试后稳定 → 接受
# ---------------------------------------------------------------------------

ORIG_TREE_ONCE="$(declare -f snapshot_tree_once)"

# S6 双采集永不一致 → die 4
snapshot_tree_once() { printf 'unstable-%s-%s\n' "$RANDOM" "$RANDOM"; }
runsub s6 snapshot_capture
[[ "$RC" == 4 ]] && pass "S6 持续变化明确拒绝 exit 4" || fail "S6" "rc=$RC（期望 4）"
grep -q '拒绝' "$SANDBOX/s6.err" && pass "S6 拒绝原因入 stderr" || fail "S6" "stderr 无拒绝说明"

# S7 第 2 次尝试后稳定 → 接受（计数走文件：$(...) 子 shell 会丢变量增量）
eval "$ORIG_TREE_ONCE"  # 还原
CALL_FILE="$SANDBOX/call-n"
printf '0\n' > "$CALL_FILE"
snapshot_tree_once() {
  local n=$(( $(cat "$CALL_FILE") + 1 ))
  printf '%s\n' "$n" > "$CALL_FILE"
  if (( n <= 2 )); then printf 'unstable-%s\n' "$n"; else printf 'stable-tree\n'; fi
}
runsub s7 snapshot_capture
[[ "$RC" == 0 && "$(cat "$SANDBOX/s7.out")" == "stable-tree" ]] \
  && pass "S7 重试后稳定即接受" || fail "S7" "rc=$RC out=$(cat "$SANDBOX/s7.out")"
eval "$ORIG_TREE_ONCE"  # 还原

# ---------------------------------------------------------------------------
# 3. 物化与构建输入清单
# ---------------------------------------------------------------------------

SNAP_DIR="$SANDBOX/materialized"
mkdir -p "$SNAP_DIR"
snapshot_materialize "$H4" "$SNAP_DIR"
[[ -f "$SNAP_DIR/devenv/workspace.Dockerfile" && -f "$SNAP_DIR/pnpm-lock.yaml" && -f "$SNAP_DIR/apps/api/package.json" ]] \
  && pass "S8 物化目录含构建输入（Dockerfile/锁文件/manifest）" || fail "S8" "物化缺文件"
touch -t 197001010000 "$SANDBOX/ref-epoch"
if [[ ! "$SNAP_DIR/pnpm-lock.yaml" -nt "$SANDBOX/ref-epoch" && ! "$SANDBOX/ref-epoch" -nt "$SNAP_DIR/pnpm-lock.yaml" ]]; then
  pass "S8 物化 mtime 归一到固定纪元"
else
  fail "S8" "mtime 未归一"
fi
[[ ! -e "$SNAP_DIR/.git" && ! -e "$SNAP_DIR/node_modules" && ! -e "$SNAP_DIR/.devenv-state" ]] \
  && pass "S8 物化不含 .git/gitignored" || fail "S8" "物化混入 .git 或 gitignored"

# S8b 物化目录登记进当前 shell 的清理数组（$(...) 子 shell 登记会丢，EXIT 清理失效）
SNAPSHOT_TMPDIRS=()
snapshot_materialize_new "$H4"
[[ "${#SNAPSHOT_TMPDIRS[@]}" == 1 && -d "$SNAPSHOT_MATERIALIZED_DIR" ]] \
  && pass "S8b 物化目录登记 EXIT 清理（当前 shell）" || fail "S8b" "登记丢失：${#SNAPSHOT_TMPDIRS[@]}"
snapshot_cleanup
[[ ! -d "$SNAPSHOT_MATERIALIZED_DIR" ]] \
  && pass "S8b snapshot_cleanup 清理物化目录" || fail "S8b" "清理失效"

MANIFEST="$(snapshot_inputs_manifest "$H4")"
LOCK_SHA="$(git -C "$MINI" rev-parse "$H4:pnpm-lock.yaml")"
DOCKERFILE_SHA="$(git -C "$MINI" rev-parse "$H4:devenv/workspace.Dockerfile")"
API_PKG_SHA="$(git -C "$MINI" rev-parse "$H4:apps/api/package.json")"
[[ "$MANIFEST" == *"pnpm-lock.yaml=$LOCK_SHA;"* && "$MANIFEST" == *"devenv/workspace.Dockerfile=$DOCKERFILE_SHA;"* ]] \
  && pass "S9 构建输入清单含 Dockerfile/锁文件 blob 哈希" || fail "S9" "清单缺项：$MANIFEST"
[[ "$MANIFEST" == *"apps/api/package.json=$API_PKG_SHA;"* ]] \
  && pass "S9 清单动态覆盖各包 package.json" || fail "S9" "缺 apps/api/package.json"

# ---------------------------------------------------------------------------
# 4. 新鲜度与不可变绑定（ensure_fresh_workspace / compose）
# ---------------------------------------------------------------------------

# S10 状态 + 镜像 label 一致 → 跳过重建，绑定状态镜像 ID
H="$(snapshot_capture)"
IMG="sha256:$(printf 'fixture-image' | sha256sum | awk '{print $1}')"
printf 'SNAPSHOT_HASH=%s\nINPUTS=\nTAG=\n' "$H" > "$MOCK_DOCKER_STATE/images/$IMG"
snapshot_state_write "$H" "$IMG"
: > "$MOCK_DOCKER_STATE/calls.log"
runsub s10 ensure_and_echo
S10_EFFECTIVE="$(awk -F= '/^EFFECTIVE=/{print $2}' "$SANDBOX/s10.out")"
if [[ "$RC" == 0 && "$S10_EFFECTIVE" == "$IMG" ]] && ! grep -q 'docker build' "$MOCK_DOCKER_STATE/calls.log"; then
  pass "S10 快照一致跳过重构并绑定不可变 ID"
else
  fail "S10" "rc=$RC effective=$S10_EFFECTIVE builds=$(grep -c 'docker build' "$MOCK_DOCKER_STATE/calls.log")"
fi

# S11 快照不符 → 重建；状态更新；构建带快照 label；绑定新 ID
snapshot_state_write "0000000000000000000000000000000000000000" "$IMG"
: > "$MOCK_DOCKER_STATE/calls.log"
runsub s11 ensure_and_echo
NEW_IMG="$(awk -F= '/^EFFECTIVE=/{print $2}' "$SANDBOX/s11.out")"
EXPECTED_NEW="sha256:$(printf '%s:%s:%s' "natural-enforcement/workspace:local" "$H" "" | sha256sum | awk '{print $1}')"
if [[ "$RC" == 0 && "$NEW_IMG" == "$EXPECTED_NEW" && "$NEW_IMG" != "$IMG" ]]; then
  pass "S11 快照不符重建并绑定新不可变 ID"
else
  fail "S11" "rc=$RC effective=$NEW_IMG（期望 $EXPECTED_NEW）"
fi
grep -q -- "--label devenv.snapshot.hash=$H" "$MOCK_DOCKER_STATE/calls.log" \
  && pass "S11 构建携带快照哈希 label" || fail "S11" "缺快照 label：$(cat "$MOCK_DOCKER_STATE/calls.log")"
grep -q "SNAPSHOT_HASH=$H" "$DEVENV_STATE_DIR/workspace-image.env" \
  && pass "S11 状态文件记录新快照哈希" || fail "S11" "状态未更新"

# S11b docker 带前缀输出（CI docker 路径）同样归一绑定
: > "$MOCK_DOCKER_STATE/calls.log"
snapshot_state_write "0000000000000000000000000000000000000000" "$IMG"
export MOCK_BUILD_PREFIXED=1
runsub s11b ensure_and_echo
unset MOCK_BUILD_PREFIXED
S11B_EFFECTIVE="$(awk -F= '/^EFFECTIVE=/{print $2}' "$SANDBOX/s11b.out")"
[[ "$RC" == 0 && "$S11B_EFFECTIVE" == "$EXPECTED_NEW" ]] \
  && pass "S11b 带前缀构建输出归一为同一不可变 ID" || fail "S11b" "rc=$RC effective=$S11B_EFFECTIVE"

# S12 无状态文件 → 重建
rm -f "$DEVENV_STATE_DIR/workspace-image.env"
: > "$MOCK_DOCKER_STATE/calls.log"
runsub s12 ensure_and_echo
[[ "$RC" == 0 ]] && grep -q 'docker build' "$MOCK_DOCKER_STATE/calls.log" \
  && pass "S12 无状态文件触发重建" || fail "S12" "未重建（rc=$RC）"

# S13 状态指向的镜像已丢失 → 重建
snapshot_state_write "$H" "sha256:$(printf 'deleted' | sha256sum | awk '{print $1}')"
: > "$MOCK_DOCKER_STATE/calls.log"
runsub s13 ensure_and_echo
[[ "$RC" == 0 ]] && grep -q 'docker build' "$MOCK_DOCKER_STATE/calls.log" \
  && pass "S13 镜像丢失触发重建" || fail "S13" "未重建（rc=$RC）"

# S14 compose 注入：EFFECTIVE 优先 → 状态回退 → tag 兜底
: > "$MOCK_DOCKER_STATE/calls.log"
WS_IMAGE_EFFECTIVE="sha256:aaa"
runsub s14a compose ps
grep -q 'WORKSPACE_IMAGE=sha256:aaa' "$MOCK_DOCKER_STATE/calls.log" \
  && pass "S14 compose 注入 EFFECTIVE 不可变 ID" || fail "S14" "未注入 EFFECTIVE"
WS_IMAGE_EFFECTIVE=""
snapshot_state_write "$H" "sha256:bbb"
: > "$MOCK_DOCKER_STATE/calls.log"
runsub s14b compose ps
grep -q 'WORKSPACE_IMAGE=sha256:bbb' "$MOCK_DOCKER_STATE/calls.log" \
  && pass "S14 无 EFFECTIVE 回退状态 ID" || fail "S14" "未回退状态 ID"
rm -f "$DEVENV_STATE_DIR/workspace-image.env"
: > "$MOCK_DOCKER_STATE/calls.log"
runsub s14c compose ps
grep -q 'WORKSPACE_IMAGE=natural-enforcement/workspace:local' "$MOCK_DOCKER_STATE/calls.log" \
  && pass "S14 无状态兜底可变 tag（仅 down/ps 等场景）" || fail "S14" "未兜底 tag"

# S15 启动核对（verify_svc_image）：运行容器镜像 == 绑定 ID 通过；不符拒绝
printf '%s\n' "$EXPECTED_NEW" > "$MOCK_DOCKER_STATE/container-image"
: > "$MOCK_DOCKER_STATE/container"
WS_IMAGE_EFFECTIVE="$EXPECTED_NEW"
runsub s15a verify_svc_image api
[[ "$RC" == 0 ]] && pass "S15 启动核对一致通过" || fail "S15" "rc=$RC（期望 0）"
WS_IMAGE_EFFECTIVE="sha256:$(printf 'other' | sha256sum | awk '{print $1}')"
runsub s15b verify_svc_image api
[[ "$RC" == 4 ]] && pass "S15 启动核对不符 exit 4" || fail "S15" "rc=$RC（期望 4）"
rm -f "$MOCK_DOCKER_STATE/container" "$MOCK_DOCKER_STATE/container-image"

# ---------------------------------------------------------------------------
# 5. devenv build 全命令（子进程驱动真入口）
# ---------------------------------------------------------------------------

DEVENV="$MINI/devenv/devenv"

# S16 lockfile 在场：tools + workspace 快照构建，不走 lockgen；状态/标签齐全
git -C "$MINI" checkout -q -- . 2>/dev/null || true
: > "$MOCK_DOCKER_STATE/calls.log"
run s16 "$DEVENV" build
if [[ "$RC" == 0 ]] \
  && grep -q 'devenv/tools.Dockerfile' "$MOCK_DOCKER_STATE/calls.log" \
  && grep -q 'devenv/workspace.Dockerfile' "$MOCK_DOCKER_STATE/calls.log" \
  && ! grep -q 'lockgen' "$MOCK_DOCKER_STATE/calls.log"; then
  pass "S16 build 快照构建 tools+workspace（无 lockgen）"
else
  fail "S16" "rc=$RC log=$(cat "$MOCK_DOCKER_STATE/calls.log")"
fi
BT="$DEVENV_STATE_DIR/workspace-image.env"
if [[ -f "$BT" ]] && grep -q "SNAPSHOT_HASH=$(expected_tree)" "$BT"; then
  pass "S16 状态记录构建快照哈希"
else
  fail "S16" "状态哈希不符：$(cat "$BT" 2>/dev/null)"
fi
# S16b 构建输入来自快照：tools 构建上下文是物化目录（非活工作树），NODE_IMAGE 取自快照内 images.lock
TOOLS_LINE="$(grep 'tools.Dockerfile' "$MOCK_DOCKER_STATE/calls.log")"
if [[ "$TOOLS_LINE" == *"ne-snapshot."* && "$TOOLS_LINE" != *"$MINI "* && "$TOOLS_LINE" == *"NODE_IMAGE=node:26.13.1-slim"* ]]; then
  pass "S16b tools 构建上下文与 NODE_IMAGE 取自快照"
else
  fail "S16b" "tools 构建未用快照输入：$TOOLS_LINE"
fi

# S17 lockfile 缺席：lockgen-fresh 全量解析 → 导出 → 重新采集 → workspace 构建
rm "$MINI/pnpm-lock.yaml"
: > "$MOCK_DOCKER_STATE/calls.log"
run s17 "$DEVENV" build
LOG="$MOCK_DOCKER_STATE/calls.log"
if [[ "$RC" == 0 ]] && grep -q -- '--target lockgen-fresh' "$LOG" \
  && grep -q 'docker cp' "$LOG" && grep -q 'devenv/workspace.Dockerfile' "$LOG" \
  && [[ -f "$MINI/pnpm-lock.yaml" ]]; then
  pass "S17 无 lockfile 走 lockgen-fresh 并导出后重建"
else
  fail "S17" "rc=$RC log=$LOG"
fi
if grep -q "SNAPSHOT_HASH=$(expected_tree)" "$DEVENV_STATE_DIR/workspace-image.env"; then
  pass "S17 lockgen 后状态记录新快照（含导出 lockfile）"
else
  fail "S17" "状态哈希未随 lockgen 更新"
fi

# S18 --lockgen 且 lockfile 在场：走增量 lockgen 靶
: > "$MOCK_DOCKER_STATE/calls.log"
run s18 "$DEVENV" build --lockgen
LOG="$MOCK_DOCKER_STATE/calls.log"
if [[ "$RC" == 0 ]] && grep -q -- '--target lockgen ' "$LOG" && ! grep -q 'lockgen-fresh' "$LOG"; then
  pass "S18 --lockgen 有 lockfile 走增量 lockgen 靶"
else
  fail "S18" "rc=$RC log=$LOG"
fi

# ---------------------------------------------------------------------------
echo "------------------------------------------------------------"
echo "快照与不可变绑定离线测试完成：$PASS_COUNT 通过，$FAILURES 失败"
[[ "$FAILURES" == 0 ]]
