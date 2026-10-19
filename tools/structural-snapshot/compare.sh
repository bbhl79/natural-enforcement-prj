#!/usr/bin/env bash
# 兜底闸逐规则判红集合快照比对（#176；父规格 #168 改造项 3 的等价性判据执行者）。
#
# 干什么：把候选快照目录与基线快照目录逐场景比对，判据是「逐字节相同」。
# 不一致时按规则归因输出：规则名 ｜ 期望 N 条，实得 M 条 ｜ 差异明细，
# 让看 diff 的人第一眼知道是哪条规则的判红集合变了（依据 docs/research/structural-test-speedup.md §4.6）。
#
# 用法：
#   tools/structural-snapshot/compare.sh <基线目录> <候选目录> [场景id,场景id]
# 例：
#   tools/structural-snapshot/compare.sh tools/structural-snapshot/baseline /tmp/t176-after
#   tools/structural-snapshot/compare.sh tools/structural-snapshot/baseline /tmp/t176-after clean,cross-import-family
#
# 比对四项（对应规格「规则集合相同、每条规则判红集合逐字节相同、红绿分布相同、退出码相同」）：
#   ① 场景文件集合相同（基线独有/候选独有的场景各自点名）；
#   ② 每个场景的快照文件逐字节相同（cmp）；
#   ③ 快照里的规则集合与在位闸的 --list-rules 逐字相等（21 条不多不少）；
#   ④ 逐字节不同时，退出码、rule-counts（红绿分布）、fail-set、ok-set 四项各自按规则归因。
#
# 判定以基线为准：候选与基线不同即不通过，脚本不猜谁对。基线本身若有误，另开修正票单独合入
# （规格 #168 改造项 3 护栏：在提速改造里顺手改基线会让等价性验证自证失效）。
#
# 退出码：0 = 全部选中场景逐字节相同且规则集合成立；1 = 存在不一致；2 = 用法或环境不成立。
# 依赖：宿主侧纯文本比对，无容器、无网络。bash 3.2 兼容语法（不用关联数组）。
set -uo pipefail

SELF_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
ROOT="$(cd "$SELF_DIR/../.." && pwd)"
TREE_GATE="$ROOT/tools/structural-test.sh"
DETAIL_LIMIT=3      # 每条规则每个方向最多打几条明细（其余只报条数）

usage() {
  cat <<EOF
用法：$0 <基线目录> <候选目录> [场景id,场景id]

  基线目录     改造前入库的快照目录（tools/structural-snapshot/baseline）
  候选目录     改造后采集的快照目录（tools/structural-snapshot/collect.sh 的产物）
  场景id列表   可选，逗号分隔；不带 = 比两边共有的全部 *.snapshot
EOF
}

die() { echo "[失败] $1" >&2; exit 2; }

[ "$#" -ge 2 ] || { usage >&2; exit 2; }
BASE_DIR="$1"
CAND_DIR="$2"
ONLY="${3:-}"
[ -d "$BASE_DIR" ] || die "基线目录不存在：$BASE_DIR"
[ -d "$CAND_DIR" ] || die "候选目录不存在：$CAND_DIR"
[ -f "$TREE_GATE" ] || die "在位兜底闸不存在：$TREE_GATE"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/snapshot-compare-XXXXXX")" || die "创建临时工作区失败"
trap 'rm -rf "$WORK"' EXIT

# 快照的三个数据段各自抽出来（段标记 = collect.sh 定的 ## 头行）
section() { # $1=快照文件 $2=段名（rule-counts/fail-set/ok-set） $3=输出文件
  LC_ALL=C awk -v want="## $2" '
      $0 == want { insec = 1; next }
      /^## / { insec = 0 }
      insec { print }
    ' "$1" | LC_ALL=C sort > "$3"
}
header_of() { sed -n "s/^# $2: //p" "$1"; }   # $1=快照文件 $2=头行键

# 在位闸的规则集合（单一事实源 = RULES 数组，经只读模式取，不解析闸源码）
GATE_RULES="$WORK/gate-rules"
"$TREE_GATE" --list-rules | LC_ALL=C sort -u > "$GATE_RULES" || die "取不到在位闸的规则清单"
gate_rule_count="$(grep -c . "$GATE_RULES")"

scenario_ids() { # $1=目录：列出目录里 *.snapshot 的场景 id（已排序）
  find "$1" -maxdepth 1 -type f -name '*.snapshot' -printf '%f\n' 2>/dev/null \
    | sed 's/\.snapshot$//' | LC_ALL=C sort
}

scenario_ids "$BASE_DIR" > "$WORK/base-ids"
scenario_ids "$CAND_DIR" > "$WORK/cand-ids"

# 选中场景 = 过滤器 ∩ 两边并集；过滤器里写错的场景 id 必须立即报错，不许静默比成「全通过」
if [ -n "$ONLY" ]; then
  : > "$WORK/want-ids"
  old_ifs="$IFS"; IFS=','
  for want in $ONLY; do
    IFS="$old_ifs"
    if ! grep -qxF -- "$want" "$WORK/base-ids" || ! grep -qxF -- "$want" "$WORK/cand-ids"; then
      die "过滤器里的场景在某一侧没有快照：$want（基线侧与候选侧都要有）"
    fi
    printf '%s\n' "$want" >> "$WORK/want-ids"
    IFS=','
  done
  IFS="$old_ifs"
  LC_ALL=C sort -u "$WORK/want-ids" > "$WORK/ids"
else
  LC_ALL=C sort -u "$WORK/base-ids" "$WORK/cand-ids" > "$WORK/ids"
fi

# ① 场景文件集合。带过滤器时只比选中的场景（过滤器校验已要求两侧都有该场景的快照），
# 否则「候选目录只采了子集」会被误报成不一致。
missing_in_cand=""
missing_in_base=""
if [ -z "$ONLY" ]; then
  missing_in_cand="$(LC_ALL=C comm -23 "$WORK/base-ids" "$WORK/cand-ids" | tr '\n' ' ' | sed 's/ $//')"
  missing_in_base="$(LC_ALL=C comm -13 "$WORK/base-ids" "$WORK/cand-ids" | tr '\n' ' ' | sed 's/ $//')"
fi

echo "快照比对开始"
echo "  基线目录：$BASE_DIR"
echo "  候选目录：$CAND_DIR"
echo "  在位闸规则集合：$gate_rule_count 条（$TREE_GATE --list-rules）"
echo "  比对场景：$(grep -c . "$WORK/ids") 个"
if [ -n "$missing_in_cand" ]; then
  echo "  [不一致] 基线有、候选没有的场景：$missing_in_cand"
fi
if [ -n "$missing_in_base" ]; then
  echo "  [不一致] 候选有、基线没有的场景：$missing_in_base"
fi

# 逐规则归因的集合差异报告：$1=集合名 $2=基线段文件 $3=候选段文件
report_set_diff() {
  local label="$1" bf="$2" cf="$3"
  local only_base="$WORK/only-base" only_cand="$WORK/only-cand"
  local b_n c_n rules rule detail n exp got
  LC_ALL=C comm -23 "$bf" "$cf" > "$only_base"
  LC_ALL=C comm -13 "$bf" "$cf" > "$only_cand"
  [ -s "$only_base" ] || [ -s "$only_cand" ] || return 0
  b_n="$(grep -c . "$bf" || true)"
  c_n="$(grep -c . "$cf" || true)"
  echo "    ${label}集合合计 ｜ 期望 ${b_n} 条，实得 ${c_n} 条"
  rules="$(cut -f1 "$only_base" "$only_cand" 2>/dev/null | grep . | LC_ALL=C sort -u)"
  while IFS= read -r rule; do
    [ -n "$rule" ] || continue
    exp="$(awk -F'\t' -v r="$rule" '$1 == r' "$bf" | grep -c . || true)"
    got="$(awk -F'\t' -v r="$rule" '$1 == r' "$cf" | grep -c . || true)"
    detail=""
    n="$(awk -F'\t' -v r="$rule" '$1 == r' "$only_base" | grep -c . || true)"
    if [ "$n" -gt 0 ]; then
      detail="基线独有 ${n} 条（$(awk -F'\t' -v r="$rule" -v lim="$DETAIL_LIMIT" \
        '$1 == r { if (++k <= lim) printf "%s%s", (k > 1 ? " ；" : ""), substr($0, index($0, "\t") + 1) }' \
        "$only_base")）"
    fi
    n="$(awk -F'\t' -v r="$rule" '$1 == r' "$only_cand" | grep -c . || true)"
    if [ "$n" -gt 0 ]; then
      detail="${detail:+$detail；}候选独有 ${n} 条（$(awk -F'\t' -v r="$rule" -v lim="$DETAIL_LIMIT" \
        '$1 == r { if (++k <= lim) printf "%s%s", (k > 1 ? " ；" : ""), substr($0, index($0, "\t") + 1) }' \
        "$only_cand")）"
    fi
    echo "    ${rule} ｜ 期望 ${exp} 条，实得 ${got} 条 ｜ ${detail:-无明细}"
  done <<< "$rules"
}

bad=0
[ -n "$missing_in_cand$missing_in_base" ] && bad=1

# ②③④ 逐场景比对
while IFS= read -r sid; do
  [ -n "$sid" ] || continue
  bsnap="$BASE_DIR/$sid.snapshot"
  csnap="$CAND_DIR/$sid.snapshot"
  if [ ! -f "$bsnap" ] || [ ! -f "$csnap" ]; then
    echo "  [不一致] $sid ｜ 一侧缺快照文件（基线：$([ -f "$bsnap" ] && echo 有 || echo 无)，候选：$([ -f "$csnap" ] && echo 有 || echo 无)）"
    bad=1
    continue
  fi

  # ③ 规则集合与在位闸逐字相等（两侧都查：基线腐化与候选漏规则都要抓）
  for side in base cand; do
    [ "$side" = base ] && snap="$bsnap" || snap="$csnap"
    section "$snap" rule-counts "$WORK/$side-counts"
    cut -f1 "$WORK/$side-counts" | LC_ALL=C sort -u > "$WORK/$side-rules"
    if ! cmp -s "$GATE_RULES" "$WORK/$side-rules"; then
      echo "  [不一致] $sid ｜ ${side} 侧快照的规则集合与在位闸的 $gate_rule_count 条不相等 ｜ 闸有快照无：$(LC_ALL=C comm -23 "$GATE_RULES" "$WORK/$side-rules" | tr '\n' ' ')；快照有闸无：$(LC_ALL=C comm -13 "$GATE_RULES" "$WORK/$side-rules" | tr '\n' ' ')"
      bad=1
    fi
  done

  # ② 逐字节相同 = 通过判据
  if cmp -s "$bsnap" "$csnap"; then
    echo "  [一致] $sid ｜ 逐字节相同（规则 $(cut -f1 "$WORK/base-counts" | grep -c .) 条，判红 $(header_of "$bsnap" fail-line-count) 条，闸退出码 $(header_of "$bsnap" gate-exit-code)）"
    continue
  fi
  bad=1
  echo "  [不一致] $sid ｜ 快照逐字节不同，按规则归因如下"
  b_rc="$(header_of "$bsnap" gate-exit-code)"
  c_rc="$(header_of "$csnap" gate-exit-code)"
  if [ "$b_rc" != "$c_rc" ]; then
    echo "    闸退出码 ｜ 期望 $b_rc，实得 $c_rc"
  fi
  # 红绿分布（rule-counts 段：规则名<TAB>判红条数<TAB>判绿条数）
  if ! cmp -s "$WORK/base-counts" "$WORK/cand-counts"; then
    LC_ALL=C comm -3 "$WORK/base-counts" "$WORK/cand-counts" | tr '\t' ' ' | sed 's/^/    红绿分布差异（判红 判绿）：/'
  fi
  for label in fail ok; do
    section "$bsnap" "$label-set" "$WORK/base-$label"
    section "$csnap" "$label-set" "$WORK/cand-$label"
    if [ "$label" = fail ]; then report_set_diff "判红" "$WORK/base-fail" "$WORK/cand-fail"
    else report_set_diff "判绿" "$WORK/base-ok" "$WORK/cand-ok"; fi
  done
done < "$WORK/ids"

if [ "$bad" -eq 0 ]; then
  echo "快照比对结论：$(grep -c . "$WORK/ids") 个场景全部与基线逐字节相同，规则集合与在位闸的 $gate_rule_count 条逐字相等。等价性成立。"
  exit 0
fi
echo "快照比对结论：存在不一致，判定以基线为准（改造未达等价）。" >&2
exit 1
