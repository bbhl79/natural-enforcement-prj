#!/usr/bin/env bash
# ============================================================================
# CI 同构质量门离线测试（#71）——不访问真实引擎/GitHub（docker 全部 mock）
#
# 覆盖（Spec-工程基座 §6 质量门与 CI）：
#   1. .github/workflows 静态门禁（doctor ci-workflows 检查项）：直接调用
#      compose（docker compose / docker-compose / podman compose / podman-compose，
#      含路径限定形 /usr/bin/docker compose）即拒绝并指明文件+行号；注释行不
#      误报；无 workflow 目录时通过（不阻塞其他使用场景——既有离线测试夹具
#      均无 .github）
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
  version) cat "${MOCK_DOCKER_VERSION_JSON:?}";;
  compose) [[ "${2:-}" == "version" ]] && { echo "2.40.3"; exit 0; }; exit 0;;
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

# run_doctor <name> [env k=v...]：podman mock 基线 + 按用例覆盖（env 后置
# 覆盖先置默认——CI 上下文/引擎版本 JSON/架构按需注入）
run_doctor() {
  local name="$1"; shift
  run "$name" env PATH="$PATH" MOCK_DOCKER_VERSION_JSON="$SANDBOX/version-podman.json" \
    DOCKER_HOST="unix:///mock.sock" DEVENV_LOCK_ROOT="$SANDBOX/locks" \
    DEVENV_STATE_DIR="$SANDBOX/.devenv-state" "$@" "$DEVENV" --json doctor
}

run_doctor_plain() { # 人类可读模式——stderr 有检查行（含覆盖注入，同 run_doctor）
  local name="$1"; shift
  run "$name" env PATH="$PATH" MOCK_DOCKER_VERSION_JSON="$SANDBOX/version-podman.json" \
    DOCKER_HOST="unix:///mock.sock" DEVENV_LOCK_ROOT="$SANDBOX/locks" \
    DEVENV_STATE_DIR="$SANDBOX/.devenv-state" "$@" "$DEVENV" doctor
}

expect_rc() { [[ "$RC" == "$2" ]] && pass "$1" || fail "$1" "期望退出码 $2，实际 ${RC}（stderr: $(tail -2 "$OUT/$3.err" 2>/dev/null)）"; }

# doctor --json 的 stdout = JSONL 事件流 + 终值 JSON；先取终值再断言，避免事件行
# 触发 jq「Cannot iterate over null」噪音掩盖真实回归
doctor_final() { # doctor_final <用例名> → 终值 JSON（stdout）
  jq -s "[.[] | select(.command == \"doctor\")][0]" "$OUT/$1.out"
}
has_check() { # has_check <用例名> <check 名> <result> → 匹配非空 exit 0
  doctor_final "$1" | jq -e --arg c "$2" --arg r "$3" \
    '.checks[] | select(.check == $c and .result == $r)' >/dev/null
}
check_detail() { # check_detail <用例名> <check 名> → detail 文本（stdout）
  doctor_final "$1" | jq -r --arg c "$2" '[.checks[] | select(.check == $c) | .detail][0]'
}

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
has_check ciw1 ci-workflows ok \
  && pass "CIW1 doctor 报告 ci-workflows ok（无文件可扫）" \
  || fail "CIW1" "JSON 缺 ci-workflows ok：$(cat "$OUT/ciw1.out")"

# CIW2 合法 workflow（项目操作全经 devenv）→ 通过
wf_valid "$SANDBOX"
run_doctor ciw2
expect_rc "CIW2 合法 workflow 通过" 0 ciw2
has_check ciw2 ci-workflows ok \
  && pass "CIW2 ci-workflows ok" || fail "CIW2" "JSON 缺 ci-workflows ok：$(cat "$OUT/ciw2.out")"
check_detail ciw2 ci-workflows | grep -q '^1 个 workflow' \
  && pass "CIW2 ok 项报告扫描文件数" || fail "CIW2" "ok 详情未报告扫描数：$(check_detail ciw2 ci-workflows)"

# CIW3 docker compose 插件形态违规 → 拒绝（exit 3）并指明文件+行号
wf_with_violation "$SANDBOX" 'docker compose up -d db'
run_doctor ciw3
expect_rc "CIW3 docker compose 直接调用被拒（doctor exit 3）" 3 ciw3
has_check ciw3 ci-workflows fail \
  && pass "CIW3 ci-workflows fail" || fail "CIW3" "JSON 缺 ci-workflows fail：$(cat "$OUT/ciw3.out")"
check_detail ciw3 ci-workflows | grep -q 'bad.yml:7:' \
  && pass "CIW3 报错指明违规文件与行号（bad.yml:7）" || fail "CIW3" "未指明文件:行号：$(check_detail ciw3 ci-workflows)"
check_detail ciw3 ci-workflows | grep -q 'docker compose' \
  && pass "CIW3 报错含违规内容" || fail "CIW3" "未含违规行内容：$(check_detail ciw3 ci-workflows)"
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

# CIW6b 路径限定形（/usr/bin/docker compose）同样违规——边界字符集含 /
wf_with_violation "$SANDBOX" '/usr/bin/docker compose up -d db'
run_doctor ciw6b
expect_rc "CIW6b 路径限定形 docker compose 被拒" 3 ciw6b
wf_with_violation "$SANDBOX" '/usr/local/bin/docker-compose ps'
run_doctor ciw6c
expect_rc "CIW6c 路径限定形 docker-compose 被拒" 3 ciw6c

# CIW6d/e 全局选项不遮蔽判定（#71 评审整改）：docker -H/--context、podman --remote
# 与 compose 之间隔任意全局选项/参数同样违规
wf_with_violation "$SANDBOX" 'docker -H unix:///var/run/docker.sock compose up -d'
run_doctor ciw6d
expect_rc "CIW6d 带全局选项的 docker compose 被拒" 3 ciw6d
wf_with_violation "$SANDBOX" 'podman --remote compose ps'
run_doctor ciw6e
expect_rc "CIW6e podman --remote compose 被拒" 3 ciw6e

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
check_detail ciw8 ci-workflows | grep -q '^3 处直接 compose 调用' \
  && pass "CIW8 报错报告违规总数" || fail "CIW8" "未报告总数：$(check_detail ciw8 ci-workflows)"

# ---------------------------------------------------------------------------
# 2. 真实仓库 workflow 自检（夹具复制本仓库 .github）
# ---------------------------------------------------------------------------
rm -rf "$SANDBOX/.github"
if [[ -d "$REPO_ROOT/.github/workflows" ]]; then
  cp -r "$REPO_ROOT/.github" "$SANDBOX/.github"
  run_doctor ciw9
  expect_rc "CIW9 真实仓库 workflow 通过静态门禁（自检）" 0 ciw9
  real_wf_count="$(find "$REPO_ROOT/.github/workflows" -maxdepth 1 -type f \( -name '*.yml' -o -name '*.yaml' \) | wc -l | tr -d ' ')"
  check_detail ciw9 ci-workflows | grep -q "^${real_wf_count} 个 workflow" \
    && pass "CIW9 扫描到全部真实 workflow 文件（find 同口径计数）" || fail "CIW9" "扫描数不符：$(check_detail ciw9 ci-workflows)"
else
  fail "CIW9" "本仓库应有 .github/workflows（quality-gate.yml 已随 #71 落库）"
fi

# ---------------------------------------------------------------------------
# 3. CI 矩阵条目校验补强（moby + GITHUB_ACTIONS=true + amd64；arch 不符拒绝）
# ---------------------------------------------------------------------------
rm -rf "$SANDBOX/.github"

# CIW10 moby + CI 上下文 + amd64 → 通过（CI 矩阵条目命中）
run_doctor ciw10 GITHUB_ACTIONS=true MOCK_DOCKER_VERSION_JSON="$SANDBOX/version-moby.json"
expect_rc "CIW10 moby + CI + amd64 通过（CI 矩阵条目）" 0 ciw10
has_check ciw10 engine-matrix ok \
  && pass "CIW10 engine-matrix ok（moby CI amd64）" || fail "CIW10" "engine-matrix 不为 ok：$(cat "$OUT/ciw10.out")"

# CIW11 moby + CI 上下文 + arm64 → 拒绝（CI 矩阵条目要求 amd64，不特判跳过）
run_doctor ciw11 GITHUB_ACTIONS=true MOCK_DOCKER_VERSION_JSON="$SANDBOX/version-moby-arm64.json"
expect_rc "CIW11 moby + CI + arm64 拒绝 exit 3" 3 ciw11
has_check ciw11 engine-matrix fail \
  && pass "CIW11 engine-matrix fail" || fail "CIW11" "engine-matrix 不为 fail：$(cat "$OUT/ciw11.out")"
check_detail ciw11 engine-matrix | grep -q 'amd64' \
  && pass "CIW11 报错指明 CI 矩阵条目要求 amd64" || fail "CIW11" "未指明 amd64：$(check_detail ciw11 engine-matrix)"
# 人类可读模式：stderr 检查行含 amd64 要求（不特判跳过，如实报告实际架构）
run_doctor_plain ciw11b GITHUB_ACTIONS=true MOCK_DOCKER_VERSION_JSON="$SANDBOX/version-moby-arm64.json"
grep -q 'amd64' "$OUT/ciw11b.err" \
  && pass "CIW11 stderr 人类行含 amd64 要求" || fail "CIW11" "stderr 未含 amd64：$(cat "$OUT/ciw11b.err")"

# CIW12 非 CI 上下文 moby（裸 Linux 开发环境）仍拒绝（既有行为不回归）
run_doctor ciw12 MOCK_DOCKER_VERSION_JSON="$SANDBOX/version-moby.json"
expect_rc "CIW12 moby 非 CI 仍拒绝（不回归）" 3 ciw12

# ---------------------------------------------------------------------------
echo "------------------------------------------------------------"
echo "CI 同构质量门离线测试完成：$PASS_COUNT 通过，$FAILURES 失败"
[[ "$FAILURES" == 0 ]]
