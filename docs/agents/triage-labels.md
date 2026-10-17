# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the right-hand column to match whatever vocabulary you actually use.

## 本仓库口径

出处：Lei Hu 2026-10-17 22:41。

- 每张票至多打一个状态标签。状态标签指上表五个标签。
- 分类标签只用 `bug`、`enhancement`。
- 自定义标签 `deferred` 标记二期及以后的票。打 `deferred` 的票保持打开。
- `wayfinder:map`、`wayfinder:research`、`wayfinder:prototype`、`wayfinder:grilling`、`wayfinder:task` 五个标签另见 `issue-tracker.md`。
- 代理不得自建上述以外的标签。
- spec 写好后，代理先给 spec 打 `needs-triage`。
- spec 过 gate①（Lei Hu 审过 spec）并拆票后，代理摘掉 spec 上的状态标签。
- 代理只给子票打 `ready-for-agent`。
