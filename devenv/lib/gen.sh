# shellcheck shell=bash
# ============================================================================
# devenv 脚手架生成库（#64；被 devenv/devenv source，不直接执行）
#
# Spec-工程基座 §5「脚手架」落地：
#   - 生成器来源 = **本次调用当前工作树的完整 `devenv/gen/` 集合**。命令先在
#     宿主计算集合树哈希（git 子树）与内容集哈希，再把快照内的生成器集合 +
#     锚点文件经 stdin tar 传入容器；容器重算集哈希核对传输完整。镜像内没有
#     可静默 fallback 的烘焙副本（`.dockerignore` 排除 `devenv/*`；容器入口再
#     断言 `/workspace/devenv/gen` 不存在）。
#   - 文件通道：容器 stdout = 生成物 tar（含 `.ne-gen-manifest.json`），宿主先
#     解包到仓库内暂存目录（同一文件系统，rename 原子），校验清单/哈希/路径后
#     才事务式落盘；任何失败回滚，不产生部分写入。
#   - 新包联动：workspace.Dockerfile 两靶 manifest COPY 补丁 + 机器级 lockgen
#     锁重生成 lockfile；只接受「新增 importer 块」的预期 diff，其余差异停止
#     并要求审查。
#   - 锁关系（#61 一致）：gen 持 per-worktree `gen-<wt>` 源码锁；build 同时持
#     `gen-<wt>`（两者互斥）；触发 lockgen 取机器级 `lockgen` 锁。
# ============================================================================

GEN_MANIFEST_NAME=".ne-gen-manifest.json"
GEN_SOURCE_TREE=""
GEN_SET_SHA256=""
GEN_SOURCE_FILES=""
GEN_TXN_ACTIVE=0
GEN_TXN_DIR=""
GEN_TXN_TARGET=""

gen_target_dir() { # <kind> → packages | apps
  case "$1" in
    package) printf 'packages' ;;
    app)     printf 'apps' ;;
    *)       die 2 "内部错误：未知 kind ${1}" ;;
  esac
}

# 生成器集合内容集哈希：容器与宿主使用同一算法（排序后的 "sha256␠␠path" 清单再 sha256）。
# 宿主直接从 git 快照树的对象库取 blob（不经文件系统物化——macOS 的 AppleDouble/
# xattr 元数据文件会污染目录枚举，导致两侧集合不一致）；容器从 stdin tar 解包后的
# 文件系统计算。路径相对仓库根（devenv/gen/...），两侧一致。
gen_set_hash_from_tree() { # <tree>
  local tree="$1"
  ( git -C "$REPO_ROOT" ls-tree -r --name-only "$tree" -- devenv/gen | LC_ALL=C sort |
      while IFS= read -r f; do
        printf '%s  %s\n' \
          "$(git -C "$REPO_ROOT" cat-file blob "${tree}:${f}" | sha256sum | awk '{print $1}')" "$f"
      done | sha256sum | awk '{print $1}' )
}

# 当前工作树生成器集合的树哈希/文件数（来源新鲜度可核）。<tree> = git 快照树。
gen_source_verify() { # <tree>
  local tree="$1" links
  git -C "$REPO_ROOT" cat-file -e "${tree}:devenv/gen/gen.mjs" 2>/dev/null \
    || die 4 "当前工作树缺少 devenv/gen/gen.mjs（生成器集合不完整）。来源：${REPO_ROOT}/devenv/gen"
  GEN_SOURCE_TREE="$(git -C "$REPO_ROOT" rev-parse "${tree}:devenv/gen")" \
    || die 4 "无法计算生成器集合树哈希（${tree}:devenv/gen）"
  links="$(git -C "$REPO_ROOT" ls-tree -r "$GEN_SOURCE_TREE" | awk '$1=="120000"{print $4}')"
  [[ -z "$links" ]] || die 4 "生成器集合包含符号链接（拒绝；请改为普通文件）：${links}"
  GEN_SOURCE_FILES="$(git -C "$REPO_ROOT" ls-tree -r --name-only "$GEN_SOURCE_TREE" | wc -l | tr -d ' ')"
  [[ "$GEN_SOURCE_FILES" =~ ^[0-9]+$ ]] && (( GEN_SOURCE_FILES > 0 )) \
    || die 4 "生成器集合为空（${REPO_ROOT}/devenv/gen）"
}

# 宿主预检（幂等保护）：目标不存在、同包名未占用、补丁未注入。全部在生成/写入前执行。
gen_host_preflight() { # <kind> <name>
  local kind="$1" name="$2" dir other_dir copyline pkg_name
  dir="$(gen_target_dir "$kind")"
  [[ ! -e "$REPO_ROOT/$dir/$name" ]] \
    || die 4 "目标已存在：${dir}/${name}/（幂等保护，未写入任何文件）。先删除该目录再重试"
  other_dir="apps"
  [[ "$dir" == "apps" ]] && other_dir="packages"
  if [[ -f "$REPO_ROOT/$other_dir/$name/package.json" ]]; then
    pkg_name="$(jq -r '.name // ""' "$REPO_ROOT/$other_dir/$name/package.json" 2>/dev/null || true)"
    [[ "$pkg_name" != "@ne/$name" ]] \
      || die 4 "包名冲突：${other_dir}/${name}/package.json 已占用 @ne/${name}（幂等保护，未写入任何文件）"
  fi
  copyline="COPY ${dir}/${name}/package.json ${dir}/${name}/package.json"
  if grep -qxF -- "$copyline" "$REPO_ROOT/devenv/workspace.Dockerfile" 2>/dev/null; then
    die 4 "workspace.Dockerfile 已注入过 ${name} 的 manifest COPY 行（幂等保护，未写入任何文件）"
  fi
}

# 容器入口：解包 stdin tar → 校验集哈希/无烘焙副本 → 运行当前工作树生成器 → stdout tar。
# 生成器路径是 /tmp 下的绝对路径（输入 tar 解包而来），镜像内没有可 fallback 的副本。
gen_container_script() {
  cat <<'SH'
set -eu
mkdir -p /tmp/ne-gen/input /tmp/ne-gen/output
tar -xf - -C /tmp/ne-gen/input
cd /tmp/ne-gen/input
if [ -e /workspace/devenv/gen ]; then
  echo "[gen] ERROR: 镜像内存在烘焙生成器副本 /workspace/devenv/gen（禁止静默 fallback）" >&2
  exit 4
fi
actual="$(find devenv/gen -type f -print | LC_ALL=C sort | while IFS= read -r f; do
  printf '%s  %s\n' "$(sha256sum "$f" | awk '{print $1}')" "$f"
done | sha256sum | awk '{print $1}')"
if [ "$actual" != "$NE_GEN_SET_SHA256" ]; then
  echo "[gen] ERROR: 生成器集合哈希不符（传输不完整）：expected=$NE_GEN_SET_SHA256 actual=$actual" >&2
  exit 4
fi
NE_GEN_SOURCE=/tmp/ne-gen/input NE_GEN_OUTPUT=/tmp/ne-gen/output \
  node /tmp/ne-gen/input/devenv/gen/gen.mjs "$NE_GEN_KIND" "$NE_GEN_NAME"
tar -cf - -C /tmp/ne-gen/output .
SH
}

# 在无网络、只读根、仅 /tmp tmpfs 的一次性容器里运行当前工作树生成器。
# stdin = 输入 tar（git 快照树中的 devenv/gen + 锚点，无文件系统元数据）；
# stdout = 生成物 tar（与结果流完全隔离）。
gen_run_container() { # <workdir> <kind> <name> <tree>
  local work="$1" kind="$2" name="$3" tree="$4" rc=0
  local -a anchors=()
  case "$kind" in
    package|app) anchors=("devenv/gen" "devenv/workspace.Dockerfile") ;;
    *) die 2 "内部错误：未知 kind ${kind}" ;;
  esac
  # 从快照树直接归档：只含 git 记录的文件，不受宿主文件系统 xattr/AppleDouble 影响
  git -C "$REPO_ROOT" archive --format=tar "$tree" -- ${anchors[@]+"${anchors[@]}"} > "$work/input.tar" \
    || die 4 "生成器输入 tar 打包失败（快照 ${tree}）"
  ev step.started target="gen container"
  docker run --rm -i --network none --read-only --tmpfs /tmp:rw,size=128m \
    -e "NE_GEN_SET_SHA256=$GEN_SET_SHA256" \
    -e "NE_GEN_KIND=$kind" -e "NE_GEN_NAME=$name" \
    --entrypoint sh "$TOOLS_IMAGE_EFFECTIVE" -c "$(gen_container_script)" \
    < "$work/input.tar" > "$work/output.tar" || rc=$?
  if (( rc != 0 )); then
    final failed 4 step="gen container" taskRc="$rc" hint="生成器在容器内失败；未写入任何文件"
    die 4 "生成器执行失败（容器退出码 ${rc}，完整输出见上方 stderr；未写入任何文件）"
  fi
  [[ -s "$work/output.tar" ]] || die 4 "生成器未输出 tar 流（未写入任何文件）"
  ev step.completed target="gen container"
}

# 校验生成物 tar 的清单/哈希/路径，解包到仓库内暂存目录（同一文件系统，rename 原子）。
gen_stage_output() { # <workdir> <stage> <kind> <name> <tree>
  local work="$1" stage="$2" kind="$3" name="$4" tree="$5"
  local manifest="$stage/$GEN_MANIFEST_NAME"
  local bad p s actual members unsafe links
  mkdir -p "$stage"
  # 先只列 tar 成员并做安全校验，确认没有 ../、绝对路径、反斜杠或链接后才解包
  # ——恶意/损坏的生成物不得在清单校验前写出暂存目录。
  members="$(tar -tf "$work/output.tar")" \
    || die 4 "生成物 tar 无法列出成员（未写入任何文件）"
  unsafe="$(printf '%s\n' "$members" | awk '
    $0=="" || /^\// || /(^|\/)\.\.(\/|$)/ || /\\/ { print }')"
  [[ -z "$unsafe" ]] \
    || die 4 "生成物 tar 含非法路径（未解包；未写入任何文件）：${unsafe}"
  links="$(tar -tvf "$work/output.tar" \
    | awk 'substr($1,1,1)=="l" || substr($1,1,1)=="h" { print }')"
  [[ -z "$links" ]] \
    || die 4 "生成物 tar 含符号/硬链接（未解包；未写入任何文件）：${links}"
  tar -xf "$work/output.tar" -C "$stage" || die 4 "生成物 tar 解包失败（未写入任何文件）"
  [[ -f "$manifest" ]] || die 4 "生成物缺 ${GEN_MANIFEST_NAME}（未写入任何文件）"
  # 先做路径安全校验（拒绝绝对路径、..、反斜杠、空路径）
  bad="$(jq -r '.files[]?.path, .patches[]?.path' "$manifest" 2>/dev/null | awk '
    $0=="" || /^\// || /(^|\/)\.\.(\/|$)/ || /\\/ { print }' || true)"
  [[ -z "$bad" ]] || die 4 "生成物清单含非法路径（未写入任何文件）：${bad}"
  # 清单结构：kind/name 匹配；files 非空；patches 恰好一个 workspace.Dockerfile
  if ! jq -e --arg k "$kind" --arg n "$name" \
      '(.kind == $k) and (.name == $n) and (.files | type == "array" and length > 0)
       and (.patches | type == "array" and length == 1)
       and (.patches[0].path == "devenv/workspace.Dockerfile")' "$manifest" >/dev/null 2>&1; then
    die 4 "生成物清单结构不符（未写入任何文件）：$(jq -c . "$manifest" 2>/dev/null | head -c 400)"
  fi
  # 每个新文件必须位于 kind 对应的目标目录，且哈希匹配（传输/生成完整性）
  local dir
  dir="$(gen_target_dir "$kind")"
  while IFS=$'\t' read -r p s; do
    [[ "$p" == "${dir}/${name}/"* ]] \
      || die 4 "生成物路径越界：${p}（${kind} 只允许 ${dir}/${name}/ 下；未写入任何文件）"
    [[ -f "$stage/$p" && ! -L "$stage/$p" ]] \
      || die 4 "生成物缺失或为符号链接：${p}（未写入任何文件）"
    actual="$(sha256sum "$stage/$p" | awk '{print $1}')"
    [[ "$actual" == "$s" ]] || die 4 "生成物哈希不符：${p}（未写入任何文件）"
  done < <(jq -r '.files[] | [.path, .sha256] | @tsv' "$manifest")
  # 补丁：哈希匹配且基准 sha256 == 本次输入快照的锚点（证明补丁以宿主当前内容为基准）
  while IFS=$'\t' read -r p base s; do
    [[ -f "$stage/$p" && ! -L "$stage/$p" ]] \
      || die 4 "补丁生成物缺失或为符号链接：${p}（未写入任何文件）"
    actual="$(sha256sum "$stage/$p" | awk '{print $1}')"
    [[ "$actual" == "$s" ]] || die 4 "补丁生成物哈希不符：${p}（未写入任何文件）"
    git -C "$REPO_ROOT" cat-file -e "${tree}:${p}" 2>/dev/null \
      || die 4 "锚点缺失：${p}（未写入任何文件）"
    actual="$(git -C "$REPO_ROOT" cat-file blob "${tree}:${p}" | sha256sum | awk '{print $1}')"
    [[ "$actual" == "$base" ]] \
      || die 4 "补丁基准与输入快照不一致：${p}（工作树在生成期间被修改；未写入任何文件）"
  done < <(jq -r '.patches[] | [.path, .baseSha256, .sha256] | @tsv' "$manifest")
  # 生成物集合必须与清单完全一致（多出/缺失均拒绝）
  local actual_list expected_list
  actual_list="$( cd "$stage" && find . -type f ! -name "$GEN_MANIFEST_NAME" | sed 's|^\./||' | LC_ALL=C sort )"
  expected_list="$(jq -r '.files[].path, .patches[].path' "$manifest" | LC_ALL=C sort)"
  [[ "$actual_list" == "$expected_list" ]] \
    || die 4 "生成物集合与清单不一致（多出/缺失；未写入任何文件）"
  # 禁止符号链接（解包后整体检查）
  [[ -z "$(find "$stage" -type l -print)" ]] || die 4 "生成物包含符号链接（拒绝；未写入任何文件）"
  # 补丁必须只是「两靶各追加一行 COPY」——不接受生成器顺带改别的行
  local copyline="COPY ${dir}/${name}/package.json ${dir}/${name}/package.json"
  local old_file="$work/snapshot-workspace.Dockerfile" new_file="$stage/devenv/workspace.Dockerfile"
  local oldc newc
  git -C "$REPO_ROOT" cat-file blob "${tree}:devenv/workspace.Dockerfile" > "$old_file" 2>/dev/null \
    || die 4 "锚点缺失：devenv/workspace.Dockerfile（未写入任何文件）"
  oldc="$(grep -cF -- "$copyline" "$old_file" || true)"
  newc="$(grep -cF -- "$copyline" "$new_file" || true)"
  [[ "$newc" -eq $((oldc + 2)) ]] \
    || die 4 "workspace.Dockerfile 补丁未恰好追加两行（lockgen-base/deps 各一；未写入任何文件）"
  grep -vF -- "$copyline" "$new_file" | cmp -s - "$old_file" \
    || die 4 "workspace.Dockerfile 补丁含非预期修改（只允许追加 manifest COPY 行；未写入任何文件）"
}

# 事务式落盘：暂存目录位于仓库内（同一文件系统），rename 原子；失败回滚。
gen_apply_transaction() { # <stage> <txn> <kind> <name> <tree>
  local stage="$1" txn="$2" kind="$3" name="$4" tree="$5" dir
  dir="$(gen_target_dir "$kind")"
  local backup="$txn/backup/workspace.Dockerfile"
  mkdir -p "$txn/backup" "$REPO_ROOT/$dir"
  # 再次对活工作树做权威预检（生成期间可能被并发修改；快照一致性只覆盖输入）
  [[ ! -e "$REPO_ROOT/$dir/$name" ]] \
    || die 4 "目标在生成期间出现：${dir}/${name}/（未写入任何文件）"
  local copyline="COPY ${dir}/${name}/package.json ${dir}/${name}/package.json"
  ! grep -qxF -- "$copyline" "$REPO_ROOT/devenv/workspace.Dockerfile" \
    || die 4 "workspace.Dockerfile 在生成期间已被注入 ${name}（未写入任何文件）"
  # 活锚点必须仍等于本次输入快照（否则放弃，不覆盖并发修改）
  git -C "$REPO_ROOT" cat-file blob "${tree}:devenv/workspace.Dockerfile" \
    | cmp -s - "$REPO_ROOT/devenv/workspace.Dockerfile" \
    || die 4 "workspace.Dockerfile 在生成期间被修改（未写入任何文件）"

  cp -p "$REPO_ROOT/devenv/workspace.Dockerfile" "$backup" || die 4 "补丁基准备份失败（未写入任何文件）"
  GEN_TXN_ACTIVE=1
  GEN_TXN_DIR="$txn"
  GEN_TXN_TARGET="${dir}/${name}"
  if ! mv "$stage/$dir/$name" "$REPO_ROOT/$dir/$name"; then
    GEN_TXN_ACTIVE=0
    die 4 "新生成目录落盘失败：${dir}/${name}（未写入任何文件）"
  fi
  if ! mv "$stage/devenv/workspace.Dockerfile" "$REPO_ROOT/devenv/workspace.Dockerfile"; then
    rm -rf "$REPO_ROOT/$dir/$name"
    GEN_TXN_ACTIVE=0
    die 4 "workspace.Dockerfile 补丁落盘失败（已回滚 ${dir}/${name}，未产生部分写入）"
  fi
}

gen_txn_rollback() {
  (( GEN_TXN_ACTIVE )) || return 0
  GEN_TXN_ACTIVE=0
  warn "gen 失败：回滚本次生成（${GEN_TXN_TARGET:-目标目录} + workspace.Dockerfile + pnpm-lock.yaml）"
  if [[ -n "$GEN_TXN_DIR" && -f "$GEN_TXN_DIR/backup/workspace.Dockerfile" ]]; then
    cp -p "$GEN_TXN_DIR/backup/workspace.Dockerfile" "$REPO_ROOT/devenv/workspace.Dockerfile" 2>/dev/null || true
  fi
  if [[ -n "$GEN_TXN_DIR" && -f "$GEN_TXN_DIR/pnpm-lock.old.yaml" ]]; then
    cp -p "$GEN_TXN_DIR/pnpm-lock.old.yaml" "$REPO_ROOT/pnpm-lock.yaml" 2>/dev/null || true
  fi
  local target="${GEN_TXN_TARGET:-}"
  [[ -n "$target" ]] && rm -rf "$REPO_ROOT/$target" 2>/dev/null || true
  return 0
}

gen_txn_commit() {
  GEN_TXN_ACTIVE=0
  return 0
}

# pnpm-lock.yaml 规范化：去掉空行；丢弃指定 importer 的整个块（用于「只新增该
# importer、其余不变」的严格比较）。兼容 pnpm 12 的多文档 lockfile。
gen_lockfile_normalize() { # <lockfile> <importer-to-drop>
  awk -v drop="$2" '
    function unq(s, c) {
      c = substr(s, 1, 1)
      if ((c == "\"" || c == "\047") && substr(s, length(s), 1) == c) return substr(s, 2, length(s) - 2)
      return s
    }
    /^[[:space:]]*$/ { next }
    /^importers:[[:space:]]*$/ { inimp = 1; skip = 0; print; next }
    inimp && /^[^[:space:]]/ { inimp = 0; skip = 0 }
    inimp && /^  [^[:space:]]/ {
      key = $0; sub(/^  /, "", key); sub(/:.*/, "", key); key = unq(key)
      skip = (drop != "" && key == drop)
      if (skip) next
      print; next
    }
    inimp && skip { next }
    { print }
  ' "$1"
}

gen_lockfile_has_importer() { # <lockfile> <importer>
  awk -v want="$2" '
    function unq(s, c) {
      c = substr(s, 1, 1)
      if ((c == "\"" || c == "\047") && substr(s, length(s), 1) == c) return substr(s, 2, length(s) - 2)
      return s
    }
    /^importers:[[:space:]]*$/ { inimp = 1; next }
    inimp && /^[^[:space:]]/ { inimp = 0 }
    inimp && /^  [^[:space:]]/ {
      key = $0; sub(/^  /, "", key); sub(/:.*/, "", key)
      if (unq(key) == want) { found = 1; exit }
    }
    END { exit(found ? 0 : 1) }
  ' "$1"
}

# 预期 diff：新 lockfile 去掉新 importer 块后与旧 lockfile 规范化结果逐字节一致。
gen_lockfile_diff_expected() { # <old> <new> <importer>
  local old="$1" new="$2" importer="$3" tmp
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/ne-gen-lockdiff.XXXXXX")" \
    || die 4 "lockfile 比对临时目录创建失败（未写入任何文件）"
  gen_lockfile_normalize "$old" "" > "$tmp/old.norm"
  gen_lockfile_normalize "$new" "$importer" > "$tmp/new.norm"
  if cmp -s "$tmp/old.norm" "$tmp/new.norm"; then
    rm -rf "$tmp"
    return 0
  fi
  warn "非预期 lockfile diff（去掉 ${importer} importer 后仍与旧锁文件不同）："
  git diff --no-index --no-color -- "$tmp/old.norm" "$tmp/new.norm" >&2 || true
  rm -rf "$tmp"
  return 1
}