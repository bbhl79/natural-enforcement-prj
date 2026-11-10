#!/usr/bin/env bash
# 验证资产的 UI 全链稳定用例：登录 → 两次完整登记 → 正式命中待决定 → 实点派出 → 实点派机构。
# 驱动是 e2e/verify/harness/ui 下的 Playwright 脚本，编排在 full-loop-in-container.sh。
# 浏览器在钉定的 Playwright 镜像里运行（infra/VERSIONS.md 登记），headless。
# 容器走宿主网络，访问地址是 https://localhost；资产经 tar 灌入、证据经 tar 取回，
# 不用 bind，不用 /mnt/c 中转，不用 host.docker.internal。
#
# 独立库（_lib-isolated-stack.sh）：每次新建，首登改密只发生一次，用例可重复跑。
#
# 浏览器镜像的前提（infra/VERSIONS.md 2026-10-25 定案：3.4GB，不进 dev build 的拉取清单，
# 本地拉一次长期复用）：
# - 镜像不在本地：打印明确的 SKIP 行与拉取命令，退出 0，不建库、不动 server。
#   干净的 CI runner 上默认走这条路，CI 不因此变慢。
# - 设 E2E_REQUIRE_BROWSER=1：镜像缺失改判红。用于要求本用例必须真跑的环境。
# - 镜像未在 VERSIONS.md 登记：恒判红，那是仓库配置错误，不是环境缺口。
# 容器内会 npm install playwright@1.64.1，需要能访问 npm 源。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEV="$ROOT/dev"
cd "$ROOT"

BROWSER_IMAGE='mcr.microsoft.com/playwright:v1.64.1-jammy-amd64@sha256:5eb4ef2b80d9c5af9dccb9155b29be324461c8bbaed41b989db5e86545e7fd38'
if ! grep -qF "$BROWSER_IMAGE" "$ROOT/infra/VERSIONS.md"; then
  echo "[FAIL] 浏览器镜像未在 infra/VERSIONS.md 登记：${BROWSER_IMAGE}" >&2
  exit 1
fi
if ! docker image inspect "$BROWSER_IMAGE" >/dev/null 2>&1; then
  if [ "${E2E_REQUIRE_BROWSER:-}" = "1" ]; then
    echo "[FAIL] 浏览器镜像不在本地（E2E_REQUIRE_BROWSER=1 要求必须真跑），先执行一次：docker pull ${BROWSER_IMAGE}" >&2
    exit 1
  fi
  echo "[e2e] 验证 UI：SKIP——浏览器镜像不在本地，本用例未执行，UI 全链这一轮没有被验证。"
  echo "[e2e] 验证 UI：拉取一次后自动生效：docker pull ${BROWSER_IMAGE}"
  echo "[e2e] 验证 UI：要求缺镜像即判红，设 E2E_REQUIRE_BROWSER=1。"
  exit 0
fi

ISO_LABEL="验证 UI"
ISO_DB="e2e_verify_ui"
ISO_TAG="ui"
RESULTS="${E2E_RESULTS:-$ROOT/e2e/results}"
RUN_ID="e2e-ui-$(date -u +%Y%m%dT%H%M%SZ)-$$"
# shellcheck source=e2e/cases/_lib-isolated-stack.sh
. "$ROOT/e2e/cases/_lib-isolated-stack.sh"

isolated_stack_up

mkdir -p "$RESULTS" "$work/seed/e2e/verify"
cp -R "$ROOT/e2e/verify/harness" "$ROOT/e2e/verify/fixtures" "$work/seed/e2e/verify/"
set +e
# 证据落容器内 /work/e2e/results，结束后整体 tar 回宿主产物目录；驱动日志走 stderr。
tar -C "$work/seed" --format=ustar -cf - . \
  | docker run --rm --pull=never -i --network host \
    -e BASE_URL="$BASE" \
    -e VERIFY_RUN_ID="$RUN_ID" \
    -w /work \
    "$BROWSER_IMAGE" \
    bash -c 'set -e; tar -xf - -C /work; mkdir -p /work/e2e/results; rc=0;
      bash e2e/verify/harness/ui/full-loop-in-container.sh || rc=$?;
      tar -C /work/e2e/results -cf - .; exit $rc' \
  | tar -x -f - -C "$RESULTS"
codes=("${PIPESTATUS[@]}")
set -e

[ "${codes[1]}" = "0" ] || fail "验证 UI 容器退出码 ${codes[1]}（证据 ${RESULTS}/verify-${RUN_ID}-*）"
verify_summary "$RESULTS/verify-${RUN_ID}-register" 0
verify_summary "$RESULTS/verify-${RUN_ID}-dispatch" 0
restore_server
echo "[e2e] 验证 UI 通过：两次完整登记命中待决定，点击派出与派机构均成功；证据 $RESULTS/verify-${RUN_ID}-*。"
