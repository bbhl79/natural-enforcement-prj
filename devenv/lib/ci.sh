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
# 实现口径：逐行分词扫描（跳过整行注释；词元精确匹配——全局选项不遮蔽
# docker/podman 与 compose 的先后关系）。不做 YAML 语义解析——静态门禁只需
# 捕获「写进 run 步骤的 compose 调用」反例，不声称语法级完备。
# ============================================================================

CI_WF_ERRORS=()
CI_WF_SCANNED=0

ci_workflow_reset() { CI_WF_ERRORS=(); CI_WF_SCANNED=0; }

# ci_workflow_scan <repo_root>
#   → rc 0 无违规（CI_WF_SCANNED=扫描的 workflow 文件数）
#   → rc 1 有违规（CI_WF_ERRORS=「相对路径:行号: 违规行」数组）
#
# 词元扫描（#71 评审整改：正则形态漏报带全局选项的调用）：一行内出现独立词
# docker/podman 且其后出现独立词 compose（无论中间隔多少全局选项/参数——
# docker -H … compose up / docker --context default compose ps / podman
# --remote compose up 同样违规），或独立词 docker-compose/podman-compose。
# 实现口径：整行注释跳过；按空白分词、词元精确匹配（docker/compose 为完整
# 词，compose.yml、docker/compose-action 等复合词不命中）；fail-closed——
# 复合词里嵌 compose 的边缘写法宁可放过（诚实漏报，不声称语法级完备），
# 不引入更宽的误报面。
ci_workflow_scan() {
  local root="$1"
  local wf_dir="$root/.github/workflows"
  ci_workflow_reset
  [[ -d "$wf_dir" ]] || return 0
  # 不用 mapfile（macOS 宿主 bash 3.2）；find -print0 + while-read -d '' 收集
  local f line trimmed lineno tok engine_seen
  local -a toks
  while IFS= read -r -d '' f; do
    CI_WF_SCANNED=$((CI_WF_SCANNED + 1))
    lineno=0
    while IFS= read -r line || [[ -n "$line" ]]; do
      lineno=$((lineno + 1))
      trimmed="${line#"${line%%[![:space:]]*}"}"
      [[ "$trimmed" == \#* ]] && continue  # 整行注释不误报
      # read -a 分词不做 glob 展开（for $var 展开会）；复合词不等于完整词元
      read -r -a toks <<< "$trimmed"
      engine_seen=0
      for tok in "${toks[@]}"; do
        case "$tok" in
          # 精确词元 + 路径限定形（*/docker 命中 /usr/bin/docker——评审边界含 /）
          docker|podman|*/docker|*/podman) engine_seen=1 ;;
          compose)
            if (( engine_seen )); then
              CI_WF_ERRORS+=("${f#"$root"/}:${lineno}: ${trimmed}")
              break
            fi ;;
          docker-compose|podman-compose|*/docker-compose|*/podman-compose)
            CI_WF_ERRORS+=("${f#"$root"/}:${lineno}: ${trimmed}")
            break ;;
        esac
      done
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
