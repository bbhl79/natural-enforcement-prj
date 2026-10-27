# 主链路：wayfinder → grilling → to-spec → to-tickets → implement-spec

本仓库用 [mattpocock skills](https://github.com/mattpocock/skills)（见 [AI Hero](https://www.aihero.dev/)）跑需求到实现。技能装在 agent 侧；本文件是**门禁**，防止跳步。

## 顺序（不可跳）

1. **wayfinder**（可选，工作量超过单会话时）
   - 开一张 `wayfinder:map` 地图：Destination／Notes／Decisions so far／Not yet specified／Out of scope。
   - 子票用 `wayfinder:grilling|research|prototype|task`；阻塞用 GitHub native dependencies。
   - 地图只做**索引**：不复述决策正文；细节在子票。操作见 `docs/agents/issue-tracker.md`「Wayfinding operations」。

2. **grilling／grill-with-docs**（对齐）
   - 按设计树问：每轮只问 frontier；每题带推荐答；等答复后再开下一轮。
   - 事实自己查（research），决策留给人（或经授权的狂人代定）。
   - **门禁**：grilling 票 frontier 空，且有「答复到位／以本条为准」记录，才能进下一步。未答完不得因「主干已开工」搁置。
   - `grill-with-docs`＝grilling + domain-modeling，边问边更新 `GLOSSARY.md`／`docs/adr/`。

3. **to-spec**（合成，不再面试）
   - 模板：Problem／Solution／User Stories／Implementation Decisions／Testing Decisions／Out of Scope／Further Notes。
   - 先和人确认测试 seams，再发 Issue。
   - 标签：`ready-for-agent`（见 `docs/agents/triage-labels.md`）。
   - 状态措辞：**阶段稿**＝来源 grilling 未关完或残留未定；**已发布**＝来源 grilling 已关且无未答项冒充收口。禁止用「口径汇总」冒充已发布。

4. **to-tickets**（竖切）
   - tracer bullet：每张票竖切可演示／可验收；写清 Blocked by。
   - **门禁**：先把切法列表给人审（粒度、阻塞边），通过后再 `gh issue create`。禁止批量横着拆环节却不审切法。

5. **implement-spec**（实现）
   - 按任务图 frontier 开工；TDD；合入前 `/code-review` 与 `/pr` 形态。
   - 新能力一律先走 2→3→4，再实现；不跳 grilling／SPEC。

## 与现有工件的对应

| 工件 | 角色 |
|------|------|
| `#11` 等 Map | wayfinder 地图（索引） |
| `#27`／`#40`／`#42` 等 | grilling／决策票 |
| `#207`／`#256` 等 | SPEC（to-spec 产物） |
| `#234`–`#248` 等 | 执行票（to-tickets 产物） |

## 工程主管门禁（摘要）

- grilling 未空 frontier → 不开 to-spec、不开新实现票。
- SPEC 阶段稿／已发布分清；残留未定进「待定点」。
- to-tickets 先审切法再发。
- 已开实现票：未定项相关先停；其余按依赖收口。

## 技能入口

本地／agent：`grilling`、`grill-with-docs`、`to-spec`、`to-tickets`、`implement-spec`、`wayfinder`、`tdd`、`code-review`、`pr`、`research`、`domain-modeling`。不确定用哪个时用 `ask-matt`。
