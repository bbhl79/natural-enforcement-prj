#!/usr/bin/env bash
# ============================================================================
# e2e 生命周期决策引擎编排离线测试（#106）——不访问真实引擎（docker 全部 mock）
#
# 覆盖（Spec-e2e §3 事实源分层 / §4 缺陷报告 schema / §10 命令面与退出码）：
#   1. `devenv e2e defect list|show`：--json 终值可解析；未知 ID / 非法记录 exit 10
#   2. 宿主树经 stdin tar 只读进容器（查询命令零落盘）
#   3. op 行协议（W/D/V/END）宿主侧原子应用：多项 W/D 全应用；
#      V 判定不符 → exit 9 零落盘；END error → 透传码零落盘；拒绝原因透出
#   4. 原型坑收口：set -e 不吞 END 诊断（先捕获 rc 再判协议）；无 END 的崩溃 → 4
#   5. 注册表 = 派生缓存：始终重建、漂移仅 WARN 不硬门禁、不入库（gitignore）
#   6. 取号：本地 max+1；远端叠读 best-effort（失败回退本地 + WARN）
#   7. 生命周期写锁 per-worktree（mkdir 基，非 flock）：冲突 exit 6 零落盘
#   8. 用法错误 exit 2；op 路径越界拒绝；应用中途失败全量还原
#
# 接缝：命令面（devenv e2e defect/registry）+ 宿主桥函数（e2e_lifecycle_write，
# 用 fixture 子命令驱动 V/END/崩溃/越界/回滚等协议边界；真实引擎由 apps/e2e
# vitest 单测覆盖，容器侧 mock 只复刻协议字节格式）。
# ============================================================================
set -Eeuo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TEST_DIR/../.." && pwd)"

FAILURES=0
PASS_COUNT=0
pass() { printf 'PASS: %s\n' "$1"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { printf 'FAIL: %s —— %s\n' "$1" "$2"; FAILURES=$((FAILURES + 1)); }

SANDBOX=$(mktemp -d /tmp/devenv-e2e-lifecycle.XXXXXX)
trap 'rm -rf "$SANDBOX"' EXIT
echo "沙箱：$SANDBOX"

# ---------------------------------------------------------------------------
# 最小仓库（真实 devenv 库 + 真实 .gitignore + e2e 事实源树）+ mock docker
# ---------------------------------------------------------------------------
MINI="$SANDBOX/mini"
mkdir -p "$MINI"
cp -r "$REPO_ROOT/devenv" "$MINI/devenv"
mkdir -p "$MINI/apps/api" "$MINI/apps/web" "$MINI/apps/e2e/defects" \
         "$MINI/apps/e2e/replay" "$MINI/apps/e2e/tests/repro" \
         "$MINI/packages/contracts" "$MINI/packages/tsconfig"
cp "$REPO_ROOT/.gitignore" "$MINI/.gitignore"
cp "$REPO_ROOT/package.json" "$MINI/package.json"
cp "$REPO_ROOT/pnpm-lock.yaml" "$MINI/pnpm-lock.yaml"
cp "$REPO_ROOT/pnpm-workspace.yaml" "$MINI/pnpm-workspace.yaml"
cp "$REPO_ROOT/apps/api/package.json" "$MINI/apps/api/package.json"
cp "$REPO_ROOT/apps/web/package.json" "$MINI/apps/web/package.json"
cp "$REPO_ROOT/apps/e2e/package.json" "$MINI/apps/e2e/package.json"
cp "$REPO_ROOT/packages/contracts/package.json" "$MINI/packages/contracts/package.json"
cp "$REPO_ROOT/packages/tsconfig/package.json" "$MINI/packages/tsconfig/package.json"
printf '{"compilerOptions":{}}\n' > "$MINI/packages/tsconfig/tsconfig.json"

# 事实源夹具（临时树，非入库缺陷记录）：两条 reported + replay 脚本在场
cat > "$MINI/apps/e2e/defects/DEF-0001.json" <<'JSON'
{"schemaVersion":1,"id":"DEF-0001","title":"点位名称接受 NUL","summary":"契约内输入引发 500",
 "status":"reported","engine":"fast-check","layer":"api","discoveredAt":"2026-11-28T00:00:00Z",
 "discoveredBy":"offline","charter":"创建点位输入空间全量安全","suspectedArea":"packages/contracts",
 "severity":"medium","reproducibility":{"kind":"external-state","replayCommand":"node apps/e2e/replay/DEF-0001.mjs",
 "counterexample":{"property":"契约内输入不应引发服务器错误","request":{"method":"POST","path":"/enforcement-points","body":{"name":"a\u0000b"}}},
 "gate":{"attempts":1,"keySpaces":["rep-offline-1"],"allFailed":true}},
 "evidence":[{"type":"json-report","uri":".artifacts/e2e/exp-offline/results.json"}],"sanitized":true}
JSON
cat > "$MINI/apps/e2e/defects/DEF-0002.json" <<'JSON'
{"schemaVersion":1,"id":"DEF-0002","title":"纯空白名入库","summary":"spec 债务",
 "status":"reported","engine":"agent-session","layer":"api","discoveredAt":"2026-11-28T00:00:00Z",
 "discoveredBy":"offline","charter":"创建点位输入空间全量安全","suspectedArea":"packages/contracts",
 "severity":"low","reproducibility":{"kind":"external-state","replayCommand":"node apps/e2e/replay/DEF-0002.mjs",
 "gate":{"attempts":1,"keySpaces":["rep-offline-2"],"allFailed":true}},
 "evidence":[],"sanitized":true}
JSON
printf 'process.exit(0)\n' > "$MINI/apps/e2e/replay/DEF-0001.mjs"
printf 'process.exit(0)\n' > "$MINI/apps/e2e/replay/DEF-0002.mjs"
printf '// defect: DEF-0001\n' > "$MINI/apps/e2e/tests/repro/.gitkeep"

git -C "$MINI" init -q
git -C "$MINI" config user.email "offline@test"
git -C "$MINI" config user.name "offline"
git -C "$MINI" add -A
git -C "$MINI" commit -qm init

STATE="$SANDBOX/docker-state"
mkdir -p "$STATE/images" "$STATE/tags" "$SANDBOX/bin"

# ---------------------------------------------------------------------------
# 容器侧决策引擎的 mock（真实引擎由 apps/e2e vitest 单测覆盖）：
# 解 stdin tar → 按子命令发射 op 行协议 / 查询数据，与真实 CLI 同字节格式。
# ---------------------------------------------------------------------------
cat > "$SANDBOX/bin/fake-cli" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
ROOT="."
JSON=0
args=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --root) ROOT="$2"; shift 2 ;;
    --json) JSON=1; shift ;;
    *) args+=("$1"); shift ;;
  esac
done
sub="${args[0]:-}"
b64() { printf '%s' "$1" | openssl base64 -e -A; }
case "$sub" in
  defect)
    action="${args[1]:-}"
    if [[ "$action" == "list" ]]; then
      bad=""
      for f in "$ROOT"/defects/*.json; do
        [[ -e "$f" ]] || continue
        jq -e . "$f" >/dev/null 2>&1 || bad="$f"
      done
      if [[ -n "$bad" ]]; then
        printf 'END\terror\t10\tschema 不符：%s\n' "$bad"
        exit 10
      fi
      if (( JSON )); then
        if compgen -G "$ROOT/defects/*.json" >/dev/null; then jq -s '.' "$ROOT"/defects/*.json; else printf '[]\n'; fi
      else
        for f in "$ROOT"/defects/*.json; do
          [[ -e "$f" ]] || continue
          printf '%s  [%s]  %s\n' "$(jq -r .id "$f")" "$(jq -r .status "$f")" "$(jq -r .title "$f")"
        done
      fi
      exit 0
    fi
    if [[ "$action" == "show" ]]; then
      id="${args[2]:-}"
      f="$ROOT/defects/$id.json"
      if [[ ! -f "$f" ]]; then
        printf 'END\terror\t10\t缺陷不存在：%s（defects/ 下无对应 JSON）\n' "$id"
        exit 10
      fi
      if ! jq -e . "$f" >/dev/null 2>&1; then
        printf 'END\terror\t10\tschema 不符：defects/%s.json\n' "$id"
        exit 10
      fi
      if (( JSON )); then jq '.' "$f"; else
        printf '%s — %s\n' "$(jq -r .id "$f")" "$(jq -r .title "$f")"
        printf '  状态：%s｜引擎：%s\n' "$(jq -r .status "$f")" "$(jq -r .engine "$f")"
      fi
      exit 0
    fi
    printf 'END\terror\t2\t用法错误：defect <list|show|next-id>\n'; exit 2 ;;
  next-id)
    remote=0; localmax=0
    i=0
    while (( i < ${#args[@]} )); do
      if [[ "${args[$i]}" == "--remote-max" ]]; then remote="${args[$((i+1))]:-0}"; fi
      i=$((i+1))
    done
    for f in "$ROOT"/defects/DEF-*.json; do
      [[ -e "$f" ]] || continue
      n="$(basename "$f" .json)"; n="${n#DEF-}"; n=$((10#$n))
      (( n > localmax )) && localmax=$n
    done
    max=$localmax
    (( remote > max )) && max=$remote
    next="$(printf 'DEF-%04d' $((max + 1)))"
    if (( JSON )); then
      printf '{"id":"%s","localMax":%s,"remoteMax":%s}\n' "$next" "$localmax" "$remote"
    else
      printf '%s\n' "$next"
    fi
    exit 0 ;;
  registry)
    reg='{"defects":[]}'
    if compgen -G "$ROOT/defects/*.json" >/dev/null; then
      reg="$(jq -s '{defects: (map({id, status, engine, specPath: null}) | sort_by(.id))}' "$ROOT"/defects/*.json)"
    fi
    printf 'W\t.registry.json\t%s\n' "$(b64 "$reg")"
    printf 'END\tok\t0\t注册表已重建（%s 条）\n' "$(printf '%s' "$reg" | jq '.defects | length')"
    exit 0 ;;
  fixture-write)
    printf 'W\tdefects/DEF-0003.json\t%s\n' "$(b64 '{"id":"DEF-0003"}')"
    printf 'W\treplay/DEF-0001.mjs\t%s\n' "$(b64 'process.exit(0) // 覆盖')"
    printf 'D\ttests/repro/.gitkeep\n'
    printf 'END\tok\t0\t三项文件操作\n'
    exit 0 ;;
  fixture-v-mismatch)
    printf 'V\t0001\tfail\t%s\n' "$(b64 'test("x", () => { expect(1).toBe(1) })')"
    printf 'W\tdefects/DEF-0001.json\t%s\n' "$(b64 '{"id":"DEF-0001","status":"graduated"}')"
    printf 'END\tok\t0\t毕业落账\n'
    exit 0 ;;
  fixture-v-match)
    printf 'V\t0001\tfail\t%s\n' "$(b64 'test("x", () => { expect(1).toBe(2) })')"
    printf 'W\tdefects/DEF-0001.json\t%s\n' "$(b64 '{"id":"DEF-0001","status":"graduated"}')"
    printf 'END\tok\t0\t毕业落账\n'
    exit 0 ;;
  fixture-end-error)
    printf 'W\tdefects/DEF-0001.json\t%s\n' "$(b64 '{"id":"DEF-0001","status":"graduated"}')"
    printf 'END\terror\t8\t已是 graduated；重复毕业被拒\n'
    exit 8 ;;
  fixture-crash)
    printf 'W\tdefects/DEF-0001.json\t%s\n' "$(b64 'x')"
    exit 3 ;;
  fixture-bad-path)
    printf 'W\t../escape.txt\t%s\n' "$(b64 'x')"
    printf 'END\tok\t0\t越界\n'
    exit 0 ;;
  fixture-apply-fail)
    printf 'W\tdefects/DEF-0009.json\t%s\n' "$(b64 '{"id":"DEF-0009"}')"
    printf 'W\treplay/DEF-0001.mjs/child.json\t%s\n' "$(b64 'x')"
    printf 'END\tok\t0\t两项\n'
    exit 0 ;;
  replay-plan)
    # #108：重放计划（真实引擎由 apps/e2e vitest 覆盖；此处复刻协议字节格式）
    id="${args[1]:-}"
    if [[ -z "$id" ]]; then printf 'END\terror\t2\t用法错误：replay-plan <ID>\n'; exit 2; fi
    f="$ROOT/defects/$id.json"
    if [[ ! -f "$f" ]]; then
      printf 'END\terror\t10\t缺陷不存在：%s（defects/ 下无对应 JSON）\n' "$id"; exit 10
    fi
    if ! jq -e . "$f" >/dev/null 2>&1; then
      printf 'END\terror\t10\tschema 不符：defects/%s.json\n' "$id"; exit 10
    fi
    if [[ ! -f "$ROOT/replay/$id.mjs" ]]; then
      printf 'END\terror\t10\t复现脚本缺失：apps/e2e/replay/%s.mjs（脚本随记录入库，是长期重建依据）\n' "$id"; exit 10
    fi
    kind="$(jq -r '.reproducibility.kind' "$f")"
    att=1; [[ "$kind" == "external-state" ]] && att=3
    printf 'CMD\t%s\n' "$(jq -r '.reproducibility.replayCommand' "$f")"
    printf 'KIND\t%s\n' "$kind"
    printf 'ATTEMPTS\t%s\n' "$att"
    printf 'SCRIPT\treplay/%s.mjs\n' "$id"
    printf 'TITLE\t%s\n' "$(jq -r '.title' "$f")"
    printf 'END\tok\t0\t重放计划已输出（%s）\n' "$id"
    exit 0 ;;
  signature)
    # #108：签名引擎（载荷走 stdin，不是树 tar）。提取/比对真实逻辑由 apps/e2e
    # vitest 覆盖；此处只复刻协议字节格式 + 记录宿主送来的载荷（编排接缝断言）。
    action="${args[1]:-}"
    payload="$(cat)"
    printf '%s' "$payload" > "$MOCK_DOCKER_STATE/signature-payload.txt"
    if [[ "$action" == "extract" ]]; then
      src=""
      i=1
      while (( i < ${#args[@]} )); do
        if [[ "${args[$i]}" == "--source" ]]; then src="${args[$((i+1))]:-}"; fi
        i=$((i+1))
      done
      if [[ "$src" != "replay" && "$src" != "playwright" ]]; then
        printf 'END\terror\t2\t--source 需为 replay|playwright\n'; exit 2
      fi
      if [[ "$src" == "replay" ]]; then
        line="$(printf '%s\n' "$payload" | grep '^NE-E2E-SIGNATURE ' | tail -1 || true)"
        if [[ -n "$line" ]]; then
          body="${line#NE-E2E-SIGNATURE }"
          sig="$(printf '%s' "$body" | jq -c '{errorClass,assertionId,semanticMarkers:(.semanticMarkers|sort_by(.key))}')"
          outcome="$(printf '%s' "$body" | jq -r '.outcome // "unknown"')"
          printf '{"schemaVersion":1,"source":"replay","found":true,"signature":%s,"outcome":"%s"}\n' "$sig" "$outcome"
        else
          printf '{"schemaVersion":1,"source":"replay","found":false,"signature":null,"outcome":"unknown"}\n'
        fi
        printf 'END\tok\t0\treplay 签名提取\n'
        exit 0
      fi
      if ! printf '%s' "$payload" | jq -e '.suites' >/dev/null 2>&1; then
        printf 'END\terror\t2\tPlaywright 结果 JSON 非法（缺 suites 数组）\n'; exit 2
      fi
      printf '{"schemaVersion":1,"source":"playwright","failures":[],"stats":null}\n'
      printf 'END\tok\t0\tPlaywright 签名提取\n'
      exit 0
    fi
    if [[ "$action" == "compare" ]]; then
      if ! printf '%s' "$payload" | jq -e '.candidates' >/dev/null 2>&1; then
        printf 'END\terror\t2\t比对载荷需为 {baseline,candidates}\n'; exit 2
      fi
      printf '%s' "$payload" > "$MOCK_DOCKER_STATE/compare-payload.json"
      am="${MOCK_SIG_ALL_MATCHED:-true}"
      reason="matched"; [[ "$am" == "true" ]] || reason="semantic-markers-differ"
      # 复刻原语契约：基线或任一轮签名缺失 → 不得判同一失败（无证据不判通过）
      if printf '%s' "$payload" | jq -e '(.baseline == null) or (.candidates | any(. == null))' >/dev/null 2>&1; then
        am="false"; reason="missing-signature"
      fi
      n="$(printf '%s' "$payload" | jq '.candidates | length')"
      results="$(printf '%s' "$payload" | jq -c --arg am "$am" --arg reason "$reason" \
        '[.candidates | to_entries[] | {index:.key,matched:($am=="true"),reason:(if $am=="true" then "matched" else $reason end),differences:[]}]')"
      printf '{"schemaVersion":1,"allMatched":%s,"reason":"%s","results":%s}\n' "$am" "$reason" "$results"
      printf 'END\tok\t0\t签名比对：allMatched=%s（%s 轮）\n' "$am" "$n"
      exit 0
    fi
    printf 'END\terror\t2\t未知 signature 动作：%s\n' "$action"; exit 2 ;;
  report)
    # #109：report 三段式（真实判定由 apps/e2e vitest 覆盖；此处复刻协议字节格式，
    # 并按宿主送来的**实测轮次**做最小门禁判定，以驱动宿主编排的过/不过两条路径）
    action="${args[1]:-}"
    payload="$(cat)"
    printf '%s' "$payload" > "$MOCK_DOCKER_STATE/report-payload-$action.json"
    if [[ "$action" == "finding-from-results" ]]; then
      body="$(printf '%s' "$payload" | jq -r '[.. | objects | select(.name? == "property-finding") | .body][0] // empty')"
      if [[ -z "$body" ]]; then printf 'END\terror\t2\tresults.json 内无 property-finding 附件\n'; exit 2; fi
      printf 'FINDING\t%s\n' "$(printf '%s' "$body" | openssl base64 -d -A | jq -c .)"
      printf 'END\tok\t0\t属性发现已提取\n'
      exit 0
    fi
    if [[ "$action" == "plan" ]]; then
      localmax=0
      for f in "$ROOT"/defects/DEF-*.json; do
        [[ -e "$f" ]] || continue
        n="$(basename "$f" .json)"; n="${n#DEF-}"; n=$((10#$n))
        (( n > localmax )) && localmax=$n
      done
      remote="$(printf '%s' "$payload" | jq -r '.remoteMax // 0')"
      max=$localmax; (( remote > max )) && max=$remote
      id="${MOCK_REPORT_ID:-$(printf 'DEF-%04d' $((max + 1)))}"
      kind="$(printf '%s' "$payload" | jq -r '.finding.reproducibility.kind')"
      att=1; [[ "$kind" == "external-state" ]] && att=3
      printf 'ID\t%s\n' "$id"
      printf 'KIND\t%s\n' "$kind"
      printf 'ATTEMPTS\t%s\n' "$att"
      printf 'CMD\tnode apps/e2e/replay/%s.mjs\n' "$id"
      printf 'SCRIPT\treplay/%s.mjs\n' "$id"
      printf 'SCRIPT_B64\t%s\n' "$(b64 "$(printf '%s' "$payload" | jq -r '.finding.reproducibility.replayScript')")"
      printf 'TITLE\t%s\n' "$(printf '%s' "$payload" | jq -r '.finding.title')"
      printf 'PRECONDITION\t%s\n' "$(printf '%s' "$payload" | jq -r '.finding.reproducibility.precondition')"
      printf 'CONCURRENCY\t\n'
      printf 'END\tok\t0\treport 计划：%s\n' "$id"
      exit 0
    fi
    if [[ "$action" == "register" ]]; then
      id="$(printf '%s' "$payload" | jq -r '.id')"
      kind="$(printf '%s' "$payload" | jq -r '.finding.reproducibility.kind')"
      att=1; [[ "$kind" == "external-state" ]] && att=3
      n="$(printf '%s' "$payload" | jq '.gate.rounds | length')"
      reason="passed"; msg="门禁通过"
      if (( n < att )); then reason="insufficient-rounds"; msg="轮次不足 $n<$att"
      elif printf '%s' "$payload" | jq -e '.gate.rounds | any(.scriptExitCode != 0)' >/dev/null 2>&1; then
        reason="round-not-reproduced"; msg="某轮未复现"
      elif printf '%s' "$payload" | jq -e '.gate.rounds | any(.signature.errorClass == "unknown" or .signature.errorClass == "infrastructure")' >/dev/null 2>&1; then
        reason="unknown-error-class"; msg="证据不足档/基础设施档永不过门禁"
      elif printf '%s' "$payload" | jq -e '[.gate.rounds[].signature | tostring] | unique | length > 1' >/dev/null 2>&1; then
        reason="signature-mismatch"; msg="多轮签名不一致"
      fi
      verdict="$(printf '%s' "$payload" | jq -c --arg reason "$reason" --arg msg "$msg" --argjson att "$att" --argjson n "$n" \
        '{passed:($reason=="passed"),reason:$reason,message:$msg,attempts:$n,minAttempts:$att,
          keySpaces:[.gate.rounds[].runId],allFailed:($reason=="passed"),
          signatureMatched:(if $n>1 then ($reason=="passed") else null end),
          compareReason:(if $n>1 then $reason else "single-round-no-cross-check" end),
          baselineSignature:(.gate.rounds[0].signature // null),needsHumanJudgment:false,
          rounds:[.gate.rounds[] | {attempt,runId,keySpace,precondition,scriptExitCode,
            verdict:(if .scriptExitCode==0 then "reproduced" else "not-reproduced" end),signature,
            comparison:{matched:($reason=="passed"),reason:$reason,differences:[]}}]}')"
      printf 'GATE\t%s\n' "$verdict"
      if [[ "$reason" != "passed" ]]; then
        printf 'END\terror\t8\t门禁未过（%s）：%s\n' "$reason" "$msg"; exit 8
      fi
      if [[ -f "$ROOT/defects/$id.json" ]]; then
        printf 'END\terror\t8\t编号已被占用：%s\n' "$id"; exit 8
      fi
      rec="$(printf '%s' "$payload" | jq -c --arg id "$id" --argjson v "$verdict" \
        '{schemaVersion:1,id:$id,title:.finding.title,summary:.finding.summary,status:"reported",
          engine:(.finding.engine // "agent-session"),layer:.finding.layer,
          discoveredAt:(.finding.discoveredAt // .gate.measuredAt),discoveredBy:(.finding.discoveredBy // "offline"),
          charter:(.finding.charter // "point-input-safety"),suspectedArea:.finding.suspectedArea,
          severity:.finding.severity,
          reproducibility:{kind:.finding.reproducibility.kind,
            replayPath:("apps/e2e/replay/"+$id+".mjs"),replayCommand:("node apps/e2e/replay/"+$id+".mjs"),
            gate:{attempts:$v.attempts,keySpaces:$v.keySpaces,allFailed:$v.allFailed,
              signatureMatched:$v.signatureMatched,rounds:$v.rounds,
              precondition:.finding.reproducibility.precondition,
              baselineSignature:$v.baselineSignature,compareReason:$v.compareReason,measuredAt:.gate.measuredAt}},
          evidence:[.gate.rounds[] | {type:"json-report",uri:(".artifacts/e2e/"+.runId+"/replay.json")}],
          sanitized:true}')"
      printf 'W\tdefects/%s.json\t%s\n' "$id" "$(b64 "$rec")"
      printf 'W\treplay/%s.mjs\t%s\n' "$id" "$(b64 "$(printf '%s' "$payload" | jq -r '.finding.reproducibility.replayScript')")"
      printf 'W\t.registry.json\t%s\n' "$(b64 '{"defects":[]}')"
      printf 'END\tok\t0\t已登记 %s（reported）\n' "$id"
      exit 0
    fi
    printf 'END\terror\t2\t未知 report 动作：%s\n' "$action"; exit 2 ;;
  *)
    printf 'END\terror\t2\t未知子命令：%s\n' "$sub"; exit 2 ;;
esac
FAKE
chmod +x "$SANDBOX/bin/fake-cli"

cat > "$SANDBOX/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
STATE="${MOCK_DOCKER_STATE:?}"
mkdir -p "$STATE/images" "$STATE/tags"
joined="$*"
printf 'docker %s\n' "$*" >> "$STATE/calls.log"
sanitize() { printf '%s' "$1" | tr '/:' '__'; }
cmd="${1:-}"; [[ $# -gt 0 ]] && shift
case "$cmd" in
  version)
    printf '%s\n' '{"Client":{"Version":"29.1.3"},"Server":{"Version":"6.1.4","Os":"linux","Arch":"amd64","Components":[{"Name":"Podman Engine","Version":"6.1.4"}]}}' ;;
  compose)
    if [[ "${1:-}" == "version" ]]; then printf '2.40.3\n'; exit 0; fi
    project=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        -p) project="$2"; shift 2 ;;
        -f) shift 2 ;;
        *) break ;;
      esac
    done
    sub="${1:-}"
    if [[ "$sub" == "run" && "$joined" == *"dist/main.js"* ]]; then
      printf '%s\n' "$*" >> "$STATE/cli-args.log"
      while [[ $# -gt 0 ]]; do
        case "$1" in
          --rm|-T) shift ;;
          tools|bash) shift ;;
          -c) shift 2 ;;
          _) shift; break ;;
          *) shift ;;
        esac
      done
      if [[ "$*" == *signature* ]]; then
        # #108 签名引擎：stdin 是**载荷**（不是树 tar），原样透传（通道不混用）
        exec bash "$MOCK_CLI" "$@"
      fi
      # 宿主树 stdin tar 只读进容器：解包到 $STATE/in-<n>（读取通道证据）
      n=$(( $(cat "$STATE/in-count" 2>/dev/null || printf '0') + 1 ))
      printf '%s\n' "$n" > "$STATE/in-count"
      mkdir -p "$STATE/in-$n"
      tar -xf - -C "$STATE/in-$n"
      if [[ "$*" == *report* ]]; then
        # #109 report：树 tar 内含载荷成员 .report-payload.json（容器内以它为 stdin）
        exec bash "$MOCK_CLI" --root "$STATE/in-$n" "$@" < "$STATE/in-$n/.report-payload.json"
      fi
      exec bash "$MOCK_CLI" --root "$STATE/in-$n" "$@"
    fi
    if [[ "$sub" == "run" && "$joined" == *"apps/e2e/replay/"* ]]; then
      # #108：执行器内真跑 replayCommand（每轮独立 run；stdout 是签名载荷通道）
      n=$(( $(cat "$STATE/replay-count" 2>/dev/null || printf '0') + 1 ))
      printf '%s\n' "$n" > "$STATE/replay-count"
      printf 'replay round %s project=%s\n' "$n" "$project" >> "$STATE/replay.log"
      if [[ "${MOCK_ASSERT_LEASE:-}" == "1" ]]; then
        if compgen -G "$DEVENV_LOCK_ROOT/stack-$MOCK_STACK_SUFFIX.lease/*/owner" >/dev/null; then
          printf 'lease-held\n' >> "$STATE/lease-check.txt"
        else
          printf 'lease-MISSING\n' >> "$STATE/lease-check.txt"
        fi
      fi
      out="${MOCK_REPLAY_OUTPUT:-}"; rc="${MOCK_REPLAY_RC:-0}"
      if [[ -f "$STATE/replay-round-$n.out" ]]; then out="$(cat "$STATE/replay-round-$n.out")"; fi
      if [[ -f "$STATE/replay-round-$n.rc" ]]; then rc="$(cat "$STATE/replay-round-$n.rc")"; fi
      if [[ -n "$out" ]]; then printf '%s\n' "$out"; fi
      exit "$rc"
    fi
    if [[ "$sub" == "run" && "$joined" == *"playwright.verify.config.ts"* ]]; then
      n=$(( $(cat "$STATE/verify-count" 2>/dev/null || printf '0') + 1 ))
      printf '%s\n' "$n" > "$STATE/verify-count"
      mkdir -p "$STATE/verify-in-$n"
      tar -xf - -C "$STATE/verify-in-$n"
      printf 'verify-run payload injected\n' >> "$STATE/verify.log"
      exit "${MOCK_VERIFY_RC:-0}"
    fi
    if [[ "$sub" == "up" ]]; then : > "$STATE/e2e-up-$project"
    elif [[ "$sub" == "down" ]]; then rm -f "$STATE/e2e-up-$project"
    elif [[ "$sub" == "run" && "$joined" == *"playwright test"* ]]; then exit "${MOCK_PLAYWRIGHT_RC:-0}"
    fi
    exit 0 ;;
  build)
    tag=""; snap=""; pw=""; pwver=""; toolshash=""; base=""; bargs=""; file=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        -t) tag="$2"; shift 2 ;;
        --label)
          case "$2" in
            devenv.snapshot.hash=*) snap="${2#*=}" ;;
            devenv.playwright.image=*) pw="${2#*=}" ;;
            devenv.playwright.version=*) pwver="${2#*=}" ;;
            devenv.tools.input-hash=*) toolshash="${2#*=}" ;;
            devenv.base.image=*) base="${2#*=}" ;;
          esac
          shift 2 ;;
        --build-arg) bargs="$bargs$2;"; shift 2 ;;
        -f) file="$2"; shift 2 ;;
        *) shift ;;
      esac
    done
    id="sha256:$(printf '%s|%s|%s|%s|%s|%s' "$tag" "$snap" "$pw" "$pwver" "$bargs" "$file" | sha256sum | awk '{print $1}')"
    printf 'SNAPSHOT_HASH=%s\nPW=%s\nPWVER=%s\nTOOLS=%s\nBASE=%s\nTAG=%s\nFILE=%s\n' \
      "$snap" "$pw" "$pwver" "$toolshash" "$base" "$tag" "$file" > "$STATE/images/$id"
    [[ -n "$tag" ]] && printf '%s\n' "$id" > "$STATE/tags/$(sanitize "$tag")"
    printf '%s\n' "${id#sha256:}" ;;
  image)
    [[ "${1:-}" == "inspect" ]] || exit 0
    shift
    ref=""; fmt=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --format) fmt="$2"; shift 2 ;;
        *) ref="$1"; shift ;;
      esac
    done
    id="$ref"
    if [[ "$ref" != sha256:* ]]; then
      tf="$STATE/tags/$(sanitize "$ref")"
      [[ -f "$tf" ]] || exit 1
      id="$(cat "$tf")"
    fi
    [[ -f "$STATE/images/$id" ]] || exit 1
    snap="$(awk -F= '/^SNAPSHOT_HASH=/{print $2}' "$STATE/images/$id")"
    pw="$(awk -F= '/^PW=/{print $2}' "$STATE/images/$id")"
    pwver="$(awk -F= '/^PWVER=/{print $2}' "$STATE/images/$id")"
    tools="$(awk -F= '/^TOOLS=/{print $2}' "$STATE/images/$id")"
    base="$(awk -F= '/^BASE=/{print $2}' "$STATE/images/$id")"
    case "$fmt" in
      *devenv.tools.input-hash*) printf '%s\n' "$tools" ;;
      *devenv.snapshot.hash*devenv.playwright.image*) printf '%s %s\n' "$snap" "$pw" ;;
      *devenv.playwright.version*) printf '%s\n' "$pwver" ;;
      *devenv.snapshot.hash*devenv.base.image*) printf '%s %s\n' "$snap" "$base" ;;
      *devenv.snapshot.hash*) printf '%s\n' "$snap" ;;
      *'{{.Id}}'*) printf '%s\n' "$id" ;;
      *) printf '\n' ;;
    esac ;;
  tag)
    src="$1"; tag="$2"; id="$src"
    if [[ "$src" != sha256:* ]]; then id="$(cat "$STATE/tags/$(sanitize "$src")")"; fi
    printf '%s\n' "$id" > "$STATE/tags/$(sanitize "$tag")" ;;
  ps)
    service=""; project=""; fmt=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --filter)
          case "$2" in
            label=com.docker.compose.service=*) service="${2#label=com.docker.compose.service=}" ;;
            label=com.docker.compose.project=*) project="${2#label=com.docker.compose.project=}" ;;
          esac
          shift 2 ;;
        --format) fmt="$2"; shift 2 ;;
        *) shift ;;
      esac
    done
    cid=""
    if [[ -n "$service" ]]; then
      if [[ "$project" == *-e2e-* ]]; then
        if [[ -f "$STATE/e2e-up-$project" && "$service" =~ ^(api|worker|web)$ ]]; then cid="cid-$project-$service"; fi
      else
        [[ "${MOCK_INFRA_DOWN:-}" == "1" ]] || case "$service" in db|redis|rustfs) cid="cid-$service" ;; esac
      fi
    fi
    if [[ "$fmt" == *'{{.Names}}'* ]]; then [[ -n "$cid" ]] && printf '%s-name\n' "$cid"
    else [[ -n "$cid" ]] && printf '%s\n' "$cid"; fi
    exit 0 ;;
  inspect)
    fmt=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --format) fmt="$2"; shift 2 ;;
        *) shift ;;
      esac
    done
    if [[ "$fmt" == *Health.Status* ]]; then printf 'healthy\n'; fi ;;
  network)
    sub="$1"; shift || true
    case "$sub" in
      inspect) [[ -f "$STATE/net-$1" ]] ;;
      create) : > "$STATE/net-$1" ;;
      rm) rm -f "$STATE/net-$1" ;;
    esac ;;
  create) printf 'cid-artifacts\n' ;;
  cp)
    dest="${!#}"
    mkdir -p "$dest"
    printf 'mock artifacts\n' > "$dest/exported.txt" ;;
  pull|rm|rmi|logs) exit 0 ;;
  *) exit 0 ;;
esac
MOCK
chmod +x "$SANDBOX/bin/docker"

export PATH="$SANDBOX/bin:$PATH"
export MOCK_DOCKER_STATE="$STATE"
export MOCK_CLI="$SANDBOX/bin/fake-cli"
export DEVENV_DOCKER_HOST="unix:///mock.sock"
export DEVENV_LOCK_ROOT="$SANDBOX/locks"
export DEVENV_STATE_DIR="$MINI/.devenv-state"
export DEVENV_E2E_ARTIFACTS_DIR="$SANDBOX/artifacts"
export DEVENV_WORKTREE_ID="wt-lifecycle"
export DEVENV_LOCK_TIMEOUT=3
MOCK_STACK_SUFFIX="$(printf '%s' "wt-lifecycle" | sha256sum | awk '{print $1}' | cut -c1-8)"
export MOCK_STACK_SUFFIX
DEVENV="$MINI/devenv/devenv"
E2E_DIR="$MINI/apps/e2e"

run_cmd() { # run_cmd <name> <cmd...>
  local name="$1"; shift
  set +e
  "$@" > "$SANDBOX/$name.out" 2> "$SANDBOX/$name.err"
  RC=$?
  set -e
}

# 宿主桥函数接缝（写路径协议边界）：子 shell 内 source 真实库后驱动 e2e_lifecycle_write
lifecycle_write() { # <name> <cli args...>
  local name="$1"; shift
  set +e
  (
    set -Eeuo pipefail
    REPO_ROOT="$MINI"
    trap 'lease_release_all; lock_release_all' EXIT
    source "$REPO_ROOT/devenv/lib/output.sh"
    source "$REPO_ROOT/devenv/lib/engine.sh"
    source "$REPO_ROOT/devenv/lib/lock.sh"
    source "$REPO_ROOT/devenv/lib/snapshot.sh"
    source "$REPO_ROOT/devenv/lib/stack.sh"
    source "$REPO_ROOT/devenv/lib/supply-chain.sh"
    source "$REPO_ROOT/devenv/lib/ci.sh"
    source "$REPO_ROOT/devenv/lib/gen.sh"
    source "$REPO_ROOT/devenv/lib/e2e.sh"
    source "$REPO_ROOT/devenv/lib/github-app-auth.sh"
    source "$REPO_ROOT/devenv/lib/e2e-lifecycle.sh"
    JSON=1; CMD="e2e"
    if [[ "${LIFECYCLE_VERIFY_RUN:-}" == "1" ]]; then
      # V 载荷需要 per-run 隔离栈（mock：标记 up + 绑定执行器镜像）
      e2e_derive_names "ver-a1" "verify"
      E2E_IMAGE_EFFECTIVE="sha256:$(printf 'mock-executor' | sha256sum | awk '{print $1}')"
      : > "$STATE/e2e-up-$E2E_PROJECT"
    fi
    e2e_lifecycle_write "$@"
  ) > "$SANDBOX/$name.out" 2> "$SANDBOX/$name.err"
  RC=$?
  set -e
}

# 事实源快照（零落盘断言的基线）
tree_fingerprint() { (cd "$E2E_DIR" && find . -type f -exec sha256sum {} \; | sort); }
# JSONL 终值 / 事件断言（jq -s 收全流）
last_json() { jq -s -e '.[-1] | '"$2" "$1" >/dev/null 2>&1; }
has_event() { jq -s -e "any(.[]; .event == \"$2\"${3:-})" "$1" >/dev/null 2>&1; }

echo "沙箱 worktree 身份：$DEVENV_WORKTREE_ID（suffix=$MOCK_STACK_SUFFIX）"

# ---------------------------------------------------------------------------
# L1 defect list：--json 终值可解析（查询数据经容器 stdout → 宿主包装）
# ---------------------------------------------------------------------------
BASE_FP="$(tree_fingerprint)"
run_cmd l1 "$DEVENV" --json e2e defect list
if [[ "$RC" == 0 ]] && last_json "$SANDBOX/l1.out" '.command == "e2e" and .status == "ok" and .exitCode == 0 and (.defects | length == 2)'; then
  pass "L1 defect list --json 输出终值 + 缺陷数组（2 条）"
else
  fail "L1" "rc=$RC out=$(tail -2 "$SANDBOX/l1.out") err=$(tail -5 "$SANDBOX/l1.err")"
fi
[[ "$(tree_fingerprint)" == "$BASE_FP" ]] \
  && pass "L1 查询命令零落盘（事实源树指纹不变）" || fail "L1" "查询命令改动了工作树"
[[ -d "$STATE/in-1" && -f "$STATE/in-1/defects/DEF-0001.json" && -f "$STATE/in-1/replay/DEF-0001.mjs" ]] \
  && pass "L1 宿主树经 stdin tar 进容器（defects/replay/tests 只读通道）" \
  || fail "L1" "容器内未见宿主树：$(find "$STATE" -maxdepth 2 -name 'in-*' 2>/dev/null)"
grep -q 'tar -x -C /tmp/in' "$STATE/calls.log" \
  && pass "L1 容器侧解包到 /tmp/in（无 bind、无宿主写通道）" || fail "L1" "未见 stdin tar 解包命令"
jq -s -e 'any(.[]; .event == "workspace.fresh" or .event == "workspace.built")' "$SANDBOX/l1.out" >/dev/null 2>&1 \
  && pass "L1 新鲜度事件留在结果流（未被查询数据吞掉）" || fail "L1" "结果流缺 workspace 事件"
tail -1 "$SANDBOX/l1.out" | jq -e '.command == "e2e" and (.defects | length == 2)' >/dev/null 2>&1 \
  && pass "L1 终值为单行紧凑 JSON（JSONL 结果流不被多行文档破坏）" || fail "L1" "终值非单行 JSON：$(tail -2 "$SANDBOX/l1.out")"

# ---------------------------------------------------------------------------
# L2 defect show：摘要 + 证据 URI；人读模式走 stdout
# ---------------------------------------------------------------------------
run_cmd l2 "$DEVENV" --json e2e defect show DEF-0001
if [[ "$RC" == 0 ]] && last_json "$SANDBOX/l2.out" '.defect.id == "DEF-0001" and .defect.evidence[0].uri == ".artifacts/e2e/exp-offline/results.json"'; then
  pass "L2 defect show --json 输出记录（证据只存 URI）"
else
  fail "L2" "rc=$RC out=$(tail -2 "$SANDBOX/l2.out") err=$(tail -5 "$SANDBOX/l2.err")"
fi
run_cmd l2h "$DEVENV" e2e defect show DEF-0001
[[ "$RC" == 0 ]] && grep -q 'DEF-0001' "$SANDBOX/l2h.out" \
  && pass "L2 人读模式摘要走 stdout（可管道）" || fail "L2h" "rc=$RC out=$(cat "$SANDBOX/l2h.out")"

# ---------------------------------------------------------------------------
# L3 未知 ID → exit 10；拒绝原因透出（END 诊断不被 set -e 吞掉）
# ---------------------------------------------------------------------------
run_cmd l3 "$DEVENV" --json e2e defect show DEF-9999
[[ "$RC" == 10 ]] && pass "L3 未知 ID exit 10" || fail "L3" "rc=$RC（期望 10）err=$(tail -3 "$SANDBOX/l3.err")"
grep -q '缺陷不存在：DEF-9999' "$SANDBOX/l3.err" \
  && pass "L3 拒绝原因透出到 stderr（END 行诊断未被吞）" || fail "L3" "stderr 缺原因：$(tail -3 "$SANDBOX/l3.err")"
last_json "$SANDBOX/l3.out" '.status == "failed" and .exitCode == 10' \
  && pass "L3 --json 终值 status=failed exitCode=10（机器可解析）" || fail "L3" "终值不符：$(tail -1 "$SANDBOX/l3.out")"
run_cmd l3h "$DEVENV" e2e defect show DEF-9999
[[ "$RC" == 10 ]] && pass "L3 人读模式未知 ID 同样 exit 10" || fail "L3h" "rc=$RC"

# ---------------------------------------------------------------------------
# L4 非法记录 → exit 10（schema 不符）
# ---------------------------------------------------------------------------
printf '{"schemaVersion":1,"id":"DEF-0001"\n' > "$E2E_DIR/defects/DEF-0001.json"
run_cmd l4 "$DEVENV" --json e2e defect list
[[ "$RC" == 10 ]] && pass "L4 非法记录 exit 10" || fail "L4" "rc=$RC（期望 10）"
grep -q 'schema 不符' "$SANDBOX/l4.err" \
  && pass "L4 schema 拒绝原因透出" || fail "L4" "stderr 缺原因：$(tail -3 "$SANDBOX/l4.err")"
git -C "$MINI" checkout -- apps/e2e/defects/DEF-0001.json

# ---------------------------------------------------------------------------
# L5 注册表：始终重建（派生缓存），不入库
# ---------------------------------------------------------------------------
run_cmd l5 "$DEVENV" --json e2e registry rebuild
if [[ "$RC" == 0 && -f "$E2E_DIR/.registry.json" ]] \
  && jq -e '.defects | length == 2' "$E2E_DIR/.registry.json" >/dev/null 2>&1 \
  && has_event "$SANDBOX/l5.out" "registry.rebuilt"; then
  pass "L5 registry rebuild 落盘派生缓存 + registry.rebuilt 事件"
else
  fail "L5" "rc=$RC out=$(tail -2 "$SANDBOX/l5.out") err=$(tail -5 "$SANDBOX/l5.err") reg=$(cat "$E2E_DIR/.registry.json" 2>/dev/null)"
fi
git -C "$MINI" check-ignore -q apps/e2e/.registry.json \
  && pass "L5 注册表不入库（.gitignore 排除）" || fail "L5" "注册表未被 gitignore"
run_cmd l5b "$DEVENV" --json e2e registry rebuild
has_event "$SANDBOX/l5b.out" "registry.rebuilt" ' and .drift == "no"' \
  && pass "L5b 无漂移时重建仍执行（始终重建，drift=no）" || fail "L5b" "out=$(tail -2 "$SANDBOX/l5b.out")"

# ---------------------------------------------------------------------------
# L6 注册表漂移：仅 WARN，不硬门禁（原型「漂移即红」死锁的修复）
# ---------------------------------------------------------------------------
printf '{"defects":[{"id":"DEF-0001","status":"retired","engine":"agent-session","specPath":null}]}\n' \
  > "$E2E_DIR/.registry.json"
run_cmd l6 "$DEVENV" --json e2e registry rebuild
if [[ "$RC" == 0 ]] && grep -q 'WARN' "$SANDBOX/l6.err" \
  && has_event "$SANDBOX/l6.out" "registry.rebuilt" ' and .drift == "yes"' \
  && jq -e '.defects[0].status == "reported"' "$E2E_DIR/.registry.json" >/dev/null 2>&1; then
  pass "L6 漂移仅 WARN + 自动重建为事实源同构（exit 0，不硬门禁）"
else
  fail "L6" "rc=$RC err=$(tail -4 "$SANDBOX/l6.err") out=$(tail -2 "$SANDBOX/l6.out") reg=$(cat "$E2E_DIR/.registry.json")"
fi
grep -q '完整性以' "$SANDBOX/l6.err" \
  && pass "L6 WARN 指明完整性锚在入库记录（非缓存）" || fail "L6" "WARN 未说明事实源：$(tail -3 "$SANDBOX/l6.err")"

# ---------------------------------------------------------------------------
# L7 op 协议原子应用：多项 W/D 全应用（新写 + 覆盖 + 删除）
# ---------------------------------------------------------------------------
lifecycle_write l7 fixture-write
if [[ "$RC" == 0 && -f "$E2E_DIR/defects/DEF-0003.json" ]] \
  && grep -q '覆盖' "$E2E_DIR/replay/DEF-0001.mjs" \
  && [[ ! -f "$E2E_DIR/tests/repro/.gitkeep" ]]; then
  pass "L7 W/D 行协议宿主侧全应用（新写/覆盖/删除）"
else
  fail "L7" "rc=$RC err=$(tail -5 "$SANDBOX/l7.err") tree=$(cd "$E2E_DIR" && find . -type f | sort)"
fi
jq -s -e 'all(.[]; .status != "failed")' "$SANDBOX/l7.out" >/dev/null 2>&1 \
  && pass "L7 写路径无失败终值（命令面终值由 L5 registry rebuild 覆盖）" || fail "L7" "出现失败终值：$(tail -1 "$SANDBOX/l7.out")"
rm -f "$E2E_DIR/defects/DEF-0003.json"
git -C "$MINI" checkout -- apps/e2e/replay/DEF-0001.mjs apps/e2e/tests/repro/.gitkeep

# ---------------------------------------------------------------------------
# L8 V 校验不符 → exit 9 零落盘（同批 W 绝不应用）
# ---------------------------------------------------------------------------
BEFORE_FP="$(tree_fingerprint)"
export MOCK_VERIFY_RC=0 LIFECYCLE_VERIFY_RUN=1
lifecycle_write l8 fixture-v-mismatch
unset LIFECYCLE_VERIFY_RUN
[[ "$RC" == 9 ]] && pass "L8 V expect=fail 却通过 → exit 9" || fail "L8" "rc=$RC（期望 9）err=$(tail -4 "$SANDBOX/l8.err")"
[[ "$(tree_fingerprint)" == "$BEFORE_FP" ]] \
  && pass "L8 判定不符零落盘（同批 W 未应用）" || fail "L8" "判定不符仍写盘"
grep -q '判定不符' "$SANDBOX/l8.err" \
  && pass "L8 拒绝原因透出（expect 与实际判定）" || fail "L8" "stderr 缺原因：$(tail -3 "$SANDBOX/l8.err")"
last_json "$SANDBOX/l8.out" '.status == "failed" and .exitCode == 9' \
  && pass "L8 --json 终值 failed/9" || fail "L8" "终值不符：$(tail -1 "$SANDBOX/l8.out")"
has_event "$SANDBOX/l8.out" "step.completed" ' and .verdict == "did-not-fail"' \
  && pass "L8 verdict 事件留痕（did-not-fail）" || fail "L8" "缺 verdict 事件：$(tail -3 "$SANDBOX/l8.out")"
[[ -f "$STATE/verify-in-1/def-0001.verify.spec.ts" ]] \
  && pass "L8 V 载荷经 tar 注入执行器（宿主 .verify-run 生成）" || fail "L8" "载荷未注入：$(find "$STATE" -maxdepth 2 -name 'verify-in-*')"
[[ ! -d "$E2E_DIR/.verify-run" ]] \
  && pass "L8 校验运行后宿主临时目录清理" || fail "L8" ".verify-run 残留"

# ---------------------------------------------------------------------------
# L8b V 判定相符 → 落账（expect=fail 且真失败）
# ---------------------------------------------------------------------------
export MOCK_VERIFY_RC=1 LIFECYCLE_VERIFY_RUN=1
lifecycle_write l8b fixture-v-match
unset MOCK_VERIFY_RC LIFECYCLE_VERIFY_RUN
if [[ "$RC" == 0 ]] && jq -e '.status == "graduated"' "$E2E_DIR/defects/DEF-0001.json" >/dev/null 2>&1; then
  pass "L8b V 判定相符 → W 落账（真跑后才应用）"
else
  fail "L8b" "rc=$RC err=$(tail -4 "$SANDBOX/l8b.err")"
fi
has_event "$SANDBOX/l8b.out" "step.completed" ' and .verdict == "reproduced"' \
  && pass "L8b verdict=reproduced 留痕" || fail "L8b" "缺 verdict 事件"
git -C "$MINI" checkout -- apps/e2e/defects/DEF-0001.json

# ---------------------------------------------------------------------------
# L9 END error → 透传退出码 + 零落盘 + 原因透出
# ---------------------------------------------------------------------------
BEFORE_FP="$(tree_fingerprint)"
lifecycle_write l9 fixture-end-error
[[ "$RC" == 8 ]] && pass "L9 END error 透传退出码 8" || fail "L9" "rc=$RC（期望 8）"
[[ "$(tree_fingerprint)" == "$BEFORE_FP" ]] \
  && pass "L9 END error 零落盘" || fail "L9" "END error 仍写盘"
grep -q '重复毕业被拒' "$SANDBOX/l9.err" \
  && pass "L9 END 拒绝原因透出" || fail "L9" "stderr 缺原因：$(tail -3 "$SANDBOX/l9.err")"

# ---------------------------------------------------------------------------
# L10 无 END 的异常退出（容器/构建问题）→ 4，子进程码入 taskRc
# ---------------------------------------------------------------------------
BEFORE_FP="$(tree_fingerprint)"
lifecycle_write l10 fixture-crash
[[ "$RC" == 4 ]] && pass "L10 无 END 行崩溃 → exit 4（不外逸子进程码）" || fail "L10" "rc=$RC（期望 4）"
last_json "$SANDBOX/l10.out" '.status == "failed" and .exitCode == 4 and .taskRc == "3"' \
  && pass "L10 终值含 taskRc=3（诊断可追）" || fail "L10" "终值不符：$(tail -1 "$SANDBOX/l10.out")"
[[ "$(tree_fingerprint)" == "$BEFORE_FP" ]] && pass "L10 崩溃零落盘" || fail "L10" "崩溃仍写盘"

# ---------------------------------------------------------------------------
# L11 op 路径越界 → 拒绝且零落盘（协议不可写 apps/e2e 之外）
# ---------------------------------------------------------------------------
BEFORE_FP="$(tree_fingerprint)"
lifecycle_write l11 fixture-bad-path
[[ "$RC" != 0 ]] && pass "L11 越界路径 op 被拒绝（rc=$RC）" || fail "L11" "越界 op 未被拒绝"
[[ ! -f "$MINI/apps/escape.txt" && ! -f "$SANDBOX/escape.txt" ]] \
  && pass "L11 越界零落盘" || fail "L11" "越界文件被写入"
[[ "$(tree_fingerprint)" == "$BEFORE_FP" ]] && pass "L11 事实源树未变" || fail "L11" "树被改动"

# ---------------------------------------------------------------------------
# L12 应用中途失败 → 全量还原（原子性：不留半成品）
# ---------------------------------------------------------------------------
BEFORE_FP="$(tree_fingerprint)"
lifecycle_write l12 fixture-apply-fail
[[ "$RC" != 0 ]] && pass "L12 应用失败非零退出（rc=$RC）" || fail "L12" "应用失败仍 exit 0"
[[ "$(tree_fingerprint)" == "$BEFORE_FP" ]] \
  && pass "L12 失败后工作区全量还原（先写的 DEF-0009 已回滚）" \
  || fail "L12" "残留半成品：$(cd "$E2E_DIR" && find . -type f | sort)"

# ---------------------------------------------------------------------------
# L13 生命周期写锁：per-worktree mkdir 锁，冲突 exit 6 零落盘
# ---------------------------------------------------------------------------
sleep 30 & LOCK_HOLDER=$!
mkdir -p "$DEVENV_LOCK_ROOT/e2e-lifecycle-$MOCK_STACK_SUFFIX.lock"
printf '%s %s\n' "$LOCK_HOLDER" "$(date +%s)" > "$DEVENV_LOCK_ROOT/e2e-lifecycle-$MOCK_STACK_SUFFIX.lock/owner"
BEFORE_FP="$(tree_fingerprint)"
run_cmd l13 "$DEVENV" --json e2e registry rebuild
kill -9 "$LOCK_HOLDER" 2>/dev/null; wait "$LOCK_HOLDER" 2>/dev/null || true
rm -rf "$DEVENV_LOCK_ROOT/e2e-lifecycle-$MOCK_STACK_SUFFIX.lock"
[[ "$RC" == 6 ]] && pass "L13 生命周期写锁被占 → exit 6" || fail "L13" "rc=$RC（期望 6）err=$(tail -3 "$SANDBOX/l13.err")"
grep -q 'e2e-lifecycle' "$SANDBOX/l13.err" \
  && pass "L13 冲突诊断含锁名与持有者" || fail "L13" "stderr 缺锁名：$(tail -3 "$SANDBOX/l13.err")"
[[ "$(tree_fingerprint)" == "$BEFORE_FP" ]] && pass "L13 锁冲突零落盘" || fail "L13" "锁冲突仍写盘"
run_cmd l13b "$DEVENV" --json e2e registry rebuild
[[ "$RC" == 0 ]] && pass "L13b 锁释放后重跑成功" || fail "L13b" "rc=$RC err=$(tail -3 "$SANDBOX/l13b.err")"
[[ -z "$(find "$DEVENV_LOCK_ROOT" -maxdepth 1 -name 'e2e-lifecycle-*.lock' -type d 2>/dev/null)" ]] \
  && pass "L13 正常路径结束后写锁释放" || fail "L13" "写锁残留"

# ---------------------------------------------------------------------------
# L14 用法错误 exit 2（缺参数 / 未知子命令；后续票命令尚未实现）
# ---------------------------------------------------------------------------
run_cmd l14a "$DEVENV" e2e defect
[[ "$RC" == 2 ]] && pass "L14 defect 缺动作 exit 2" || fail "L14a" "rc=$RC"
run_cmd l14b "$DEVENV" e2e defect show
[[ "$RC" == 2 ]] && pass "L14 defect show 缺 ID exit 2" || fail "L14b" "rc=$RC"
run_cmd l14c "$DEVENV" e2e graduate DEF-0001
[[ "$RC" == 2 ]] && pass "L14 未实现子命令（graduate）exit 2" || fail "L14c" "rc=$RC"
run_cmd l14d "$DEVENV" e2e defect bogus
[[ "$RC" == 2 ]] && pass "L14 未知 defect 动作 exit 2" || fail "L14d" "rc=$RC"
run_cmd l14e "$DEVENV" e2e defect show DEF-1
[[ "$RC" == 2 ]] && pass "L14 ID 格式非法 exit 2" || fail "L14e" "rc=$RC"

# ---------------------------------------------------------------------------
# L15 取号：本地 max+1；远端叠读（best-effort，失败回退本地 + WARN）
# ---------------------------------------------------------------------------
run_cmd l15 "$DEVENV" --json e2e defect next-id
if [[ "$RC" == 0 ]] && last_json "$SANDBOX/l15.out" '.id == "DEF-0003" and .remoteStatus == "skipped"'; then
  pass "L15 本地 max+1 取号（DEF-0002 → DEF-0003）"
else
  fail "L15" "rc=$RC out=$(tail -1 "$SANDBOX/l15.out") err=$(tail -4 "$SANDBOX/l15.err")"
fi
# 远端叠读：stub gha_cmd_gh（真实 gh 由认证入口测试覆盖）——远端已有 DEF-0007
L15_REMOTE_RC=0
(
  set -Eeuo pipefail
  REPO_ROOT="$MINI"
  source "$REPO_ROOT/devenv/lib/output.sh"
  source "$REPO_ROOT/devenv/lib/github-app-auth.sh"
  source "$REPO_ROOT/devenv/lib/e2e-lifecycle.sh"
  gha_cmd_gh() { printf 'DEF-0007.json\nDEF-0004.json\nREADME.md\n'; }
  e2e_remote_defect_max dev
) > "$SANDBOX/l15-remote.out" 2> "$SANDBOX/l15-remote.err" || L15_REMOTE_RC=$?
[[ "$L15_REMOTE_RC" == 0 && "$(cat "$SANDBOX/l15-remote.out")" == "7" ]] \
  && pass "L15 远端编号叠读（经 devenv gh 入口，取最大 DEF-0007）" \
  || fail "L15remote" "rc=$L15_REMOTE_RC out=$(cat "$SANDBOX/l15-remote.out") err=$(tail -3 "$SANDBOX/l15-remote.err")"
# 远端读失败 → best-effort：非零返回，调用方回退本地
L15_FAIL_RC=0
(
  set -Eeuo pipefail
  REPO_ROOT="$MINI"
  source "$REPO_ROOT/devenv/lib/output.sh"
  source "$REPO_ROOT/devenv/lib/github-app-auth.sh"
  source "$REPO_ROOT/devenv/lib/e2e-lifecycle.sh"
  gha_cmd_gh() { return 22; }
  e2e_remote_defect_max dev
) > "$SANDBOX/l15-fail.out" 2> "$SANDBOX/l15-fail.err" || L15_FAIL_RC=$?
[[ "$L15_FAIL_RC" != 0 ]] \
  && pass "L15 远端读失败如实非零返回（调用方 best-effort 回退本地）" \
  || fail "L15fail" "远端失败被吞（rc=$L15_FAIL_RC）"
# 命令面：--remote 且远端不可用 → 回退本地 + WARN（不硬失败）
run_cmd l15r "$DEVENV" --json e2e defect next-id --remote
if [[ "$RC" == 0 ]] && last_json "$SANDBOX/l15r.out" '.id == "DEF-0003" and .remoteStatus == "unavailable"' \
  && grep -q 'best-effort' "$SANDBOX/l15r.err"; then
  pass "L15 --remote 远端不可用时回退本地 max+1 + WARN（best-effort）"
else
  fail "L15r" "rc=$RC out=$(tail -1 "$SANDBOX/l15r.out") err=$(tail -3 "$SANDBOX/l15r.err")"
fi

# ---------------------------------------------------------------------------
# L16 空树（无缺陷记录）：list 空数组 exit 0；next-id 从 DEF-0001 起
# ---------------------------------------------------------------------------
EMPTY="$SANDBOX/empty-tree"
mkdir -p "$EMPTY"
run_cmd l16 env DEVENV_E2E_LIFECYCLE_DIR="$EMPTY" "$DEVENV" --json e2e defect list
if [[ "$RC" == 0 ]] && last_json "$SANDBOX/l16.out" '.defects == []'; then
  pass "L16 空树 list 输出空数组 exit 0（绿地无缺陷是合法状态）"
else
  fail "L16" "rc=$RC out=$(tail -1 "$SANDBOX/l16.out") err=$(tail -4 "$SANDBOX/l16.err")"
fi
run_cmd l16n env DEVENV_E2E_LIFECYCLE_DIR="$EMPTY" "$DEVENV" --json e2e defect next-id
if [[ "$RC" == 0 ]] && last_json "$SANDBOX/l16n.out" '.id == "DEF-0001"'; then
  pass "L16 空树取号从 DEF-0001 起"
else
  fail "L16n" "rc=$RC out=$(tail -1 "$SANDBOX/l16n.out")"
fi

# ---------------------------------------------------------------------------
# R 段（#108）：e2e replay 重放编排——起隔离栈真跑 replayCommand，每轮独立键空间，
# 失败签名提取/比对经同一决策引擎；0=复现 / 4=未复现（语义反转）/ 3=基础设施 / 10=未知 ID
# ---------------------------------------------------------------------------
SIG_LINE='NE-E2E-SIGNATURE {"schemaVersion":1,"assertionId":"post-enforcement-points.whitespace-name","errorClass":"assertion","outcome":"reproduced","semanticMarkers":[{"key":"http.status.expected","value":"201"},{"key":"http.status.actual","value":"201"}]}'
REPLAY_BASE_FP="$(tree_fingerprint)"

# R1 复现：exit 0 + 终值 reproduced/signature + 登记册 track=replay + 回收 + 事实源零改动
export MOCK_REPLAY_RC=0 MOCK_REPLAY_OUTPUT="$SIG_LINE" MOCK_ASSERT_LEASE=1
run_cmd r1 "$DEVENV" --json e2e replay DEF-0002 --run-id rep-r1
if [[ "$RC" == 0 ]] && last_json "$SANDBOX/r1.out" \
  '.command == "e2e" and .subcommand == "replay" and .status == "ok" and .exitCode == 0 and .reproduced == true and .defectId == "DEF-0002" and (.runs | length == 1) and (.runs[0].signature.errorClass == "assertion")'; then
  pass "R1 replay 复现 → exit 0 + 终值 reproduced=true + 本轮签名（机器可解析）"
else
  fail "R1" "rc=$RC out=$(tail -2 "$SANDBOX/r1.out") err=$(tail -6 "$SANDBOX/r1.err")"
fi
last_json "$SANDBOX/r1.out" '.signatureMatched == null and .attempts == 1' \
  && pass "R1 单轮无从比对 → signatureMatched=null（不是 true，无证据不判同一失败）" \
  || fail "R1sig" "终值不符：$(tail -1 "$SANDBOX/r1.out")"
[[ "$(jq -r '.track' "$MINI/.devenv-state/e2e-runs/rep-r1-a1.json" 2>/dev/null)" == "replay" ]] \
  && pass "R1 复用 #70 运行登记册（track=replay，每轮独立 run id）" || fail "R1reg" "登记册缺 track=replay"
grep -q "compose -p natural-enforcement-$MOCK_STACK_SUFFIX-e2e-rep-r1-a1 .*down" "$STATE/calls.log" \
  && pass "R1 轮次结束回收 per-run 资源（compose down）" || fail "R1down" "未见 down：$(grep -c down "$STATE/calls.log")"
[[ -z "$(find "$DEVENV_LOCK_ROOT" -maxdepth 1 -name 'e2e-owner-*-rep-r1-a1.lock' -type d 2>/dev/null)" ]] \
  && pass "R1 回收结束后释放 run 所有权锁" || fail "R1lock" "所有权锁残留"
grep -q 'lease-held' "$STATE/lease-check.txt" 2>/dev/null && ! grep -q 'lease-MISSING' "$STATE/lease-check.txt" \
  && pass "R1 重放窗口全程持共享栈使用租约（down/migrate 不会中途拆栈）" || fail "R1lease" "租约未在重放窗口持有"
[[ "$(tree_fingerprint)" == "$REPLAY_BASE_FP" ]] \
  && pass "R1 replay 只读事实源（缺陷记录/脚本零改动；门禁回填归 #109）" || fail "R1ro" "replay 改动了事实源树"
[[ -f "$SANDBOX/artifacts/rep-r1-a1/replay.json" && -f "$SANDBOX/artifacts/rep-r1-a1/run.json" ]] \
  && pass "R1 每轮证据落盘（replay.json 含签名 + run.json 运行清单）" || fail "R1art" "产物缺失"
jq -e '.verdict == "reproduced" and .scriptExitCode == 0 and .signature.assertionId == "post-enforcement-points.whitespace-name"' \
  "$SANDBOX/artifacts/rep-r1-a1/replay.json" >/dev/null 2>&1 \
  && pass "R1 replay.json 记录本轮判定/退出码/签名（归因起点）" || fail "R1json" "replay.json 不符：$(cat "$SANDBOX/artifacts/rep-r1-a1/replay.json" 2>/dev/null)"
if grep -qv '^{' "$SANDBOX/r1.out"; then
  fail "R1jsonl" "结果流混入非 JSON 行：$(grep -v '^{' "$SANDBOX/r1.out" | head -2)"
else
  pass "R1 长命令结果流纯 JSONL（脚本原始输出/诊断走 stderr）"
fi
grep -q 'NE-E2E-SIGNATURE' "$SANDBOX/r1.err" \
  && pass "R1 脚本原始输出分流 stderr（人可读诊断不污染结果流）" || fail "R1stderr" "stderr 缺脚本输出"
unset MOCK_ASSERT_LEASE

# R2 未复现 → exit 4 + 语义反转提示（诊断与修复确认共用同一命令）
export MOCK_REPLAY_RC=1
run_cmd r2 "$DEVENV" --json e2e replay DEF-0002 --run-id rep-r2
[[ "$RC" == 4 ]] && pass "R2 未复现 → exit 4" || fail "R2" "rc=$RC（期望 4）err=$(tail -4 "$SANDBOX/r2.err")"
grep -q '环境漂移或已修复' "$SANDBOX/r2.err" \
  && pass "R2 语义反转提示「环境漂移或已修复？」透出 stderr" || fail "R2hint" "缺提示：$(tail -3 "$SANDBOX/r2.err")"
last_json "$SANDBOX/r2.out" '.status == "failed" and .exitCode == 4 and .reproduced == false and (.hint | contains("环境漂移或已修复"))' \
  && pass "R2 终值 failed/4 + reproduced=false + hint（机器可消费）" || fail "R2final" "终值不符：$(tail -1 "$SANDBOX/r2.out")"
has_event "$SANDBOX/r2.out" "step.completed" ' and .verdict == "not-reproduced"' \
  && pass "R2 verdict=not-reproduced 事件留痕" || fail "R2ev" "缺 verdict 事件"

# R3 未知 ID → exit 10，且零资源创建（不起栈、不建网络/库）
CALLS_BEFORE="$(wc -l < "$STATE/calls.log")"
run_cmd r3 "$DEVENV" --json e2e replay DEF-9999
[[ "$RC" == 10 ]] && pass "R3 未知 ID → exit 10" || fail "R3" "rc=$RC（期望 10）"
last_json "$SANDBOX/r3.out" '.status == "failed" and .exitCode == 10' \
  && pass "R3 终值 failed/10 + 拒绝原因" || fail "R3final" "终值不符：$(tail -1 "$SANDBOX/r3.out")"
if tail -n +"$((CALLS_BEFORE + 1))" "$STATE/calls.log" | grep -q 'network create\|compose.*up -d'; then
  fail "R3zero" "未知 ID 仍创建了 run 资源"
else
  pass "R3 未知 ID 零资源创建（计划阶段即拒，不起栈）"
fi

# R4 基础设施错误（脚本 exit 2）→ exit 3，**不是**「未复现」
export MOCK_REPLAY_RC=2
run_cmd r4 "$DEVENV" --json e2e replay DEF-0002 --run-id rep-r4
[[ "$RC" == 3 ]] && pass "R4 基础设施错误 → exit 3（环境未就绪，与未复现区分）" || fail "R4" "rc=$RC（期望 3）err=$(tail -4 "$SANDBOX/r4.err")"
last_json "$SANDBOX/r4.out" '.exitCode == 3 and (.runs[0].verdict == "infrastructure")' \
  && pass "R4 终值 verdict=infrastructure（两档错误类别可机器消费）" || fail "R4final" "终值不符：$(tail -1 "$SANDBOX/r4.out")"
grep -q '不是「未复现」' "$SANDBOX/r4.err" \
  && pass "R4 提示明确区分环境故障与语义反转" || fail "R4hint" "缺区分提示"

# R5 多轮：每轮独立键空间（独立 run id/库名），签名比对经同一原语 → exit 0
export MOCK_REPLAY_RC=0 MOCK_SIG_ALL_MATCHED=true
run_cmd r5 "$DEVENV" --json e2e replay DEF-0002 --attempts 3 --run-id rep-r5
if [[ "$RC" == 0 ]] && last_json "$SANDBOX/r5.out" '.attempts == 3 and .reproduced == true and .signatureMatched == true and (.runs | length == 3)'; then
  pass "R5 --attempts 3 → 三轮全复现 + 签名比对 allMatched → exit 0"
else
  fail "R5" "rc=$RC out=$(tail -2 "$SANDBOX/r5.out") err=$(tail -6 "$SANDBOX/r5.err")"
fi
DBS="$(jq -r '.database' "$MINI/.devenv-state/e2e-runs/rep-r5-a1.json" "$MINI/.devenv-state/e2e-runs/rep-r5-a2.json" "$MINI/.devenv-state/e2e-runs/rep-r5-a3.json" 2>/dev/null | sort -u | wc -l)"
[[ "$DBS" == 3 ]] && pass "R5 每轮独立数据库键空间（replay 写数据，同库重复 attempt 会撞唯一约束）" || fail "R5db" "独立库数=$DBS（期望 3）"
[[ "$(grep -c 'DROP DATABASE' "$STATE/calls.log")" -ge 3 ]] \
  && pass "R5 每轮从明确前置状态开始（幂等 DROP FORCE 重建 + migrate）" || fail "R5purge" "未见逐轮建库"
jq -e '(.baseline.assertionId == "post-enforcement-points.whitespace-name") and (.candidates | length == 2)' \
  "$STATE/compare-payload.json" >/dev/null 2>&1 \
  && pass "R5 比对载荷 = 首轮基线 + 其余轮次（同一原语，#109/#112 共用）" || fail "R5cmp" "载荷不符：$(cat "$STATE/compare-payload.json" 2>/dev/null)"
has_event "$SANDBOX/r5.out" "replay.signatures" ' and .allMatched == "true"' \
  && pass "R5 签名比对结果事件留痕（attempts/allMatched/reason）" || fail "R5ev" "缺 replay.signatures 事件"

# R6 多轮签名不一致 → exit 4（不是同一断言同一原因，不得判稳定复现）
export MOCK_SIG_ALL_MATCHED=false
run_cmd r6 "$DEVENV" --json e2e replay DEF-0002 --attempts 3 --run-id rep-r6
[[ "$RC" == 4 ]] && pass "R6 多轮签名不一致 → exit 4" || fail "R6" "rc=$RC（期望 4）err=$(tail -4 "$SANDBOX/r6.err")"
last_json "$SANDBOX/r6.out" '.reproduced == true and .signatureMatched == false and (.hint | contains("同一断言"))' \
  && pass "R6 终值区分「各轮都复现」与「签名不一致」（hint 指向约定标记）" || fail "R6final" "终值不符：$(tail -1 "$SANDBOX/r6.out")"
unset MOCK_SIG_ALL_MATCHED

# R7 无约定标记：单轮仍按退出码判复现；多轮无从比对 → exit 4（不编造签名）
export MOCK_REPLAY_OUTPUT='脚本只打了普通日志'
run_cmd r7a "$DEVENV" --json e2e replay DEF-0002 --run-id rep-r7a
[[ "$RC" == 0 ]] && last_json "$SANDBOX/r7a.out" '.reproduced == true and .runs[0].signature == null' \
  && pass "R7 无标记单轮：退出码仍是判定权威，signature=null（不编造）" || fail "R7a" "rc=$RC out=$(tail -1 "$SANDBOX/r7a.out")"
run_cmd r7b "$DEVENV" --json e2e replay DEF-0002 --attempts 2 --run-id rep-r7b
[[ "$RC" == 4 ]] && pass "R7 无标记多轮：无法机器判同一原因 → exit 4" || fail "R7b" "rc=$RC（期望 4）"
jq -e '(.baseline == null) and (.candidates | length == 1) and (.candidates[0] == null)' \
  "$STATE/compare-payload.json" >/dev/null 2>&1 \
  && pass "R7 无标记轮次仍逐轮送比对（candidates 长度=轮次-1，null 不被 // 折叠）" \
  || fail "R7payload" "比对载荷不符：$(cat "$STATE/compare-payload.json" 2>/dev/null)"
export MOCK_REPLAY_OUTPUT="$SIG_LINE"

# R8 复现脚本缺失 → exit 10（脚本随记录入库是长期重建依据）
mv "$E2E_DIR/replay/DEF-0002.mjs" "$SANDBOX/DEF-0002.mjs.bak"
run_cmd r8 "$DEVENV" --json e2e replay DEF-0002
[[ "$RC" == 10 ]] && grep -q '复现脚本缺失' "$SANDBOX/r8.err" \
  && pass "R8 复现脚本缺失 → exit 10 + 原因透出" || fail "R8" "rc=$RC err=$(tail -3 "$SANDBOX/r8.err")"
mv "$SANDBOX/DEF-0002.mjs.bak" "$E2E_DIR/replay/DEF-0002.mjs"

# R9 用法错误 exit 2（缺 ID / ID 形态 / --attempts 非正整数 / 未知参数 / run-id 过长）
run_cmd r9a "$DEVENV" e2e replay
[[ "$RC" == 2 ]] && pass "R9 缺 ID exit 2" || fail "R9a" "rc=$RC"
run_cmd r9b "$DEVENV" e2e replay DEF-1
[[ "$RC" == 2 ]] && pass "R9 ID 形态非法 exit 2" || fail "R9b" "rc=$RC"
run_cmd r9c "$DEVENV" e2e replay DEF-0002 --attempts 0
[[ "$RC" == 2 ]] && pass "R9 --attempts 0 exit 2" || fail "R9c" "rc=$RC"
run_cmd r9d "$DEVENV" e2e replay DEF-0002 --bogus
[[ "$RC" == 2 ]] && pass "R9 未知参数 exit 2" || fail "R9d" "rc=$RC"
run_cmd r9e "$DEVENV" e2e replay DEF-0002 --run-id "$(printf 'r%.0s' $(seq 1 40))"
[[ "$RC" == 2 ]] && pass "R9 --run-id 过长（追加 -a<k> 超上限）exit 2" || fail "R9e" "rc=$RC"
run_cmd r9f "$DEVENV" e2e replay DEF-0002 DEF-0001
[[ "$RC" == 2 ]] && pass "R9 多余参数 exit 2" || fail "R9f" "rc=$RC"

# R10 逐轮 verdict/登记册状态与退出码一致（失败轮登记 failed，不掩盖）
[[ "$(jq -r '.status' "$MINI/.devenv-state/e2e-runs/rep-r2-a1.json" 2>/dev/null)" == "failed" ]] \
  && pass "R10 未复现轮登记册 status=failed exitCode=4（观测面不掩盖）" || fail "R10" "登记册不符：$(cat "$MINI/.devenv-state/e2e-runs/rep-r2-a1.json" 2>/dev/null)"
[[ "$(jq -r '.exitCode' "$MINI/.devenv-state/e2e-runs/rep-r4-a1.json" 2>/dev/null)" == "3" ]] \
  && pass "R10 基础设施轮登记册 exitCode=3" || fail "R10b" "登记册不符"
[[ "$(tree_fingerprint)" == "$REPLAY_BASE_FP" ]] \
  && pass "R10 全段结束后事实源树仍与基线一致（replay 全程只读）" || fail "R10ro" "事实源被改动"
unset MOCK_REPLAY_RC MOCK_REPLAY_OUTPUT

# ---------------------------------------------------------------------------
# P 段（#109）：e2e report 实测复现门禁与登记编排
#   接缝 = 命令面（devenv e2e report）；引擎判定真值由 apps/e2e vitest 覆盖，
#   此处 mock 只复刻协议字节 + 按宿主送来的实测轮次判定，驱动宿主编排两条路径。
# ---------------------------------------------------------------------------
REPORT_FINDING="$SANDBOX/finding.json"
cat > "$REPORT_FINDING" <<'JSON'
{"schemaVersion":1,"source":"manual","title":"点位名称纯空白被接受入库",
 "summary":"契约 min(1) 只查长度，纯空白名过校验并入库（201）；原型 DEF-0002 同类 spec 债务",
 "charter":"point-input-safety","suspectedArea":"packages/contracts/src/enforcement-point.ts",
 "layer":"api","severity":"low","engine":"agent-session",
 "discoveredAt":"2026-11-28T12:00:00Z","discoveredBy":"offline",
 "reproducibility":{"kind":"external-state",
   "precondition":"每轮：空库（DROP FORCE + CREATE）+ migrate deploy + 空 bucket + 空队列键空间",
   "replayScript":"// 零第三方依赖复现脚本（夹具）\nprocess.exit(0)\n"},
 "evidence":[],"sanitized":true}
JSON
REPORT_PURE="$SANDBOX/finding-pure.json"
jq '.reproducibility.kind = "pure"' "$REPORT_FINDING" > "$REPORT_PURE"

# 每例前复位轮次计数与逐轮夹具（mock 按全局计数索引 replay-round-<n>）
report_reset() {
  printf '0\n' > "$STATE/replay-count"
  rm -f "$STATE"/replay-round-*.rc "$STATE"/replay-round-*.out "$STATE/lease-check.txt"
}
export MOCK_REPLAY_RC=0 MOCK_REPLAY_OUTPUT="$SIG_LINE" MOCK_ASSERT_LEASE=1

# P1 external-state：3 轮独立键空间全复现 → exit 0 登记（记录 + 脚本 + 登记册关联）
report_reset
P1_FP="$(tree_fingerprint)"
run_cmd p1 "$DEVENV" --json e2e report --finding "$REPORT_FINDING" --run-id rpt-p1
P1_ID="$(jq -s -r '.[-1].defectId' "$SANDBOX/p1.out" 2>/dev/null || printf '')"
if [[ "$RC" == 0 ]] && last_json "$SANDBOX/p1.out" \
  '.command == "e2e" and .subcommand == "report" and .status == "ok" and .exitCode == 0 and .registered == true and .kind == "external-state" and .attempts == 3 and .minAttempts == 3'; then
  pass "P1 external-state 门禁实测 3 轮 → exit 0 登记（终值 registered=true）"
else
  fail "P1" "rc=$RC out=$(tail -2 "$SANDBOX/p1.out") err=$(tail -6 "$SANDBOX/p1.err")"
fi
[[ -f "$E2E_DIR/defects/$P1_ID.json" && -f "$E2E_DIR/replay/$P1_ID.mjs" ]] \
  && pass "P1 登记产物完整：缺陷 JSON（reported）+ replay 脚本同一事务入库" \
  || fail "P1files" "id=$P1_ID 缺记录或脚本"
[[ "$(jq -r '.status' "$E2E_DIR/defects/$P1_ID.json" 2>/dev/null)" == "reported" ]] \
  && pass "P1 记录 status=reported（过门禁登记，非 graduated）" || fail "P1status" "状态不符"
[[ "$(jq -r '.issue // "absent"' "$E2E_DIR/defects/$P1_ID.json" 2>/dev/null)" == "absent" ]] \
  && pass "P1 issue 回链位留空（写入归 #114）" || fail "P1issue" "issue 字段被写入"
P1_DBS="$(jq -r '.database' "$MINI/.devenv-state/e2e-runs"/rpt-p1-a*.json 2>/dev/null | sort -u | wc -l | tr -d ' ')"
[[ "$P1_DBS" == 3 ]] && pass "P1 每轮独立数据库键空间（3 个不同库名）" || fail "P1db" "独立库数=$P1_DBS（期望 3）"
P1_ASSOC="$(jq -r '.defectId // "absent"' "$MINI/.devenv-state/e2e-runs/rpt-p1-a1.json" 2>/dev/null)"
[[ "$P1_ASSOC" == "$P1_ID" ]] \
  && pass "P1 运行登记册关联 defectId（记录 ↔ run 可互查）" || fail "P1assoc" "defectId=$P1_ASSOC id=$P1_ID"
[[ "$(jq -r '.track' "$MINI/.devenv-state/e2e-runs/rpt-p1-a1.json" 2>/dev/null)" == "report" ]] \
  && pass "P1 门禁轮次登记册 track=report（复用 #70 登记册）" || fail "P1track" "track 不符"
[[ "$(jq -r '.reproducibility.gate.rounds | length' "$E2E_DIR/defects/$P1_ID.json" 2>/dev/null)" == 3 ]] \
  && pass "P1 gate 证据回填：逐轮 rounds（runId/键空间/签名/比对）" || fail "P1gate" "rounds 缺失"
[[ "$(jq -r '.reproducibility.gate.precondition' "$E2E_DIR/defects/$P1_ID.json" 2>/dev/null)" == *"空库"* ]] \
  && pass "P1 gate 证据含明确前置状态声明" || fail "P1pre" "precondition 缺失"
grep -q 'lease-held' "$STATE/lease-check.txt" 2>/dev/null && ! grep -q 'lease-MISSING' "$STATE/lease-check.txt" 2>/dev/null \
  && pass "P1 门禁轮次全程持 stack 共享租约（每轮探针均 lease-held）" || fail "P1lease" "租约探针：$(cat "$STATE/lease-check.txt" 2>/dev/null)"
has_event "$SANDBOX/p1.out" 'step.started' ' and .target == "report gate"' \
  && pass "P1 JSONL step.started（target=report gate）" || fail "P1ev" "缺事件"
has_event "$SANDBOX/p1.out" 'step.completed' ' and .target == "report gate round" and .verdict == "reproduced"' \
  && pass "P1 JSONL 逐轮 verdict=reproduced 事件" || fail "P1ev2" "缺逐轮 verdict"
has_event "$SANDBOX/p1.out" 'step.completed' ' and .target == "report register" and .verdict == "registered"' \
  && pass "P1 JSONL 登记 verdict=registered 事件" || fail "P1ev3" "缺登记 verdict"

# P2 某轮未复现（第 2 轮 exit 1）→ 门禁不过 exit 8，**零登记**
report_reset
printf '1\n' > "$STATE/replay-round-2.rc"
P2_FP="$(tree_fingerprint)"
run_cmd p2 "$DEVENV" --json e2e report --finding "$REPORT_FINDING" --run-id rpt-p2
[[ "$RC" == 8 ]] && pass "P2 某轮未复现 → exit 8（门禁未过）" || fail "P2" "rc=$RC（期望 8）err=$(tail -4 "$SANDBOX/p2.err")"
last_json "$SANDBOX/p2.out" '.status == "failed" and .exitCode == 8 and .registered == false and .gate.reason == "round-not-reproduced"' \
  && pass "P2 终值 registered=false + gate.reason 机器可消费" || fail "P2json" "终值不符：$(tail -1 "$SANDBOX/p2.out")"
[[ "$(tree_fingerprint)" == "$P2_FP" ]] \
  && pass "P2 门禁不过零登记（事实源树逐字节不变）" || fail "P2zero" "工作区被改动"
[[ -z "$(find "$DEVENV_LOCK_ROOT" -maxdepth 1 -name 'e2e-lifecycle-*.lock' -type d 2>/dev/null)" ]] \
  && pass "P2 失败路径结束后生命周期写锁释放" || fail "P2lock" "写锁残留"

# P3 多轮签名不一致（第 3 轮实际状态码变 400）→ exit 8 零登记
report_reset
printf '%s\n' "${SIG_LINE/\"http.status.actual\",\"value\":\"201\"/\"http.status.actual\",\"value\":\"400\"}" > "$STATE/replay-round-3.out"
P3_FP="$(tree_fingerprint)"
run_cmd p3 "$DEVENV" --json e2e report --finding "$REPORT_FINDING" --run-id rpt-p3
[[ "$RC" == 8 ]] && pass "P3 逐轮签名比对不符 → exit 8" || fail "P3" "rc=$RC err=$(tail -4 "$SANDBOX/p3.err")"
last_json "$SANDBOX/p3.out" '.gate.reason == "signature-mismatch" and .registered == false' \
  && pass "P3 gate.reason=signature-mismatch（同一断言同一原因不成立）" || fail "P3json" "终值不符"
[[ "$(tree_fingerprint)" == "$P3_FP" ]] && pass "P3 签名不符零登记" || fail "P3zero" "工作区被改动"

# P4 errorClass=unknown（证据不足档）→ exit 8 零登记（永不过门禁）
report_reset
printf '%s\n' "${SIG_LINE/\"errorClass\":\"assertion\"/\"errorClass\":\"unknown\"}" > "$STATE/replay-round-2.out"
P4_FP="$(tree_fingerprint)"
run_cmd p4 "$DEVENV" --json e2e report --finding "$REPORT_FINDING" --run-id rpt-p4
[[ "$RC" == 8 ]] && pass "P4 unknown 档 → exit 8（保守档永不过门禁）" || fail "P4" "rc=$RC err=$(tail -4 "$SANDBOX/p4.err")"
[[ "$(tree_fingerprint)" == "$P4_FP" ]] && pass "P4 unknown 档零登记" || fail "P4zero" "工作区被改动"

# P5 pure 路径：1 轮即过门禁（按被测路径分类，非按引擎）
report_reset
run_cmd p5 "$DEVENV" --json e2e report --finding "$REPORT_PURE" --run-id rpt-p5
P5_ID="$(jq -s -r '.[-1].defectId' "$SANDBOX/p5.out" 2>/dev/null || printf '')"
if [[ "$RC" == 0 ]] && last_json "$SANDBOX/p5.out" '.kind == "pure" and .attempts == 1 and .minAttempts == 1 and .registered == true'; then
  pass "P5 pure 路径 1 轮过门禁 → exit 0 登记"
else
  fail "P5" "rc=$RC out=$(tail -1 "$SANDBOX/p5.out") err=$(tail -4 "$SANDBOX/p5.err")"
fi
[[ "$(jq -r '.reproducibility.gate.signatureMatched' "$E2E_DIR/defects/$P5_ID.json" 2>/dev/null)" == "null" ]] \
  && pass "P5 单轮 signatureMatched=null（无从跨轮比对，不自证同一）" || fail "P5sig" "签名比对位不符"
[[ "$(jq -r '.reproducibility.gate.attempts' "$E2E_DIR/defects/$P5_ID.json" 2>/dev/null)" == 1 ]] \
  && pass "P5 gate.attempts=1 回填" || fail "P5att" "attempts 不符"

# P6 --attempts 低于被测路径下限 → exit 2（次数是检查预算，不得下调）
report_reset
run_cmd p6 "$DEVENV" --json e2e report --finding "$REPORT_FINDING" --attempts 2
[[ "$RC" == 2 ]] && pass "P6 --attempts 2 < external-state 下限 3 → exit 2" || fail "P6" "rc=$RC（期望 2）"
report_reset
run_cmd p6b "$DEVENV" --json e2e report --finding "$REPORT_FINDING" --attempts 5
[[ "$RC" == 0 ]] && last_json "$SANDBOX/p6b.out" '.attempts == 5' \
  && pass "P6 --attempts 5 ≥ 下限 → 实测 5 轮（预算可上调）" || fail "P6b" "rc=$RC out=$(tail -1 "$SANDBOX/p6b.out")"

# P7 用法错误 exit 2
run_cmd p7a "$DEVENV" e2e report
[[ "$RC" == 2 ]] && pass "P7 缺 --finding → exit 2" || fail "P7a" "rc=$RC"
run_cmd p7b "$DEVENV" e2e report --finding "$SANDBOX/nonexistent.json"
[[ "$RC" == 2 ]] && pass "P7 载荷文件不存在 → exit 2" || fail "P7b" "rc=$RC"
run_cmd p7c "$DEVENV" e2e report --finding "$REPORT_FINDING" --bogus
[[ "$RC" == 2 ]] && pass "P7 未知参数 → exit 2" || fail "P7c" "rc=$RC"

# P8 --from-results：从 Playwright results.json 提取 #107 属性发现并合并载荷
report_reset
PF_JSON='{"schemaVersion":1,"engine":"fast-check","property":"P0/GAP-PT-NAME-01/point-name-nonblank","rule":"GAP-PT-NAME-01","charter":"point-input-safety","seed":123456789,"counterexample":["   "],"counterexamplePath":"0:1:0","numRuns":10,"numShrinks":3,"request":{"method":"post","path":"/enforcement-points","body":{"name":"   ","lat":23.1291,"lng":113.2644}}}'
PF_B64="$(printf '%s' "$PF_JSON" | openssl base64 -e -A)"
jq -cn --arg b "$PF_B64" '{suites:[{specs:[{tests:[{results:[{attachments:[{name:"property-finding",body:$b,contentType:"application/json"}]}]}]}]}]}' > "$SANDBOX/results.json"
run_cmd p8 "$DEVENV" --json e2e report --finding "$REPORT_FINDING" --from-results "$SANDBOX/results.json" --run-id rpt-p8
[[ "$RC" == 0 ]] && pass "P8 --from-results 提取属性发现并登记 → exit 0" || fail "P8" "rc=$RC err=$(tail -4 "$SANDBOX/p8.err")"
[[ "$(jq -r '.finding.source' "$STATE/report-payload-plan.json" 2>/dev/null)" == "property-finding" ]] \
  && pass "P8 载荷 source 定型为 property-finding（provenance 即属性发现）" || fail "P8src" "source 不符"
[[ "$(jq -r '.finding.finding.property' "$STATE/report-payload-plan.json" 2>/dev/null)" == "P0/GAP-PT-NAME-01/point-name-nonblank" ]] \
  && pass "P8 属性发现无损进引擎载荷（property/seed/反例）" || fail "P8pf" "finding 未合并"

# P9 登记持生命周期写锁：被占 → exit 6 零落盘
report_reset
sleep 30 & P9_HOLDER=$!
mkdir -p "$DEVENV_LOCK_ROOT/e2e-lifecycle-$MOCK_STACK_SUFFIX.lock"
printf '%s %s\n' "$P9_HOLDER" "$(date +%s)" > "$DEVENV_LOCK_ROOT/e2e-lifecycle-$MOCK_STACK_SUFFIX.lock/owner"
P9_FP="$(tree_fingerprint)"
run_cmd p9 "$DEVENV" --json e2e report --finding "$REPORT_FINDING" --run-id rpt-p9
kill -9 "$P9_HOLDER" 2>/dev/null; wait "$P9_HOLDER" 2>/dev/null || true
rm -rf "$DEVENV_LOCK_ROOT/e2e-lifecycle-$MOCK_STACK_SUFFIX.lock"
[[ "$RC" == 6 ]] && pass "P9 登记阶段生命周期写锁被占 → exit 6" || fail "P9" "rc=$RC（期望 6）err=$(tail -3 "$SANDBOX/p9.err")"
[[ "$(tree_fingerprint)" == "$P9_FP" ]] && pass "P9 锁冲突零落盘" || fail "P9zero" "锁冲突仍写盘"

# P10 非 JSON 模式：stdout 无终值 JSON（人类摘要走 stderr，输出协议三类）
report_reset
run_cmd p10 "$DEVENV" e2e report --finding "$REPORT_PURE" --run-id rpt-p10
[[ "$RC" == 0 && ! -s "$SANDBOX/p10.out" ]] \
  && pass "P10 非 --json 模式 stdout 为空（人类摘要走 stderr）" || fail "P10" "rc=$RC stdout=$(head -c 120 "$SANDBOX/p10.out")"
grep -q '门禁' "$SANDBOX/p10.err" && pass "P10 人类摘要含门禁口径留痕" || fail "P10h" "stderr 缺摘要"

unset MOCK_REPLAY_RC MOCK_REPLAY_OUTPUT MOCK_ASSERT_LEASE
rm -f "$STATE"/replay-round-*.rc "$STATE"/replay-round-*.out

# ---------------------------------------------------------------------------
echo "------------------------------------------------------------"
echo "e2e 生命周期编排离线测试完成：${PASS_COUNT} 通过，${FAILURES} 失败"
[[ "$FAILURES" == 0 ]]