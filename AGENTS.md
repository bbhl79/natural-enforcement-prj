# 项目智能体指令

## 沟通语言

所有输出和沟通使用简体中文。专有名词、产品名称、代码标识符和缩写可保留原文。

## 分支与 worktree

日常开发停在 `dev`。`dev` 是本地当前分支，也是远端默认分支。`main` 是受保护分支。

Git worktree 只放在与项目目录平级的 `../natural-enforcement-prj-wts/`。

分支和 Git worktree 由用户亲自操作。代理只执行当前请求里点名授权的那一项。授权要写明这次的动作。早前对话里的授权不算。

没有这项授权时，只读取状态（`git status`、`git branch`、`git log`、`git worktree list`），把变更留给用户：

- 创建、切换、重命名、删除分支
- 合并、变基、推送分支
- `git worktree add`、`remove`、`move`、`lock`

「修这个缺陷并提交」只允许改当前分支上的文件并提交。不新建分支，不切换分支，不创建 worktree。

「从 dev 拉出功能分支，放到 worktree」是对这两项的授权，可以执行。
