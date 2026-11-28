# 项目智能体指令

## 工程基座（强制入口）

一切构建、启停、观察、执行统一经 `./devenv/devenv`（唯一入口，禁止直接操作
compose）；命令面权威文档：`devenv/COMMANDS.md`（命令表 / 退出码 / 输出协议 /
并发语义）。硬不变量：

- 宿主工具链零安装——node/pnpm/prisma 只在容器内执行；
- 无 bind 烘焙镜像——源码 COPY 进镜像，只挂命名卷，零宿主端口（web 唯一例外，
  经 `devenv web` opt-in）；调试一律 `devenv exec/shell/logs`；
- 引擎端点解析与 DB 镜像覆盖规则见 `devenv/COMMANDS.md`。

开工自检：`./devenv/devenv doctor`（退出码即可开工与否）。

## 运行证据与产物（强制）

- 一切原始运行证据（命令捕获 `.jsonl`/`.out`/`.err`/`.exitcode`/`.log` 等）一律写入
  `.artifacts/<票号>-<slug>/`（已 `.gitignore`，不进代码库，不污染 `#58` 工作树快照）。
  e2e run 的运行产物（Playwright 报告/trace/日志/run.json）按 run 组织，写入
  `.artifacts/e2e/<run-id>/`；票号目录用于该票验收的原始证据与摘要，两者同属
  gitignored 证据区。
- 验收结论、关键输出摘录与对应 commit SHA 归档至 GitHub Issue / PR 评论；长期有效
  的设计/路线决策写入 `docs/adr/` 或 `docs/research/*.md`；可复用的测试脚本归入
  `devenv/test/`。

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

### 供应链门禁

第三方版本只认 `pnpm-workspace.yaml` catalog（精确 pin）；锁文件漂移、未版本化的
`allowBuilds`、过新版本、未批准的构建脚本/包内 agent skills 都会停止构建。新增或
升级依赖后跑 `./devenv/devenv supply-chain`，容器内权限用
`./devenv/devenv supply-chain --container`。规则、冷却期与紧急安全更新流程见
`docs/agents/supply-chain.md`。
