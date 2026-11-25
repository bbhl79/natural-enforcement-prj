# shellcheck shell=bash
# ============================================================================
# devenv 栈编排库（被 devenv/devenv source，不直接执行）
#
# 无 bind 烘焙镜像架构（Spec-工程基座 硬不变量 3）：
#   源码经构建 COPY 进镜像，只挂命名卷，零宿主端口（web 唯一显式例外）。
#   凡消费当前源码的命令（up/test/lint/typecheck/verify/migrate*/seed）先经
#   ensure_fresh_workspace 增量重建 workspace 镜像（层缓存命中时秒级），保证
#   容器内即最新代码。（固定输入快照与不可变镜像绑定归 #58；本票为工作树直建。）
#
# 镜像引用（Spec-工程基座 §2）：devenv/images.lock 是上游镜像 tag+digest 双层锁的
# 唯一事实源；PostGIS 镜像引用是可配置输入——DEVENV_DB_IMAGE 环境变量覆盖
# （#53 macOS ARM 路线实验的切换点），生效值与来源必须报告，不写死单一平台路线。
# ============================================================================

PROJECT_NAME="natural-enforcement"
TOOLS_IMAGE="natural-enforcement/tools:local"
WS_IMAGE="natural-enforcement/workspace:local"
IMAGES_LOCK="$REPO_ROOT/devenv/images.lock"
COMPOSE_FILE="$REPO_ROOT/devenv/compose.yaml"

IMAGES_LOADED=0
DB_IMAGE_EFFECTIVE=""
DB_IMAGE_SOURCE=""

require_lock_file() {
  [[ -f "$IMAGES_LOCK" ]] || die 3 "镜像锁文件缺失：$IMAGES_LOCK（devenv/images.lock 是版本唯一事实源）"
}

# 加载镜像锁并计算生效 DB 镜像（DEVENV_DB_IMAGE 覆盖优先，来源必须可报告）。
images_load() {
  (( IMAGES_LOADED )) && return 0
  require_lock_file
  set -a; # shellcheck disable=SC1090
  source "$IMAGES_LOCK"; set +a
  [[ -n "${NODE_IMAGE:-}" ]] || die 3 "images.lock 缺 NODE_IMAGE 行"
  [[ -n "${DB_IMAGE:-}" ]] || die 3 "images.lock 缺 DB_IMAGE 行"
  if [[ -n "${DEVENV_DB_IMAGE:-}" ]]; then
    # 可配置输入校验：repo:tag 或 repo:tag@sha256:<64hex>（拒绝裸 latest 以外的无标签引用）
    if [[ ! "$DEVENV_DB_IMAGE" =~ ^[a-z0-9]+([._/-][a-z0-9]+)*:[A-Za-z0-9._-]+(@sha256:[0-9a-f]{64})?$ ]]; then
      die 2 "DEVENV_DB_IMAGE 格式非法：$DEVENV_DB_IMAGE（期望 repo:tag 或 repo:tag@sha256:<64hex>）"
    fi
    DB_IMAGE_EFFECTIVE="$DEVENV_DB_IMAGE"
    DB_IMAGE_SOURCE="DEVENV_DB_IMAGE（显式覆盖，锁定值：$DB_IMAGE）"
  else
    DB_IMAGE_EFFECTIVE="$DB_IMAGE"
    DB_IMAGE_SOURCE="images.lock"
  fi
  IMAGES_LOADED=1
}

compose() {
  images_load
  command -v docker >/dev/null 2>&1 || die 3 "docker CLI 不在 PATH"
  docker compose version >/dev/null 2>&1 || die 3 "compose v2 插件缺失（docker compose version 失败）"
  REPO_ROOT="$REPO_ROOT" WORKSPACE_IMAGE="$WS_IMAGE" DB_IMAGE="$DB_IMAGE_EFFECTIVE" \
    WEB_PORT="${WEB_PORT:-5173}" \
    docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" "$@"
}

in_tools() { # 在工具容器内执行（每次临时容器，退出即回收）
  compose run --rm tools "$@"
}

# 结构化命令的步骤执行：子进程原始输出分流 stderr（不混入 --json 结果流），
# 失败 → 终值事件（exitCode=4，子进程码入 taskRc）+ exit 4——子进程退出码不外逸，
# 退出码枚举（COMMANDS.md）不被绕过。
run_step() { # run_step <步骤描述> <cmd...>
  local desc="$1"; shift
  local rc=0
  "$@" >&2 || rc=$?
  if (( rc )); then
    final failed 4 step="$desc" taskRc="$rc"
    die 4 "$desc 失败（退出码 $rc，完整输出见上方 stderr）"
  fi
}

# 凡消费当前源码的命令前置：增量重建 workspace 镜像（层缓存命中时秒级）。
ensure_fresh_workspace() {
  ev step.started target="workspace image refresh"
  run_step "workspace 镜像增量重建" \
    docker build -q -t "$WS_IMAGE" -f "$REPO_ROOT/devenv/workspace.Dockerfile" "$REPO_ROOT"
  ev step.completed target="workspace image refresh"
}

svc_running() {
  [[ -n "$(docker ps --filter "label=com.docker.compose.project=$PROJECT_NAME" \
      --filter "label=com.docker.compose.service=$1" --format '{{.Names}}')" ]]
}

svc_healthy() {
  # podman 兼容层的 docker ps Status 不带 "(healthy)" 后缀——以 inspect 的 Health.Status 为准
  # （不用 | head -1：pipefail 下 SIGPIPE 竞态；先捕获再截首行）
  local c
  c="$(docker ps -a --filter "label=com.docker.compose.project=$PROJECT_NAME" \
      --filter "label=com.docker.compose.service=$1" --format '{{.Names}}')"
  c="${c%%$'\n'*}"
  [[ -n "$c" ]] && [[ "$(docker inspect "$c" --format '{{.State.Health.Status}}' 2>/dev/null)" == "healthy" ]]
}

require_services() { # 确保服务健康；$@=服务名
  local s
  for s in "$@"; do
    svc_healthy "$s" || die 3 "服务 [$s] 未就绪。修复命令：devenv up"
  done
}

wait_healthy() { # $1=svc $2=超时秒；终态等待（健康轮询，非固定睡眠后盲目假定就绪）
  local svc="$1" timeout="${2:-60}" waited=0
  while (( waited < timeout )); do
    svc_healthy "$svc" && return 0
    if ! docker ps -a --filter "label=com.docker.compose.project=$PROJECT_NAME" \
        --filter "label=com.docker.compose.service=$svc" --format '{{.Names}}' | grep -q .; then
      die 3 "服务 [$svc] 容器不存在。修复命令：devenv up"
    fi
    sleep 2; waited=$((waited + 2))
  done
  die 5 "等待 [$svc] 健康超时（${timeout}s）。排查：devenv logs $svc"
}
