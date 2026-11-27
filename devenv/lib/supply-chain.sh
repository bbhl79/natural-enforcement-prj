# shellcheck shell=bash
# ============================================================================
# 供应链门禁库（#63；被 devenv/devenv source，不直接执行）
#
# 权威规则（Spec-工程基座 §2 版本与镜像锁、§8 供应链；docs/agents/supply-chain.md）：
#   - catalog 一律精确 pin；catalog 依赖的权威声明位置是 pnpm-workspace.yaml，
#     manifest 只能经 `catalog:` 引用（不得在包内写死同名版本）。
#   - 普通构建 frozen install；锁文件与 catalog/manifest 不一致即停止并要求审查
#     （不得以直接依赖已精确固定为由自动接受传递依赖记录变化）。
#   - allowBuilds 只认带版本号的审批键（升级即显式审查点）。
#   - minimumReleaseAge 以分钟为单位；本仓库显式 1440（1 天冷却）且 strict，
#     例外只走版本化 minimumReleaseAgeExclude（docs/agents/supply-chain.md）。
#   - 包内 agent skills 默认不采纳：待审批项由 build 容器内的
#     devenv/supply-chain/check-permissions.sh 拦截。
# ============================================================================

SC_ERRORS=()
SC_WARNINGS=()

sc_reset() { SC_ERRORS=(); SC_WARNINGS=(); }
sc_fail() { SC_ERRORS+=("$1"); }
sc_warn() { SC_WARNINGS+=("$1"); }
sc_has_errors() { (( ${#SC_ERRORS[@]} > 0 )); }

# 精确版本：以数字开头，只含版本字符（无 ^ ~ > < = * | 空格、无 latest/next 标签）。
sc_is_exact_version() {
  [[ "${1:-}" =~ ^[0-9][0-9A-Za-z.+-]*$ ]] && [[ "${1:-}" != *'*'* ]]
}

# allowBuilds 版本化键：prisma@7.10.1 / @prisma/engines@7.10.1（裸包名不匹配）。
sc_is_versioned_key() {
  [[ "${1:-}" =~ ^(@[^/@]+/[^/@]+|[^/@][^/@]*)@[^@/]+$ ]]
}

sc_trim() { local s="${1:-}"; s="${s#"${s%%[![:space:]]*}"}"; s="${s%"${s##*[![:space:]]}"}"; printf '%s' "$s"; }
sc_unquote() {
  local s="${1:-}" c
  c="${s:0:1}"
  if [[ "$c" == '"' || "$c" == "'" ]] && [[ "${s: -1}" == "$c" ]]; then s="${s:1:${#s}-2}"; fi
  printf '%s' "$s"
}

# pnpm-workspace.yaml 指定 section 的 key<TAB>value（只解析简单映射/标量行）。
sc_yaml_section_pairs() { # <file> <section>
  awk -v want="$2" '
    function trim(s){ gsub(/^[ \t]+/,"",s); gsub(/[ \t]+$/,"",s); return s }
    function unquote(s, c){ c=substr(s,1,1); if ((c=="\"" || c=="\x27") && substr(s,length(s),1)==c) return substr(s,2,length(s)-2); return s }
    /^[^ \t#][^:]*:/ { key=$0; sub(/:.*/,"",key); gsub(/[ \t]/,"",key); cur=key; next }
    cur==want && /^[ \t]+[^#]/ {
      line=$0
      sub(/[ \t]+#.*/,"",line)
      if (line !~ /:/) next
      key=line; sub(/:.*/,"",key)
      val=line; sub(/^[^:]*:/,"",val)
      key=unquote(trim(key)); val=unquote(trim(val))
      if (key != "" && val != "") print key "\t" val
    }
  ' "$1"
}

sc_yaml_scalar() { # <file> <top-level-key>
  awk -v want="$2" '
    function trim(s){ gsub(/^[ \t]+/,"",s); gsub(/[ \t]+$/,"",s); return s }
    function unquote(s, c){ c=substr(s,1,1); if ((c=="\"" || c=="\x27") && substr(s,length(s),1)==c) return substr(s,2,length(s)-2); return s }
    $0 ~ "^" want ":" {
      v=$0; sub(/^[^:]*:/,"",v); sub(/[ \t]+#.*/,"",v); print unquote(trim(v)); exit
    }
  ' "$1"
}

# 列表值：既支持 inline [a, b] 也支持块状 "- a"。打印每行一项。
sc_yaml_list() { # <file> <top-level-key>
  awk -v want="$2" '
    function trim(s){ gsub(/^[ \t]+/,"",s); gsub(/[ \t]+$/,"",s); return s }
    function unquote(s, c){ c=substr(s,1,1); if ((c=="\"" || c=="\x27") && substr(s,length(s),1)==c) return substr(s,2,length(s)-2); return s }
    $0 ~ "^" want ":" {
      rest=$0; sub(/^[^:]*:/,"",rest); rest=trim(rest)
      if (rest ~ /^\[/) {
        sub(/^\[/,"",rest); sub(/\][ \t]*$/,"",rest)
        n=split(rest, a, ",")
        for (i=1;i<=n;i++) { v=unquote(trim(a[i])); if (v!="") print v }
        exit
      }
      inlist=1; next
    }
    inlist && /^[ \t]+-[ \t]+/ {
      v=$0; sub(/^[ \t]+-[ \t]+/,"",v); sub(/[ \t]+#.*/,"",v); print unquote(trim(v)); next
    }
    inlist && /^[^ \t#]/ { exit }
  ' "$1"
}

sc_lookup() { # <tsv-file> <key>；存在则打印 value 并返回 0
  awk -F'\t' -v k="$2" '$1==k { print $2; found=1; exit } END { if (!found) exit 1 }' "$1"
}

# pnpm-lock.yaml catalogs.default：name<TAB>specifier<TAB>version。
sc_lock_catalogs() {
  awk '
    function trim(s){ gsub(/^[ \t]+/,"",s); gsub(/[ \t]+$/,"",s); return s }
    function unquote(s, c){ c=substr(s,1,1); if ((c=="\"" || c=="\x27") && substr(s,length(s),1)==c) return substr(s,2,length(s)-2); return s }
    /^catalogs:/ { incat=1; next }
    incat && /^[^ \t]/ { incat=0 }
    incat && /^  [A-Za-z0-9_-]+:/ {
      name=$0; sub(/^  /,"",name); sub(/:.*/,"",name); cat=name
      next
    }
    incat && cat=="default" && /^    [^ \t]/ {
      pkg=$0; sub(/^    /,"",pkg); sub(/:.*/,"",pkg); pkg=unquote(trim(pkg)); next
    }
    incat && cat=="default" && pkg!="" && /^      specifier:/ { spec=$0; sub(/^      specifier:[ \t]*/,"",spec); spec=unquote(trim(spec)); next }
    incat && cat=="default" && pkg!="" && /^      version:/ { ver=$0; sub(/^      version:[ \t]*/,"",ver); ver=unquote(trim(ver)); print pkg "\t" spec "\t" ver; pkg=""; spec=""; ver=""; next }
  ' "$1"
}

# pnpm-lock.yaml importers：importer<TAB>section<TAB>name<TAB>specifier<TAB>version
# 只取直接依赖四类 section（忽略 packageManagerDependencies/configDependencies）。
sc_lock_importers() {
  awk '
    function trim(s){ gsub(/^[ \t]+/,"",s); gsub(/[ \t]+$/,"",s); return s }
    function unquote(s, c){ c=substr(s,1,1); if ((c=="\"" || c=="\x27") && substr(s,length(s),1)==c) return substr(s,2,length(s)-2); return s }
    function flush(){ if (imp!="" && sec!="" && pkg!="" && ver!="") print imp "\t" sec "\t" pkg "\t" spec "\t" ver; pkg=""; spec=""; ver="" }
    /^importers:/ { inimp=1; imp=""; sec=""; next }
    inimp && /^[^ \t]/ { flush(); inimp=0 }
    inimp && /^  [^ \t]/ {
      flush(); imp=$0; sub(/^  /,"",imp); sub(/:.*/,"",imp); imp=unquote(trim(imp)); sec=""; pkg=""; next
    }
    inimp && /^    [^ \t]/ {
      flush(); sec=$0; sub(/^    /,"",sec); sub(/:.*/,"",sec); sec=trim(sec); pkg=""; next
    }
    inimp && /^      [^ \t]/ {
      flush(); pkg=$0; sub(/^      /,"",pkg); sub(/:.*/,"",pkg); pkg=unquote(trim(pkg)); next
    }
    inimp && /^        specifier:/ { spec=$0; sub(/^        specifier:[ \t]*/,"",spec); spec=unquote(trim(spec)); next }
    inimp && /^        version:/ { ver=$0; sub(/^        version:[ \t]*/,"",ver); ver=unquote(trim(ver)); next }
    END { flush() }
  ' "$1" | awk -F'\t' '$2=="dependencies" || $2=="devDependencies" || $2=="optionalDependencies" || $2=="peerDependencies"'
}

# 去掉 pnpm 解析版本的 peer 后缀：10.15.0(jiti@2.7.0) → 10.15.0
sc_resolved_version() { printf '%s' "${1%%(*}"; }

sc_manifest_deps() { # <package.json> → name<TAB>spec
  jq -r '[(.dependencies // {}), (.devDependencies // {}), (.optionalDependencies // {}), (.peerDependencies // {})] | add // {} | to_entries[] | "\(.key)\t\(.value)"' "$1" 2>/dev/null
}

sc_manifest_files() { # <root>
  # 与构建快照同口径：git 仓库取 tracked+untracked 且未被 ignore 的 manifest
  # （gitignore 的 .artifacts 证据、node_modules 等不得误部门禁）；非 git 沙箱
  # （离线夹具）回退 find。
  local root="$1" rel
  if git -C "$root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git -C "$root" ls-files -co --exclude-standard -- 'package.json' '*/package.json' 2>/dev/null |
      while IFS= read -r rel; do
        [[ -f "$root/$rel" ]] && printf '%s\n' "$root/$rel"
      done | sort
    return 0
  fi
  find "$root" -name package.json -type f \
    -not -path '*/node_modules/*' -not -path '*/.devenv-state/*' -not -path '*/dist/*' \
    | sort
}

# images.lock 的 KEY=value 值（不做 shell source，避免静态检查执行内容）。
sc_lock_value() { # <file> <key>
  awk -F= -v k="$2" '$1==k { sub(/^[^=]*=/,""); print; exit }' "$1"
}

# 上游镜像锁必须是 tag+digest 双层锁。
sc_is_digest_ref() {
  [[ "${1:-}" =~ ^[a-z0-9]+([._/-][a-z0-9]+)*:[A-Za-z0-9._-]+@sha256:[0-9a-f]{64}$ ]]
}

# 镜像锁（Spec §2：多架构锁 manifest-list，单架构锁平台摘要；Mac 路线登记）。
sc_check_images_lock() { # <images.lock>
  local f="$1"
  if [[ ! -f "$f" ]]; then sc_fail "缺 devenv/images.lock（上游镜像 tag+digest 唯一事实源）"; return 1; fi
  local node db dbkind dbplat mac mackind nkind
  node="$(sc_lock_value "$f" NODE_IMAGE)"
  db="$(sc_lock_value "$f" DB_IMAGE)"
  mac="$(sc_lock_value "$f" DB_IMAGE_MACOS)"
  nkind="$(sc_lock_value "$f" NODE_IMAGE_KIND)"
  dbkind="$(sc_lock_value "$f" DB_IMAGE_KIND)"
  dbplat="$(sc_lock_value "$f" DB_IMAGE_PLATFORM)"
  mackind="$(sc_lock_value "$f" DB_IMAGE_MACOS_KIND)"

  [[ -n "$node" ]] || sc_fail "images.lock 缺 NODE_IMAGE"
  [[ -n "$db" ]] || sc_fail "images.lock 缺 DB_IMAGE"
  if [[ -n "$node" ]] && ! sc_is_digest_ref "$node"; then
    sc_fail "NODE_IMAGE 必须是 repo:tag@sha256:<64hex>（完整 tag + digest 双层锁）：${node}"
  fi
  if [[ -n "$db" ]] && ! sc_is_digest_ref "$db"; then
    sc_fail "DB_IMAGE 必须是 repo:tag@sha256:<64hex>（完整 tag + digest 双层锁）：${db}"
  fi
  [[ "$nkind" == "manifest-list" ]] || sc_fail "NODE_IMAGE_KIND 必须为 manifest-list（多架构镜像锁 manifest-list digest）：${nkind:-缺}"
  case "$dbkind" in
    single-arch)
      [[ -n "$dbplat" ]] || sc_fail "DB_IMAGE_KIND=single-arch 时必须声明 DB_IMAGE_PLATFORM（如 linux/amd64）"
      [[ -z "$dbplat" || "$dbplat" =~ ^[a-z0-9]+/[a-z0-9]+$ ]] || sc_fail "DB_IMAGE_PLATFORM 格式非法：${dbplat}（期望 os/arch，如 linux/amd64）"
      ;;
    manifest-list) ;;
    *) sc_fail "DB_IMAGE_KIND 必须为 single-arch 或 manifest-list：${dbkind:-缺}" ;;
  esac
  if [[ -z "$mac" ]]; then
    sc_fail "缺 DB_IMAGE_MACOS（#53 选定 macOS ARM 路线：kartoza multiarch，tag+manifest-list digest 登记）"
  else
    sc_is_digest_ref "$mac" || sc_fail "DB_IMAGE_MACOS 必须是 repo:tag@sha256:<64hex>：${mac}"
    [[ "$mackind" == "manifest-list" ]] || sc_fail "DB_IMAGE_MACOS_KIND 必须为 manifest-list（kartoza multiarch）：${mackind:-缺}"
  fi
  return 0
}

# 静态门禁：<root> [skip_lockfile=0]
# 返回 0 无错误（可能含警告）；1 有错误。错误/警告写入 SC_ERRORS / SC_WARNINGS。
supply_chain_static_check() {
  local root="${1:-$REPO_ROOT}" skip_lock="${2:-0}"
  sc_reset
  local ws="$root/pnpm-workspace.yaml"
  if [[ ! -f "$ws" ]]; then
    sc_fail "缺 pnpm-workspace.yaml（catalog/allowBuilds/minimumReleaseAge 的权威位置）"
    return 1
  fi
  local tmp
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/ne-supply-chain.XXXXXX")" || { sc_fail "无法创建临时目录"; return 1; }

  # 1) catalog 精确 pin
  sc_yaml_section_pairs "$ws" catalog > "$tmp/catalog.tsv"
  if [[ ! -s "$tmp/catalog.tsv" ]]; then
    sc_fail "catalog 为空（第三方版本唯一事实源必须在 pnpm-workspace.yaml 声明）"
  fi
  local name ver
  while IFS=$'\t' read -r name ver; do
    [[ -n "$name" ]] || continue
    if ! sc_is_exact_version "$ver"; then
      sc_fail "catalog 非精确 pin：${name}: ${ver}（必须完整精确版本，禁止 ^ ~ * latest/tag 或 URL）"
    fi
  done < "$tmp/catalog.tsv"

  # 3) allowBuilds 版本化审批键（升级即显式审查点）
  sc_yaml_section_pairs "$ws" allowBuilds > "$tmp/allow.tsv"
  local val
  while IFS=$'\t' read -r name val; do
    [[ -n "$name" ]] || continue
    if ! sc_is_versioned_key "$name"; then
      sc_fail "allowBuilds 审批键必须带版本号：${name}（形如 pkg@1.2.3 或 @scope/pkg@1.2.3；裸包名会让升级静默继承批准）"
    fi
    case "$val" in
      true|false) ;;
      *) sc_fail "allowBuilds ${name} 的值必须是 true/false（实际：${val}）" ;;
    esac
  done < "$tmp/allow.tsv"

  # 4) minimumReleaseAge：分钟单位、显式定值 + strict；例外只允许精确版本
  local mra mras mrait danger ex
  mra="$(sc_yaml_scalar "$ws" minimumReleaseAge)"
  if [[ ! "$mra" =~ ^[0-9]+$ ]] || (( 10#$mra <= 0 )); then
    sc_fail "minimumReleaseAge 必须显式设为正整数分钟（本仓库定值 1440 = 1 天冷却；pnpm 12.21 语义见 docs/agents/supply-chain.md）"
  fi
  mras="$(sc_yaml_scalar "$ws" minimumReleaseAgeStrict)"
  [[ "$mras" == "true" ]] || sc_fail "必须显式 minimumReleaseAgeStrict: true（太新的版本应失败并要求审查，而非静默写入例外）"
  mrait="$(sc_yaml_scalar "$ws" minimumReleaseAgeIgnoreMissingTime)"
  [[ -z "$mrait" || "$mrait" == "false" ]] || sc_fail "禁止 minimumReleaseAgeIgnoreMissingTime: true（缺发布时间时不得静默跳过冷却期检查）"
  danger="$(sc_yaml_scalar "$ws" dangerouslyAllowAllBuilds)"
  [[ -z "$danger" || "$danger" == "false" ]] || sc_fail "禁止 dangerouslyAllowAllBuilds: true（构建脚本必须逐版本审批）"
  while IFS= read -r ex; do
    [[ -n "$ex" ]] || continue
    if ! sc_is_versioned_key "$ex"; then
      sc_fail "minimumReleaseAgeExclude 例外必须精确到版本（pkg@version）：${ex}（禁止裸包名/通配；紧急流程见 docs/agents/supply-chain.md）"
    fi
  done < <(sc_yaml_list "$ws" minimumReleaseAgeExclude)

  # 5) manifest 声明：浮动范围拒绝；catalog 依赖只能经 catalog: 引用
  local f rel spec
  while IFS= read -r f; do
    [[ -n "$f" ]] || continue
    rel="${f#"$root"/}"
    if ! sc_manifest_deps "$f" > "$tmp/deps.tsv"; then
      sc_fail "无法解析 ${rel}（JSON 非法或 jq 不可用）"
      continue
    fi
    while IFS=$'\t' read -r name spec; do
      [[ -n "$name" ]] || continue
      case "$spec" in
        workspace:*) continue ;;
        catalog:)
          if ! sc_lookup "$tmp/catalog.tsv" "$name" >/dev/null; then
            sc_fail "${rel}：${name} 使用 catalog:，但 pnpm-workspace.yaml catalog 未声明该包"
          fi
          continue ;;
      esac
      if sc_lookup "$tmp/catalog.tsv" "$name" >/dev/null; then
        sc_fail "${rel}：${name} 的权威声明在 pnpm-workspace.yaml catalog，manifest 必须写 catalog:（不得写死 ${spec}）"
        continue
      fi
      if ! sc_is_exact_version "$spec"; then
        sc_fail "${rel}：${name} 使用非精确/浮动声明 ${spec}（第三方依赖须为精确版本或 catalog:）"
      fi
    done < "$tmp/deps.tsv"
  done < <(sc_manifest_files "$root")

  # 6) 锁文件漂移：catalog 声明 ↔ 解析结果；importer 直接依赖集合与版本
  if (( skip_lock )); then
    :
  elif [[ ! -f "$root/pnpm-lock.yaml" ]]; then
    sc_fail "缺 pnpm-lock.yaml（普通构建必须 frozen install；首次引导或变更请经 devenv build --lockgen 生成并审查 diff）"
  else
    local lock="$root/pnpm-lock.yaml"
    sc_lock_catalogs "$lock" > "$tmp/lock-catalog.tsv"
    awk -F'\t' '
      NR==FNR { want[$1]=$2; next }
      {
        seen[$1]=1
        if (!($1 in want)) { print "extra\t"$1; next }
        if ($2 != want[$1] || $3 != want[$1]) print "mismatch\t"$1"\t"want[$1]"\t"$2"\t"$3
      }
      END { for (k in want) if (!(k in seen)) print "missing\t"k"\t"want[k] }
    ' "$tmp/catalog.tsv" "$tmp/lock-catalog.tsv" > "$tmp/catalog-drift.tsv"
    local kind a b c
    while IFS=$'\t' read -r kind name a b c; do
      case "$kind" in
        extra) sc_fail "锁文件 catalog 多出未声明条目：${name}（非预期锁文件变化，需审查后更新）" ;;
        missing) sc_fail "锁文件 catalog 缺声明条目：${name}（catalog 已变更但锁文件未审查更新；修复：devenv build --lockgen 后审查 diff）" ;;
        mismatch) sc_fail "锁文件 catalog 漂移：${name}（catalog 声明 ${a}，锁文件 specifier=${b} version=${c}；不得自动接受）" ;;
      esac
    done < "$tmp/catalog-drift.tsv"

    sc_lock_importers "$lock" > "$tmp/lock-importers.tsv"

    # manifest ↔ importer 映射（root=./package.json；workspace 包=相对目录）
    : > "$tmp/manifest-map.tsv"
    : > "$tmp/expected-deps.tsv"
    : > "$tmp/manifest-specs.tsv"
    local imp f2 rel2
    while IFS= read -r f2; do
      [[ -n "$f2" ]] || continue
      rel2="${f2#"$root"/}"
      if [[ "$rel2" == "package.json" ]]; then imp="."; else imp="${rel2%/package.json}"; fi
      printf '%s\t%s\n' "$imp" "$rel2" >> "$tmp/manifest-map.tsv"
      if ! sc_manifest_deps "$f2" > "$tmp/deps2.tsv"; then
        sc_fail "无法解析 ${rel2}（JSON 非法或 jq 不可用）"
        continue
      fi
      while IFS=$'\t' read -r name spec; do
        [[ -n "$name" ]] || continue
        printf '%s\t%s\n' "$imp" "$name" >> "$tmp/expected-deps.tsv"
        printf '%s\t%s\t%s\n' "$imp" "$name" "$spec" >> "$tmp/manifest-specs.tsv"
      done < "$tmp/deps2.tsv"
    done < <(sc_manifest_files "$root")

    awk -F'\t' '{ print $1"\t"$3 }' "$tmp/lock-importers.tsv" > "$tmp/lock-deps.tsv"

    # 直接依赖集合：多出或缺失都视为非预期锁文件变化
    awk -F'\t' '
      NR==FNR { want[$1"\t"$2]=1; next }
      { key=$1"\t"$2; seen[key]=1; if (!(key in want)) print "extra\t"$1"\t"$2 }
      END { for (k in want) if (!(k in seen)) { split(k, a, "\t"); print "missing\t"a[1]"\t"a[2] } }
    ' "$tmp/expected-deps.tsv" "$tmp/lock-deps.tsv" > "$tmp/dep-drift.tsv"
    while IFS=$'\t' read -r kind imp name; do
      case "$kind" in
        extra) sc_fail "锁文件出现 manifest 未声明的直接依赖：${imp} → ${name}（非预期锁文件变化，需审查）" ;;
        missing) sc_fail "锁文件缺 manifest 直接依赖：${imp} → ${name}（锁文件未审查更新；修复：devenv build --lockgen 后审查 diff）" ;;
      esac
    done < "$tmp/dep-drift.tsv"

    # 版本/specifier 漂移（catalog: 与精确版本；workspace: 链接不比较）
    local expected resolved lock_spec
    while IFS=$'\t' read -r imp name spec; do
      [[ -n "$imp" ]] || continue
      case "$spec" in
        workspace:*) continue ;;
        catalog:)
          if ! expected="$(sc_lookup "$tmp/catalog.tsv" "$name")"; then
            continue  # catalog 缺声明已在上方报错
          fi
          ;;
        *) expected="$spec" ;;
      esac
      local row
      row="$(awk -F'\t' -v i="$imp" -v p="$name" '$1==i && $3==p { print $4"\t"$5; exit }' "$tmp/lock-importers.tsv")"
      [[ -n "$row" ]] || continue  # 缺失已在集合差异中报错
      lock_spec="${row%%$'\t'*}"
      resolved="$(sc_resolved_version "${row#*$'\t'}")"
      if [[ "$spec" == "catalog:" && "$lock_spec" != "catalog:" ]]; then
        sc_fail "锁文件 specifier 漂移：${imp} → ${name}（manifest=catalog:，锁文件=${lock_spec}）"
      elif [[ "$spec" != "catalog:" && "$lock_spec" != "$spec" ]]; then
        sc_fail "锁文件 specifier 漂移：${imp} → ${name}（manifest=${spec}，锁文件=${lock_spec}）"
      fi
      if [[ "$resolved" != "$expected" ]]; then
        sc_fail "锁文件解析漂移：${imp} → ${name}（期望 ${expected}，锁文件 ${resolved}；需审查后重新生成锁文件）"
      fi
    done < "$tmp/manifest-specs.tsv"
  fi

  # 7) 上游镜像锁：tag+digest 双层锁、多架构/单架构类型、macOS 路线登记
  sc_check_images_lock "$root/devenv/images.lock"

  rm -rf "$tmp"
  sc_has_errors && return 1 || return 0
}

sc_print_report() {
  local e
  for e in ${SC_ERRORS[@]+"${SC_ERRORS[@]}"}; do printf 'ERROR: %s\n' "$e" >&2; done
  for e in ${SC_WARNINGS[@]+"${SC_WARNINGS[@]}"}; do printf 'WARN: %s\n' "$e" >&2; done
}

sc_error_count() { printf '%s' "${#SC_ERRORS[@]}"; }
sc_warning_count() { printf '%s' "${#SC_WARNINGS[@]}"; }
