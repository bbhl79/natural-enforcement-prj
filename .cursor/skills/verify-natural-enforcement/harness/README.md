# API Verification harness

读 `fixtures/scenarios` / `fixtures/negatives` → 投影 case-profile `system` → 登录 → `POST /api/clues` → 评结构化 oracle → 写 `.run/verify-<runId>/`。

入口：容器内 `./dev test integration`（`integration/verify-skill-loop.test.ts`）。
禁止在宿主机 `pnpm install`。

本轮必绿：`vf-sc-verify-loop-survey-register`（01）、`vf-sc-verify-loop-land-register`（02）、
`vf-sc-neg-type-unconfirmed`（01）、`vf-sc-neg-missing-narrative`（02）。
