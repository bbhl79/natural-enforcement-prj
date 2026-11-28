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
# 实现口径：逐行分词扫描（空白 + 引号/常见 shell 分隔符分词；跳过空行、
# 整行注释、行内注释、name: 展示字段；词元精确匹配——全局选项不遮蔽
# docker/podman 与 compose 的先后关系）。不做 YAML 语义解析——静态门禁只需
# 捕获「写进 run 步骤的 compose 调用」反例，不声称语法级完备；fail-closed：
# 含 docker+compose 词元的其余行一律拦截。
# ============================================================================

CI_WF_ERRORS=()
CI_WF_SCANNED=0

ci_workflow_reset() { CI_WF_ERRORS=(); CI_WF_SCANNED=0; }

# ci_workflow_scan <repo_root>
#   → rc 0 无违规（CI_WF_SCANNED=扫描的 workflow 文件数）
#   → rc 1 有违规（CI_WF_ERRORS=「相对路径:行号: 违规行」数组）
#
# 词元扫描（#71 评审两轮整改）：按空白 + 引号/常见 shell 分隔符分词后词元精确
# 匹配——引号包裹（"docker compose"）、$(docker compose)、foo;docker compose、
# 带全局选项（docker -H … compose / podman --remote compose）与路径限定形
# （/usr/bin/docker compose）统一命中；行内注释（首个 # 词元起）与 name:
# 展示字段不扫（说明文字非调用）。fail-closed：其余含 docker+compose 词元的
# 行一律拦截（如 echo 文案——宁可误报阻断，不静默放行），不声称语法级完备。
# bash 3.2 + set -u 防卫：空行/纯分隔符行跳过（不产生空数组），数组展开一律
# 用仓库惯用 ${arr[@]+"${arr[@]}"} 形态（bash 4.4 前空数组展开是 unbound）。
ci_workflow_scan() {
  local root="$1"
  local wf_dir="$root/.github/workflows"
  ci_workflow_reset
  [[ -d "$wf_dir" ]] || return 0
  # 不用 mapfile（macOS 宿主 bash 3.2）；find -print0 + while-read -d '' 收集
  local f line trimmed lineno tok engine_seen
  local -a toks
  local ifs_scan=$' \t"'
  ifs_scan+="'()|;&<>"  # 单引号/括号/管道/分号/与/重定向一并作分词边界
  while IFS= read -r -d '' f; do
    CI_WF_SCANNED=$((CI_WF_SCANNED + 1))
    lineno=0
    while IFS= read -r line || [[ -n "$line" ]]; do
      lineno=$((lineno + 1))
      trimmed="${line#"${line%%[![:space:]]*}"}"
      # 空行 / 整行注释 / name: 展示字段（YAML 名称非命令）不扫
      if [[ -z "$trimmed" || "$trimmed" == \#* || "$trimmed" =~ ^(-[[:space:]]+)?name[[:space:]]*: ]]; then
        continue
      fi
      IFS="$ifs_scan" read -r -a toks <<< "$trimmed"
      engine_seen=0
      # 空数组防卫（macOS bash 3.2 + set -u；纯分隔符行会产生空 toks）
      for tok in ${toks[@]+"${toks[@]}"}; do
        case "$tok" in
          \#*) break ;;  # 行内注释：其后是说明文字，不是调用
          # 精确词元 + 路径限定形（*/docker 命中 /usr/bin/docker）
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
