#!/usr/bin/env bash
# 实验工具（#54）：deps 层缓存复用实验公共库。
# 证据默认落在 $HOME/ne-deps-evidence（仓库外，避免被 git reset 清掉）。
set -Eeuo pipefail

EXP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$EXP_DIR/../.." && pwd)"
EVIDENCE_DIR="${EVIDENCE_DIR:-$HOME/ne-deps-evidence}"
STORE_ID="${STORE_ID:-ne-pnpm-exp-20261124-v11}"
mkdir -p "$EVIDENCE_DIR"

now_ms() { date +%s%3N; }

record() { # record <name> <startMs> <endMs> <rc> [extraJsonFragment]
  local name="$1" start="$2" end="$3" rc="$4" extra="${5:-}"
  printf '{"name":"%s","startMs":%s,"endMs":%s,"durationMs":%s,"exitCode":%s%s}\n' \
    "$name" "$start" "$end" "$((end - start))" "$rc" "$extra" >>"$EVIDENCE_DIR/results.jsonl"
}

run_logged() { # run_logged <name> <logfile> <cmd...>
  local name="$1" log="$2"
  shift 2
  local t0 t1 rc
  t0="$(now_ms)"
  set +e
  "$@" >"$log" 2>&1
  rc=$?
  set -e
  t1="$(now_ms)"
  record "$name" "$t0" "$t1" "$rc"
  printf '[exp] %-34s exit=%s duration=%sms log=%s\n' "$name" "$rc" "$((t1 - t0))" "$log" >&2
  return "$rc"
}

evidence_of() { # evidence_of <log> <stage> -> 该阶段最后一条 EVIDENCE 的 JSON（无则空）
  # --target deps 构建时 lockgen 阶段也会打印 EVIDENCE：必须按 stage 选取，不能取“最后一行”。
  local log="$1" stage="$2"
  grep -o "EVIDENCE {\"stage\":\"$stage\".*}" "$log" 2>/dev/null | tail -1 | sed 's/^EVIDENCE //' || true
}

layer_cache_hit() { # layer_cache_hit <log> <stage> -> hit|miss|absent：该阶段 install 的 RUN 步骤是否命中层缓存
  awk -v pat="summarize-pnpm.mjs $2'" '
    index($0, "STEP") && index($0, pat) { found = 1; next }
    found { print ($0 ~ /Using cache/) ? "hit" : "miss"; done = 1; exit }
    END { if (!done) print (found ? "miss" : "absent") }
  ' "$1"
}

save_evidence() { # save_evidence <name> <log> [stage=deps]
  # 三种结局都显式落盘，绝不静默：有 EVIDENCE → 原样；install 步骤命中层缓存 → layer-cache-hit
  # （安装根本没执行，不是“零下载”证据）；其余 → no-evidence（拿不到证据 = 无法验收）。
  local name="$1" log="$2" stage="${3:-deps}" ev hit
  ev="$(evidence_of "$log" "$stage")"
  if [[ -n "$ev" ]]; then
    printf '%s\n' "$ev" >"$EVIDENCE_DIR/$name.evidence.json"
    return 0
  fi
  hit="$(layer_cache_hit "$log" "$stage")"
  if [[ "$hit" == "hit" ]]; then
    printf '{"stage":"%s","verdict":"layer-cache-hit","installExecuted":false}\n' "$stage" \
      >"$EVIDENCE_DIR/$name.evidence.json"
  else
    printf '{"stage":"%s","verdict":"no-evidence","layerStep":"%s"}\n' "$stage" "$hit" \
      >"$EVIDENCE_DIR/$name.evidence.json"
  fi
}

git_reset() {
  git -C "$REPO_ROOT" reset --hard HEAD >/dev/null
  git -C "$REPO_ROOT" clean -fd >/dev/null
}

network_probe() { # 记录实际网络（只报告不控制）；单流 tarball + registry 元数据
  local out="$1"
  {
    echo "epoch=$(date +%s)"
    echo "date=$(date -Is)"
    echo "--- tarball https://registry.npmjs.org/typescript/-/typescript-6.0.3.tgz ---"
    curl -sL -o /dev/null -w 'bytes=%{size_download} seconds=%{time_total} speed_Bps=%{speed_download}\n' \
      --max-time 180 https://registry.npmjs.org/typescript/-/typescript-6.0.3.tgz || echo 'tarball probe failed'
    echo "--- metadata https://registry.npmjs.org/is-odd ---"
    curl -sL -o /dev/null -w 'bytes=%{size_download} seconds=%{time_total} speed_Bps=%{speed_download}\n' \
      --max-time 120 https://registry.npmjs.org/is-odd || echo 'metadata probe failed'
  } >"$out" 2>&1
}

record_env() { # record_env <label>
  local label="$1"
  local out="$EVIDENCE_DIR/env-$label.txt"
  local net="$EVIDENCE_DIR/.network-$label.txt"
  network_probe "$net"
  {
    echo "=== label: $label ==="
    cat "$net"
    echo
    echo "=== platform ==="
    uname -a
    echo "kernel=$(uname -r) arch=$(uname -m)"
    echo "DOCKER_HOST=${DOCKER_HOST:-<unset>}"
    docker version 2>&1 | sed -n '1,40p'
    echo
    echo "=== images (related) ==="
    docker images --format '{{.Repository}}:{{.Tag}} {{.ID}} {{.Size}}' 2>&1 | grep -E 'natural-enforcement|node|alpine' || true
    echo
    echo "=== system df ==="
    docker system df 2>&1
    echo
    echo "=== git ==="
    git -C "$REPO_ROOT" rev-parse HEAD
    git -C "$REPO_ROOT" status --short
  } >"$out" 2>&1
  rm -f "$net"
  printf '[exp] environment recorded: %s\n' "$out" >&2
}

docker_build_deps() { # docker_build_deps <tag> [额外参数...]：与 devenv 同一套 cache id 传参规则（未设置则用 Dockerfile 默认值）
  local tag="$1" args=()
  shift
  [[ -n "${PNPM_STORE_CACHE_ID:-}" ]] && args+=(--build-arg "PNPM_STORE_CACHE_ID=$PNPM_STORE_CACHE_ID")
  [[ -n "${PNPM_META_CACHE_ID:-}" ]] && args+=(--build-arg "PNPM_META_CACHE_ID=$PNPM_META_CACHE_ID")
  docker build ${args[@]+"${args[@]}"} "$@" --target deps -t "$tag" -f "$REPO_ROOT/devenv/workspace.Dockerfile" "$REPO_ROOT"
}

step() { # step <name> <cmd...>：幂等；已完成则跳过（冷启动类步骤重跑就不再是冷的）。FORCE=1 强制重跑。
  local name="$1" marker
  shift
  marker="$EVIDENCE_DIR/.done-$name"
  if [[ -f "$marker" && "${FORCE:-0}" != 1 ]]; then
    echo "[exp] step $name: already done -> skipped" >&2
    return 0
  fi
  echo "[exp] ===== step $name =====" >&2
  # 显式检查退出码，不依赖 set -e：调用方写 `step … || true` 或 `if step …` 时 errexit 会被 bash 关闭
  # （实测），失败的步骤就会被误标为已完成，之后的重跑把它当“已做”跳过。
  # 步骤体必须在**子进程**里跑：bash 把“errexit 被忽略”的上下文（`step … || true`、`if step …`、`! step …`）
  # 继承进函数与子 shell，里面写 `set -e` 或临时 `set +e` 都覆盖不了（实测：这些位置里 false 之后的命令照跑、
  # 步骤被误标完成）。子进程不继承该状态，`bash -c 'set -e; …'` 在任何调用位置都失败即停。
  # 代价：函数须 `export -f`，变量须 export——这里统一导出本库的函数与常用变量。
  # 函数集合在运行时由 declare -F 推导，而不是手写清单：手写清单会漏掉后加的函数，
  # 且曾用 `2>/dev/null || true` 把遗漏吞掉（子进程里才报 command not found）。step 自身不导出。
  export EVIDENCE_DIR REPO_ROOT STORE_ID
  local __fn
  while IFS= read -r __fn; do
    [[ "$__fn" == "step" ]] && continue
    export -f "$__fn"
  done < <(declare -F | awk '{print $3}')
  # 调用方传入的步骤体若是 shell 函数，用 declare -f 序列化后在子进程重建（否则子进程找不到它：rc=127）。
  local rc=0 fn_src=""
  if declare -F "$1" >/dev/null 2>&1; then fn_src="$(declare -f "$1")"; fi
  FN_SRC="$fn_src" bash -c 'set -Eeuo pipefail; eval "$FN_SRC"; "$@"' _ "$@" || rc=$?
  if (( rc != 0 )); then
    echo "[exp] step $name FAILED (exit $rc): no done-marker written" >&2
    return "$rc"
  fi
  : >"$marker"
}

dockerfile_sha() { sha256sum "$REPO_ROOT/devenv/workspace.Dockerfile" | cut -d' ' -f1; }
lockfile_sha() { sha256sum "$REPO_ROOT/pnpm-lock.yaml" | cut -d' ' -f1; }

save_state() { # save_state <label>
  local label="$1"
  local out="$EVIDENCE_DIR/state-$label.txt"
  {
    echo "dockerfile_sha=$(dockerfile_sha)"
    echo "lockfile_sha=$(lockfile_sha)"
    echo "workspace_dockerfile_diff:"
    git -C "$REPO_ROOT" diff -- devenv/workspace.Dockerfile
    echo "lockfile_diff_stat:"
    git -C "$REPO_ROOT" diff --stat -- pnpm-lock.yaml
    echo "workspace_packages:"
    find "$REPO_ROOT/packages" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort
  } >"$out" 2>&1
}

regen_lockfile_direct() { # 实验用：复刻 devenv regen_lockfile（lockgen 靶 → docker cp 导出）
  # 只操作实验专属标签：绝不 rmi 共享的 ne-lockgen:tmp（会毁掉其他 agent 进行中的 lockgen 镜像）。
  local log="$EVIDENCE_DIR/lockgen-direct.log" t0 t1 rc
  local tag="${DEVENV_LOCKGEN_TAG:-ne-exp54-lockgen:tmp}"
  [[ "$tag" != "ne-lockgen:tmp" ]] || { echo "[exp] refusing to touch shared tag ne-lockgen:tmp" >&2; return 2; }
  t0="$(now_ms)"
  set +e
  {
    docker ps -a --filter "ancestor=$tag" -q | xargs -r docker rm -f >/dev/null 2>&1 || true
    docker rmi -f "$tag" >/dev/null 2>&1 || true
    docker build --target lockgen -t "$tag" \
      -f "$REPO_ROOT/devenv/workspace.Dockerfile" "$REPO_ROOT"
    local cid
    cid="$(docker create "$tag")"
    docker cp "$cid":/workspace/pnpm-lock.yaml "$REPO_ROOT/pnpm-lock.yaml"
    docker rm "$cid" >/dev/null
    docker rmi "$tag" >/dev/null
  } >"$log" 2>&1
  rc=$?
  set -e
  t1="$(now_ms)"
  record lockgen-direct "$t0" "$t1" "$rc"
  printf '[exp] %-34s exit=%s duration=%sms log=%s\n' lockgen-direct "$rc" "$((t1 - t0))" "$log" >&2
  return "$rc"
}
# ---- 缓存状态与确定性辅助 ----------------------------------------------------------------

# 实验用名称：不触碰共享镜像标签/compose 资源（devenv 支持环境覆盖，默认值不变）
exp_names() {
  export DEVENV_PROJECT_NAME="${DEVENV_PROJECT_NAME:-ne-exp54}"
  export DEVENV_WS_IMAGE="${DEVENV_WS_IMAGE:-ne-exp54/workspace:cand}"
  export DEVENV_LOCKGEN_TAG="${DEVENV_LOCKGEN_TAG:-ne-exp54-lockgen:tmp}"
}


cache_state() { # cache_state <label>：ids 在调用时读取（环境变量可按次覆盖）
  local label="$1" ctx out="$EVIDENCE_DIR/cache-$1.json" log
  local STORE_CACHE_ID="${PNPM_STORE_CACHE_ID:-ne-pnpm-store-v11}" META_CACHE_ID="${PNPM_META_CACHE_ID:-ne-pnpm-meta-v12}"
  ctx="$(mktemp -d)"
  log="$ctx/log"
  cat >"$ctx/Dockerfile" <<DOCKERFILE
FROM natural-enforcement/tools:prototype1
RUN --mount=type=cache,id=${STORE_CACHE_ID},target=/s,sharing=locked \\
    --mount=type=cache,id=${META_CACHE_ID},target=/m,sharing=locked \\
    sh -c 'for d in s m; do \\
      n=\$(find /\$d -type f | wc -l); kb=\$(du -sk /\$d | cut -f1); \\
      h=\$(find /\$d -type f -printf "%P %s\\n" | sort | sha256sum | cut -d" " -f1); \\
      echo "CACHE_STATE \$d files=\$n kb=\$kb listing_sha256=\$h"; done'
DOCKERFILE
  docker build --no-cache -f "$ctx/Dockerfile" "$ctx" >"$log" 2>&1 || true
  {
    printf '{"label":"%s","epoch":%s,"storeId":"%s","metaId":"%s"' "$label" "$(date +%s)" "$STORE_CACHE_ID" "$META_CACHE_ID"
    for d in s m; do
      line="$(grep "^CACHE_STATE $d " "$log" | tail -1 || true)"
      if [[ -z "$line" ]]; then printf ',"%s":null' "$d"; continue; fi
      files="$(sed -E 's/.*files=([0-9]+).*/\1/' <<<"$line")"
      kb="$(sed -E 's/.*kb=([0-9]+).*/\1/' <<<"$line")"
      sha="$(sed -E 's/.*listing_sha256=([0-9a-f]+).*/\1/' <<<"$line")"
      printf ',"%s":{"files":%s,"kb":%s,"listingSha256":"%s"}' "$d" "$files" "$kb" "$sha"
    done
    printf '}\n'
  } >"$out"
  rm -rf "$ctx"
  printf '[exp] cache state %-24s %s\n' "$label" "$(cat "$out")" >&2
}

tree_hash() { # tree_hash <image> <label> -> 写 tree-<label>.json：/workspace/node_modules 内容树哈希（不含时间戳/状态文件）
  local image="$1" label="$2" out="$EVIDENCE_DIR/tree-$2.json" raw
  raw="$(docker run --rm "$image" sh -c '
    cd /workspace/node_modules || exit 3
    files=$(find .pnpm -type f -not -path ".pnpm/lock.yaml" | wc -l)
    content=$(find .pnpm -type f -not -path ".pnpm/lock.yaml" -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -d" " -f1)
    modes=$(find .pnpm -type f -not -path ".pnpm/lock.yaml" -printf "%m %p\n" | sort | sha256sum | cut -d" " -f1)
    links=$(find .pnpm -type l -printf "%p -> %l\n" | sort | sha256sum | cut -d" " -f1)
    echo "TREE files=$files content=$content modes=$modes links=$links"' 2>&1 | grep '^TREE ' | tail -1 || true)"
  if [[ -z "$raw" ]]; then
    printf '{"label":"%s","image":"%s","error":"tree hash failed"}\n' "$label" "$image" >"$out"
  else
    printf '{"label":"%s","image":"%s","files":%s,"content":"%s","modes":"%s","links":"%s"}\n' \
      "$label" "$image" \
      "$(sed -E 's/.*files=([0-9]+).*/\1/' <<<"$raw")" \
      "$(sed -E 's/.*content=([0-9a-f]+).*/\1/' <<<"$raw")" \
      "$(sed -E 's/.*modes=([0-9a-f]+).*/\1/' <<<"$raw")" \
      "$(sed -E 's/.*links=([0-9a-f]+).*/\1/' <<<"$raw")" >"$out"
  fi
  printf '[exp] tree hash %-24s %s\n' "$label" "$(cat "$out")" >&2
}

# ---- 运行器辅助：原始证据、统计、lockfile 增量校验、离线靶生成 ---------------------------------------

extract_raw() { # extract_raw <image> <label> [file]：把镜像内 pnpm 原始 ndjson 抽出并 gzip（原始证据留档）
  # 仅对“install 真正执行过”的构建使用；层缓存命中时镜像里的文件属于更早那次执行。
  local image="$1" label="$2" file="${3:-/tmp/pnpm-install.ndjson}" cid
  cid="$(docker create "$image")"
  if docker cp "$cid:$file" "$EVIDENCE_DIR/$label.pnpm.ndjson" >/dev/null 2>&1; then
    gzip -f "$EVIDENCE_DIR/$label.pnpm.ndjson"
  else
    echo "[exp] WARN: $file not found in $image" >&2
  fi
  docker rm "$cid" >/dev/null
}

median_worst() { # median_worst <results.jsonl> <name-regex> -> {n, median, worst, all}（毫秒）
  jq -s --arg re "$2" '
    (map(select(.name | test($re)) | .durationMs) | sort) as $v
    | ($v | length) as $n
    | { n: $n,
        median: (if $n == 0 then null
                 elif $n % 2 == 1 then $v[($n / 2 | floor)]
                 else (($v[$n / 2 - 1] + $v[$n / 2]) / 2) end),
        worst: ($v | max),
        all: $v }' "$1"
}

lockfile_delta() { # lockfile_delta <expected-package> -> 打印 JSON；仅当“恰好一个只增不减的 importer 块”才返回 0
  # SPEC：生成新包应尽量保留既有解析结果；锁文件出现非预期变化时停止并要求审查。
  # 判据（刻意不写死行数：合法 importer 可有更多依赖）：
  #   · 只增不减（removed==0）  · 恰好一个 hunk（解析条目不扩散）
  #   · 新增行全部缩进（不混入 snapshots:/packages: 等顶层键）  · 首行是 `  packages/<pkg>:`
  local pkg="$1" diff hunks added removed nonind first ok=false
  diff="$(git -C "$REPO_ROOT" diff -U0 -- pnpm-lock.yaml || true)"
  hunks="$(grep -c '^@@ ' <<<"$diff" || true)"
  added="$(grep -E '^\+' <<<"$diff" | grep -vcE '^\+\+\+' || true)"
  removed="$(grep -E '^-' <<<"$diff" | grep -vcE '^---' || true)"
  nonind="$(grep -E '^\+' <<<"$diff" | grep -vE '^\+\+\+' | grep -cE '^\+[^ ]' || true)"
  first="$(grep -E '^\+' <<<"$diff" | grep -vE '^\+\+\+' | head -1 || true)"
  if [[ "$removed" == 0 && "$hunks" == 1 && "$nonind" == 0 && "$first" == "+  packages/$pkg:" ]]; then ok=true; fi
  jq -nc --arg pkg "$pkg" --arg first "$first" --argjson hunks "$hunks" --argjson added "$added" \
    --argjson removed "$removed" --argjson nonind "$nonind" --argjson ok "$ok" \
    '{expectedPackage: $pkg, hunks: $hunks, added: $added, removed: $removed, nonIndentedAdded: $nonind, firstAdded: $first, ok: $ok}'
  [[ "$ok" == true ]]
}

make_offline_dockerfile() { # make_offline_dockerfile <out>：由生产 Dockerfile 派生“RUN 级断网 + pnpm --offline”的 deps 靶
  # 实测：docker build --network=none 在本引擎不生效；RUN --network=none 才生效（EAI_AGAIN）。
  local src="$REPO_ROOT/devenv/workspace.Dockerfile" out="$1"
  sed -e 's|^RUN --mount=type=cache,id=${PNPM_STORE_CACHE_ID},|RUN --network=none --mount=type=cache,id=${PNPM_STORE_CACHE_ID},|' \
      -e 's|pnpm install --frozen-lockfile --store-dir=/pnpm/store|pnpm install --offline --frozen-lockfile --store-dir=/pnpm/store|' \
      -e "s|summarize-pnpm.mjs deps'|summarize-pnpm.mjs offline'|" "$src" >"$out"
  # 三处替换必须全部生效：静默 no-op 会让“离线证明”实际带网络运行。
  [[ "$(grep -c -e '--network=none' "$out")" == 1 ]] || { echo "[exp] offline sed: --network=none not applied exactly once" >&2; return 1; }
  [[ "$(grep -c -e ' --offline ' "$out")" == 1 ]] || { echo "[exp] offline sed: --offline not applied exactly once" >&2; return 1; }
  [[ "$(grep -c "summarize-pnpm.mjs offline'" "$out")" == 1 ]] || { echo "[exp] offline sed: stage label not applied exactly once" >&2; return 1; }
}

interval_overlap_ms() { # interval_overlap_ms <startA> <endA> <startB> <endB> -> 重叠毫秒（无重叠为 0）
  local s=$(( $1 > $3 ? $1 : $3 )) e=$(( $2 < $4 ? $2 : $4 ))
  echo $(( e > s ? e - s : 0 ))
}

assert_evidence() { # assert_evidence <evidence.json> <jq-expr> <label>
  # 退出码：0 断言成立 | 1 断言不成立 | 2 没有可用证据（缺文件/非 JSON）——拿不到证据 ≠ 通过（SPEC：判“无法验收”）。
  local file="$1" expr="$2" label="$3"
  if [[ ! -s "$file" ]]; then
    echo "[exp] ASSERT '$label': evidence file missing or empty: $file" >&2
    return 2
  fi
  if ! jq -e . "$file" >/dev/null 2>&1; then
    echo "[exp] ASSERT '$label': evidence is not valid JSON: $file" >&2
    return 2
  fi
  if jq -e "$expr" "$file" >/dev/null 2>&1; then
    return 0
  fi
  echo "[exp] ASSERT '$label' FAILED: expected  $expr" >&2
  echo "[exp]   actual evidence: $(jq -c . "$file" | cut -c1-400)" >&2
  return 1
}

claim() { # claim <name> <evidence.json> <jq-expr>：软断言——记录结论到 claims.jsonl，永不中止运行
  # pass：true 成立 | false 不成立（本身就是发现，须如实记录）| null 无可用证据（不可验证，与 false 区分）
  local name="$1" file="$2" expr="$3" rc=0 pass
  assert_evidence "$file" "$expr" "$name" || rc=$?
  case "$rc" in
    0) pass=true ;;
    1) pass=false ;;
    *) pass=null ;;
  esac
  jq -nc --arg name "$name" --arg expr "$expr" --arg evidence "$file" --argjson pass "$pass" \
    '{name: $name, expr: $expr, evidence: $evidence, pass: $pass}' >>"$EVIDENCE_DIR/claims.jsonl"
  printf '[exp] claim %-44s %s\n' "$name" "$pass" >&2
  return 0
}
