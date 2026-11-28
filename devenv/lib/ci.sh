# shellcheck shell=bash
# ============================================================================
# CI 同构质量门库（#71；被 devenv/devenv source，不直接执行）
#
# 职责（Spec-工程基座 §6 质量门与 CI）：
#   - .github/workflows 静态门禁：workflow 中直接调用 compose（docker compose /
#     docker-compose / podman compose / podman-compose——含 CI 托管 runner 预装
#     podman 的绕过路径）即拒绝。CI 的项目操作必须经 devenv 唯一入口
#     （AGENTS.md 硬不变量），本地与 CI 同一校验器（doctor 检查项
#     ci-workflows）。
#   - 诚实口径（Spec §6 同款声明）：这是 workflow 文件内的静态反例拦截，
#     不是阻止——人可在终端手动绕过 devenv，不声称已阻止。
#
# 实现口径：逐行正则扫描（跳过整行注释）。不做 YAML 语义解析——静态门禁
# 只需捕获「写进 run 步骤的 compose 调用」反例，不声称语法级完备。
# ============================================================================

CI_WF_ERRORS=()
CI_WF_SCANNED=0

ci_workflow_reset() { CI_WF_ERRORS=(); CI_WF_SCANNED=0; }

# ci_workflow_scan <repo_root>
#   → rc 0 无违规（CI_WF_SCANNED=扫描的 workflow 文件数）
#   → rc 1 有违规（CI_WF_ERRORS=「相对路径:行号: 违规行」数组）
ci_workflow_scan() {
  local root="$1"
  local wf_dir="$root/.github/workflows"
  ci_workflow_reset
  [[ -d "$wf_dir" ]] || return 0
  # 插件形态：docker compose / podman compose。边界字符集不含 alnum/_/-/. 但
  # 含 `/`——路径限定形（/usr/bin/docker compose）同样违规；`-` 留在词内是
  # 为了 docker-compose 整词匹配（见下）。
  local re_plugin='(^|[^[:alnum:]._-])(docker|podman)[[:space:]]+compose([[:space:]]|$)'
  # 独立命令形态：docker-compose / podman-compose
  local re_legacy='(^|[^[:alnum:]._-])(docker|podman)-compose([^[:alnum:]._-]|$)'
  local f line trimmed lineno
  # 不用 mapfile（macOS 宿主 bash 3.2）；find -print0 + while-read -d '' 收集
  while IFS= read -r -d '' f; do
    CI_WF_SCANNED=$((CI_WF_SCANNED + 1))
    lineno=0
    while IFS= read -r line || [[ -n "$line" ]]; do
      lineno=$((lineno + 1))
      trimmed="${line#"${line%%[![:space:]]*}"}"
      [[ "$trimmed" == \#* ]] && continue  # 整行注释不误报
      if [[ "$trimmed" =~ $re_plugin || "$trimmed" =~ $re_legacy ]]; then
        CI_WF_ERRORS+=("${f#"$root"/}:${lineno}: ${trimmed}")
      fi
    done < "$f"
  done < <(find "$wf_dir" -maxdepth 1 -type f \( -name '*.yml' -o -name '*.yaml' \) -print0)
  (( ${#CI_WF_ERRORS[@]} == 0 )) && return 0
  return 1
}

# 报错摘要（doctor fail 详情用）：总数 + 逐条「文件:行号: 违规行」
ci_workflow_error_summary() {
  local n=$(( ${#CI_WF_ERRORS[@]} )) msg="" e
  for e in ${CI_WF_ERRORS[@]+"${CI_WF_ERRORS[@]}"}; do
    msg="${msg}${msg:+；}${e}"
  done
  printf '%s 处直接 compose 调用（%s）' "$n" "$msg"
}
