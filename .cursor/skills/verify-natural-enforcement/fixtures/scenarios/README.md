# scenarios

| 目录 | 含义 |
| ---- | ---- |
| `runnable/` | 当前产品可执行；Verification Skill 必须能自跑自判 |
| `latent/` | profile 已有事实，产品能力未就绪；**禁止假绿** |
| `../negatives/` | API 负例（同形 JSON，`driver: api`，`kind: negative`） |

场景通过 `profileRefs` 投影 `stages.*.system`，禁止另写第二套叙事。
API 环字段见 `schema.md`；结构化 oracle 见 `../RUN-CONTRACT.md`。
与旧 `journeys/*` 的关系：journeys 保留为人工可读薄封装，逐步改为指向本目录 scenario id。
