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
UI_CLICK_WRITE=0 CLUE_ID=<clue-id> EXPECT_STATUS=in_pool ./.cursor/skills/verify-natural-enforcement/harness/ui/run-ui-verify-dispatch.sh
```

- `UI_CLICK_WRITE=0` 且 `CLUE_ID` 缺省时只验登录。点击写缺少 `CLUE_ID` 即失败。
- step2 断言「内业核查」卡片与状态标签；step3 断言 `data-role` 面板或无权限兜底文案。
- 完整登记入口见下节。独立续办入口需要传入真实线索id。

- step2 字段级：`verificationStatusLabel`（已完成／没跑成／…）与自动核查文案。
- step3 字段级：`data-role=decide-*|assign-*`、`#dispatch-org`、`#dispatch-main`。
- 点击写：默认 `UI_CLICK_WRITE=1` 必须顺序实点 decide-dispatch 和 assign-org。缺权限、禁用或跳过均判红。`UI_CLICK_WRITE=0` 只读。
- E 待办：同跑次打开 `/workbench` 观察「待分派决定／待派机构／重跑核查」文案（空清单不判红）。

## R1全量登记与决定后派机构

运行 `bash .cursor/skills/verify-natural-enforcement/harness/ui/run-ui-full-loop.sh`。
本入口只跑headless。
它复用总队内勤 `intake-hq`，无需补live种子账号。
夹具位于 `fixtures/journeys/register-full-click-write/input.json`。
它用两次UI登记的重合矿产面产生正式重复命中。
第二条必须进入 `pending_decision`。
它填写每个渲染字段并上传GeoJSON与合成PNG。
新增字段无夹具值、空控件、非201、缺件或回读不符均失败。
分派阶段必须实际点击 `decide-dispatch` 与 `assign-org`。
禁用、无权限、请求失败或状态未写入均失败。
`UI_CLICK_WRITE=0` 仅表示只读探活。
本轮没有覆盖派承办人，也没有把本机缺图层导致的核查失败算成自动核查通过。
证据含字段取值、HTTP响应、clueId、状态回读、PNG、webm与trace。

## 本机附件存储前提

默认产品编排没有给server注入RustFS端点。
默认端口回落至server自身的127.0.0.1:9000，上传会失败。
本旅程需要真实上传附件，不能跳过该故障并报绿。
运行 `bash .cursor/skills/verify-natural-enforcement/harness/ui/run-ui-full-loop-local.sh`。
这个验证包装器使用 `fixtures/local-ui-storage.yml` 临时补存储环境。
它只允许本机默认compose项目和容器服务名。
它创建专属 `ne-verify-ui` 桶，并启用版本控制及对象锁配置。
它退出时运行 `./dev up` 恢复原编排。
它不改产品compose、权限、角色或e3驱动。

## 已发现但本票不修的产品问题

同名标签复用时，`PrismaClueStore.insertTags` 给线索标签使用了新生成的libraryId。
第二次登记因此触发 `clue_tag_library_fkey` 并返回500。
本验证夹具给每条线索生成唯一合成标签，仍填写标签并回读核对。
这条成功旅程不代表同名标签复用已经通过。
失败HTTP、trace和仅验证启动的错误日志保留在 `.run/verify-*`。

本机另一次原样重跑出现认证会话并发错误：`auth_session` 的 `last_seen_at` 倒退保护触发500。
该次页面未加载的截图、trace与服务日志保留，不能写成通过。
本票不改认证会话守卫，也不加自动重试掩盖该失败。

## 承办机构内勤派出承办人

```bash
./.cursor/skills/verify-natural-enforcement/harness/ui/run-ui-assign-people.sh
```

甲所内勤登录后打开 `/workbench?step=3&clue=`，点击现有「派出承办人」。证据在 `.run/verify-assign-people-*`，脚本用 `cp` 再复制到 `artifacts/`。
