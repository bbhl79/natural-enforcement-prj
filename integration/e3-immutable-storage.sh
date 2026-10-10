#!/usr/bin/env bash
# E3 不可变必失败用例（#53）：写文件版本 → 原地改写/删除尝试 → 必须被拒或产生新世代。
# 驱动真实 RustFS（compose 网络内 rustfs:9000，S3 兼容 API + 对象锁 WORM）；
# 红绿对照判别轴 = 原版本（versionId 寻址）是否无损，区分「校验缺失」与「校验拒绝」。
# 用例只测外部可观察行为（退出码 + 人类可读输出）；驱动本体 =
# packages/storage/src/e3-driver.ts（node 原生 type-stripping，零第三方依赖）。
# 约定见 integration/README.md。退出码只有 0/1。
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# 与 dev 脚本同一项目名解析：默认 natural-enforcement，并行工作区用 COMPOSE_PROJECT_NAME 隔离
PROJECT="${COMPOSE_PROJECT_NAME:-natural-enforcement}"
COMPOSE=(docker compose -p "$PROJECT" -f infra/docker-compose.yml)
# lint 工具链镜像与 dev 单一来源一致（infra/VERSIONS.md 钉定），不重复硬编码
LINT_IMAGE="$(sed -n "s/^LINT_IMAGE='\(.*\)'.*/\1/p" "$ROOT/dev")"

# 用例自带的 compose 网络内访问参数（与 infra/docker-compose.yml 的 env 一致）
RUSTFS_ENDPOINT='http://rustfs:9000'
RUSTFS_ACCESS_KEY='rustfsdev'
RUSTFS_SECRET_KEY='rustfsdev-secret'
E3_BUCKET="ne-e3-$(echo "$PROJECT" | tr '[:upper:]' '[:lower:]')"
E3_RUN_ID="$(date +%Y%m%d%H%M%S)"
DRIVER_CONTAINER="ne-e3-driver"

fail() { echo "[失败] $1" >&2; exit 1; }

# ---------- 0. rustfs 在场（缺则幂等拉起；镜像缺失按 dev up 契约报错） ----------
rustfs_running_before=0
if [ -n "$("${COMPOSE[@]}" ps -q rustfs 2>/dev/null)" ]; then
  rustfs_running_before=1
fi
"${COMPOSE[@]}" up -d rustfs >/tmp/e3-rustfs-up.log 2>&1 \
  || fail "rustfs 拉起失败（镜像缺失请先 dev build；详见 /tmp/e3-rustfs-up.log）"

# ---------- 1. 就绪等待：compose 网络内探 rustfs:9000，最多 60 秒 ----------
ready=1
for attempt in $(seq 1 30); do
  code="$(docker run --rm --network "${PROJECT}_default" "$LINT_IMAGE" \
    node -e "fetch('${RUSTFS_ENDPOINT}/').then(r=>process.exit(0)).catch(()=>process.exit(1))" \
    >/dev/null 2>&1 && echo ok || echo no)"
  if [ "$code" = "ok" ]; then ready=0; break; fi
  sleep 2
done
[ "$ready" -eq 0 ] || fail "rustfs:9000 就绪等待超时（60s）"

# ---------- 2. 运行 E3 驱动（compose 网络内访问 rustfs:9000） ----------
driver_rc=0
docker run --rm --name "$DRIVER_CONTAINER" \
  --network "${PROJECT}_default" \
  -e RUSTFS_ENDPOINT="$RUSTFS_ENDPOINT" \
  -e RUSTFS_ACCESS_KEY="$RUSTFS_ACCESS_KEY" \
  -e RUSTFS_SECRET_KEY="$RUSTFS_SECRET_KEY" \
  -e RUSTFS_REGION='us-east-1' \
  -e E3_BUCKET="$E3_BUCKET" \
  -e E3_RUN_ID="$E3_RUN_ID" \
  -v "$ROOT:/repo:ro" \
  -w /repo \
  "$LINT_IMAGE" \
  node packages/storage/src/e3-driver.ts || driver_rc=$?

# ---------- 3. 自清理：恢复到用例启动前状态（只停容器，绝不删数据卷） ----------
if [ "$rustfs_running_before" -eq 0 ]; then
  "${COMPOSE[@]}" stop rustfs >/dev/null 2>&1 || true
fi

[ "$driver_rc" -eq 0 ] || fail "E3 驱动非 0 退出（rc=$driver_rc），输出见上方"
echo "[通过] E3 不可变必失败用例整体通过（桶 ${E3_BUCKET}，run=${E3_RUN_ID}）"
exit 0
