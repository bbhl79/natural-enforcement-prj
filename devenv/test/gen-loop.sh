#!/usr/bin/env bash
# ============================================================================
# 新增包闭环基准（#64 AC5）——同一基线 + 约定缓存，重复 N 次 gen→verify
#
# 每轮：
#   1. 从基线（本轮开始前备份的 pnpm-lock.yaml + workspace.Dockerfile）出发；
#   2. `devenv gen package <唯一名>`（唯一名避免幂等拒绝；基线本轮结束后复原）；
#   3. `DEVENV_PNPM_EVIDENCE=1 devenv build`（deps 层记录下载证据）；
#   4. `devenv gen evidence` → 必须 complete=true 且 fetchedPackages=0；
#   5. `devenv verify` → 必须 exit 0；
#   6. 计时 = 1 开始 → 5 结束（gen 到 verify）；复原基线后进入下一轮。
#
# 判定（Spec / #64）：
#   - 任一轮 gen/build/verify 非零 → 不通过；
#   - 下载证据缺失、事件流不完整或 fetchedPackages>0 → 不通过（「无法验收」绝不默认通过）；
#   - 全部通过才报告中位数/最差值；耗时达标但下载证据不达标仍不通过。
#
# 用法（Windows 在 WSL2 bash 内执行；命令面唯一入口不变）：
#   devenv/test/gen-loop.sh [--loops N] [--prefix kebab-prefix]
#
# 原始证据写入 .artifacts/64-gen-loop/（含每轮 stdout/stderr/退出码/耗时/证据）。
# 本脚本改动工作树（新增 packages/<name>、补丁 Dockerfile 与 lockfile），结束/失败
# 时恢复基线；恢复失败会明确报错并保留现场。
# ============================================================================
set -Eeuo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TEST_DIR/../.." && pwd)"
DEVENV="$REPO_ROOT/devenv/devenv"
LOOPS=5
PREFIX="genloop-$(date +%Y%m%d-%H%M%S)"
TIMEOUT_SECS=1800
TIMEOUT_BIN=""
if command -v timeout >/dev/null 2>&1; then TIMEOUT_BIN="timeout"
elif command -v gtimeout >/dev/null 2>&1; then TIMEOUT_BIN="gtimeout"
fi

usage() {
  cat <<'EOF'
用法：gen-loop.sh [--loops N] [--prefix kebab-prefix]

  --loops N      轮数（默认 5；#64 AC5 要求 5）
  --prefix P     生成包名前缀（kebab-case，默认 genloop-<时间戳>）
  --timeout S    每步上限秒数（默认 1800；超时退出码 124，不默认通过）

要求：引擎已就绪（devenv doctor 退出 0）；当前工作树含可重建的 pnpm-lock.yaml 基线。
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --loops) LOOPS="${2:?--loops 需要值}"; shift 2 ;;
    --prefix) PREFIX="${2:?--prefix 需要值}"; shift 2 ;;
    --timeout) TIMEOUT_SECS="${2:?--timeout 需要值}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数：$1" >&2; usage >&2; exit 2 ;;
  esac
done
[[ "$LOOPS" =~ ^[0-9]+$ ]] && (( 10#$LOOPS >= 1 )) || { echo "--loops 需要正整数" >&2; exit 2; }
[[ "$TIMEOUT_SECS" =~ ^[0-9]+$ ]] && (( 10#$TIMEOUT_SECS >= 1 )) || { echo "--timeout 需要正整数" >&2; exit 2; }
[[ "$PREFIX" =~ ^[a-z][a-z0-9]*(-[a-z0-9]+)*$ ]] \
  || { echo "--prefix 须为 kebab-case：$PREFIX" >&2; exit 2; }

ART="$REPO_ROOT/.artifacts/64-gen-loop"
mkdir -p "$ART"
BASELINE="$ART/baseline"
mkdir -p "$BASELINE"
cp -p "$REPO_ROOT/pnpm-lock.yaml" "$BASELINE/pnpm-lock.yaml"
cp -p "$REPO_ROOT/devenv/workspace.Dockerfile" "$BASELINE/workspace.Dockerfile"

NAMES=()
RESTORED=0
restore_baseline() {
  (( RESTORED )) && return 0
  local n
  for n in ${NAMES[@]+"${NAMES[@]}"}; do
    rm -rf "$REPO_ROOT/packages/$n"
  done
  cp -p "$BASELINE/pnpm-lock.yaml" "$REPO_ROOT/pnpm-lock.yaml"
  cp -p "$BASELINE/workspace.Dockerfile" "$REPO_ROOT/devenv/workspace.Dockerfile"
  RESTORED=1
}
cleanup() {
  local rc=$?
  restore_baseline || { echo "ERROR: 基线恢复失败——请检查 packages/、pnpm-lock.yaml、devenv/workspace.Dockerfile" >&2; rc=1; }
  exit "$rc"
}
trap cleanup EXIT

now_ms() {
  if perl -MTime::HiRes=time -e 'printf "%.0f\n", time*1000' 2>/dev/null; then
    return 0
  fi
  echo $(( $(date +%s) * 1000 ))
}

run_case() { # <dir> <label> <env...> -- <cmd...>
  local dir="$1" label="$2"; shift 2
  local envs=() prefix=()
  while [[ "$1" != "--" ]]; do envs+=("$1"); shift; done
  shift
  [[ -n "$TIMEOUT_BIN" ]] && prefix=("$TIMEOUT_BIN" "$TIMEOUT_SECS")
  local rc=0
  set +e
  ${prefix[@]+"${prefix[@]}"} env ${envs[@]+"${envs[@]}"} "$@" \
    > "$dir/$label.out" 2> "$dir/$label.err"
  rc=$?
  set -e
  printf '%s\n' "$rc" > "$dir/$label.exitcode"
  if (( rc == 124 )); then
    printf 'timeout=%ss\n' "$TIMEOUT_SECS" > "$dir/$label.timeout"
  fi
  return "$rc"
}

echo "== gen-loop：${LOOPS} 轮，前缀 ${PREFIX}，产物 ${ART}"
echo "== 基线备份：${BASELINE}"

if ! "$DEVENV" doctor > "$ART/doctor.out" 2> "$ART/doctor.err"; then
  echo "ERROR: 引擎未就绪（devenv doctor 非零；见 $ART/doctor.err）" >&2
  exit 3
fi

TOTALS=()
FAILED=0
for (( i = 1; i <= LOOPS; i++ )); do
  name="${PREFIX}-${i}"
  # 绝不删除不属于本轮的既有目录（restore 会 rm -rf 该名字）：先拒绝。
  if [[ -e "$REPO_ROOT/packages/$name" ]]; then
    echo "ERROR: 目标已存在 packages/$name/（拒绝开始，避免恢复时误删既有目录）" >&2
    exit 4
  fi
  NAMES+=("$name")
  dir="$ART/round-$i"
  rm -rf "$dir"; mkdir -p "$dir"
  echo "-- [$i/$LOOPS] gen package $name"
  t0="$(now_ms)"
  if ! run_case "$dir" gen -- "$DEVENV" --json gen package "$name"; then
    echo "FAIL: 第 $i 轮 gen 非零（见 $dir/gen.err）" >&2
    FAILED=1
  fi
  if (( ! FAILED )); then
    echo "-- [$i/$LOOPS] build（下载证据）"
    if ! run_case "$dir" build DEVENV_PNPM_EVIDENCE=1 -- "$DEVENV" --json build; then
      echo "FAIL: 第 $i 轮 build 非零（见 $dir/build.err）" >&2
      FAILED=1
    fi
  fi
  if (( ! FAILED )); then
    if ! run_case "$dir" evidence -- "$DEVENV" gen evidence; then
      echo "FAIL: 第 $i 轮无法取得下载证据（见 $dir/evidence.err）——「无法验收」，不默认通过" >&2
      FAILED=1
    else
      fetched="$(jq -r '.fetchedPackages // "null"' "$dir/evidence.out")"
      complete="$(jq -r '.complete // false' "$dir/evidence.out")"
      errors="$(jq -r '.errors // "null"' "$dir/evidence.out")"
      printf '{"round":%d,"fetchedPackages":%s,"complete":%s,"errors":%s}\n' \
        "$i" "$fetched" "$complete" "$errors" > "$dir/download.json"
      if [[ "$complete" != "true" || "$fetched" != "0" || "$errors" != "0" ]]; then
        echo "FAIL: 第 $i 轮下载证据不达标（complete=${complete}, fetched=${fetched}, errors=${errors}）" >&2
        FAILED=1
      fi
    fi
  fi
  if (( ! FAILED )); then
    echo "-- [$i/$LOOPS] verify"
    if ! run_case "$dir" verify -- "$DEVENV" --json verify; then
      echo "FAIL: 第 $i 轮 verify 非零（见 $dir/verify.err）" >&2
      FAILED=1
    fi
  fi
  t1="$(now_ms)"
  elapsed=$(( t1 - t0 ))
  printf '%s\n' "$elapsed" > "$dir/elapsed-ms"
  TOTALS+=("$elapsed")
  echo "-- [$i/$LOOPS] gen→verify ${elapsed}ms"
  # 同一基线：本轮生成的包与两处补丁全部复原，再进入下一轮
  restore_baseline
  RESTORED=0
  if (( FAILED )); then
    echo "ERROR: 第 $i 轮失败，停止（原始输出与基线备份保留在 $ART）" >&2
    exit 1
  fi
done

# 中位数/最差值（LOOPS 为 5 时即第 3 个；偶数取中间两值均值向下取整之外的
# 常用口径：取第 ceil(n/2) 个，报告同时给出最差）
median="$(printf '%s\n' "${TOTALS[@]}" | sort -n | awk '{a[NR]=$1} END {print a[int((NR+1)/2)]}')"
worst="$(printf '%s\n' "${TOTALS[@]}" | sort -n | tail -1)"
best="$(printf '%s\n' "${TOTALS[@]}" | sort -n | head -1)"
printf '{"loops":%d,"medianMs":%s,"worstMs":%s,"bestMs":%s,"downloadEvidence":"zero","status":"ok"}\n' \
  "$LOOPS" "$median" "$worst" "$best" > "$ART/summary.json"
echo "== 通过：${LOOPS} 轮全部完成，下载证据均为零包内容下载"
echo "== gen→verify 中位数 ${median}ms，最差 ${worst}ms，最好 ${best}ms"
echo "== 汇总：$ART/summary.json"