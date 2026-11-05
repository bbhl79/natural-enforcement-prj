# case-profile 字段说明

## 角色

| 角色 | 含义 |
| ---- | ---- |
| `canonical` | 种子终局成功样板（对照飞书卷宗，脱敏广州化） |
| `variant` | 从 canonical 派生：改一条规程主分支，并补齐呈批/会办过程 |

派生必须可追溯：`derivedFrom` + `procedureRef`（规程章节）+ `branch`（短码）。

## 对象形状（摘要）

```json
{
  "id": "vf-case-02-occupy-without-approval.suspend-resume",
  "role": "variant",
  "derivedFrom": "vf-case-02-occupy-without-approval",
  "branch": "suspend-resume",
  "procedureRef": ["规程 3.4 调查中止"],
  "title": "vf-非法占地（中止后恢复）",
  "quality": "A",
  "domain": "land",
  "sourceCode": "16",
  "types": ["land_occupy_without_approval"],
  "party": { "kind": "person", "displayName": "vf-当事人甲", "subjectUnknown": false },
  "spatial": { "kind": "face", "geojson": {}, "addressNarrative": "…" },
  "orgBinding": { "enteredOrgCode": "ORG-DEPT-A", "handlingOrgCode": "ORG-STATION-A" },
  "timeline": [
    { "at": "2026-10-20", "stage": "register", "summary": "…" }
  ],
  "processEvents": [
    {
      "id": "pe-filing-1",
      "kind": "filing-approval",
      "doc": "立案（不予立案）呈批表",
      "stage": "filing",
      "procedureRef": "规程 2.6",
      "chain": [
        { "role": "经办", "actorRef": "clerk-a", "opinion": "建议立案", "at": "2026-10-21" },
        { "role": "行政审核", "actorRef": "review-a", "opinion": "拟同意", "at": "2026-10-21" },
        { "role": "行政审批", "actorRef": "approve-hq", "opinion": "同意立案", "at": "2026-10-21" }
      ],
      "consultations": [
        { "dept": "vf-业务会办科", "actorRef": null, "opinion": "对定性无异议", "at": "2026-10-21" }
      ],
      "outcome": "approved"
    }
  ],
  "stages": {
    "register": { "status": "populated", "system": {} },
    "investigate": {
      "status": "populated",
      "suspend": {
        "reason": "当事人材料无法调取",
        "from": "2026-11-01",
        "to": "2026-11-15",
        "resumeNote": "材料到齐，恢复调查"
      }
    }
  },
  "notes": "…"
}
```

## processEvents

呈批、会办、审理、法审、集体讨论、听证相关过程的一等数据。按时间顺序排列。

| 字段 | 说明 |
| ---- | ---- |
| `kind` | `filing-approval` / `stop-order-approval` / `suspend-approval` / `terminate-approval` / `decision-approval` / `penalty-approval` / `close-approval` / `transfer-approval` / `legal-review` / `case-hearing-panel` / `collective-discussion` / `hearing` / `consultation-only` |
| `doc` | 文书名称（脱敏） |
| `stage` | 挂靠的程序阶段键 |
| `chain` | 呈批链意见：经办 → 会办/审核 → 审批 |
| `consultations` | 会办科室意见（可空） |
| `outcome` | `approved` / `rejected` / `returned` / `adjusted` / `waived` / `applied` / `not-applied` |
| `actorRef` | 对应 `fixtures/identities/` 的 id；无身份夹具时用 `null` 并写显示名于 `opinion` 旁注 |

回流链：同 `kind` 可出现多次（如法审 `returned` 后再一次 `approved`），用不同 `id`。

## hardFields

可打穿产品契约的硬点清单（01/02 canonical 必填；variant 可继承或覆写）。
与 `stages.register.system` 对照：能提交的写入 `system.values`；产品未暴露的标 `latent: true`，禁止编造 API 字段。

```json
"hardFields": [
  {
    "key": "clue.narrative",
    "layer": "common",
    "consequence": "block",
    "punch": "缺则登记 400，rules 含 clue.narrative，零写入"
  }
]
```

| 字段 | 说明 |
| ---- | ---- |
| `key` | 表单项键、规则码或条件短码（如 `confirm`、`spatial.geometry`） |
| `layer` | `common` / `source` / `type` / `spatial` / `auth` / `idempotency` / `filing` |
| `consequence` | `block`（400/403/409）/ `warn`（不拦登记）/ `branch`（状态分支） |
| `punch` | 期望打穿表现（人读；机器断言写在 scenario `oracle.assert`） |
| `latent` | 可选；`true` 表示产品尚未暴露可提交字段 |

## stages

保留原槽位键。`status`：`populated` | `thin` | `absent`。
特殊情形写入槽内对象（如 `suspend`、`termination`、`hearingRequest`），勿只写一句 summary。

`system`：供 runnable 投影；产品未实现的字段不要假装可提交。
`system.values` 只放登记可提交键；类型层核查前补齐键可写测试值或在 `hardFields` 标 `latent`。

## 命名

- canonical：`vf-case-NN-<slug>`
- variant：`vf-case-NN-<slug>.<branch>`
- 业务可见字符串仍用 `vf-` 前缀

## 发散边界

1. 锁定种子的法域、来源大类、主体形态、基础叙事、几何族。
2. 每个 variant 只改一条主分支（可附带必要呈批回流）。
3. 呈批/会办过程必须写全链，禁止终态一句「同意」。
4. 对照《自然资源违法行为立案查处工作规程（试行）》章节号写入 `procedureRef`。
