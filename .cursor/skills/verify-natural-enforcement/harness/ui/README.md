# UI harness（Verification 环 · 浏览器）

- **默认 headless**；`HEADED=1` / `PW_HEADED=1` / `--headed` 切 headed（WSLg：`DISPLAY=:0`）。
- 跑在 **Docker Playwright 镜像**（定案见 `infra/VERSIONS.md`），宿主不装 `@playwright`。
- 证据：`.run/verify-<id>/`（summary / steps / evidence PNG+trace+video）。

## P0：登录与登记壳

```bash
./.cursor/skills/verify-natural-enforcement/harness/ui/run-ui-p0.sh
UI_FILL=1 ./.cursor/skills/verify-natural-enforcement/harness/ui/run-ui-p0.sh
```

## 自动核查四条夹具

由 `harness/run-auto-verification.sh` 调用 `run-ui-auto-verification.sh`。只 headless。证据落在当次 `.run/verify-*/ui/`。不要传 `HEADED=1`。

## 核查／分派续办（step2／step3）

```bash
CLUE_ID=<clue-id> ./.cursor/skills/verify-natural-enforcement/harness/ui/run-ui-verify-dispatch.sh
CLUE_ID=<clue-id> EXPECT_STATUS=in_pool ./.cursor/skills/verify-natural-enforcement/harness/ui/run-ui-verify-dispatch.sh
```

- `CLUE_ID` 缺省时只验登录，并记 `clue-context=skipped`。
- step2 断言「内业核查」卡片与状态标签；step3 断言 `data-role` 面板或无权限兜底文案。
- 缩范围：UI 全量登记提交尚未跑；线索由 API 造数后带入。

- step2 字段级：`verificationStatusLabel`（已完成／没跑成／…）与自动核查文案。
- step3 字段级：`data-role=decide-*|assign-*`、`#dispatch-org`、`#dispatch-main`。
- 点击写：默认 `UI_CLICK_WRITE=1` 尽量点 decide-dispatch／assign-org／assign-people；禁用记 skipped 不算红；`UI_CLICK_WRITE=0` 只读。
- E 待办：同跑次打开 `/workbench` 观察「待分派决定／待派机构／重跑核查」文案（空清单不判红）。

## 下一待办按钮（状态 × 身份）

```bash
.cursor/skills/verify-natural-enforcement/harness/run-next-todo-buttons.sh
```

只读核对已有按钮。不点写。甲所内勤 `GET /api/clues/:id/dispatch` 403 是修前基线。工作台清单只做观察，不另写过滤规则。没有 rsync 时，脚本用 cp 把阶段目录里的截图、trace 拷进 `.run`。
