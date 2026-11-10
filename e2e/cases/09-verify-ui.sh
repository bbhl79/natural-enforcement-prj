#!/usr/bin/env bash
# 验证资产的 UI 全链稳定用例：登录 → 两次完整登记 → 正式命中待决定 → 实点派出 → 实点派机构。
# 驱动是 e2e/verify/harness/ui 下的 Playwright 脚本，编排在 full-loop-in-container.sh。
# 浏览器在钉定的 Playwright 镜像里运行（infra/VERSIONS.md 登记），headless。
# 容器走宿主网络，访问地址是 https://localhost；资产经 tar 灌入、证据经 tar 取回，
# 不用 bind，不用 /mnt/c 中转，不用 host.docker.internal。
#
# 独立库（_lib-isolated-stack.sh）：每次新建，首登改密只发生一次，用例可重复跑。
# 前提：Playwright 镜像已在本地（dev 不拉它）。缺失时判红并给出拉取命令，不静默跳过。
# 容器内会 npm install playwright@1.64.1，需要能访问 npm 源。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEV="$ROOT/dev"
cd "$ROOT"

ISO_LABEL="验证 UI"
ISO_DB="e2e_verify_ui"
ISO_TAG="ui"
RESULTS="${E2E_RESULTS:-$ROOT/e2e/results}"
RUN_ID="e2e-ui-$(date -u +%Y%m%dT%H%M%SZ)-$$"
BROWSER_IMAGE='mcr.microsoft.com/playwright:v1.64.1-jammy-amd64@sha256:5eb4ef2b80d9c5af9dccb9155b29be324461c8bbaed41b989db5e86545e7fd38'
# shellcheck source=e2e/cases/_lib-isolated-stack.sh
. "$ROOT/e2e/cases/_lib-isolated-stack.sh"

grep -qF "$BROWSER_IMAGE" "$ROOT/infra/VERSIONS.md" \
  || fail "浏览器镜像未在 infra/VERSIONS.md 登记：${BROWSER_IMAGE}"
docker image inspect "$BROWSER_IMAGE" >/dev/null 2>&1 \
  || fail "浏览器镜像不在本地，先执行一次：docker pull ${BROWSER_IMAGE}"

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
