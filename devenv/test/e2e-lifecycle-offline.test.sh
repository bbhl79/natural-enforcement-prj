#!/usr/bin/env bash
# ============================================================================
# e2e 生命周期决策引擎编排离线测试（#106）——不访问真实引擎（docker 全部 mock）
#
# 覆盖（Spec-e2e §3 事实源分层 / §4 缺陷报告 schema / §10 命令面与退出码）：
#   1. `devenv e2e defect list|show`：--json 终值可解析；未知 ID / 非法记录 exit 10
#   2. 宿主树经 stdin tar 只读进容器（查询命令零落盘）
#   3. op 行协议（W/D/V/END）宿主侧原子应用：多项 W/D 全应用；
#      V 判定不符 → exit 9 零落盘；END error → 透传码零落盘；拒绝原因透出
#   4. 原型坑收口：set -e 不吞 END 诊断（先捕获 rc 再判协议）；无 END 的崩溃 → 4
#   5. 注册表 = 派生缓存：始终重建、漂移仅 WARN 不硬门禁、不入库（gitignore）
#   6. 取号：本地 max+1；远端叠读 best-effort（失败回退本地 + WARN）
#   7. 生命周期写锁 per-worktree（mkdir 基，非 flock）：冲突 exit 6 零落盘
#   8. 用法错误 exit 2；op 路径越界拒绝；应用中途失败全量还原
#
# 接缝：命令面（devenv e2e defect/registry）+ 宿主桥函数（e2e_lifecycle_write，
# 用 fixture 子命令驱动 V/END/崩溃/越界/回滚等协议边界；真实引擎由 apps/e2e
# vitest 单测覆盖，容器侧 mock 只复刻协议字节格式）。
# ============================================================================
set -Eeuo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TEST_DIR/../.." && pwd)"

FAILURES=0
PASS_COUNT=0
pass() { printf 'PASS: %s\n' "$1"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { printf 'FAIL: %s —— %s\n' "$1" "$2"; FAILURES=$((FAILURES + 1)); }

SANDBOX=$(mktemp -d /tmp/devenv-e2e-lifecycle.XXXXXX)
trap 'rm -rf "$SANDBOX"' EXIT
echo "沙箱：$SANDBOX"

# ---------------------------------------------------------------------------
# 最小仓库（真实 devenv 库 + 真实 .gitignore + e2e 事实源树）+ mock docker
# ---------------------------------------------------------------------------
MINI="$SANDBOX/mini"
mkdir -p "$MINI"
cp -r "$REPO_ROOT/devenv" "$MINI/devenv"
mkdir -p "$MINI/apps/api" "$MINI/apps/web" "$MINI/apps/e2e/defects" \
         "$MINI/apps/e2e/replay" "$MINI/apps/e2e/tests/repro" \
         "$MINI/packages/contracts" "$MINI/packages/tsconfig"
cp "$REPO_ROOT/.gitignore" "$MINI/.gitignore"
cp "$REPO_ROOT/package.json" "$MINI/package.json"
cp "$REPO_ROOT/pnpm-lock.yaml" "$MINI/pnpm-lock.yaml"
cp "$REPO_ROOT/pnpm-workspace.yaml" "$MINI/pnpm-workspace.yaml"
cp "$REPO_ROOT/apps/api/package.json" "$MINI/apps/api/package.json"
cp "$REPO_ROOT/apps/web/package.json" "$MINI/apps/web/package.json"
cp "$REPO_ROOT/apps/e2e/package.json" "$MINI/apps/e2e/package.json"
cp "$REPO_ROOT/packages/contracts/package.json" "$MINI/packages/contracts/package.json"
cp "$REPO_ROOT/packages/tsconfig/package.json" "$MINI/packages/tsconfig/package.json"
printf '{"compilerOptions":{}}\n' > "$MINI/packages/tsconfig/tsconfig.json"

# 事实源夹具（临时树，非入库缺陷记录）：两条 reported + replay 脚本在场
cat > "$MINI/apps/e2e/defects/DEF-0001.json" <<'JSON'
{"schemaVersion":1,"id":"DEF-0001","title":"点位名称接受 NUL","summary":"契约内输入引发 500",
 "status":"reported","engine":"fast-check","layer":"api","discoveredAt":"2026-11-28T00:00:00Z",
 "discoveredBy":"offline","charter":"创建点位输入空间全量安全","suspectedArea":"packages/contracts",
 "severity":"medium","reproducibility":{"kind":"external-state","replayCommand":"node apps/e2e/replay/DEF-0001.mjs",
 "counterexample":{"property":"契约内输入不应引发服务器错误","request":{"method":"POST","path":"/enforcement-points","body":{"name":"a\u0000b"}}},
 "gate":{"attempts":1,"keySpaces":["rep-offline-1"],"allFailed":true}},
 "evidence":[{"type":"json-report","uri":".artifacts/e2e/exp-offline/results.json"}],"sanitized":true}
JSON
cat > "$MINI/apps/e2e/defects/DEF-0002.json" <<'JSON'
{"schemaVersion":1,"id":"DEF-0002","title":"纯空白名入库","summary":"spec 债务",
 "status":"reported","engine":"agent-session","layer":"api","discoveredAt":"2026-11-28T00:00:00Z",
 "discoveredBy":"offline","charter":"创建点位输入空间全量安全","suspectedArea":"packages/contracts",
 "severity":"low","reproducibility":{"kind":"external-state","replayCommand":"node apps/e2e/replay/DEF-0002.mjs",
 "gate":{"attempts":1,"keySpaces":["rep-offline-2"],"allFailed":true}},
 "evidence":[],"sanitized":true}
JSON
printf 'process.exit(0)\n' > "$MINI/apps/e2e/replay/DEF-0001.mjs"
printf 'process.exit(0)\n' > "$MINI/apps/e2e/replay/DEF-0002.mjs"
printf '// defect: DEF-0001\n' > "$MINI/apps/e2e/tests/repro/.gitkeep"

git -C "$MINI" init -q
git -C "$MINI" config user.email "offline@test"
git -C "$MINI" config user.name "offline"
git -C "$MINI" add -A
git -C "$MINI" commit -qm init

STATE="$SANDBOX/docker-state"
mkdir -p "$STATE/images" "$STATE/tags" "$SANDBOX/bin"

# ---------------------------------------------------------------------------
# 容器侧决策引擎的 mock（真实引擎由 apps/e2e vitest 单测覆盖）：
# 解 stdin tar → 按子命令发射 op 行协议 / 查询数据，与真实 CLI 同字节格式。
# ---------------------------------------------------------------------------
cat > "$SANDBOX/bin/fake-cli" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
ROOT="."
JSON=0
args=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --root) ROOT="$2"; shift 2 ;;
    --json) JSON=1; shift ;;
    *) args+=("$1"); shift ;;
  esac
done
sub="${args[0]:-}"
b64() { printf '%s' "$1" | openssl base64 -e -A; }
case "$sub" in
  defect)
    action="${args[1]:-}"
    if [[ "$action" == "list" ]]; then
      bad=""
      for f in "$ROOT"/defects/*.json; do
        [[ -e "$f" ]] || continue
        jq -e . "$f" >/dev/null 2>&1 || bad="$f"
      done
      if [[ -n "$bad" ]]; then
        printf 'END\terror\t10\tschema 不符：%s\n' "$bad"
        exit 10
      fi
      if (( JSON )); then
        if compgen -G "$ROOT/defects/*.json" >/dev/null; then jq -s '.' "$ROOT"/defects/*.json; else printf '[]\n'; fi
      else
        for f in "$ROOT"/defects/*.json; do
          [[ -e "$f" ]] || continue
          printf '%s  [%s]  %s\n' "$(jq -r .id "$f")" "$(jq -r .status "$f")" "$(jq -r .title "$f")"
        done
      fi
      exit 0
    fi
    if [[ "$action" == "show" ]]; then
      id="${args[2]:-}"
      f="$ROOT/defects/$id.json"
      if [[ ! -f "$f" ]]; then
        printf 'END\terror\t10\t缺陷不存在：%s（defects/ 下无对应 JSON）\n' "$id"
        exit 10
      fi
      if ! jq -e . "$f" >/dev/null 2>&1; then
        printf 'END\terror\t10\tschema 不符：defects/%s.json\n' "$id"
        exit 10
      fi
      if (( JSON )); then jq '.' "$f"; else
        printf '%s — %s\n' "$(jq -r .id "$f")" "$(jq -r .title "$f")"
        printf '  状态：%s｜引擎：%s\n' "$(jq -r .status "$f")" "$(jq -r .engine "$f")"
      fi
      exit 0
    fi
    printf 'END\terror\t2\t用法错误：defect <list|show|next-id>\n'; exit 2 ;;
  next-id)
    remote=0; localmax=0
    i=0
    while (( i < ${#args[@]} )); do
      if [[ "${args[$i]}" == "--remote-max" ]]; then remote="${args[$((i+1))]:-0}"; fi
      i=$((i+1))
    done
    for f in "$ROOT"/defects/DEF-*.json; do
      [[ -e "$f" ]] || continue
      n="$(basename "$f" .json)"; n="${n#DEF-}"; n=$((10#$n))
      (( n > localmax )) && localmax=$n
    done
    max=$localmax
    (( remote > max )) && max=$remote
    next="$(printf 'DEF-%04d' $((max + 1)))"
    if (( JSON )); then
      printf '{"id":"%s","localMax":%s,"remoteMax":%s}\n' "$next" "$localmax" "$remote"
    else
      printf '%s\n' "$next"
    fi
    exit 0 ;;
  registry)
    reg='{"defects":[]}'
    if compgen -G "$ROOT/defects/*.json" >/dev/null; then
      reg="$(jq -s '{defects: (map({id, status, engine, specPath: null}) | sort_by(.id))}' "$ROOT"/defects/*.json)"
    fi
    printf 'W\t.registry.json\t%s\n' "$(b64 "$reg")"
    printf 'END\tok\t0\t注册表已重建（%s 条）\n' "$(printf '%s' "$reg" | jq '.defects | length')"
    exit 0 ;;
  fixture-write)
    printf 'W\tdefects/DEF-0003.json\t%s\n' "$(b64 '{"id":"DEF-0003"}')"
    printf 'W\treplay/DEF-0001.mjs\t%s\n' "$(b64 'process.exit(0) // 覆盖')"
    printf 'D\ttests/repro/.gitkeep\n'
    printf 'END\tok\t0\t三项文件操作\n'
    exit 0 ;;
  fixture-v-mismatch)
    printf 'V\t0001\tfail\t%s\n' "$(b64 'test("x", () => { expect(1).toBe(1) })')"
    printf 'W\tdefects/DEF-0001.json\t%s\n' "$(b64 '{"id":"DEF-0001","status":"graduated"}')"
    printf 'END\tok\t0\t毕业落账\n'
    exit 0 ;;
  fixture-v-match)
    printf 'V\t0001\tfail\t%s\n' "$(b64 'test("x", () => { expect(1).toBe(2) })')"
    printf 'W\tdefects/DEF-0001.json\t%s\n' "$(b64 '{"id":"DEF-0001","status":"graduated"}')"
    printf 'END\tok\t0\t毕业落账\n'
    exit 0 ;;
  fixture-end-error)
    printf 'W\tdefects/DEF-0001.json\t%s\n' "$(b64 '{"id":"DEF-0001","status":"graduated"}')"
    printf 'END\terror\t8\t已是 graduated；重复毕业被拒\n'
    exit 8 ;;
  fixture-crash)
    printf 'W\tdefects/DEF-0001.json\t%s\n' "$(b64 'x')"
    exit 3 ;;
  fixture-bad-path)
    printf 'W\t../escape.txt\t%s\n' "$(b64 'x')"
    printf 'END\tok\t0\t越界\n'
    exit 0 ;;
  fixture-apply-fail)
    printf 'W\tdefects/DEF-0009.json\t%s\n' "$(b64 '{"id":"DEF-0009"}')"
    printf 'W\treplay/DEF-0001.mjs/child.json\t%s\n' "$(b64 'x')"
    printf 'END\tok\t0\t两项\n'
    exit 0 ;;
  *)
    printf 'END\terror\t2\t未知子命令：%s\n' "$sub"; exit 2 ;;
esac
FAKE
chmod +x "$SANDBOX/bin/fake-cli"

cat > "$SANDBOX/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
STATE="${MOCK_DOCKER_STATE:?}"
mkdir -p "$STATE/images" "$STATE/tags"
joined="$*"
printf 'docker %s\n' "$*" >> "$STATE/calls.log"
sanitize() { printf '%s' "$1" | tr '/:' '__'; }
cmd="${1:-}"; [[ $# -gt 0 ]] && shift
case "$cmd" in
  version)
    printf '%s\n' '{"Client":{"Version":"29.1.3"},"Server":{"Version":"6.1.4","Os":"linux","Arch":"amd64","Components":[{"Name":"Podman Engine","Version":"6.1.4"}]}}' ;;
  compose)
    if [[ "${1:-}" == "version" ]]; then printf '2.40.3\n'; exit 0; fi
    project=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        -p) project="$2"; shift 2 ;;
        -f) shift 2 ;;
        *) break ;;
      esac
    done
    sub="${1:-}"
    if [[ "$sub" == "run" && "$joined" == *"dist/main.js"* ]]; then
      # 宿主树 stdin tar 只读进容器：解包到 $STATE/in-<n>（读取通道证据）
      n=$(( $(cat "$STATE/in-count" 2>/dev/null || printf '0') + 1 ))
      printf '%s\n' "$n" > "$STATE/in-count"
      mkdir -p "$STATE/in-$n"
      tar -xf - -C "$STATE/in-$n"
      printf '%s\n' "$*" >> "$STATE/cli-args.log"
      while [[ $# -gt 0 ]]; do
        case "$1" in
          --rm|-T) shift ;;
          tools|bash) shift ;;
          -c) shift 2 ;;
          _) shift; break ;;
          *) shift ;;
        esac
      done
      exec bash "$MOCK_CLI" --root "$STATE/in-$n" "$@"
    fi
    if [[ "$sub" == "run" && "$joined" == *"playwright.verify.config.ts"* ]]; then
      n=$(( $(cat "$STATE/verify-count" 2>/dev/null || printf '0') + 1 ))
      printf '%s\n' "$n" > "$STATE/verify-count"
      mkdir -p "$STATE/verify-in-$n"
      tar -xf - -C "$STATE/verify-in-$n"
      printf 'verify-run payload injected\n' >> "$STATE/verify.log"
      exit "${MOCK_VERIFY_RC:-0}"
    fi
    if [[ "$sub" == "up" ]]; then : > "$STATE/e2e-up-$project"
    elif [[ "$sub" == "down" ]]; then rm -f "$STATE/e2e-up-$project"
    elif [[ "$sub" == "run" && "$joined" == *"playwright test"* ]]; then exit "${MOCK_PLAYWRIGHT_RC:-0}"
    fi
    exit 0 ;;
  build)
    tag=""; snap=""; pw=""; pwver=""; toolshash=""; base=""; bargs=""; file=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        -t) tag="$2"; shift 2 ;;
        --label)
          case "$2" in
            devenv.snapshot.hash=*) snap="${2#*=}" ;;
            devenv.playwright.image=*) pw="${2#*=}" ;;
            devenv.playwright.version=*) pwver="${2#*=}" ;;
            devenv.tools.input-hash=*) toolshash="${2#*=}" ;;
            devenv.base.image=*) base="${2#*=}" ;;
          esac
          shift 2 ;;
        --build-arg) bargs="$bargs$2;"; shift 2 ;;
        -f) file="$2"; shift 2 ;;
        *) shift ;;
      esac
    done
    id="sha256:$(printf '%s|%s|%s|%s|%s|%s' "$tag" "$snap" "$pw" "$pwver" "$bargs" "$file" | sha256sum | awk '{print $1}')"
    printf 'SNAPSHOT_HASH=%s\nPW=%s\nPWVER=%s\nTOOLS=%s\nBASE=%s\nTAG=%s\nFILE=%s\n' \
      "$snap" "$pw" "$pwver" "$toolshash" "$base" "$tag" "$file" > "$STATE/images/$id"
    [[ -n "$tag" ]] && printf '%s\n' "$id" > "$STATE/tags/$(sanitize "$tag")"
    printf '%s\n' "${id#sha256:}" ;;
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
      tf="$STATE/tags/$(sanitize "$ref")"
      [[ -f "$tf" ]] || exit 1
      id="$(cat "$tf")"
    fi
    [[ -f "$STATE/images/$id" ]] || exit 1
    snap="$(awk -F= '/^SNAPSHOT_HASH=/{print $2}' "$STATE/images/$id")"
    pw="$(awk -F= '/^PW=/{print $2}' "$STATE/images/$id")"
    pwver="$(awk -F= '/^PWVER=/{print $2}' "$STATE/images/$id")"
    tools="$(awk -F= '/^TOOLS=/{print $2}' "$STATE/images/$id")"
    base="$(awk -F= '/^BASE=/{print $2}' "$STATE/images/$id")"
    case "$fmt" in
      *devenv.tools.input-hash*) printf '%s\n' "$tools" ;;
      *devenv.snapshot.hash*devenv.playwright.image*) printf '%s %s\n' "$snap" "$pw" ;;
      *devenv.playwright.version*) printf '%s\n' "$pwver" ;;
      *devenv.snapshot.hash*devenv.base.image*) printf '%s %s\n' "$snap" "$base" ;;
      *devenv.snapshot.hash*) printf '%s\n' "$snap" ;;
      *'{{.Id}}'*) printf '%s\n' "$id" ;;
      *) printf '\n' ;;
    esac ;;
  tag)
    src="$1"; tag="$2"; id="$src"
    if [[ "$src" != sha256:* ]]; then id="$(cat "$STATE/tags/$(sanitize "$src")")"; fi
    printf '%s\n' "$id" > "$STATE/tags/$(sanitize "$tag")" ;;
  ps)
    service=""; project=""; fmt=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --filter)
          case "$2" in
            label=com.docker.compose.service=*) service="${2#label=com.docker.compose.service=}" ;;
            label=com.docker.compose.project=*) project="${2#label=com.docker.compose.project=}" ;;
          esac
          shift 2 ;;
        --format) fmt="$2"; shift 2 ;;
        *) shift ;;
      esac
    done
    cid=""
    if [[ -n "$service" ]]; then
      if [[ "$project" == *-e2e-* ]]; then
        if [[ -f "$STATE/e2e-up-$project" && "$service" =~ ^(api|worker|web)$ ]]; then cid="cid-$project-$service"; fi
      else
        [[ "${MOCK_INFRA_DOWN:-}" == "1" ]] || case "$service" in db|redis|rustfs) cid="cid-$service" ;; esac
      fi
    fi
    if [[ "$fmt" == *'{{.Names}}'* ]]; then [[ -n "$cid" ]] && printf '%s-name\n' "$cid"
    else [[ -n "$cid" ]] && printf '%s\n' "$cid"; fi
    exit 0 ;;
  inspect)
    fmt=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --format) fmt="$2"; shift 2 ;;
        *) shift ;;
      esac
    done
    if [[ "$fmt" == *Health.Status* ]]; then printf 'healthy\n'; fi ;;
  network)
    sub="$1"; shift || true
    case "$sub" in
      inspect) [[ -f "$STATE/net-$1" ]] ;;
      create) : > "$STATE/net-$1" ;;
      rm) rm -f "$STATE/net-$1" ;;
    esac ;;
  pull|rm|rmi|logs) exit 0 ;;
  *) exit 0 ;;
esac
MOCK
chmod +x "$SANDBOX/bin/docker"

export PATH="$SANDBOX/bin:$PATH"
export MOCK_DOCKER_STATE="$STATE"
export MOCK_CLI="$SANDBOX/bin/fake-cli"
export DEVENV_DOCKER_HOST="unix:///mock.sock"
export DEVENV_LOCK_ROOT="$SANDBOX/locks"
export DEVENV_STATE_DIR="$MINI/.devenv-state"
export DEVENV_E2E_ARTIFACTS_DIR="$SANDBOX/artifacts"
export DEVENV_WORKTREE_ID="wt-lifecycle"
export DEVENV_LOCK_TIMEOUT=3
MOCK_STACK_SUFFIX="$(printf '%s' "wt-lifecycle" | sha256sum | awk '{print $1}' | cut -c1-8)"
export MOCK_STACK_SUFFIX
DEVENV="$MINI/devenv/devenv"
E2E_DIR="$MINI/apps/e2e"

run_cmd() { # run_cmd <name> <cmd...>
  local name="$1"; shift
  set +e
  "$@" > "$SANDBOX/$name.out" 2> "$SANDBOX/$name.err"
  RC=$?
  set -e
}

# 宿主桥函数接缝（写路径协议边界）：子 shell 内 source 真实库后驱动 e2e_lifecycle_write
lifecycle_write() { # <name> <cli args...>
  local name="$1"; shift
  set +e
  (
    set -Eeuo pipefail
    REPO_ROOT="$MINI"
    trap 'lease_release_all; lock_release_all' EXIT
    source "$REPO_ROOT/devenv/lib/output.sh"
    source "$REPO_ROOT/devenv/lib/engine.sh"
    source "$REPO_ROOT/devenv/lib/lock.sh"
    source "$REPO_ROOT/devenv/lib/snapshot.sh"
    source "$REPO_ROOT/devenv/lib/stack.sh"
    source "$REPO_ROOT/devenv/lib/supply-chain.sh"
    source "$REPO_ROOT/devenv/lib/ci.sh"
    source "$REPO_ROOT/devenv/lib/gen.sh"
    source "$REPO_ROOT/devenv/lib/e2e.sh"
    source "$REPO_ROOT/devenv/lib/github-app-auth.sh"
    source "$REPO_ROOT/devenv/lib/e2e-lifecycle.sh"
    JSON=1; CMD="e2e"
    if [[ "${LIFECYCLE_VERIFY_RUN:-}" == "1" ]]; then
      # V 载荷需要 per-run 隔离栈（mock：标记 up + 绑定执行器镜像）
      e2e_derive_names "ver-a1" "verify"
      E2E_IMAGE_EFFECTIVE="sha256:$(printf 'mock-executor' | sha256sum | awk '{print $1}')"
      : > "$STATE/e2e-up-$E2E_PROJECT"
    fi
    e2e_lifecycle_write "$@"
  ) > "$SANDBOX/$name.out" 2> "$SANDBOX/$name.err"
  RC=$?
  set -e
}

# 事实源快照（零落盘断言的基线）
tree_fingerprint() { (cd "$E2E_DIR" && find . -type f -exec sha256sum {} \; | sort); }
# JSONL 终值 / 事件断言（jq -s 收全流）
last_json() { jq -s -e '.[-1] | '"$2" "$1" >/dev/null 2>&1; }
has_event() { jq -s -e "any(.[]; .event == \"$2\"${3:-})" "$1" >/dev/null 2>&1; }

echo "沙箱 worktree 身份：$DEVENV_WORKTREE_ID（suffix=$MOCK_STACK_SUFFIX）"

# ---------------------------------------------------------------------------
# L1 defect list：--json 终值可解析（查询数据经容器 stdout → 宿主包装）
# ---------------------------------------------------------------------------
BASE_FP="$(tree_fingerprint)"
run_cmd l1 "$DEVENV" --json e2e defect list
if [[ "$RC" == 0 ]] && last_json "$SANDBOX/l1.out" '.command == "e2e" and .status == "ok" and .exitCode == 0 and (.defects | length == 2)'; then
  pass "L1 defect list --json 输出终值 + 缺陷数组（2 条）"
else
  fail "L1" "rc=$RC out=$(tail -2 "$SANDBOX/l1.out") err=$(tail -5 "$SANDBOX/l1.err")"
fi
[[ "$(tree_fingerprint)" == "$BASE_FP" ]] \
  && pass "L1 查询命令零落盘（事实源树指纹不变）" || fail "L1" "查询命令改动了工作树"
[[ -d "$STATE/in-1" && -f "$STATE/in-1/defects/DEF-0001.json" && -f "$STATE/in-1/replay/DEF-0001.mjs" ]] \
  && pass "L1 宿主树经 stdin tar 进容器（defects/replay/tests 只读通道）" \
  || fail "L1" "容器内未见宿主树：$(find "$STATE" -maxdepth 2 -name 'in-*' 2>/dev/null)"
grep -q 'tar -x -C /tmp/in' "$STATE/calls.log" \
  && pass "L1 容器侧解包到 /tmp/in（无 bind、无宿主写通道）" || fail "L1" "未见 stdin tar 解包命令"
jq -s -e 'any(.[]; .event == "workspace.fresh" or .event == "workspace.built")' "$SANDBOX/l1.out" >/dev/null 2>&1 \
  && pass "L1 新鲜度事件留在结果流（未被查询数据吞掉）" || fail "L1" "结果流缺 workspace 事件"
tail -1 "$SANDBOX/l1.out" | jq -e '.command == "e2e" and (.defects | length == 2)' >/dev/null 2>&1 \
  && pass "L1 终值为单行紧凑 JSON（JSONL 结果流不被多行文档破坏）" || fail "L1" "终值非单行 JSON：$(tail -2 "$SANDBOX/l1.out")"

# ---------------------------------------------------------------------------
# L2 defect show：摘要 + 证据 URI；人读模式走 stdout
# ---------------------------------------------------------------------------
run_cmd l2 "$DEVENV" --json e2e defect show DEF-0001
if [[ "$RC" == 0 ]] && last_json "$SANDBOX/l2.out" '.defect.id == "DEF-0001" and .defect.evidence[0].uri == ".artifacts/e2e/exp-offline/results.json"'; then
  pass "L2 defect show --json 输出记录（证据只存 URI）"
else
  fail "L2" "rc=$RC out=$(tail -2 "$SANDBOX/l2.out") err=$(tail -5 "$SANDBOX/l2.err")"
fi
run_cmd l2h "$DEVENV" e2e defect show DEF-0001
[[ "$RC" == 0 ]] && grep -q 'DEF-0001' "$SANDBOX/l2h.out" \
  && pass "L2 人读模式摘要走 stdout（可管道）" || fail "L2h" "rc=$RC out=$(cat "$SANDBOX/l2h.out")"

# ---------------------------------------------------------------------------
# L3 未知 ID → exit 10；拒绝原因透出（END 诊断不被 set -e 吞掉）
# ---------------------------------------------------------------------------
run_cmd l3 "$DEVENV" --json e2e defect show DEF-9999
[[ "$RC" == 10 ]] && pass "L3 未知 ID exit 10" || fail "L3" "rc=$RC（期望 10）err=$(tail -3 "$SANDBOX/l3.err")"
grep -q '缺陷不存在：DEF-9999' "$SANDBOX/l3.err" \
  && pass "L3 拒绝原因透出到 stderr（END 行诊断未被吞）" || fail "L3" "stderr 缺原因：$(tail -3 "$SANDBOX/l3.err")"
last_json "$SANDBOX/l3.out" '.status == "failed" and .exitCode == 10' \
  && pass "L3 --json 终值 status=failed exitCode=10（机器可解析）" || fail "L3" "终值不符：$(tail -1 "$SANDBOX/l3.out")"
run_cmd l3h "$DEVENV" e2e defect show DEF-9999
[[ "$RC" == 10 ]] && pass "L3 人读模式未知 ID 同样 exit 10" || fail "L3h" "rc=$RC"

# ---------------------------------------------------------------------------
# L4 非法记录 → exit 10（schema 不符）
# ---------------------------------------------------------------------------
printf '{"schemaVersion":1,"id":"DEF-0001"\n' > "$E2E_DIR/defects/DEF-0001.json"
run_cmd l4 "$DEVENV" --json e2e defect list
[[ "$RC" == 10 ]] && pass "L4 非法记录 exit 10" || fail "L4" "rc=$RC（期望 10）"
grep -q 'schema 不符' "$SANDBOX/l4.err" \
  && pass "L4 schema 拒绝原因透出" || fail "L4" "stderr 缺原因：$(tail -3 "$SANDBOX/l4.err")"
git -C "$MINI" checkout -- apps/e2e/defects/DEF-0001.json

# ---------------------------------------------------------------------------
# L5 注册表：始终重建（派生缓存），不入库
# ---------------------------------------------------------------------------
run_cmd l5 "$DEVENV" --json e2e registry rebuild
if [[ "$RC" == 0 && -f "$E2E_DIR/.registry.json" ]] \
  && jq -e '.defects | length == 2' "$E2E_DIR/.registry.json" >/dev/null 2>&1 \
  && has_event "$SANDBOX/l5.out" "registry.rebuilt"; then
  pass "L5 registry rebuild 落盘派生缓存 + registry.rebuilt 事件"
else
  fail "L5" "rc=$RC out=$(tail -2 "$SANDBOX/l5.out") err=$(tail -5 "$SANDBOX/l5.err") reg=$(cat "$E2E_DIR/.registry.json" 2>/dev/null)"
fi
git -C "$MINI" check-ignore -q apps/e2e/.registry.json \
  && pass "L5 注册表不入库（.gitignore 排除）" || fail "L5" "注册表未被 gitignore"
run_cmd l5b "$DEVENV" --json e2e registry rebuild
has_event "$SANDBOX/l5b.out" "registry.rebuilt" ' and .drift == "no"' \
  && pass "L5b 无漂移时重建仍执行（始终重建，drift=no）" || fail "L5b" "out=$(tail -2 "$SANDBOX/l5b.out")"

# ---------------------------------------------------------------------------
# L6 注册表漂移：仅 WARN，不硬门禁（原型「漂移即红」死锁的修复）
# ---------------------------------------------------------------------------
printf '{"defects":[{"id":"DEF-0001","status":"retired","engine":"agent-session","specPath":null}]}\n' \
  > "$E2E_DIR/.registry.json"
run_cmd l6 "$DEVENV" --json e2e registry rebuild
if [[ "$RC" == 0 ]] && grep -q 'WARN' "$SANDBOX/l6.err" \
  && has_event "$SANDBOX/l6.out" "registry.rebuilt" ' and .drift == "yes"' \
  && jq -e '.defects[0].status == "reported"' "$E2E_DIR/.registry.json" >/dev/null 2>&1; then
  pass "L6 漂移仅 WARN + 自动重建为事实源同构（exit 0，不硬门禁）"
else
  fail "L6" "rc=$RC err=$(tail -4 "$SANDBOX/l6.err") out=$(tail -2 "$SANDBOX/l6.out") reg=$(cat "$E2E_DIR/.registry.json")"
fi
grep -q '完整性以' "$SANDBOX/l6.err" \
  && pass "L6 WARN 指明完整性锚在入库记录（非缓存）" || fail "L6" "WARN 未说明事实源：$(tail -3 "$SANDBOX/l6.err")"

# ---------------------------------------------------------------------------
# L7 op 协议原子应用：多项 W/D 全应用（新写 + 覆盖 + 删除）
# ---------------------------------------------------------------------------
lifecycle_write l7 fixture-write
if [[ "$RC" == 0 && -f "$E2E_DIR/defects/DEF-0003.json" ]] \
  && grep -q '覆盖' "$E2E_DIR/replay/DEF-0001.mjs" \
  && [[ ! -f "$E2E_DIR/tests/repro/.gitkeep" ]]; then
  pass "L7 W/D 行协议宿主侧全应用（新写/覆盖/删除）"
else
  fail "L7" "rc=$RC err=$(tail -5 "$SANDBOX/l7.err") tree=$(cd "$E2E_DIR" && find . -type f | sort)"
fi
jq -s -e 'all(.[]; .status != "failed")' "$SANDBOX/l7.out" >/dev/null 2>&1 \
  && pass "L7 写路径无失败终值（命令面终值由 L5 registry rebuild 覆盖）" || fail "L7" "出现失败终值：$(tail -1 "$SANDBOX/l7.out")"
rm -f "$E2E_DIR/defects/DEF-0003.json"
git -C "$MINI" checkout -- apps/e2e/replay/DEF-0001.mjs apps/e2e/tests/repro/.gitkeep

# ---------------------------------------------------------------------------
# L8 V 校验不符 → exit 9 零落盘（同批 W 绝不应用）
# ---------------------------------------------------------------------------
BEFORE_FP="$(tree_fingerprint)"
export MOCK_VERIFY_RC=0 LIFECYCLE_VERIFY_RUN=1
lifecycle_write l8 fixture-v-mismatch
unset LIFECYCLE_VERIFY_RUN
[[ "$RC" == 9 ]] && pass "L8 V expect=fail 却通过 → exit 9" || fail "L8" "rc=$RC（期望 9）err=$(tail -4 "$SANDBOX/l8.err")"
[[ "$(tree_fingerprint)" == "$BEFORE_FP" ]] \
  && pass "L8 判定不符零落盘（同批 W 未应用）" || fail "L8" "判定不符仍写盘"
grep -q '判定不符' "$SANDBOX/l8.err" \
  && pass "L8 拒绝原因透出（expect 与实际判定）" || fail "L8" "stderr 缺原因：$(tail -3 "$SANDBOX/l8.err")"
last_json "$SANDBOX/l8.out" '.status == "failed" and .exitCode == 9' \
  && pass "L8 --json 终值 failed/9" || fail "L8" "终值不符：$(tail -1 "$SANDBOX/l8.out")"
has_event "$SANDBOX/l8.out" "step.completed" ' and .verdict == "did-not-fail"' \
  && pass "L8 verdict 事件留痕（did-not-fail）" || fail "L8" "缺 verdict 事件：$(tail -3 "$SANDBOX/l8.out")"
[[ -f "$STATE/verify-in-1/def-0001.verify.spec.ts" ]] \
  && pass "L8 V 载荷经 tar 注入执行器（宿主 .verify-run 生成）" || fail "L8" "载荷未注入：$(find "$STATE" -maxdepth 2 -name 'verify-in-*')"
[[ ! -d "$E2E_DIR/.verify-run" ]] \
  && pass "L8 校验运行后宿主临时目录清理" || fail "L8" ".verify-run 残留"

# ---------------------------------------------------------------------------
# L8b V 判定相符 → 落账（expect=fail 且真失败）
# ---------------------------------------------------------------------------
export MOCK_VERIFY_RC=1 LIFECYCLE_VERIFY_RUN=1
lifecycle_write l8b fixture-v-match
unset MOCK_VERIFY_RC LIFECYCLE_VERIFY_RUN
if [[ "$RC" == 0 ]] && jq -e '.status == "graduated"' "$E2E_DIR/defects/DEF-0001.json" >/dev/null 2>&1; then
  pass "L8b V 判定相符 → W 落账（真跑后才应用）"
else
  fail "L8b" "rc=$RC err=$(tail -4 "$SANDBOX/l8b.err")"
fi
has_event "$SANDBOX/l8b.out" "step.completed" ' and .verdict == "reproduced"' \
  && pass "L8b verdict=reproduced 留痕" || fail "L8b" "缺 verdict 事件"
git -C "$MINI" checkout -- apps/e2e/defects/DEF-0001.json

# ---------------------------------------------------------------------------
# L9 END error → 透传退出码 + 零落盘 + 原因透出
# ---------------------------------------------------------------------------
BEFORE_FP="$(tree_fingerprint)"
lifecycle_write l9 fixture-end-error
[[ "$RC" == 8 ]] && pass "L9 END error 透传退出码 8" || fail "L9" "rc=$RC（期望 8）"
[[ "$(tree_fingerprint)" == "$BEFORE_FP" ]] \
  && pass "L9 END error 零落盘" || fail "L9" "END error 仍写盘"
grep -q '重复毕业被拒' "$SANDBOX/l9.err" \
  && pass "L9 END 拒绝原因透出" || fail "L9" "stderr 缺原因：$(tail -3 "$SANDBOX/l9.err")"

# ---------------------------------------------------------------------------
# L10 无 END 的异常退出（容器/构建问题）→ 4，子进程码入 taskRc
# ---------------------------------------------------------------------------
BEFORE_FP="$(tree_fingerprint)"
lifecycle_write l10 fixture-crash
[[ "$RC" == 4 ]] && pass "L10 无 END 行崩溃 → exit 4（不外逸子进程码）" || fail "L10" "rc=$RC（期望 4）"
last_json "$SANDBOX/l10.out" '.status == "failed" and .exitCode == 4 and .taskRc == "3"' \
  && pass "L10 终值含 taskRc=3（诊断可追）" || fail "L10" "终值不符：$(tail -1 "$SANDBOX/l10.out")"
[[ "$(tree_fingerprint)" == "$BEFORE_FP" ]] && pass "L10 崩溃零落盘" || fail "L10" "崩溃仍写盘"

# ---------------------------------------------------------------------------
# L11 op 路径越界 → 拒绝且零落盘（协议不可写 apps/e2e 之外）
# ---------------------------------------------------------------------------
BEFORE_FP="$(tree_fingerprint)"
lifecycle_write l11 fixture-bad-path
[[ "$RC" != 0 ]] && pass "L11 越界路径 op 被拒绝（rc=$RC）" || fail "L11" "越界 op 未被拒绝"
[[ ! -f "$MINI/apps/escape.txt" && ! -f "$SANDBOX/escape.txt" ]] \
  && pass "L11 越界零落盘" || fail "L11" "越界文件被写入"
[[ "$(tree_fingerprint)" == "$BEFORE_FP" ]] && pass "L11 事实源树未变" || fail "L11" "树被改动"

# ---------------------------------------------------------------------------
# L12 应用中途失败 → 全量还原（原子性：不留半成品）
# ---------------------------------------------------------------------------
BEFORE_FP="$(tree_fingerprint)"
lifecycle_write l12 fixture-apply-fail
[[ "$RC" != 0 ]] && pass "L12 应用失败非零退出（rc=$RC）" || fail "L12" "应用失败仍 exit 0"
[[ "$(tree_fingerprint)" == "$BEFORE_FP" ]] \
  && pass "L12 失败后工作区全量还原（先写的 DEF-0009 已回滚）" \
  || fail "L12" "残留半成品：$(cd "$E2E_DIR" && find . -type f | sort)"

# ---------------------------------------------------------------------------
# L13 生命周期写锁：per-worktree mkdir 锁，冲突 exit 6 零落盘
# ---------------------------------------------------------------------------
sleep 30 & LOCK_HOLDER=$!
mkdir -p "$DEVENV_LOCK_ROOT/e2e-lifecycle-$MOCK_STACK_SUFFIX.lock"
printf '%s %s\n' "$LOCK_HOLDER" "$(date +%s)" > "$DEVENV_LOCK_ROOT/e2e-lifecycle-$MOCK_STACK_SUFFIX.lock/owner"
BEFORE_FP="$(tree_fingerprint)"
run_cmd l13 "$DEVENV" --json e2e registry rebuild
kill -9 "$LOCK_HOLDER" 2>/dev/null; wait "$LOCK_HOLDER" 2>/dev/null || true
rm -rf "$DEVENV_LOCK_ROOT/e2e-lifecycle-$MOCK_STACK_SUFFIX.lock"
[[ "$RC" == 6 ]] && pass "L13 生命周期写锁被占 → exit 6" || fail "L13" "rc=$RC（期望 6）err=$(tail -3 "$SANDBOX/l13.err")"
grep -q 'e2e-lifecycle' "$SANDBOX/l13.err" \
  && pass "L13 冲突诊断含锁名与持有者" || fail "L13" "stderr 缺锁名：$(tail -3 "$SANDBOX/l13.err")"
[[ "$(tree_fingerprint)" == "$BEFORE_FP" ]] && pass "L13 锁冲突零落盘" || fail "L13" "锁冲突仍写盘"
run_cmd l13b "$DEVENV" --json e2e registry rebuild
[[ "$RC" == 0 ]] && pass "L13b 锁释放后重跑成功" || fail "L13b" "rc=$RC err=$(tail -3 "$SANDBOX/l13b.err")"
[[ -z "$(find "$DEVENV_LOCK_ROOT" -maxdepth 1 -name 'e2e-lifecycle-*.lock' -type d 2>/dev/null)" ]] \
  && pass "L13 正常路径结束后写锁释放" || fail "L13" "写锁残留"

# ---------------------------------------------------------------------------
# L14 用法错误 exit 2（缺参数 / 未知子命令；后续票命令尚未实现）
# ---------------------------------------------------------------------------
run_cmd l14a "$DEVENV" e2e defect
[[ "$RC" == 2 ]] && pass "L14 defect 缺动作 exit 2" || fail "L14a" "rc=$RC"
run_cmd l14b "$DEVENV" e2e defect show
[[ "$RC" == 2 ]] && pass "L14 defect show 缺 ID exit 2" || fail "L14b" "rc=$RC"
run_cmd l14c "$DEVENV" e2e graduate DEF-0001
[[ "$RC" == 2 ]] && pass "L14 未实现子命令（graduate）exit 2" || fail "L14c" "rc=$RC"
run_cmd l14d "$DEVENV" e2e defect bogus
[[ "$RC" == 2 ]] && pass "L14 未知 defect 动作 exit 2" || fail "L14d" "rc=$RC"
run_cmd l14e "$DEVENV" e2e defect show DEF-1
[[ "$RC" == 2 ]] && pass "L14 ID 格式非法 exit 2" || fail "L14e" "rc=$RC"

# ---------------------------------------------------------------------------
# L15 取号：本地 max+1；远端叠读（best-effort，失败回退本地 + WARN）
# ---------------------------------------------------------------------------
run_cmd l15 "$DEVENV" --json e2e defect next-id
if [[ "$RC" == 0 ]] && last_json "$SANDBOX/l15.out" '.id == "DEF-0003" and .remoteStatus == "skipped"'; then
  pass "L15 本地 max+1 取号（DEF-0002 → DEF-0003）"
else
  fail "L15" "rc=$RC out=$(tail -1 "$SANDBOX/l15.out") err=$(tail -4 "$SANDBOX/l15.err")"
fi
# 远端叠读：stub gha_cmd_gh（真实 gh 由认证入口测试覆盖）——远端已有 DEF-0007
L15_REMOTE_RC=0
(
  set -Eeuo pipefail
  REPO_ROOT="$MINI"
  source "$REPO_ROOT/devenv/lib/output.sh"
  source "$REPO_ROOT/devenv/lib/github-app-auth.sh"
  source "$REPO_ROOT/devenv/lib/e2e-lifecycle.sh"
  gha_cmd_gh() { printf 'DEF-0007.json\nDEF-0004.json\nREADME.md\n'; }
  e2e_remote_defect_max dev
) > "$SANDBOX/l15-remote.out" 2> "$SANDBOX/l15-remote.err" || L15_REMOTE_RC=$?
[[ "$L15_REMOTE_RC" == 0 && "$(cat "$SANDBOX/l15-remote.out")" == "7" ]] \
  && pass "L15 远端编号叠读（经 devenv gh 入口，取最大 DEF-0007）" \
  || fail "L15remote" "rc=$L15_REMOTE_RC out=$(cat "$SANDBOX/l15-remote.out") err=$(tail -3 "$SANDBOX/l15-remote.err")"
# 远端读失败 → best-effort：非零返回，调用方回退本地
L15_FAIL_RC=0
(
  set -Eeuo pipefail
  REPO_ROOT="$MINI"
  source "$REPO_ROOT/devenv/lib/output.sh"
  source "$REPO_ROOT/devenv/lib/github-app-auth.sh"
  source "$REPO_ROOT/devenv/lib/e2e-lifecycle.sh"
  gha_cmd_gh() { return 22; }
  e2e_remote_defect_max dev
) > "$SANDBOX/l15-fail.out" 2> "$SANDBOX/l15-fail.err" || L15_FAIL_RC=$?
[[ "$L15_FAIL_RC" != 0 ]] \
  && pass "L15 远端读失败如实非零返回（调用方 best-effort 回退本地）" \
  || fail "L15fail" "远端失败被吞（rc=$L15_FAIL_RC）"
# 命令面：--remote 且远端不可用 → 回退本地 + WARN（不硬失败）
run_cmd l15r "$DEVENV" --json e2e defect next-id --remote
if [[ "$RC" == 0 ]] && last_json "$SANDBOX/l15r.out" '.id == "DEF-0003" and .remoteStatus == "unavailable"' \
  && grep -q 'best-effort' "$SANDBOX/l15r.err"; then
  pass "L15 --remote 远端不可用时回退本地 max+1 + WARN（best-effort）"
else
  fail "L15r" "rc=$RC out=$(tail -1 "$SANDBOX/l15r.out") err=$(tail -3 "$SANDBOX/l15r.err")"
fi

# ---------------------------------------------------------------------------
# L16 空树（无缺陷记录）：list 空数组 exit 0；next-id 从 DEF-0001 起
# ---------------------------------------------------------------------------
EMPTY="$SANDBOX/empty-tree"
mkdir -p "$EMPTY"
run_cmd l16 env DEVENV_E2E_LIFECYCLE_DIR="$EMPTY" "$DEVENV" --json e2e defect list
if [[ "$RC" == 0 ]] && last_json "$SANDBOX/l16.out" '.defects == []'; then
  pass "L16 空树 list 输出空数组 exit 0（绿地无缺陷是合法状态）"
else
  fail "L16" "rc=$RC out=$(tail -1 "$SANDBOX/l16.out") err=$(tail -4 "$SANDBOX/l16.err")"
fi
run_cmd l16n env DEVENV_E2E_LIFECYCLE_DIR="$EMPTY" "$DEVENV" --json e2e defect next-id
if [[ "$RC" == 0 ]] && last_json "$SANDBOX/l16n.out" '.id == "DEF-0001"'; then
  pass "L16 空树取号从 DEF-0001 起"
else
  fail "L16n" "rc=$RC out=$(tail -1 "$SANDBOX/l16n.out")"
fi

# ---------------------------------------------------------------------------
echo "------------------------------------------------------------"
echo "e2e 生命周期编排离线测试完成：${PASS_COUNT} 通过，${FAILURES} 失败"
[[ "$FAILURES" == 0 ]]