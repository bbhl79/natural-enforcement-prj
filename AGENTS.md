# 项目智能体指令

## 沟通语言

- 所有输出和沟通使用简体中文。专有名词、产品名称、代码标识符和缩写可保留原文。

## 核心原则

- **简化优先**：所有改动尽可能简单，最小化代码影响范围
- **杜绝敷衍**：找到问题根源，不做临时修复，遵循高级开发者标准
- **最小影响**：改动只修改必要部分，避免引入新 Bug

## 追求优雅（适度平衡）

- 处理复杂改动时，停下来思考：是否有更优雅的实现方式？
- 如果当前修复方案感觉很取巧：基于现在掌握的全部信息，改用优雅方案实现
- 简单、显而易见的修复可以跳过这一步，避免过度设计
- 交付前，主动审视、挑战自己的成果

## 子智能体策略

- 灵活使用子智能体，保持主上下文窗口干净
- 将调研、探索、并行分析等工作交由子智能体处理
- 遇到复杂问题，可通过多个子智能体投入更多算力处理
- 一个子智能体只负责一项任务，保证执行专注

## Git 提交

准备提交信息、执行 `git commit` 或给出提交说明时，先读 `.cursor/rules/git-commit.mdc` 并按其格式执行。

## 完成前必须验证

- 未验证可正常工作前，绝不标记任务完成
- 必要时对比主干代码与你的修改，查看行为差异
- 自问：「资深工程师会认可这个方案吗？」
- 运行测试、查看日志，证明方案正确性

## 分支与 worktree

创建、切换、合并、推送分支，或添加、删除、移动 Git worktree 之前，先读 `.cursor/rules/branches.mdc` 并按其授权边界执行。

## Agent skills

### Issue tracker

Issues 和 specs 以 GitHub Issues 形式跟踪，使用 gh CLI。见 `docs/agents/issue-tracker.md`。

### Triage labels

使用五个标准 triage 标签（needs-triage / needs-info / ready-for-agent / ready-for-human / wontfix）。见 `docs/agents/triage-labels.md`。

### Domain docs

Single-context 布局：根目录 `GLOSSARY.md` + `docs/adr/`。见 `docs/agents/domain.md`。
