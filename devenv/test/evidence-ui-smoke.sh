#!/usr/bin/env bash
# #69 真实 UI 同源证据旅程（浏览器路径）：需先 `devenv up` + `devenv web`。
# 在 tools 容器内以 EVIDENCE_UI_BASE_URL=http://web:4173 渲染 EvidencePanel，
# 经 vite preview proxy（同源）完成 上传 → worker 处理 → 下载字节一致 → UI 展示；
# 测试输出记录 id，容器退出后按 id 自清理 DB 行与对象。
set -euo pipefail
cd "$(dirname "$0")/../.."

status="$(./devenv/devenv --json status 2>/dev/null || true)"
if ! printf '%s' "$status" | grep -q '"web_port":"[0-9]'; then
  echo "ERROR: web 未运行。先执行：devenv up && devenv web" >&2
  exit 3
fi

log="$(mktemp "${TMPDIR:-/tmp}/ne-evidence-ui.XXXXXX")"
trap 'rm -f "$log"' EXIT

rc=0
./devenv/devenv exec -- env EVIDENCE_UI_BASE_URL=http://web:4173 \
  pnpm --filter @ne/web exec vitest run test/evidence-ui-flow.spec.tsx \
  2>&1 | tee "$log" || rc=$?

id="$(sed -n 's/.*"recordId":"\([A-Za-z0-9-]*\)".*/\1/p' "$log" | tail -1)"
if [[ -n "$id" ]]; then
  ./devenv/devenv exec -- node --input-type=module -e '
import { PrismaService } from "./apps/api/dist/prisma/prisma.service.js"
import { StorageService } from "./apps/api/dist/storage/storage.service.js"
const id = process.argv[1]
const db = new PrismaService()
const storage = new StorageService()
try {
  await storage.delete(`evidence/${id}`).catch(() => undefined)
  await db.evidenceRecord.deleteMany({ where: { id } })
  console.log(JSON.stringify({ cleaned: id }))
} finally {
  await db.$disconnect()
}
' "$id" || rc=4
fi
exit "$rc"