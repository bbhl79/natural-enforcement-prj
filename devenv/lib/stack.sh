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
# per-worktree 运行资源隔离（Spec-工程基座 硬不变量 4，#59）：
#   compose 项目名/本地镜像 tag 按 worktree 身份派生（容器/卷/网络独立，
#   镜像内容按不可变产物共享）；数据库凭据每 worktree 随机生成、状态持久化；
#   锁分派：stack/migrate 锁 per-worktree，lockgen 机器级（见 COMMANDS.md 并发语义）。
#
# 镜像引用（Spec-工程基座 §2）：devenv/images.lock 是上游镜像 tag+digest 双层锁的
# 唯一事实源；PostGIS 镜像引用是可配置输入——DEVENV_DB_IMAGE 环境变量覆盖
# （#53 macOS ARM 路线实验的切换点），生效值与来源必须报告，不写死单一平台路线。
# ============================================================================

# --- worktree 身份（容器/卷/网络/镜像 tag/锁名 的派生根）---------------------
# 身份 = git 目录路径（主工作树 <root>/.git；链接 worktree .git/worktrees/<id>）：
# per-worktree 唯一，且对 worktree 目录改名/移动稳定（git 目录路径不变）。
# 非 git 上下文（离线测试沙箱等）回退工作树根路径哈希——不同路径仍得不同名，
# 且 source 期不 die（认证入口等不触引擎的命令不受影响）。
# DEVENV_WORKTREE_ID 仅供离线测试注入确定性身份。
worktree_identity() {
  if [[ -n "${DEVENV_WORKTREE_ID:-}" ]]; then
    printf '%s' "$DEVENV_WORKTREE_ID"
    return 0
  fi
  local id=""
  id="$(git -C "$REPO_ROOT" rev-parse --absolute-git-dir 2>/dev/null)" || id=""
  [[ -n "$id" ]] || id="$REPO_ROOT"
  printf '%s' "$id"
}

# source 期单次推导：身份与来源一次判定（git 只调一次；身份 == 工作树根路径即回退）
WT_IDENTITY="$(worktree_identity)"
WT_SUFFIX="$(printf '%s' "$WT_IDENTITY" | sha256sum | awk '{print $1}' | cut -c1-8)"
WT_IDENTITY_SOURCE="git 目录"
if [[ -n "${DEVENV_WORKTREE_ID:-}" ]]; then
  WT_IDENTITY_SOURCE="DEVENV_WORKTREE_ID（显式覆盖）"
elif [[ "$WT_IDENTITY" == "$REPO_ROOT" ]]; then
  WT_IDENTITY_SOURCE="工作树根路径（非 git 回退）"
fi
PROJECT_NAME="natural-enforcement-$WT_SUFFIX"
# 本地构建镜像 tag per-worktree（归属可辨；运行正确性仍靠不可变 image ID 绑定，#58）
TOOLS_IMAGE="natural-enforcement/tools:wt-$WT_SUFFIX"
WS_IMAGE="natural-enforcement/workspace:wt-$WT_SUFFIX"
E2E_IMAGE="natural-enforcement/e2e:wt-$WT_SUFFIX"   # e2e 执行器（#70；官方 Playwright 基座 + 项目运行时）
WS_IMAGE_EFFECTIVE=""     # 本次新鲜度核对/构建绑定的 workspace 不可变镜像标识（image ID）
TOOLS_IMAGE_EFFECTIVE=""  # 本次新鲜度核对/构建绑定的 tools 不可变镜像标识（image ID）
E2E_IMAGE_EFFECTIVE=""    # 本次绑定的 e2e 执行器不可变镜像标识（image ID；#70）
ENSURE_SNAPSHOT_HASH=""   # ensure_fresh_workspace 本次采集/使用的快照树哈希（#70 e2e 复用）
IMAGES_LOCK="$REPO_ROOT/devenv/images.lock"
COMPOSE_FILE="$REPO_ROOT/devenv/compose.yaml"
E2E_COMPOSE_FILE="$REPO_ROOT/devenv/compose.e2e.yaml"

IMAGES_LOADED=0
DB_IMAGE_EFFECTIVE=""
DB_IMAGE_SOURCE=""
DB_IMAGE_KIND_EFFECTIVE=""
DB_IMAGE_PLATFORM_EFFECTIVE=""
NODE_IMAGE_KIND=""
DB_IMAGE_MACOS=""
DB_IMAGE_MACOS_KIND=""
PLAYWRIGHT_IMAGE_KIND=""
PLAYWRIGHT_VERSION=""

# --- per-worktree 数据库凭据（#59）--------------------------------------------
# 首调用生成每 worktree 随机口令（openssl rand -hex 16 → 32 hex，URI 安全），
# 持久化 .devenv-state/db-credentials.env（0600，gitignored，per-worktree 私有）。
# 口令随 worktree 状态保留：down/up 周期稳定（数据卷按初始口令初始化，换装必炸）；
# down --volumes 重建空库仍用同一口令（凭据是 worktree 身份，不是数据）。
# 隔离的是项目运行资源与每 worktree 的数据库/对象存储访问凭据（硬不变量 4），
# 与 GitHub 身份凭据无关。compose() 每次调用前置，注入 db/api/tools 容器。
DB_CREDENTIALS_LOADED=0
DB_CREDENTIALS_ORIGIN="none"
DB_PASSWORD_EFFECTIVE=""

# --- per-worktree 对象存储凭据（#69）------------------------------------------
# rustfs 的 access/secret 每 worktree 随机生成并持久化（.devenv-state/storage-credentials.env，
# 0600，gitignored）；与数据库口令同口径：凭据是 worktree 身份，down/up 周期稳定。
STORAGE_CREDENTIALS_LOADED=0
STORAGE_CREDENTIALS_ORIGIN="none"
S3_ACCESS_KEY_EFFECTIVE=""
S3_SECRET_KEY_EFFECTIVE=""

storage_credentials_ensure() {
  (( STORAGE_CREDENTIALS_LOADED )) && return 0
  local f dir access secret
  dir="${DEVENV_STATE_DIR:-$REPO_ROOT/.devenv-state}"
  f="$dir/storage-credentials.env"
  if [[ -f "$f" ]]; then
    access="$(awk -F= '/^S3_ACCESS_KEY=/{print $2}' "$f" | tail -1)"
    secret="$(awk -F= '/^S3_SECRET_KEY=/{print $2}' "$f" | tail -1)"
    [[ "$access" =~ ^[a-z0-9]{16,32}$ && "$secret" =~ ^[0-9a-f]{32}$ ]] \
      || die 3 "对象存储凭据文件损坏（S3_ACCESS_KEY 应为 16-32 位小写字母数字、S3_SECRET_KEY 为 32 hex）：${f}。修复：删除该文件后重跑（将生成新凭据；旧 rustfs 数据卷需 down --volumes 重建）"
    S3_ACCESS_KEY_EFFECTIVE="$access"
    S3_SECRET_KEY_EFFECTIVE="$secret"
    STORAGE_CREDENTIALS_ORIGIN="stored"
  else
    access="ne$(openssl rand -hex 8 2>/dev/null)" || access=""
    secret="$(openssl rand -hex 16 2>/dev/null)" || secret=""
    [[ "$access" =~ ^[a-z0-9]{16,32}$ && "$secret" =~ ^[0-9a-f]{32}$ ]] \
      || die 3 "对象存储凭据生成失败（openssl rand）。修复：确认 openssl 在 PATH"
    mkdir -p "$dir" || die 3 "状态目录不可写：$dir"
    ( umask 077
      printf '# devenv 对象存储凭据（devenv 维护，勿手改；每 worktree 随机生成，随状态保留）\nS3_ACCESS_KEY=%s\nS3_SECRET_KEY=%s\n' \
        "$access" "$secret" > "$f" ) || die 3 "凭据文件写入失败：$dir"
    S3_ACCESS_KEY_EFFECTIVE="$access"
    S3_SECRET_KEY_EFFECTIVE="$secret"
    STORAGE_CREDENTIALS_ORIGIN="generated"
  fi
  STORAGE_CREDENTIALS_LOADED=1
  return 0
}

db_credentials_ensure() {
  (( DB_CREDENTIALS_LOADED )) && return 0
  local f dir pw
  dir="${DEVENV_STATE_DIR:-$REPO_ROOT/.devenv-state}"
  f="$dir/db-credentials.env"
  if [[ -f "$f" ]]; then
    pw="$(awk -F= '/^DB_PASSWORD=/{print $2}' "$f" | tail -1)"
    [[ "$pw" =~ ^[0-9a-f]{32}$ ]] || die 3 "数据库凭据文件损坏（DB_PASSWORD 应为 32 hex）：${f}。修复：删除该文件后重跑（将生成新口令；旧数据卷若已按旧口令初始化，需 devenv down --volumes 重建）"
    DB_PASSWORD_EFFECTIVE="$pw"
    DB_CREDENTIALS_ORIGIN="stored"
  else
    DB_PASSWORD_EFFECTIVE="$(openssl rand -hex 16 2>/dev/null)" \
      || DB_PASSWORD_EFFECTIVE=""
    [[ "$DB_PASSWORD_EFFECTIVE" =~ ^[0-9a-f]{32}$ ]] \
      || die 3 "数据库凭据生成失败（openssl rand -hex 16 未返回 32 hex）。修复：确认 openssl 在 PATH"
    mkdir -p "$dir" || die 3 "状态目录不可写：$dir"
    ( umask 077
      printf '# devenv 数据库凭据（devenv 维护，勿手改；每 worktree 随机生成，随状态保留）\nDB_PASSWORD=%s\n' \
        "$DB_PASSWORD_EFFECTIVE" > "$f" ) || die 3 "凭据文件写入失败：$dir"
    DB_CREDENTIALS_ORIGIN="generated"
  fi
  DB_CREDENTIALS_LOADED=1
  return 0
}

require_lock_file() {
  [[ -f "$IMAGES_LOCK" ]] || die 3 "镜像锁文件缺失：${IMAGES_LOCK}（devenv/images.lock 是版本唯一事实源）"
}

# 上游镜像锁必须是 tag+digest 双层锁（Spec §2；digest 缺失即无法校验字节级确定性）。
images_valid_ref() { # <repo:tag@sha256:64hex>
  [[ "${1:-}" =~ ^[a-z0-9]+([._/-][a-z0-9]+)*:[A-Za-z0-9._-]+@sha256:[0-9a-f]{64}$ ]]
}

# 加载镜像锁并计算生效 DB 镜像（DEVENV_DB_IMAGE 覆盖优先，来源必须可报告）。
images_load() {
  (( IMAGES_LOADED )) && return 0
  require_lock_file
  set -a; # shellcheck disable=SC1090
  source "$IMAGES_LOCK"; set +a
  [[ -n "${NODE_IMAGE:-}" ]] || die 3 "images.lock 缺 NODE_IMAGE 行"
  [[ -n "${DB_IMAGE:-}" ]] || die 3 "images.lock 缺 DB_IMAGE 行"
  images_valid_ref "$NODE_IMAGE" \
    || die 3 "NODE_IMAGE 必须是 repo:tag@sha256:<64hex>（tag+digest 双层锁）：${NODE_IMAGE}"
  [[ "${NODE_IMAGE_KIND:-}" == "manifest-list" ]] \
    || die 3 "images.lock 缺 NODE_IMAGE_KIND=manifest-list（多架构镜像锁 manifest-list digest）"
  images_valid_ref "$DB_IMAGE" \
    || die 3 "DB_IMAGE 必须是 repo:tag@sha256:<64hex>（tag+digest 双层锁）：${DB_IMAGE}"
  case "${DB_IMAGE_KIND:-}" in
    single-arch)
      [[ -n "${DB_IMAGE_PLATFORM:-}" ]] \
        || die 3 "DB_IMAGE_KIND=single-arch 时必须声明 DB_IMAGE_PLATFORM（如 linux/amd64；单架构镜像锁平台摘要）"
      [[ "$DB_IMAGE_PLATFORM" =~ ^[a-z0-9]+/[a-z0-9]+$ ]] \
        || die 3 "DB_IMAGE_PLATFORM 格式非法：${DB_IMAGE_PLATFORM}（期望 os/arch）"
      ;;
    manifest-list) ;;
    *) die 3 "images.lock 缺 DB_IMAGE_KIND（single-arch|manifest-list）" ;;
  esac
  # macOS ARM 路线（#53 选定 B：kartoza multiarch）登记为独立锁行；默认锁不变。
  [[ -n "${DB_IMAGE_MACOS:-}" ]] \
    || die 3 "images.lock 缺 DB_IMAGE_MACOS（#53 选定 macOS ARM 路线登记：kartoza multiarch）"
  images_valid_ref "$DB_IMAGE_MACOS" \
    || die 3 "DB_IMAGE_MACOS 必须是 repo:tag@sha256:<64hex>：${DB_IMAGE_MACOS}"
  [[ "${DB_IMAGE_MACOS_KIND:-}" == "manifest-list" ]] \
    || die 3 "DB_IMAGE_MACOS_KIND 必须为 manifest-list（kartoza multiarch）"
  # 队列/对象存储（#69）：多架构镜像锁 manifest-list digest
  [[ -n "${REDIS_IMAGE:-}" ]] || die 3 "images.lock 缺 REDIS_IMAGE 行"
  images_valid_ref "$REDIS_IMAGE" \
    || die 3 "REDIS_IMAGE 必须是 repo:tag@sha256:<64hex>：${REDIS_IMAGE}"
  [[ "${REDIS_IMAGE_KIND:-}" == "manifest-list" ]] \
    || die 3 "images.lock 缺 REDIS_IMAGE_KIND=manifest-list（多架构镜像锁 manifest-list digest）"
  [[ -n "${RUSTFS_IMAGE:-}" ]] || die 3 "images.lock 缺 RUSTFS_IMAGE 行"
  images_valid_ref "$RUSTFS_IMAGE" \
    || die 3 "RUSTFS_IMAGE 必须是 repo:tag@sha256:<64hex>：${RUSTFS_IMAGE}"
  [[ "${RUSTFS_IMAGE_KIND:-}" == "manifest-list" ]] \
    || die 3 "images.lock 缺 RUSTFS_IMAGE_KIND=manifest-list（多架构镜像锁 manifest-list digest）"
  # e2e 执行器基座（#70）：官方 Playwright 镜像多架构 → manifest-list digest；
  # tag 内的版本号必须可解析（与 catalog @playwright/test 的严格一致由静态门禁交叉核对）。
  [[ -n "${PLAYWRIGHT_IMAGE:-}" ]] || die 3 "images.lock 缺 PLAYWRIGHT_IMAGE 行（e2e 执行器基座）"
  images_valid_ref "$PLAYWRIGHT_IMAGE" \
    || die 3 "PLAYWRIGHT_IMAGE 必须是 repo:tag@sha256:<64hex>（tag+digest 双层锁）：${PLAYWRIGHT_IMAGE}"
  [[ "${PLAYWRIGHT_IMAGE_KIND:-}" == "manifest-list" ]] \
    || die 3 "images.lock 缺 PLAYWRIGHT_IMAGE_KIND=manifest-list（多架构镜像锁 manifest-list digest）"
  local _pw_tag _pw_ver
  _pw_tag="${PLAYWRIGHT_IMAGE%%@*}"
  _pw_ver="${_pw_tag##*:}"
  _pw_ver="${_pw_ver#v}"
  [[ "$_pw_ver" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9][A-Za-z0-9.-]*)?$ ]] \
    || die 3 "PLAYWRIGHT_IMAGE tag 版本不可解析（期望 vX.Y.Z[-distro]）：${_pw_tag}"
  PLAYWRIGHT_VERSION="${_pw_ver%%-*}"
  if [[ -n "${DEVENV_DB_IMAGE:-}" ]]; then
    # 可配置输入校验：repo:tag 或 repo:tag@sha256:<64hex>（拒绝裸 latest 以外的无标签引用）
    if [[ ! "$DEVENV_DB_IMAGE" =~ ^[a-z0-9]+([._/-][a-z0-9]+)*:[A-Za-z0-9._-]+(@sha256:[0-9a-f]{64})?$ ]]; then
      die 2 "DEVENV_DB_IMAGE 格式非法：${DEVENV_DB_IMAGE}（期望 repo:tag 或 repo:tag@sha256:<64hex>）"
    fi
    DB_IMAGE_EFFECTIVE="$DEVENV_DB_IMAGE"
    DB_IMAGE_SOURCE="DEVENV_DB_IMAGE（显式覆盖，锁定值：${DB_IMAGE}）"
    DB_IMAGE_KIND_EFFECTIVE="unknown"
    DB_IMAGE_PLATFORM_EFFECTIVE=""
  elif [[ "${ENGINE_ARCH:-}" == "arm64" ]]; then
    # 引擎架构即容器运行平台：Apple Silicon / arm64 → #53 选定路线（原生 arm64）
    DB_IMAGE_EFFECTIVE="$DB_IMAGE_MACOS"
    DB_IMAGE_SOURCE="images.lock（macOS/arm64 路线 #53-B：kartoza multiarch；默认锁：${DB_IMAGE}）"
    DB_IMAGE_KIND_EFFECTIVE="${DB_IMAGE_MACOS_KIND:-manifest-list}"
    DB_IMAGE_PLATFORM_EFFECTIVE=""
  else
    DB_IMAGE_EFFECTIVE="$DB_IMAGE"
    DB_IMAGE_SOURCE="images.lock"
    DB_IMAGE_KIND_EFFECTIVE="${DB_IMAGE_KIND:-}"
    DB_IMAGE_PLATFORM_EFFECTIVE="${DB_IMAGE_PLATFORM:-}"
  fi
  IMAGES_LOADED=1
}

compose() {
  images_load
  command -v docker >/dev/null 2>&1 || die 3 "docker CLI 不在 PATH"
  docker compose version >/dev/null 2>&1 || die 3 "compose v2 插件缺失（docker compose version 失败）"
  # 每 worktree 数据库凭据（#59）：生成/加载后注入 compose（db POSTGRES_PASSWORD +
  # api/tools DATABASE_URL 同源）；首次生成写入 .devenv-state（per-worktree 私有）
  db_credentials_ensure
  # 每 worktree 对象存储凭据（#69）：rustfs 服务端与 api/worker/tools 客户端同源注入
  storage_credentials_ensure
  # 不可变绑定（#58）：优先本次核对/构建的 image ID；未跑过新鲜度核对的命令
  # （down/ps/logs 等）回退状态文件记录；均无才兜底可变 tag（仅只读/拆栈场景）。
  local ws_image="$WS_IMAGE_EFFECTIVE"
  if [[ -z "$ws_image" ]]; then
    snapshot_state_load
    ws_image="${STATE_IMAGE_ID:-$WS_IMAGE}"
  fi
  REPO_ROOT="$REPO_ROOT" WORKSPACE_IMAGE="$ws_image" DB_IMAGE="$DB_IMAGE_EFFECTIVE" \
    REDIS_IMAGE="$REDIS_IMAGE" RUSTFS_IMAGE="$RUSTFS_IMAGE" \
    DB_PASSWORD="$DB_PASSWORD_EFFECTIVE" \
    S3_ACCESS_KEY="$S3_ACCESS_KEY_EFFECTIVE" S3_SECRET_KEY="$S3_SECRET_KEY_EFFECTIVE" \
    WEB_PORT_SPEC="${WEB_PORT_SPEC:-4173}" \
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
    die 4 "$desc 失败（退出码 ${rc}，完整输出见上方 stderr）"
  fi
}

RUN_STEP_OUT=""
run_step_out() { # run_step_out <步骤描述> <cmd...>：同 run_step，stdout 捕获进 RUN_STEP_OUT
  local desc="$1"; shift
  local rc=0
  RUN_STEP_OUT="$("$@")" || rc=$?
  if (( rc )); then
    final failed 4 step="$desc" taskRc="$rc"
    die 4 "$desc 失败（退出码 ${rc}，完整输出见上方 stderr）"
  fi
}

# 镜像 label 读取探针（新鲜度核对用）：镜像不存在 / label 缺失 → 打印空（未命中）；
# 引擎故障（inspect 失败且引擎探活失败）→ die 3 明确报错，不吞。
# 注意：不能用 docker image ls 做存在性探针——podman 不列出完全无 tag 的悬空镜像
# （tag 被覆盖后状态镜像变悬空，会被误判不存在，实测）。
image_label_or_miss() { # <imageId> <label-format>
  local id="$1" fmt="$2" out rc=0
  [[ -n "$id" ]] || return 0
  out="$(docker image inspect "$id" --format "$fmt" 2>/dev/null)" || rc=$?
  if (( rc != 0 )); then
    docker version --format '{{.Server.Version}}' >/dev/null 2>&1 \
      || die 3 "引擎连接异常（docker image inspect 失败且引擎探活失败）。排查：devenv doctor"
    return 0  # 引擎正常 → 镜像不存在 → 未命中（空）
  fi
  printf '%s' "$out"
}

# tools 输入哈希：tools.Dockerfile blob + 快照内 images.lock 的 NODE_IMAGE
# （tools 镜像内容只由这两项决定——pnpm 版本 pin 在 tools.Dockerfile 内）
tools_input_hash() { # <tree>
  local blob node_image
  blob="$(git -C "$REPO_ROOT" rev-parse "$1:devenv/tools.Dockerfile")"
  node_image="$(git -C "$REPO_ROOT" show "$1:devenv/images.lock" | grep '^NODE_IMAGE=' | cut -d= -f2-)"
  [[ -n "$blob" && -n "$node_image" ]] || die 3 "快照内 tools 构建输入缺失（devenv/tools.Dockerfile 或 images.lock NODE_IMAGE 行）"
  printf '%s\n%s\n' "$blob" "$node_image" | sha256sum | awk '{print $1}'
}

# 登记 per-worktree 本地 tag（#59 评审修复）：新鲜度命中（直接采纳既有不可变镜像）
# 也必须把该镜像登记到本 worktree 的 wt-<suffix> tag——tag 是归属可辨的职责，
# 不随"构建还是采纳"分叉；否则 #75 回收核对与人工排查失去归属依据，且 Spec §3
# "镜像 tag per-worktree" 在采纳路径落空。失败显式报错（exit 4），不静默跳过。
register_local_image_tag() { # <imageId> <tag>
  local id="$1" tag="$2"
  [[ "$id" =~ ^sha256:[0-9a-f]{64}$ ]] || die 4 "内部错误：登记本地 tag 的 image ID 非法（id=$id tag=${tag}）"
  run_step "登记 per-worktree 镜像 tag（$tag → ${id:0:19}…）" docker tag "$id" "$tag"
}

# tools 基础镜像新鲜度核对/重建（#58 评审修复：tools 纳入快照与不可变绑定）。
# 命中 → TOOLS_IMAGE_EFFECTIVE=状态 ID；未命中（无状态/镜像丢失/输入哈希不符）→
# 从快照物化目录重建并记录。NODE_IMAGE 取自快照内 images.lock，不读活工作树。
ensure_tools_image() { # <tree>
  local s="$1" h
  h="$(tools_input_hash "$s")"
  snapshot_state_load
  local labeled
  labeled="$(image_label_or_miss "$STATE_TOOLS_IMAGE_ID" '{{index .Config.Labels "devenv.tools.input-hash"}}')"
  if [[ -n "$STATE_TOOLS_IMAGE_ID" && "$STATE_TOOLS_INPUT_HASH" == "$h" && "$labeled" == "$h" ]]; then
    TOOLS_IMAGE_EFFECTIVE="$STATE_TOOLS_IMAGE_ID"
    register_local_image_tag "$STATE_TOOLS_IMAGE_ID" "$TOOLS_IMAGE"
    ev tools.fresh imageId="$STATE_TOOLS_IMAGE_ID" inputHash="$h"
    return 0
  fi
  snapshot_materialize_new "$s"
  local dir="$SNAPSHOT_MATERIALIZED_DIR" node_image img_id
  node_image="$(grep '^NODE_IMAGE=' "$dir/devenv/images.lock" | cut -d= -f2-)"
  ev step.started target="tools base image"
  run_step_out "tools 镜像构建" \
    docker build -q -t "$TOOLS_IMAGE" \
      --label "devenv.tools.input-hash=$h" \
      --build-arg "NODE_IMAGE=$node_image" \
      -f "$dir/devenv/tools.Dockerfile" "$dir"
  img_id="$RUN_STEP_OUT"
  [[ "$img_id" == sha256:* ]] || img_id="sha256:$img_id"  # podman 兼容层 -q 输出无前缀 64hex，归一
  if [[ ! "$img_id" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    snapshot_discard "$dir"
    die 4 "tools 镜像构建未返回不可变标识（输出：${img_id}）"
  fi
  TOOLS_IMAGE_EFFECTIVE="$img_id"
  snapshot_state_write_tools "$h" "$img_id"
  ev tools.built imageId="$img_id" inputHash="$h"
  ev step.completed target="tools base image"
  snapshot_discard "$dir"
  return 0
}

# 从固定快照构建 workspace 镜像并记录不可变绑定（#58）。
# 基础镜像经 --build-arg TOOLS_IMAGE=<不可变 ID> 传入（不依赖 per-worktree 可变
# 标签 wt-<suffix>）；镜像 label 记录快照哈希 + 构建输入清单 + 基础镜像 ID（可核对链路：
# 固定快照 → tools 不可变 ID → workspace 不可变 ID）；构建返回的 image ID
# （docker build -q 输出，免 tag 二次解析竞态）写入状态文件。
build_workspace_from_snapshot() { # <tree> [已物化目录]
  local s="$1" dir="${2:-}" own_dir=0
  [[ -n "$TOOLS_IMAGE_EFFECTIVE" ]] || die 4 "内部错误：构建 workspace 前未绑定 tools 镜像（ensure_tools_image 未运行）"
  if [[ -z "$dir" ]]; then
    snapshot_materialize_new "$s"
    dir="$SNAPSHOT_MATERIALIZED_DIR"
    own_dir=1
  fi
  # 下载证据构建参数仅在显式请求时传入（#64）：普通构建不带该 arg，构建输入/
  # 层缓存与既有行为一致；证据构建（DEVENV_PNPM_EVIDENCE=1）才改变 deps 层。
  # 只接受空/0/1——拼写错误（true/yes 等）必须显式失败，不能静默构建出无证据镜像。
  local -a evidence_args=()
  case "${DEVENV_PNPM_EVIDENCE:-}" in
    ""|0) ;;
    1) evidence_args=(--build-arg "PNPM_EVIDENCE=1") ;;
    *) die 2 "DEVENV_PNPM_EVIDENCE 只接受 0/1（当前：${DEVENV_PNPM_EVIDENCE}）" ;;
  esac
  ev step.started target="workspace image (snapshot build)"
  run_step_out "workspace 镜像构建" \
    docker build -q -t "$WS_IMAGE" \
      --label "devenv.snapshot.hash=$s" \
      --label "devenv.snapshot.inputs=$(snapshot_inputs_manifest "$s")" \
      --label "devenv.base.image=$TOOLS_IMAGE_EFFECTIVE" \
      --build-arg "TOOLS_IMAGE=$TOOLS_IMAGE_EFFECTIVE" \
      ${evidence_args[@]+"${evidence_args[@]}"} \
      -f "$dir/devenv/workspace.Dockerfile" "$dir"
  # docker build -q 输出即本次构建的不可变标识（免 tag 二次解析竞态）；
  # podman 兼容层输出无前缀 64hex，docker 输出带 sha256: 前缀——归一为带前缀形
  local img_id="$RUN_STEP_OUT"
  [[ "$img_id" == sha256:* ]] || img_id="sha256:$img_id"
  if [[ ! "$img_id" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    (( own_dir )) && snapshot_discard "$dir"
    die 4 "workspace 镜像构建未返回不可变标识（输出：${img_id}）"
  fi
  snapshot_state_write "$s" "$img_id"
  WS_IMAGE_EFFECTIVE="$img_id"
  ev workspace.built imageId="$img_id" snapshot="$s" base="$TOOLS_IMAGE_EFFECTIVE"
  ev step.completed target="workspace image (snapshot build)"
  (( own_dir )) && snapshot_discard "$dir"
  return 0
}

# 凡消费当前源码的命令前置（#58）：固定输入快照 → tools 新鲜度核对 → workspace
# 新鲜度核对（快照哈希 ↔ 镜像 devenv.snapshot.hash label ↔ 状态文件，且基础镜像
# label == 本次绑定的 tools ID，才跳过重构）→ 绑定不可变镜像标识。
# 未命中三态（无状态/镜像不存在/label 缺失或不符）一律进重建；引擎故障 die 3。
# 层缓存命中时重构秒级；快照一致时亚秒级跳过。
ensure_fresh_workspace() {
  ev step.started target="workspace image freshness"
  local s
  s="$(snapshot_capture)"  # stat 括号采集；窗口内有写入 → 重试/明确拒绝（die 4）
  ENSURE_SNAPSHOT_HASH="$s"  # e2e 执行器镜像复用同一快照（#70）
  ev snapshot.captured hash="$s"
  ensure_tools_image "$s"
  snapshot_state_load
  local labeled
  labeled="$(image_label_or_miss "$STATE_IMAGE_ID" '{{index .Config.Labels "devenv.snapshot.hash"}} {{index .Config.Labels "devenv.base.image"}}')"
  if [[ -n "$STATE_IMAGE_ID" && "$STATE_SNAPSHOT_HASH" == "$s" && "$labeled" == "$s $TOOLS_IMAGE_EFFECTIVE" ]]; then
    WS_IMAGE_EFFECTIVE="$STATE_IMAGE_ID"
    register_local_image_tag "$STATE_IMAGE_ID" "$WS_IMAGE"
    ev workspace.fresh imageId="$STATE_IMAGE_ID" snapshot="$s"
    note "workspace 镜像新鲜（快照 ${s:0:12}… ↔ ${STATE_IMAGE_ID:0:19}…），跳过重建"
    ev step.completed target="workspace image freshness"
    return 0
  fi
  ev step.completed target="workspace image freshness"
  build_workspace_from_snapshot "$s"
}

# 本 worktree 项目内某服务的容器 ID（--all 含停止态；多容器取首个；无则空）。
# 不用 | head -1：pipefail 下 SIGPIPE 竞态——先捕获再截首行。
svc_container_id() { # <svc> [--all]
  local svc="$1"
  local -a extra=()
  [[ "${2:-}" == "--all" ]] && extra=(-a)
  local c
  c="$(docker ps ${extra[@]+"${extra[@]}"} --filter "label=com.docker.compose.project=$PROJECT_NAME" \
      --filter "label=com.docker.compose.service=$svc" --format '{{.ID}}')"
  printf '%s' "${c%%$'\n'*}"
}

# 启动核对（#58）：实际运行容器必须使用本次绑定的不可变镜像标识——
# 同 worktree 可变 tag 被覆盖也不影响已绑定的运行产物。
verify_svc_image() { # $1=svc
  local svc="$1" c img
  c="$(svc_container_id "$svc")"
  [[ -n "$c" ]] || die 4 "启动核对失败：服务 [$svc] 无运行中容器"
  img="$(docker inspect "$c" --format '{{.Image}}')"
  if [[ "$img" != "$WS_IMAGE_EFFECTIVE" ]]; then
    die 4 "启动核对失败：[$svc] 运行镜像 $img ≠ 本次构建产物 ${WS_IMAGE_EFFECTIVE}（不可变绑定被破坏。排查：devenv build 后重试 devenv up）"
  fi
  ev image.verified service="$svc" imageId="$img"
}

# --- web 宿主端口（#62 并发 web 入口）-----------------------------------------
# 省略 --port 时注入裸容器端口（"4173"），由引擎在绑定时原子分配空闲宿主端口——
# 不做"探测时空闲 → 再绑定"式预占（TOCTOU），两进程并发 web 天然得到不同端口；
# 实际端口只能从绑定结果回读（docker port），不预测。显式 --port 注入
# "host:container" 固定发布，冲突在引擎绑定时真实失败，再诊断占用者。

# 回读本 worktree web 容器的实际宿主端口；web 未运行或不可回读 → 打印空（不报错，
# 调用方按场景决定 die 与否——status 只读报告 none，web 启动后必须可读）。
web_actual_port() {
  local c line
  c="$(svc_container_id web)"
  [[ -n "$c" ]] || return 0
  line="$(docker port "$c" 4173/tcp 2>/dev/null)" || line=""
  line="${line%%$'\n'*}"  # 可能多行（0.0.0.0/[::]），取首行；不用 | head -1（SIGPIPE 竞态）
  [[ -n "$line" ]] || return 0
  # 行形如 0.0.0.0:49152（或 [::]:49152）——取末段端口
  printf '%s' "${line##*:}"
}

# 宿主端口是否有监听者（TCP 可连）：纯 bash /dev/tcp，无外部依赖（macOS bash 3.2 可用）。
port_in_use() { # <port>
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

# web 启动失败后的绑定冲突诊断（仅显式 --port 时有意义；自动分配由引擎选空闲端口，
# 不存在占用冲突）。判据顺序：容器占用者（docker ps 的 Ports 文本匹配——podman
# 不支持 publish 过滤器）→ 宿主非容器监听者（/dev/tcp 探测）→ 都不是则返回
# （调用方按通用 compose 失败处理，不谎报端口占用）。
web_bind_failure_diagnose() { # <显式端口，空=自动>；确认占用时 die 3（含占用者与修复命令）
  local port="$1" holders=""
  [[ -n "$port" ]] || return 0
  holders="$(docker ps --format '{{.Names}} (project={{.Label "com.docker.compose.project"}}) {{.Ports}}' 2>/dev/null \
    | grep -F ":$port->" || true)"
  if [[ -n "$holders" ]]; then
    die 3 "服务 [web] 绑定失败：宿主端口 $port 已被容器占用。占用者：${holders}。修复：占用者是本 worktree 残留 → devenv web --down 后重试；属其它 worktree → 省略 --port 让引擎自动分配（devenv web），或换 devenv web --port <其它端口>"
  fi
  if port_in_use "$port"; then
    die 3 "服务 [web] 绑定失败：宿主端口 $port 被非容器进程占用（无容器发布该端口，但 127.0.0.1:$port 可连接）。修复：省略 --port 让引擎自动分配（devenv web），或 devenv web --port <空闲端口>"
  fi
  return 0
}

svc_running() {
  [[ -n "$(svc_container_id "$1")" ]]
}

svc_healthy() {
  # podman 兼容层的 docker ps Status 不带 "(healthy)" 后缀——以 inspect 的 Health.Status 为准
  local c
  c="$(svc_container_id "$1" --all)"
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
