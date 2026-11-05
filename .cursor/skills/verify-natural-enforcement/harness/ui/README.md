# UI harness（Verification 环 · 浏览器）

- **默认 headless**；`HEADED=1` / `PW_HEADED=1` / `--headed` 切 headed（WSLg：`DISPLAY=:0`）。
- 跑在 **Docker Playwright 镜像**（定案见 `infra/VERSIONS.md`），宿主不装 `@playwright`。
- 证据：`.run/verify-<id>/`（summary / steps / evidence PNG+trace+video）。

## P0：登录与登记壳

```bash
./.cursor/skills/verify-natural-enforcement/harness/ui/run-ui-p0.sh
UI_FILL=1 ./.cursor/skills/verify-natural-enforcement/harness/ui/run-ui-p0.sh
```

## 核查／分派续办（step2／step3）

```bash
CLUE_ID=<clue-id> ./.cursor/skills/verify-natural-enforcement/harness/ui/run-ui-verify-dispatch.sh
CLUE_ID=<clue-id> EXPECT_STATUS=in_pool ./.cursor/skills/verify-natural-enforcement/harness/ui/run-ui-verify-dispatch.sh
```

- `CLUE_ID` 缺省时只验登录，并记 `clue-context=skipped`。
- step2 断言「内业核查」卡片与状态标签；step3 断言 `data-role` 面板或无权限兜底文案。
- 缩范围：UI 全量登记提交尚未跑；线索由 API 造数后带入。
