#!/usr/bin/env bash
# 验证资产的 API 稳定用例：在独立库上经 nginx 跑 e2e/verify 的 API scenario 与负例。
# 场景清单在 e2e/verify/harness/suites.ts 的 API_SUITE，判据是各 scenario 的 oracle。
# 驱动在工具链容器里运行（不用宿主 node），容器走宿主网络，访问地址仍是 https://localhost。
#
# 独立库（_lib-isolated-stack.sh，与 07-day-one.sh 同一手法）：迁移 → 开发种子 →
# server 临时指向该库 → 用例结束恢复并清库。独立库带来两个稳定性质：
# - 不依赖用例执行顺序。e2e 层前面的用例改过谁的口令，都不影响本用例。
# - 可重复跑。每次新建库，种子口令一致，首登改密只发生一次。
#
# 只增不改：经管理台接口种入三名内勤（已存在视为完成），登记若干线索。开发库不受影响。
# 证据：产物目录下的 verify-<runId>/（summary / steps / evidence）。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEV="$ROOT/dev"
cd "$ROOT"

ISO_LABEL="验证 API"
ISO_DB="e2e_verify_api"
ISO_TAG="api"
RESULTS="${E2E_RESULTS:-$ROOT/e2e/results}"
RUN_ID="e2e-$(date -u +%Y%m%dT%H%M%SZ)-$$"
# shellcheck source=e2e/cases/_lib-isolated-stack.sh
. "$ROOT/e2e/cases/_lib-isolated-stack.sh"

isolated_stack_up

# 灌入驱动所需的源码与夹具（tar 经 stdin，与 dev 灌源同理：WSL bind 只见残缺视图）；
# 证据从容器 tar 回宿主产物目录。stdout 只留给证据 tar，驱动日志走 stderr。
mkdir -p "$RESULTS" "$work/seed/e2e/verify"
cp -R "$ROOT/e2e/verify/harness" "$ROOT/e2e/verify/fixtures" "$work/seed/e2e/verify/"
cp "$CERT" "$work/seed/$(basename "$CERT")"
set +e
# 一个归档灌入：工具链镜像是 BusyBox tar，不支持 -i 拼接多段归档。
tar -C "$work/seed" --format=ustar -cf - . \
  | docker run --rm --pull=never -i --network host \
    -e VERIFY_BASE_URL="$BASE" \
    -e VERIFY_RUN_ID="$RUN_ID" \
    -e VERIFY_SPATIAL_SALT="$RUN_ID" \
    -e NODE_EXTRA_CA_CERTS="/work/$(basename "$CERT")" \
    -w /work \
    "$TOOLCHAIN_IMAGE" \
    sh -c 'set -e; tar -xf - -C /work; rc=0;
      node --experimental-transform-types --disable-warning=ExperimentalWarning \
        e2e/verify/harness/run-api-suite.ts >&2 || rc=$?;
      tar -C /work/e2e/results -cf - .; exit $rc' \
    | tar -x -f - -C "$RESULTS"
codes=("${PIPESTATUS[@]}")
set -e

verify_summary "$RESULTS/verify-${RUN_ID}" "${codes[1]}"
restore_server
echo "[e2e] 验证 API 通过：API 场景与负例按各自 oracle 全绿；证据 $RESULTS/verify-${RUN_ID}。"
