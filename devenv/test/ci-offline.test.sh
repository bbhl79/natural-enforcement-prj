#!/usr/bin/env bash
# ============================================================================
# CI 同构质量门离线测试（#71）——不访问真实引擎/GitHub（docker 全部 mock）
#
# 覆盖（Spec-工程基座 §6 质量门与 CI）：
#   1. .github/workflows 静态门禁（doctor ci-workflows 检查项）：直接调用
#      compose（docker compose / docker-compose / podman compose / podman-compose）
#      即拒绝并指明文件+行号；注释行不误报；无 workflow 目录时通过（不阻塞
#      其他使用场景——既有离线测试夹具均无 .github）
#   2. 真实仓库 workflow 通过静态门禁（夹具复制本仓库 .github——自检）
#   3. CI 矩阵条目校验补强：moby + GITHUB_ACTIONS=true + amd64 通过；
#      moby + CI + 非 amd64 架构按 CI 矩阵条目拒绝（exit 3，不特判跳过）
#   4. doctor --json 输出含 ci-workflows 检查项（结构化可机读）
# ============================================================================
set -Eeuo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TEST_DIR/../.." && pwd)"

FAILURES=0
PASS_COUNT=0
pass() { printf 'PASS: %s\n' "$1"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { printf 'FAIL: %s —— %s\n' "$1" "$2"; FAILURES=$((FAILURES + 1)); }

# ---------------------------------------------------------------------------
# 沙箱与 mock docker（同 stack-offline 模式：镜像真实权威输入，mock 引擎）
# ---------------------------------------------------------------------------
setup() {
  SANDBOX=$(mktemp -d /tmp/devenv-ci-offline.XXXXXX)
  OUT="$SANDBOX/out"
  mkdir -p "$SANDBOX/stubbin" "$OUT"
  cp -r "$REPO_ROOT/devenv" "$SANDBOX/devenv"

  # 供应链静态门禁输入（#63）：doctor 从仓库根读取 catalog/allowBuilds/lockfile
  # 一致性。沙箱只镜像 devenv/，必须同时镜像这些权威输入，否则门禁会以
  # 「缺 pnpm-workspace.yaml」失败，掩盖 ci-workflows 用例本身。
  cp "$REPO_ROOT/pnpm-workspace.yaml" "$REPO_ROOT/pnpm-lock.yaml" \
     "$REPO_ROOT/package.json" "$SANDBOX/"
  mkdir -p "$SANDBOX/apps/api" "$SANDBOX/apps/web" "$SANDBOX/apps/e2e" \
           "$SANDBOX/packages/contracts" "$SANDBOX/packages/tsconfig"
  cp "$REPO_ROOT/apps/api/package.json" "$SANDBOX/apps/api/package.json"
  cp "$REPO_ROOT/apps/web/package.json" "$SANDBOX/apps/web/package.json"
  cp "$REPO_ROOT/apps/e2e/package.json" "$SANDBOX/apps/e2e/package.json"
  cp "$REPO_ROOT/packages/contracts/package.json" "$SANDBOX/packages/contracts/package.json"
  cp "$REPO_ROOT/packages/tsconfig/package.json" "$SANDBOX/packages/tsconfig/package.json"

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
  cat > "$SANDBOX/version-moby-arm64.json" <<'EOF'
{"Client":{"Version":"29.1.3"},"Server":{"Version":"28.0.4","Os":"linux","Arch":"arm64","Components":[{"Name":"Engine","Version":"28.0.4"}]}}
EOF

  export PATH="$SANDBOX/stubbin:$PATH"
  DEVENV="$SANDBOX/devenv/devenv"
  # 离线用例自带全部输入：清除调用者继承的文档化环境（CI 上下文会导出
  # GITHUB_ACTIONS 改变矩阵用例——本文件按用例显式注入）。
  unset DEVENV_DOCKER_HOST DOCKER_HOST DEVENV_DB_IMAGE GITHUB_ACTIONS
}

run() { # run <name> <cmd...>；记录 RC 与输出
  local name="$1"; shift
  set +e
  "$@" > "$OUT/$name.out" 2> "$OUT/$name.err"
  RC=$?
  set -e
}

run_doctor() { # run_doctor <name> [env k=v...]（podman mock 基线）
  local name="$1"; shift
  run "$name" env PATH="$PATH" MOCK_DOCKER_VERSION_JSON="$SANDBOX/version-podman.json" \
    DOCKER_HOST="unix:///mock.sock" DEVENV_LOCK_ROOT="$SANDBOX/locks" \
    DEVENV_STATE_DIR="$SANDBOX/.devenv-state" "$@" "$DEVENV" --json doctor
}

run_doctor_plain() { # run_doctor_plain <name> [env k=v...]（人类可读模式——stderr 有检查行）
  local name="$1"; shift
  run "$name" env PATH="$PATH" MOCK_DOCKER_VERSION_JSON="$SANDBOX/version-podman.json" \
    DOCKER_HOST="unix:///mock.sock" DEVENV_LOCK_ROOT="$SANDBOX/locks" \
    DEVENV_STATE_DIR="$SANDBOX/.devenv-state" "$@" "$DEVENV" doctor
}

expect_rc() { [[ "$RC" == "$2" ]] && pass "$1" || fail "$1" "期望退出码 $2，实际 ${RC}（stderr: $(tail -2 "$OUT/$3.err" 2>/dev/null)）"; }

# 夹具 workflow：合法（项目操作全经 ./devenv/devenv）
wf_valid() { # <dir>
  mkdir -p "$1/.github/workflows"
  cat > "$1/.github/workflows/quality-gate.yml" <<'YAML'
name: quality-gate
on: [push]
jobs:
  quality-gate:
    runs-on: ubuntu-24.04
    steps:
      - run: ./devenv/devenv doctor
      - run: ./devenv/devenv verify
      - run: ./devenv/devenv up
      - run: ./devenv/devenv test
YAML
}

# 夹具 workflow：注入一行违规 compose 调用
wf_with_violation() { # <dir> <违规行>
  mkdir -p "$1/.github/workflows"
  cat > "$1/.github/workflows/bad.yml" <<YAML
name: bad
on: [push]
jobs:
  bad:
    runs-on: ubuntu-24.04
    steps:
      - run: $2
YAML
}

setup
trap 'rm -rf "$SANDBOX"' EXIT
echo "沙箱：$SANDBOX"

# ---------------------------------------------------------------------------
# 1. ci-workflows 静态门禁（经真实入口 devenv doctor）
# ---------------------------------------------------------------------------

# CIW1 无 .github 目录 → 通过（不阻塞无 workflow 的使用场景）
run_doctor ciw1
expect_rc "CIW1 无 workflow 目录时 doctor 通过" 0 ciw1
jq -e '.checks[] | select(.check == "ci-workflows" and .result == "ok")' "$OUT/ciw1.out" >/dev/null 2>&1 \
  && pass "CIW1 doctor 报告 ci-workflows ok（无文件可扫）" \
  || fail "CIW1" "JSON 缺 ci-workflows ok：$(cat "$OUT/ciw1.out")"

# CIW2 合法 workflow（项目操作全经 devenv）→ 通过
wf_valid "$SANDBOX"
run_doctor ciw2
expect_rc "CIW2 合法 workflow 通过" 0 ciw2
jq -e '.checks[] | select(.check == "ci-workflows" and .result == "ok")' "$OUT/ciw2.out" >/dev/null 2>&1 \
  && pass "CIW2 ci-workflows ok" || fail "CIW2" "JSON 缺 ci-workflows ok：$(cat "$OUT/ciw2.out")"
jq -r '.checks[] | select(.check == "ci-workflows") | .detail' "$OUT/ciw2.out" | grep -q '1' \
  && pass "CIW2 ok 项报告扫描文件数" || fail "CIW2" "ok 详情未报告扫描数：$(cat "$OUT/ciw2.out")"

# CIW3 docker compose 插件形态违规 → 拒绝（exit 3）并指明文件+行号
wf_with_violation "$SANDBOX" 'docker compose up -d db'
run_doctor ciw3
expect_rc "CIW3 docker compose 直接调用被拒（doctor exit 3）" 3 ciw3
jq -e '.checks[] | select(.check == "ci-workflows" and .result == "fail")' "$OUT/ciw3.out" >/dev/null 2>&1 \
  && pass "CIW3 ci-workflows fail" || fail "CIW3" "JSON 缺 ci-workflows fail：$(cat "$OUT/ciw3.out")"
jq -r '.checks[] | select(.check == "ci-workflows") | .detail' "$OUT/ciw3.out" | grep -q 'bad.yml' \
  && pass "CIW3 报错指明违规文件" || fail "CIW3" "未指明文件：$(cat "$OUT/ciw3.out")"
jq -r '.checks[] | select(.check == "ci-workflows") | .detail' "$OUT/ciw3.out" | grep -q 'docker compose' \
  && pass "CIW3 报错含违规内容" || fail "CIW3" "未含违规行内容"
# 人类可读模式：失败检查行走 stderr，给出「经 devenv 唯一入口」修复指引
run_doctor_plain ciw3b
grep -q '唯一入口' "$OUT/ciw3b.err" \
  && pass "CIW3 stderr 人类行给出修复指引（经 devenv 入口）" || fail "CIW3" "stderr 缺指引：$(cat "$OUT/ciw3b.err")"

# CIW4 docker-compose 独立命令形态违规 → 拒绝
wf_with_violation "$SANDBOX" 'docker-compose -f devenv/compose.yaml up -d'
run_doctor ciw4
expect_rc "CIW4 docker-compose 直接调用被拒" 3 ciw4

# CIW5 podman compose（CI runner 预装 podman 的绕过路径）→ 拒绝
wf_with_violation "$SANDBOX" 'podman compose up -d'
run_doctor ciw5
expect_rc "CIW5 podman compose 直接调用被拒" 3 ciw5

# CIW6 podman-compose → 拒绝
wf_with_violation "$SANDBOX" 'podman-compose build'
run_doctor ciw6
expect_rc "CIW6 podman-compose 直接调用被拒" 3 ciw6

# CIW7 注释行不误报（# docker compose ... 是说明文字，不是调用）
rm -f "$SANDBOX/.github/workflows/bad.yml"
mkdir -p "$SANDBOX/.github/workflows"
cat > "$SANDBOX/.github/workflows/commented.yml" <<'YAML'
name: commented
on: [push]
jobs:
  ok:
    runs-on: ubuntu-24.04
    steps:
      # 禁止直接 docker compose up——必须经 ./devenv/devenv up
      - run: ./devenv/devenv up
YAML
run_doctor ciw7
expect_rc "CIW7 注释中的 compose 字样不误报" 0 ciw7

# CIW8 多处违规：报错含数量（不只报第一处）
rm -f "$SANDBOX/.github/workflows/commented.yml"
cat > "$SANDBOX/.github/workflows/multi.yml" <<'YAML'
name: multi
on: [push]
jobs:
  bad:
    runs-on: ubuntu-24.04
    steps:
      - run: docker compose up -d db
      - run: docker compose ps
      - run: docker-compose logs api
YAML
run_doctor ciw8
expect_rc "CIW8 多处违规仍拒绝" 3 ciw8
jq -r '.checks[] | select(.check == "ci-workflows") | .detail' "$OUT/ciw8.out" | grep -q '3' \
  && pass "CIW8 报错报告违规总数" || fail "CIW8" "未报告总数：$(cat "$OUT/ciw8.out")"

# ---------------------------------------------------------------------------
# 2. 真实仓库 workflow 自检（夹具复制本仓库 .github）
# ---------------------------------------------------------------------------
rm -rf "$SANDBOX/.github"
if [[ -d "$REPO_ROOT/.github/workflows" ]]; then
  cp -r "$REPO_ROOT/.github" "$SANDBOX/.github"
  run_doctor ciw9
  expect_rc "CIW9 真实仓库 workflow 通过静态门禁（自检）" 0 ciw9
  jq -r '.checks[] | select(.check == "ci-workflows") | .detail' "$OUT/ciw9.out" | grep -q "$(ls "$REPO_ROOT/.github/workflows" | wc -l | tr -d ' ')" \
    && pass "CIW9 扫描到全部真实 workflow 文件" || fail "CIW9" "扫描数不符：$(cat "$OUT/ciw9.out")"
else
  fail "CIW9" "本仓库应有 .github/workflows（quality-gate.yml 已随 #71 落库）"
fi

# ---------------------------------------------------------------------------
# 3. CI 矩阵条目校验补强（moby + GITHUB_ACTIONS=true + amd64；arch 不符拒绝）
# ---------------------------------------------------------------------------
rm -rf "$SANDBOX/.github"

# CIW10 moby + CI 上下文 + amd64 → 通过（CI 矩阵条目命中）
run ciw10 env PATH="$PATH" MOCK_DOCKER_VERSION_JSON="$SANDBOX/version-moby.json" \
  DOCKER_HOST="unix:///mock.sock" GITHUB_ACTIONS=true \
  DEVENV_LOCK_ROOT="$SANDBOX/locks" DEVENV_STATE_DIR="$SANDBOX/.devenv-state" \
  "$DEVENV" --json doctor
expect_rc "CIW10 moby + CI + amd64 通过（CI 矩阵条目）" 0 ciw10
jq -e '.checks[] | select(.check == "engine-matrix" and .result == "ok")' "$OUT/ciw10.out" >/dev/null 2>&1 \
  && pass "CIW10 engine-matrix ok（moby CI amd64）" || fail "CIW10" "engine-matrix 不为 ok：$(cat "$OUT/ciw10.out")"

# CIW11 moby + CI 上下文 + arm64 → 拒绝（CI 矩阵条目要求 amd64，不特判跳过）
run ciw11 env PATH="$PATH" MOCK_DOCKER_VERSION_JSON="$SANDBOX/version-moby-arm64.json" \
  DOCKER_HOST="unix:///mock.sock" GITHUB_ACTIONS=true \
  DEVENV_LOCK_ROOT="$SANDBOX/locks" DEVENV_STATE_DIR="$SANDBOX/.devenv-state" \
  "$DEVENV" --json doctor
expect_rc "CIW11 moby + CI + arm64 拒绝 exit 3" 3 ciw11
jq -e '.checks[] | select(.check == "engine-matrix" and .result == "fail")' "$OUT/ciw11.out" >/dev/null 2>&1 \
  && pass "CIW11 engine-matrix fail" || fail "CIW11" "engine-matrix 不为 fail：$(cat "$OUT/ciw11.out")"
jq -r '.checks[] | select(.check == "engine-matrix") | .detail' "$OUT/ciw11.out" | grep -q 'amd64' \
  && pass "CIW11 报错指明 CI 矩阵条目要求 amd64" || fail "CIW11" "未指明 amd64：$(cat "$OUT/ciw11.out")"
# 人类可读模式：stderr 检查行含 amd64 要求（不特判跳过，如实报告实际架构）
run ciw11b env PATH="$PATH" MOCK_DOCKER_VERSION_JSON="$SANDBOX/version-moby-arm64.json" \
  DOCKER_HOST="unix:///mock.sock" GITHUB_ACTIONS=true \
  DEVENV_LOCK_ROOT="$SANDBOX/locks" DEVENV_STATE_DIR="$SANDBOX/.devenv-state" \
  "$DEVENV" doctor
grep -q 'amd64' "$OUT/ciw11b.err" \
  && pass "CIW11 stderr 人类行含 amd64 要求" || fail "CIW11" "stderr 未含 amd64：$(cat "$OUT/ciw11b.err")"

# CIW12 非 CI 上下文 moby（裸 Linux 开发环境）仍拒绝（既有行为不回归）
run ciw12 env PATH="$PATH" MOCK_DOCKER_VERSION_JSON="$SANDBOX/version-moby.json" \
  DOCKER_HOST="unix:///mock.sock" \
  DEVENV_LOCK_ROOT="$SANDBOX/locks" DEVENV_STATE_DIR="$SANDBOX/.devenv-state" \
  "$DEVENV" --json doctor
expect_rc "CIW12 moby 非 CI 仍拒绝（不回归）" 3 ciw12

# ---------------------------------------------------------------------------
echo "------------------------------------------------------------"
echo "CI 同构质量门离线测试完成：$PASS_COUNT 通过，$FAILURES 失败"
[[ "$FAILURES" == 0 ]]
