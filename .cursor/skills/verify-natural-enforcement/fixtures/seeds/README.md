# 验证播种

本目录只放验证库夹具。
产品种子 `backend/prisma/seed.mjs` 不读本目录。

## 超长期终态历史 peer

`vf-hist-ancient-peer.json` 描述一条 `transferred_out` peer。
`disposition.recorded_at` 与 `registered_at` 都是 `2019-01-01T00:00:00.000Z`。
图斑在东经 112.01、北纬 22.01 一带。
该图斑不与广州示意带相交。
该图斑不与 `VERIFY_SPATIAL_SALT` 的盐移带相交。

播种入口：

```bash
.cursor/skills/verify-natural-enforcement/harness/seed-ancient-historical-peer.sh
```

探测入口（含 `./dev up` 与播种）：

```bash
.cursor/skills/verify-natural-enforcement/harness/run-hist-dup-no-lookback.sh
```

播种只插入。
同幂等键的行已存在时，播种不改写时间戳。
同键行不满足夹具时，播种失败并停下。
干净重建使用 `./dev db reset`，然后再跑探测入口。

只检查夹具文本、不连库：

```bash
.cursor/skills/verify-natural-enforcement/harness/seed-ancient-historical-peer.sh --check
```
