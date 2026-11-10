#!/usr/bin/env bash
# B级证据：登录→两次完整登记→正式命中待决定→实点派出→实点派机构。
set -euo pipefail
ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/../../../.." && pwd)"
if [[ "${HEADED:-0}" == 1 || "${PW_HEADED:-0}" == 1 || "$*" == *--headed* ]]; then
  echo '本旅程仅允许headless' >&2; exit 2
fi
RUN="${VERIFY_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-full-loop}"
export VERIFY_MOBILE=13800001004
export UI_SCENARIO_ID=vf-sc-verify-loop-ui-full-register-click-write
export HEADED=0 PW_HEADED=0
VERIFY_RUN_ID="${RUN}-register" UI_SUBMIT=1 bash "$ROOT/e2e/verify/harness/ui/run-ui-p0.sh"
CLUE_ID="$(python3 - "$ROOT/e2e/results/verify-${RUN}-register/summary.json" <<'PY'
import json,sys
s=json.load(open(sys.argv[1]))
assert s['status']=='passed' and s['registration']['status']=='pending_decision'
print(s['registration']['id'])
PY
)"
export CLUE_ID
VERIFY_RUN_ID="${RUN}-dispatch" EXPECT_STATUS=pending_decision UI_CLICK_WRITE=1 bash "$ROOT/e2e/verify/harness/ui/run-ui-verify-dispatch.sh"
