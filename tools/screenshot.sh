#!/usr/bin/env bash
# 截图工具（#220 出图路径；镜像定案见 infra/VERSIONS.md「浏览器」行与执行纪律 4）。
#
# 用法：tools/screenshot.sh <目标地址> <输出 PNG 路径> [视口宽] [视口高]
#   例：tools/screenshot.sh https://localhost:8080/workbench /tmp/out/shot.png 1440 900
#
# 纪律：
#   - 镜像引用唯一依据 infra/VERSIONS.md，tag + digest 钉死，严禁 latest、严禁换非定案镜像。
#   - 拉取只发生在 dev build 语义内（US13）。本脚本不隐式拉取：镜像不在场即报错并指路 dev build。
#   - 不传 --no-sandbox、不加 --cap-add、不共享宿主 IPC：该镜像的 Chromium 自带沙箱在本机可直接跑。
#   - 出图在容器内完成，产物写回宿主目录（只挂一个输出目录，不挂仓库）。
set -euo pipefail

ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"

# 唯一依据：infra/VERSIONS.md「浏览器」行的钉定引用。
BROWSER_IMAGE='mcr.microsoft.com/playwright:v1.64.1-jammy-amd64@sha256:5eb4ef2b80d9c5af9dccb9155b29be324461c8bbaed41b989db5e86545e7fd38'

usage() {
  cat <<'EOF'
用法：tools/screenshot.sh <目标地址> <输出 PNG 路径> [视口宽] [视口高]

例：
  tools/screenshot.sh https://localhost:8080/workbench /tmp/shots/wb.png 1440 900

视口宽高缺省 1440×900（与 docs/screens 既有截图同尺寸）。
EOF
}

case "${1:-}" in
  -h|--help|help|"") usage; [ -n "${1:-}" ] || exit 1; exit 0 ;;
esac

TARGET="${1:?缺少目标地址}"
OUTPUT="${2:?缺少输出 PNG 路径}"
WIDTH="${3:-1440}"
HEIGHT="${4:-900}"
# 渲染等待（毫秒）。前端是单页应用，路由与取数要一拍，默认给 2 秒。
WAIT_MS="${5:-2000}"

# 定案核对：镜像引用必须先登记再使用（同 dev 的 require_image_registered 纪律）。
if ! grep -qF "$BROWSER_IMAGE" "$ROOT/infra/VERSIONS.md"; then
  echo "[FAIL] 浏览器镜像未按定案登记于 infra/VERSIONS.md：$BROWSER_IMAGE" >&2
  exit 1
fi

if ! docker image inspect "$BROWSER_IMAGE" >/dev/null 2>&1; then
  echo "[FAIL] 浏览器镜像不在场：$BROWSER_IMAGE" >&2
  echo "  拉取只发生在 dev build 语义内，请先运行：dev build" >&2
  exit 1
fi

OUT_DIR="$(cd "$(dirname "$OUTPUT")" && pwd)"
OUT_NAME="$(basename "$OUTPUT")"
mkdir -p "$OUT_DIR"

# 目标地址要能从容器内访问。宿主上的 https://localhost:8080 在容器内不是本机，
# 故容器一律经宿主网络访问（compose 网络名不适用于一次性容器）。
HOST_PORT="${NE_PAGE_PORT:-8080}"
URL="$TARGET"
case "$URL" in
  https://localhost:*|http://localhost:*)
    URL="${URL/localhost/host.docker.internal}"
    ;;
esac

echo "截图：$URL → $OUTPUT（视口 ${WIDTH}×${HEIGHT}，容器内 Chromium 自带沙箱）"
docker run --rm \
  --add-host "host.docker.internal:host-gateway" \
  -v "$OUT_DIR:/out" \
  "$BROWSER_IMAGE" \
  npx playwright screenshot \
    --viewport-size="${WIDTH},${HEIGHT}" \
    --full-page \
    --ignore-https-errors \
    --wait-for-timeout="$WAIT_MS" \
    "$URL" "/out/$OUT_NAME"

echo "截图完成：$OUTPUT"
