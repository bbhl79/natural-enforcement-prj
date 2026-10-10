#!/usr/bin/env bash
# E6 后半：e2e 读写通道用例——testdata 显式只读挂载进容器、results 显式读写挂载出容器。
# 只测外部可观察行为：fixture 可读且内容一致（读通道）；结果产物落宿主产物目录且内容正确（写通道）。
# 区分纪律：e2e/testdata/ 入库存测试 fixture；e2e/results/（或 --run-id 的 .run/<id>/results）是运行产物，gitignore。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
RESULTS="${E2E_RESULTS:-$ROOT/e2e/results}"
mkdir -p "$RESULTS"

# 工具链镜像唯一依据 infra/VERSIONS.md（与 dev 脚本 LINT_IMAGE 同源，从 dev 脚本取引用避免第二来源）
LINT_IMAGE="$(grep -m1 "^LINT_IMAGE=" "$ROOT/dev" | cut -d"'" -f2)"

echo "[e2e] 读写通道：起容器（testdata 只读挂载、results 读写挂载）…"
# 仓库只读挂载提供校验器脚本；fixture 走 /testdata 只读挂载（读通道），
# 结果写 /results（写通道）——两条显式读写通道各自独立可验。
docker run --rm \
  -v "$ROOT:/repo:ro" \
  -v "$ROOT/e2e/testdata:/testdata:ro" \
  -v "$RESULTS:/results" \
  "$LINT_IMAGE" \
  node /repo/e2e/cases/_lib-readwrite-check.cjs

echo "[e2e] 宿主断言：结果产物已写回 $RESULTS/readwrite-channel.json …"
[ -f "$RESULTS/readwrite-channel.json" ] || { echo "[FAIL] 结果产物缺失（写通道不通）" >&2; exit 1; }
grep -q '"readChannel": "ok"' "$RESULTS/readwrite-channel.json" \
  || { echo "[FAIL] 结果产物内容不符（读通道未确认）" >&2; exit 1; }
grep -q '"writeChannel": "ok"' "$RESULTS/readwrite-channel.json" \
  || { echo "[FAIL] 结果产物内容不符（写通道未确认）" >&2; exit 1; }
grep -q '读写通道 fixture' "$ROOT/e2e/testdata/channel-fixture.json" \
  || { echo "[FAIL] fixture 内容不符" >&2; exit 1; }
echo "[e2e] 读写通道用例通过：testdata 进、results 出，挂载形态正确。"
