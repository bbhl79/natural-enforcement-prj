# shellcheck shell=bash
# ============================================================================
# e2e 隔离 run 编排库（被 devenv/devenv source，不直接执行；#70）
#
# Spec-工程基座 §4「e2e run 服务绑定」+ Spec-e2e §11「数据级隔离与命名」：
#   - 基础设施容器共享：db/redis/rustfs 由 dev 栈提供（devenv up 后），本库把
#     它们接入 per-run external 网络（别名 db/redis/rustfs），不复制基础设施。
#   - 每 run 独立数据环境：数据库 e2e_<runid>（DROP FORCE 幂等重建 + migrate
#     deploy）、bucket e2e-<runid>、队列名 e2e-<runid>-evidence-processing；
#     命名按各存储系统规则分别净化、超长截断 + 短哈希保唯一。
#   - 被测服务本身绑定本 run 资源：per-run API/worker/web 容器经 compose.e2e.yaml
#     启动，DATABASE_URL / S3_BUCKET / EVIDENCE_QUEUE_NAME 注入（不是只给测试
#     脚本换名字）；worker 只消费本 run 队列。
#   - 运行期持 #61 共享栈使用租约：down/restart/migrate 等排他意图等待或 exit 6，
#     不会中途拆掉 run。
#   - 产物：执行器命名卷 → 宿主 .artifacts/e2e/<runid>/（docker cp，无 bind），
#     并写 run.json 运行登记册（.devenv-state/e2e-runs/<runid>.json）。
#   - 探索失败=产出：exit 4 + 产物路径 + 明确「不要误修测试栈」语义。
#
# 资源回收安全：只删除 e2e 专属前缀（e2e_<db> / e2e-<bucket> / 队列名 pattern）
# 且必须处于本库登记的 run_id 命名空间；开发库/桶永不进入候选集。
# ============================================================================

E2E_ARTIFACTS_ROOT="${DEVENV_E2E_ARTIFACTS_DIR:-$REPO_ROOT/.artifacts/e2e}"
E2E_REGISTRY_DIR="${DEVENV_STATE_DIR:-$REPO_ROOT/.devenv-state}/e2e-runs"
E2E_ACTIVE_RUN_ID=""
E2E_TRACK=""
E2E_STARTED_AT=""
E2E_DB_NAME=""
E2E_BUCKET=""
E2E_QUEUE_NAME=""
E2E_PROJECT=""
E2E_NETWORK=""
E2E_RUN_DIR=""

e2e_hash8() { printf '%s' "$1" | sha256sum | awk '{print $1}' | cut -c1-8; }

e2e_run_id_validate() { # <id>
  [[ "${1:-}" =~ ^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$ ]] \
    || die 2 "run id 非法：${1:-（空）}（只接受小写字母数字与连字符，1-40 字符，首尾必须字母/数字）"
}

# --- 三套净化规则（Spec-e2e §11）：分别满足 PG 标识符 / S3 bucket / BullMQ 队列名 ---
e2e_db_name() { # <rid> → e2e_<安全段>；PG 标识符 [A-Za-z0-9_]，≤63 字节
  local s
  s="e2e_$(printf '%s' "$1" | LC_ALL=C tr -c 'a-z0-9' '_')"
  if (( ${#s} > 63 )); then s="${s:0:54}_$(e2e_hash8 "$1")"; fi
  printf '%s' "$s"
}

e2e_bucket_name() { # <rid> → e2e-<安全段>；小写字母数字+连字符，3-63，首尾字母数字
  local s
  s="e2e-$(printf '%s' "$1" | LC_ALL=C tr -c 'a-z0-9-' '-')"
  while [[ "$s" == *- ]]; do s="${s%-}"; done  # 尾部连字符非法（run id 已校验首尾 alnum，这里防御）
  if (( ${#s} > 63 )); then
    s="${s:0:54}"
    while [[ "$s" == *- ]]; do s="${s%-}"; done
    s="${s}-$(e2e_hash8 "$1")"
  fi
  printf '%s' "$s"
}

e2e_queue_name() { # <rid> → e2e-<rid>-evidence-processing；BullMQ 6 队列名禁 ':'，前缀用 '-'
  local s="e2e-$1-evidence-processing"
  if (( ${#s} > 128 )); then s="e2e-$(e2e_hash8 "$1")-evidence-processing"; fi
  printf '%s' "$s"
}

e2e_derive_names() { # <rid> <track> → 设置本次 run 的全部命名空间
  e2e_run_id_validate "$1"
  E2E_RUN_ID="$1"
  E2E_TRACK="$2"
  E2E_DB_NAME="$(e2e_db_name "$1")"
  E2E_BUCKET="$(e2e_bucket_name "$1")"
  E2E_QUEUE_NAME="$(e2e_queue_name "$1")"
  E2E_PROJECT="${PROJECT_NAME}-e2e-${1}"
  E2E_NETWORK="${E2E_PROJECT}-net"
  E2E_RUN_DIR="$E2E_ARTIFACTS_ROOT/$1"
}

e2e_database_url() { # 本 run 的 DATABASE_URL（宿主 db 容器内网名 db）
  printf 'postgresql://ne:%s@db:5432/%s' "$DB_PASSWORD_EFFECTIVE" "$E2E_DB_NAME"
}

# per-run compose（独立项目名 + external per-run 网络；只启用 api/worker/web/e2e）
e2e_compose() {
  db_credentials_ensure
  storage_credentials_ensure
  local ws="${WS_IMAGE_EFFECTIVE:-}"
  if [[ -z "$ws" ]]; then snapshot_state_load; ws="${STATE_IMAGE_ID:-$WS_IMAGE}"; fi
  [[ -n "${E2E_IMAGE_EFFECTIVE:-}" ]] || die 4 "内部错误：e2e 执行器镜像未绑定（e2e_build_image 未运行）"
  E2E_WORKSPACE_IMAGE="$ws" \
    E2E_EXECUTOR_IMAGE="$E2E_IMAGE_EFFECTIVE" \
    E2E_DATABASE_URL="$(e2e_database_url)" \
    E2E_DATABASE_POOL_MAX="${E2E_DATABASE_POOL_MAX:-2}" \
    E2E_REDIS_URL="redis://redis:6379" \
    E2E_S3_ENDPOINT="http://rustfs:9000" \
    E2E_S3_REGION="us-east-1" \
    E2E_S3_ACCESS_KEY="$S3_ACCESS_KEY_EFFECTIVE" \
    E2E_S3_SECRET_KEY="$S3_SECRET_KEY_EFFECTIVE" \
    E2E_S3_BUCKET="$E2E_BUCKET" \
    E2E_DATABASE_NAME="$E2E_DB_NAME" \
    E2E_QUEUE_NAME="$E2E_QUEUE_NAME" \
    E2E_RUN_ID="$E2E_RUN_ID" \
    E2E_WORKTREE_SUFFIX="$WT_SUFFIX" \
    E2E_TRACK="$E2E_TRACK" \
    E2E_NETWORK="$E2E_NETWORK" \
    E2E_PARALLEL_GROUP="${E2E_PARALLEL_GROUP:-}" \
    E2E_PARALLEL_SOAK_MS="${E2E_PARALLEL_SOAK_MS:-0}" \
    E2E_FORCE_FINDING="${E2E_FORCE_FINDING:-}" \
    E2E_CHARTER_GAPS="${E2E_CHARTER_GAPS:-}" \
    docker compose -p "$E2E_PROJECT" -f "$E2E_COMPOSE_FILE" "$@"
}

# --- per-run 服务探针（按 compose 项目标签，不走全局 PROJECT_NAME）--------------
e2e_svc_container_id() { # <svc>
  local c
  c="$(docker ps --filter "label=com.docker.compose.project=$E2E_PROJECT" \
      --filter "label=com.docker.compose.service=$1" --format '{{.ID}}')"
  printf '%s' "${c%%$'\n'*}"
}

e2e_wait_healthy() { # <svc> <超时秒>
  local svc="$1" timeout="${2:-120}" waited=0 c names
  while (( waited < timeout )); do
    c="$(e2e_svc_container_id "$svc")"
    if [[ -n "$c" ]] && [[ "$(docker inspect "$c" --format '{{.State.Health.Status}}' 2>/dev/null)" == "healthy" ]]; then
      return 0
    fi
    if [[ -z "$c" ]]; then
      names="$(docker ps -a --filter "label=com.docker.compose.project=$E2E_PROJECT" \
        --filter "label=com.docker.compose.service=$svc" --format '{{.Names}}')"
      [[ -n "$names" ]] || die 4 "e2e 服务 [$svc] 容器不存在（compose up 失败；run=$E2E_RUN_ID）。排查：devenv e2e logs --run-id $E2E_RUN_ID $svc"
    fi
    sleep 2; waited=$((waited + 2))
  done
  [[ -n "${c:-}" ]] && docker logs --tail 50 "$c" >&2 2>/dev/null || true
  die 5 "e2e 服务 [$svc] 健康超时（${timeout}s；run=$E2E_RUN_ID）。排查：devenv e2e logs --run-id $E2E_RUN_ID $svc"
}

e2e_run_live() { # <rid>：本 worktree 内该 run 是否还有运行中的容器（按 worktree 标签限定）
  local c
  c="$(docker ps --filter "label=devenv.e2e.run-id=$1" \
      --filter "label=devenv.e2e.worktree=$WT_SUFFIX" --format '{{.ID}}')"
  [[ -n "$c" ]]
}

# --- run 所有权与启动期准入（#70 评审修复）------------------------------------
# e2e-owner-<wt>-<runid>：per-run-id 排他所有权锁——在创建任何 run 资源之前取得，
#   保持到回收结束；同 run id 的第二个进程在启动窗口即被拒绝，绝不能进入清理路径
#   （否则会拆掉第一个进程尚未 up 的活动资源）。锁名含 worktree 后缀：跨 worktree
#   的同名显式 run id 互不误判。
# e2e-admit-<wt>：短临界区锁，串行化「取得所有权 → 计数 → 登记」；计数看本 worktree
#   的活动所有权锁（含尚未启动容器的预留名额），因此启动窗口也计入并发上限。
e2e_owner_lock_name() { printf 'e2e-owner-%s-%s' "$WT_SUFFIX" "$E2E_RUN_ID"; }

e2e_ownership_count() { # 本 worktree 存活的所有权锁数（含当前进程已取得的）
  local dir count=0
  for dir in "$LOCK_ROOT"/e2e-owner-"$WT_SUFFIX"-*.lock; do
    [[ -d "$dir" ]] || continue
    if lock_is_stale "$dir"; then rm -rf "$dir"; else count=$((count + 1)); fi
  done
  printf '%s' "$count"
}

# --- 运行登记册（.devenv-state/e2e-runs/<rid>.json；回收双条件的第二条件）----
e2e_registry_write() { # <status> [exitCode]
  local status="$1" code="${2:-}" dir tmp
  dir="$E2E_REGISTRY_DIR"; mkdir -p "$dir" || die 4 "运行登记册目录不可写：$dir"
  tmp="$dir/.$E2E_RUN_ID.$$.tmp"
  jq -n \
    --arg runId "$E2E_RUN_ID" --arg track "$E2E_TRACK" --arg status "$status" --arg exitCode "$code" \
    --arg startedAt "$E2E_STARTED_AT" --arg updatedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg database "$E2E_DB_NAME" --arg bucket "$E2E_BUCKET" --arg queue "$E2E_QUEUE_NAME" \
    --arg project "$E2E_PROJECT" --arg network "$E2E_NETWORK" --arg artifactsDir "$E2E_RUN_DIR" \
    --arg workspaceImage "${WS_IMAGE_EFFECTIVE:-}" --arg executorImage "${E2E_IMAGE_EFFECTIVE:-}" \
    --arg playwrightImage "${PLAYWRIGHT_IMAGE:-}" --arg playwrightVersion "${PLAYWRIGHT_VERSION:-}" \
    --arg worktreeSuffix "$WT_SUFFIX" \
    '{schemaVersion:1,runId:$runId,track:$track,status:$status,exitCode:$exitCode,
      startedAt:$startedAt,updatedAt:$updatedAt,worktreeSuffix:$worktreeSuffix,
      database:$database,bucket:$bucket,queue:$queue,project:$project,network:$network,
      artifactsDir:$artifactsDir,
      images:{workspace:$workspaceImage,executor:$executorImage,playwright:$playwrightImage,playwrightVersion:$playwrightVersion}}' \
    > "$tmp" || { rm -f "$tmp"; die 4 "运行登记册写入失败：$E2E_RUN_ID"; }
  mv "$tmp" "$dir/$E2E_RUN_ID.json"
}

# --- e2e 执行器镜像（与 workspace 同一固定快照；Playwright 版本双重核对）------
e2e_build_image() { # <tree>
  local s="$1" labeled=""
  [[ "$s" =~ ^[0-9a-f]{40}$ ]] || die 4 "内部错误：e2e 镜像构建快照非法（${s}）"
  # per-worktree 执行器镜像锁（#70 评审修复）：两条命令/两个 explore 并发构建时
  # 串行化「核对状态 → 构建 → 写绑定」，避免可变 tag/独立状态文件的读改写交错；
  # 与栈锁/租约正交（不做栈变更），无锁序环。
  lock_acquire "e2e-image-$WT_SUFFIX" 120
  images_load
  snapshot_e2e_state_load
  labeled="$(image_label_or_miss "$STATE_E2E_IMAGE_ID" '{{index .Config.Labels "devenv.snapshot.hash"}} {{index .Config.Labels "devenv.playwright.image"}}')"
  if [[ -n "$STATE_E2E_IMAGE_ID" && "$STATE_E2E_SNAPSHOT_HASH" == "$s" \
        && "$STATE_E2E_PLAYWRIGHT_IMAGE" == "$PLAYWRIGHT_IMAGE" \
        && "$labeled" == "$s $PLAYWRIGHT_IMAGE" ]]; then
    E2E_IMAGE_EFFECTIVE="$STATE_E2E_IMAGE_ID"
    run_step "登记 per-worktree e2e 镜像 tag（$E2E_IMAGE → ${STATE_E2E_IMAGE_ID:0:19}…）" \
      docker tag "$STATE_E2E_IMAGE_ID" "$E2E_IMAGE"
    lock_release_one "e2e-image-$WT_SUFFIX"
    ev e2e_image.fresh imageId="$STATE_E2E_IMAGE_ID" snapshot="$s"
    return 0
  fi
  git -C "$REPO_ROOT" cat-file -e "${s}:apps/e2e/package.json" 2>/dev/null \
    || die 4 "快照内缺 apps/e2e/package.json：e2e 执行器镜像构建输入不完整（快照 ${s}）"
  snapshot_materialize_new "$s"
  local dir="$SNAPSHOT_MATERIALIZED_DIR" id
  ev step.started target="e2e executor image"
  run_step_out "e2e 执行器镜像构建" \
    docker build -q -t "$E2E_IMAGE" \
      --label "devenv.snapshot.hash=$s" \
      --label "devenv.playwright.image=$PLAYWRIGHT_IMAGE" \
      --label "devenv.playwright.version=$PLAYWRIGHT_VERSION" \
      --build-arg "PLAYWRIGHT_IMAGE=$PLAYWRIGHT_IMAGE" \
      --build-arg "PLAYWRIGHT_VERSION=$PLAYWRIGHT_VERSION" \
      -f "$dir/devenv/e2e.Dockerfile" "$dir"
  id="$RUN_STEP_OUT"
  [[ "$id" == sha256:* ]] || id="sha256:$id"  # podman 兼容层 -q 输出无前缀 64hex
  if [[ ! "$id" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    snapshot_discard "$dir"
    die 4 "e2e 执行器镜像构建未返回不可变标识（输出：${id}）"
  fi
  local pv
  pv="$(image_label_or_miss "$id" '{{index .Config.Labels "devenv.playwright.version"}}')"
  if [[ "$pv" != "$PLAYWRIGHT_VERSION" ]]; then
    snapshot_discard "$dir"
    die 4 "e2e 执行器镜像 Playwright 版本核对失败（label=${pv:-缺}，期望 ${PLAYWRIGHT_VERSION}）"
  fi
  E2E_IMAGE_EFFECTIVE="$id"
  snapshot_e2e_state_write "$s" "$id" "$PLAYWRIGHT_IMAGE"
  lock_release_one "e2e-image-$WT_SUFFIX"
  ev e2e_image.built imageId="$id" snapshot="$s" playwright="$PLAYWRIGHT_IMAGE"
  ev step.completed target="e2e executor image"
  snapshot_discard "$dir"
  return 0
}

# --- 共享基础设施接入 per-run 网络 -------------------------------------------
e2e_connect_infra() {
  if docker network inspect "$E2E_NETWORK" >/dev/null 2>&1; then
    die 6 "per-run 网络已存在（run id 冲突或上次未清理）：$E2E_NETWORK。修复：换 --run-id 或清理残留后重试"
  fi
  run_step "创建 per-run 网络" docker network create "$E2E_NETWORK"
  local s c
  for s in db redis rustfs; do
    c="$(svc_container_id "$s")"
    [[ -n "$c" ]] || die 3 "共享基础设施 [$s] 未运行。修复命令：devenv up"
    run_step "接入共享基础设施 [$s] → per-run 网络" \
      docker network connect --alias "$s" "$E2E_NETWORK" "$c"
  done
}

e2e_disconnect_infra() {
  local s c
  for s in db redis rustfs; do
    c="$(svc_container_id "$s")"
    [[ -n "$c" ]] || continue
    docker network disconnect -f "$E2E_NETWORK" "$c" >/dev/null 2>&1 || true
  done
  docker network rm "$E2E_NETWORK" >/dev/null 2>&1 || true
}

# --- 每 run 数据环境 ----------------------------------------------------------
e2e_db_purge() { # 幂等重建本 run 数据库（FORCE 断开活动连接）；绝不触碰开发库
  compose exec -T db psql -U ne -d natural_enforcement_dev -v ON_ERROR_STOP=1 \
    -c "DROP DATABASE IF EXISTS \"$E2E_DB_NAME\" WITH (FORCE)" \
    -c "CREATE DATABASE \"$E2E_DB_NAME\"" >&2
}

e2e_db_drop() {
  compose exec -T db psql -U ne -d natural_enforcement_dev \
    -c "DROP DATABASE IF EXISTS \"$E2E_DB_NAME\" WITH (FORCE)" >&2
}

e2e_migrate() {
  run_step "e2e 库迁移（prisma migrate deploy）" \
    compose run --rm -T -e "DATABASE_URL=$(e2e_database_url)" tools \
      pnpm --filter @ne/api exec prisma migrate deploy
}

e2e_bucket_purge() { # 只接受 e2e- 前缀；由 delete-bucket 脚本再次强制前缀规则
  compose run --rm -T tools node apps/api/dist/scripts/delete-bucket.js "$E2E_BUCKET" >&2
}

e2e_redis_purge() { # 只删本 run 队列的 BullMQ 键空间（精确 `bull:<queue>:` 前缀，避免子串误伤其它 run）
  compose exec -T redis sh -c \
    'redis-cli --scan --pattern "$1" | while IFS= read -r k; do redis-cli DEL "$k" >/dev/null; done' \
    _ "bull:${E2E_QUEUE_NAME}:*" >/dev/null
}

# --- per-run 服务启停 ---------------------------------------------------------
e2e_stack_start() {
  run_step "e2e per-run 服务启动（api/worker/web）" e2e_compose up -d api worker web
  ev wait.started service="e2e-api"
  e2e_wait_healthy api 120
  ev wait.ok service="e2e-api"
  ev wait.started service="e2e-web"
  e2e_wait_healthy web 120
  ev wait.ok service="e2e-web"
  ev wait.started service="e2e-worker"
  e2e_wait_healthy worker 120
  ev wait.ok service="e2e-worker"
}

e2e_run_playwright() { # 返回 Playwright 退出码（探索发现=非零，由调用方翻译为 exit 4）
  local rc=0
  e2e_compose run --rm -T e2e \
    pnpm --filter @ne/e2e exec playwright test --config=playwright.explore.config.ts >&2 || rc=$?
  return "$rc"
}

# --- 产物导出与运行清单 -------------------------------------------------------
e2e_export_artifacts() { # → $E2E_RUN_DIR（docker cp，无 bind）
  local vol="${E2E_PROJECT}_e2e-artifacts" cid rc=0 svc c
  mkdir -p "$E2E_RUN_DIR/logs" || return 1
  # 服务日志一并取证：v1 的失败归因依赖「前置健康 + 日志判读」（Spec-e2e 风险节）
  for svc in api worker web; do
    c="$(e2e_svc_container_id "$svc")"
    [[ -n "$c" ]] || continue
    docker logs "$c" > "$E2E_RUN_DIR/logs/$svc.log" 2>&1 || true
  done
  cid="$(docker create --mount "type=volume,source=$vol,target=/art" \
    "$E2E_IMAGE_EFFECTIVE" true 2>/dev/null)" || return 1
  docker cp "$cid:/art/." "$E2E_RUN_DIR" >&2 || rc=$?
  docker rm "$cid" >/dev/null 2>&1 || true
  return "$rc"
}

e2e_write_manifest() { # <playwrightRc> <status>
  local pw_rc="$1" status="$2" results="$E2E_RUN_DIR/results.json" stats="null" containers="[]"
  if [[ -f "$results" ]]; then
    stats="$(jq -c '.stats // null' "$results" 2>/dev/null || printf 'null')"
  fi
  # 本 run 实际运行容器清单（服务绑定证据：每个 run 一套 api/worker/web 实例）。
  # 先捕获再解析：docker ps 的空结果退出码不应让 jq 的 [] 被 || 兜底再追加一次。
  local names=""
  names="$(docker ps -a --filter "label=com.docker.compose.project=$E2E_PROJECT" \
    --format '{{.Names}}' 2>/dev/null || true)"
  containers="$(printf '%s\n' "$names" | jq -R -s 'split("\n") | map(select(length > 0)) | sort' 2>/dev/null || printf '[]')"
  jq -n \
    --arg runId "$E2E_RUN_ID" --arg track "$E2E_TRACK" --arg status "$status" \
    --arg playwrightExitCode "$pw_rc" --arg startedAt "$E2E_STARTED_AT" \
    --arg finishedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg database "$E2E_DB_NAME" --arg bucket "$E2E_BUCKET" --arg queue "$E2E_QUEUE_NAME" \
    --arg project "$E2E_PROJECT" --arg network "$E2E_NETWORK" --arg artifactsDir "$E2E_RUN_DIR" \
    --arg workspaceImage "${WS_IMAGE_EFFECTIVE:-}" --arg executorImage "${E2E_IMAGE_EFFECTIVE:-}" \
    --arg playwrightImage "${PLAYWRIGHT_IMAGE:-}" --arg playwrightVersion "${PLAYWRIGHT_VERSION:-}" \
    --arg worktreeSuffix "$WT_SUFFIX" --argjson stats "$stats" --argjson containers "$containers" \
    '{schemaVersion:1,runId:$runId,track:$track,status:$status,
      playwrightExitCode:($playwrightExitCode|tonumber),startedAt:$startedAt,finishedAt:$finishedAt,
      worktreeSuffix:$worktreeSuffix,
      resources:{database:$database,bucket:$bucket,queue:$queue,project:$project,network:$network,containers:$containers},
      images:{workspace:$workspaceImage,executor:$executorImage,playwright:$playwrightImage,playwrightVersion:$playwrightVersion},
      artifactsDir:$artifactsDir,stats:$stats}' \
    > "$E2E_RUN_DIR/run.json"
}

# 并发 run 硬上限（Spec-e2e §11：池 × 并发 < max_connections）：admission 锁把
# 「取得所有权 → 计数 → 登记 running」串行化；所有权锁在启动前取得并保持到回收结束，
# 因此计数含"已登记但尚未起容器"的预留名额（修复启动窗口超发）。
e2e_admission_begin() {
  local max="${E2E_MAX_CONCURRENT_RUNS:-4}" owner count
  [[ "$max" =~ ^[1-9][0-9]*$ ]] \
    || die 2 "E2E_MAX_CONCURRENT_RUNS 需为正整数（当前：${max}）"
  lock_acquire "e2e-admit-$WT_SUFFIX" 120
  owner="$(e2e_owner_lock_name)"
  # 同 run id 所有权：启动窗口内第二个进程在此等待/exit 6，绝不进入清理路径
  lock_acquire "$owner" 2
  if e2e_run_live "$E2E_RUN_ID"; then
    lock_release_one "$owner"
    lock_release_one "e2e-admit-$WT_SUFFIX"
    die 6 "run id [$E2E_RUN_ID] 仍有运行中的容器（上次异常退出残留或另一进程正在启动）。修复：换 --run-id，或确认后清理该 run（参见 .devenv-state/e2e-runs/$E2E_RUN_ID.json）"
  fi
  count="$(e2e_ownership_count)"
  if (( count > max )); then
    lock_release_one "$owner"
    lock_release_one "e2e-admit-$WT_SUFFIX"
    die 6 "并发 e2e run 已达上限（计数 ${count}/${max}，含启动中预留）。修复：等待其它 run 结束，或显式设置 E2E_MAX_CONCURRENT_RUNS（须满足 pool×并发 < max_connections）"
  fi
  E2E_STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  # 通过上限后才登记为「活动 run」：上限拒绝不触发回收；登记写入期间异常退出仍由
  # EXIT trap 按 aborted 收尾。所有权锁保持到本 run 回收结束。
  E2E_ACTIVE_RUN_ID="$E2E_RUN_ID"
  e2e_registry_write running
  lock_release_one "e2e-admit-$WT_SUFFIX"
}

# --- 回收（best-effort；失败不掩盖主结果）-------------------------------------
e2e_teardown() { # 依赖当前 E2E_* 全局；每一步独立子 shell，任何 die 不影响其余
  local rid="$E2E_RUN_ID"
  [[ -n "$rid" ]] || return 0
  ( e2e_compose down --remove-orphans -v ) >/dev/null 2>&1 || true
  ( e2e_disconnect_infra ) >/dev/null 2>&1 || true
  ( e2e_db_drop ) >/dev/null 2>&1 || true
  ( e2e_bucket_purge ) >/dev/null 2>&1 || true
  ( e2e_redis_purge ) >/dev/null 2>&1 || true
  note "e2e run 资源已回收（run=${rid}；库/桶/键空间前缀清理 best-effort）"
}

e2e_cleanup_on_exit() {
  [[ -n "${E2E_ACTIVE_RUN_ID:-}" ]] || return 0
  local rid="$E2E_ACTIVE_RUN_ID"
  e2e_teardown >/dev/null 2>&1 || true
  # 登记册：若仍是 running（异常退出/信号），标记 aborted，供人工复核
  if [[ -f "$E2E_REGISTRY_DIR/$rid.json" ]] \
      && [[ "$(jq -r '.status' "$E2E_REGISTRY_DIR/$rid.json" 2>/dev/null)" == "running" ]]; then
    E2E_RUN_ID="$rid"
    e2e_registry_write aborted 130 >/dev/null 2>&1 || true
  fi
  E2E_ACTIVE_RUN_ID=""
}

# --- 命令面 -------------------------------------------------------------------
cmd_explore() { # 探索轨道：失败=产出（exit 4 + 证据路径），不是环境事故
  local rid=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --run-id) rid="${2:?--run-id 需要值}"; shift 2 ;;
      *) die 2 "未知参数：$1（用法：explore [--run-id ID]）" ;;
    esac
  done
  [[ -n "$rid" ]] || rid="exp-${WT_SUFFIX}-$(date +%s)-${RANDOM}"
  e2e_run_id_validate "$rid"

  # 栈使用租约（#61）：run 全生命周期持共享租约；down/restart/migrate 排他意图
  # 等待或 exit 6，不会在 run 中途拆栈/迁移。
  lease_acquire "stack-$WT_SUFFIX" 120
  require_services db redis rustfs
  ensure_fresh_workspace
  e2e_build_image "$ENSURE_SNAPSHOT_HASH"

  e2e_derive_names "$rid" "explore"
  E2E_ACTIVE_RUN_ID=""
  mkdir -p "$E2E_RUN_DIR"
  e2e_admission_begin  # 所有权 + 上限（含启动预留）→ 登记 running；拒绝时不留活动标记
  note "e2e 探索 run=${rid}：db=${E2E_DB_NAME} bucket=${E2E_BUCKET} queue=${E2E_QUEUE_NAME}"
  note "基础设施容器共享（db/redis/rustfs），每 run API/worker/web 绑定本 run 资源"

  e2e_connect_infra
  ev step.started target="e2e database"
  e2e_db_purge
  e2e_migrate
  ev step.completed target="e2e database"
  e2e_stack_start

  local test_rc=0 export_rc=0
  ev step.started target="explore suite" runId="$rid"
  e2e_run_playwright || test_rc=$?
  if (( test_rc == 0 )); then
    ev step.completed target="explore suite" verdict="passed"
  else
    ev step.completed target="explore suite" verdict="findings" exitCode="$test_rc"
  fi

  e2e_export_artifacts || export_rc=$?
  if (( export_rc != 0 )); then
    warn "e2e 产物导出失败（docker cp，退出码 ${export_rc}）：$E2E_RUN_DIR"
  fi
  local status="ok"
  (( test_rc != 0 || export_rc != 0 )) && status="failed"
  e2e_write_manifest "$test_rc" "$status" || warn "run.json 写入失败：$E2E_RUN_DIR/run.json"

  e2e_teardown
  local final_code=0
  if (( test_rc != 0 || export_rc != 0 )); then final_code=4; fi
  e2e_registry_write "$status" "$final_code"
  E2E_ACTIVE_RUN_ID=""
  lock_release_one "$(e2e_owner_lock_name)"  # 回收结束后才释放 run 所有权

  if (( test_rc != 0 )); then
    note "探索轨道失败（退出码 ${test_rc}）—— 按产出处理：先读证据判读是「探索发现」还是「环境/服务绑定故障」，不要未经判读就改测试栈。"
    note "证据：${E2E_RUN_DIR}/（results.json / trace / video / html-report / logs；run.json 记录本 run 资源）"
    note "判读为探索发现 → 登记缺陷；判读为环境/服务绑定故障 → 按证据修复运行环境（logs/ 与 run.json 可用于区分）。"
    final failed 4 runId="$rid" track=explore artifacts="$E2E_RUN_DIR" \
      database="$E2E_DB_NAME" bucket="$E2E_BUCKET" queue="$E2E_QUEUE_NAME"
    exit 4
  fi
  if (( export_rc != 0 )); then
    final failed 4 runId="$rid" track=explore artifacts="$E2E_RUN_DIR" reason=artifact-export
    die 4 "探索轨道通过但产物导出失败（退出码 ${export_rc}）——无法留存证据，判任务失败"
  fi
  note "探索轨道本轮无失败发现（run=${rid}）"
  note "证据：${E2E_RUN_DIR}/（run.json 记录本 run 库/bucket/队列与镜像绑定）"
  final ok 0 runId="$rid" track=explore artifacts="$E2E_RUN_DIR" \
    database="$E2E_DB_NAME" bucket="$E2E_BUCKET" queue="$E2E_QUEUE_NAME"
}

cmd_e2e_build() { # e2e 执行器镜像显式构建（AC1：可经 devenv 构建）
  [[ $# -eq 0 ]] || die 2 "多余参数：$1（用法：e2e build）"
  # 与 devenv build 同一静态门禁：catalog/allowBuilds/冷却期/锁文件漂移/镜像锁
  # （e2e 镜像消费者必须基于已审查的输入构建）
  if ! supply_chain_static_check "$REPO_ROOT" 0; then
    sc_print_report
    final failed 4 step="supply-chain" errors="$(sc_error_count)" hint="docs/agents/supply-chain.md"
    die 4 "供应链门禁未通过（$(sc_error_count) 项）：e2e 执行器镜像构建已停止。审查后重试；规则见 docs/agents/supply-chain.md"
  fi
  local s
  s="$(snapshot_capture)"
  ev snapshot.captured hash="$s"
  e2e_build_image "$s"
  final ok 0 imageId="$E2E_IMAGE_EFFECTIVE" snapshot="$s" \
    playwrightImage="$PLAYWRIGHT_IMAGE" playwrightVersion="$PLAYWRIGHT_VERSION"
}

cmd_e2e_runs() { # 运行登记册 + live 状态（只读）
  [[ $# -eq 0 ]] || die 2 "多余参数：$1（用法：e2e runs）"
  local -a files=()
  shopt -s nullglob
  files=("$E2E_REGISTRY_DIR"/*.json)
  shopt -u nullglob
  local runs="[]"
  if (( ${#files[@]} > 0 )); then
    runs="$(jq -s 'sort_by(.startedAt) | reverse' "${files[@]}")" \
      || die 4 "运行登记册解析失败：$E2E_REGISTRY_DIR"
  fi
  if (( JSON )); then
    printf '{"command":"e2e","subcommand":"runs","status":"ok","exitCode":0,"runs":%s}\n' "$runs"
    return 0
  fi
  note "e2e 运行登记册（${E2E_REGISTRY_DIR}）："
  if (( ${#files[@]} == 0 )); then
    printf '  无\n' >&2
    return 0
  fi
  local row rid live
  while IFS= read -r row; do
    rid="$(jq -r '.runId' <<<"$row")"
    if e2e_run_live "$rid"; then live=yes; else live=no; fi
    printf '  %-40s status=%-7s live=%-3s db=%-28s bucket=%-30s queue=%s\n' \
      "$rid" "$(jq -r '.status' <<<"$row")" "$live" \
      "$(jq -r '.database' <<<"$row")" "$(jq -r '.bucket' <<<"$row")" \
      "$(jq -r '.queue' <<<"$row")" >&2
  done < <(jq -c '.[]' <<<"$runs")
}

cmd_e2e_logs() { # 观察 per-run 容器日志（透传；JSON 时原始流走 stderr）
  local rid="" svc="api" follow=0 tail=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --run-id) rid="${2:?--run-id 需要值}"; shift 2 ;;
      --tail) tail="${2:?--tail 需要值}"; shift 2 ;;
      -f|--follow) follow=1; shift ;;
      -*) die 2 "未知参数：$1（用法：e2e logs --run-id ID [api|worker|web] [-f] [--tail N]）" ;;
      *) svc="$1"; shift ;;
    esac
  done
  [[ -n "$rid" ]] || die 2 "缺 --run-id（用法：e2e logs --run-id ID [api|worker|web] [-f] [--tail N]）"
  e2e_run_id_validate "$rid"
  local project="${PROJECT_NAME}-e2e-${rid}" c
  c="$(docker ps -a --filter "label=com.docker.compose.project=$project" \
      --filter "label=com.docker.compose.service=$svc" --format '{{.ID}}')"
  c="${c%%$'\n'*}"
  [[ -n "$c" ]] || die 3 "run [$rid] 无服务 [$svc] 容器（已回收或 run id 不对）。查看：devenv e2e runs"
  local -a args=(logs)
  (( follow )) && args+=(-f)
  [[ -n "$tail" ]] && args+=(--tail "$tail")
  args+=("$c")
  run_passthrough docker "${args[@]}"
}

cmd_e2e() {
  local sub="${1:-}"
  [[ -n "$sub" ]] || die 2 "用法：e2e <build|runs|logs|defect|registry|replay> ..."
  shift
  case "$sub" in
    build) cmd_e2e_build "$@" ;;
    runs)  cmd_e2e_runs "$@" ;;
    logs)  cmd_e2e_logs "$@" ;;
    # 生命周期命令面（#106；决策引擎宿主桥在 lib/e2e-lifecycle.sh）
    defect)   cmd_e2e_defect "$@" ;;
    registry) cmd_e2e_registry "$@" ;;
    # 重放（#108；per-run 编排 + 签名原语桥在 lib/e2e-replay.sh）
    replay)   cmd_e2e_replay "$@" ;;
    *) die 2 "未知 e2e 子命令：${sub}（当前：build | runs | logs | defect | registry | replay）" ;;
  esac
}