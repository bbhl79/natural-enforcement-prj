#!/usr/bin/env bash
# 兜底闸逐规则判红集合快照采集（#175；父规格 #168 改造项 3「结构测试提速」的等价性判据载体）。
#
# 干什么：在一棵「注入了违例」的源码树上跑兜底闸（tools/structural-test.sh），把 21 条规则各自的
# 判红与判绿输出归一化成「规则名 + 消息」的逐行快照，供改造前后逐字节比对（#176）。
# 为什么必须注入违例：干净树全绿，空集比对空集等于恒等，证明不了任何事。
#
# 用法：
#   tools/structural-snapshot/collect.sh <闸脚本路径> <输出目录> [场景id,场景id]
# 例：
#   tools/structural-snapshot/collect.sh tools/structural-test.sh tools/structural-snapshot/baseline
#   tools/structural-snapshot/collect.sh /tmp/new-gate.sh /tmp/snap-new clean,rule-case-deps
#
# 第三个参数是可选的场景过滤器（逗号分隔的场景 id），不带 = 采全部场景。
#
# 闸路径可以指向仓库外的另一个版本（改造后的闸）。闸用 BASH_SOURCE 推导仓库根
# （docs/research/structural-test-speedup.md §4.8 记了这个坑），所以「在同一棵树上跑另一个版本
# 的闸」只能把那个版本临时装到 $ROOT/tools/structural-test.sh 上跑：本脚本先逐字节备份在位闸，
# 采完在 EXIT trap 里逐字节还原并 cmp 校验；还原不成立即非 0 退出并留下备份路径。
# 传入的闸路径就等于在位闸时不做替换。
#
# 产物格式：每个场景一个 <场景id>.snapshot，纯文本，可直接 diff。
#   以「# 」开头的头行 = 场景元数据。头行不含时间戳、不含闸路径与闸版本——两个版本的闸
#   产物必须逐字节可比，任何版本相关信息都会污染比对（运行信息只打到标准输出）。
#   ## rule-counts  规则名<TAB>判红条数<TAB>判绿条数（按规则名 LC_ALL=C 字典序）
#   ## fail-set     规则名<TAB>归一化判红消息（按整行 LC_ALL=C 字典序）
#   ## ok-set       规则名<TAB>归一化判绿消息（按整行 LC_ALL=C 字典序）
# 归一化三条：① 仓库绝对路径换成相对仓库根的路径；② 两个集合各自按 LC_ALL=C 字典序排序，
# 消除 find/grep 的遍历顺序影响；③ 消息体不做模糊化——它承载「为什么判红」，正是要比对的东西。
# 重复消息保留（多重集，不去重）：比集合更严，改造后少报一条同样会被 diff 抓到。
# 规则名排序而非按闸的 RULES 数组顺序：RULES 数组换序不改变判定行为，不该造成 diff 红。
#
# 场景清单共 29 个，见下面的 SCENARIOS 数组，逐条注明注入的探针 id 与临时隐藏的路径。
# 违例写入复用 tools/structural-probe.sh 的 write_probe_* / tmp_write / cleanup 接口
# （#170 验证过的先例手法）：把探针脚本末尾的 main 调用摘掉后 source 进来直接调，
# 只依赖这三类接口，不依赖探针的主循环（并行票 #171 正在改主循环）。
#
# 输出目录：全量采集（不带第三个参数）会先清空目录里既有的 *.snapshot，保证产物集恰好等于场景集；
# 带过滤器时只写被选中的场景，不动其余文件。
#
# 前置条件：工作树必须干净（git status --porcelain 为空；tools/structural-snapshot/ 与输出目录
# 除外，采集脚本与快照产物就住在那里）。每个场景采完都断言工作树状态与采集前逐字一致，
# 不一致立即失败退出——不允许把探针残留带进下一个场景或带进提交。
#
# 退出码：0 = 全部场景采集完成且工作树还原干净；非 0 = 采集失败或还原不成立。
# 依赖：宿主侧纯源码扫描，无容器、无网络。bash 3.2 兼容语法。
# 耗时：单次闸约 12 秒，全部 29 个场景一轮约 6 分钟。
set -uo pipefail

SELF_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
ROOT="$(cd "$SELF_DIR/../.." && pwd)"
MY_ROOT="$ROOT"   # 载入探针接口后 ROOT 会被探针改写，这里留一份权威值
TREE_GATE="$ROOT/tools/structural-test.sh"
PROBE="$ROOT/tools/structural-probe.sh"

# ---------- 场景表 ----------
# 记录格式：场景id|注入的探针id（逗号分隔，空 = 不注入）|临时隐藏的仓库相对路径（逗号分隔，空 = 不删）
# 「隐藏」= 先 cp -a 到 /tmp 备份再 rm -rf，采完还原（文件缺失场景专用）。
SCENARIOS=(
  # S1 无违例基线：21 条规则全绿，空判红集合，作为其余场景的对照物。
  "clean||"

  # S2 每条规则各一个最小违例，21 轮。探针 id 取自 tools/structural-probe.sh 的 SPECS。
  #    #170 的构造纪律是「每条违例在全闸下只命中目标规则一条」，唯一例外是
  #    module-public-entry：深路径导入同时命中 case-deps 的「表内依赖形态违规」
  #    （docs/research/structural-test-speedup.md §4.1 实测记录的交叉），
  #    这正是逐规则归因要抓的形态，快照把两条都记下来。
  "rule-shield-single-entry|shield-single-entry|"
  "rule-shield-no-business-dep|shield-no-business-dep|"
  "rule-identity-deps|identity-deps|"
  "rule-geo-dict-deps|geo-dict-deps|"
  "rule-case-deps|case-deps|"
  "rule-approval-deps|approval-deps|"
  "rule-supervision-deps|supervision-deps|"
  "rule-supervision-sink|supervision-sink-sh|"
  "rule-deadline-deps|deadline-deps|"
  "rule-module-public-entry|module-public-entry|"
  "rule-frontend-boundary|frontend-boundary|"
  "rule-weak-reference-entry|weak-reference-entry|"
  "rule-g1-model-allowlist|g1-model-allowlist|"
  "rule-queue-facility-entry|queue-in-integration|"
  "rule-storage-facility-entry|storage-facility-entry|"
  "rule-audit-facility-entry|audit-facility-entry|"
  "rule-spatial-no-orm-mutation|spatial-orm-chain|"
  "rule-runtime-manifest|compose-literal-secret|"
  "rule-user-lock-assertions|user-lock-assertion-deleted|"
  "rule-frontend-router-mode|frontend-browser-router|"
  "rule-screenshot-full-set|screenshot-full-set|"

  # S3 多规则交叉：多条违例同时注入，验证「一条违例归属哪几条规则」在多元素集合下仍逐条可辨。
  #    cross-import-family：import 家族 9 条规则（shield-no-business-dep + 6 条 *-deps +
  #      supervision-sink + module-public-entry）加 weak-reference-entry 同时判红。
  #      这是 #176 提速改造（共享导入索引 + realpath 批量化）的主战场，一轮跑出全部相关规则。
  "cross-import-family|shield-no-business-dep,identity-deps,geo-dict-deps,case-deps,approval-deps,supervision-deps,deadline-deps,supervision-sink-sh,module-public-entry,weak-reference-entry|"
  #    cross-deep-path：三个不同根（backend/case、integration 豁免名单外、backend/server 启动包）
  #      的深路径导入同时注入，module-public-entry 的判红集合含 3 条元素，
  #      验证同一规则内多元素的排序与逐条归因。
  "cross-deep-path|module-public-entry,exempt-tightness,server-adapter-file|"
  #    cross-manifest-and-forms：runtime-manifest 的两个被核对文件（compose 与 CI）各注入一条，
  #      加上设施入口类与形态类规则（queue/storage/audit/spatial/frontend-boundary）。
  #      runtime-manifest 不属本轮提速范围（规格明列排除），采它是为了守住「排除项也没被改动」。
  "cross-manifest-and-forms|compose-unlisted-name,ci-literal-secret,queue-in-integration,spatial-in-integration,spatial-orm-chain,audit-facility-entry,storage-facility-entry,frontend-boundary|"
  #    cross-all-rules：21 条规则一次全判红（每条规则各取一条违例，探针落点互不撞同一个文件）。
  #      最大噪声下的归属断言：每条规则的判红集合仍须逐条可辨、可排序、可计数。
  "cross-all-rules|shield-single-entry,shield-no-business-dep,identity-deps,geo-dict-deps,case-deps,approval-deps,supervision-deps,supervision-sink-sh,deadline-deps,module-public-entry,frontend-boundary,weak-reference-entry,g1-model-allowlist,queue-in-integration,storage-facility-entry,audit-facility-entry,spatial-orm-chain,spatial-in-integration,compose-unlisted-name,ci-env-context,user-lock-assertion-deleted,frontend-browser-router,frontend-router-dev-plugin,screenshot-full-set|"

  # S4 文件缺失场景，各一轮（规格要求三条语义分别保留，不得统一化）：
  #    模块目录缺失 → check_row 判**绿**（语义上的空真）
  #    schema.prisma 缺失 → g1-model-allowlist 判**绿**（无模型 = 无 G1 越界）
  #    compose 文件缺失 → runtime-manifest 判**红**（清单与部署形态脱节，不是空真）
  #    三者的判红与判绿文案本身就是判据的一部分，故 ok-set 与 fail-set 都进快照。
  "missing-module-dir||backend/geo-dict"
  "missing-schema||backend/prisma/schema.prisma"
  "missing-compose||infra/docker-compose.yml"
)

usage() {
  cat <<EOF
用法：$0 <闸脚本路径> <输出目录> [场景id,场景id]

  闸脚本路径   tools/structural-test.sh 的路径（可指向仓库外的另一个版本）
  输出目录     快照写入目录，每个场景一个 <场景id>.snapshot
  场景id列表   可选，逗号分隔；不带 = 采全部 ${#SCENARIOS[@]} 个场景

场景清单：
EOF
  local spec sid
  for spec in "${SCENARIOS[@]}"; do
    sid="${spec%%|*}"
    echo "  $sid"
  done
}

die() { echo "[失败] $1" >&2; exit 1; }

[ "$#" -ge 2 ] || { usage >&2; exit 2; }
GATE_ARG="$1"
OUT_DIR="$2"
ONLY="${3:-}"

[ -f "$GATE_ARG" ] || die "闸脚本不存在：$GATE_ARG"
[ -f "$TREE_GATE" ] || die "在位兜底闸不存在：$TREE_GATE"
[ -f "$PROBE" ] || die "探针脚本不存在：$PROBE"

# 场景过滤器校验：写错的场景 id 必须立即报错，不许静默采成空集
if [ -n "$ONLY" ]; then
  old_ifs="$IFS"; IFS=','
  for want in $ONLY; do
    IFS="$old_ifs"
    found=0
    for spec in "${SCENARIOS[@]}"; do
      [ "${spec%%|*}" = "$want" ] && found=1 && break
    done
    [ "$found" -eq 1 ] || die "过滤器里的场景 id 不存在：$want（用不带参数的调用看场景清单）"
    IFS=','
  done
  IFS="$old_ifs"
fi

want_scenario() { # $1 = 场景id
  [ -z "$ONLY" ] && return 0
  case ",$ONLY," in *",$1,"*) return 0 ;; esac
  return 1
}

# ---------- 工作区与还原机制 ----------
WORK="$(mktemp -d "${TMPDIR:-/tmp}/structural-snapshot-XXXXXX")" || die "创建临时工作区失败"
HIDE_DIR="$WORK/hidden"
GATE_BACKUP="$WORK/gate-in-place.sh"
GATE_SWAPPED=0
BASE_STATUS=""
HIDDEN=()

restore_hidden() { # 幂等：把隐藏（临时删除）的路径逐个还原
  local rel
  if [ "${#HIDDEN[@]}" -eq 0 ]; then return 0; fi
  for rel in "${HIDDEN[@]}"; do
    [ -e "$HIDE_DIR/$rel" ] || { echo "[失败] 备份丢失，无法还原：$rel" >&2; continue; }
    rm -rf "$ROOT/$rel"
    mkdir -p "$(dirname "$ROOT/$rel")"
    cp -a "$HIDE_DIR/$rel" "$ROOT/$rel" || echo "[失败] 还原失败：$rel" >&2
  done
  HIDDEN=()
}

hide_path() { # $1 = 相对仓库根的路径（文件或目录）；先 cp -a 备份到 /tmp 再删
  local rel="$1" src dst
  src="$ROOT/$rel"
  dst="$HIDE_DIR/$rel"
  [ -e "$src" ] || die "要隐藏的路径不存在：$rel"
  mkdir -p "$(dirname "$dst")"
  cp -a "$src" "$dst" || die "备份失败：$rel"
  HIDDEN+=("$rel")
  rm -rf "$src"
}

on_exit() {
  local rc=$? keep=0
  trap - EXIT INT TERM
  cleanup 2>/dev/null || true    # 探针的还原（幂等，探针自己也在 EXIT 上挂了它）
  restore_hidden
  if [ "$GATE_SWAPPED" -eq 1 ]; then
    cp -a "$GATE_BACKUP" "$TREE_GATE" 2>/dev/null || true
    if cmp -s "$GATE_BACKUP" "$TREE_GATE"; then :; else
      echo "[失败] 在位闸未能逐字节还原：$TREE_GATE（备份保留在 $GATE_BACKUP）" >&2
      keep=1
    fi
  fi
  if [ "$keep" -eq 0 ] && [ "$rc" -eq 0 ] && [ -d "$WORK" ]; then
    rm -rf "$WORK"
  elif [ -d "$WORK" ]; then
    echo "[提示] 采集未成功，临时工作区（含闸原始输出与备份）保留在：$WORK" >&2
    [ "$GATE_SWAPPED" -eq 1 ] && echo "[提示] 在位闸备份：$GATE_BACKUP（还原目标：$TREE_GATE）" >&2
  fi
  exit "$rc"
}

# ---------- 载入探针的违例写入接口 ----------
# 手法（#170 先例）：摘掉探针末尾的 main 调用后 source，直接调 write_probe_*。
# 探针把 ROOT 定义成「自身所在目录的上一级」，副本在 /tmp 会算错根，故 source 后立刻改回本仓库根。
# 两道保险：① 摘除后复查残留的 main 调用；② source 时把输出接到文件——探针接口定义本身不产生
# 任何输出，一旦有输出就说明 main 跑起来了（并行票 #171 正在改探针，接口形态变了要立刻炸）。
PROBE_LIB="$WORK/probe-lib.sh"
sed '/^[[:space:]]*main[[:space:]]/d' "$PROBE" > "$PROBE_LIB" || die "摘除探针 main 调用失败"
grep -qE '^[[:space:]]*main[[:space:]]' "$PROBE_LIB" && die "探针的 main 调用没摘干净：$PROBE_LIB"
probe_funcs="$(grep -cE '^write_probe_' "$PROBE_LIB")"
[ "$probe_funcs" -gt 0 ] || die "探针里没找到 write_probe_* 函数，接口形态变了：$PROBE"
. "$PROBE_LIB" > "$WORK/probe-source.out" 2>&1 || die "载入探针违例写入接口失败：$PROBE_LIB"
if [ -s "$WORK/probe-source.out" ]; then
  cat "$WORK/probe-source.out" >&2
  die "载入探针接口时产生了输出（上面这些），说明探针的 main 调用没摘干净"
fi
ROOT="$MY_ROOT"
for fn in tmp_write cleanup; do
  [ "$(type -t "$fn")" = "function" ] || die "探针缺接口函数：$fn"
done

mkdir -p "$OUT_DIR" || die "创建输出目录失败：$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"

# 「工作树干净」的口径：除本脚本自己的目录 tools/structural-snapshot/（采集脚本与快照产物都住在
# 那里，采集期间必然有未跟踪或已改动的文件）与输出目录之外，仓库其余部分必须一尘不染。
# 排除用 git 的 pathspec 而非事后 grep：git 会把未跟踪目录折叠成一行，grep 匹配不到里面的残留。
STATUS_ARGS=(status --porcelain -- . ':(exclude)tools/structural-snapshot')
case "$OUT_DIR" in
  "$ROOT"/*) STATUS_ARGS+=(":(exclude)${OUT_DIR#"$ROOT"/}") ;;
esac
tree_status() { git -C "$ROOT" "${STATUS_ARGS[@]}"; }

# 采集前工作树必须干净：否则「还原干净」这条断言失去基准，也分不清残留是谁留下的
pre_status="$(tree_status)" || die "读取工作树状态失败"
if [ -n "$pre_status" ]; then
  printf '%s\n' "$pre_status" >&2
  die "工作树不干净（tools/structural-snapshot/ 与输出目录除外），先处理上面这些改动再采集"
fi

# 全量采集时先清空输出目录里既有的快照：产物集必须恰好等于场景集。
# 否则上一次留下的旧场景文件会在 #176 的 diff -r 里冒充「本次也采到了」。
if [ -z "$ONLY" ]; then
  stale_count="$(find "$OUT_DIR" -maxdepth 1 -type f -name '*.snapshot' | grep -c .)"
  if [ "$stale_count" -gt 0 ]; then
    find "$OUT_DIR" -maxdepth 1 -type f -name '*.snapshot' -delete || die "清空旧快照失败：$OUT_DIR"
    echo "[准备] 输出目录里既有的 $stale_count 个 .snapshot 已清空"
  fi
fi

# 还原 trap 必须先于任何换入动作注册：换入 cp 中途失败、或该窗口内收到 INT/TERM，
# 在位闸也要由 on_exit 自动还原。on_exit 仅在 GATE_SWAPPED=1（备份已就绪）时才动在位闸，
# 故对不换闸的路径与备份完成前的失败均无副作用。
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# 需要跑另一个版本的闸时，临时替换在位闸（闸自己从自身位置推导仓库根）
GATE_ABS="$(readlink -f "$GATE_ARG")"
if [ "$GATE_ABS" != "$(readlink -f "$TREE_GATE")" ]; then
  cp -a "$TREE_GATE" "$GATE_BACKUP" || die "备份在位闸失败"
  # 备份就绪 = 还原责任生效：自此任何一步失败或被打断，on_exit 都逐字节还原在位闸
  GATE_SWAPPED=1
  cp "$GATE_ABS" "$TREE_GATE" || die "装入待测闸失败：$GATE_ABS（在位闸备份：$GATE_BACKUP）"
  chmod +x "$TREE_GATE"
  echo "[准备] 在位闸已临时替换为：$GATE_ABS（采完逐字节还原）"
fi

# 基准状态在替换闸之后取：被临时替换的在位闸不算「残留」（还原由 on_exit 的 cmp 校验兜住）
BASE_STATUS="$(tree_status)"

assert_tree_clean() { # $1 = 场景id
  local now
  now="$(tree_status)"
  [ "$now" = "$BASE_STATUS" ] && return 0
  echo "[失败] 场景 $1 还原后工作树状态与采集前不一致（差异如下）：" >&2
  diff <(printf '%s\n' "$BASE_STATUS") <(printf '%s\n' "$now") >&2 || true
  exit 1
}

# ---------- 快照生成 ----------
make_snapshot() { # $1=场景id $2=闸原始输出 $3=闸退出码 $4=注入列表 $5=隐藏列表 $6=输出快照路径
  local sid="$1" raw="$2" rc="$3" inject="$4" hide="$5" out="$6"
  local fail_tsv ok_tsv counts rule_count fail_count ok_count

  fail_tsv="$WORK/$sid.fail.tsv"
  ok_tsv="$WORK/$sid.ok.tsv"
  counts="$WORK/$sid.counts.tsv"
  : > "$fail_tsv"
  : > "$ok_tsv"

  # 抽 [FAIL]/[OK] 行 → 规则名<TAB>消息；同时把仓库绝对路径归一化成相对仓库根路径。
  # LC_ALL=C：awk 与 sort 全按字节处理，跨机器跨环境结果一致。
  LC_ALL=C awk -v ROOTSLASH="$ROOT/" -v FAILF="$fail_tsv" -v OKF="$ok_tsv" '
    function relpath(s,   p) {
      while ((p = index(s, ROOTSLASH)) > 0) {
        s = substr(s, 1, p - 1) substr(s, p + length(ROOTSLASH))
      }
      return s
    }
    function emit(kind, line,   p, seplen, rule, msg) {
      line = relpath(line)
      p = index(line, "："); seplen = length("：")
      if (p == 0) { p = index(line, ":"); seplen = 1 }
      if (p == 0) { rule = line; msg = "" }
      else { rule = substr(line, 1, p - 1); msg = substr(line, p + seplen) }
      if (kind == "F") { printf "%s\t%s\n", rule, msg > (FAILF) }
      else { printf "%s\t%s\n", rule, msg > (OKF) }
    }
    # 前缀用 sub 剥掉而不按固定列宽切：闸的 "[OK]" 后是 3 个空格、"[FAIL]" 后是 1 个，
    # 写死偏移量会在闸改对齐时静默错位。
    /^\[FAIL\][ ]/ { line = $0; sub(/^\[FAIL\][ ]+/, "", line); emit("F", line); next }
    /^\[OK\][ ]/ { line = $0; sub(/^\[OK\][ ]+/, "", line); emit("O", line); next }
  ' "$raw" || die "解析闸输出失败：$raw"

  LC_ALL=C sort "$fail_tsv" > "$WORK/$sid.fail.sorted" || die "排序判红集合失败：$sid"
  LC_ALL=C sort "$ok_tsv" > "$WORK/$sid.ok.sorted" || die "排序判绿集合失败：$sid"

  { awk -F'\t' '{ print "F\t" $1 }' "$WORK/$sid.fail.sorted"
    awk -F'\t' '{ print "O\t" $1 }' "$WORK/$sid.ok.sorted"
  } | LC_ALL=C awk -F'\t' '
      { rules[$2] = 1; if ($1 == "F") { f[$2]++ } else { o[$2]++ } }
      END { for (r in rules) { printf "%s\t%d\t%d\n", r, f[r], o[r] } }
    ' | LC_ALL=C sort > "$counts" || die "统计逐规则条数失败：$sid"

  rule_count="$(grep -c . "$counts")"
  fail_count="$(grep -c . "$WORK/$sid.fail.sorted")"
  ok_count="$(grep -c . "$WORK/$sid.ok.sorted")"
  [ "$rule_count" -gt 0 ] || die "场景 $sid 的闸输出里没有任何 [OK]/[FAIL] 行，采集不成立（闸原始输出：$raw）"

  {
    printf '%s\n' \
      "# 结构测试逐规则判红集合快照（父规格 #168 改造项 3 的等价性判据载体；采集者 tools/structural-snapshot/collect.sh）" \
      "# format: structural-snapshot/1" \
      "# scenario: $sid" \
      "# inject: ${inject:--}" \
      "# hide: ${hide:--}" \
      "# gate-exit-code: $rc" \
      "# rule-count: $rule_count" \
      "# fail-line-count: $fail_count" \
      "# ok-line-count: $ok_count" \
      "## rule-counts"
    cat "$counts"
    printf '%s\n' "## fail-set"
    cat "$WORK/$sid.fail.sorted"
    printf '%s\n' "## ok-set"
    cat "$WORK/$sid.ok.sorted"
  } > "$out" || die "写快照失败：$out"

  echo "[采集] 场景 $sid：规则 $rule_count 条，判红 $fail_count 条，判绿 $ok_count 条，闸退出码 $rc → ${out#"$ROOT"/}"
}

# ---------- 主循环 ----------
echo "快照采集开始"
echo "  仓库根：$ROOT"
echo "  闸：$GATE_ABS$([ "$GATE_SWAPPED" -eq 1 ] && echo '（临时替换在位闸）')"
echo "  输出目录：$OUT_DIR"
echo "  场景过滤器：${ONLY:-无（全部场景）}"

done_count=0
for spec in "${SCENARIOS[@]}"; do
  IFS='|' read -r sid inject hide <<< "$spec"
  want_scenario "$sid" || continue

  if [ -n "$inject" ]; then
    old_ifs="$IFS"; IFS=','
    for pid in $inject; do
      IFS="$old_ifs"
      [ "$(type -t "write_probe_$pid")" = "function" ] \
        || die "场景 $sid 要注入的探针不存在：write_probe_$pid（探针接口形态变了）"
      "write_probe_$pid"
      IFS=','
    done
    IFS="$old_ifs"
  fi
  if [ -n "$hide" ]; then
    old_ifs="$IFS"; IFS=','
    for rel in $hide; do
      IFS="$old_ifs"
      hide_path "$rel"
      IFS=','
    done
    IFS="$old_ifs"
  fi

  "$TREE_GATE" > "$WORK/$sid.raw" 2>&1
  gate_rc=$?

  cleanup          # 探针的还原：删临时违例文件 + 逐字节还原就地改写的文件
  restore_hidden   # 还原临时隐藏（删除）的路径
  assert_tree_clean "$sid"

  make_snapshot "$sid" "$WORK/$sid.raw" "$gate_rc" "$inject" "$hide" "$OUT_DIR/$sid.snapshot"
  done_count=$((done_count + 1))
done

[ "$done_count" -gt 0 ] || die "一个场景都没采到（过滤器：${ONLY:-无}）"
echo "快照采集完成：$done_count 个场景 → $OUT_DIR"
