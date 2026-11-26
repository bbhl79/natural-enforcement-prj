#!/usr/bin/env bash
# ============================================================================
# #62 并发 web 入口与可观察命令面 — Windows（WSL2）实机证据驱动
#
# 用法：bash run-evidence.sh all   （一次连续运行；日志写 /tmp/ne62-evidence，
# 跑完人工拷回 docs/evidence/62-web-concurrency/ —— 避免证据文件进入工作树快照
# 改变构建输入，#58 快照机制）
#
# 前置：主 worktree A 栈可起（驱动自行 up）；会创建临时 worktree B（同提交，
#  detached HEAD），结束时删除 B 及其卷；A 栈最终恢复（up + web）。
#
# 验收对照：
#   02 两进程同时 web → 实际绑定不同端口并各自 200（判据=绑定结果，非探测空闲）
#   02 实际端口进 --json 终值与 status（per-worktree 查询）
#   03 显式端口被它 worktree 容器占用 → exit 3，错误含服务/端口/占用者/修复命令
#   04 显式端口被非容器进程占用 → exit 3，如实区分占用者类型
#   05 exec/logs --json：原始流走 stderr，stdout 仅 JSON；退出码=子进程码
#   05b 非 --json exec：原始流保持 stdout 通道（透传不退化）
#   06 重复 web（配置未变）→ 容器不重建，端口稳定（幂等）
# ============================================================================
set -Eeuo pipefail

A=/home/hulei815/Workspaces/natural-enforcement-prj
B=/home/hulei815/Workspaces/ne-62-evidence-b
OUT=/tmp/ne62-evidence
CHECKS="$OUT/checks.txt"
: > "$OUT/results.tsv" 2>/dev/null || { mkdir -p "$OUT"; : > "$OUT/results.tsv"; }
: > "$CHECKS"

# rec <name> <cmd...>：记录 stdout/stderr 与退出码（不因非零退出中断驱动）
rec() {
  local name="$1"; shift
  local rc=0
  "$@" >"$OUT/$name.out" 2> "$OUT/$name.err" || rc=$?
  printf '%s\trc=%s\n' "$name" "$rc" >> "$OUT/results.tsv"
  return 0
}
# rec_b：在 B worktree 内执行 devenv
rec_b() { local name="$1"; shift; rec "$name" env -C "$B" "$@"; }

check() { # check <描述> <0=pass>
  if [[ "$2" == 0 ]]; then printf 'PASS: %s\n' "$1" | tee -a "$CHECKS"
  else printf 'FAIL: %s\n' "$1" | tee -a "$CHECKS"; fi
}

json_last_port() { tail -1 "$1" | jq -r '.port // empty'; }

step_00_baseline() {
  echo "== 00 基线（A：doctor/status/git） =="
  rec 00-a-doctor "$A/devenv/devenv" doctor
  rec 00-a-status "$A/devenv/devenv" --json status
  git -C "$A" log --oneline -1 > "$OUT/00-git-head.txt"
  git -C "$A" worktree list > "$OUT/00-worktrees-before.txt"
}

step_01_setup_b() {
  echo "== 01 建 B worktree（同提交 detached）并起 B 栈 =="
  git -C "$A" worktree add --detach "$B" HEAD > "$OUT/01-worktree-add.log" 2>&1
  git -C "$A" worktree list > "$OUT/01-worktrees-after-add.txt"
  rec_b 01-b-doctor ./devenv/devenv doctor
  # B 首次 up：快照与 A 相同（同提交、双方干净）→ 镜像新鲜度命中，不重复构建
  rec_b 01-b-up ./devenv/devenv up
  rec_b 01-b-status ./devenv/devenv --json status
  tail -1 "$OUT/01-b-status.out" | jq -e '.project != "natural-enforcement-90e22128"' >/dev/null
  check "01 B 项目名 per-worktree 独立" $?
}

step_02_concurrent_web() {
  echo "== 02 两进程同时 web（先确保 A 无 web 容器，双方都是真实新绑定） =="
  rec 02-a-web-down "$A/devenv/devenv" web --down
  # 真正并发：两个 devenv web 同时跑（各持 per-worktree 栈锁，互不阻塞）
  rec 02-a-web "$A/devenv/devenv" --json web &
  local pa=$!
  rec_b 02-b-web ./devenv/devenv --json web &
  local pb=$!
  wait "$pa" "$pb" || true

  local pa_port pb_port
  pa_port="$(json_last_port "$OUT/02-a-web.out")"
  pb_port="$(json_last_port "$OUT/02-b-web.out")"
  echo "A port=$pa_port  B port=$pb_port" | tee "$OUT/02-ports.txt"
  [[ "$pa_port" =~ ^[0-9]+$ && "$pb_port" =~ ^[0-9]+$ ]]
  check "02 双方终值均含实际端口" $?
  [[ -n "$pa_port" && -n "$pb_port" && "$pa_port" != "$pb_port" ]]
  check "02 并发实际绑定不同端口" $?

  # 双方实际可访问（经宿主 curl，非容器内网）
  local ca cb
  ca="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://localhost:$pa_port/" || true)"
  cb="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://localhost:$pb_port/" || true)"
  echo "A http=$ca  B http=$cb" | tee -a "$OUT/02-ports.txt"
  [[ "$ca" == 200 && "$cb" == 200 ]]
  check "02 双方实际访问成功（HTTP 200）" $?

  # 实际端口进 status（per-worktree 明确查询）
  rec 02-a-status "$A/devenv/devenv" --json status
  rec_b 02-b-status ./devenv/devenv --json status
  tail -1 "$OUT/02-a-status.out" | jq -e --arg p "$pa_port" '.web_port == $p and .web_url == "http://localhost:" + $p' >/dev/null
  check "02 A status 含实际端口/url" $?
  tail -1 "$OUT/02-b-status.out" | jq -e --arg p "$pb_port" '.web_port == $p and .web_url == "http://localhost:" + $p' >/dev/null
  check "02 B status 含实际端口/url" $?
  rec 02-a-ps "$A/devenv/devenv" ps
  rec_b 02-b-ps ./devenv/devenv ps
}

step_03_conflict_container_holder() {
  echo "== 03 显式端口被它 worktree 容器占用（B 抢 A 的实际端口） =="
  local pa_port
  pa_port="$(json_last_port "$OUT/02-a-web.out")"
  rec_b 03-b-web-steal-a ./devenv/devenv web --port "$pa_port"
  grep -q $'03-b-web-steal-a\trc=3' "$OUT/results.tsv"
  check "03 B 抢 A 端口 exit 3" $?
  grep -q "$pa_port" "$OUT/03-b-web-steal-a.err" \
    && grep -q 'natural-enforcement-90e22128' "$OUT/03-b-web-steal-a.err" \
    && grep -q 'devenv web' "$OUT/03-b-web-steal-a.err"
  check "03 错误含端口/A 项目占用者/修复命令" $?
  # 失败后 B 的 web 已被 compose 重建尝试清掉——恢复 B web 供后续步骤
  rec_b 03-b-web-restore ./devenv/devenv --json web
  # A 的 web 未受影响
  local ca
  ca="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://localhost:$pa_port/" || true)"
  [[ "$ca" == 200 ]]; check "03 A 的 web 不受 B 冲突影响" $?
}

step_04_conflict_noncontainer() {
  echo "== 04 显式端口被非容器进程占用（python http.server 占位） =="
  python3 -m http.server 8077 --bind 127.0.0.1 >/dev/null 2>&1 &
  local listener=$!
  sleep 1
  rec_b 04-b-web-noncontainer ./devenv/devenv web --port 8077
  kill "$listener" 2>/dev/null; wait "$listener" 2>/dev/null || true
  grep -q $'04-b-web-noncontainer\trc=3' "$OUT/results.tsv"
  check "04 非容器占用 exit 3" $?
  grep -q '非容器进程' "$OUT/04-b-web-noncontainer.err"
  check "04 错误区分非容器占用者" $?
}

step_05_passthrough() {
  echo "== 05 透传命令 --json 包装 / 非 --json 原通道 =="
  rec 05-a-exec-json "$A/devenv/devenv" --json exec -- sh -c 'echo raw-out; echo err-line >&2; exit 3'
  grep -q $'05-a-exec-json\trc=3' "$OUT/results.tsv"
  check "05 exec 子进程码原样传播（3）" $?
  jq -c . "$OUT/05-a-exec-json.out" >/dev/null 2>&1 \
    && ! grep -q 'raw' "$OUT/05-a-exec-json.out"
  check "05 exec --json stdout 全 JSON 无原始流" $?
  tail -1 "$OUT/05-a-exec-json.out" | jq -e '.command == "exec" and .status == "failed" and .exitCode == 3' >/dev/null
  check "05 exec --json 终值元数据" $?
  grep -q 'raw-out' "$OUT/05-a-exec-json.err" && grep -q 'err-line' "$OUT/05-a-exec-json.err"
  check "05 exec 原始流走 stderr" $?

  rec 05-a-logs-json "$A/devenv/devenv" --json logs api --tail 5
  jq -c . "$OUT/05-a-logs-json.out" >/dev/null 2>&1 \
    && tail -1 "$OUT/05-a-logs-json.out" | jq -e '.command == "logs" and .status == "ok"' >/dev/null
  check "05 logs --json stdout 全 JSON + 终值" $?
  [[ -s "$OUT/05-a-logs-json.err" ]]
  check "05 logs 原始日志走 stderr" $?

  rec 05b-a-exec-raw "$A/devenv/devenv" exec -- sh -c 'echo raw-stdout-line'
  grep -q '^raw-stdout-line$' "$OUT/05b-a-exec-raw.out" \
    && ! grep -q '"command"' "$OUT/05b-a-exec-raw.out"
  check "05b 非 --json exec 原始流保持 stdout" $?
}

step_06_idempotent_port_stable() {
  echo "== 06 重复 web（配置未变）幂等：容器不重建、端口稳定 =="
  local pa_port before after
  pa_port="$(json_last_port "$OUT/02-a-web.out")"
  before="$(docker ps --filter label=com.docker.compose.service=web \
    --filter label=com.docker.compose.project=natural-enforcement-90e22128 --format '{{.ID}}')"
  rec 06-a-web-again "$A/devenv/devenv" --json web
  after="$(docker ps --filter label=com.docker.compose.service=web \
    --filter label=com.docker.compose.project=natural-enforcement-90e22128 --format '{{.ID}}')"
  local again_port
  again_port="$(json_last_port "$OUT/06-a-web-again.out")"
  [[ "$before" == "$after" && "$again_port" == "$pa_port" ]]
  check "06 重复 web 幂等（容器未重建、端口 $pa_port 稳定）" $?
}

step_07_teardown() {
  echo "== 07 收尾：B 拆栈删 worktree；A 恢复 =="
  rec_b 07-b-web-down ./devenv/devenv web --down
  rec_b 07-b-down-volumes ./devenv/devenv down --volumes
  git -C "$A" worktree remove --force "$B" > "$OUT/07-worktree-remove.log" 2>&1
  git -C "$A" worktree list > "$OUT/07-worktrees-after.txt"
  # A 恢复到可开工状态（栈在跑；web 留运行态供人访问）
  rec 07-a-up "$A/devenv/devenv" up
  rec 07-a-doctor "$A/devenv/devenv" doctor
  rec 07-a-status "$A/devenv/devenv" --json status
  tail -1 "$OUT/07-a-status.out" | jq -e '.locks == "" and .leases == "none"' >/dev/null
  check "07 锁与租约全部释放" $?
}

case "${1:-all}" in
  all)
    step_00_baseline
    step_01_setup_b
    step_02_concurrent_web
    step_03_conflict_container_holder
    step_04_conflict_noncontainer
    step_05_passthrough
    step_06_idempotent_port_stable
    step_07_teardown
    ;;
  *) echo "用法：$0 all"; exit 2 ;;
esac

echo "== 汇总 =="
cat "$CHECKS"
grep -c '^PASS' "$CHECKS" | xargs printf 'PASS 数：%s\n'
if grep -q '^FAIL' "$CHECKS"; then echo "存在 FAIL"; exit 1; fi
echo "全部通过"
