#!/usr/bin/env bash
# ============================================================================
# 双 worktree 运行隔离冒烟（真实引擎；#60 macOS 验收，Windows 对应证据见 #59）
#
# 用途：A 保持运行，B 在独立 worktree 内完成 build→up→migrate→seed→空间查询
# →down，复验 A 的运行版本、数据与访问地址不变；同时留存两个 worktree 的
# 资源名、实际端点、镜像标识与运行凭据隔离证据。B 构建期间 A 并发执行一次
# 幂等 up，断言两栈锁互不阻塞（覆盖 #60 的「锁」维度）。
#
# 验收断言失败即非零退出（不是只打印差异）：基线/复验探针缺失、A 不变量变化、
# 项目名/凭据指纹/web 端口相同、B down 后 A 容器缺失、空间查询失败等均计入
# FAILURES；步骤命令自身非零退出立即以该退出码终止。唯一例外是 --no-web：
# 显式跳过 web 后不声称验证了宿主访问地址，终值记录 web_checked=0。
#
# 前置（脚本不替你创建/清理栈，避免误拆既有运行）：
#   - 两个 worktree 均已存在且干净（B 须是独立 git worktree；建议与 A 同 commit）；
#     为观察镜像共享差异，B 宜为无 .devenv-state 的新 worktree；
#   - 两栈当前均未运行；
#   - 宿主有 docker CLI + compose v2 + curl/jq/sha256sum（devenv 白名单同款）；
#   - macOS 若默认端点发现歧义，显式设置 DEVENV_DOCKER_HOST（见 COMMANDS.md）；
#     ARM 主机 DB 路线未登记进 images.lock 前，按 #53 用 DEVENV_DB_IMAGE 覆盖。
#   这两项由调用方环境决定，脚本原样继承并在 00-environment.txt 记录来源。
#
# 用法：
#   devenv/test/worktree-isolation-smoke.sh --a <worktree-a> --b <worktree-b>
#       [--evidence-dir DIR] [--no-web] [--b-cleanup-volumes]
#
#   --no-web              跳过 web 入口（不验证宿主访问地址；终值 web_checked=0）
#   --b-cleanup-volumes   B 的收尾 down 带 --volumes（额外清理，不属验收序列）
#   --evidence-dir DIR    默认 <repo>/.artifacts/60-mac-worktree-isolation
#
# 证据布局（stdout 只走驱动自己的进度，原始流全部落盘）：
#   00-environment.txt              宿主/引擎/端点/架构/工具
#   01-a-doctor.jsonl               构建前体检
#   02-a-prefetch.jsonl             镜像预取
#   03-a-build.jsonl                A 构建（快照 + 不可变镜像）
#   04-a-up.jsonl                   A 起栈（db→migrate→api）
#   05-a-migrate.jsonl              迁移幂等复核
#   06-a-seed.jsonl                 幂等种子
#   07-a-spatial-query.{out,err,exitcode}  真实空间查询（rc 断言）
#   08-a-web.jsonl / .curl.txt      A web 入口与宿主地址（失败即终止）
#   09-a-baseline.{txt,invariants}  A 基线：容器/镜像/凭据/数据/地址
#   09b-a-up-concurrent.jsonl       B 构建期间 A 并发幂等 up（锁隔离）
#   09c-lock-isolation.txt          嵌套时间窗 + 并发期逐秒锁采样（两把不同栈锁同时存在）
#   09c-lock-samples.txt            并发期每秒的锁目录快照（原始证据）
#   10-b-doctor.jsonl               B 体检（独立项目/凭据）
#   11-b-build.jsonl                B 构建（与 A up 并发）
#   11b-b-status.jsonl              B 项目名/后缀/镜像标识
#   12-b-up.jsonl … 15-b-spatial-query.*  B 起栈、迁移、种子、空间查询
#   16-b-web.jsonl / .curl.txt      B web（并发端口与 A 不同）
#   17-a-during-b.txt               B 全流程进行中 A 的现场
#   17b-during-b-inventory.txt      两栈同时在跑时的项目/容器/卷/网络对照
#   17c-runtime-credentials.txt     两端运行中 db 容器注入口令指纹（不同）
#   18-b-web-down.jsonl / 19-b-down.jsonl
#   20-a-after-b.{txt,invariants}   B down 后 A 复验
#   20-a-invariants.diff            A 不变量 diff（空 = 未变；非空即 FAIL）
#   21-isolation-inventory.txt      两栈资源名/镜像/凭据/锁/端口对照
#   22-a-final-status.jsonl / 23-a-final-doctor.jsonl
#   90-commands.txt / 90-timings.tsv / 99-result.txt / evidence.log
# ============================================================================
set -Eeuo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TEST_DIR/../.." && pwd)"
# shellcheck source=lib-evidence.sh
source "$TEST_DIR/lib-evidence.sh"

print_header() { # 头部说明（到 set -Eeuo 前一行）
  local end
  end="$(grep -n '^set -Eeuo pipefail' "${BASH_SOURCE[0]}" | head -1 | cut -d: -f1)"
  sed -n "2,$((end - 1))p" "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

usage() {
  print_header
  exit 2
}

A_DIR=""; B_DIR=""; EV_DIR=""; DO_WEB=1; B_CLEAN_VOLUMES=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --a) [[ $# -ge 2 && -n "$2" && "$2" != -* ]] || usage; A_DIR="$2"; shift 2 ;;
    --b) [[ $# -ge 2 && -n "$2" && "$2" != -* ]] || usage; B_DIR="$2"; shift 2 ;;
    --evidence-dir) [[ $# -ge 2 && -n "$2" && "$2" != -* ]] || usage; EV_DIR="$2"; shift 2 ;;
    --no-web) DO_WEB=0; shift ;;
    --b-cleanup-volumes) B_CLEAN_VOLUMES=1; shift ;;
    -h|--help) print_header; exit 0 ;;
    *) echo "未知参数：$1" >&2; usage ;;
  esac
done
[[ -n "$A_DIR" && -n "$B_DIR" ]] || usage

A_DIR="$(cd "$A_DIR" && pwd)"
B_DIR="$(cd "$B_DIR" && pwd)"
DENV_A="$A_DIR/devenv/devenv"
DENV_B="$B_DIR/devenv/devenv"
[[ -x "$DENV_A" ]] || { echo "A worktree 缺少 devenv 入口：$DENV_A" >&2; exit 2; }
[[ -x "$DENV_B" ]] || { echo "B worktree 缺少 devenv 入口：$DENV_B" >&2; exit 2; }
[[ "$A_DIR" != "$B_DIR" ]] || { echo "A 与 B 必须是两个不同 worktree" >&2; exit 2; }

GITDIR_A="$(git -C "$A_DIR" rev-parse --absolute-git-dir 2>/dev/null || true)"
GITDIR_B="$(git -C "$B_DIR" rev-parse --absolute-git-dir 2>/dev/null || true)"
[[ -z "$GITDIR_A" || -z "$GITDIR_B" || "$GITDIR_A" != "$GITDIR_B" ]] \
  || { echo "A 与 B 解析到同一 git 目录（$GITDIR_A）；必须使用两个独立 worktree" >&2; exit 2; }

[[ -n "$EV_DIR" ]] || EV_DIR="$REPO_ROOT/.artifacts/60-mac-worktree-isolation"
ev_init "$EV_DIR"
: > "$EV_DIR/90-commands.txt"
: > "$EV_DIR/90-timings.tsv"
: > "$EV_DIR/90-summary.txt"
printf 'RESULT=INCOMPLETE\n' > "$EV_DIR/99-result.txt"
LAST_RC=0
FAILURES=0
A_PORT=""; A_URL=""; B_PORT=""; B_URL=""

# ---------------------------------------------------------------------------
# 驱动助手
# ---------------------------------------------------------------------------
fail_check() { # 记录一项验收失败，结束时统一非零退出
  ev_log "FAIL: $*"
  printf 'FAIL: %s\n' "$*" >> "$EV_DIR/90-summary.txt"
  FAILURES=$((FAILURES + 1))
}

fail_fatal() { # 无法继续的探针/步骤失败：保留已落盘证据后立即非零退出
  ev_log "FAIL: $*"
  printf 'FAILED: %s\n' "$*" >> "$EV_DIR/90-summary.txt"
  printf 'RESULT=FAIL\n' > "$EV_DIR/99-result.txt"
  exit 4
}

run_devenv() { # <label> <denv> <subcommand...>
  local label="$1" denv="$2"; shift 2
  local rc=0 t0=$SECONDS
  printf '%s\t%s\n' "$label" "$(printf '%q ' "$denv" "$@")" >> "$EV_DIR/90-commands.txt"
  ev_run "$label" "$denv" "$@" || rc=$?
  # 结构化命令的 stdout 事件流另存 .jsonl（与 .out 同内容，命名表达协议）
  [[ -f "$EV_DIR/$label.out" ]] && cp "$EV_DIR/$label.out" "$EV_DIR/$label.jsonl"
  printf '%s\n' "$rc" > "$EV_DIR/$label.exitcode"
  printf '%s\t%s\t%ss\n' "$label" "$rc" "$((SECONDS - t0))" >> "$EV_DIR/90-timings.tsv"
  LAST_RC="$rc"
  printf '[%s] %-28s rc=%s (%ss)\n' "$(date -u +%H:%M:%SZ)" "$label" "$rc" "$((SECONDS - t0))" >&2
  return 0
}

require_ok() { # <label> —— 依赖 LAST_RC；失败即终止
  [[ "$LAST_RC" -eq 0 ]] || fail_fatal "$1 退出码 $LAST_RC（见 $EV_DIR/$1.err）"
}

obs() { # <file> <label> <cmd...> —— 宿主观测仪器，非验收路径
  local file="$1" label="$2"; shift 2
  local rc=0 out
  out="$("$@" 2>&1)" || rc=$?
  {
    printf '### %s（rc=%s）\n$ ' "$label" "$rc"
    printf '%q ' "$@"; printf '\n%s\n\n' "$out"
  } >> "$EV_DIR/$file"
}

json_last() { # <file> <jq-filter>
  tail -1 "$1" 2>/dev/null | jq -r "$2" 2>/dev/null || true
}

inv_get() { # <invariants-file> <key>
  grep -E "^$2=" "$1" 2>/dev/null | head -1 | cut -d= -f2- || true
}

# 从 .devenv-state/db-credentials.env 提取口令并只记录指纹（口令不落证据）。
cred_fingerprint() { # <worktree> —— 状态文件中的口令指纹（只记录指纹）
  local f="$1/.devenv-state/db-credentials.env" pw
  [[ -f "$f" ]] || { printf 'none'; return 0; }
  pw="$(grep -E '^DB_PASSWORD=' "$f" | head -1 | cut -d= -f2- || true)"
  [[ -n "$pw" ]] || { printf 'none'; return 0; }
  printf '%s' "$pw" | sha256sum | awk '{print $1}'
}

runtime_cred_fingerprint() { # <denv> —— 从运行中的 db 容器取注入口令的指纹（不落口令）
  "$1" exec db -- sh -c 'printf %s "$POSTGRES_PASSWORD" | sha256sum | cut -d" " -f1' 2>/dev/null || true
}

write_or_print() { # <out-file> —— out-file 为 "-" 时写 stdout
  if [[ "$1" == "-" ]]; then cat; else cat >> "$1"; fi
}

container_dump() { # <project> <out-file>
  local proj="$1" out="$2"
  [[ -n "$proj" ]] || return 0
  docker ps -a --filter "label=com.docker.compose.project=$proj" \
    --format '{{.Names}}|{{.Image}}|{{.CreatedAt}}|{{.Status}}' 2>&1 | write_or_print "$out" || true
}

inspect_dump() { # <project> <out-file>
  local proj="$1" out="$2" names name
  names="$(docker ps -a --filter "label=com.docker.compose.project=$proj" --format '{{.Names}}' 2>/dev/null || true)"
  local IFS=$'\n'
  for name in $names; do
    [[ -n "$name" ]] || continue
    docker inspect -f '{{.Name}}|image={{.Image}}|started={{.State.StartedAt}}|ips={{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' "$name" >> "$out" 2>&1 || true
  done
}

sql_admin() { # <denv> <sql>
  "$1" exec db -- sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U ne -d natural_enforcement_dev -X -v ON_ERROR_STOP=1 -t -A -P pager=off -c "$1"' _ "$2"
}

# 单一来源：既用于执行，也原样写入 90-commands.txt（不写占位符）。
SPATIAL_SQL='PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U ne -d natural_enforcement_dev -X -v ON_ERROR_STOP=1 -P pager=off \
    -c "SELECT count(*) AS seed_points FROM \"EnforcementPoint\";" \
    -c "SELECT id, name, ROUND(ST_Distance(location, ST_MakePoint(113.2644,23.1291)::geography)::numeric, 1) AS dist_m FROM \"EnforcementPoint\" WHERE ST_DWithin(location, ST_MakePoint(113.2644,23.1291)::geography, 8000) ORDER BY location <-> ST_MakePoint(113.2644,23.1291)::geography LIMIT 5;" \
    -c "EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM \"EnforcementPoint\" WHERE ST_DWithin(location, ST_MakePoint(113.2644,23.1291)::geography, 2000) ORDER BY location <-> ST_MakePoint(113.2644,23.1291)::geography LIMIT 5;"'

spatial_query() { # <denv> <out-base> —— 原始 stdout 落 <base>.out，stderr 落 <base>.err
  "$1" exec db -- sh -c "$SPATIAL_SQL" > "$2.out" 2> "$2.err"
}

run_query() { # <label> <denv> <out-base>
  local label="$1" denv="$2" base="$3" rc=0 t0=$SECONDS
  printf '%s\t%s\n' "$label" "$(printf '%q ' "$denv" exec db -- sh -c "$SPATIAL_SQL")" >> "$EV_DIR/90-commands.txt"
  spatial_query "$denv" "$base" || rc=$?
  printf '%s\n' "$rc" > "$EV_DIR/$label.exitcode"
  printf '%s\t%s\t%ss\n' "$label" "$rc" "$((SECONDS - t0))" >> "$EV_DIR/90-timings.tsv"
  LAST_RC="$rc"
  printf '[%s] %-28s rc=%s (%ss)\n' "$(date -u +%H:%M:%SZ)" "$label" "$rc" "$((SECONDS - t0))" >&2
}

api_health() { # <denv> —— 从 tools 容器按服务名访问 api，stdout=JSON 健康体
  "$1" exec tools -- node -e "fetch('http://api:3000/health').then(async r=>{process.stdout.write(await r.text());process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"
}

start_web() { # <label> <denv> —— 成功时 stdout "port|url"；任何失败终止
  run_devenv "$1" "$2" --json web
  require_ok "$1"
  local port url
  port="$(json_last "$EV_DIR/$1.jsonl" '.port')"
  url="$(json_last "$EV_DIR/$1.jsonl" '.url')"
  [[ -n "$port" && "$port" != "none" && -n "$url" && "$url" != "none" ]] \
    || fail_fatal "$1 终值缺少 port/url（web 已健康但地址不可回读）"
  printf '%s|%s' "$port" "$url"
}

curl_web() { # <url> <out-file> —— 记录 HTTP 码、正文 sha256 与响应头；stdout=HTTP 码
  local url="$1" out="$2" code="" body_sha="" tmp
  tmp="$(mktemp /tmp/ne60-web.XXXXXX)"
  code="$(curl -sS -m 20 -o "$tmp" -w '%{http_code}' "$url" 2>>"$out")" || code="curl-failed"
  body_sha="$(sha256sum "$tmp" | awk '{print $1}')"
  {
    printf 'url=%s\nhttp_code=%s\nbody_sha256=%s\n' "$url" "$code" "$body_sha"
    printf '%s\n' '--- headers ---'
    curl -sS -m 20 -D - -o /dev/null "$url" 2>>"$out" | tr -d '\r' || true
  } >> "$out"
  rm -f "$tmp"
  printf '%s' "$code"
}

# A 的不变量快照：key=value 行可直接 diff；人读细节另存 <tag>.txt。
collect_a() { # <tag>
  local tag="$1"
  local status_f="$EV_DIR/$tag.status.jsonl"
  local detail="$EV_DIR/$tag.txt"
  local inv="$EV_DIR/$tag.invariants"
  local proj port url fp

  : > "$detail"; : > "$inv"

  "$DENV_A" --json status > "$status_f" 2> "$EV_DIR/$tag.status.err" || true
  proj="$(json_last "$status_f" '.project')"
  port="$(json_last "$status_f" '.web_port')"
  url="$(json_last "$status_f" '.web_url')"

  {
    printf '=== %s ===\n' "$tag"
    printf 'time=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'worktree=%s\n' "$A_DIR"
    printf '%s\n' '--- devenv status --json（终值）---'
    tail -1 "$status_f" 2>/dev/null || true
    printf '\n--- 容器 ---\n'
  } >> "$detail"
  container_dump "$proj" "$detail"
  printf '\n--- inspect（镜像绑定 / 启动时间 / 容器内地址）---\n' >> "$detail"
  inspect_dump "$proj" "$detail"

  fp="$(cred_fingerprint "$A_DIR")"
  local rfp db_start row_count sentinel_name sentinel_text web_code web_sha health
  rfp="$(runtime_cred_fingerprint "$DENV_A")"
  db_start="$(sql_admin "$DENV_A" 'SELECT pg_postmaster_start_time();' 2>>"$detail" || true)"
  row_count="$(sql_admin "$DENV_A" 'SELECT count(*) FROM "EnforcementPoint";' 2>>"$detail" || true)"
  sentinel_name="$(inv_get "$EV_DIR/90-runvars.env" SENTINEL_A_60_NAME)"
  sentinel_text="$(sql_admin "$DENV_A" "SELECT COALESCE(ST_AsText(location),'NULL') FROM \"EnforcementPoint\" WHERE name='$sentinel_name';" 2>>"$detail" || true)"
  health="$(api_health "$DENV_A" 2>>"$detail" || true)"
  web_code="none"; web_sha="none"
  if (( DO_WEB )) && [[ -n "$port" && "$port" != "none" && -n "$url" && "$url" != "none" ]]; then
    : > "$EV_DIR/$tag.web-curl.txt"
    curl_web "$url" "$EV_DIR/$tag.web-curl.txt" >/dev/null || true
    web_code="$(grep -E '^http_code=' "$EV_DIR/$tag.web-curl.txt" | tail -1 | cut -d= -f2- || true)"
    web_sha="$(grep -E '^body_sha256=' "$EV_DIR/$tag.web-curl.txt" | tail -1 | cut -d= -f2- || true)"
  fi

  {
    printf '%s\n%s\n' '--- 凭据指纹（sha256，口令本体不落证据）---' "$fp"
    printf '%s\n%s\n' '--- DB postmaster 启动时间 ---' "$db_start"
    printf '%s\n%s\n' '--- 行数 ---' "$row_count"
    printf '%s\n%s | %s\n' '--- 哨兵行 ---' "$sentinel_name" "$sentinel_text"
    printf '%s\n%s\n' '--- api 健康（容器内地址 http://api:3000/health）---' "$health"
    printf '%s\nurl=%s\nhttp_code=%s\nbody_sha256=%s\n' '--- web 访问地址 ---' "$url" "$web_code" "$web_sha"
  } >> "$detail"

  {
    printf 'project=%s\n' "$proj"
    printf 'workspace_image_id=%s\n' "$(json_last "$status_f" '.workspace_image_id')"
    printf 'tools_image_id=%s\n' "$(json_last "$status_f" '.tools_image_id')"
    printf 'snapshot_hash=%s\n' "$(json_last "$status_f" '.snapshot_hash')"
    printf 'db_image=%s\n' "$(json_last "$status_f" '.db_image')"
    printf 'db_credentials_sha256=%s\n' "$fp"
    printf 'db_runtime_credentials_sha256=%s\n' "$rfp"
    printf 'db_postmaster_start=%s\n' "$db_start"
    printf 'row_count=%s\n' "$row_count"
    printf 'sentinel_name=%s\n' "$sentinel_name"
    printf 'sentinel_text=%s\n' "$sentinel_text"
    printf 'api_status=%s\n' "$(printf '%s' "$health" | jq -r '.status // "none"' 2>/dev/null || echo none)"
    printf 'web_checked=%s\n' "$DO_WEB"
    printf 'web_url=%s\n' "$url"
    printf 'web_http_code=%s\n' "$web_code"
    printf 'web_body_sha256=%s\n' "$web_sha"
    printf '%s\n' '--- containers ---'
    docker ps -a --filter "label=com.docker.compose.project=$proj" \
      --format '{{.Names}}|{{.Image}}|{{.CreatedAt}}' 2>&1 || true
    printf '%s\n' '--- container bindings ---'
    local names name
    names="$(docker ps -a --filter "label=com.docker.compose.project=$proj" --format '{{.Names}}' 2>/dev/null || true)"
    local IFS=$'\n'
    for name in $names; do
      [[ -n "$name" ]] || continue
      docker inspect -f '{{.Name}}|{{.Image}}|{{.State.StartedAt}}|{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' "$name" 2>&1 || true
    done
    printf '%s\n' '--- volumes ---'
    docker volume ls --format '{{.Name}}' 2>/dev/null | grep -F "${proj}_" | sort || true
    printf '%s\n' '--- networks ---'
    docker network ls --format '{{.Name}}' 2>/dev/null | grep -F "${proj}_" | sort || true
  } >> "$inv"
}

# 探针完整性：防止「两次都失败、diff 却一致」的假 PASS。
validate_a() { # <tag> —— 0=完整；1=有缺失
  local tag="$1" inv="$EV_DIR/$1.invariants" errs=0
  local proj ws tools snap fp rfp dbstart rows sent api webcode websha
  local expected=2 bindings containers
  proj="$(inv_get "$inv" project)"
  ws="$(inv_get "$inv" workspace_image_id)"
  tools="$(inv_get "$inv" tools_image_id)"
  snap="$(inv_get "$inv" snapshot_hash)"
  fp="$(inv_get "$inv" db_credentials_sha256)"
  rfp="$(inv_get "$inv" db_runtime_credentials_sha256)"
  dbstart="$(inv_get "$inv" db_postmaster_start)"
  rows="$(inv_get "$inv" row_count)"
  sent="$(inv_get "$inv" sentinel_text)"
  api="$(inv_get "$inv" api_status)"
  webcode="$(inv_get "$inv" web_http_code)"
  websha="$(inv_get "$inv" web_body_sha256)"

  [[ "$proj" =~ ^natural-enforcement-[0-9a-f]{8}$ ]] || { ev_log "探针 $tag: project 非法（$proj）"; errs=1; }
  [[ "$ws" =~ ^sha256:[0-9a-f]{64}$ ]] || { ev_log "探针 $tag: workspace_image_id 非法"; errs=1; }
  [[ "$tools" =~ ^sha256:[0-9a-f]{64}$ ]] || { ev_log "探针 $tag: tools_image_id 非法"; errs=1; }
  [[ "$snap" =~ ^[0-9a-f]{40}$ ]] || { ev_log "探针 $tag: snapshot_hash 非法"; errs=1; }
  [[ "$fp" =~ ^[0-9a-f]{64}$ ]] || { ev_log "探针 $tag: 凭据指纹非法（$fp）"; errs=1; }
  [[ "$rfp" =~ ^[0-9a-f]{64}$ ]] || { ev_log "探针 $tag: 运行凭据指纹非法（$rfp）"; errs=1; }
  [[ "$rfp" == "$fp" ]] || { ev_log "探针 $tag: 运行凭据与状态文件不一致"; errs=1; }
  [[ -n "$dbstart" ]] || { ev_log "探针 $tag: DB 启动时间为空"; errs=1; }
  if [[ "$rows" =~ ^[0-9]+$ ]] && (( 10#$rows > 0 )); then :; else
    ev_log "探针 $tag: 行数非法（$rows）"; errs=1
  fi
  [[ "$sent" == "POINT("* ]] || { ev_log "探针 $tag: 哨兵行缺失（$sent）"; errs=1; }
  [[ "$api" == "ok" ]] || { ev_log "探针 $tag: api 不健康（$api）"; errs=1; }
  if (( DO_WEB )); then expected=3; fi
  containers="$(sed -n '/^--- containers ---$/,/^--- container bindings ---$/p' "$inv" | grep -cE '^natural-enforcement-' || true)"
  bindings="$(grep -cE '^/[^|]+\|sha256:[0-9a-f]{64}\|' "$inv" || true)"
  (( containers >= expected )) || { ev_log "探针 $tag: 容器列表不完整（$containers < $expected）"; errs=1; }
  (( bindings >= expected )) || { ev_log "探针 $tag: 镜像绑定不完整（$bindings < $expected）"; errs=1; }
  if (( DO_WEB )); then
    [[ "$webcode" == "200" ]] || { ev_log "探针 $tag: web HTTP=$webcode"; errs=1; }
    [[ "$websha" =~ ^[0-9a-f]{64}$ ]] || { ev_log "探针 $tag: web 正文 sha256 非法"; errs=1; }
  fi
  return "$errs"
}

section() { printf '\n=== %s ===\n' "$1" >> "$EV_DIR/90-summary.txt"; }

# ---------------------------------------------------------------------------
# 0. 环境与前置核对
# ---------------------------------------------------------------------------
section "环境"
{
  printf 'date=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'host=%s\n' "$(uname -a)"
  printf 'sw_vers=%s\n' "$(sw_vers 2>/dev/null | tr '\n' ' ' || true)"
  printf 'a_worktree=%s\nb_worktree=%s\n' "$A_DIR" "$B_DIR"
  printf 'DEVENV_DOCKER_HOST=%s\n' "${DEVENV_DOCKER_HOST:-<unset>}"
  printf 'DOCKER_HOST=%s\n' "${DOCKER_HOST:-<unset>}"
  printf 'DEVENV_DB_IMAGE=%s\n' "${DEVENV_DB_IMAGE:-<unset>}"
  printf 'git_a=%s\ngit_b=%s\n' "$(git -C "$A_DIR" rev-parse HEAD 2>/dev/null || echo none)" "$(git -C "$B_DIR" rev-parse HEAD 2>/dev/null || echo none)"
} > "$EV_DIR/00-environment.txt"
obs 00-environment.txt "docker version" docker version
obs 00-environment.txt "docker compose version" docker compose version
obs 00-environment.txt "podman machine list" podman machine list
obs 00-environment.txt "images" docker images --format '{{.Repository}}:{{.Tag}}|{{.ID}}|{{.Size}}'
obs 00-environment.txt "df" df -h /

# 前置守卫：两栈必须都未运行（避免本脚本把既有运行当成 A 的基线）。
for pair in "A:$DENV_A" "B:$DENV_B"; do
  wlbl="${pair%%:*}"; wdenv="${pair#*:}"
  wstate="$(mktemp /tmp/ne60-pre.XXXXXX)"
  "$wdenv" --json status > "$wstate" 2>/dev/null || true
  wp="$(json_last "$wstate" '.project')"
  wc="$(docker ps -q --filter "label=com.docker.compose.project=$wp" 2>/dev/null | wc -l | tr -d ' ' || true)"
  rm -f "$wstate"
  if [[ "${wc:-0}" != "0" ]]; then
    echo "前置失败：$wlbl（project=$wp）已有 $wc 个容器在运行；请先在该 worktree 执行 devenv web --down（若起过 web）与 devenv down" >&2
    exit 3
  fi
done

# 本 run 的哨兵名（只记名称与坐标，不涉及口令）
SENTINEL_NAME="SENTINEL-A-60-$(date +%s)"
printf 'SENTINEL_A_60_NAME=%s\n' "$SENTINEL_NAME" > "$EV_DIR/90-runvars.env"
ev_log "A=$A_DIR B=$B_DIR sentinel=$SENTINEL_NAME web=$DO_WEB"

# ---------------------------------------------------------------------------
# 1. A：完整起栈 + 数据 + web + 基线
# ---------------------------------------------------------------------------
section "A 起栈与基线"
run_devenv 01-a-doctor "$DENV_A" --json doctor;                                  require_ok 01-a-doctor
run_devenv 02-a-prefetch "$DENV_A" --json prefetch;                              require_ok 02-a-prefetch
run_devenv 03-a-build "$DENV_A" --json build;                                    require_ok 03-a-build
run_devenv 04-a-up "$DENV_A" --json up;                                          require_ok 04-a-up
run_devenv 05-a-migrate "$DENV_A" --json migrate;                                require_ok 05-a-migrate
run_devenv 06-a-seed "$DENV_A" --json seed;                                      require_ok 06-a-seed
run_query 07-a-spatial-query "$DENV_A" "$EV_DIR/07-a-spatial-query";             require_ok 07-a-spatial-query
grep -Eq 'Index Scan using .*EnforcementPoint_location_idx' "$EV_DIR/07-a-spatial-query.out" || fail_check "A 空间查询未走 GiST Index Scan（EnforcementPoint_location_idx）"

if (( DO_WEB )); then
  A_WEB="$(start_web 08-a-web "$DENV_A")"
  A_PORT="${A_WEB%%|*}"; A_URL="${A_WEB#*|}"
  : > "$EV_DIR/08-a-web.curl.txt"
  printf 'A web：port=%s url=%s\n' "$A_PORT" "$A_URL" >> "$EV_DIR/08-a-web.curl.txt"
  curl_web "$A_URL" "$EV_DIR/08-a-web.curl.txt" >/dev/null
else
  printf 'skipped by --no-web\n' > "$EV_DIR/08-a-web.jsonl"
fi

# 哨兵行（A 的数据标记；B 全流程后必须仍在）
sql_admin "$DENV_A" "INSERT INTO \"EnforcementPoint\" (name, location) VALUES ('$SENTINEL_NAME', ST_MakePoint(113.2644,23.1291)::geography) ON CONFLICT (name) DO NOTHING;" \
  > "$EV_DIR/09-a-sentinel-insert.out" 2> "$EV_DIR/09-a-sentinel-insert.err" \
  || fail_fatal "A 哨兵行插入失败（见 09-a-sentinel-insert.err）"
collect_a 09-a-baseline
validate_a 09-a-baseline || fail_fatal "A 基线探针缺失（见 09-a-baseline.invariants 与 .txt）"

# ---------------------------------------------------------------------------
# 2. B：build（与 A 并发 up）→ up → migrate → seed → 空间查询（→ web）
# ---------------------------------------------------------------------------
section "B 全流程（build 与 A up 并发）"
run_devenv 10-b-doctor "$DENV_B" --json doctor;                                  require_ok 10-b-doctor

# 锁隔离：B build 持 B 的排他栈锁，A 同时执行幂等 up 持 A 的排他栈锁。
# 仅「时间窗重叠」会误判：若锁是机器级共享，A up 会被 B build 阻塞到结束后才返回，
# 时间窗仍然重叠。因此要求 A up 完整嵌套在 B build 窗口内，并在并发期逐秒采样
# 锁目录，断言两把不同的栈锁在同一采样行中同时存在。
B_BUILD_START="$(date +%s)"
( run_devenv 11-b-build "$DENV_B" --json build ) &
B_BUILD_PID=$!
sleep 1   # 让 B 先取得自己的栈锁
A_UP_START="$(date +%s)"
( run_devenv 09b-a-up-concurrent "$DENV_A" --json up ) &
A_UP_PID=$!
: > "$EV_DIR/09c-lock-samples.txt"
while kill -0 "$A_UP_PID" 2>/dev/null; do
  printf '%s %s\n' "$(date +%s)" "$(ls /tmp/natural-enforcement-locks 2>/dev/null | tr '\n' ' ')" >> "$EV_DIR/09c-lock-samples.txt"
  sleep 1
done
wait "$A_UP_PID" || true
A_UP_END="$(date +%s)"
wait "$B_BUILD_PID" || true
B_BUILD_END="$(date +%s)"
B_BUILD_RC="$(cat "$EV_DIR/11-b-build.exitcode" 2>/dev/null || echo 1)"
A_UP_RC="$(cat "$EV_DIR/09b-a-up-concurrent.exitcode" 2>/dev/null || echo 1)"
[[ "$B_BUILD_RC" == "0" ]] || fail_fatal "11-b-build 退出码 $B_BUILD_RC（见 11-b-build.err）"
[[ "$A_UP_RC" == "0" ]] || fail_fatal "09b-a-up-concurrent 退出码 $A_UP_RC（见 09b-a-up-concurrent.err）"
{
  printf 'B build: start=%s end=%s rc=%s\n' "$B_BUILD_START" "$B_BUILD_END" "$B_BUILD_RC"
  printf 'A up（并发）: start=%s end=%s rc=%s\n' "$A_UP_START" "$A_UP_END" "$A_UP_RC"
  if (( A_UP_START >= B_BUILD_START && A_UP_END <= B_BUILD_END )); then
    printf 'nested=yes（A up 完整发生在 B build 期间）\n'
  else
    printf 'nested=no\n'
  fi
} > "$EV_DIR/09c-lock-isolation.txt"
grep -q 'nested=yes' "$EV_DIR/09c-lock-isolation.txt" || fail_check "A up 未被 B build 窗口完整包含，锁隔离未被覆盖（见 09c-lock-isolation.txt）"

run_devenv 11b-b-status "$DENV_B" --json status;                                 require_ok 11b-b-status
run_devenv 12-b-up "$DENV_B" --json up;                                          require_ok 12-b-up
run_devenv 13-b-migrate "$DENV_B" --json migrate;                                require_ok 13-b-migrate
run_devenv 14-b-seed "$DENV_B" --json seed;                                      require_ok 14-b-seed
run_query 15-b-spatial-query "$DENV_B" "$EV_DIR/15-b-spatial-query";             require_ok 15-b-spatial-query
grep -Eq 'Index Scan using .*EnforcementPoint_location_idx' "$EV_DIR/15-b-spatial-query.out" || fail_check "B 空间查询未走 GiST Index Scan（EnforcementPoint_location_idx）"

if (( DO_WEB )); then
  B_WEB="$(start_web 16-b-web "$DENV_B")"
  B_PORT="${B_WEB%%|*}"; B_URL="${B_WEB#*|}"
  : > "$EV_DIR/16-b-web.curl.txt"
  printf 'B web：port=%s url=%s\n' "$B_PORT" "$B_URL" >> "$EV_DIR/16-b-web.curl.txt"
  curl_web "$B_URL" "$EV_DIR/16-b-web.curl.txt" >/dev/null
else
  printf 'skipped by --no-web\n' > "$EV_DIR/16-b-web.jsonl"
fi

APROJ="$(json_last "$EV_DIR/09-a-baseline.status.jsonl" '.project')"
BPROJ="$(json_last "$EV_DIR/11b-b-status.jsonl" '.project')"
A_SUFFIX="$(json_last "$EV_DIR/09-a-baseline.status.jsonl" '.worktree_suffix')"
B_SUFFIX="$(json_last "$EV_DIR/11b-b-status.jsonl" '.worktree_suffix')"

# 锁命名空间：并发采样中必须同一行同时出现两把不同的栈锁。
LOCK_A="stack-${A_SUFFIX}.lock"; LOCK_B="stack-${B_SUFFIX}.lock"
if awk -v a="$LOCK_A" -v b="$LOCK_B" 'index($0, a) && index($0, b) { found=1 } END { exit !found }' "$EV_DIR/09c-lock-samples.txt"; then
  printf 'simultaneous_locks=yes（%s 与 %s 同帧持有）\n' "$LOCK_A" "$LOCK_B" >> "$EV_DIR/09c-lock-isolation.txt"
else
  printf 'simultaneous_locks=no（期望 %s 与 %s）\n' "$LOCK_A" "$LOCK_B" >> "$EV_DIR/09c-lock-isolation.txt"
  fail_check "并发采样未同时观测到两 worktree 的栈锁（见 09c-lock-samples.txt）"
fi

# B 全流程进行中：A 现场
A_DURING_CODE="none"
if (( DO_WEB )); then
  A_DURING_CODE="$(curl -sS -m 10 -o /dev/null -w '%{http_code}' "$A_URL" 2>/dev/null || true)"
fi
{
  printf '=== A 现场（B 已 up/migrate/seed/web 之后）===\n'
  printf 'A web 可达性：%s\n' "$A_DURING_CODE"
  printf 'A web 端口：%s ｜ B web 端口：%s（须不同）\n' "${A_PORT:-none}" "${B_PORT:-none}"
  printf 'A 容器：\n'
  container_dump "$APROJ" "-"
  printf 'A api 健康：\n'
  api_health "$DENV_A" 2>&1 || true
  printf '\nA 哨兵行：\n'
  sql_admin "$DENV_A" "SELECT name, ST_AsText(location) FROM \"EnforcementPoint\" WHERE name='$SENTINEL_NAME';" 2>&1 || true
  printf '\n'
} > "$EV_DIR/17-a-during-b.txt" 2>&1
if (( DO_WEB )); then
  [[ "$A_DURING_CODE" == "200" ]] || fail_check "B 运行期间 A web 不可达（HTTP=$A_DURING_CODE）"
fi

# 两栈同时在跑时的资源归属（AC3 要求记录实际资源名/网络；B down 后网络即消失）
{
  for pair in "A:$APROJ" "B:$BPROJ"; do
    lbl="${pair%%:*}"; proj="${pair#*:}"
    printf '=== %s project=%s ===\n' "$lbl" "$proj"
    printf '%s\n' '--- containers ---'
    container_dump "$proj" "-"
    printf '%s\n' '--- volumes ---'
    docker volume ls --format '{{.Name}}' 2>/dev/null | grep -F "${proj}_" | sort || true
    printf '%s\n' '--- networks ---'
    docker network ls --format '{{.Name}}' 2>/dev/null | grep -F "${proj}_" | sort || true
    printf '\n'
  done
  printf '锁命名空间（two stacks running）：\n'
  ls -la /tmp/natural-enforcement-locks 2>&1 || true
} > "$EV_DIR/17b-during-b-inventory.txt" 2>&1
grep -q "natural-enforcement-${B_SUFFIX}_default" "$EV_DIR/17b-during-b-inventory.txt" \
  || fail_check "B 运行中未观测到其独立网络（${BPROJ}_default）"
grep -q "natural-enforcement-${B_SUFFIX}_pgdata" "$EV_DIR/17b-during-b-inventory.txt" \
  || fail_check "B 运行中未观测到其独立数据卷（${BPROJ}_pgdata）"
[[ "$APROJ" != "$BPROJ" ]] || fail_check "A/B 共用 compose 项目名（$APROJ）"

# 运行凭据隔离：从两端运行中的 db 容器取注入口令指纹（不落口令本体）
B_RFP="$(runtime_cred_fingerprint "$DENV_B")"
A_RFP="$(inv_get "$EV_DIR/09-a-baseline.invariants" db_runtime_credentials_sha256)"
{
  printf 'A runtime db credential sha256=%s\n' "$A_RFP"
  printf 'B runtime db credential sha256=%s\n' "$B_RFP"
  if [[ "$B_RFP" =~ ^[0-9a-f]{64}$ && "$B_RFP" != "$A_RFP" ]]; then
    printf 'runtime_credentials_distinct=yes\n'
  else
    printf 'runtime_credentials_distinct=no\n'
  fi
} > "$EV_DIR/17c-runtime-credentials.txt"
[[ "$B_RFP" =~ ^[0-9a-f]{64}$ && "$A_RFP" =~ ^[0-9a-f]{64}$ ]] || fail_check "运行凭据指纹缺失（A=${A_RFP:-none} B=${B_RFP:-none}）"
[[ "$B_RFP" != "$A_RFP" ]] || fail_check "A/B 运行凭据指纹相同（A=$A_RFP B=$B_RFP）"

# ---------------------------------------------------------------------------
# 3. B 拆栈：web --down → down（验 A 不受影响）
# ---------------------------------------------------------------------------
section "B 拆栈"
if (( DO_WEB )); then
  run_devenv 18-b-web-down "$DENV_B" --json web --down; require_ok 18-b-web-down
fi
if (( B_CLEAN_VOLUMES )); then
  run_devenv 19-b-down "$DENV_B" --json down --volumes; require_ok 19-b-down
else
  run_devenv 19-b-down "$DENV_B" --json down; require_ok 19-b-down
fi

# B down 的作用域断言：B 容器/网络消失，A 容器仍在
B_LEFT="$(docker ps -aq --filter "label=com.docker.compose.project=$BPROJ" 2>/dev/null | wc -l | tr -d ' ' || true)"
[[ "$B_LEFT" =~ ^[0-9]+$ ]] || fail_check "无法统计 B 容器数（docker ps 失败）"
[[ "$B_LEFT" == "0" ]] || fail_check "B down 后仍有 $B_LEFT 个 B 项目容器"
if docker network ls --format '{{.Name}}' 2>/dev/null | grep -qxF "${BPROJ}_default"; then
  fail_check "B down 后 B 项目网络仍存在（${BPROJ}_default）"
fi
A_LEFT="$(docker ps -q --filter "label=com.docker.compose.project=$APROJ" 2>/dev/null | wc -l | tr -d ' ' || true)"
[[ "$A_LEFT" =~ ^[0-9]+$ ]] || fail_check "无法统计 A 容器数（docker ps 失败）"
A_MIN=2
if (( DO_WEB )); then A_MIN=3; fi
(( A_LEFT >= A_MIN )) || fail_check "B down 后 A 运行容器数异常（$A_LEFT < $A_MIN）"

# ---------------------------------------------------------------------------
# 4. B down 后 A 复验
# ---------------------------------------------------------------------------
section "A 复验（B down 后）"
collect_a 20-a-after-b
validate_a 20-a-after-b || fail_check "A 复验探针缺失（无法证明 A 数据/地址）"
if diff -u "$EV_DIR/09-a-baseline.invariants" "$EV_DIR/20-a-after-b.invariants" > "$EV_DIR/20-a-invariants.diff" 2>&1; then
  ev_log "PASS: A 不变量与基线逐行一致（20-a-invariants.diff 为空）"
  printf 'UNCHANGED\n' > "$EV_DIR/20-a-invariants.result"
else
  ev_log "FAIL: A 不变量在 B 全流程后发生变化（见 20-a-invariants.diff）"
  printf 'CHANGED\n' > "$EV_DIR/20-a-invariants.result"
  fail_check "A 不变量在 B 全流程后发生变化（见 20-a-invariants.diff）"
fi

# uptime 单独断言：同一 api 进程 → 复验时应更大
UP_BEFORE="$(grep -o '"uptime":[0-9]*' "$EV_DIR/09-a-baseline.txt" | head -1 | cut -d: -f2 || true)"
UP_AFTER="$(grep -o '"uptime":[0-9]*' "$EV_DIR/20-a-after-b.txt" | head -1 | cut -d: -f2 || true)"
{
  printf 'api_uptime_before=%s\napi_uptime_after=%s\n' "${UP_BEFORE:-none}" "${UP_AFTER:-none}"
  if [[ "${UP_BEFORE:-}" =~ ^[0-9]+$ && "${UP_AFTER:-}" =~ ^[0-9]+$ ]] && (( UP_AFTER > UP_BEFORE )); then
    printf 'same_process=yes（uptime 递增，进程未重启）\n'
  else
    printf 'same_process=no/unknown\n'
  fi
} >> "$EV_DIR/20-a-after-b.txt"
if [[ "${UP_BEFORE:-}" =~ ^[0-9]+$ && "${UP_AFTER:-}" =~ ^[0-9]+$ ]] && (( UP_AFTER > UP_BEFORE )); then :; else
  fail_check "A api uptime 未递增（before=${UP_BEFORE:-none} after=${UP_AFTER:-none}）"
fi

# ---------------------------------------------------------------------------
# 5. 隔离对照清单与交叉断言
# ---------------------------------------------------------------------------
section "隔离对照"
FP_A="$(cred_fingerprint "$A_DIR")"
FP_B="$(cred_fingerprint "$B_DIR")"
[[ "$FP_A" =~ ^[0-9a-f]{64}$ && "$FP_B" =~ ^[0-9a-f]{64}$ ]] || fail_check "A/B 数据库凭据指纹缺失（A=${FP_A:-none} B=${FP_B:-none}）"
[[ "$FP_A" != "$FP_B" ]] || fail_check "A/B 数据库凭据指纹相同（A=$FP_A B=$FP_B）"
if (( DO_WEB )); then
  [[ -n "$A_PORT" && -n "$B_PORT" && "$A_PORT" != "$B_PORT" ]] \
    || fail_check "A/B web 端口相同或缺失（A=${A_PORT:-none} B=${B_PORT:-none}）"
  B_WEB_CODE="$(grep -E '^http_code=' "$EV_DIR/16-b-web.curl.txt" | tail -1 | cut -d= -f2- || true)"
  [[ "$B_WEB_CODE" == "200" ]] || fail_check "B web HTTP=$B_WEB_CODE"
fi
{
  printf '=== 两个 worktree 的资源名 / 端点 / 镜像 / 凭据 / 锁 / 端口 ===\n'
  printf 'A worktree：%s\n' "$A_DIR"
  printf 'B worktree：%s\n' "$B_DIR"
  printf 'A project：%s\n' "$APROJ"
  printf 'B project：%s\n' "$BPROJ"
  printf 'A suffix：%s ｜ B suffix：%s\n' \
    "$(json_last "$EV_DIR/09-a-baseline.status.jsonl" '.worktree_suffix')" "$B_SUFFIX"
  printf 'A workspace image：%s\n' "$(json_last "$EV_DIR/09-a-baseline.status.jsonl" '.workspace_image_id')"
  printf 'B workspace image：%s\n' "$(json_last "$EV_DIR/11b-b-status.jsonl" '.workspace_image_id')"
  printf 'A tools image：%s\n' "$(json_last "$EV_DIR/09-a-baseline.status.jsonl" '.tools_image_id')"
  printf 'B tools image：%s\n' "$(json_last "$EV_DIR/11b-b-status.jsonl" '.tools_image_id')"
  printf 'A 凭据指纹：%s\n' "$FP_A"
  printf 'B 凭据指纹：%s\n' "$FP_B"
  printf 'A web：%s（%s）\n' "${A_PORT:-none}" "${A_URL:-none}"
  printf 'B web：%s（%s）\n' "${B_PORT:-none}" "${B_URL:-none}"
  printf '\n--- 全部 natural-enforcement 容器（含遗留项目）---\n'
  docker ps -a --format '{{.Names}}|{{.Label "com.docker.compose.project"}}|{{.Image}}|{{.Status}}' 2>&1 | grep -F 'natural-enforcement' || true
  printf '\n--- 全部 natural-enforcement 卷 ---\n'
  docker volume ls --format '{{.Name}}' 2>&1 | grep -F 'natural-enforcement' || true
  printf '\n--- 全部 natural-enforcement 网络 ---\n'
  docker network ls --format '{{.Name}}' 2>&1 | grep -F 'natural-enforcement' || true
  printf '\n--- 本地构建镜像 tag ---\n'
  docker images --format '{{.Repository}}:{{.Tag}}|{{.ID}}' 2>&1 | grep -F 'natural-enforcement/' || true
  printf '\n--- 锁命名空间 ---\n'
  ls -la /tmp/natural-enforcement-locks 2>&1 || true
  printf '\n--- 共享镜像 ID 对照（A 状态 vs B 状态；仅记录，平台差异见诊断文件）---\n'
  AID="$(json_last "$EV_DIR/09-a-baseline.status.jsonl" '.workspace_image_id')"
  BID="$(json_last "$EV_DIR/11b-b-status.jsonl" '.workspace_image_id')"
  TID_A="$(json_last "$EV_DIR/09-a-baseline.status.jsonl" '.tools_image_id')"
  TID_B="$(json_last "$EV_DIR/11b-b-status.jsonl" '.tools_image_id')"
  if [[ -n "$AID" && "$AID" == "$BID" ]]; then
    printf 'workspace_image_shared=yes（%s）\n' "$AID"
  else
    printf 'workspace_image_shared=no（A=%s B=%s）\n' "${AID:-none}" "${BID:-none}"
  fi
  if [[ -n "$TID_A" && "$TID_A" == "$TID_B" ]]; then
    printf 'tools_image_shared=yes（%s）\n' "$TID_A"
  else
    printf 'tools_image_shared=no（A=%s B=%s）\n' "${TID_A:-none}" "${TID_B:-none}"
  fi
} > "$EV_DIR/21-isolation-inventory.txt" 2>&1

# ---------------------------------------------------------------------------
# 6. A 终态与总判定
# ---------------------------------------------------------------------------
section "A 终态"
run_devenv 22-a-final-status "$DENV_A" --json status; require_ok 22-a-final-status
run_devenv 23-a-final-doctor "$DENV_A" --json doctor; require_ok 23-a-final-doctor

{
  printf 'evidence=%s\n' "$EV_DIR"
  printf 'A worktree=%s\nB worktree=%s\n' "$A_DIR" "$B_DIR"
  printf 'A 保持运行（收尾未拆 A；需要清理时在 A 执行 devenv web --down 后 devenv down [--volumes]）\n'
  printf 'A web=%s\n' "${A_URL:-none}"
  printf 'B 已在收尾 down；卷保留=%s\n' "$((1 - B_CLEAN_VOLUMES))"
  printf 'web_checked=%s\n' "$DO_WEB"
  printf 'failures=%s\n' "$FAILURES"
} | tee -a "$EV_DIR/90-summary.txt" >&2

if (( FAILURES > 0 )); then
  printf 'RESULT=FAIL\n' > "$EV_DIR/99-result.txt"
  ev_log "RESULT=FAIL（$FAILURES 项验收失败）"
  exit 1
fi
printf 'RESULT=PASS\n' > "$EV_DIR/99-result.txt"
ev_log "RESULT=PASS. 证据在 $EV_DIR"