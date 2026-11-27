# shellcheck shell=bash
# ============================================================================
# GitHub App 认证核心库（被 devenv/devenv source，不直接执行）
#
# 身份模型：
#   - 仓库内 devenv/github-app.json 只是「身份声明」（非敏感，随分支走）。
#   - 仓库外 ~/.config/github-apps/bbhl79-agent/authorization.json 才是「本机授权」。
#   - 每次调用双向匹配：声明 ⊆ 授权，且当前 origin 仓库 ∈ 两者交集，否则拒绝。
#     分支里的声明无法自行扩大授权范围。
#
# 安全约束：
#   - 私钥只由签名步骤（openssl）读取；不打印、不复制、不外传。
#   - installation token 只存在于内存与本次子进程环境：不缓存、不写文件、
#     不进命令参数、不进日志。每次调用重新签发 JWT 并换取新 token。
#   - 任何失败立即非零返回；调用方不得回退到个人 gh 登录或个人 git 凭据。
#
# 退出码：20 配置/授权不符  21 私钥/签名失败  22 token 换取失败  23 目标未授权
# ============================================================================

GHA_AUTHZ_DEFAULT="$HOME/.config/github-apps/bbhl79-agent/authorization.json"
GHA_API="https://api.github.com"

gha_die() { local code="$1"; shift; printf '[devenv-auth] ERROR: %s\n' "$*" >&2; return "$code"; }

gha_b64url() { openssl base64 -e -A | tr '+/' '-_' | tr -d '='; }

# 把 GitHub remote URL 归一化为 owner/name；非 github.com 或无法解析返回 1。
gha_normalize_repo() {
  local url="$1" p
  case "$url" in
    https://github.com/*)   p="${url#https://github.com/}" ;;
    git@github.com:*)       p="${url#git@github.com:}" ;;
    ssh://git@github.com/*) p="${url#ssh://git@github.com/}" ;;
    *) return 1 ;;
  esac
  p="${p%.git}"; p="${p%/}"
  [[ "$p" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || return 1
  printf '%s' "$p"
}

# 读取并校验 仓库声明 + 本机授权。
# 成功时设置：GHA_APP_ID GHA_APP_SLUG GHA_INSTALLATION_ID GHA_KEY_PATH GHA_REPO GHA_REPO_NAME
gha_load_config() {
  local repo_root="$1"
  local decl="$repo_root/devenv/github-app.json"
  local authz="${GHA_AUTHZ_FILE:-$GHA_AUTHZ_DEFAULT}"
  command -v jq >/dev/null 2>&1 || { gha_die 20 "缺少 jq"; return; }
  command -v openssl >/dev/null 2>&1 || { gha_die 20 "缺少 openssl"; return; }
  [[ -f "$decl" ]] || { gha_die 20 "仓库身份声明缺失：$decl"; return; }
  [[ -f "$authz" ]] || { gha_die 20 "本机授权文件缺失：$authz（仓库外配置，见 docs/agents/github-app-auth.md）"; return; }

  local d_app_id d_slug a_app_id a_slug a_key
  d_app_id=$(jq -r '.app_id // empty' "$decl")
  d_slug=$(jq -r '.app_slug // empty' "$decl")
  a_app_id=$(jq -r '.app_id // empty' "$authz")
  a_slug=$(jq -r '.app_slug // empty' "$authz")
  a_key=$(jq -r '.private_key_path // empty' "$authz")
  GHA_INSTALLATION_ID=$(jq -r '.installation_id // empty' "$authz")

  [[ -n "$d_app_id" && -n "$d_slug" && -n "$a_app_id" && -n "$a_slug" && -n "$a_key" && -n "$GHA_INSTALLATION_ID" ]] || {
    gha_die 20 "仓库声明或本机授权字段不完整"; return; }
  [[ "$d_app_id" == "$a_app_id" && "$d_slug" == "$a_slug" ]] || {
    gha_die 20 "仓库声明与本机授权不符（app_id/app_slug），拒绝执行"; return; }

  local origin repo
  origin=$(git -C "$repo_root" remote get-url origin 2>/dev/null) || {
    gha_die 20 "无法读取 origin remote"; return; }
  repo=$(gha_normalize_repo "$origin") || {
    gha_die 20 "origin URL 无法解析为 github.com 仓库：$origin"; return; }
  jq -e --arg r "$repo" '.repositories | index($r) != null' "$decl" >/dev/null 2>&1 || {
    gha_die 23 "当前仓库 $repo 不在仓库声明允许清单内"; return; }
  jq -e --arg r "$repo" '.allowed_repositories | index($r) != null' "$authz" >/dev/null 2>&1 || {
    gha_die 23 "当前仓库 $repo 不在本机授权允许清单内"; return; }

  a_key="${a_key/#\~/$HOME}"
  [[ -f "$a_key" ]] || { gha_die 21 "私钥文件不存在：$a_key"; return; }
  local perm
  if perm=$(stat -c '%a' "$a_key" 2>/dev/null); then
    :
  elif perm=$(stat -f '%OLp' "$a_key" 2>/dev/null); then
    :
  else
    gha_die 21 "无法读取私钥权限：$a_key"; return
  fi
  perm="${perm#"${perm%%[!0]*}"}"
  [[ "$perm" == "600" || "$perm" == "400" ]] || {
    gha_die 21 "私钥权限必须为 600 或 400，当前为 $perm"; return; }

  GHA_APP_ID="$a_app_id"
  GHA_APP_SLUG="$a_slug"
  GHA_KEY_PATH="$a_key"
  GHA_REPO="$repo"
  GHA_REPO_NAME="${repo#*/}"
}

# 用私钥签发 RS256 JWT（iat 回拨 60s，exp 9 分钟，低于 GitHub 10 分钟上限）。
# JWT 只经 stdout 返回给调用方变量，不打印到终端/日志。
gha_make_jwt() {
  local now iat exp header payload sig
  now=$(date +%s); iat=$((now - 60)); exp=$((now + 540))
  header=$(printf '{"alg":"RS256","typ":"JWT"}' | gha_b64url)
  payload=$(printf '{"iat":%d,"exp":%d,"iss":"%s"}' "$iat" "$exp" "$GHA_APP_ID" | gha_b64url)
  sig=$(printf '%s.%s' "$header" "$payload" | openssl dgst -sha256 -sign "$GHA_KEY_PATH" 2>/dev/null | gha_b64url)
  [[ -n "$sig" ]] || { gha_die 21 "JWT 签名失败（私钥不可读或格式错误）"; return; }
  printf '%s.%s.%s' "$header" "$payload" "$sig"
}

# 换取仅限 GHA_REPO_NAME 的 installation token。token 只经 stdout 返回。
# JWT 经 stdin 交给 curl（-H @-），不进命令参数（ps//proc 不可见）。
# 任何网络错误 / 非 2xx / 超时都非零返回，不产出半成品 token。
gha_mint_token() {
  local jwt body resp token
  jwt=$(gha_make_jwt) || return
  body=$(jq -nc --arg r "$GHA_REPO_NAME" '{repositories:[$r]}')
  resp=$(printf 'Authorization: Bearer %s\n' "$jwt" | curl -sf --max-time 20 \
      -X POST \
      -H @- \
      -H "Accept: application/vnd.github+json" \
      -H "X-GitHub-Api-Version: 2022-11-28" \
      "$GHA_API/app/installations/$GHA_INSTALLATION_ID/access_tokens" \
      -d "$body" 2>/dev/null) || {
    gha_die 22 "installation token 换取失败（网络错误、超时或 GitHub 拒绝）"; return; }
  token=$(printf '%s' "$resp" | jq -r '.token // empty')
  [[ -n "$token" ]] || { gha_die 22 "GitHub 响应中无 token 字段"; return; }
  printf '%s' "$token"
}

# ---------------------------------------------------------------------------
# 子命令实现
# ---------------------------------------------------------------------------

# devenv gh <args...>：以 App 身份执行 gh。
#  - 拒绝 gh auth 系列（保护个人登录）。
#  - 拒绝 -R/--repo 指向未授权仓库。
#  - 排除继承的认证变量，GH_TOKEN 为本次新换的 installation token；
#    token 无效时 gh 直接报错，不存在回退个人登录的路径。
gha_cmd_gh() {
  case "${1:-}" in
    auth)
      gha_die 2 "拒绝 gh auth 系列子命令（保护个人登录；App 身份无需登录）"; return ;;
  esac
  gha_load_config "$REPO_ROOT" || return

  local prev="" a repo_arg=""
  for a in "$@"; do
    case "$prev" in -R|--repo) repo_arg="$a" ;; esac
    case "$a" in --repo=*) repo_arg="${a#--repo=}" ;; esac
    prev="$a"
  done
  if [[ -n "$repo_arg" && "$repo_arg" != "$GHA_REPO" ]]; then
    gha_die 23 "拒绝操作未授权仓库：$repo_arg（允许：$GHA_REPO）"; return
  fi

  local token
  token=$(gha_mint_token) || return
  env -u GITHUB_TOKEN -u GH_TOKEN -u GH_ENTERPRISE_TOKEN -u GITHUB_ENTERPRISE_TOKEN \
      -u GH_HOST -u GH_CONFIG_DIR -u GH_REPO \
      GH_TOKEN="$token" gh "$@"
}

# devenv git-push <remote> <refspec...>：以 App 身份做 HTTPS 推送。
#  - 只接受已配置的 remote 名（拒绝裸 URL，防推送目标注入）。
#  - push URL 归一化后必须等于授权仓库；不改写任何 remote 配置。
#  - 按调用覆盖 credential helper（清空继承列表后只挂本入口 helper），
#    禁用交互提示；token 经环境变量交给 helper，不进 remote URL/参数/日志。
gha_cmd_git_push() {
  local remote="${1:-}"
  [[ -n "$remote" ]] || { gha_die 2 "用法：devenv git-push <remote> <refspec...>"; return; }
  shift
  [[ $# -ge 1 ]] || { gha_die 2 "缺少 refspec"; return; }
  gha_load_config "$REPO_ROOT" || return

  # get-url --push 返回 insteadOf/pushInsteadOf 改写后的实际推送地址。
  # 只接受 https://github.com/ 形式；SSH 形式一律拒绝，避免回退个人 SSH 密钥。
  local url target
  url=$(git -C "$REPO_ROOT" remote get-url --push "$remote" 2>/dev/null) || {
    gha_die 23 "remote 不存在或不可读：$remote（本入口只接受已配置的 remote 名，不接受 URL）"; return; }
  case "$url" in
    https://github.com/*) ;;
    git@github.com:*|ssh://*)
      gha_die 23 "push URL 为 SSH 形式（$url，含 insteadOf/pushInsteadOf 改写后结果），本入口只允许 HTTPS，拒绝回退个人 SSH 密钥；请改用 HTTPS remote"; return ;;
    *)
      gha_die 23 "push URL 非 https://github.com 形式：$url"; return ;;
  esac
  target=$(gha_normalize_repo "$url") || {
    gha_die 23 "push URL 无法解析为 github.com 仓库：$url"; return; }
  [[ "$target" == "$GHA_REPO" ]] || {
    gha_die 23 "push 目标 $target 未授权（允许：$GHA_REPO）"; return; }

  local token
  token=$(gha_mint_token) || return
  GH_APP_INSTALLATION_TOKEN="$token" \
  GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=/bin/false SSH_ASKPASS=/bin/false \
  env -u GITHUB_TOKEN -u GH_TOKEN -u GH_ENTERPRISE_TOKEN \
  git -C "$REPO_ROOT" \
      -c credential.helper= \
      -c credential.https://github.com.helper= \
      -c "credential.https://github.com.helper=!\"$REPO_ROOT/devenv/bin/github-app-git-credential\"" \
      push "$remote" "$@"
}
