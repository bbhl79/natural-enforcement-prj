# negatives（API 负例 scenarios）

与 `scenarios/runnable` 同形 JSON：`status: runnable`、`driver: api`、`kind: negative`。
结构化 `oracle.assert` 见 `../RUN-CONTRACT.md`。

| id | 打穿点 |
| ---- | ---- |
| `vf-sc-neg-missing-narrative` | 缺 `clue.narrative` → 400 |
| `vf-sc-neg-supervisor-register` | `super-b` → 403 |
| `vf-sc-neg-land-point-geometry` | land + Point → 400 geometry |
| `vf-sc-neg-type-unconfirmed` | 01 types + `confirm: false` → 400 |
| `vf-sc-neg-idempotency-conflict` | 同 key 异报文 → 409 |

旧 `*/input.json.example` 等人工壳保留；新环以本目录 JSON 为准。
