#!/usr/bin/env bash
# 结构测试设施（#50 最小规则集；全量七模块依赖矩阵归 #51）。
# 规则 = #47 依赖矩阵的机器可执行断言；任一规则红即整体非 0 退出（接入 dev lint，
# 与 ESLint/依赖漏入库检查并列，构成「失败即构建失败」的本地 CI 等价闸）。
#
# 扩展方式（#51 全量矩阵）：新增一个 check_<规则名>() 函数（输出 [OK]/[FAIL] 行），
# 并将其名追加到 RULES 数组即可；规则函数只读仓库源码，不依赖容器或网络。
#
# 规则清单：
#   shield-single-entry  shield 公共出口仅 packages/shield/src/index.ts——shield 之外
#                        任何源码不得引用 shield 内部路径（相对深路径或 shield/ 子路径
#                        包名导入均属绕过出口）。
#   （规则 b「依赖漏入库」由 dev lint 既有检查承载，本设施不重复实现——dev lint 两处
#     先后执行，任一红即整体红。）
set -uo pipefail

ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"

# 业务源码根目录（tools/、dev、infra、docs 不在扫描范围：规则约束的是代码互引）
SCAN_ROOTS=("$ROOT/backend" "$ROOT/frontend" "$ROOT/e2e" "$ROOT/packages")
SCAN_INCLUDES=(
  --include='*.ts' --include='*.tsx' --include='*.mts' --include='*.cts'
  --include='*.js' --include='*.jsx' --include='*.mjs' --include='*.cjs'
)

RULES=(shield-single-entry)
FAIL=0

note_ok()   { echo "[OK]   $1"; }
note_fail() { echo "[FAIL] $1"; FAIL=1; }

# 提取扫描命中：grep -o 输出 `文件:行号:带引号命中串`，去引号后逐条判定
scan_hits() {
  grep -rEno "${SCAN_INCLUDES[@]}" \
      -e "['\"]shield/[^'\"]*['\"]" \
      -e "['\"][^'\"]*packages/shield/src/[^'\"]*['\"]" \
      "${SCAN_ROOTS[@]}" 2>/dev/null
}

# 规则 a：shield 唯一出口（#47 用户故事 4 / E5 后半）
check_shield-single-entry() {
  local hits=0 line file where spec
  while IFS= read -r line; do
    file="${line%%:*}"
    where="${line#*:}"; where="${where%%:*}"
    spec="${line#*:*:}"
    spec="${spec#?}"; spec="${spec%?}" # 去首尾引号
    case "$spec" in
      packages/shield/src/index|packages/shield/src/index.js|packages/shield/src/index.ts) continue ;;
    esac
    note_fail "shield-single-entry：绕过公共出口的引用  ${file#"$ROOT"/}:$where → $spec"
    hits=$((hits + 1))
  done < <(scan_hits)
  if [ "$hits" -eq 0 ]; then
    note_ok "shield-single-entry：shield 之外无绕过 src/index.ts 的引用"
  fi
}

echo "结构测试（#50 最小规则集；全量七模块矩阵归 #51）"
for rule in "${RULES[@]}"; do
  "check_$rule"
done
echo
if [ "$FAIL" -eq 0 ]; then
  echo "结构测试：全部规则通过。"
else
  echo "结构测试：存在失败规则，详见上方标红行。" >&2
fi
exit "$FAIL"
