# shellcheck shell=bash
# ============================================================================
# devenv 引擎端点解析与报告（被 devenv/devenv source，不直接执行）
#
# Spec-工程基座「支持环境」节规则：
#   1. 显式覆盖 DEVENV_DOCKER_HOST 优先，并报告覆盖关系（覆盖与默认不同正是目的，
#      不报错）；
#   2. 无覆盖才按平台文档化默认发现；自动发现歧义即失败并列候选；
#   3. 选定端点连接失败即报错，绝不偷换下一个候选；
#   4. 不整文件加载可执行脚本（~/.rd/docker-env.sh 只安全提取地址，绝不 source）；
#   5. doctor 与每条命令报告实际端点 + 引擎身份/版本/架构；
#   6. 引擎不在矩阵内即失败（退出码 3）。
#
# 矩阵（支持环境承诺矩阵）：
#   - 开发机：Podman Engine（Windows=WSL2 经 Rancher podman machine；macOS=podman machine）
#   - CI（GITHUB_ACTIONS=true）：Docker Engine（moby）+ compose v2 + amd64
#   - 裸 Linux + moby 作为开发环境：未验证，不声称支持 → 退出码 3
#
# 失败语义：resolve/probe/check_matrix 返回非零并置 ENGINE_ERROR（不退出），
# 由调用方决定：engine_init（栈命令硬失败，die 3）或 doctor（软收集进体检报告）。
# ============================================================================

ENGINE_ENDPOINT=""
ENGINE_SOURCE=""
ENGINE_IDENTITY=""
ENGINE_VERSION=""
ENGINE_ARCH=""
ENGINE_OS=""
ENGINE_ERROR=""

# 从 ~/.rd/docker-env.sh 安全提取 DOCKER_HOST（只 grep 赋值行，绝不 source 整文件）。
engine_extract_rd_docker_env() {
  local f="$HOME/.rd/docker-env.sh"
  [[ -f "$f" ]] || return 1
  local line
  line="$(grep -E '^[[:space:]]*export[[:space:]]+DOCKER_HOST=' "$f" 2>/dev/null | head -1)" || return 1
  [[ -n "$line" ]] || return 1
  line="${line#*DOCKER_HOST=}"
  line="${line%\"}"; line="${line#\"}"; line="${line%'}"; line="${line#'}"
  [[ -n "$line" ]] || return 1
  printf '%s' "$line"
}

# 平台默认候选端点（文档化默认值；只列存在的）。
engine_default_candidates() {
  local -a candidates=()
  if [[ "$(uname -s)" == "Darwin" ]]; then
    # macOS：podman machine 默认端点（不拿 docker.sock 当通则；docker.sock 仅作候选之一）
    candidates+=("unix://$HOME/.local/share/containers/podman/machine/podman.sock")
    candidates+=("unix:///var/run/docker.sock")
  elif grep -qiE 'microsoft|wsl' /proc/sys/kernel/osrelease 2>/dev/null; then
    # WSL2：Rancher Desktop WSL 集成的 podman machine（rootful）
    candidates+=("unix:///mnt/wsl/podman-sockets/podman-machine-default/podman-root.sock")
    candidates+=("unix:///var/run/docker.sock")
  else
    candidates+=("unix:///var/run/docker.sock")
  fi
  local c
  for c in "${candidates[@]}"; do
    local path="${c#unix://}"
    [[ -S "$path" ]] && printf '%s\n' "$c"
  done
}

# 解析端点：设置 ENGINE_ENDPOINT / ENGINE_SOURCE 并导出 DOCKER_HOST。
engine_resolve() {
  if [[ -n "${DEVENV_DOCKER_HOST:-}" ]]; then
    ENGINE_ENDPOINT="$DEVENV_DOCKER_HOST"
    ENGINE_SOURCE="DEVENV_DOCKER_HOST（显式覆盖）"
  elif [[ -n "${DOCKER_HOST:-}" ]]; then
    ENGINE_ENDPOINT="$DOCKER_HOST"
    ENGINE_SOURCE="DOCKER_HOST 环境变量"
  else
    local rd
    if rd="$(engine_extract_rd_docker_env)"; then
      ENGINE_ENDPOINT="$rd"
      ENGINE_SOURCE="~/.rd/docker-env.sh（安全提取，未 source）"
    else
      # 不用 mapfile（macOS 宿主 bash 3.2 无此内建）——while-read 收集候选
      local -a found=()
      while IFS= read -r line; do found+=("$line"); done < <(engine_default_candidates)
      case "${#found[@]}" in
        0)
          ENGINE_ERROR="引擎端点自动发现失败：无可用候选。请显式设置 DEVENV_DOCKER_HOST（如 unix:///var/run/docker.sock 或 podman machine 端点）"
          return 1 ;;
        1)
          ENGINE_ENDPOINT="${found[0]}"
          ENGINE_SOURCE="平台默认发现" ;;
        *)
          ENGINE_ERROR="引擎端点自动发现歧义（${#found[@]} 个候选）：${found[*]}。请显式设置 DEVENV_DOCKER_HOST 指定其一"
          return 1 ;;
      esac
    fi
  fi
  export DOCKER_HOST="$ENGINE_ENDPOINT"
}

# 探测引擎身份/版本/架构。连接失败即报错（绝不偷换下一个候选）。
engine_probe() {
  local vjson
  if ! vjson="$(docker version --format '{{json .}}' 2>/dev/null)"; then
    ENGINE_ERROR="引擎端点连接失败：${ENGINE_ENDPOINT}（来源：${ENGINE_SOURCE}）。修复：确认引擎已启动，或显式设置 DEVENV_DOCKER_HOST 指向可用端点"
    return 1
  fi
  ENGINE_VERSION="$(printf '%s' "$vjson" | jq -r '.Server.Version // empty')"
  ENGINE_ARCH="$(printf '%s' "$vjson" | jq -r '.Server.Arch // empty')"
  ENGINE_OS="$(printf '%s' "$vjson" | jq -r '.Server.Os // empty')"
  if printf '%s' "$vjson" | jq -e '.Server.Components[]? | select(.Name == "Podman Engine")' >/dev/null 2>&1; then
    ENGINE_IDENTITY="podman"
  elif printf '%s' "$vjson" | jq -e '.Server.Components[]? | select(.Name == "Engine")' >/dev/null 2>&1; then
    ENGINE_IDENTITY="moby"
  else
    ENGINE_IDENTITY="unknown"
  fi
  if [[ -z "$ENGINE_VERSION" ]]; then
    ENGINE_ERROR="引擎版本探测失败：$ENGINE_ENDPOINT"
    return 1
  fi
}

# 矩阵校验：引擎不在支持矩阵内即失败。
engine_check_matrix() {
  case "$ENGINE_IDENTITY" in
    podman)
      return 0 ;;  # 开发机矩阵条目（Windows WSL2 / macOS）
    moby)
      if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
        # CI 托管上下文条目（#71 补强）：Docker Engine/moby + compose v2 + amd64
        # ——架构不符按 CI 矩阵条目拒绝（compose v2 由 doctor compose-plugin 项
        # 校验）。固定 ubuntu-24.04 托管运行器应为 amd64；不特判跳过。
        if [[ "$ENGINE_ARCH" != "amd64" ]]; then
          ENGINE_ERROR="引擎不在支持矩阵内：CI 矩阵条目要求 amd64（Docker Engine/moby + compose v2 + amd64），实际架构 ${ENGINE_ARCH}。核对 runs-on 固定 ubuntu-24.04 托管运行器（Spec-工程基座 支持环境矩阵）"
          return 1
        fi
        return 0
      fi
      ENGINE_ERROR="引擎不在支持矩阵内：Docker Engine（moby）在非 CI 上下文未验证、不声称支持（CI 托管上下文除外）。开发机请使用 Podman Engine（见 Spec-工程基座 支持环境矩阵）"
      return 1 ;;
    *)
      ENGINE_ERROR="引擎不在支持矩阵内：身份未识别（version=${ENGINE_VERSION}）。支持：Podman Engine（开发机）/ Docker Engine（CI）"
      return 1 ;;
  esac
}

# 报告实际端点 + 引擎身份/版本/架构（stderr 人类行 + --json 时 JSONL 事件）。
engine_report() {
  note "engine: $ENGINE_IDENTITY $ENGINE_VERSION ($ENGINE_OS/$ENGINE_ARCH) @ ${ENGINE_ENDPOINT}（来源：${ENGINE_SOURCE}）"
  ev engine identity="$ENGINE_IDENTITY" version="$ENGINE_VERSION" os="$ENGINE_OS" arch="$ENGINE_ARCH" endpoint="$ENGINE_ENDPOINT" source="$ENGINE_SOURCE"
}

# 栈命令统一入口（硬失败）：解析 → 探测 → 矩阵校验 → 报告。
engine_init() {
  command -v docker >/dev/null 2>&1 || die 3 "docker CLI 不在 PATH（白名单工具缺失）"
  command -v jq >/dev/null 2>&1 || die 3 "jq 不在 PATH（白名单工具缺失）"
  engine_resolve || die 3 "$ENGINE_ERROR"
  engine_probe || die 3 "$ENGINE_ERROR"
  engine_check_matrix || die 3 "$ENGINE_ERROR"
  engine_report
}
