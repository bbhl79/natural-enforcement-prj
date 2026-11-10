#!/usr/bin/env bash
# UI 全链：登录 → 两次完整登记 → 正式命中待决定 → 实点派出 → 实点派机构。
# 在 Playwright 镜像容器里运行（e2e/cases/09-verify-ui.sh 调用），不依赖宿主 node、
# /mnt/c 中转、host.docker.internal。容器走宿主网络，BASE_URL 是 https://localhost:<端口>。
#
# 输入（环境变量，由调用方设置）：
#   BASE_URL            入口地址
#   VERIFY_RUN_ID       跑次号。两段证据目录是 verify-<号>-register 与 verify-<号>-dispatch
#   EVIDENCE_ROOT       证据根目录，默认 /work/e2e/results
# 工作目录是 /work，里面有 e2e/verify/harness 与 e2e/verify/fixtures。
#
# 口令：登记段用种子口令首登并被强制改密，改成 VERIFY_NEW_PASSWORD。
# 派出段再登录同一个人时，种子口令已失效，所以显式传入新口令。
# 现有的 run-ui-full-loop.sh 没有传，它在已改过密的库上会被拒。
set -euo pipefail

HARNESS=/work/e2e/verify/harness
RUN="${VERIFY_RUN_ID:?缺少 VERIFY_RUN_ID}"
EVIDENCE_ROOT="${EVIDENCE_ROOT:-/work/e2e/results}"
NEW_PASSWORD="${VERIFY_NEW_PASSWORD:-Verify-skill-loop-52!}"
JOURNEY=/work/e2e/verify/fixtures/journeys/register-full-click-write/input.json
MOBILE="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).mobile)' "$JOURNEY")"

export PLAYWRIGHT_BROWSERS_PATH=/ms-playwright PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm_config_cache=/tmp/npm-cache
export HEADED=0 PW_HEADED=0 VERIFY_MOBILE="$MOBILE"
export UI_SCENARIO_ID=vf-sc-verify-loop-ui-full-register-click-write

# 驱动是 CommonJS 脚本，用 NODE_PATH 找到临时目录里安装的 playwright，不污染 /work。
tool_dir="$(mktemp -d)"
(cd "$tool_dir" && npm init -y >/dev/null 2>&1 && npm install --no-fund --no-audit playwright@1.64.1 >&2)
export NODE_PATH="$tool_dir/node_modules"

# 第一段：登记两条重合矿产面，目标必须进入待分派决定。
reg_dir="$EVIDENCE_ROOT/verify-${RUN}-register"
mkdir -p "$reg_dir"
cp "$JOURNEY" "$reg_dir/register-full-input.json"
cp "$HARNESS/ui/register-full.cjs" "$reg_dir/register-full.cjs"
cp "$HARNESS/auth-gate.cjs" "$reg_dir/auth-gate.cjs"
cp "$HARNESS/ui/run-ui-p0.cjs" "$reg_dir/run-ui-p0.cjs"
reg_rc=0
(cd "$reg_dir" && EVIDENCE_DIR="$reg_dir" UI_SUBMIT=1 node run-ui-p0.cjs >&2) || reg_rc=$?

clue_id="$(node -e '
const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
if (s.status !== "passed" || s.registration?.status !== "pending_decision") process.exit(3);
process.stdout.write(s.registration.id);
' "$reg_dir/summary.json")" || {
  echo "[full-loop] 登记段未得到 pending_decision（登记段退出码 ${reg_rc}），不进入派出段。" >&2
  exit 1
}

# 第二段：点击派出，再点击派机构。
dsp_dir="$EVIDENCE_ROOT/verify-${RUN}-dispatch"
mkdir -p "$dsp_dir"
cp "$HARNESS/ui/run-ui-verify-dispatch.cjs" "$dsp_dir/run-ui-verify-dispatch.cjs"
cp "$HARNESS/auth-gate.cjs" "$dsp_dir/auth-gate.cjs"
(cd "$dsp_dir" && EVIDENCE_DIR="$dsp_dir" CLUE_ID="$clue_id" EXPECT_STATUS=pending_decision \
  UI_CLICK_WRITE=1 VERIFY_LOGIN_PASSWORD="$NEW_PASSWORD" node run-ui-verify-dispatch.cjs >&2)

# 两段的清理：草稿副本不进证据
rm -f "$reg_dir/register-full.cjs" "$reg_dir/auth-gate.cjs" "$reg_dir/run-ui-p0.cjs" \
  "$dsp_dir/run-ui-verify-dispatch.cjs" "$dsp_dir/auth-gate.cjs"
echo "[full-loop] 登记段与派出段均通过。clue=${clue_id}" >&2
