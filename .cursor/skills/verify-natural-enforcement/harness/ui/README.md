# UI P0 harness（Verification 环 · 浏览器）

- **默认 headless**；`HEADED=1` / `PW_HEADED=1` / `--headed` 切 headed（WSLg：`DISPLAY=:0`）。
- 跑在 **Docker Playwright 镜像**（定案见 `infra/VERSIONS.md`），宿主不装 `@playwright`。
- 本轮缩子集：登录字段 → `/workbench/register` 来源／法域／保存控件；全链「录入→核查→分派」另票。
- 证据：`.run/verify-<id>/`（summary / steps / evidence PNG+trace+video）。

```bash
./.cursor/skills/verify-natural-enforcement/harness/ui/run-ui-p0.sh
UI_FILL=1 ./.cursor/skills/verify-natural-enforcement/harness/ui/run-ui-p0.sh
```
