# 项目智能体指令

## GitHub 认证入口（强制）

所有 GitHub 操作必须以 GitHub App `bbhl79-agent` 身份经 devenv 入口执行，
禁止直接使用个人 `gh` 登录或系统 git 凭据：

- `./devenv/devenv gh <args...>` —— 一切 gh 操作（issue / PR / api 等）。
- `./devenv/devenv git-push <remote> <refspec...>` —— 一切 git 推送。

细则与安全边界见 `docs/agents/github-app-auth.md`。

## Agent skills

### Issue tracker

Issues 和 specs 以 GitHub Issues 形式跟踪，使用 gh CLI。见 `docs/agents/issue-tracker.md`。

### Triage labels

使用五个标准 triage 标签（needs-triage / needs-info / ready-for-agent / ready-for-human / wontfix）。见 `docs/agents/triage-labels.md`。

### Domain docs

Single-context 布局：根目录 `GLOSSARY.md` + `docs/adr/`。见 `docs/agents/domain.md`。
