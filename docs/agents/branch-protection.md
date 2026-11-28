# 分支保护两层规则集：应用、验收与变更

dev 分支保护由**两层规则集**承担（设计决策见
[ADR](../adr/2026-11-28-13-30-分支保护两层规则集.md)）：

| 层 | 规则集 | 规则 | 绕过名单 |
|---|---|---|---|
| 基础层 | `protect-dev-base` | 禁删分支、禁强推、必须 PR、必需检查 `quality-gate` | **无**（含指挥者——直推/强推/删分支一律走规则） |
| 审批层 | `protect-dev-approval` | 1 个批准 + 新推送使旧批准失效（dismiss stale） | 仅 `bbhl79`（User 3615225），`bypass_mode=pull_request`（**仅 PR 合入时可绕过审批**） |

事实源：`devenv/rulesets/*.json`（随分支走）。核对命令：`devenv branch-protection`
（匿名只读拉取实时规则集逐字段比对；CI 的 quality-gate 每次运行都执行——
削弱保护会使必需检查变红、PR 无法合入的自锁闭环）。

**App 无 Administration 权限（spec 安全基线，刻意如此）**：规则集的创建/修改/
删除只能由指挥者以管理员身份在 GitHub Web UI 完成；rule-suites（审计面）同理
只有管理员可读。App 与 agent 的一切 GitHub 操作仍走
[GitHub App 认证入口](github-app-auth.md)。

## 首次应用（或重建）

依次在 GitHub → 仓库 → **Settings → Rules → Rulesets → New ruleset** 创建
（字段值 = 对应 JSON 文件；UI 显示名与 API 字段的对应见下表）。顺序：先建
dev 两层 → 再建测试分支 transient 对（仅验收期需要）→ 最后删除旧规则集
`protect-dev` → 检查 Settings → Branches 无 dev 的 classic branch protection
残留（若有则删除——规则集是唯一机制）。

| JSON 字段（`devenv/rulesets/protect-dev-base.json`） | Web UI 位置 |
|---|---|
| `name` / `target: branch` / `enforcement: active` | Ruleset name / Targets: branches / Enforcement: Active |
| `conditions.ref_name.include: ["refs/heads/dev"]` | Target branches: `refs/heads/dev`（不要用 default branch 通配） |
| `{type: deletion}` | Rules → Add rule → **Restrict deletions** |
| `{type: non_fast_forward}` | Rules → **Block force pushes** |
| `{type: pull_request, parameters…count: 0 …}` | Rules → **Require a pull request before merging**（批准数留 0、不勾任何子项、合并方法三种全允许） |
| `{type: required_status_checks, parameters…context: "quality-gate"…}` | Rules → **Require status checks to pass** → 搜索勾选 `quality-gate`（严格「要求分支最新」**不勾** = `strict…: false`） |

审批层 `protect-dev-approval.json` 额外字段：

| JSON 字段 | Web UI 位置 |
|---|---|
| `required_approving_review_count: 1` | Require a pull request before merging → Approvals: 1 |
| `dismiss_stale_reviews_on_push: true` | 同上 → 勾选 **Dismiss stale approvals on new commits**（新推送使旧批准失效） |
| `bypass_actors: [{actor_id: 3615225, actor_type: "User", bypass_mode: "pull_request"}]` | Bypass list → Add bypass → 选 `bbhl79` → 模式选 **Pull requests only**（仅 PR 合入可绕过，不能选 Always） |

测试分支 transient 对（`protect-bp73-test-base` / `protect-bp73-test-approval`）
内容与 dev 两层完全相同，仅 target branches 换成
`refs/heads/test/bp-73-acceptance`；**验收完成后删除这两个规则集**。

应用后核对（App 身份即可）：

```bash
./devenv/devenv branch-protection            # 期望 exit 0：dev 两层与保存配置一致、无额外规则集覆盖 dev
./devenv/devenv test:branch-protection verify-config  # 含 transient 对的 4 规则集全核对 + App 绕过面断言
```

## 受控验收流程（#73 首次执行；此后可在任意分支/PR 复用）

harness：`./devenv/devenv test:branch-protection <阶段>`；证据目录
`.artifacts/73-branch-protection/`（gitignored）。反例直接打真实目标——
**被拒即零写入**，每阶段断言 dev HEAD 不动；有写入风险的正例先在测试分支执行。

1. **`prepare`**（agent）：建 `test/bp-73-acceptance`（自 dev）+ 绿探针
   （空提交，CI 走正常质量门）+ 红探针（workflow 静态门禁故意违规，CI 必红）
   + 两个指向测试分支的探针 PR（App 建）。
2. **指挥者**：按上节在 UI 创建 4 个规则集 + 删旧 `protect-dev`（先建后删，
   无保护空窗）。
3. **`verify-config`**（agent）：4 规则集逐字段核对 + App
   `current_user_can_bypass=never` 断言。
4. **`negatives`**（agent，测试分支靶）：a' App 直推拒 / b' 红探针无批准合入
   拒 / c' 绿探针 `bypass_rules=true` 合入拒（App 无绕过权）。
5. **指挥者（项 d'/e'/f'）**：在绿探针 PR 合并框以**绕过**方式合入（检查绿、
   0 批准——应成功，落在测试分支）；在红探针 PR 尝试绕过合入（**应被拒**，
   检查失败不可绕）；在 Web 编辑器直接编辑 `test/bp-73-acceptance` 上文件提交
   （应被拒）。把实况（按钮形态、拒绝提示原文、成败）记入
   `.artifacts/73-branch-protection/human-actions.md`。
6. **`probe-audit --pr <绿探针PR>` 与 `--pr <红探针PR>`**（agent）：机器面
   （合并者/评审状态/时间线/活动事件/rule-suites 对 App 的可见性）。
7. **交付 PR**（agent 建分支提交本票改动）：**`negatives-dev --pr N`**（App
   直推 dev 拒 + 无批准合入拒 + bypass 尝试拒；dev HEAD 前后不动）。
8. **指挥者（项 f）**：Web 编辑器直接编辑 dev 上文件提交（应被拒）→ 记入
   human-actions.md。
9. **指挥者**：批准交付 PR → **`g --pr N`**（agent 推新提交 → 断言旧批准
   DISMISSED → App 合入被拒）→ **指挥者重新批准** → 正常合入（项 g 完整链）。
   或者：批准后先 `g`，再由指挥者以绕过方式合入（项 d 在 dev 的自然复现）。
10. **指挥者（项 i，管理员读）**：读取 rule-suites 存入
    `.artifacts/73-branch-protection/rule-suites-admin.txt`（浏览器登录态或
    本人令牌，例如
    `curl -s -H 'Accept: application/vnd.github+json' 'https://api.github.com/repos/bbhl79/natural-enforcement-prj/rulesets/rule-suites?rule_suite_result=bypass&time_period=month'`，
    或 Settings → Rules 的 insights 视图截图）；同时核对 UI 上审批层绕过名单
    显示 `bbhl79 / Pull requests only`。**只对实际确认到的字段下结论，不预设
    位置/内容/保留期，不声称能区分冒用**（actor=bbhl79 无法区分真人或冒用，
    已接受残余风险见 github-app-auth.md 安全边界节）。
11. **`cleanup-test`**（agent；前置：指挥者已在 UI 删除两个 transient 规则集，
    否则 deletion 规则阻止删测试分支）：关探针 PR、删探针/测试分支。
12. **`summary`**（agent）：a–i 映射汇总进
    `.artifacts/73-branch-protection/summary.txt`；结论与证据摘录归档 Issue #73。

## 日常与未来变更

- **核对**：`devenv branch-protection` 随 CI（quality-gate）每次运行执行；
  本地随手可跑（匿名只读，零凭据）。
- **改保护配置**（加检查、调批准数、换绕过名单……）：两步锁齐——① 提 PR 修改
  `devenv/rulesets/*.json`（保存配置进版本控制）；② 指挥者在 UI 同步应用同名
  规则集的对应修改。CI 的漂移核对在两步一致前保持红（合入被必需检查挡住），
  一致后转绿。**顺序建议先应用 UI 再等 CI 绿**（或同步进行），避免保护空窗。
- **绕过的日常形态**：只有 `bbhl79` 在 PR 合入时可选择绕过（跳过批准数要求，
  检查仍须绿）；任何直推 dev（含指挥者）恒拒。绕过留审计（rule-suites
  bypass 事件 + PR 无批准即合入的机器特征 + 合并者身份），管理员可查。
