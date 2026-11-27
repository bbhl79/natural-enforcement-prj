#!/usr/bin/env bash
# ============================================================================
# 容器内供应链权限门禁（#63；workspace.Dockerfile deps 层在 frozen install 后调用）
#
# 规则（Spec-工程基座 §8；docs/agents/supply-chain.md）：
#   - allowBuilds 版本化审批：pnpm 对未批准的构建脚本直接失败（ERR_PNPM_IGNORED_BUILDS）。
#   - 包内 agent skills 默认不自动采纳：pnpm 仅链接显式批准（permissions.<pkg>.skills）
#     的依赖技能；任何待审批项必须视为待审并停止构建，不允许静默通过。
#
# 用法：check-permissions.sh [--root <dir>]（默认当前目录）
# 退出码：0 无待审批项；1 有待审批项或 pnpm 检查失败（fail-closed）。
# ============================================================================
set -Eeuo pipefail

root="."
while [[ $# -gt 0 ]]; do
  case "$1" in
    --root) root="${2:?--root 需要目录}"; shift 2;;
    -h|--help) sed -n '2,14p' "$0"; exit 0;;
    *) printf 'ERROR: 未知参数：%s（用法：check-permissions.sh [--root <dir>]）\n' "$1" >&2; exit 2;;
  esac
done

command -v pnpm >/dev/null 2>&1 || {
  printf 'ERROR: pnpm 不在 PATH，无法核对构建脚本/agent skills 审批状态\n' >&2
  exit 1
}

out=""
rc=0
out="$(cd "$root" && pnpm permissions list --reporter=append-only --no-progress 2>&1)" || rc=$?
if (( rc )); then
  printf 'ERROR: pnpm permissions list 失败（退出码 %s）；供应链门禁 fail-closed\n%s\n' "$rc" "$out" >&2
  exit 1
fi

# 提取 "Awaiting approval:" 段（到空行或 Run 结束）
pending="$(printf '%s\n' "$out" | awk '
  /^Awaiting approval:/ { inp=1; next }
  inp && /^[[:space:]]*$/ { inp=0 }
  inp && /^Run / { inp=0 }
  inp { print }
')"

if [[ -n "$pending" ]]; then
  printf 'ERROR: 依赖待审批（包内 agent skills / 构建脚本默认不自动采纳，告警视为待审）：\n%s\n' "$pending" >&2
  printf '修复：审查来源与内容后显式批准或拒绝（pnpm approve，或在 pnpm-workspace.yaml 写 permissions.*）；规则见 docs/agents/supply-chain.md\n' >&2
  exit 1
fi

printf '供应链权限检查通过：无待审批项（构建脚本已版本化批准，agent skills 未自动采纳）\n'
