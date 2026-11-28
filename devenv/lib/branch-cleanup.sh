# shellcheck shell=bash
# ============================================================================
# 分支清理（#74；Spec-工程基座 §7 Git 规范 / 验收清单项 11）——窄用途：
# 「PR 合入后清理」本地分支与其 worktree。不引入通用 worktree 创建/切换/管理。
#
# 双重判断（squash 合入判定 = PR 状态 且 本地无未推送内容）：
#   - PR 状态：远端存在该分支的已合入 PR（merged_at 非空，squash 合入后
#     merge_commit_sha 是 dev 上的新提交，原分支提交并非其祖先——故不能用
#     git merge-base 判定，须以 PR 的 head.sha 为合入基准）。
#   - 本地内容：① worktree 无未提交文件；② 本地 tip 无超出合入 head 的提交
#     （PR 合入后本地新增提交 / 未推送提交）。
# 任一不成立 → 拒绝并列出原因；**不存在强制删除路径**（无 --force）。
# prototype/* 留档分支豁免；dev/main/当前检出分支恒拒。
#
# 删除机制：判定通过后 git worktree remove + git branch -D。git 的 -d 无法识别
# squash 合入（原提交非 dev 祖先），故用 -D——但 -D 只在双重判断闸门通过之后
# 执行，命令面不暴露任何跳过闸门的强制旗标（「不得强制删除」指无用户可见的
# 强制路径，非禁止内部删除已验证安全的分支）。
#
# GitHub 查询匿名只读（公开仓库 PR 状态可读），复用 bp_api_get（curl，可 mock）；
# 本地 git 操作只读判定 + 通过后删除。PR 查询失败 → fail closed（exit 3），不删除。
# ============================================================================

BC_REASONS=()
BC_WORKTREE=""
BC_PR_JSON=""
BC_TIP=""
BC_MERGED_HEAD=""
BC_MERGE_COMMIT=""
BC_PR_NUMBER=""

bc_branch_exists() { git -C "$REPO_ROOT" show-ref --verify --quiet "refs/heads/$1"; }

bc_current_branch() { git -C "$REPO_ROOT" symbolic-ref --quiet --short HEAD 2>/dev/null || true; }

# bc_worktree_for <branch> → stdout 检出该分支的 worktree 路径（无则空）
bc_worktree_for() {
  local target="refs/heads/$1" wt="" line
  while IFS= read -r line; do
    case "$line" in
      "worktree "*) wt="${line#worktree }" ;;
      "branch "*) [[ "${line#branch }" == "$target" ]] && { printf '%s' "$wt"; return 0; } ;;
    esac
  done < <(git -C "$REPO_ROOT" worktree list --porcelain 2>/dev/null)
  return 0
}

# bc_worktree_busy <worktree-path> → 0 持有活跃 per-worktree 锁/租约（不可强拆）| 1 空闲。
# 只读判定（不清理失效槽）：复用 lock_is_stale（含 owner 写入窗口 1s 宽限——
# mkdir 后未写 owner 不误判空闲）。覆盖全部 per-worktree 锁族（COMMANDS.md 并发
# 语义表）：stack/migrate/gen/e2e-image/e2e-admit/e2e-owner-<runid> 排他锁 +
# stack 共享租约槽——含不持 stack 锁的 gen/e2e 构建。gitignored 的 .devenv-state
# 对 git status 不可见，故须独立核对锁/租约——清理是写者，绝不强拆活跃运行
# （Spec §4 栈使用租约语义）。
bc_worktree_busy() {
  local wt="$1" id suffix d slot name
  id=$(git -C "$wt" rev-parse --absolute-git-dir 2>/dev/null) || id="$wt"
  suffix=$(printf '%s' "$id" | sha256sum | awk '{print $1}' | cut -c1-8)
  for name in stack migrate gen e2e-image e2e-admit; do
    d="$LOCK_ROOT/$name-$suffix.lock"
    [[ -d "$d" ]] || continue
    lock_is_stale "$d" || return 0
  done
  for d in "$LOCK_ROOT/e2e-owner-$suffix"-*.lock; do
    [[ -d "$d" ]] || continue
    lock_is_stale "$d" || return 0
  done
  for slot in "$LOCK_ROOT/stack-$suffix.lease"/*; do
    [[ -d "$slot" ]] || continue
    lock_is_stale "$slot" || return 0
  done
  return 1
}

# bc_worktree_is_locked <worktree-path> → 0 该 worktree 处于 git worktree lock 状态。
bc_worktree_is_locked() {
  local target="$1" cur="" line
  while IFS= read -r line; do
    case "$line" in
      "worktree "*) cur="${line#worktree }" ;;
      locked*) [[ "$cur" == "$target" ]] && return 0 ;;
    esac
  done < <(git -C "$REPO_ROOT" worktree list --porcelain 2>/dev/null)
  return 1
}

# bc_find_merged_pr <branch> → stdout 最近一个已合入 PR 的 JSON。
# rc：0 找到 | 1 无已合入 PR | 3 查询/解析失败（fail closed）。
bc_find_merged_pr() {
  local repo owner head_enc url json merged
  repo=$(bp_repo) || return 3
  owner="${repo%%/*}"
  head_enc=$(jq -rn --arg h "$owner:$1" '$h|@uri') || return 3
  url="/repos/$repo/pulls?head=$head_enc&state=closed&sort=updated&direction=desc&per_page=100"
  json=$(bp_api_get "$url") || return 3
  printf '%s' "$json" | jq -e 'type == "array"' >/dev/null 2>&1 || return 3
  merged=$(jq -c '[.[] | select(.merged_at != null)] | sort_by(.merged_at) | last // empty' <<< "$json") || return 3
  [[ -n "$merged" ]] || return 1
  printf '%s' "$merged"
}

# bc_judge <branch>：双重判断，收集拒绝原因到 BC_REASONS。
# rc：0 可安全清理 | 3 无法判定（fail closed）| 4 拒绝（含豁免/恒拒）。
# 调用方须以 `bc_judge ... || rc=$?` 形态调用（set -e 条件上下文）。
bc_judge() {
  local branch="$1"
  BC_REASONS=(); BC_WORKTREE=""; BC_PR_JSON=""; BC_TIP=""
  BC_MERGED_HEAD=""; BC_MERGE_COMMIT=""; BC_PR_NUMBER=""

  # prototype/* 留档豁免（归档分支不清理）
  case "$branch" in
    prototype/*)
      BC_REASONS+=("prototype 留档分支豁免——归档分支不清理（源码经 archive 标签/提交哈希追溯）")
      return 4 ;;
  esac

  # dev/main/当前检出分支恒拒（trunk 与正在使用的分支不可清理）
  local cur
  cur=$(bc_current_branch)
  if [[ "$branch" == "dev" || "$branch" == "main" || "$branch" == "$cur" ]]; then
    BC_REASONS+=("目标分支 $branch 是 trunk/默认/当前检出分支，恒不清理")
    return 4
  fi

  BC_TIP=$(git -C "$REPO_ROOT" rev-parse --verify "refs/heads/$branch" 2>/dev/null) \
    || { BC_REASONS+=("无法解析分支 $branch 的 tip"); return 3; }

  # ① 未提交文件（检出该分支的 worktree 有未保存改动；含未跟踪文件，不含 gitignored）
  BC_WORKTREE=$(bc_worktree_for "$branch")
  if [[ -n "$BC_WORKTREE" ]]; then
    # locked worktree（git worktree lock）：worktree remove 必拒——前置判定，
    # 保持 dry-run 与 --apply 一致（不拖到 --apply 才报错）
    if bc_worktree_is_locked "$BC_WORKTREE"; then
      BC_REASONS+=("目标 worktree $BC_WORKTREE 处于 git worktree lock 状态——拒绝清理（先 git worktree unlock 或确认其用途）")
      return 4
    fi
    # 活跃 per-worktree 锁/租约（gitignored .devenv-state 对 status 不可见）→ 绝不强拆（exit 6）
    if bc_worktree_busy "$BC_WORKTREE"; then
      BC_REASONS+=("目标 worktree $BC_WORKTREE 持有活跃栈锁/租约（测试/构建运行中）——拒绝清理，绝不强拆；等待运行结束后重跑")
      return 6
    fi
    local dirty
    dirty=$(git -C "$BC_WORKTREE" status --porcelain 2>/dev/null) \
      || { BC_REASONS+=("无法读取工作树 $BC_WORKTREE 状态——fail closed"); return 3; }
    if [[ -n "$dirty" ]]; then
      BC_REASONS+=("未提交文件（工作树 $BC_WORKTREE 有未保存改动）：$(printf '%s' "$dirty" | head -5 | tr '\n' ';')")
    fi
  fi

  # ② PR 合入状态（squash 合入判定）
  local pr rc=0
  pr=$(bc_find_merged_pr "$branch") || rc=$?
  if [[ $rc == 3 ]]; then
    BC_REASONS+=("无法判定 PR 合入状态（GitHub 查询失败）——fail closed，不清理")
    return 3
  fi
  if [[ $rc == 1 || -z "$pr" ]]; then
    # 无已合入 PR：本地有远端不存在的提交即「未推送提交」
    local unpushed
    unpushed=$(git -C "$REPO_ROOT" rev-list "$branch" --not --remotes 2>/dev/null || true)
    [[ -n "$unpushed" ]] && BC_REASONS+=("未推送提交（本地有远端不存在的提交）：$(printf '%s' "$unpushed" | head -5 | tr '\n' ' ')")
    BC_REASONS+=("PR 未合入或不存在（squash 合入判定不成立）——不清理")
    return 4
  fi

  BC_PR_JSON="$pr"
  BC_MERGED_HEAD=$(jq -r '.head.sha // empty' <<< "$pr")
  BC_MERGE_COMMIT=$(jq -r '.merge_commit_sha // empty' <<< "$pr")
  BC_PR_NUMBER=$(jq -r '.number // empty' <<< "$pr")
  if [[ -z "$BC_MERGED_HEAD" ]]; then
    BC_REASONS+=("PR 响应缺 head.sha——无法判定合入基准（fail closed）")
    return 3
  fi
  # 合入 head 须在本地对象库（否则无法比对本地新增提交）
  if ! git -C "$REPO_ROOT" cat-file -e "$BC_MERGED_HEAD" 2>/dev/null; then
    BC_REASONS+=("PR 合入 head $BC_MERGED_HEAD 不在本地对象库——fail closed；修复：git fetch origin pull/${BC_PR_NUMBER:-<pr>}/head（开启自动删除后远端分支已删，普通 fetch 拉不到合入 head）")
    return 3
  fi
  # ③ PR 合入后本地新增提交（本地 tip 超出合入 head 的提交 = 未推送内容）
  local extra
  extra=$(git -C "$REPO_ROOT" rev-list "$BC_MERGED_HEAD..$branch" 2>/dev/null) \
    || { BC_REASONS+=("无法比对本地 tip 与合入 head——fail closed"); return 3; }
  if [[ -n "$extra" ]]; then
    BC_REASONS+=("PR 合入后本地新增提交（未推送，合入判定不成立）：$(printf '%s' "$extra" | head -5 | tr '\n' ' ')")
  fi

  [[ ${#BC_REASONS[@]} -gt 0 ]] && return 4
  return 0
}