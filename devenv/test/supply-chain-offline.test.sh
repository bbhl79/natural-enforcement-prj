#!/usr/bin/env bash
# ============================================================================
# 供应链门禁离线测试（#63）——不访问真实引擎/registry（docker、pnpm 全部 mock）
#
# 覆盖（Spec-工程基座 §2 版本与镜像锁、§8 供应链）：
#   1. catalog 一律精确 pin；manifest 不得浮动版本；catalog 依赖须经 catalog:
#   2. allowBuilds 版本化审批键；minimumReleaseAge 语义（分钟）与严格模式定值
#   3. 锁文件漂移：catalog 声明 ↔ pnpm-lock.yaml 解析、importer 直接依赖集合
#   4. images.lock：tag+digest 双层锁、多架构 manifest-list / 单架构平台摘要、
#      macOS 路线登记；images --verify 运行态 digest 与 tools 基座 label 核对
#   5. 包内 agent skills 默认不自动采纳：待审批项非零即失败（默认拒绝策略）
#   6. doctor / build 门禁接线：漂移在构建前停止并要求审查
# ============================================================================
set -Eeuo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TEST_DIR/../.." && pwd)"

FAILURES=0
PASS_COUNT=0
pass() { printf 'PASS: %s\n' "$1"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { printf 'FAIL: %s —— %s\n' "$1" "$2"; FAILURES=$((FAILURES + 1)); }

SANDBOX=$(mktemp -d /tmp/devenv-supply-chain-offline.XXXXXX)
trap 'rm -rf "$SANDBOX"' EXIT
echo "沙箱：$SANDBOX"

# ---------------------------------------------------------------------------
# 夹具：最小仓库（可逐用例改造）+ mock docker/pnpm
# ---------------------------------------------------------------------------
FIXTURES=0
new_fixture() { # new_fixture <name> → echo 路径；目录内含 devenv 副本与基线合法输入
  FIXTURES=$((FIXTURES + 1))
  local dir="$SANDBOX/fix-${FIXTURES}-$1"
  mkdir -p "$dir/apps/api" "$dir/apps/web" "$dir/packages/contracts"
  cp -r "$REPO_ROOT/devenv" "$dir/devenv"
  cat > "$dir/pnpm-workspace.yaml" <<'YAML'
packages:
  - apps/*
  - packages/*

minimumReleaseAge: 1440
minimumReleaseAgeStrict: true

allowBuilds:
  prisma@7.10.1: true
  "@prisma/engines@7.10.1": true
  "@scarf/scarf@1.4.0": false

catalog:
  typescript: "6.0.3"
  zod: "4.6.7"
YAML
  cat > "$dir/package.json" <<'JSON'
{
  "name": "fixture",
  "private": true,
  "packageManager": "pnpm@12.21.0",
  "devDependencies": {
    "typescript": "catalog:"
  }
}
JSON
  cat > "$dir/apps/api/package.json" <<'JSON'
{
  "name": "@fix/api",
  "private": true,
  "dependencies": {
    "@ne/contracts": "workspace:*",
    "zod": "catalog:"
  }
}
JSON
  cat > "$dir/apps/web/package.json" <<'JSON'
{
  "name": "@fix/web",
  "private": true,
  "dependencies": {
    "@ne/contracts": "workspace:*",
    "zod": "catalog:"
  }
}
JSON
  cat > "$dir/packages/contracts/package.json" <<'JSON'
{"name": "@ne/contracts", "private": true, "dependencies": {"zod": "catalog:"}}
JSON
  cat > "$dir/pnpm-lock.yaml" <<'YAML'
lockfileVersion: '9.0'

catalogs:
  default:
    typescript:
      specifier: 6.0.3
      version: 6.0.3
    zod:
      specifier: 4.6.7
      version: 4.6.7

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
      zod:
        specifier: 'catalog:'
        version: 4.6.7

  apps/web:
    dependencies:
      '@ne/contracts':
        specifier: workspace:*
        version: link:../../packages/contracts
      zod:
        specifier: 'catalog:'
        version: 4.6.7

  packages/contracts:
    dependencies:
      zod:
        specifier: 'catalog:'
        version: 4.6.7
YAML
  cat > "$dir/devenv/images.lock" <<'LOCK'
# 夹具镜像锁
NODE_IMAGE=node:26.13.1-slim@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
NODE_IMAGE_KIND=manifest-list
DB_IMAGE=postgis/postgis:18-3.6@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
DB_IMAGE_KIND=single-arch
DB_IMAGE_PLATFORM=linux/amd64
DB_IMAGE_MACOS=kartoza/postgis:18.6-3.6.4@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
DB_IMAGE_MACOS_KIND=manifest-list
LOCK
  printf '%s' "$dir"
}

DEVENV_OF() { printf '%s/devenv/devenv' "$1"; }

run_sc() { # run_sc <fix> [args...]；调用 devenv supply-chain
  local dir="$1"; shift
  set +e
  "$(DEVENV_OF "$dir")" supply-chain "$@" > "$dir/out" 2> "$dir/err"
  RC=$?
  set -e
}

expect_rc() { [[ "$RC" == "$2" ]] && pass "$1" || fail "$1" "期望退出码 $2，实际 ${RC}（stderr: $(tail -2 "$3/err" 2>/dev/null)）"; }

# ---------------------------------------------------------------------------
# 1. catalog 精确 pin 与 manifest 声明（垂直切片 1）
# ---------------------------------------------------------------------------
F=$(new_fixture good)
run_sc "$F"
expect_rc "SC1 基线合法输入 supply-chain 通过" 0 "$F"
grep -q '供应链门禁通过' "$F/out" "$F/err" \
  && pass "SC1 成功输出报告门禁通过" || fail "SC1" "成功路径未报告通过：$(cat "$F/out" "$F/err")"

F=$(new_fixture catalog-range)
sed -i.bak 's/typescript: "6.0.3"/typescript: "^6.0.3"/' "$F/pnpm-workspace.yaml"
rm -f "$F/pnpm-workspace.yaml.bak"
run_sc "$F"
expect_rc "SC2 catalog 浮动范围被拒" 4 "$F"
grep -q 'catalog' "$F/err" && pass "SC2 报错指明 catalog" || fail "SC2" "stderr 未指明 catalog：$(cat "$F/err")"

F=$(new_fixture manifest-range)
sed -i.bak 's/"zod": "catalog:"/"zod": "^4.6.7"/' "$F/apps/web/package.json"
rm -f "$F/apps/web/package.json.bak"
run_sc "$F"
expect_rc "SC3 manifest 浮动版本被拒" 4 "$F"
grep -q 'apps/web/package.json' "$F/err" && pass "SC3 报错指明 manifest" || fail "SC3" "stderr 未指明文件：$(cat "$F/err")"

F=$(new_fixture catalog-authority)
sed -i.bak 's/"typescript": "catalog:"/"typescript": "6.0.3"/' "$F/package.json"
rm -f "$F/package.json.bak"
run_sc "$F"
expect_rc "SC4 catalog 依赖须经 catalog: 声明" 4 "$F"
grep -q 'catalog:' "$F/err" && pass "SC4 报错指明 catalog: 权威位置" || fail "SC4" "stderr 未说明：$(cat "$F/err")"

# ---------------------------------------------------------------------------
# 2. allowBuilds 版本化键与 minimumReleaseAge 语义/定值（垂直切片 2）
# ---------------------------------------------------------------------------
F=$(new_fixture allow-builds-bare)
sed -i.bak 's/  prisma@7.10.1: true/  prisma: true/' "$F/pnpm-workspace.yaml"
rm -f "$F/pnpm-workspace.yaml.bak"
run_sc "$F"
expect_rc "SC5 allowBuilds 裸包名（无版本号）被拒" 4 "$F"
grep -q '版本' "$F/err" && pass "SC5 报错要求版本化审批键" || fail "SC5" "stderr 未说明版本：$(cat "$F/err")"

F=$(new_fixture release-age-missing)
sed -i.bak '/^minimumReleaseAge: 1440$/d' "$F/pnpm-workspace.yaml"
rm -f "$F/pnpm-workspace.yaml.bak"
run_sc "$F"
expect_rc "SC6 minimumReleaseAge 缺失被拒" 4 "$F"
grep -q 'minimumReleaseAge' "$F/err" && pass "SC6 报错指明 minimumReleaseAge" || fail "SC6" "stderr 未指明：$(cat "$F/err")"

F=$(new_fixture release-age-zero)
sed -i.bak 's/^minimumReleaseAge: 1440$/minimumReleaseAge: 0/' "$F/pnpm-workspace.yaml"
rm -f "$F/pnpm-workspace.yaml.bak"
run_sc "$F"
expect_rc "SC7 minimumReleaseAge=0 被拒" 4 "$F"

F=$(new_fixture release-age-nonstrict)
sed -i.bak '/^minimumReleaseAgeStrict: true$/d' "$F/pnpm-workspace.yaml"
rm -f "$F/pnpm-workspace.yaml.bak"
run_sc "$F"
expect_rc "SC8 缺 minimumReleaseAgeStrict: true 被拒" 4 "$F"
grep -q 'minimumReleaseAgeStrict' "$F/err" && pass "SC8 报错指明 strict" || fail "SC8" "stderr 未指明：$(cat "$F/err")"

F=$(new_fixture release-age-exclude-bare)
cat >> "$F/pnpm-workspace.yaml" <<'YAML'
minimumReleaseAgeExclude:
  - zod
YAML
run_sc "$F"
expect_rc "SC9 minimumReleaseAgeExclude 裸包名被拒" 4 "$F"
grep -q 'minimumReleaseAgeExclude' "$F/err" && pass "SC9 报错指明例外列表" || fail "SC9" "stderr 未指明：$(cat "$F/err")"

F=$(new_fixture release-age-exclude-versioned)
cat >> "$F/pnpm-workspace.yaml" <<'YAML'
minimumReleaseAgeExclude:
  - zod@4.6.7
YAML
run_sc "$F"
expect_rc "SC10 版本化冷却期例外可接受" 0 "$F"

F=$(new_fixture allow-all-builds)
cat >> "$F/pnpm-workspace.yaml" <<'YAML'
dangerouslyAllowAllBuilds: true
YAML
run_sc "$F"
expect_rc "SC11 dangerouslyAllowAllBuilds 被拒" 4 "$F"

# ---------------------------------------------------------------------------
# 3. 锁文件漂移：catalog/manifest 声明 ↔ pnpm-lock.yaml（垂直切片 3）
# ---------------------------------------------------------------------------
F=$(new_fixture lock-catalog-drift)
awk 'BEGIN{n=0} /^      version: 6\.0\.3$/ && n==0 {print "      version: 6.0.2"; n=1; next} {print}' \
  "$F/pnpm-lock.yaml" > "$F/pnpm-lock.yaml.new" && mv "$F/pnpm-lock.yaml.new" "$F/pnpm-lock.yaml"
run_sc "$F"
expect_rc "SC12 lockfile catalog 解析漂移被拒" 4 "$F"
grep -q '锁文件' "$F/err" && pass "SC12 报错指明锁文件漂移" || fail "SC12" "stderr 未指明：$(cat "$F/err")"

F=$(new_fixture lock-importer-drift)
awk '
  /^  apps\/web:/ { inweb=1 }
  inweb && /^      zod:/ { zod=1; print; next }
  inweb && zod && /^        version: 4\.6\.7$/ { print "        version: 4.6.6"; zod=0; next }
  { print }
' "$F/pnpm-lock.yaml" > "$F/pnpm-lock.yaml.new" && mv "$F/pnpm-lock.yaml.new" "$F/pnpm-lock.yaml"
run_sc "$F"
expect_rc "SC13 importer 解析版本漂移被拒" 4 "$F"
grep -q '4.6.6\|漂移' "$F/err" && pass "SC13 报错含实际/期望版本" || fail "SC13" "stderr 未说明：$(cat "$F/err")"

F=$(new_fixture lock-extra-dep)
awk '
  /^  apps\/web:/ { inweb=1 }
  inweb && /^      zod:/ { zod=1; print; next }
  inweb && zod && /^        version: 4\.6\.7$/ {
    print
    print "      left-pad:"
    print "        specifier: 1.3.0"
    print "        version: 1.3.0"
    zod=0; next
  }
  { print }
' "$F/pnpm-lock.yaml" > "$F/pnpm-lock.yaml.new" && mv "$F/pnpm-lock.yaml.new" "$F/pnpm-lock.yaml"
run_sc "$F"
expect_rc "SC14 lockfile 多出 manifest 未声明的直接依赖被拒" 4 "$F"
grep -q 'left-pad' "$F/err" && pass "SC14 报错指明多出的依赖" || fail "SC14" "stderr 未指明：$(cat "$F/err")"

F=$(new_fixture lock-missing-dep)
awk '
  /^  apps\/api:/ { inapi=1 }
  inapi && /^      zod:/ { drop=1; next }
  inapi && drop && /^        / { next }
  inapi && drop { drop=0 }
  { print }
' "$F/pnpm-lock.yaml" > "$F/pnpm-lock.yaml.new" && mv "$F/pnpm-lock.yaml.new" "$F/pnpm-lock.yaml"
run_sc "$F"
expect_rc "SC15 lockfile 缺 manifest 直接依赖被拒" 4 "$F"

F=$(new_fixture lock-catalog-extra)
awk '
  /^  default:/ { indef=1 }
  indef && /^    zod:/ { zod=1; print; next }
  indef && zod && /^      version: 4\.6\.7$/ {
    print
    print "    left-pad:"
    print "      specifier: 1.3.0"
    print "      version: 1.3.0"
    zod=0; next
  }
  { print }
' "$F/pnpm-lock.yaml" > "$F/pnpm-lock.yaml.new" && mv "$F/pnpm-lock.yaml.new" "$F/pnpm-lock.yaml"
run_sc "$F"
expect_rc "SC16 lockfile catalog 多出未声明条目被拒" 4 "$F"
grep -q 'left-pad' "$F/err" && pass "SC16 报错指明多出条目" || fail "SC16" "stderr 未指明：$(cat "$F/err")"

F=$(new_fixture lock-missing)
rm -f "$F/pnpm-lock.yaml"
run_sc "$F"
expect_rc "SC17 缺 pnpm-lock.yaml 被拒（需先审查生成）" 4 "$F"
grep -q 'pnpm-lock.yaml' "$F/err" && pass "SC17 报错指明锁文件" || fail "SC17" "stderr 未指明：$(cat "$F/err")"

# ---------------------------------------------------------------------------
# 4. images.lock：tag+digest 双层锁与平台摘要登记（垂直切片 4a）
# ---------------------------------------------------------------------------
F=$(new_fixture image-no-digest)
sed -i.bak 's|^DB_IMAGE=postgis/postgis:18-3.6@sha256:.*|DB_IMAGE=postgis/postgis:18-3.6|' "$F/devenv/images.lock"
rm -f "$F/devenv/images.lock.bak"
run_sc "$F"
expect_rc "SC18 镜像锁缺 digest 被拒" 4 "$F"
grep -q 'digest' "$F/err" && pass "SC18 报错指明 digest" || fail "SC18" "stderr 未指明：$(cat "$F/err")"

F=$(new_fixture image-platform-missing)
sed -i.bak '/^DB_IMAGE_PLATFORM=/d' "$F/devenv/images.lock"
rm -f "$F/devenv/images.lock.bak"
run_sc "$F"
expect_rc "SC19 单架构镜像缺平台摘要声明被拒" 4 "$F"
grep -q 'DB_IMAGE_PLATFORM' "$F/err" && pass "SC19 报错指明平台字段" || fail "SC19" "stderr 未指明：$(cat "$F/err")"

F=$(new_fixture image-macos-missing)
sed -i.bak '/^DB_IMAGE_MACOS/d; /^DB_IMAGE_MACOS_KIND/d' "$F/devenv/images.lock"
rm -f "$F/devenv/images.lock.bak"
run_sc "$F"
expect_rc "SC20 缺 macOS 路线登记被拒" 4 "$F"
grep -q 'DB_IMAGE_MACOS' "$F/err" && pass "SC20 报错指明 macOS 登记" || fail "SC20" "stderr 未指明：$(cat "$F/err")"

F=$(new_fixture image-macos-kind)
sed -i.bak 's/^DB_IMAGE_MACOS_KIND=manifest-list/DB_IMAGE_MACOS_KIND=single-arch/' "$F/devenv/images.lock"
rm -f "$F/devenv/images.lock.bak"
run_sc "$F"
expect_rc "SC21 macOS 多架构条目类型不符被拒" 4 "$F"

# ---------------------------------------------------------------------------
# 4b. images --verify：运行态 digest 漂移与 tools 基座 label（mock docker）
# ---------------------------------------------------------------------------
DOCKERBIN="$SANDBOX/dockerbin"
MOCK_STATE="$SANDBOX/docker-state"
mkdir -p "$DOCKERBIN" "$MOCK_STATE"
cat > "$DOCKERBIN/docker" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
STATE="${MOCK_STATE:?}"
cmd="${1:-}"; [[ $# -gt 0 ]] && shift
case "$cmd" in
  version) cat "$STATE/version.json" ;;
  compose) echo "2.40.3" ;;
  ps)
    [[ -f "$STATE/db-running" ]] && printf 'cid-db\n'
    exit 0 ;;
  inspect)
    fmt=""
    while [[ $# -gt 0 ]]; do
      case "$1" in --format) fmt="$2"; shift 2;; *) shift;; esac
    done
    [[ "$fmt" == *".Image"* && -f "$STATE/container-image" ]] || exit 1
    cat "$STATE/container-image" ;;
  image)
    sub="${1:-}"; [[ $# -gt 0 ]] && shift
    [[ "$sub" == "inspect" ]] || exit 0
    fmt=""
    while [[ $# -gt 0 ]]; do
      case "$1" in --format) fmt="$2"; shift 2;; *) shift;; esac
    done
    case "$fmt" in
      *RepoDigests*) [[ -f "$STATE/repodigests" ]] || exit 1; cat "$STATE/repodigests" ;;
      *devenv.node.image*) [[ -f "$STATE/node-label" ]] || exit 1; cat "$STATE/node-label" ;;
      *) exit 1 ;;
    esac ;;
  *) exit 0 ;;
esac
MOCK
chmod +x "$DOCKERBIN/docker"

DIG_B=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
DIG_C=cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
NODE_REF="node:26.13.1-slim@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

reset_mock() { # reset_mock [arch]
  rm -rf "$MOCK_STATE"; mkdir -p "$MOCK_STATE"
  cat > "$MOCK_STATE/version.json" <<JSON
{"Client":{"Version":"29.1.3"},"Server":{"Version":"6.1.4","Os":"linux","Arch":"${1:-amd64}","Components":[{"Name":"Podman Engine","Version":"6.1.4"}]}}
JSON
}

run_images_verify() { # run_images_verify <fix> [extra env...]
  local dir="$1"; shift
  set +e
  ( cd "$dir" && env PATH="$DOCKERBIN:$PATH" MOCK_STATE="$MOCK_STATE" \
      DEVENV_DOCKER_HOST="unix:///mock.sock" DOCKER_HOST="unix:///mock.sock" \
      DEVENV_STATE_DIR="$dir/.devenv-state" "$@" \
      "$(DEVENV_OF "$dir")" --json images --verify ) > "$dir/out" 2> "$dir/err"
  RC=$?
  set -e
}

F=$(new_fixture images-ok)
reset_mock amd64
printf 'cid-db\n' > "$MOCK_STATE/db-running"
printf 'sha256:dbimg\n' > "$MOCK_STATE/container-image"
printf '["postgis/postgis@sha256:%s"]\n' "$DIG_B" > "$MOCK_STATE/repodigests"
printf '%s\n' "$NODE_REF" > "$MOCK_STATE/node-label"
run_images_verify "$F"
expect_rc "SC22 images --verify 运行态一致通过（db + tools 基座）" 0 "$F"
jq -s -e 'any(.[]; .service=="db" and .result=="ok")' "$F/out" >/dev/null 2>&1 \
  && pass "SC22 db 结果 ok" || fail "SC22" "db JSON 不符：$(cat "$F/out")"
jq -s -e 'any(.[]; .service=="node" and .result=="ok")' "$F/out" >/dev/null 2>&1 \
  && pass "SC22 node 基座 label 一致" || fail "SC22" "node JSON 不符：$(cat "$F/out")"

F=$(new_fixture images-db-drift)
reset_mock amd64
printf 'cid-db\n' > "$MOCK_STATE/db-running"
printf 'sha256:dbimg\n' > "$MOCK_STATE/container-image"
printf '["postgis/postgis@sha256:%s"]\n' "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd" > "$MOCK_STATE/repodigests"
printf '%s\n' "$NODE_REF" > "$MOCK_STATE/node-label"
run_images_verify "$F"
expect_rc "SC23 db 运行态 digest 漂移 → exit 1" 1 "$F"
jq -s -e 'any(.[]; .service=="db" and .result=="drift")' "$F/out" >/dev/null 2>&1 \
  && pass "SC23 报告 drift" || fail "SC23" "JSON 不符：$(cat "$F/out")"

F=$(new_fixture images-db-down)
reset_mock amd64
printf '%s\n' "$NODE_REF" > "$MOCK_STATE/node-label"
run_images_verify "$F"
expect_rc "SC24 db 未运行 → exit 1" 1 "$F"
jq -s -e 'any(.[]; .service=="db" and .result=="not-running")' "$F/out" >/dev/null 2>&1 \
  && pass "SC24 报告 not-running" || fail "SC24" "JSON 不符：$(cat "$F/out")"

F=$(new_fixture images-no-digest-ref)
reset_mock amd64
printf 'cid-db\n' > "$MOCK_STATE/db-running"
printf 'sha256:dbimg\n' > "$MOCK_STATE/container-image"
printf '%s\n' "$NODE_REF" > "$MOCK_STATE/node-label"
run_images_verify "$F" DEVENV_DB_IMAGE="postgis/postgis:18-3.6"
expect_rc "SC25 生效引用无 digest → exit 1（无法 digest 级校验）" 1 "$F"
jq -s -e 'any(.[]; .service=="db" and .result=="no-digest-in-ref")' "$F/out" >/dev/null 2>&1 \
  && pass "SC25 报告 no-digest-in-ref" || fail "SC25" "JSON 不符：$(cat "$F/out")"

F=$(new_fixture images-node-drift)
reset_mock amd64
printf 'cid-db\n' > "$MOCK_STATE/db-running"
printf 'sha256:dbimg\n' > "$MOCK_STATE/container-image"
printf '["postgis/postgis@sha256:%s"]\n' "$DIG_B" > "$MOCK_STATE/repodigests"
printf 'node:26.13.1-slim@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\n' > "$MOCK_STATE/node-label"
run_images_verify "$F"
expect_rc "SC26 tools 基座 node label 漂移 → exit 1" 1 "$F"
jq -s -e 'any(.[]; .service=="node" and .result=="drift")' "$F/out" >/dev/null 2>&1 \
  && pass "SC26 报告 node drift" || fail "SC26" "JSON 不符：$(cat "$F/out")"

F=$(new_fixture images-node-missing)
reset_mock amd64
printf 'cid-db\n' > "$MOCK_STATE/db-running"
printf 'sha256:dbimg\n' > "$MOCK_STATE/container-image"
printf '["postgis/postgis@sha256:%s"]\n' "$DIG_B" > "$MOCK_STATE/repodigests"
run_images_verify "$F"
expect_rc "SC27 tools 镜像未构建 → exit 1" 1 "$F"
jq -s -e 'any(.[]; .service=="node" and .result=="not-built")' "$F/out" >/dev/null 2>&1 \
  && pass "SC27 报告 not-built" || fail "SC27" "JSON 不符：$(cat "$F/out")"

F=$(new_fixture images-mac-route)
reset_mock arm64
printf 'cid-db\n' > "$MOCK_STATE/db-running"
printf 'sha256:dbimg\n' > "$MOCK_STATE/container-image"
printf '["kartoza/postgis@sha256:%s"]\n' "$DIG_C" > "$MOCK_STATE/repodigests"
printf '%s\n' "$NODE_REF" > "$MOCK_STATE/node-label"
run_images_verify "$F"
expect_rc "SC28 engine arm64 自动采用 macOS 路线并核对 kartoza digest" 0 "$F"
grep -q 'kartoza' "$F/err" && pass "SC28 报告 macOS 路线来源" || fail "SC28" "stderr 未报告：$(cat "$F/err")"

# ---------------------------------------------------------------------------
# 5. 包内 agent skills / 构建脚本待审批门禁（垂直切片 5）
# ---------------------------------------------------------------------------
PNPMBIN="$SANDBOX/pnpmbin"
mkdir -p "$PNPMBIN"
cat > "$PNPMBIN/pnpm" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
case "$*" in
  *"permissions list"*)
    [[ -n "${MOCK_PERM_OUT:-}" ]] && cat "$MOCK_PERM_OUT"
    exit "${MOCK_PERM_RC:-0}" ;;
esac
exit 0
MOCK
chmod +x "$PNPMBIN/pnpm"

CHK="$REPO_ROOT/devenv/supply-chain/check-permissions.sh"
run_perm() { # run_perm <outfile> <rc> [extra env...]
  local outfile="$1" prc="$2"; shift 2
  set +e
  env PATH="$PNPMBIN:$PATH" MOCK_PERM_OUT="$outfile" MOCK_PERM_RC="$prc" \
    bash "$CHK" --root "$SANDBOX" "$@" > "$SANDBOX/perm.out" 2> "$SANDBOX/perm.err"
  PRC=$?
  set -e
}

cat > "$SANDBOX/perm-pending.txt" <<'TXT'
Granted:
  prisma  build

Awaiting approval:
  @reduxjs/toolkit  skills

Run "pnpm approve" to review the packages awaiting approval.
TXT
run_perm "$SANDBOX/perm-pending.txt" 0
[[ "$PRC" == 1 ]] && pass "SC29 agent skills 待审批 → 门禁 exit 1" || fail "SC29" "rc=${PRC}（期望 1）"
grep -q '@reduxjs/toolkit' "$SANDBOX/perm.err" && pass "SC29 报错列出待审包" || fail "SC29" "stderr 未列出：$(cat "$SANDBOX/perm.err")"

cat > "$SANDBOX/perm-clean.txt" <<'TXT'
Granted:
  prisma  build

Denied:
  @scarf/scarf  build
TXT
run_perm "$SANDBOX/perm-clean.txt" 0
[[ "$PRC" == 0 ]] && pass "SC30 无待审批项 → 门禁通过" || fail "SC30" "rc=${PRC}（期望 0）"

run_perm "$SANDBOX/perm-clean.txt" 1
[[ "$PRC" == 1 ]] && pass "SC31 pnpm 检查失败 → fail-closed exit 1" || fail "SC31" "rc=${PRC}（期望 1）"

# 构建接线：deps 层普通构建必须 frozen install，且 install 后执行权限门禁
grep -q 'pnpm install --frozen-lockfile' "$REPO_ROOT/devenv/workspace.Dockerfile" \
  && pass "SC32 workspace deps 层使用 frozen install" || fail "SC32a" "Dockerfile 未使用 frozen install"
grep -q 'ne-check-permissions' "$REPO_ROOT/devenv/workspace.Dockerfile" \
  && pass "SC32 deps 层接线权限门禁" || fail "SC32b" "Dockerfile 未调用权限门禁"
grep -q 'devenv.node.image' "$REPO_ROOT/devenv/tools.Dockerfile" \
  && pass "SC32 tools 镜像记录 node 上游锁 label" || fail "SC32c" "tools.Dockerfile 缺 node label"
# LABEL 能取到值的前提：FROM 前声明的全局 ARG 必须在 stage 内重新声明。
awk '/^FROM /{stage=1} stage && /^ARG NODE_IMAGE[[:space:]]*$/{found=1} END{exit !found}' \
  "$REPO_ROOT/devenv/tools.Dockerfile" \
  && pass "SC32 tools 镜像在 stage 内声明 NODE_IMAGE（label 非空）" \
  || fail "SC32d" "FROM 后缺 ARG NODE_IMAGE，label 会为空"
# 构建上下文忽略 devenv/，必须显式放行权限门禁脚本，否则 COPY 在真实构建中失败。
grep -qx '!devenv/supply-chain/check-permissions.sh' "$REPO_ROOT/.dockerignore" \
  && pass "SC32 .dockerignore 放行权限门禁脚本" \
  || fail "SC32e" ".dockerignore 未放行 devenv/supply-chain/check-permissions.sh"

# ---------------------------------------------------------------------------
# 6. doctor / build 门禁接线：漂移在构建前停止并要求审查（垂直切片 6）
# ---------------------------------------------------------------------------
run_doctor() { # run_doctor <fix>
  local dir="$1"
  set +e
  ( cd "$dir" && env PATH="$DOCKERBIN:$PATH" MOCK_STATE="$MOCK_STATE" \
      DEVENV_DOCKER_HOST="unix:///mock.sock" DOCKER_HOST="unix:///mock.sock" \
      DEVENV_LOCK_ROOT="$SANDBOX/locks-doctor" DEVENV_STATE_DIR="$dir/.devenv-state" \
      "$(DEVENV_OF "$dir")" --json doctor ) > "$dir/out" 2> "$dir/err"
  RC=$?
  set -e
}

F=$(new_fixture doctor-good)
reset_mock amd64
run_doctor "$F"
expect_rc "SC33 doctor 基线通过（含 supply-chain 检查）" 0 "$F"
jq -e '.checks[] | select(.check=="supply-chain" and .result=="ok")' "$F/out" >/dev/null 2>&1 \
  && pass "SC33 doctor 报告 supply-chain ok" || fail "SC33" "JSON 缺 supply-chain ok：$(cat "$F/out")"

F=$(new_fixture doctor-drift)
sed -i.bak 's/typescript: "6.0.3"/typescript: "^6.0.3"/' "$F/pnpm-workspace.yaml"
rm -f "$F/pnpm-workspace.yaml.bak"
reset_mock amd64
run_doctor "$F"
expect_rc "SC34 doctor 检出供应链漂移 → exit 3" 3 "$F"
jq -e '.checks[] | select(.check=="supply-chain" and .result=="fail")' "$F/out" >/dev/null 2>&1 \
  && pass "SC34 doctor 报告 supply-chain fail" || fail "SC34" "JSON 缺 supply-chain fail：$(cat "$F/out")"

# build 预检：静态门禁失败时必须在 snapshot/docker build 之前停止
# 替换 mock 以记录调用（保留既有分支）
cat > "$DOCKERBIN/docker" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
STATE="${MOCK_STATE:?}"
printf '%s\n' "$*" >> "$STATE/calls.log"
cmd="${1:-}"; [[ $# -gt 0 ]] && shift
case "$cmd" in
  version) cat "$STATE/version.json" ;;
  compose) echo "2.40.3" ;;
  build) echo "sha256:$(printf 'f%.0s' {1..64})" ;;
  ps) [[ -f "$STATE/db-running" ]] && printf 'cid-db\n'; exit 0 ;;
  inspect)
    fmt=""
    while [[ $# -gt 0 ]]; do case "$1" in --format) fmt="$2"; shift 2;; *) shift;; esac; done
    [[ "$fmt" == *".Image"* && -f "$STATE/container-image" ]] || exit 1
    cat "$STATE/container-image" ;;
  image)
    sub="${1:-}"; [[ $# -gt 0 ]] && shift
    [[ "$sub" == "inspect" ]] || exit 0
    fmt=""
    while [[ $# -gt 0 ]]; do case "$1" in --format) fmt="$2"; shift 2;; *) shift;; esac; done
    case "$fmt" in
      *RepoDigests*) [[ -f "$STATE/repodigests" ]] || exit 1; cat "$STATE/repodigests" ;;
      *devenv.node.image*) [[ -f "$STATE/node-label" ]] || exit 1; cat "$STATE/node-label" ;;
      *) exit 1 ;;
    esac ;;
  *) exit 0 ;;
esac
MOCK
chmod +x "$DOCKERBIN/docker"

F=$(new_fixture build-preflight)
sed -i.bak 's/typescript: "6.0.3"/typescript: "^6.0.3"/' "$F/pnpm-workspace.yaml"
rm -f "$F/pnpm-workspace.yaml.bak"
reset_mock amd64
set +e
( cd "$F" && env PATH="$DOCKERBIN:$PATH" MOCK_STATE="$MOCK_STATE" \
    DEVENV_DOCKER_HOST="unix:///mock.sock" DOCKER_HOST="unix:///mock.sock" \
    DEVENV_LOCK_ROOT="$SANDBOX/locks-build" DEVENV_STATE_DIR="$F/.devenv-state" \
    "$(DEVENV_OF "$F")" --json build ) > "$F/out" 2> "$F/err"
RC=$?
set -e
expect_rc "SC35 build 预检失败 → exit 4（不进入构建）" 4 "$F"
if grep -q '^build ' "$MOCK_STATE/calls.log" 2>/dev/null; then
  fail "SC35" "门禁失败后仍调用了 docker build：$(cat "$MOCK_STATE/calls.log")"
else
  pass "SC35 门禁失败前未调用 docker build"
fi
jq -e '.command=="build" and .status=="failed" and .exitCode==4' "$F/out" >/dev/null 2>&1 \
  && pass "SC35 补发 build failed 终值事件" || fail "SC35" "终值事件不符：$(cat "$F/out")"

# ---------------------------------------------------------------------------
echo "------------------------------------------------------------"
echo "供应链门禁离线测试完成：$PASS_COUNT 通过，$FAILURES 失败"
[[ "$FAILURES" == 0 ]]
