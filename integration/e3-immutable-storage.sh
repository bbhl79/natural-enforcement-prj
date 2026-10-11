#!/usr/bin/env bash
# E3 不可变必失败用例（#53）：写文件版本 → 原地改写/删除尝试 → 必须被拒或产生新世代。
# 驱动真实 RustFS（临时实例，不写入项目 rustfs-data 卷）；
# 红绿对照判别轴 = 原版本（versionId 寻址）是否无损，区分「校验缺失」与「校验拒绝」。
# 用例只测外部可观察行为（退出码 + 人类可读输出）；驱动本体 =
# packages/storage/src/e3-driver.ts（node 原生 type-stripping，零第三方依赖）。
# 约定见 integration/README.md。退出码只有 0/1。
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# 与 dev 脚本同一项目名解析：默认 natural-enforcement，并行工作区用 COMPOSE_PROJECT_NAME 隔离
PROJECT="${COMPOSE_PROJECT_NAME:-natural-enforcement}"
# lint 工具链镜像与 dev 单一来源一致（infra/VERSIONS.md 钉定），不重复硬编码
LINT_IMAGE="$(sed -n "s/^LINT_IMAGE='\(.*\)'.*/\1/p" "$ROOT/dev")"

# 临时 RustFS：独立网络 + 独立数据卷，不碰项目的 rustfs-data 卷。
# 不用 tmpfs：镜像里的服务进程对 /data 没有写权限（Permission denied），命名卷则与 compose 相同可用。
# COMPLIANCE 对象删不掉，所以自清理 = 销毁临时容器和它的数据卷。
RUSTFS_IMAGE="$(sed -n '/^  rustfs:/,/^  [a-z]/p' "$ROOT/infra/docker-compose.yml" | awk '/image:/{print $2; exit}')"
RUSTFS_ENDPOINT='http://rustfs:9000'
RUSTFS_ACCESS_KEY='rustfsdev'
RUSTFS_SECRET_KEY='rustfsdev-secret'
E3_BUCKET="ne-e3-$(echo "$PROJECT" | tr '[:upper:]' '[:lower:]')"
E3_RUN_ID="$(date +%Y%m%d%H%M%S)"
E3_NET="${PROJECT}-e3-$$"
E3_VOL="${PROJECT}-e3-data-$$"
E3_RUSTFS="${PROJECT}-e3-rustfs-$$"

fail() { echo "[失败] $1" >&2; exit 1; }

cleanup() {
  docker rm -f "$E3_RUSTFS" >/dev/null 2>&1 || true
  docker volume rm -f "$E3_VOL" >/dev/null 2>&1 || true
  docker network rm "$E3_NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# ---------- 0. 临时 RustFS（镜像缺失按 dev build 契约报错，不隐式拉取） ----------
if [ -z "$RUSTFS_IMAGE" ] || ! docker image inspect "$RUSTFS_IMAGE" >/dev/null 2>&1; then
  fail "rustfs 镜像缺失：${RUSTFS_IMAGE:-未从 compose 解析到}。请先执行 dev build。"
fi
if ! docker image inspect "$LINT_IMAGE" >/dev/null 2>&1; then
  fail "工具链镜像缺失：$LINT_IMAGE。请先执行 dev build。"
fi
docker network create "$E3_NET" >/dev/null
docker volume create "$E3_VOL" >/dev/null
docker run -d --name "$E3_RUSTFS" --network "$E3_NET" --network-alias rustfs \
  --pull=never \
  -e RUSTFS_ACCESS_KEY="$RUSTFS_ACCESS_KEY" \
  -e RUSTFS_SECRET_KEY="$RUSTFS_SECRET_KEY" \
  -v "$E3_VOL:/data" \
  "$RUSTFS_IMAGE" >/dev/null \
  || fail "临时 RustFS 启动失败"

# ---------- 1. 就绪等待：临时网络内探 rustfs:9000，最多 60 秒 ----------
ready=1
for attempt in $(seq 1 30); do
  code="$(docker run --rm --pull=never --network "$E3_NET" "$LINT_IMAGE" \
    node -e "fetch('${RUSTFS_ENDPOINT}/').then(r=>process.exit(0)).catch(()=>process.exit(1))" \
    >/dev/null 2>&1 && echo ok || echo no)"
  if [ "$code" = "ok" ]; then ready=0; break; fi
  sleep 2
done
[ "$ready" -eq 0 ] || fail "rustfs:9000 就绪等待超时（60s）"

# ---------- 2. 运行 E3 驱动（临时网络内访问 rustfs:9000） ----------
driver_rc=0
docker run --rm --pull=never \
  --network "$E3_NET" \
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

# ---------- 3. 自清理：trap 销毁临时容器和网络（项目卷不参与） ----------
[ "$driver_rc" -eq 0 ] || fail "E3 驱动非 0 退出（rc=$driver_rc），输出见上方"
echo "[通过] E3 不可变必失败用例整体通过（临时实例，桶 ${E3_BUCKET}，run=${E3_RUN_ID}）"
exit 0
