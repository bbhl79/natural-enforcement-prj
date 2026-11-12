#!/usr/bin/env bash
# 用途：读写通道用例：testdata 与校验器经 tar 送进容器，结果经 tar 取回宿主。
# E6 后半：e2e 读写通道用例——testdata 只读送进容器、results 从容器取回宿主。
# 只测外部可观察行为：fixture 可读且内容一致（读通道）；结果产物落宿主产物目录且内容正确（写通道）。
# 区分纪律：e2e/testdata/ 入库存测试 fixture；e2e/results/（或 --run-id 的 e2e/results/<id>/）是运行产物，gitignore。
# 传输方式：读通道与校验器经标准输入以 tar 送入容器，写通道由容器把 /results 以 tar 写到标准输出，
# 宿主解包。不用 -v 绑定宿主目录：Podman machine 看不见 WSL home 下的 bind-mount（容器内是空目录），
# 与 dev 的 seed_repo_to_stdin、证据抽回同一做法。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
RESULTS="${E2E_RESULTS:-$ROOT/e2e/results}"
mkdir -p "$RESULTS"

# 工具链镜像唯一依据 infra/VERSIONS.md（与 dev 脚本 LINT_IMAGE 同源，从 dev 脚本取引用避免第二来源）
LINT_IMAGE="$(grep -m1 "^LINT_IMAGE=" "$ROOT/dev" | cut -d"'" -f2)"

echo "[e2e] 读写通道：起容器（testdata 与校验器经 tar 送入，results 经 tar 取回）…"
# 送入：校验器放 /repo，fixture 放 /testdata（读通道，容器内 chmod 去写权限以保持只读语义）。
# 取回：校验器把结果写 /results（写通道），容器把 /results 打成 tar 输出，宿主解到 $RESULTS。
# ustar：工具链镜像是 alpine BusyBox tar，吃不下 GNU 默认 pax。
tar -C "$ROOT" --format=ustar -cf - e2e/cases/_lib-readwrite-check.cjs e2e/testdata \
  | docker run --rm --pull=never -i "$LINT_IMAGE" sh -c '
      set -e
      mkdir -p /repo /testdata /results
      tar -x -f - -C /repo
      cp -R /repo/e2e/testdata/. /testdata/
      chmod -R a-w /testdata
      node /repo/e2e/cases/_lib-readwrite-check.cjs >&2
      tar -c -f - -C /results .' \
  | tar -x -f - -C "$RESULTS"

echo "[e2e] 宿主断言：结果产物已写回 $RESULTS/readwrite-channel.json …"
[ -f "$RESULTS/readwrite-channel.json" ] || { echo "[FAIL] 结果产物缺失（写通道不通）" >&2; exit 1; }
grep -q '"readChannel": "ok"' "$RESULTS/readwrite-channel.json" \
  || { echo "[FAIL] 结果产物内容不符（读通道未确认）" >&2; exit 1; }
grep -q '"writeChannel": "ok"' "$RESULTS/readwrite-channel.json" \
  || { echo "[FAIL] 结果产物内容不符（写通道未确认）" >&2; exit 1; }
grep -q '读写通道 fixture' "$ROOT/e2e/testdata/channel-fixture.json" \
  || { echo "[FAIL] fixture 内容不符" >&2; exit 1; }
echo "[e2e] 读写通道用例通过：testdata 进、results 出，挂载形态正确。"
