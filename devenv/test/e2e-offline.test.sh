#!/usr/bin/env bash
# ============================================================================
# e2e 隔离 run 编排离线测试（#70）——不访问真实引擎（docker 全部 mock）
#
# 覆盖（Spec-工程基座 §4「e2e run 服务绑定」+ 验收项 6「并发 e2e 隔离」）：
#   1. `devenv e2e build`：执行器镜像经真实入口构建；Playwright 镜像 tag 与
#      npm 包版本严格同版本（build-arg/label）；命中后复用不重复构建
#   2. 命名净化三规则：DB 标识符 / bucket / 队列名分别按存储规则净化，
#      超长截断 + 短哈希保唯一（不产生非法名或撞名）
#   3. `devenv explore` 全流程：共享基础设施接入 per-run 网络（别名 db/redis/rustfs）、
#      每 run 库创建 + 迁移、per-run API/worker/web 启动时注入本 run 连接/bucket/
#      队列名、执行器跑探索轨道、产物导出宿主 + run.json、资源回收
#   4. 运行期持 #61 共享栈使用租约（执行器运行窗口内租约在场，退出后释放）
#   5. 探索发现语义：Playwright 非零 → exit 4，提示「这是产出，不是环境事故」，
#      产物路径可查；登记册状态 failed
#   6. 前置：基础设施未运行 → exit 3（提示 devenv up，不静默跳过）
#   7. `devenv e2e runs` 登记册可查询
# ============================================================================
set -Eeuo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TEST_DIR/../.." && pwd)"

FAILURES=0
PASS_COUNT=0
pass() { printf 'PASS: %s\n' "$1"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { printf 'FAIL: %s —— %s\n' "$1" "$2"; FAILURES=$((FAILURES + 1)); }

SANDBOX=$(mktemp -d /tmp/devenv-e2e-offline.XXXXXX)
trap 'rm -rf "$SANDBOX"' EXIT
echo "沙箱：$SANDBOX"

# ---------------------------------------------------------------------------
# 最小仓库（真实 devenv 库 + e2e 包清单）+ mock docker
# ---------------------------------------------------------------------------
MINI="$SANDBOX/mini"
mkdir -p "$MINI"
cp -r "$REPO_ROOT/devenv" "$MINI/devenv"
mkdir -p "$MINI/apps/api" "$MINI/apps/web" "$MINI/apps/e2e" \
         "$MINI/packages/contracts" "$MINI/packages/tsconfig"
printf 'node_modules/\n.devenv-state/\n' > "$MINI/.gitignore"
# 供应链静态门禁输入（e2e build 与 build 同一预检）：直接镜像真实声明/锁文件/清单
cp "$REPO_ROOT/package.json" "$MINI/package.json"
cp "$REPO_ROOT/pnpm-lock.yaml" "$MINI/pnpm-lock.yaml"
cp "$REPO_ROOT/pnpm-workspace.yaml" "$MINI/pnpm-workspace.yaml"
cp "$REPO_ROOT/apps/api/package.json" "$MINI/apps/api/package.json"
cp "$REPO_ROOT/apps/web/package.json" "$MINI/apps/web/package.json"
cp "$REPO_ROOT/apps/e2e/package.json" "$MINI/apps/e2e/package.json"
cp "$REPO_ROOT/packages/contracts/package.json" "$MINI/packages/contracts/package.json"
cp "$REPO_ROOT/packages/tsconfig/package.json" "$MINI/packages/tsconfig/package.json"
printf '{"compilerOptions":{}}\n' > "$MINI/packages/tsconfig/tsconfig.json"
git -C "$MINI" init -q
git -C "$MINI" config user.email "offline@test"
git -C "$MINI" config user.name "offline"
git -C "$MINI" add -A
git -C "$MINI" commit -qm init

STATE="$SANDBOX/docker-state"
mkdir -p "$STATE/images" "$STATE/tags" "$SANDBOX/bin"
cat > "$SANDBOX/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
STATE="${MOCK_DOCKER_STATE:?}"
mkdir -p "$STATE/images" "$STATE/tags"
joined="$*"
{
  printf 'docker %s' "$*"
  printf ' | E2E_RUN_ID=%s E2E_DATABASE_URL=%s E2E_S3_BUCKET=%s E2E_QUEUE_NAME=%s E2E_TRACK=%s\n' \
    "${E2E_RUN_ID:-}" "${E2E_DATABASE_URL:-}" "${E2E_S3_BUCKET:-}" "${E2E_QUEUE_NAME:-}" "${E2E_TRACK:-}"
} >> "$STATE/calls.log"

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
    if [[ "$sub" == "up" ]]; then
      : > "$STATE/e2e-up-$project"
    elif [[ "$sub" == "down" ]]; then
      rm -f "$STATE/e2e-up-$project"
    elif [[ "$sub" == "run" && "$joined" == *"playwright test"* ]]; then
      if [[ "${MOCK_ASSERT_LEASE:-}" == "1" ]]; then
        if find "$DEVENV_LOCK_ROOT" -maxdepth 4 -path "*stack-${MOCK_STACK_SUFFIX}.lease/*/owner" -type f 2>/dev/null | grep -q .; then
          printf 'lease-held\n' >> "$STATE/lease-check.txt"
        else
          printf 'lease-MISSING\n' >> "$STATE/lease-check.txt"
        fi
      fi
      exit "${MOCK_PLAYWRIGHT_RC:-0}"
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
    src="$1"; tag="$2"
    id="$src"
    if [[ "$src" != sha256:* ]]; then id="$(cat "$STATE/tags/$(sanitize "$src")")"; fi
    printf '%s\n' "$id" > "$STATE/tags/$(sanitize "$tag")" ;;
  pull) exit 0 ;;
  ps)
    project=""; service=""; runid=""; allruns=0; fmt=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --filter)
          f="$2"; shift 2
          case "$f" in
            label=com.docker.compose.project=*) project="${f#label=com.docker.compose.project=}" ;;
            label=com.docker.compose.service=*) service="${f#label=com.docker.compose.service=}" ;;
            label=devenv.e2e.run-id=*) runid="${f#label=devenv.e2e.run-id=}" ;;
            label=devenv.e2e.worktree=*) : ;;
            label=devenv.e2e.run-id) allruns=1 ;;
          esac ;;
        --format) fmt="$2"; shift 2 ;;
        -a) shift ;;
        *) shift ;;
      esac
    done
    if (( allruns )); then
      [[ -n "${MOCK_ACTIVE_RUN_IDS:-}" ]] && printf '%s\n' "$MOCK_ACTIVE_RUN_IDS" | tr ',' '\n'
      exit 0
    fi
    if [[ -n "$runid" ]]; then
      [[ "${MOCK_LIVE_RUN_ID:-}" == "$runid" ]] && printf '%s\n' "$runid"
      exit 0
    fi
    cid=""
    if [[ -n "$project" && "$project" == *-e2e-* ]]; then
      if [[ -f "$STATE/e2e-up-$project" && "$service" =~ ^(api|worker|web)$ ]]; then cid="cid-$project-$service"; fi
    elif [[ -n "$service" ]]; then
      [[ "${MOCK_INFRA_DOWN:-}" == "1" ]] || case "$service" in db|redis|rustfs) cid="cid-$service" ;; esac
    fi
    if [[ "$fmt" == *'{{.Names}}'* ]]; then
      [[ -n "$cid" ]] && printf '%s-name\n' "$cid"
    elif [[ "$fmt" == *'{{.ID}}'* ]]; then
      [[ -n "$cid" ]] && printf '%s\n' "$cid"
    else
      [[ -n "$cid" ]] && printf '%s\n' "$cid"
    fi
    exit 0 ;;
  inspect)
    # 容器健康检查（image inspect 走上一个分支）
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
      connect) : ;;
      disconnect) : ;;
      rm) rm -f "$STATE/net-$1" ;;
    esac ;;
  create) printf 'cid-artifacts\n' ;;
  cp)
    dest="${!#}"
    mkdir -p "$dest/test-results"
    printf '{"stats":{"expected":3,"unexpected":0,"flaky":0,"skipped":0},"suites":[]}\n' > "$dest/results.json"
    printf 'trace\n' > "$dest/test-results/trace.zip" ;;
  rm|rmi) exit 0 ;;
  logs) printf 'mock logs\n' ;;
  *) exit 0 ;;
esac
MOCK
chmod +x "$SANDBOX/bin/docker"

export PATH="$SANDBOX/bin:$PATH"
export MOCK_DOCKER_STATE="$STATE"
export DEVENV_DOCKER_HOST="unix:///mock.sock"
export DEVENV_LOCK_ROOT="$SANDBOX/locks"
export DEVENV_STATE_DIR="$MINI/.devenv-state"
export DEVENV_E2E_ARTIFACTS_DIR="$SANDBOX/artifacts"
export DEVENV_WORKTREE_ID="wt-e2e"
export MOCK_STACK_SUFFIX="$(printf '%s' "wt-e2e" | sha256sum | awk '{print $1}' | cut -c1-8)"
export MOCK_ASSERT_LEASE=1
export DEVENV_LOCK_TIMEOUT=5
PROJECT="natural-enforcement-$MOCK_STACK_SUFFIX"
DEVENV="$MINI/devenv/devenv"

run_cmd() { # run_cmd <name> <cmd...>
  local name="$1"; shift
  set +e
  "$@" > "$SANDBOX/$name.out" 2> "$SANDBOX/$name.err"
  RC=$?
  set -e
}

echo "沙箱 worktree 身份：$DEVENV_WORKTREE_ID（suffix=$MOCK_STACK_SUFFIX）"

# ---------------------------------------------------------------------------
# E1 e2e build：执行器镜像经真实入口构建；版本严格同源；命中复用
# ---------------------------------------------------------------------------
: > "$STATE/calls.log"
run_cmd e1a "$DEVENV" e2e build
E1_LINE="$(grep 'e2e.Dockerfile' "$STATE/calls.log" || true)"
if [[ "$RC" == 0 ]] && [[ "$E1_LINE" == *"--build-arg PLAYWRIGHT_IMAGE=mcr.microsoft.com/playwright:v1.65.1-noble@sha256:"* ]] \
  && [[ "$E1_LINE" == *"--build-arg PLAYWRIGHT_VERSION=1.65.1"* ]] \
  && [[ "$E1_LINE" == *"--label devenv.playwright.version=1.65.1"* ]]; then
  pass "E1 e2e build 经真实入口构建，Playwright 镜像/包版本严格同源"
else
  fail "E1" "rc=$RC line=$E1_LINE err=$(tail -3 "$SANDBOX/e1a.err")"
fi
E1_ID="$(awk -F= '/^E2E_IMAGE_ID=/{print $2}' "$DEVENV_STATE_DIR/e2e-image.env" 2>/dev/null || true)"
[[ -n "$E1_ID" ]] && pass "E1 独立状态文件记录执行器不可变镜像 ID" || fail "E1" "状态缺 E2E_IMAGE_ID：$(cat "$DEVENV_STATE_DIR/e2e-image.env" 2>/dev/null)"

: > "$STATE/calls.log"
run_cmd e1b "$DEVENV" e2e build
if [[ "$RC" == 0 ]] && ! grep -q 'e2e.Dockerfile' "$STATE/calls.log"; then
  pass "E1b 快照/版本命中时复用既有执行器镜像（不重复构建）"
else
  fail "E1b" "rc=$RC log=$(cat "$STATE/calls.log")"
fi

# ---------------------------------------------------------------------------
# E2 前置：基础设施未运行 → exit 3（提示 devenv up，不静默跳过）
# ---------------------------------------------------------------------------
run_cmd e2 env MOCK_INFRA_DOWN=1 "$DEVENV" explore --run-id prereq-a1
if [[ "$RC" == 3 ]] && grep -q 'devenv up' "$SANDBOX/e2.err"; then
  pass "E2 基础设施未就绪 exit 3 并给出修复命令"
else
  fail "E2" "rc=$RC err=$(tail -3 "$SANDBOX/e2.err")"
fi

# ---------------------------------------------------------------------------
# E3 explore 成功路径：per-run 命名/网络/服务绑定/产物/租约/回收
# ---------------------------------------------------------------------------
: > "$STATE/calls.log"
: > "$STATE/lease-check.txt"
rm -f "$STATE/e2e-up-$PROJECT-e2e-success-a1" 2>/dev/null || true
run_cmd e3 "$DEVENV" explore --run-id success-a1
UP_LINE="$(grep 'up -d api worker web' "$STATE/calls.log" | head -1 || true)"
MIGRATE_LINE="$(grep 'prisma migrate deploy' "$STATE/calls.log" | head -1 || true)"
EXEC_LINE="$(grep 'playwright test --config=playwright.explore.config.ts' "$STATE/calls.log" | head -1 || true)"
RUN_JSON="$SANDBOX/artifacts/success-a1/run.json"

if [[ "$RC" == 0 ]]; then
  pass "E3 explore 成功路径 exit 0"
else
  fail "E3" "rc=$RC err=$(tail -8 "$SANDBOX/e3.err")"
fi
if [[ "$UP_LINE" == *"compose -p $PROJECT-e2e-success-a1"* ]]; then
  pass "E3 每 run 独立 compose 项目"
else
  fail "E3" "未看到 per-run 项目名：$UP_LINE"
fi
if [[ "$UP_LINE" == *"E2E_DATABASE_URL=postgresql://ne:"*"/e2e_success_a1"* ]] \
  && [[ "$UP_LINE" == *"E2E_S3_BUCKET=e2e-success-a1"* ]] \
  && [[ "$UP_LINE" == *"E2E_QUEUE_NAME=e2e-success-a1-evidence-processing"* ]]; then
  pass "E3 API/worker 启动注入本 run 数据库/bucket/队列名（服务绑定）"
else
  fail "E3" "服务绑定环境缺失或不符：$UP_LINE"
fi
if grep -q 'DROP DATABASE IF EXISTS "e2e_success_a1" WITH (FORCE)' "$STATE/calls.log" \
  && grep -q 'CREATE DATABASE "e2e_success_a1"' "$STATE/calls.log"; then
  pass "E3 每 run 独立数据库幂等重建（DROP FORCE + CREATE）"
else
  fail "E3" "库重建命令缺失：$(grep -i 'database' "$STATE/calls.log" | tail -3)"
fi
if [[ "$MIGRATE_LINE" == *"DATABASE_URL=postgresql://ne:"*"/e2e_success_a1"* ]] \
  && [[ "$MIGRATE_LINE" == *"tools pnpm --filter @ne/api exec prisma migrate deploy"* ]]; then
  pass "E3 迁移落在本 run 数据库"
else
  fail "E3" "迁移目标不符：$MIGRATE_LINE"
fi
if grep -q "network connect --alias db $PROJECT-e2e-success-a1-net cid-db" "$STATE/calls.log" \
  && grep -q "network connect --alias redis $PROJECT-e2e-success-a1-net cid-redis" "$STATE/calls.log" \
  && grep -q "network connect --alias rustfs $PROJECT-e2e-success-a1-net cid-rustfs" "$STATE/calls.log"; then
  pass "E3 共享基础设施容器以别名接入 per-run 网络（不复制基础设施）"
else
  fail "E3" "网络接入不符：$(grep 'network connect' "$STATE/calls.log" | tail -5)"
fi
[[ "$EXEC_LINE" == *"run --rm -T e2e"* && "$EXEC_LINE" == *"E2E_TRACK=explore"* ]] \
  && pass "E3 执行器跑探索轨道（per-run 网络内）" \
  || fail "E3" "执行器调用不符：$EXEC_LINE"
grep -q "label=devenv.e2e.worktree=$MOCK_STACK_SUFFIX" "$STATE/calls.log" \
  && pass "E3 live 检查按 worktree 标签限定" || fail "E3" "live 检查未带 worktree 过滤"
grep -q 'lease-held' "$STATE/lease-check.txt" 2>/dev/null \
  && ! grep -q 'lease-MISSING' "$STATE/lease-check.txt" 2>/dev/null \
  && pass "E3 执行器运行窗口内持 #61 共享栈使用租约" \
  || fail "E3" "租约不在场：$(cat "$STATE/lease-check.txt" 2>/dev/null)"
[[ -z "$(find "$DEVENV_LOCK_ROOT" -maxdepth 4 -path '*.lease/*/owner' -type f 2>/dev/null)" ]] \
  && pass "E3 run 结束后租约释放" || fail "E3" "租约残留"
[[ -z "$(find "$DEVENV_LOCK_ROOT" -maxdepth 1 -name 'e2e-owner-*.lock' -type d 2>/dev/null)" ]] \
  && pass "E3 run 结束后所有权锁释放" || fail "E3" "所有权锁残留：$(find "$DEVENV_LOCK_ROOT" -maxdepth 1 -name 'e2e-owner-*.lock' -type d)"
[[ -f "$RUN_JSON" && -f "$SANDBOX/artifacts/success-a1/results.json" ]] \
  && pass "E3 运行产物导出到宿主证据目录（results.json + run.json）" \
  || fail "E3" "产物缺失：$(find "$SANDBOX/artifacts" -maxdepth 3 -type f 2>/dev/null)"
if [[ -f "$RUN_JSON" ]] \
  && [[ "$(jq -r '.resources.database' "$RUN_JSON")" == "e2e_success_a1" ]] \
  && [[ "$(jq -r '.resources.bucket' "$RUN_JSON")" == "e2e-success-a1" ]] \
  && [[ "$(jq -r '.resources.queue' "$RUN_JSON")" == "e2e-success-a1-evidence-processing" ]] \
  && [[ -n "$(jq -r '.images.executor' "$RUN_JSON")" ]]; then
  pass "E3 run.json 记录本 run 资源坐标与执行器镜像绑定"
else
  fail "E3" "run.json 内容不符：$(cat "$RUN_JSON" 2>/dev/null)"
fi
REG="$DEVENV_STATE_DIR/e2e-runs/success-a1.json"
[[ -f "$REG" && "$(jq -r '.status' "$REG")" == "ok" ]] \
  && pass "E3 运行登记册登记 status=ok" || fail "E3" "登记册不符：$(cat "$REG" 2>/dev/null)"
grep -q "down --remove-orphans -v" "$STATE/calls.log" \
  && grep -q "network disconnect -f $PROJECT-e2e-success-a1-net cid-db" "$STATE/calls.log" \
  && grep -q 'delete-bucket.js e2e-success-a1' "$STATE/calls.log" \
  && grep -q 'bull:e2e-success-a1-evidence-processing:\*' "$STATE/calls.log" \
  && pass "E3 资源回收覆盖容器/网络/库/桶/队列键空间" \
  || fail "E3" "回收命令不全：$(tail -20 "$STATE/calls.log")"

# ---------------------------------------------------------------------------
# E4 探索发现语义：Playwright 非零 → exit 4，产物保留，提示不是事故
# ---------------------------------------------------------------------------
: > "$STATE/calls.log"
MOCK_PLAYWRIGHT_RC=3 run_cmd e4 "$DEVENV" explore --run-id findings-a1
[[ "$RC" == 4 ]] && pass "E4 探索发现 exit 4" || fail "E4" "rc=$RC（期望 4）"
grep -q '按产出处理' "$SANDBOX/e4.err" \
  && pass "E4 明确「失败=产出」处理语义" || fail "E4" "stderr 未标注产出语义：$(tail -5 "$SANDBOX/e4.err")"
grep -q '不要未经判读就改测试栈' "$SANDBOX/e4.err" \
  && pass "E4 不提示用户未经判读误修测试栈" || fail "E4" "stderr 缺少防误修提示：$(tail -5 "$SANDBOX/e4.err")"
[[ -f "$SANDBOX/artifacts/findings-a1/run.json" ]] \
  && pass "E4 失败 run 产物仍导出" || fail "E4" "失败 run 产物缺失"
[[ "$(jq -r '.status' "$DEVENV_STATE_DIR/e2e-runs/findings-a1.json" 2>/dev/null)" == "failed" ]] \
  && pass "E4 登记册记录 failed" || fail "E4" "登记册状态不符"
[[ "$(jq -r '.playwrightExitCode' "$SANDBOX/artifacts/findings-a1/run.json" 2>/dev/null)" == "3" ]] \
  && pass "E4 run.json 保留 Playwright 退出码（失败归因起点）" || fail "E4" "run.json 退出码不符"

# ---------------------------------------------------------------------------
# E5 并发 run 硬上限：启动期预留名额即计入（含尚未起容器的 run），拒绝时零资源
# ---------------------------------------------------------------------------
sleep 30 & CAP_HOLDER=$!
mkdir -p "$DEVENV_LOCK_ROOT/e2e-owner-$MOCK_STACK_SUFFIX-other-a.lock"
printf '%s %s\n' "$CAP_HOLDER" "$(date +%s)" > "$DEVENV_LOCK_ROOT/e2e-owner-$MOCK_STACK_SUFFIX-other-a.lock/owner"
: > "$STATE/calls.log"
run_cmd e5cap env E2E_MAX_CONCURRENT_RUNS=1 "$DEVENV" explore --run-id capped-a1
kill -9 "$CAP_HOLDER" 2>/dev/null; wait "$CAP_HOLDER" 2>/dev/null || true
rm -rf "$DEVENV_LOCK_ROOT/e2e-owner-$MOCK_STACK_SUFFIX-other-a.lock"
[[ "$RC" == 6 ]] && pass "E5 启动期预留计入并发上限，达上限 exit 6" || fail "E5cap" "rc=$RC（期望 6）"
grep -q '并发 e2e run 已达上限' "$SANDBOX/e5cap.err" \
  && pass "E5 上限拒绝说明计数含启动预留与修复线索" || fail "E5cap" "stderr 未说明上限：$(tail -3 "$SANDBOX/e5cap.err")"
if grep -q 'network create' "$STATE/calls.log" || grep -q 'up -d api worker web' "$STATE/calls.log" \
    || grep -q 'DROP DATABASE' "$STATE/calls.log"; then
  fail "E5cap" "上限拒绝后仍创建了 per-run 资源：$(tail -5 "$STATE/calls.log")"
else
  pass "E5 上限拒绝未创建 per-run 网络/服务/数据库"
fi

# ---------------------------------------------------------------------------
# E5b 同 run id 启动窗口：所有权锁被占用时第二个进程 exit 6，绝不清理对方资源
# ---------------------------------------------------------------------------
sleep 30 & SAME_HOLDER=$!
mkdir -p "$DEVENV_LOCK_ROOT/e2e-owner-$MOCK_STACK_SUFFIX-same-a1.lock"
printf '%s %s\n' "$SAME_HOLDER" "$(date +%s)" > "$DEVENV_LOCK_ROOT/e2e-owner-$MOCK_STACK_SUFFIX-same-a1.lock/owner"
: > "$STATE/calls.log"
run_cmd e5same "$DEVENV" explore --run-id same-a1
kill -9 "$SAME_HOLDER" 2>/dev/null; wait "$SAME_HOLDER" 2>/dev/null || true
rm -rf "$DEVENV_LOCK_ROOT/e2e-owner-$MOCK_STACK_SUFFIX-same-a1.lock"
[[ "$RC" == 6 ]] && pass "E5b 同 run id 所有权被占：第二个进程 exit 6" || fail "E5same" "rc=$RC（期望 6）"
if grep -q 'network create' "$STATE/calls.log" || grep -q 'compose .* down' "$STATE/calls.log" \
    || grep -q 'network disconnect' "$STATE/calls.log" || grep -q 'DROP DATABASE' "$STATE/calls.log" \
    || grep -q 'delete-bucket' "$STATE/calls.log" || grep -q 'compose .* up -d' "$STATE/calls.log"; then
  fail "E5same" "第二个进程清理/创建了 run 资源：$(tail -8 "$STATE/calls.log")"
else
  pass "E5b 第二个进程零资源改动（不拆对方网络/库/桶/队列）"
fi

# ---------------------------------------------------------------------------
# E5 命名净化：DB 标识符 / bucket / 队列名规则与超长截断保唯一
# ---------------------------------------------------------------------------
(
  set -Eeuo pipefail
  REPO_ROOT="$MINI"
  source "$REPO_ROOT/devenv/lib/output.sh"
  source "$REPO_ROOT/devenv/lib/e2e.sh"
  long_a="$(printf 'a%.0s' {1..79})b"
  long_b="$(printf 'a%.0s' {1..79})c"
  db_a="$(e2e_db_name "$long_a")"; db_b="$(e2e_db_name "$long_b")"
  bu_a="$(e2e_bucket_name "$long_a")"; bu_b="$(e2e_bucket_name "$long_b")"
  q_a="$(e2e_queue_name "$long_a")"
  printf 'db_a=%s\ndb_b=%s\nbu_a=%s\nbu_b=%s\nq_a=%s\n' "$db_a" "$db_b" "$bu_a" "$bu_b" "$q_a"
) > "$SANDBOX/e5.out" 2> "$SANDBOX/e5.err" || true
DB_A="$(awk -F= '/^db_a=/{print $2}' "$SANDBOX/e5.out")"
DB_B="$(awk -F= '/^db_b=/{print $2}' "$SANDBOX/e5.out")"
BU_A="$(awk -F= '/^bu_a=/{print $2}' "$SANDBOX/e5.out")"
BU_B="$(awk -F= '/^bu_b=/{print $2}' "$SANDBOX/e5.out")"
Q_A="$(awk -F= '/^q_a=/{print $2}' "$SANDBOX/e5.out")"
[[ "$DB_A" =~ ^[A-Za-z0-9_]+$ ]] && (( ${#DB_A} <= 63 )) \
  && pass "E5 DB 标识符规则（[A-Za-z0-9_]，≤63）" || fail "E5" "DB 名非法：$DB_A"
[[ "$DB_A" != "$DB_B" ]] && pass "E5 超长 DB 名截断 + 哈希保唯一" || fail "E5" "长 id 撞名：$DB_A"
[[ "$BU_A" =~ ^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$ ]] \
  && pass "E5 bucket 规则（小写字母数字+连字符，3-63，首尾字母数字）" || fail "E5" "bucket 名非法：$BU_A"
[[ "$BU_A" != "$BU_B" ]] && pass "E5 超长 bucket 截断 + 哈希保唯一" || fail "E5" "长 id 撞名：$BU_A"
[[ "$Q_A" != *:* ]] && [[ "$Q_A" == e2e-*-evidence-processing ]] \
  && pass "E5 队列名禁冒号且带 run 前缀" || fail "E5" "队列名非法：$Q_A"
E5_BAD_RC=0
(
  set -Eeuo pipefail
  REPO_ROOT="$MINI"; WT_SUFFIX="$MOCK_STACK_SUFFIX"; E2E_RUN_ID="abc"
  source "$REPO_ROOT/devenv/lib/output.sh"; source "$REPO_ROOT/devenv/lib/e2e.sh"
  e2e_run_id_validate 'Bad_ID'
) >/dev/null 2>&1 || E5_BAD_RC=$?
[[ "$E5_BAD_RC" == 2 ]] && pass "E5 非法 run id exit 2" || fail "E5" "非法 run id 未拒绝（rc=$E5_BAD_RC）"
(
  set -Eeuo pipefail
  REPO_ROOT="$MINI"; WT_SUFFIX="$MOCK_STACK_SUFFIX"; E2E_RUN_ID="abc"
  source "$REPO_ROOT/devenv/lib/output.sh"; source "$REPO_ROOT/devenv/lib/e2e.sh"
  e2e_owner_lock_name
) > "$SANDBOX/e5-lock-name.out" 2>/dev/null || true
[[ "$(cat "$SANDBOX/e5-lock-name.out")" == "e2e-owner-$MOCK_STACK_SUFFIX-abc" ]] \
  && pass "E5 所有权锁名含 worktree 后缀（跨 worktree 同名 id 不冲突）" \
  || fail "E5" "所有权锁名不符：$(cat "$SANDBOX/e5-lock-name.out")"

# ---------------------------------------------------------------------------
# E6 e2e runs 登记册查询（JSON + 人读）
# ---------------------------------------------------------------------------
set +e
"$DEVENV" --json e2e runs > "$SANDBOX/e6.out" 2> "$SANDBOX/e6.err"
E6_RC=$?
set -e
if [[ "$E6_RC" == 0 ]] && jq -e '.runs | length >= 2' "$SANDBOX/e6.out" >/dev/null 2>&1 \
  && jq -e 'any(.runs[]; .runId == "success-a1" and .status == "ok")' "$SANDBOX/e6.out" >/dev/null 2>&1; then
  pass "E6 e2e runs 输出登记册 JSON（含成功/失败 run）"
else
  fail "E6" "rc=$E6_RC out=$(cat "$SANDBOX/e6.out") err=$(tail -3 "$SANDBOX/e6.err")"
fi

# ---------------------------------------------------------------------------
echo "------------------------------------------------------------"
echo "e2e 隔离编排离线测试完成：${PASS_COUNT} 通过，${FAILURES} 失败"
[[ "$FAILURES" == 0 ]]