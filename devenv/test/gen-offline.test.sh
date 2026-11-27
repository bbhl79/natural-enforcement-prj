#!/usr/bin/env bash
# ============================================================================
# 脚手架生成离线测试（#64）——不访问真实引擎（docker 全部 mock）
#
# 覆盖（Spec-工程基座 §5 脚手架；命令面唯一验收面）：
#   1. 来源可核：报告宿主来源路径 + 生成器子树哈希 + 整集内容哈希；容器侧重算
#      集哈希与宿主一致（传输完整性）。
#   2. 文件通道隔离：--json stdout 只有 JSON/JSONL，生成物 tar 不混入结果流。
#   3. 全有或全无：目标已存在/补丁已注入 → exit 4 且无部分写入；lockgen 失败 →
#      回滚新包、Dockerfile 与 lockfile。
#   4. 联动：workspace.Dockerfile 两靶各追加一行 COPY；lockfile 只接受新增
#      importer 的预期 diff，其它差异 exit 4 并保留现场供审查。
#   5. 锁关系：gen 持 per-worktree gen-<wt> 源码锁（冲突 exit 6）；build 取得
#      同一把锁（gen 与 build 互斥）。
#   6. 无烘焙副本：.dockerignore 排除 devenv/gen（容器入口另有运行时断言）。
# ============================================================================
set -Eeuo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TEST_DIR/../.." && pwd)"

FAILURES=0
PASS_COUNT=0
pass() { printf 'PASS: %s\n' "$1"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { printf 'FAIL: %s —— %s\n' "$1" "$2"; FAILURES=$((FAILURES + 1)); }

SANDBOX=""
MOCKBIN=""
OUT=""
RC=0

cleanup() { rm -rf "$SANDBOX" "$SANDBOX-out" "$SANDBOX-mockbin" 2>/dev/null || true; }
trap cleanup EXIT

# ---------------------------------------------------------------------------
# 夹具：最小仓库（合法 catalog/锁文件/镜像锁 + 真实 devenv 与生成器）
# ---------------------------------------------------------------------------
setup() {
  SANDBOX=$(mktemp -d /tmp/devenv-gen-offline.XXXXXX)
  MOCKBIN="$SANDBOX-mockbin"
  OUT="$SANDBOX-out"
  mkdir -p "$OUT" "$MOCKBIN"
  cp -r "$REPO_ROOT/devenv" "$SANDBOX/devenv"
  cp "$REPO_ROOT/.gitignore" "$SANDBOX/.gitignore"
  cp "$REPO_ROOT/.dockerignore" "$SANDBOX/.dockerignore"
  mkdir -p "$SANDBOX/apps/api" "$SANDBOX/apps/web" \
           "$SANDBOX/packages/contracts" "$SANDBOX/packages/tsconfig"
  cp "$REPO_ROOT/packages/tsconfig/package.json" "$SANDBOX/packages/tsconfig/package.json"

  cat > "$SANDBOX/pnpm-workspace.yaml" <<'YAML'
packages:
  - apps/*
  - packages/*

minimumReleaseAge: 1440
minimumReleaseAgeStrict: true
minimumReleaseAgeIgnoreMissingTime: false

allowBuilds:
  prisma@7.10.1: true

catalog:
  "@types/node": "26.6.6"
  typescript: "6.0.3"
  vitest: "5.1.1"
YAML
  cat > "$SANDBOX/package.json" <<'JSON'
{
  "name": "fixture",
  "private": true,
  "packageManager": "pnpm@12.21.0",
  "devDependencies": { "typescript": "catalog:" }
}
JSON
  cat > "$SANDBOX/apps/api/package.json" <<'JSON'
{"name": "@fix/api", "private": true, "dependencies": {"@ne/contracts": "workspace:*"}}
JSON
  cat > "$SANDBOX/apps/web/package.json" <<'JSON'
{"name": "@fix/web", "private": true, "dependencies": {"@ne/contracts": "workspace:*"}}
JSON
  cat > "$SANDBOX/packages/contracts/package.json" <<'JSON'
{"name": "@ne/contracts", "private": true}
JSON
  cat > "$SANDBOX/pnpm-lock.yaml" <<'YAML'
lockfileVersion: '9.0'

catalogs:
  default:
    '@types/node':
      specifier: 26.6.6
      version: 26.6.6
    typescript:
      specifier: 6.0.3
      version: 6.0.3
    vitest:
      specifier: 5.1.1
      version: 5.1.1

importers:

  .:
    devDependencies:
      typescript:
        specifier: 'catalog:'
        version: 6.0.3

  apps/api:
    dependencies:
      '@ne/contracts':
        specifier: workspace:*
        version: link:../../packages/contracts

  apps/web:
    dependencies:
      '@ne/contracts':
        specifier: workspace:*
        version: link:../../packages/contracts

  packages/contracts: {}

  packages/tsconfig: {}
YAML
  cp "$REPO_ROOT/devenv/images.lock" "$SANDBOX/devenv/images.lock"

  git init -q "$SANDBOX"
  git -C "$SANDBOX" -c user.email=fixture@example.invalid -c user.name=fixture \
    add -A >/dev/null
  git -C "$SANDBOX" -c user.email=fixture@example.invalid -c user.name=fixture \
    commit -qm "fixture baseline"

  cp "$SANDBOX/pnpm-lock.yaml" "$OUT/base-lock.yaml"
  cp "$SANDBOX/devenv/workspace.Dockerfile" "$OUT/base-dockerfile"

  write_mocks
  chmod +x "$MOCKBIN"/*
  export PATH="$MOCKBIN:$PATH"
  export DEVENV_DOCKER_HOST="unix:///mock.sock"
  export DEVENV_LOCK_ROOT="$SANDBOX-out/locks"
  export DEVENV_WORKTREE_ID="fixture-wt"
  export DEVENV_LOCK_TIMEOUT=""
  export MOCK_NEW_LOCKFILE="$OUT/new-lock.yaml"
  export MOCK_GEN="$MOCKBIN/mock-gen.sh"
  unset DEVENV_DB_IMAGE GITHUB_ACTIONS MOCK_LOCKGEN_FAIL MOCK_TAMPER_SET \
        MOCK_OUTPUT_TRAVERSAL 2>/dev/null || true
  DEVENV="$SANDBOX/devenv/devenv"
}

reset_repo() {
  git -C "$SANDBOX" checkout -q -- .
  git -C "$SANDBOX" clean -fdq
  rm -rf "$SANDBOX/.devenv-state" "$DEVENV_LOCK_ROOT"
  rm -f "$MOCK_NEW_LOCKFILE"
  unset MOCK_LOCKGEN_FAIL MOCK_TAMPER_SET MOCK_OUTPUT_TRAVERSAL MOCK_OUTPUT_CROSS_DIR MOCK_EVIDENCE 2>/dev/null || true
  export DEVENV_LOCK_TIMEOUT=""
}

# ---------------------------------------------------------------------------
# mock docker / 生成器容器 / lockgen
# ---------------------------------------------------------------------------
write_mocks() {
  cat > "$MOCKBIN/docker" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
sub="${1:-}"
case "$sub" in
  version)
    [[ "${MOCK_DOCKER_DOWN:-}" == "1" ]] && exit 1
    printf '%s\n' '{"Client":{"Version":"29.1.3"},"Server":{"Version":"6.1.4","Os":"linux","Arch":"amd64","Components":[{"Name":"Podman Engine","Version":"6.1.4"}]}}'
    ;;
  compose) exit 0 ;;
  image)  exit 1 ;;       # 未构建：确保走 docker build 路径
  tag)    exit 0 ;;
  build)
    tag=""; target=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        -t) tag="${2:-}"; shift 2 ;;
        --target) target="${2:-}"; shift 2 ;;
        *) shift ;;
      esac
    done
    if [[ "$tag" == "ne-lockgen:tmp" && "${MOCK_LOCKGEN_FAIL:-}" == "1" ]]; then
      echo "mock: lockgen build failed" >&2
      exit 1
    fi
    printf 'sha256:%064d\n' 1
    ;;
  create) printf 'fakecid\n' ;;
  cp)
    dest="${!#}"
    [[ -n "${MOCK_NEW_LOCKFILE:-}" && -f "${MOCK_NEW_LOCKFILE:-}" ]] || { echo "mock: no new lockfile" >&2; exit 1; }
    cp "$MOCK_NEW_LOCKFILE" "$dest"
    ;;
  run)
    shift
    if [[ "$*" == *pnpm-install.json* ]]; then
      [[ -n "${MOCK_EVIDENCE:-}" ]] || { echo "mock: no evidence file" >&2; exit 1; }
      printf '%s\n' "$MOCK_EVIDENCE"
      exit 0
    fi
    while [[ $# -gt 0 ]]; do
      case "$1" in
        -e) export "${2:?}"; shift 2 ;;
        *) shift ;;
      esac
    done
    exec "${MOCK_GEN:?}"
    ;;
  ps|rm|rmi|inspect|info) exit 0 ;;
  *) exit 0 ;;
esac
EOF

  cat > "$MOCKBIN/mock-gen.sh" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
work="$(mktemp -d "${TMPDIR:-/tmp}/mock-gen.XXXXXX")"
trap 'rm -rf "$work"' EXIT
tar -xf - -C "$work"
cd "$work"

[[ "${MOCK_TAMPER_SET:-}" == "1" ]] && { echo "mock: tampered set" >&2; exit 4; }
actual="$(find devenv/gen -type f -print | LC_ALL=C sort | while IFS= read -r f; do
  printf '%s  %s\n' "$(sha256sum "$f" | awk '{print $1}')" "$f"
done | sha256sum | awk '{print $1}')"
[[ "$actual" == "${NE_GEN_SET_SHA256:?}" ]] \
  || { echo "mock: set hash mismatch expected=$NE_GEN_SET_SHA256 actual=$actual" >&2; exit 4; }

kind="${NE_GEN_KIND:?}"; name="${NE_GEN_NAME:?}"
out="$work/out"
case "$kind" in
  package)
    target_root="packages"
    mkdir -p "$out/packages/$name/src" "$out/devenv"
    cat > "$out/packages/$name/package.json" <<JSON
{
  "name": "@ne/$name",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:unit": "vitest run src"
  },
  "devDependencies": {
    "@ne/tsconfig": "workspace:*",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
JSON
    printf 'export const generated = 1\n' > "$out/packages/$name/src/index.ts"
    printf 'export const spec = 2\n' > "$out/packages/$name/src/index.spec.ts"
    ;;
  app)
    target_root="apps"
    mkdir -p "$out/apps/$name/src" "$out/devenv"
    cat > "$out/apps/$name/package.json" <<JSON
{
  "name": "@ne/$name",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "start": "node dist/main.js",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:unit": "vitest run src"
  },
  "devDependencies": {
    "@ne/tsconfig": "workspace:*",
    "@types/node": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
JSON
    printf 'export function hello(t: string): string { return t }\n' > "$out/apps/$name/src/hello.ts"
    printf 'import { hello } from "./hello.js"\nconsole.log(hello("app"))\n' > "$out/apps/$name/src/main.ts"
    printf 'export const spec = 2\n' > "$out/apps/$name/src/hello.spec.ts"
    ;;
  *)
    echo "mock: unsupported kind $kind" >&2; exit 2
    ;;
esac
awk -v line="COPY $target_root/$name/package.json $target_root/$name/package.json" \
  '{ print; if ($0 ~ /^# @gen:pkg-copy/) print line }' \
  devenv/workspace.Dockerfile > "$out/devenv/workspace.Dockerfile"

manifest="$out/.ne-gen-manifest.json"
sep=""
{
  printf '{"kind":"%s","name":"%s","manifestVersion":1,"files":[' "$kind" "$name"
  while IFS= read -r f; do
    h="$(sha256sum "$out/$f" | awk '{print $1}')"
    printf '%s{"path":"%s","sha256":"%s","mode":"644"}' "$sep" "$f" "$h"
    sep=","
  done < <(cd "$out" && find "$target_root" -type f | LC_ALL=C sort)
  printf '],"patches":[{"path":"devenv/workspace.Dockerfile","baseSha256":"%s","sha256":"%s"}]}\n' \
    "$(sha256sum devenv/workspace.Dockerfile | awk '{print $1}')" \
    "$(sha256sum "$out/devenv/workspace.Dockerfile" | awk '{print $1}')"
} > "$manifest"

if [[ "${MOCK_OUTPUT_TRAVERSAL:-}" == "1" ]]; then
  # 清单声明的路径越界（实际文件在包外；宿主必须在落盘前拒绝）
  jq '.files[0].path = "../evil"' "$manifest" > "$manifest.tmp" && mv "$manifest.tmp" "$manifest"
fi
if [[ "${MOCK_OUTPUT_CROSS_DIR:-}" == "1" ]]; then
  # app 生成器越界写到 packages/<name>/（宿主必须按 kind 路径范围拒绝）
  mkdir -p "$out/packages/$name"
  printf 'x\n' > "$out/packages/$name/rogue.txt"
  h="$(sha256sum "$out/packages/$name/rogue.txt" | awk '{print $1}')"
  jq --arg p "packages/$name/rogue.txt" --arg h "$h" \
    '.files += [{"path":$p,"sha256":$h,"mode":"644"}]' "$manifest" > "$manifest.tmp" && mv "$manifest.tmp" "$manifest"
fi
tar -cf - -C "$out" .
EOF
}

# 新增 importer 的预期锁文件（与 mock 生成物 manifest 一致）
make_new_lockfile() { # <name> <out>
  cp "$OUT/base-lock.yaml" "$2"
  cat >> "$2" <<YAML

  packages/$1:
    devDependencies:
      '@ne/tsconfig':
        specifier: workspace:*
        version: link:../tsconfig
      typescript:
        specifier: 'catalog:'
        version: 6.0.3
      vitest:
        specifier: 'catalog:'
        version: 5.1.1
YAML
}

make_new_app_lockfile() { # <name> <out>
  cp "$OUT/base-lock.yaml" "$2"
  cat >> "$2" <<YAML

  apps/$1:
    devDependencies:
      '@ne/tsconfig':
        specifier: workspace:*
        version: link:../../packages/tsconfig
      '@types/node':
        specifier: 'catalog:'
        version: 26.6.6
      typescript:
        specifier: 'catalog:'
        version: 6.0.3
      vitest:
        specifier: 'catalog:'
        version: 5.1.1
YAML
}

run() { # run <name> <cmd...>
  local label="$1"; shift
  set +e
  "$@" > "$OUT/$label.out" 2> "$OUT/$label.err"
  RC=$?
  set -e
}
expect_rc() { [[ "$RC" == "$2" ]] && pass "$1" || fail "$1" "期望退出码 $2，实际 ${RC}（stderr: $(tail -2 "$OUT/$3.err" 2>/dev/null)）"; }
expect_grep() { grep -q -- "$2" "$OUT/$3.err" && pass "$1" || fail "$1" "stderr 未包含：$2（$(tail -3 "$OUT/$3.err" 2>/dev/null)）"; }
expect_no_grep() { grep -q -- "$2" "$OUT/$3.err" && fail "$1" "stderr 不应包含：$2" || pass "$1"; }

gen_json() { "$DEVENV" --json "$@"; }

setup
echo "沙箱：$SANDBOX"

# ---------------------------------------------------------------------------
# T1 无烘焙副本（静态）：.dockerignore 显式排除 devenv/gen
# ---------------------------------------------------------------------------
if grep -qxF 'devenv/gen' "$REPO_ROOT/.dockerignore"; then
  pass "T1 .dockerignore 排除 devenv/gen（镜像内无可静默 fallback 的副本）"
else
  fail "T1" ".dockerignore 缺 devenv/gen"
fi

# ---------------------------------------------------------------------------
# T2 成功闭环：来源/集哈希可核；Dockerfile 两靶补丁；预期 lockfile diff；
#    stdout 只含 JSON（tar 不混入结果流）
# ---------------------------------------------------------------------------
make_new_lockfile alpha-pkg "$MOCK_NEW_LOCKFILE"
run t2 gen_json gen package alpha-pkg
expect_rc "T2 gen package 成功" 0 t2
if jq -e . "$OUT/t2.out" >/dev/null 2>&1; then
  pass "T2 stdout 全为可解析 JSON（tar 未混入结果流）"
else
  fail "T2" "stdout 非纯 JSON：$(head -2 "$OUT/t2.out")"
fi
if jq -e 'select(.event == "gen.source") | .path | endswith("/devenv/gen")' "$OUT/t2.out" >/dev/null 2>&1; then
  pass "T2 报告宿主来源路径"
else
  fail "T2" "缺 gen.source 或 path 不符"
fi
if jq -e 'select(.event == "gen.source") | (.treeHash | test("^[0-9a-f]{40}$")) and (.setHash | test("^[0-9a-f]{64}$")) and (.files | tonumber > 0)' "$OUT/t2.out" >/dev/null 2>&1; then
  pass "T2 报告生成器子树哈希 + 整集哈希 + 文件数"
else
  fail "T2" "gen.source 字段不符：$(grep gen.source "$OUT/t2.out" | head -1)"
fi
if jq -e 'select(.command == "gen") | .status == "ok" and .lockfileDiff == "expected" and .importer == "packages/alpha-pkg" and .lockgen == "ok"' "$OUT/t2.out" >/dev/null 2>&1; then
  pass "T2 终值含 kind/name/importer/lockgen=ok/lockfileDiff=expected"
else
  fail "T2" "终值不符：$(tail -1 "$OUT/t2.out")"
fi
[[ -f "$SANDBOX/packages/alpha-pkg/package.json" ]] && pass "T2 新包已落盘" || fail "T2" "新包缺失"
[[ "$(grep -cF 'COPY packages/alpha-pkg/package.json packages/alpha-pkg/package.json' "$SANDBOX/devenv/workspace.Dockerfile")" == "2" ]] \
  && pass "T2 workspace.Dockerfile 两靶各追加一行 COPY" || fail "T2" "COPY 行数不是 2"
grep -q '^  packages/alpha-pkg:' "$SANDBOX/pnpm-lock.yaml" \
  && pass "T2 lockfile 新增 importer" || fail "T2" "lockfile 缺 importer"
cmp -s "$OUT/base-dockerfile" "$SANDBOX/devenv/workspace.Dockerfile" \
  && fail "T2 Dockerfile 已补丁" "Dockerfile 未变" || pass "T2 Dockerfile 已补丁"

# ---------------------------------------------------------------------------
# T3 幂等：重复执行拒绝且无部分写入
# ---------------------------------------------------------------------------
before_pkg="$(find "$SANDBOX/packages/alpha-pkg" -type f | LC_ALL=C sort | while IFS= read -r f; do sha256sum "$f"; done | sha256sum | awk '{print $1}')"
before_df="$(sha256sum "$SANDBOX/devenv/workspace.Dockerfile" | awk '{print $1}')"
before_lock="$(sha256sum "$SANDBOX/pnpm-lock.yaml" | awk '{print $1}')"
run t3 gen_json gen package alpha-pkg
expect_rc "T3 重复生成拒绝 exit 4" 4 t3
expect_grep "T3 报告目标已存在" "目标已存在" t3
after_pkg="$(find "$SANDBOX/packages/alpha-pkg" -type f | LC_ALL=C sort | while IFS= read -r f; do sha256sum "$f"; done | sha256sum | awk '{print $1}')"
[[ "$before_pkg" == "$after_pkg" ]] && pass "T3 新包内容未变（无部分写入）" || fail "T3" "新包内容被改动"
[[ "$before_df" == "$(sha256sum "$SANDBOX/devenv/workspace.Dockerfile" | awk '{print $1}')" ]] \
  && pass "T3 Dockerfile 未变" || fail "T3" "Dockerfile 被改动"
[[ "$before_lock" == "$(sha256sum "$SANDBOX/pnpm-lock.yaml" | awk '{print $1}')" ]] \
  && pass "T3 lockfile 未变" || fail "T3" "lockfile 被改动"

# ---------------------------------------------------------------------------
# T4 补丁已注入：目标目录不存在但 COPY 行已在 → 拒绝，无部分写入
# ---------------------------------------------------------------------------
reset_repo
printf 'COPY packages/beta-pkg/package.json packages/beta-pkg/package.json\n' \
  >> "$SANDBOX/devenv/workspace.Dockerfile"
run t4 gen_json gen package beta-pkg
expect_rc "T4 补丁已注入拒绝 exit 4" 4 t4
expect_grep "T4 报告补丁已注入" "已注入过" t4
[[ ! -e "$SANDBOX/packages/beta-pkg" ]] && pass "T4 未创建目标目录" || fail "T4" "目标目录被创建"

# ---------------------------------------------------------------------------
# T5 非预期 lockfile diff：停止并要求审查，保留现场
# ---------------------------------------------------------------------------
reset_repo
make_new_lockfile gamma-pkg "$MOCK_NEW_LOCKFILE"
sed -i.bak 's/version: 6.0.3/version: 6.0.2/' "$MOCK_NEW_LOCKFILE" && rm -f "$MOCK_NEW_LOCKFILE.bak"
run t5 gen_json gen package gamma-pkg
expect_rc "T5 非预期 lockfile diff exit 4" 4 t5
expect_grep "T5 报告非预期 diff 并要求审查" "非预期 lockfile diff" t5
[[ -d "$SANDBOX/packages/gamma-pkg" ]] && pass "T5 生成物保留供审查" || fail "T5" "生成物被回滚（应保留现场）"
grep -q 'version: 6.0.2' "$SANDBOX/pnpm-lock.yaml" \
  && pass "T5 新 lockfile 保留供审查" || fail "T5" "新 lockfile 未保留"

# ---------------------------------------------------------------------------
# T6 lockgen 失败：回滚新包 + Dockerfile + lockfile（全有或全无）
# ---------------------------------------------------------------------------
reset_repo
make_new_lockfile delta-pkg "$MOCK_NEW_LOCKFILE"
export MOCK_LOCKGEN_FAIL=1
run t6 gen_json gen package delta-pkg
expect_rc "T6 lockgen 失败 exit 4" 4 t6
[[ ! -e "$SANDBOX/packages/delta-pkg" ]] && pass "T6 新包已回滚" || fail "T6" "新包残留"
cmp -s "$OUT/base-dockerfile" "$SANDBOX/devenv/workspace.Dockerfile" \
  && pass "T6 Dockerfile 已回滚" || fail "T6" "Dockerfile 未回滚"
cmp -s "$OUT/base-lock.yaml" "$SANDBOX/pnpm-lock.yaml" \
  && pass "T6 lockfile 已回滚" || fail "T6" "lockfile 未回滚"

# ---------------------------------------------------------------------------
# T7 传输完整性：容器侧集哈希不符 → 拒绝，无写入
# ---------------------------------------------------------------------------
reset_repo
export MOCK_TAMPER_SET=1
run t7 gen_json gen package epsilon-pkg
expect_rc "T7 集哈希不符 exit 4" 4 t7
expect_grep "T7 报告传输/集哈希失败" "生成器执行失败" t7
[[ ! -e "$SANDBOX/packages/epsilon-pkg" ]] && pass "T7 未写入任何文件" || fail "T7" "出现目标目录"

# ---------------------------------------------------------------------------
# T8 路径越界：清单路径 ../evil → 落盘前拒绝
# ---------------------------------------------------------------------------
reset_repo
make_new_lockfile zeta-pkg "$MOCK_NEW_LOCKFILE"
export MOCK_OUTPUT_TRAVERSAL=1
run t8 gen_json gen package zeta-pkg
expect_rc "T8 路径越界 exit 4" 4 t8
expect_grep "T8 报告非法路径" "非法路径" t8
[[ ! -e "$SANDBOX/packages/zeta-pkg" ]] && pass "T8 未写入任何文件" || fail "T8" "出现目标目录"

# ---------------------------------------------------------------------------
# T9 源码锁：gen 冲突 exit 6（per-worktree gen-<wt>）
# ---------------------------------------------------------------------------
reset_repo
suffix="$(printf '%s' "$DEVENV_WORKTREE_ID" | sha256sum | awk '{print $1}' | cut -c1-8)"
mkdir -p "$DEVENV_LOCK_ROOT/gen-$suffix.lock"
printf '%s %s\n' "$$" "$(date +%s)" > "$DEVENV_LOCK_ROOT/gen-$suffix.lock/owner"
export DEVENV_LOCK_TIMEOUT=1
run t9 gen_json gen package eta-pkg
expect_rc "T9 gen 源码锁冲突 exit 6" 6 t9
expect_grep "T9 报告锁持有者" "独占锁 \[gen-" t9
rm -rf "$DEVENV_LOCK_ROOT/gen-$suffix.lock"

# ---------------------------------------------------------------------------
# T10 gen/build 互斥：build 也取得同一把源码锁
# ---------------------------------------------------------------------------
mkdir -p "$DEVENV_LOCK_ROOT/gen-$suffix.lock"
printf '%s %s\n' "$$" "$(date +%s)" > "$DEVENV_LOCK_ROOT/gen-$suffix.lock/owner"
export DEVENV_LOCK_TIMEOUT=1
run t10 gen_json build
expect_rc "T10 gen 持锁时 build exit 6（互斥）" 6 t10
expect_grep "T10 build 报告源码锁冲突" "独占锁 \[gen-" t10
rm -rf "$DEVENV_LOCK_ROOT/gen-$suffix.lock"

# ---------------------------------------------------------------------------
# T11 下载证据：无绑定 → exit 4；完整证据 → 0；流不完整/文件缺失 → exit 4
# ---------------------------------------------------------------------------
reset_repo
unset MOCK_EVIDENCE 2>/dev/null || true
run t11 gen_json gen evidence
expect_rc "T11 无 workspace 绑定 → exit 4（无法验收）" 4 t11
expect_grep "T11 报告无绑定" "无 workspace 镜像绑定" t11

mkdir -p "$SANDBOX/.devenv-state"
cat > "$SANDBOX/.devenv-state/workspace-image.env" <<'ENV'
SNAPSHOT_HASH=0123456789abcdef0123456789abcdef01234567
IMAGE_ID=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
TOOLS_INPUT_HASH=
TOOLS_IMAGE_ID=
ENV
export MOCK_EVIDENCE='{"version":1,"fetchedPackages":0,"fetchedIds":[],"resolved":null,"complete":true,"errors":0,"nonJsonLines":0,"lifecycleEvents":0,"events":3}'
run t12 gen_json gen evidence
expect_rc "T12 完整证据 → 0" 0 t12
jq -e '.complete == true and .fetchedPackages == 0' "$OUT/t12.out" >/dev/null 2>&1 \
  && pass "T12 证据 JSON 可机读且零下载" || fail "T12" "证据输出不符：$(cat "$OUT/t12.out")"

export MOCK_EVIDENCE='{"version":1,"fetchedPackages":0,"complete":false,"events":1}'
run t13 gen_json gen evidence
expect_rc "T13 事件流不完整 → exit 4（不默认通过）" 4 t13
expect_grep "T13 报告流不完整" "事件流不完整" t13

export MOCK_EVIDENCE='{"version":1,"fetchedPackages":0,"complete":true,"errors":1,"events":3}'
run t13b gen_json gen evidence
expect_rc "T13b 证据含错误事件 → exit 4（不默认通过）" 4 t13b
expect_grep "T13b 报告 errors>0" "errors>0" t13b
jq -e '.errors == 1' "$OUT/t13b.out" >/dev/null 2>&1 \
  && pass "T13b 仍输出可机读证据供诊断" || fail "T13b" "证据输出不可解析"

export MOCK_EVIDENCE='not-json'
run t13c gen_json gen evidence
expect_rc "T13c 损坏证据 → exit 4" 4 t13c
if jq -e . "$OUT/t13c.out" >/dev/null 2>&1 \
   && ! grep -q 'not-json' "$OUT/t13c.out"; then
  pass "T13c 损坏证据不向 stdout 写非 JSON（仅 engine 事件）"
else
  fail "T13c" "stdout 出现非 JSON：$(cat "$OUT/t13c.out")"
fi

unset MOCK_EVIDENCE
run t14 gen_json gen evidence
expect_rc "T14 证据文件缺失 → exit 4" 4 t14
expect_grep "T14 报告无证据文件" "无 /workspace/.devenv/pnpm-install.json" t14
rm -rf "$SANDBOX/.devenv-state"

# ---------------------------------------------------------------------------
# T15 lockfile 规范化/预期 diff 单元验证（直接 source 库）
# ---------------------------------------------------------------------------
# shellcheck source=../lib/output.sh
source "$REPO_ROOT/devenv/lib/output.sh"
# shellcheck source=../lib/gen.sh
source "$REPO_ROOT/devenv/lib/gen.sh"
REPO_ROOT="$SANDBOX"   # gen.sh 的 git 辅助函数依赖 REPO_ROOT
make_new_lockfile theta-pkg "$OUT/theta-lock.yaml"
gen_lockfile_has_importer "$OUT/theta-lock.yaml" packages/theta-pkg \
  && pass "T15 识别新增 importer" || fail "T15" "未识别 importer"
gen_lockfile_diff_expected "$OUT/base-lock.yaml" "$OUT/theta-lock.yaml" packages/theta-pkg \
  && pass "T15 只新增 importer 判为预期 diff" || fail "T15" "预期 diff 判定失败"
cp "$OUT/theta-lock.yaml" "$OUT/theta-bad.yaml"
sed -i.bak 's/version: 5.1.1/version: 5.1.0/' "$OUT/theta-bad.yaml" && rm -f "$OUT/theta-bad.yaml.bak"
gen_lockfile_diff_expected "$OUT/base-lock.yaml" "$OUT/theta-bad.yaml" packages/theta-pkg 2>/dev/null \
  && fail "T15" "非预期 diff 被判为预期" || pass "T15 其它变化判为非预期 diff"

# ---------------------------------------------------------------------------
# T16 gen app 正常路径：来源可核 + 文件通道隔离 + workspace.Dockerfile 两靶补丁 + lockfile 预期 diff
# ---------------------------------------------------------------------------
reset_repo
make_new_app_lockfile worker-demo "$MOCK_NEW_LOCKFILE"
run t16 gen_json gen app worker-demo
expect_rc "T16 gen app 成功" 0 t16
if jq -e . "$OUT/t16.out" >/dev/null 2>&1; then
  pass "T16 stdout 全为可解析 JSON（tar 未混入结果流）"
else
  fail "T16" "stdout 非纯 JSONL：$(head -c 200 "$OUT/t16.out")"
fi
jq -se 'any(.[]; .event == "gen.source" and (.path | endswith("/devenv/gen")))' "$OUT/t16.out" >/dev/null \
  && pass "T16 报告宿主来源路径" || fail "T16" "缺 gen.source 事件"
jq -se 'any(.[]; .event == "gen.source" and (.treeHash | length == 40) and (.setHash | length == 64) and (.files | tonumber > 0))' "$OUT/t16.out" >/dev/null \
  && pass "T16 报告生成器子树哈希 + 整集哈希 + 文件数" || fail "T16" "gen.source 字段不完整"
jq -se 'any(.[]; .command == "gen" and .status == "ok" and .kind == "app" and .name == "worker-demo" and .importer == "apps/worker-demo" and .lockgen == "ok" and .lockfileDiff == "expected")' "$OUT/t16.out" >/dev/null \
  && pass "T16 终值含 kind=app/name/importer/lockgen=ok/lockfileDiff=expected" || fail "T16" "终值事件缺失：$(tail -1 "$OUT/t16.out")"
[[ -f "$SANDBOX/apps/worker-demo/package.json" && -f "$SANDBOX/apps/worker-demo/src/main.ts" && -f "$SANDBOX/apps/worker-demo/src/hello.spec.ts" ]] \
  && pass "T16 新 app 已落盘" || fail "T16" "新 app 文件未落盘"
[[ "$(grep -cFx 'COPY apps/worker-demo/package.json apps/worker-demo/package.json' "$SANDBOX/devenv/workspace.Dockerfile")" == "2" ]] \
  && pass "T16 workspace.Dockerfile 两靶各追加一行 COPY" || fail "T16" "Dockerfile COPY 数量不等于 2"
grep -q '^  apps/worker-demo:' "$SANDBOX/pnpm-lock.yaml" \
  && pass "T16 lockfile 新增 apps/worker-demo importer" || fail "T16" "lockfile 未含新 app importer"

# ---------------------------------------------------------------------------
# T17 gen app 幂等拒绝：目标已存在 → exit 4，无部分写入
# ---------------------------------------------------------------------------
df_before="$(sha256sum "$SANDBOX/devenv/workspace.Dockerfile" | awk '{print $1}')"
lf_before="$(sha256sum "$SANDBOX/pnpm-lock.yaml" | awk '{print $1}')"
printf 'sentinel\n' > "$SANDBOX/apps/worker-demo/src/sentinel.txt"
run t17 gen_json gen app worker-demo
expect_rc "T17 重复 gen app 拒绝 exit 4" 4 t17
expect_grep "T17 报告目标已存在" "目标已存在：apps/worker-demo/" t17
[[ -f "$SANDBOX/apps/worker-demo/src/sentinel.txt" ]] \
  && pass "T17 新 app 内容未变（无部分写入）" || fail "T17" "已有文件被改动"
[[ "$(sha256sum "$SANDBOX/devenv/workspace.Dockerfile" | awk '{print $1}')" == "$df_before" ]] \
  && pass "T17 Dockerfile 未变" || fail "T17" "Dockerfile 被改动"
[[ "$(sha256sum "$SANDBOX/pnpm-lock.yaml" | awk '{print $1}')" == "$lf_before" ]] \
  && pass "T17 lockfile 未变" || fail "T17" "lockfile 被改动"

# ---------------------------------------------------------------------------
# T18 gen app 锚点已注入拒绝：Dockerfile 已有 COPY 行 → exit 4，不创建目录
# ---------------------------------------------------------------------------
reset_repo
awk '{ print; if ($0 ~ /^# @gen:pkg-copy/) print "COPY apps/ghost-app/package.json apps/ghost-app/package.json" }' \
  "$SANDBOX/devenv/workspace.Dockerfile" > "$SANDBOX/devenv/workspace.Dockerfile.tmp"
mv "$SANDBOX/devenv/workspace.Dockerfile.tmp" "$SANDBOX/devenv/workspace.Dockerfile"
make_new_app_lockfile ghost-app "$MOCK_NEW_LOCKFILE"
run t18 gen_json gen app ghost-app
expect_rc "T18 app 补丁已注入拒绝 exit 4" 4 t18
expect_grep "T18 报告补丁已注入" "workspace.Dockerfile 已注入过 ghost-app" t18
[[ ! -e "$SANDBOX/apps/ghost-app" ]] \
  && pass "T18 未创建目标 app 目录" || fail "T18" "拒绝后仍创建了 apps/ghost-app"

# ---------------------------------------------------------------------------
# T19 gen app 非预期 lockfile diff → exit 4，停止并保留现场供审查
# ---------------------------------------------------------------------------
reset_repo
make_new_app_lockfile rogue-app "$MOCK_NEW_LOCKFILE"
sed -i.bak 's/version: 5.1.1/version: 5.1.2/' "$MOCK_NEW_LOCKFILE" && rm -f "$MOCK_NEW_LOCKFILE.bak"
run t19 gen_json gen app rogue-app
expect_rc "T19 app 非预期 lockfile diff exit 4" 4 t19
expect_grep "T19 报告非预期 diff 并要求审查" "非预期 lockfile diff" t19
[[ -d "$SANDBOX/apps/rogue-app" ]] \
  && pass "T19 生成 app 保留供审查" || fail "T19" "现场未保留"
grep -q 'version: 5.1.2' "$SANDBOX/pnpm-lock.yaml" \
  && pass "T19 新 lockfile 保留供审查" || fail "T19" "lockfile 未保留"

# ---------------------------------------------------------------------------
# T20 gen app lockgen 失败 → 回滚 apps/<name> / Dockerfile / lockfile
# ---------------------------------------------------------------------------
reset_repo
export MOCK_LOCKGEN_FAIL=1
run t20 gen_json gen app rollback-app
expect_rc "T20 app lockgen 失败 exit 4" 4 t20
[[ ! -e "$SANDBOX/apps/rollback-app" ]] \
  && pass "T20 新 app 已回滚" || fail "T20" "apps/rollback-app 残留"
cmp -s "$OUT/base-dockerfile" "$SANDBOX/devenv/workspace.Dockerfile" \
  && pass "T20 Dockerfile 已回滚" || fail "T20" "Dockerfile 未回滚"
cmp -s "$OUT/base-lock.yaml" "$SANDBOX/pnpm-lock.yaml" \
  && pass "T20 lockfile 已回滚" || fail "T20" "lockfile 未回滚"

# ---------------------------------------------------------------------------
# T21 gen app 跨目录输出越界（输出 packages/<name>/...）→ exit 4，零写入
# ---------------------------------------------------------------------------
reset_repo
export MOCK_OUTPUT_CROSS_DIR=1
make_new_app_lockfile cross-app "$MOCK_NEW_LOCKFILE"
run t21 gen_json gen app cross-app
expect_rc "T21 app 跨目录越界 exit 4" 4 t21
expect_grep "T21 报告路径越界" "生成物路径越界" t21
[[ ! -e "$SANDBOX/apps/cross-app" && ! -e "$SANDBOX/packages/cross-app" ]] \
  && pass "T21 未写入任何文件" || fail "T21" "越界检查后仍有文件写入"
cmp -s "$OUT/base-dockerfile" "$SANDBOX/devenv/workspace.Dockerfile" \
  && pass "T21 Dockerfile 未改动" || fail "T21" "Dockerfile 被改动"

# ---------------------------------------------------------------------------
# T22 gen app 跨目录包名冲突：packages/<name> 已占用 @ne/<name> → 预检即拒 exit 4
# ---------------------------------------------------------------------------
reset_repo
make_new_app_lockfile contracts "$MOCK_NEW_LOCKFILE"
run t22 gen_json gen app contracts
expect_rc "T22 跨目录包名冲突拒绝 exit 4" 4 t22
expect_grep "T22 报告包名冲突" "包名冲突：packages/contracts/package.json 已占用 @ne/contracts" t22
[[ ! -e "$SANDBOX/apps/contracts" ]] \
  && pass "T22 未创建目标 app 目录" || fail "T22" "拒绝后仍创建了 apps/contracts"

# ---------------------------------------------------------------------------
# 汇总
# ---------------------------------------------------------------------------
echo "----------------------------------------"
echo "PASS: $PASS_COUNT  FAIL: $FAILURES"
[[ "$FAILURES" == 0 ]]