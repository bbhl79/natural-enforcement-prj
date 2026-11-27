# shellcheck shell=bash
# ============================================================================
# devenv 脚手架生成库（#64 / #65 / #67；被 devenv/devenv source，不直接执行）
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
#   - package/app：workspace.Dockerfile 两靶 manifest COPY 补丁 + 机器级 lockgen
#     锁重生成 lockfile；只接受「新增 importer 块」的预期 diff。
#   - nest-module（#67）：HTTP kind 生成 @ne/contracts 契约文件并整行锚点登记到
#     api-registry（OpenAPI 完整性检查清单）；internal kind 不生成 HTTP 契约。
#     二者均按整行锚点登记 app.module.ts；不新增 workspace 包，因此不触发 lockgen。
#   - 锁关系（#61 一致）：gen 持 per-worktree `gen-<wt>` 源码锁；build 同时持
#     `gen-<wt>`（两者互斥）；package/app 触发 lockgen 取机器级 `lockgen` 锁。
# ============================================================================

GEN_MANIFEST_NAME=".ne-gen-manifest.json"
GEN_SOURCE_TREE=""
GEN_SET_SHA256=""
GEN_SOURCE_FILES=""
GEN_TXN_ACTIVE=0
GEN_TXN_DIR=""
GEN_TXN_TARGET=""
GEN_TXN_NEW_FILES=()
GEN_TXN_PATCHES=()

gen_target_dir() { # <kind> → packages | apps（仅 package/app 有 workspace importer）
  case "$1" in
    package) printf 'packages' ;;
    app)     printf 'apps' ;;
    *)       die 2 "内部错误：未知 workspace kind ${1}" ;;
  esac
}

gen_kind_root() { # <kind> <name> → 新生成物根目录（相对仓库）
  case "$1" in
    package) printf 'packages/%s' "$2" ;;
    app)     printf 'apps/%s' "$2" ;;
    nest-module) printf 'apps/api/src/%s' "$2" ;;
    *)       die 2 "内部错误：未知 kind ${1}" ;;
  esac
}

gen_pascal() { # kebab-case → PascalCase
  local part out=""
  local IFS='-'
  for part in $1; do out+="${part^}"; done
  printf '%s' "$out"
}

gen_upper() { # kebab-case → UPPER_SNAKE
  printf '%s' "$1" | tr '[:lower:]-' '[:upper:]_'
}

# 整行锚点判定（允许行首缩进；用于 TS 锚点/已注入行，COPY 行仍用精确匹配）。
gen_has_line() { # <file> <trimmed line>
  awk -v want="$2" '
    { s = $0; sub(/^[[:space:]]+/, "", s); sub(/[[:space:]]+$/, "", s)
      if (s == want) { found = 1; exit } }
    END { exit(found ? 0 : 1) }
  ' "$1"
}

# 各 kind/variant 允许补丁的精确文件集合（整行插入；生成器不得改其它文件）。
gen_expected_patch_paths() { # <kind> <variant>
  case "$1" in
    package|app) printf '%s\n' 'devenv/workspace.Dockerfile' ;;
    nest-module)
      printf '%s\n' 'apps/api/src/app.module.ts'
      if [[ "$2" == "http" ]]; then
        printf '%s\n' 'packages/contracts/src/api-registry.ts'
      fi
      ;;
    *) die 2 "内部错误：未知 kind ${1}" ;;
  esac
  return 0
}

# 生成物必须包含的文件（防止 HTTP 生成契约缺失却谎报成功；internal 不得生成 HTTP 契约）。
gen_required_files() { # <kind> <name> <variant>
  case "$1" in
    package)
      printf '%s\n' "packages/$2/package.json" "packages/$2/src/index.ts" "packages/$2/src/hello.spec.ts"
      ;;
    app)
      printf '%s\n' "apps/$2/package.json" "apps/$2/src/main.ts" "apps/$2/src/hello.spec.ts"
      ;;
    nest-module)
      printf '%s\n' \
        "apps/api/src/$2/$2.module.ts" \
        "apps/api/src/$2/$2.service.ts"
      case "$3" in
        http)
          printf '%s\n' \
            "apps/api/src/$2/$2.controller.ts" \
            "apps/api/src/$2/$2.controller.spec.ts" \
            "packages/contracts/src/$2.ts" \
            "packages/contracts/src/$2.spec.ts"
          ;;
        internal)
          printf '%s\n' "apps/api/src/$2/$2.service.spec.ts"
          ;;
        *) die 2 "内部错误：未知 nest-module variant ${3}" ;;
      esac
      ;;
    *) die 2 "内部错误：未知 kind ${1}" ;;
  esac
}

# nest-module spec 宿主预检（业务信息缺失/非法 → exit 2，生成前停止）。
# 深层字段类型校验由容器内生成器执行；宿主先拒绝路径不安全、被 gitignore
# （不会进入快照）或明显缺 fields 的输入。
gen_spec_validate() { # <specRel>
  local spec="$1" abs
  [[ -n "$spec" ]] \
    || die 2 "缺少必要业务信息：nest-module 需要 --spec <仓库相对路径>（JSON：fields 非空）"
  abs="$REPO_ROOT/$spec"
  [[ "$spec" =~ ^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$ ]] \
    || die 2 "spec 路径须为简单的仓库相对路径（字母数字/._- 与 /，无空格与 ../）：$spec"
  [[ ! "$spec" =~ (^|/)\.(/|$) ]] \
    || die 2 "spec 路径不得包含 . 段（请写规范化的仓库相对路径）：$spec"
  [[ "$spec" != *'/../'* && "$spec" != ../* && "$spec" != *'/..' && "$spec" != '..' ]] \
    || die 2 "spec 路径不得包含 ..：$spec"
  [[ -f "$abs" ]] || die 2 "spec 不存在：$spec（--spec 须为仓库相对路径）"
  [[ ! -L "$abs" ]] || die 2 "spec 不得为符号链接（请使用仓库内普通文件）：$spec"
  if git -C "$REPO_ROOT" check-ignore -q -- "$spec" 2>/dev/null; then
    die 2 "spec 被 .gitignore 忽略，不会进入生成器输入快照：$spec（请放到未被忽略的仓库路径）"
  fi
  jq -e 'type == "object"' "$abs" >/dev/null 2>&1 \
    || die 2 "spec 不是合法 JSON 对象：$spec"
  jq -e '(.fields | type == "object") and (.fields | length > 0)' "$abs" >/dev/null 2>&1 \
    || die 2 "缺少必要业务信息：spec.fields 必须是非空对象（否则拒绝生成假完整骨架）：$spec"
  jq -e '((has("description") | not) or (.description | type == "string"))' "$abs" >/dev/null 2>&1 \
    || die 2 "spec.description 必须是字符串：$spec"
  jq -e '((has("basePath") | not) or (.basePath | type == "string"))' "$abs" >/dev/null 2>&1 \
    || die 2 "spec.basePath 必须是字符串：$spec"
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

# 宿主预检（幂等保护）：目标不存在、同名模块/契约未登记、补丁锚点存在。
# 全部在生成/写入前执行；任一不符 exit 4 且不写入任何文件。
gen_host_preflight() { # <kind> <name> <variant>
  local kind="$1" name="$2" variant="${3:-}" dir other_dir copyline pkg_name
  local appmod="$REPO_ROOT/apps/api/src/app.module.ts"
  local pascal import_line entry_line registry export_line endpoints_import spread_line
  case "$kind" in
    package|app)
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
      ;;
    nest-module)
      [[ "$variant" == "http" || "$variant" == "internal" ]] \
        || die 2 "内部错误：nest-module 缺少 variant"
      [[ ! -e "$REPO_ROOT/apps/api/src/$name" ]] \
        || die 4 "目标已存在：apps/api/src/${name}/（幂等保护，未写入任何文件）。先删除该目录再重试"
      [[ -f "$appmod" ]] \
        || die 4 "锚点文件缺失：apps/api/src/app.module.ts（无法自动注册模块；未写入任何文件）"
      pascal="$(gen_pascal "$name")"
      import_line="import { ${pascal}Module } from './${name}/${name}.module.js'"
      entry_line="    ${pascal}Module,"
      if gen_has_line "$appmod" "$import_line" || gen_has_line "$appmod" "$entry_line"; then
        die 4 "app.module.ts 已注入过 ${pascal}Module（幂等保护，未写入任何文件）"
      fi
      gen_has_line "$appmod" '// @gen:module-import' \
        || die 4 "app.module.ts 缺少整行锚点 // @gen:module-import（未写入任何文件）"
      gen_has_line "$appmod" '// @gen:module-entry' \
        || die 4 "app.module.ts 缺少整行锚点 // @gen:module-entry（未写入任何文件）"
      if [[ "$variant" == "http" ]]; then
        registry="$REPO_ROOT/packages/contracts/src/api-registry.ts"
        [[ -f "$registry" ]] \
          || die 4 "锚点文件缺失：packages/contracts/src/api-registry.ts（未写入任何文件）"
        [[ ! -e "$REPO_ROOT/packages/contracts/src/$name.ts" ]] \
          || die 4 "目标已存在：packages/contracts/src/${name}.ts（幂等保护，未写入任何文件）"
        [[ ! -e "$REPO_ROOT/packages/contracts/src/$name.spec.ts" ]] \
          || die 4 "目标已存在：packages/contracts/src/${name}.spec.ts（幂等保护，未写入任何文件）"
        export_line="export * from './${name}.js'"
        endpoints_import="import { $(gen_upper "$name")_ENDPOINTS } from './${name}.js'"
        spread_line="  ...$(gen_upper "$name")_ENDPOINTS,"
        if gen_has_line "$registry" "$export_line" \
          || gen_has_line "$registry" "$endpoints_import" \
          || gen_has_line "$registry" "$spread_line"; then
          die 4 "api-registry.ts 已注入过 ${name} 的契约（幂等保护，未写入任何文件）"
        fi
        gen_has_line "$registry" '// @gen:endpoint-import' \
          || die 4 "api-registry.ts 缺少整行锚点 // @gen:endpoint-import（未写入任何文件）"
        gen_has_line "$registry" '// @gen:endpoint-spread' \
          || die 4 "api-registry.ts 缺少整行锚点 // @gen:endpoint-spread（未写入任何文件）"
      fi
      ;;
    *) die 2 "内部错误：未知 kind ${kind}" ;;
  esac
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
# stdin = 输入 tar（git 快照树中的 devenv/gen + 锚点 + nest-module spec，无文件系统
# 元数据）；stdout = 生成物 tar（与结果流完全隔离）。
gen_run_container() { # <workdir> <kind> <name> <variant> <specRel> <tree>
  local work="$1" kind="$2" name="$3" variant="$4" spec="$5" tree="$6" rc=0
  local -a anchors=()
  case "$kind" in
    package|app) anchors=("devenv/gen" "devenv/workspace.Dockerfile") ;;
    nest-module)
      anchors=("devenv/gen" "apps/api/src/app.module.ts")
      [[ "$variant" == "http" ]] && anchors+=("packages/contracts/src/api-registry.ts")
      [[ -n "$spec" ]] && anchors+=("$spec")
      ;;
    *) die 2 "内部错误：未知 kind ${kind}" ;;
  esac
  # 从快照树直接归档：只含 git 记录的文件，不受宿主文件系统 xattr/AppleDouble 影响
  git -C "$REPO_ROOT" archive --format=tar "$tree" -- ${anchors[@]+"${anchors[@]}"} > "$work/input.tar" \
    || die 4 "生成器输入 tar 打包失败（快照 ${tree}）"
  ev step.started target="gen container"
  docker run --rm -i --network none --read-only --tmpfs /tmp:rw,size=128m \
    -e "NE_GEN_SET_SHA256=$GEN_SET_SHA256" \
    -e "NE_GEN_KIND=$kind" -e "NE_GEN_NAME=$name" \
    -e "NE_GEN_VARIANT=$variant" -e "NE_GEN_SPEC_REL=$spec" \
    --entrypoint sh "$TOOLS_IMAGE_EFFECTIVE" -c "$(gen_container_script)" \
    < "$work/input.tar" > "$work/output.tar" || rc=$?
  if (( rc != 0 )); then
    final failed 4 step="gen container" taskRc="$rc" hint="生成器在容器内失败；未写入任何文件"
    die 4 "生成器执行失败（容器退出码 ${rc}，完整输出见上方 stderr；未写入任何文件）"
  fi
  [[ -s "$work/output.tar" ]] || die 4 "生成器未输出 tar 流（未写入任何文件）"
  ev step.completed target="gen container"
}

# 生成物新文件路径范围：package/app 只允许自己的根目录；nest-module 允许模块
# 目录 + HTTP 契约两个文件（internal 不得写 packages/contracts）。
gen_file_path_allowed() { # <kind> <name> <variant> <path>
  local kind="$1" name="$2" variant="$3" p="$4"
  case "$kind" in
    package|app)
      [[ "$p" == "$(gen_target_dir "$kind")/${name}/"* ]]
      ;;
    nest-module)
      case "$p" in
        "apps/api/src/${name}/"*) return 0 ;;
        "packages/contracts/src/${name}.ts"|"packages/contracts/src/${name}.spec.ts")
          [[ "$variant" == "http" ]]
          ;;
        *) return 1 ;;
      esac
      ;;
    *) return 1 ;;
  esac
}

# 校验生成物 tar 的清单/哈希/路径，解包到仓库内暂存目录（同一文件系统，rename 原子）。
gen_stage_output() { # <workdir> <stage> <kind> <name> <variant> <specRel> <tree>
  local work="$1" stage="$2" kind="$3" name="$4" variant="$5" spec="$6" tree="$7"
  local manifest="$stage/$GEN_MANIFEST_NAME"
  local bad p s actual members unsafe links line oldc newc
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
  # 清单结构：kind/name/variant 匹配；files/patches 非空；nest-module 必带 spec 哈希
  if ! jq -e --arg k "$kind" --arg n "$name" --arg v "$variant" '
      .manifestVersion == 2 and .kind == $k and .name == $n
      and ((.variant // "") == $v)
      and (.files | type == "array" and length > 0)
      and (.patches | type == "array" and length > 0)
      and (if $k == "nest-module" then
             (.spec | type == "object")
             and (.spec.path | type == "string")
             and (.spec.sha256 | type == "string" and test("^[0-9a-f]{64}$"))
           else .spec == null end)' "$manifest" >/dev/null 2>&1; then
    die 4 "生成物清单结构不符（未写入任何文件）：$(jq -c . "$manifest" 2>/dev/null | head -c 400)"
  fi
  # 补丁目标必须是该 kind/variant 的精确集合（整行插入；不得顺带改别的文件）
  local expected_patches actual_patches
  expected_patches="$(gen_expected_patch_paths "$kind" "$variant" | LC_ALL=C sort)"
  actual_patches="$(jq -r '.patches[].path' "$manifest" | LC_ALL=C sort)"
  [[ "$actual_patches" == "$expected_patches" ]] \
    || die 4 "生成物补丁集合不符：期望 [$(printf '%s' "$expected_patches" | tr '\n' ' ')]，实际 [$(printf '%s' "$actual_patches" | tr '\n' ' ')]（未写入任何文件）"
  [[ -z "$(jq -r '.patches[].path' "$manifest" | sort | uniq -d)" ]] \
    || die 4 "生成物补丁路径重复（未写入任何文件）"
  # 每个新文件必须在允许范围、哈希匹配，且必需文件齐全
  while IFS=$'\t' read -r p s; do
    gen_file_path_allowed "$kind" "$name" "$variant" "$p" \
      || die 4 "生成物路径越界：${p}（${kind}/${variant:-n/a} 不允许该路径；未写入任何文件）"
    [[ -f "$stage/$p" && ! -L "$stage/$p" ]] \
      || die 4 "生成物缺失或为符号链接：${p}（未写入任何文件）"
    actual="$(sha256sum "$stage/$p" | awk '{print $1}')"
    [[ "$actual" == "$s" ]] || die 4 "生成物哈希不符：${p}（未写入任何文件）"
  done < <(jq -r '.files[] | [.path, .sha256] | @tsv' "$manifest")
  while IFS= read -r p; do
    jq -e --arg p "$p" '.files | any(.path == $p)' "$manifest" >/dev/null 2>&1 \
      || die 4 "生成物缺少必需文件：${p}（${kind}/${variant:-n/a}；未写入任何文件）"
  done < <(gen_required_files "$kind" "$name" "$variant")
  if [[ "$kind" == "nest-module" && "$variant" == "internal" ]]; then
    jq -e '[.files[].path | select(startswith("packages/contracts/"))] | length == 0' \
        "$manifest" >/dev/null 2>&1 \
      || die 4 "internal kind 不得生成 HTTP 契约文件（packages/contracts/*；未写入任何文件）"
  fi
  # nest-module：spec 路径与内容哈希必须绑定本次输入快照（缺业务信息不得蒙混）
  if [[ "$kind" == "nest-module" ]]; then
    local mpath msha actual_sha
    mpath="$(jq -r '.spec.path' "$manifest")"
    msha="$(jq -r '.spec.sha256' "$manifest")"
    [[ "$mpath" == "$spec" ]] \
      || die 4 "生成物 spec 路径与 --spec 不一致：${mpath} != ${spec}（未写入任何文件）"
    git -C "$REPO_ROOT" cat-file -e "${tree}:${spec}" 2>/dev/null \
      || die 4 "spec 不在本次输入快照：${spec}（未写入任何文件）"
    actual_sha="$(git -C "$REPO_ROOT" cat-file blob "${tree}:${spec}" | sha256sum | awk '{print $1}')"
    [[ "$actual_sha" == "$msha" ]] \
      || die 4 "spec 内容哈希与输入快照不一致（生成期间被修改；未写入任何文件）"
  fi
  # 补丁：哈希匹配、基准 == 本次输入快照锚点，且只允许「整行追加」
  local patch_count i old_file new_file added_file removed_file
  patch_count="$(jq '.patches | length' "$manifest")"
  for ((i = 0; i < patch_count; i++)); do
    p="$(jq -r ".patches[$i].path" "$manifest")"
    s="$(jq -r ".patches[$i].sha256" "$manifest")"
    [[ -f "$stage/$p" && ! -L "$stage/$p" ]] \
      || die 4 "补丁生成物缺失或为符号链接：${p}（未写入任何文件）"
    actual="$(sha256sum "$stage/$p" | awk '{print $1}')"
    [[ "$actual" == "$s" ]] || die 4 "补丁生成物哈希不符：${p}（未写入任何文件）"
    git -C "$REPO_ROOT" cat-file -e "${tree}:${p}" 2>/dev/null \
      || die 4 "锚点缺失：${p}（未写入任何文件）"
    actual="$(git -C "$REPO_ROOT" cat-file blob "${tree}:${p}" | sha256sum | awk '{print $1}')"
    [[ "$actual" == "$(jq -r ".patches[$i].baseSha256" "$manifest")" ]] \
      || die 4 "补丁基准与输入快照不一致：${p}（工作树在生成期间被修改；未写入任何文件）"
    jq -e ".patches[$i].addedLines | type == \"array\" and length > 0" "$manifest" >/dev/null 2>&1 \
      || die 4 "补丁未声明整行新增内容：${p}（未写入任何文件）"
    old_file="$work/snapshot-patch-$i"
    new_file="$stage/$p"
    added_file="$work/added-lines-$i.txt"
    removed_file="$work/removed-lines-$i.txt"
    git -C "$REPO_ROOT" cat-file blob "${tree}:${p}" > "$old_file" 2>/dev/null \
      || die 4 "锚点缺失：${p}（未写入任何文件）"
    jq -r ".patches[$i].addedLines[]" "$manifest" > "$added_file"
    if grep -qx -- '' "$added_file"; then
      die 4 "补丁声明了空新增行：${p}（未写入任何文件）"
    fi
    # 同一整行可能出现多次（如 Dockerfile 两靶各追加一行）：按去重后的次数核对。
    awk '{ c[$0]++ } END { for (l in c) print c[l] "\t" l }' "$added_file" \
      > "$work/added-counts-$i.tsv"
    while IFS=$'\t' read -r cnt line; do
      oldc="$(grep -Fxc -- "$line" "$old_file" || true)"
      newc="$(grep -Fxc -- "$line" "$new_file" || true)"
      [[ "$newc" -eq $((oldc + cnt)) ]] \
        || die 4 "补丁未按整行锚点追加：${p} 的新增行应增加 ${cnt} 次，实际 ${oldc}→${newc}：${line}（未写入任何文件）"
    done < "$work/added-counts-$i.tsv"
    awk 'NR==FNR { q[$0]++; next } { if (q[$0] > 0) { q[$0]--; next } print }' \
      "$added_file" "$new_file" > "$removed_file"
    # awk 的 print 会给末行补换行；与旧文件比较前两侧都补一个换行，
    # 使「文件末行有无换行」不再影响「只允许整行追加」的判定。
    { cat "$old_file"; printf '\n'; } > "$work/old-normalized-$i"
    { cat "$removed_file"; printf '\n'; } > "$work/removed-normalized-$i"
    cmp -s "$work/removed-normalized-$i" "$work/old-normalized-$i" \
      || die 4 "补丁含非预期修改（只允许整行追加）：${p}（未写入任何文件）"
  done
  # 生成物集合必须与清单完全一致（多出/缺失均拒绝）
  local actual_list expected_list
  actual_list="$( cd "$stage" && find . -type f ! -name "$GEN_MANIFEST_NAME" | sed 's|^\./||' | LC_ALL=C sort )"
  expected_list="$(jq -r '.files[].path, .patches[].path' "$manifest" | LC_ALL=C sort)"
  [[ "$actual_list" == "$expected_list" ]] \
    || die 4 "生成物集合与清单不一致（多出/缺失；未写入任何文件）"
  # 禁止符号链接（解包后整体检查）
  [[ -z "$(find "$stage" -type l -print)" ]] || die 4 "生成物包含符号链接（拒绝；未写入任何文件）"
}

# 事务式落盘：暂存目录位于仓库内（同一文件系统），rename 原子；失败回滚。
# 新文件逐个落盘并记录；补丁文件先备份再覆盖。任何失败由 EXIT trap 回滚：
# 删除本次新文件（含新建空目录）并恢复补丁备份与 lockfile。
gen_apply_transaction() { # <stage> <txn> <kind> <name> <variant> <tree>
  local stage="$1" txn="$2" kind="$3" name="$4" variant="$5" tree="$6"
  local manifest="$stage/$GEN_MANIFEST_NAME" p dest
  mkdir -p "$txn/backup"
  # 再次对活工作树做权威预检（生成期间可能被并发修改；快照一致性只覆盖输入）
  while IFS= read -r p; do
    [[ ! -e "$REPO_ROOT/$p" && ! -L "$REPO_ROOT/$p" ]] \
      || die 4 "目标在生成期间出现：${p}（未写入任何文件）"
  done < <(jq -r '.files[].path' "$manifest")
  while IFS= read -r p; do
    git -C "$REPO_ROOT" cat-file blob "${tree}:${p}" | cmp -s - "$REPO_ROOT/$p" \
      || die 4 "锚点在生成期间被修改：${p}（未写入任何文件）"
  done < <(jq -r '.patches[].path' "$manifest")

  # 备份将被补丁覆盖的既有文件（rollback 恢复）
  while IFS= read -r p; do
    mkdir -p "$txn/backup/$(dirname "$p")"
    cp -p "$REPO_ROOT/$p" "$txn/backup/$p" \
      || die 4 "补丁基准备份失败：${p}（未写入任何文件）"
  done < <(jq -r '.patches[].path' "$manifest")

  GEN_TXN_ACTIVE=1
  GEN_TXN_DIR="$txn"
  GEN_TXN_TARGET="$(gen_kind_root "$kind" "$name")"
  GEN_TXN_NEW_FILES=()
  GEN_TXN_PATCHES=()

  while IFS= read -r p; do
    dest="$REPO_ROOT/$p"
    mkdir -p "$(dirname "$dest")" \
      || die 4 "目标目录创建失败：$(dirname "$p")（已回滚，未产生部分写入）"
    mv "$stage/$p" "$dest" \
      || die 4 "新生成文件落盘失败：${p}（已回滚，未产生部分写入）"
    GEN_TXN_NEW_FILES+=("$p")
  done < <(jq -r '.files[].path' "$manifest")

  while IFS= read -r p; do
    mv "$stage/$p" "$REPO_ROOT/$p" \
      || die 4 "补丁落盘失败：${p}（已回滚，未产生部分写入）"
    GEN_TXN_PATCHES+=("$p")
  done < <(jq -r '.patches[].path' "$manifest")
}

gen_txn_rollback() {
  (( GEN_TXN_ACTIVE )) || return 0
  GEN_TXN_ACTIVE=0
  warn "gen 失败：回滚本次生成（${GEN_TXN_TARGET:-目标} + 补丁文件 + pnpm-lock.yaml）"
  local p d
  # 恢复被补丁覆盖的既有文件
  if [[ -n "$GEN_TXN_DIR" && -d "$GEN_TXN_DIR/backup" ]]; then
    while IFS= read -r p; do
      [[ -f "$GEN_TXN_DIR/backup/$p" ]] \
        && cp -p "$GEN_TXN_DIR/backup/$p" "$REPO_ROOT/$p" 2>/dev/null || true
    done < <( cd "$GEN_TXN_DIR/backup" && find . -type f | sed 's|^\./||' )
  fi
  # 只删除清单记录的新文件；随后清掉因生成而新建的空目录（非空即停）
  for p in ${GEN_TXN_NEW_FILES[@]+"${GEN_TXN_NEW_FILES[@]}"}; do
    rm -f "$REPO_ROOT/$p" 2>/dev/null || true
    d="$(dirname "$p")"
    while [[ "$d" != "." && "$d" != "/" ]]; do
      rmdir "$REPO_ROOT/$d" 2>/dev/null || break
      d="$(dirname "$d")"
    done
  done
  if [[ -n "$GEN_TXN_DIR" && -f "$GEN_TXN_DIR/pnpm-lock.old.yaml" ]]; then
    cp -p "$GEN_TXN_DIR/pnpm-lock.old.yaml" "$REPO_ROOT/pnpm-lock.yaml" 2>/dev/null || true
  fi
  GEN_TXN_NEW_FILES=()
  GEN_TXN_PATCHES=()
  return 0
}

gen_txn_commit() {
  GEN_TXN_ACTIVE=0
  GEN_TXN_NEW_FILES=()
  GEN_TXN_PATCHES=()
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