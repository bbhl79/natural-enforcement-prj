# 领域文档

工程技能探索代码库时如何消费本仓库的领域文档。

## 探索前先读

- 根目录的 **`GLOSSARY.md`**；或
- 根目录的 **`GLOSSARY-MAP.md`**（若存在）：它指向每个 context 的 `GLOSSARY.md`。读取与主题相关的每一个。
- **`docs/adr/`**：阅读涉及即将工作区域的 ADR。多 context 仓库还需检查 `src/<context>/docs/adr/` 下的 context 级决策。

这些文件不存在时**静默继续**。不提示缺失；不建议预先创建。`/domain-modeling` 技能（经 `/grill-with-docs` 与 `/improve-codebase-architecture` 进入）在术语或决策实际落定时才惰性创建它们。

## ADR 命名规则

`docs/adr/` 下文件名格式：`年-月-日-时-分-简体中文描述.md`。

- 时间取 ADR 创建时刻。
- 描述用简体中文，简明表达决策内容。
- 示例：`2026-10-05-16-57-事件溯源订单模型.md`。

## 文件结构

单 context 仓库（绝大多数仓库）：

```
/
├── GLOSSARY.md
├── docs/adr/
│   ├── 2026-10-05-16-57-事件溯源订单模型.md
│   └── 2026-10-05-17-20-写模型改用 Postgres.md
└── src/
```

多 context 仓库（根目录存在 `GLOSSARY-MAP.md`）：

```
/
├── GLOSSARY-MAP.md
├── docs/adr/                          ← 全系统决策
└── src/
    ├── ordering/
    │   ├── GLOSSARY.md
    │   └── docs/adr/                  ← context 级决策
    └── billing/
        ├── GLOSSARY.md
        └── docs/adr/
```

## 使用词汇表的术语

输出中出现领域概念时（issue 标题、重构提案、假设、测试名），使用 `GLOSSARY.md` 定义的术语。不要漂移到词汇表明确规避的同义词。

所需概念尚不在词汇表时，这是一个信号：要么你在发明项目不使用的语言（重新考虑），要么存在真实缺口（记下来，交给 `/domain-modeling`）。

## 标记 ADR 冲突

输出与现有 ADR 矛盾时，显式指出而不是静默覆盖：

> 与 `docs/adr/2026-10-05-16-57-事件溯源订单模型.md` 矛盾，但值得重开，因为……
