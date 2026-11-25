# shellcheck shell=bash
# ============================================================================
# devenv 栈编排库（被 devenv/devenv source，不直接执行）
#
# 无 bind 烘焙镜像架构（Spec-工程基座 硬不变量 3）：
#   源码经构建 COPY 进镜像，只挂命名卷，零宿主端口（web 唯一显式例外）。
#   凡消费当前源码的命令（up/test/lint/typecheck/verify/migrate*/seed）先经
#   ensure_fresh_workspace：固定输入快照（#58，lib/snapshot.sh）+ 新鲜度核对
#   （快照哈希 ↔ 镜像 label ↔ 状态文件一致才跳过重构）+ 不可变镜像标识绑定
#   （compose 注入 image ID，不绑定可变 tag；启动后核对运行容器实际镜像）。
#
# 镜像引用（Spec-工程基座 §2）：devenv/images.lock 是上游镜像 tag+digest 双层锁的
# 唯一事实源；PostGIS 镜像引用是可配置输入——DEVENV_DB_IMAGE 环境变量覆盖
# （#53 macOS ARM 路线实验的切换点），生效值与来源必须报告，不写死单一平台路线。
# ============================================================================

PROJECT_NAME="natural-enforcement"
TOOLS_IMAGE="natural-enforcement/tools:local"
WS_IMAGE="natural-enforcement/workspace:local"
WS_IMAGE_EFFECTIVE=""  # 本次新鲜度核对/构建绑定的不可变镜像标识（image ID）
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
  # 不可变绑定（#58）：优先本次核对/构建的 image ID；未跑过新鲜度核对的命令
  # （down/ps/logs 等）回退状态文件记录；均无才兜底可变 tag（仅只读/拆栈场景）。
  local ws_image="$WS_IMAGE_EFFECTIVE"
  if [[ -z "$ws_image" ]]; then
    snapshot_state_load
    ws_image="${STATE_IMAGE_ID:-$WS_IMAGE}"
  fi
  REPO_ROOT="$REPO_ROOT" WORKSPACE_IMAGE="$ws_image" DB_IMAGE="$DB_IMAGE_EFFECTIVE" \
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

RUN_STEP_OUT=""
run_step_out() { # run_step_out <步骤描述> <cmd...>：同 run_step，stdout 捕获进 RUN_STEP_OUT
  local desc="$1"; shift
  local rc=0
  RUN_STEP_OUT="$("$@")" || rc=$?
  if (( rc )); then
    final failed 4 step="$desc" taskRc="$rc"
    die 4 "$desc 失败（退出码 $rc，完整输出见上方 stderr）"
  fi
}

# 从固定快照构建 workspace 镜像并记录不可变绑定（#58）。
# 镜像 label 记录快照哈希 + 关键构建输入清单；构建返回的 image ID（docker build -q
# 输出，免 tag 二次解析竞态）写入状态文件；compose 消费经 WS_IMAGE_EFFECTIVE 注入。
build_workspace_from_snapshot() { # <tree> [已物化目录]
  local s="$1" dir="${2:-}" own_dir=0
  if [[ -z "$dir" ]]; then
    snapshot_materialize_new "$s"
    dir="$SNAPSHOT_MATERIALIZED_DIR"
    own_dir=1
  fi
  ev step.started target="workspace image (snapshot build)"
  run_step_out "workspace 镜像构建" \
    docker build -q -t "$WS_IMAGE" \
      --label "devenv.snapshot.hash=$s" \
      --label "devenv.snapshot.inputs=$(snapshot_inputs_manifest "$s")" \
      -f "$dir/devenv/workspace.Dockerfile" "$dir"
  # docker build -q 输出即本次构建的不可变标识（免 tag 二次解析竞态）；
  # podman 兼容层输出无前缀 64hex，docker 输出带 sha256: 前缀——归一为带前缀形
  local img_id="$RUN_STEP_OUT"
  [[ "$img_id" == sha256:* ]] || img_id="sha256:$img_id"
  if [[ ! "$img_id" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    (( own_dir )) && snapshot_discard "$dir"
    die 4 "workspace 镜像构建未返回不可变标识（输出：$img_id）"
  fi
  snapshot_state_write "$s" "$img_id"
  WS_IMAGE_EFFECTIVE="$img_id"
  ev workspace.built imageId="$img_id" snapshot="$s"
  ev step.completed target="workspace image (snapshot build)"
  (( own_dir )) && snapshot_discard "$dir"
  return 0
}

# 凡消费当前源码的命令前置（#58）：固定输入快照 → 新鲜度核对（快照哈希 ↔ 镜像
# devenv.snapshot.hash label ↔ 状态文件一致才跳过重构）→ 绑定不可变镜像标识
# （WS_IMAGE_EFFECTIVE）。层缓存命中时重构秒级；快照一致时亚秒级跳过。
ensure_fresh_workspace() {
  ev step.started target="workspace image freshness"
  local s
  s="$(snapshot_capture)"  # 双采集；持续不稳 → die 4（明确拒绝，不出混合内容）
  ev snapshot.captured hash="$s"
  snapshot_state_load
  # 单次 inspect：镜像不存在或 label 缺失/不符均为空 → 不新鲜 → 重建
  local labeled
  labeled="$(docker image inspect "$STATE_IMAGE_ID" --format '{{index .Config.Labels "devenv.snapshot.hash"}}' 2>/dev/null)"
  if [[ -n "$STATE_IMAGE_ID" && "$STATE_SNAPSHOT_HASH" == "$s" && "$labeled" == "$s" ]]; then
    WS_IMAGE_EFFECTIVE="$STATE_IMAGE_ID"
    ev workspace.fresh imageId="$STATE_IMAGE_ID" snapshot="$s"
    note "workspace 镜像新鲜（快照 ${s:0:12}… ↔ ${STATE_IMAGE_ID:0:19}…），跳过重建"
    ev step.completed target="workspace image freshness"
    return 0
  fi
  ev step.completed target="workspace image freshness"
  build_workspace_from_snapshot "$s"
}

# 启动核对（#58）：实际运行容器必须使用本次绑定的不可变镜像标识——
# 同 worktree 可变 tag 被覆盖也不影响已绑定的运行产物。
verify_svc_image() { # $1=svc
  local svc="$1" c img
  c="$(docker ps --filter "label=com.docker.compose.project=$PROJECT_NAME" \
      --filter "label=com.docker.compose.service=$svc" --format '{{.ID}}')"
  c="${c%%$'\n'*}"
  [[ -n "$c" ]] || die 4 "启动核对失败：服务 [$svc] 无运行中容器"
  img="$(docker inspect "$c" --format '{{.Image}}')"
  if [[ "$img" != "$WS_IMAGE_EFFECTIVE" ]]; then
    die 4 "启动核对失败：[$svc] 运行镜像 $img ≠ 本次构建产物 $WS_IMAGE_EFFECTIVE（不可变绑定被破坏。排查：devenv build 后重试 devenv up）"
  fi
  ev image.verified service="$svc" imageId="$img"
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
