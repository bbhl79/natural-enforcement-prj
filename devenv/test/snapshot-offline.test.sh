#!/usr/bin/env bash
# ============================================================================
# 快照与不可变绑定离线测试（#58）——不访问真实引擎（docker 全部 mock）
#
# 覆盖（Spec-工程基座 §3 ensure_fresh_workspace 固定输入快照 + 不可变绑定）：
#   1. 快照采集：稳定工作树采集一致；修改/新增/删除均反映到树哈希；
#      gitignored 内容（node_modules、.devenv-state）不进入快照
#   2. 采集一致性（stat 括号）：窗口内写入 → 重试；持续写入 → 明确拒绝（exit 4）；
#      确定性多文件竞态（钩子注入）：只接受完整版本或明确拒绝，禁止混合组合
#   3. 物化：快照目录含构建输入；mtime 归一；登记 EXIT 清理（当前 shell）
#   4. 构建输入清单：label 用 manifest 覆盖 Dockerfile/构建脚本/锁文件/各包 manifest
#   5. 新鲜度：无状态/镜像不存在/label 不符 → 重建；一致 → 跳过；
#      引擎故障 → die 3（不吞）；真实入口 set -Eeuo pipefail 下不提前退出
#   6. 不可变绑定链：固定快照 → tools 不可变 ID → workspace 不可变 ID；
#      tools 输入变更/标签覆盖反例；compose 注入 image ID；启动核对
#   7. devenv build 全命令：快照构建 tools+workspace；lockgen 双靶；lockgen 后重新采集
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

# mock docker：build 记录标签/build-arg 并落假镜像（id=输入哈希）；image ls/inspect
# 按格式串应答；compose 仅记录；create/cp/rm/rmi 支撑 lockgen 路径。
MOCK_DOCKER_STATE="$SANDBOX/docker-state"
mkdir -p "$MOCK_DOCKER_STATE/images" "$MOCK_DOCKER_STATE/tags" "$SANDBOX/stubbin"
cat > "$SANDBOX/stubbin/docker" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
STATE="${MOCK_DOCKER_STATE:?}"
mkdir -p "$STATE/images" "$STATE/tags"
{
  printf 'docker'
  for a in "$@"; do printf ' %s' "$a"; done
  printf ' | WORKSPACE_IMAGE=%s\n' "${WORKSPACE_IMAGE:-}"
} >> "$STATE/calls.log"
cmd="${1:-}"; [[ $# -gt 0 ]] && shift
case "$cmd" in
  version)
    [[ "${MOCK_ENGINE_DOWN:-}" == "1" ]] && exit 1
    cat "${MOCK_DOCKER_VERSION_JSON:?}" ;;
  compose)
    [[ "${1:-}" == "version" ]] && echo "2.40.3"
    exit 0 ;;
  build)
    tag=""; snap=""; inputs=""; target=""; base=""; toolshash=""; bargs=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        -t) tag="$2"; shift 2 ;;
        --label)
          case "$2" in
            devenv.snapshot.hash=*) snap="${2#devenv.snapshot.hash=}" ;;
            devenv.snapshot.inputs=*) inputs="${2#devenv.snapshot.inputs=}" ;;
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
    [[ "${MOCK_BUILD_FAIL:-}" == "1" ]] && exit 1
    id="sha256:$(printf '%s|%s|%s|%s' "$tag" "$snap" "$target" "$bargs" | sha256sum | awk '{print $1}')"
    printf 'SNAPSHOT_HASH=%s\nINPUTS=%s\nBASE_IMAGE=%s\nTOOLS_HASH=%s\nTAG=%s\n' \
      "$snap" "$inputs" "$base" "$toolshash" "$tag" > "$STATE/images/$id"
    if [[ -n "$tag" ]]; then
      printf '%s\n' "$id" > "$STATE/tags/$(printf '%s' "$tag" | tr '/:' '__')"
    fi
    # podman 兼容层 -q 输出无前缀 64hex（实测），lib 负责归一；MOCK_BUILD_PREFIXED=1 模拟 docker 带前缀
    if [[ "${MOCK_BUILD_PREFIXED:-}" == "1" ]]; then printf '%s\n' "$id"; else printf '%s\n' "${id#sha256:}"; fi ;;
  image)
    sub="${1:-}"; [[ $# -gt 0 ]] && shift
    [[ "$sub" == "inspect" ]] || exit 0
    [[ "${MOCK_ENGINE_DOWN:-}" == "1" ]] && exit 1
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
      '{{.Id}}') printf '%s\n' "$id" ;;
      *devenv.snapshot.hash*devenv.base.image*)
        h="$(awk -F= '/^SNAPSHOT_HASH=/{print $2}' "$STATE/images/$id")"
        b="$(awk -F= '/^BASE_IMAGE=/{print $2}' "$STATE/images/$id")"
        printf '%s %s\n' "$h" "$b" ;;
      *devenv.snapshot.hash*) awk -F= '/^SNAPSHOT_HASH=/{print $2}' "$STATE/images/$id" ;;
      *devenv.snapshot.inputs*) awk -F= '/^INPUTS=/{print $2}' "$STATE/images/$id" ;;
      *devenv.tools.input-hash*) awk -F= '/^TOOLS_HASH=/{print $2}' "$STATE/images/$id" ;;
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

runsub() { # runsub <name> <cmd...>；子 shell 执行——被测进程保留与真实入口一致的
  # set -Eeuo pipefail（父测试只捕获退出码，不掩盖真实入口行为）
  local name="$1"; shift
  set +e
  ( set -Eeuo pipefail; "$@" ) > "$SANDBOX/$name.out" 2> "$SANDBOX/$name.err"
  RC=$?
  set -e
}

ensure_and_echo() { # 子 shell 内跑新鲜度检查并回传绑定结果（供 runsub 调用）
  ensure_fresh_workspace
  printf 'EFFECTIVE=%s\n' "$WS_IMAGE_EFFECTIVE"
}

# 镜像 fixture：write_image <id> <snapHash> <baseImage> <toolsHash>
write_image() {
  printf 'SNAPSHOT_HASH=%s\nINPUTS=\nBASE_IMAGE=%s\nTOOLS_HASH=%s\nTAG=\n' "$2" "$3" "$4" \
    > "$MOCK_DOCKER_STATE/images/$1"
}

# ---------------------------------------------------------------------------
# 1. 快照采集语义
# ---------------------------------------------------------------------------

H0="$(snapshot_capture)"
[[ "$H0" =~ ^[0-9a-f]{40}$ ]] && pass "S1 采集返回 git 树哈希" || fail "S1" "非树哈希：$H0"
H0b="$(snapshot_capture)"
[[ "$H0" == "$H0b" ]] && pass "S1 稳定工作树采集一致" || fail "S1" "两次采集不一致：$H0 vs $H0b"
[[ "$H0" == "$(expected_tree)" ]] && pass "S1 快照==独立参照树（git add -A）" || fail "S1" "与独立参照不符"

printf '\n' >> "$MINI/package.json"
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
# 2. 采集一致性（stat 括号）：窗口内写入 → 重试；持续写入 → 明确拒绝
# ---------------------------------------------------------------------------

ORIG_ONCE="$(declare -f snapshot_capture_once)"

# S6 每次采集窗口内均有写入 → die 4（确定性，不撞概率）
snapshot_capture_once() { return 1; }
runsub s6 snapshot_capture
[[ "$RC" == 4 ]] && pass "S6 持续写入明确拒绝 exit 4" || fail "S6" "rc=${RC}（期望 4）"
grep -q '拒绝' "$SANDBOX/s6.err" && pass "S6 拒绝原因入 stderr" || fail "S6" "stderr 无拒绝说明"

# S7 第 2 次尝试后稳定 → 接受（计数走文件：$(...) 子 shell 会丢变量增量）
eval "$ORIG_ONCE"  # 还原
CALL_FILE="$SANDBOX/call-n"
printf '0\n' > "$CALL_FILE"
snapshot_capture_once() {
  local n=$(( $(cat "$CALL_FILE") + 1 ))
  printf '%s\n' "$n" > "$CALL_FILE"
  if (( n == 1 )); then return 1; fi
  printf 'stable-tree\n'
}
runsub s7 snapshot_capture
[[ "$RC" == 0 && "$(cat "$SANDBOX/s7.out")" == "stable-tree" ]] \
  && pass "S7 重试后稳定即接受" || fail "S7" "rc=$RC out=$(cat "$SANDBOX/s7.out")"
eval "$ORIG_ONCE"  # 还原

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
# 4. 新鲜度与不可变绑定（ensure_fresh_workspace / compose / verify_svc_image）
# ---------------------------------------------------------------------------

# 公共 fixture：tools 输入哈希 + tools/workspace 镜像 + 全字段状态
H="$(snapshot_capture)"
TH="$(tools_input_hash "$H")"
TOOLS_IMG="sha256:$(printf 'tools-fixture' | sha256sum | awk '{print $1}')"
WS_IMG="sha256:$(printf 'ws-fixture' | sha256sum | awk '{print $1}')"
write_image "$TOOLS_IMG" "" "" "$TH"
write_image "$WS_IMG" "$H" "$TOOLS_IMG" ""
snapshot_state_store "$H" "$WS_IMG" "$TH" "$TOOLS_IMG"

# S10 状态 + 镜像 label + tools 绑定一致 → 跳过重建，绑定状态镜像 ID
: > "$MOCK_DOCKER_STATE/calls.log"
runsub s10 ensure_and_echo
S10_EFFECTIVE="$(awk -F= '/^EFFECTIVE=/{print $2}' "$SANDBOX/s10.out")"
if [[ "$RC" == 0 && "$S10_EFFECTIVE" == "$WS_IMG" ]] && ! grep -q 'docker build' "$MOCK_DOCKER_STATE/calls.log"; then
  pass "S10 快照一致跳过重构并绑定不可变 ID"
else
  fail "S10" "rc=$RC effective=$S10_EFFECTIVE builds=$(grep -c 'docker build' "$MOCK_DOCKER_STATE/calls.log")"
fi

# S11 快照不符 → 仅重建 workspace（tools 新鲜）；绑定新 ID；带 base.image label
snapshot_state_store "0000000000000000000000000000000000000000" "$WS_IMG" "$TH" "$TOOLS_IMG"
: > "$MOCK_DOCKER_STATE/calls.log"
runsub s11 ensure_and_echo
NEW_IMG="$(awk -F= '/^EFFECTIVE=/{print $2}' "$SANDBOX/s11.out")"
EXPECTED_NEW="sha256:$(printf '%s|%s|%s|%s' "$WS_IMAGE" "$H" "" "TOOLS_IMAGE=$TOOLS_IMG;" | sha256sum | awk '{print $1}')"
if [[ "$RC" == 0 && "$NEW_IMG" == "$EXPECTED_NEW" && "$NEW_IMG" != "$WS_IMG" ]]; then
  pass "S11 快照不符重建并绑定新不可变 ID"
else
  fail "S11" "rc=$RC effective=${NEW_IMG}（期望 ${EXPECTED_NEW}）"
fi
if grep -q -- "--label devenv.snapshot.hash=$H" "$MOCK_DOCKER_STATE/calls.log" \
  && grep -q -- "--label devenv.base.image=$TOOLS_IMG" "$MOCK_DOCKER_STATE/calls.log" \
  && grep -q -- "--build-arg TOOLS_IMAGE=$TOOLS_IMG" "$MOCK_DOCKER_STATE/calls.log" \
  && ! grep -qE '\-f [^ ]*devenv/tools\.Dockerfile' "$MOCK_DOCKER_STATE/calls.log"; then
  pass "S11 重建携带快照/基础镜像 label 且 tools 未重建"
else
  fail "S11" "构建参数不符：$(cat "$MOCK_DOCKER_STATE/calls.log")"
fi
grep -q "SNAPSHOT_HASH=$H" "$DEVENV_STATE_DIR/workspace-image.env" \
  && pass "S11 状态文件记录新快照哈希" || fail "S11" "状态未更新"

# S11b docker 带前缀输出（CI docker 路径）同样归一绑定
: > "$MOCK_DOCKER_STATE/calls.log"
snapshot_state_store "0000000000000000000000000000000000000000" "$WS_IMG" "$TH" "$TOOLS_IMG"
export MOCK_BUILD_PREFIXED=1
runsub s11b ensure_and_echo
unset MOCK_BUILD_PREFIXED
S11B_EFFECTIVE="$(awk -F= '/^EFFECTIVE=/{print $2}' "$SANDBOX/s11b.out")"
[[ "$RC" == 0 && "$S11B_EFFECTIVE" == "$EXPECTED_NEW" ]] \
  && pass "S11b 带前缀构建输出归一为同一不可变 ID" || fail "S11b" "rc=$RC effective=$S11B_EFFECTIVE"

# S12 无状态文件 → 重建（tools + workspace 均建）
rm -f "$DEVENV_STATE_DIR/workspace-image.env"
: > "$MOCK_DOCKER_STATE/calls.log"
runsub s12 ensure_and_echo
[[ "$RC" == 0 ]] && grep -q 'docker build' "$MOCK_DOCKER_STATE/calls.log" \
  && pass "S12 无状态文件触发重建" || fail "S12" "未重建（rc=${RC}）"

# S13 状态指向的 workspace 镜像已丢失 → 重建（严格模式子 shell：修复前此处 set -e 提前退出）
snapshot_state_store "$H" "sha256:$(printf 'deleted' | sha256sum | awk '{print $1}')" "$TH" "$TOOLS_IMG"
: > "$MOCK_DOCKER_STATE/calls.log"
runsub s13 ensure_and_echo
[[ "$RC" == 0 ]] && grep -q 'docker build' "$MOCK_DOCKER_STATE/calls.log" \
  && pass "S13 镜像丢失触发重建（不提前退出）" || fail "S13" "rc=${RC}（期望 0 重建）"

# S13b 引擎故障（inspect 失败且探活失败）→ die 3 明确报错，不吞成未命中
snapshot_state_store "$H" "$WS_IMG" "$TH" "$TOOLS_IMG"
export MOCK_ENGINE_DOWN=1
runsub s13b ensure_and_echo
unset MOCK_ENGINE_DOWN
[[ "$RC" == 3 ]] && pass "S13b 引擎故障明确报错 exit 3（不吞）" || fail "S13b" "rc=${RC}（期望 3）"
# 引擎恢复后同一状态正常命中（证明 S13b 未误清状态）
runsub s13c ensure_and_echo
[[ "$RC" == 0 && "$(awk -F= '/^EFFECTIVE=/{print $2}' "$SANDBOX/s13c.out")" == "$WS_IMG" ]] \
  && pass "S13c 引擎恢复后新鲜度命中" || fail "S13c" "rc=$RC"

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
grep -q "WORKSPACE_IMAGE=$WS_IMAGE" "$MOCK_DOCKER_STATE/calls.log" \
  && pass "S14 无状态兜底可变 tag（仅 down/ps 等场景）" || fail "S14" "未兜底 tag"

# S15 启动核对（verify_svc_image）：运行容器镜像 == 绑定 ID 通过；不符拒绝
printf '%s\n' "$EXPECTED_NEW" > "$MOCK_DOCKER_STATE/container-image"
: > "$MOCK_DOCKER_STATE/container"
WS_IMAGE_EFFECTIVE="$EXPECTED_NEW"
runsub s15a verify_svc_image api
[[ "$RC" == 0 ]] && pass "S15 启动核对一致通过" || fail "S15" "rc=${RC}（期望 0）"
WS_IMAGE_EFFECTIVE="sha256:$(printf 'other' | sha256sum | awk '{print $1}')"
runsub s15b verify_svc_image api
[[ "$RC" == 4 ]] && pass "S15 启动核对不符 exit 4" || fail "S15" "rc=${RC}（期望 4）"
rm -f "$MOCK_DOCKER_STATE/container" "$MOCK_DOCKER_STATE/container-image"

# ---------------------------------------------------------------------------
# 5. devenv build / test:unit 全命令（子进程驱动真实入口，严格模式）
# ---------------------------------------------------------------------------

DEVENV="$MINI/devenv/devenv"
# 经真实入口（${DEVENV}）的运行使用 MINI 自身的 worktree 身份——tag 文件须按 MINI 派生
# （主测试 shell source 库时用的是真实仓库身份，两者 suffix 不同）
MINI_WT_SUFFIX="$(printf '%s' "$(git -C "$MINI" rev-parse --absolute-git-dir)" | sha256sum | awk '{print $1}' | cut -c1-8)"
TOOLS_TAG_FILE="$MOCK_DOCKER_STATE/tags/natural-enforcement_tools_wt-$MINI_WT_SUFFIX"

# S16 lockfile 在场：tools + workspace 快照构建，不走 lockgen；状态/标签齐全
git -C "$MINI" checkout -q -- . 2>/dev/null || true
: > "$MOCK_DOCKER_STATE/calls.log"
run s16 "$DEVENV" build
if [[ "$RC" == 0 ]] \
  && grep -qE '\-f [^ ]*devenv/tools\.Dockerfile' "$MOCK_DOCKER_STATE/calls.log" \
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
TOOLS_LINE="$(grep -E '\-f [^ ]*devenv/tools\.Dockerfile' "$MOCK_DOCKER_STATE/calls.log")"
if [[ "$TOOLS_LINE" == *"ne-snapshot."* && "$TOOLS_LINE" != *"$MINI "* && "$TOOLS_LINE" == *"NODE_IMAGE=node:26.13.1-slim"* ]]; then
  pass "S16b tools 构建上下文与 NODE_IMAGE 取自快照"
else
  fail "S16b" "tools 构建未用快照输入：$TOOLS_LINE"
fi
# S16c 不可变绑定链：workspace 构建经 build-arg 绑定 tools 不可变 ID + base.image label
TOOLS_ID="$(cat "$TOOLS_TAG_FILE")"
WS_LINE="$(grep 'workspace.Dockerfile' "$MOCK_DOCKER_STATE/calls.log")"
if [[ "$WS_LINE" == *"--build-arg TOOLS_IMAGE=$TOOLS_ID"* && "$WS_LINE" == *"--label devenv.base.image=$TOOLS_ID"* ]] \
  && grep -q "TOOLS_IMAGE_ID=$TOOLS_ID" "$BT"; then
  pass "S16c workspace 经 build-arg 绑定 tools 不可变 ID（可核对链路）"
else
  fail "S16c" "绑定链断裂：$WS_LINE"
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
# S17b lockgen 构建同样绑定 tools 不可变 ID；重新采集后 tools 输入未变 → 不重复建 tools
LOCKGEN_LINE="$(grep 'lockgen-fresh' "$LOG")"
if [[ "$LOCKGEN_LINE" == *"--build-arg TOOLS_IMAGE=$(cat "$TOOLS_TAG_FILE")"* ]] \
  && [[ "$(grep -cE '\-f [^ ]*devenv\/tools\.Dockerfile' "$LOG")" == "0" ]]; then
  pass "S17b lockgen 绑定 tools ID 且重新采集后不重复建 tools"
else
  fail "S17b" "lockgen 绑定/重检不符：$LOG"
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

# S19 真实入口回归（test:unit，严格模式）：未命中三态重建成功；构建失败正确失败
# a. 无状态 → 重建成功并写状态
rm -f "$DEVENV_STATE_DIR/workspace-image.env"
: > "$MOCK_DOCKER_STATE/calls.log"
run s19a "$DEVENV" test:unit
if [[ "$RC" == 0 && -f "$DEVENV_STATE_DIR/workspace-image.env" ]] \
  && grep -q 'workspace.Dockerfile' "$MOCK_DOCKER_STATE/calls.log"; then
  pass "S19a 真实入口：无状态重建成功"
else
  fail "S19a" "rc=$RC"
fi
# b. 状态镜像不存在 → 重建成功（修复前：set -e 下 inspect 失败提前退出）
H_NOW="$(expected_tree)"
snapshot_state_write "$H_NOW" "sha256:$(printf 'gone' | sha256sum | awk '{print $1}')"
: > "$MOCK_DOCKER_STATE/calls.log"
run s19b "$DEVENV" test:unit
if [[ "$RC" == 0 ]] && grep -q 'workspace.Dockerfile' "$MOCK_DOCKER_STATE/calls.log"; then
  pass "S19b 真实入口：状态镜像不存在重建成功"
else
  fail "S19b" "rc=$RC err=$(tail -2 "$SANDBOX/s19b.err")"
fi
# c. label 不符 → 重建成功
WRONG_IMG="sha256:$(printf 'wrong-label' | sha256sum | awk '{print $1}')"
write_image "$WRONG_IMG" "0000000000000000000000000000000000000000" "$(cat "$TOOLS_TAG_FILE")" ""
snapshot_state_write "$H_NOW" "$WRONG_IMG"
: > "$MOCK_DOCKER_STATE/calls.log"
run s19c "$DEVENV" test:unit
if [[ "$RC" == 0 ]] && grep -q 'workspace.Dockerfile' "$MOCK_DOCKER_STATE/calls.log"; then
  pass "S19c 真实入口：label 不符重建成功"
else
  fail "S19c" "rc=$RC err=$(tail -2 "$SANDBOX/s19c.err")"
fi
# d. 构建失败 → exit 4，不写成功状态（不误报）
rm -f "$DEVENV_STATE_DIR/workspace-image.env"
: > "$MOCK_DOCKER_STATE/calls.log"
export MOCK_BUILD_FAIL=1
run s19d "$DEVENV" test:unit
unset MOCK_BUILD_FAIL
if [[ "$RC" == 4 && ! -f "$DEVENV_STATE_DIR/workspace-image.env" ]]; then
  pass "S19d 真实入口：构建失败 exit 4 且不写成功状态"
else
  fail "S19d" "rc=$RC state=$(ls "$DEVENV_STATE_DIR" 2>/dev/null)"
fi

# S20 受控反例：修改 tools 输入后直接消费（不先手工 build）→ tools 重建并绑定新 ID
printf '# tools input change\n' >> "$MINI/devenv/tools.Dockerfile"
: > "$MOCK_DOCKER_STATE/calls.log"
run s20 "$DEVENV" test:unit
NEW_TOOLS_ID="$(cat "$TOOLS_TAG_FILE")"
WS_LINE="$(grep 'workspace.Dockerfile' "$MOCK_DOCKER_STATE/calls.log")"
if [[ "$RC" == 0 ]] && grep -qE '\-f [^ ]*devenv/tools\.Dockerfile' "$MOCK_DOCKER_STATE/calls.log" \
  && [[ "$WS_LINE" == *"--build-arg TOOLS_IMAGE=$NEW_TOOLS_ID"* ]] \
  && grep -q "TOOLS_IMAGE_ID=$NEW_TOOLS_ID" "$DEVENV_STATE_DIR/workspace-image.env"; then
  pass "S20 tools 输入变更后消费命令自动重建并绑定新 tools ID"
else
  fail "S20" "rc=$RC log=$(cat "$MOCK_DOCKER_STATE/calls.log")"
fi

# S21 受控反例：构建前覆盖 tools wt 标签 → 不重建 tools，workspace 仍绑定状态 tools ID
OTHER_ID="sha256:$(printf 'override-target' | sha256sum | awk '{print $1}')"
write_image "$OTHER_ID" "" "" ""
printf '%s\n' "$OTHER_ID" > "$TOOLS_TAG_FILE"  # 覆盖 tools wt 标签指向另一个镜像
: > "$MOCK_DOCKER_STATE/calls.log"
run s21a "$DEVENV" test:unit
if [[ "$RC" == 0 ]] && ! grep -q 'docker build' "$MOCK_DOCKER_STATE/calls.log"; then
  pass "S21 tools wt 标签被覆盖后消费不重建（状态绑定仍新鲜）"
else
  fail "S21a" "rc=$RC log=$(cat "$MOCK_DOCKER_STATE/calls.log")"
fi
printf '\n' >> "$MINI/package.json"  # 使 workspace 失鲜，tools 仍新鲜（保持 JSON 合法）
: > "$MOCK_DOCKER_STATE/calls.log"
run s21b "$DEVENV" test:unit
WS_LINE="$(grep 'workspace.Dockerfile' "$MOCK_DOCKER_STATE/calls.log")"
if [[ "$RC" == 0 ]] && [[ "$WS_LINE" == *"--build-arg TOOLS_IMAGE=$NEW_TOOLS_ID"* && "$WS_LINE" != *"$OTHER_ID"* ]]; then
  pass "S21 workspace 重建绑定状态 tools ID（非被覆盖的标签）"
else
  fail "S21b" "rc=$RC log=$(cat "$MOCK_DOCKER_STATE/calls.log")"
fi

# S22 旧版状态文件（无 tools 字段）→ tools 重建一次并补齐状态
H_NOW="$(expected_tree)"
WS_NOW="sha256:$(printf 'legacy-ws' | sha256sum | awk '{print $1}')"
write_image "$WS_NOW" "$H_NOW" "$NEW_TOOLS_ID" ""
printf 'SNAPSHOT_HASH=%s\nIMAGE_ID=%s\n' "$H_NOW" "$WS_NOW" > "$DEVENV_STATE_DIR/workspace-image.env"
: > "$MOCK_DOCKER_STATE/calls.log"
run s22 "$DEVENV" test:unit
if [[ "$RC" == 0 ]] && grep -qE '\-f [^ ]*devenv/tools\.Dockerfile' "$MOCK_DOCKER_STATE/calls.log" \
  && grep -q 'TOOLS_IMAGE_ID=sha256:' "$DEVENV_STATE_DIR/workspace-image.env"; then
  pass "S22 旧版状态（无 tools 字段）重建 tools 并补齐状态"
else
  fail "S22" "rc=$RC log=$(cat "$MOCK_DOCKER_STATE/calls.log")"
fi

# ---------------------------------------------------------------------------
# 6. 采集一致性（stat 括号 + 内容双读）：确定性竞态与失败传播
# ---------------------------------------------------------------------------

# S23 交替更新（读取交错钩子注入）：已读文件被改 → 重试；最终只接受完整当前状态
printf 'a-v1\n' > "$MINI/aaa-race-a.txt"   # 排序最前 → batch1（钩子触发时已读）
printf 'b-v1\n' > "$MINI/zzz-race-b.txt"   # 排序最后 → batch2（钩子触发时未读）
# 禁止出现的从未存在组合 (a-v1, b-v2)：独立计算其树哈希
printf 'b-v2\n' > "$MINI/zzz-race-b.txt"
NEVER_EXISTED="$(snapshot_tree_once)"
printf 'b-v1\n' > "$MINI/zzz-race-b.txt"
RACE_COUNTER="$SANDBOX/race-n"
printf '0\n' > "$RACE_COUNTER"
snapshot_test_hook() { # 第 1 窗口改 batch1 的 a（已读→必须重试）；第 2 窗口改 batch2 的 b
  [[ "$1" == "read-interleave" ]] || return 0
  local n=$(( $(cat "$RACE_COUNTER") + 1 ))
  printf '%s\n' "$n" > "$RACE_COUNTER"
  if (( n == 1 )); then printf 'a-v2\n' > "$MINI/aaa-race-a.txt"; fi
  if (( n == 2 )); then printf 'b-v2\n' > "$MINI/zzz-race-b.txt"; fi
}
runsub s23 snapshot_capture
unset -f snapshot_test_hook
T23="$(cat "$SANDBOX/s23.out")"
EXPECTED23="$(expected_tree)"
if [[ "$RC" == 0 && "$T23" == "$EXPECTED23" ]] && grep -q '重试' "$SANDBOX/s23.err"; then
  pass "S23 交替更新：已读文件被改检出重试，最终接受完整当前状态"
else
  fail "S23" "rc=$RC tree=$T23 expected=$EXPECTED23 err=$(cat "$SANDBOX/s23.err")"
fi
[[ "$T23" != "$NEVER_EXISTED" ]] \
  && pass "S23 从未存在组合 (a-v1,b-v2) 未被接受" || fail "S23" "接受了从未存在组合！"
rm -f "$MINI/aaa-race-a.txt" "$MINI/zzz-race-b.txt"

# S24 空格仓库 + 空格/通配字符文件名：采集正确，窗口内修改被检测
SPACE_REPO="$SANDBOX/space repo"
mkdir -p "$SPACE_REPO"
git -C "$SPACE_REPO" init -q
git -C "$SPACE_REPO" config user.email "offline@test"
git -C "$SPACE_REPO" config user.name "offline"
printf 'a1\n' > "$SPACE_REPO/a[1].txt"
printf 'm1\n' > "$SPACE_REPO/my file.txt"
printf 'n1\n' > "$SPACE_REPO/normal.txt"
printf 's1\n' > "$SPACE_REPO/star*.txt"
git -C "$SPACE_REPO" add -A
git -C "$SPACE_REPO" commit -qm init
MAIN_REPO_ROOT="$REPO_ROOT"
REPO_ROOT="$SPACE_REPO"
T24="$(snapshot_capture)"
T24_LIST="$(git -C "$SPACE_REPO" archive "$T24" | tar -t | sort)"
if [[ "$T24" == "$(git -C "$SPACE_REPO" add -A && git -C "$SPACE_REPO" write-tree)" ]] \
  && grep -qxF 'my file.txt' <<< "$T24_LIST" && grep -qxF 'a[1].txt' <<< "$T24_LIST" \
  && grep -qxF 'star*.txt' <<< "$T24_LIST"; then
  pass "S24 空格仓库+空格/通配文件名采集正确"
else
  fail "S24" "tree=$T24 list=$T24_LIST"
fi
# 窗口内修改 batch1 的 "my file.txt"（含空格文件名）→ 必须检出重试
printf '0\n' > "$RACE_COUNTER"
snapshot_test_hook() {
  [[ "$1" == "read-interleave" ]] || return 0
  local n=$(( $(cat "$RACE_COUNTER") + 1 ))
  printf '%s\n' "$n" > "$RACE_COUNTER"
  if (( n == 1 )); then printf 'm2\n' > "$SPACE_REPO/my file.txt"; fi
}
runsub s24b snapshot_capture
unset -f snapshot_test_hook
T24B="$(cat "$SANDBOX/s24b.out")"
if [[ "$RC" == 0 && "$T24B" == "$(git -C "$SPACE_REPO" add -A && git -C "$SPACE_REPO" write-tree)" ]] \
  && grep -q '重试' "$SANDBOX/s24b.err" \
  && [[ "$(git -C "$SPACE_REPO" show "$T24B:my file.txt")" == "m2" ]]; then
  pass "S24 空格文件名窗口内修改被检测并重试，接受完整新状态"
else
  fail "S24b" "rc=$RC tree=$T24B err=$(cat "$SANDBOX/s24b.err")"
fi

# S25 项二反例：两个 mtime 恢复型等长覆写交错（从未存在组合）→ 必须检出
# G="my file.txt"（batch1，钩子前已读）；F="normal.txt"（batch2，钩子后读）
printf 'G1-content-x\n' > "$SPACE_REPO/my file.txt"
printf 'F1-content-y\n' > "$SPACE_REPO/normal.txt"
touch -d "2020-01-01 00:00:00" "$SPACE_REPO/my file.txt" "$SPACE_REPO/normal.txt"
# 禁止组合 (G1, F2)：G1 止于 t1，F2 起于 t2>t1，从未同时存在
printf 'F2-content-y\n' > "$SPACE_REPO/normal.txt"
FORBIDDEN="$(snapshot_tree_once)"
printf 'F1-content-y\n' > "$SPACE_REPO/normal.txt"
touch -d "2020-01-01 00:00:00" "$SPACE_REPO/normal.txt"
printf '0\n' > "$RACE_COUNTER"
snapshot_test_hook() { # 等长原地覆写 + 恢复 mtime（stat 不可见），G 先于 F
  [[ "$1" == "read-interleave" ]] || return 0
  local n=$(( $(cat "$RACE_COUNTER") + 1 ))
  printf '%s\n' "$n" > "$RACE_COUNTER"
  if (( n == 1 )); then
    printf 'G2-content-x\n' > "$SPACE_REPO/my file.txt"
    touch -d "2020-01-01 00:00:00" "$SPACE_REPO/my file.txt"
    printf 'F2-content-y\n' > "$SPACE_REPO/normal.txt"
    touch -d "2020-01-01 00:00:00" "$SPACE_REPO/normal.txt"
  fi
}
runsub s25 snapshot_capture
unset -f snapshot_test_hook
T25="$(cat "$SANDBOX/s25.out")"
EXPECTED25="$(git -C "$SPACE_REPO" add -A && git -C "$SPACE_REPO" write-tree)"
if [[ "$RC" == 0 && "$T25" == "$EXPECTED25" ]] && grep -q '重试' "$SANDBOX/s25.err"; then
  pass "S25 mtime 恢复型等长覆写交错被内容双读检出（重试后接受完整状态）"
else
  fail "S25" "rc=$RC tree=$T25 expected=$EXPECTED25 err=$(cat "$SANDBOX/s25.err")"
fi
[[ "$T25" != "$FORBIDDEN" ]] \
  && pass "S25 从未存在组合 (G1,F2) 未被接受" || fail "S25" "接受了从未存在组合（stat 括号盲区）！"
REPO_ROOT="$MAIN_REPO_ROOT"

# S26 失败传播：任一步骤失败不得当作成功采集
# a. 枚举失败（git ls-files 失败）→ die 4，无树输出
STUB2="$SANDBOX/stubbin2"
mkdir -p "$STUB2"
REAL_GIT="$(command -v git)"
printf '#!/usr/bin/env bash\nfor a in "$@"; do [[ "$a" == "ls-files" ]] && exit 1; done\nexec %s "$@"\n' "$REAL_GIT" > "$STUB2/git"
chmod +x "$STUB2/git"
capture_with_stub_git() { PATH="$STUB2:$PATH" snapshot_capture; }
runsub s26a capture_with_stub_git
[[ "$RC" == 4 && ! -s "$SANDBOX/s26a.out" ]] \
  && pass "S26a 枚举失败 die 4 且无树输出" || fail "S26a" "rc=$RC out=$(cat "$SANDBOX/s26a.out")"
# b. 读取失败（chmod 000 不可读）→ 重试后 die 4，无树输出、无成功状态
chmod 000 "$MINI/apps/api/package.json"
runsub s26b snapshot_capture
chmod 644 "$MINI/apps/api/package.json"
[[ "$RC" == 4 && ! -s "$SANDBOX/s26b.out" ]] \
  && pass "S26b 读取失败 die 4 且无树输出" || fail "S26b" "rc=$RC out=$(cat "$SANDBOX/s26b.out")"
# c. stat 失败（瞬态 rc 1 → 重试后拒绝；硬错误 rc 3 → 直接传播不重试）
ORIG_STAT_FILES="$(declare -f snapshot_stat_files)"
snapshot_stat_files() { return 1; }
runsub s26c snapshot_capture
[[ "$RC" == 4 ]] && pass "S26c stat 瞬态失败重试后拒绝 exit 4" || fail "S26c" "rc=${RC}（期望 4）"
snapshot_stat_files() { return 3; }
runsub s26d snapshot_capture
[[ "$RC" == 3 ]] && pass "S26d stat 硬错误传播 exit 3（不重试）" || fail "S26d" "rc=${RC}（期望 3）"
eval "$ORIG_STAT_FILES"  # 还原

# S27 真实入口（严格模式）+ 空格文件名：全链路成功
printf 'x\n' > "$MINI/space file.txt"
run s27 "$DEVENV" test:unit
[[ "$RC" == 0 && -f "$DEVENV_STATE_DIR/workspace-image.env" ]] \
  && pass "S27 真实入口+空格文件名全链路成功" || fail "S27" "rc=$RC err=$(tail -2 "$SANDBOX/s27.err")"
rm -f "$MINI/space file.txt"

# ---------------------------------------------------------------------------
echo "------------------------------------------------------------"
echo "快照与不可变绑定离线测试完成：$PASS_COUNT 通过，$FAILURES 失败"
[[ "$FAILURES" == 0 ]]
