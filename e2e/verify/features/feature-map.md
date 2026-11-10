# Feature Map（初版）

来源：[`frontend/src/router.tsx`](../../../frontend/src/router.tsx) 路由契约 + 页面入口。
未做实机 DOM 探活的条目标 `selectors: TBD`；Agent 首次跑 scenario 时应补强选择器并回写本文件。

## 认证

| id | 名称 | 路径 | 角色 | 选择器策略 | fragile |
| ---- | ---- | ---- | ---- | ---- | ---- |
| `nav.auth.login` | 登录 | `/auth/login` | 未登录 | `getByRole('textbox',{name:'手机号'})`；`input[name=password]`（勿用 getByLabel('密码')：会命中「显示密码」按钮）；`getByRole('button',{name:'登录'})` | false |
| `nav.auth.password` | 强制改密 | `/auth/password` | 首登 | 当前口令/新口令表单 | false |
| `nav.account.password` | 账户改密 | `/account/password` | 已登录 | TBD | true |

## 工作台与线索

| id | 名称 | 路径 | 角色入口 | 关联 scenario | 选择器策略 | fragile |
| ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| `nav.workbench` | 统一工作台 | `/workbench` | 各业务角色 | — | 主导航「工作台」 | false |
| `nav.workbench.register` | R1完整线索登记 | `/workbench/register` | 内勤等有登记权 | `vf-sc-register-*`、`vf-sc-verify-loop-ui-login-register`、`vf-sc-verify-loop-ui-full-register-click-write` | `#clue-source`（线索来源*）；`#clue-domain`（法域*）；`button[type=submit].btn-primary`「保存」；动态要件 `htmlFor=clue-<key>`；确认 `button[data-role=confirm-save]` | true |
| `nav.workbench.verify.step2` | 内业核查续办 | `/workbench?step=2&clue=:id`；可选 `/clue?view=all&clue=:id&tab=verification` | 经办/内勤 | `vf-sc-verify-loop-ui-verify-dispatch`、`vf-sc-verify-loop-ui-full-register-click-write`、`vf-sc-auto-verify-land-success`、`vf-sc-auto-verify-land-partial`、`vf-sc-auto-verify-land-empty-failed`、`vf-sc-auto-verify-land-duplicate`、`vf-sc-auto-verify-mineral-success` | `.card` 含「内业核查」；状态标签「已完成／没跑成／核查进行中／不设内业核查」；图层三态「有相交／无相交／查不成」；相交比例如 `100.0%`、`25.0%`；「下载核查报告」「下载分析图」；失败时「手动重跑」「线索照常可以分派」「缺图层」；错误卡「内业核查没有加载出来」不算通过 | false |
| `nav.workbench.dispatch.step3` | 分派决定续办 | `/workbench?step=3&clue=:id` | 经办/内勤/监督 | `vf-sc-verify-loop-ui-verify-dispatch`、`vf-sc-verify-loop-ui-full-register-click-write` | `[data-role=decide-panel]`、`[data-role=decide-hold]`、`[data-role=decide-dispatch]`、`[data-role=assign-org-panel]`、`[data-role=assign-org]`、`[data-role=assign-people-panel]`、`[data-role=assign-people]`、`[data-role=assign-readonly]`、`[data-role=assigned]`、`#dispatch-org`、`#dispatch-main`；无权限兜底文案「待分派池的线索由本机构内勤派出」／「分派决定由录入人完成」；`UI_CLICK_WRITE=1` 必须在 `pending_decision` 实点 `decide-dispatch`，回读 `in_pool` 且 `mayAssignOrg=true` 后选择 `#dispatch-org` 并实点 `assign-org`，POST 200 与回读 `org_assigned` 才通过；禁用、跳过、HTTP 错误均失败 | true |
| `nav.workbench.dispatch.buttons` | 分派按钮按状态与身份 | 待办链到 `/workbench/register?step=3&clue=:id`（与 `/workbench?step=3&clue=:id` 同一办理页） | 录入人／录入机构内勤／承办机构内勤 | `vf-sc-next-todo-buttons` | 读取是录入机构或已有承办机构的并集。未派机构：承办机构内勤 GET dispatch 403 `scope-denied`，页上「分派办理没有加载出来」。待分派决定：录入人见 `decide-dispatch`「已知晓并派出」与 `decide-hold`「不派」；录入机构内勤见「分派决定由录入人完成」。待派机构：录入机构内勤见 `assign-org`「派出机构」；录入人见「待分派池的线索由本机构内勤派出」。已派到该承办机构：承办机构内勤 200，`mayAssignPeople=true`，见 `assign-people`「派出承办人」与 `assign-org`「重新分派」，不见「分派办理没有加载出来」。录入人见 `assigned`「承办机构」，无「派出承办人」「重新分派」。录入机构内勤见「承办机构」与「重新分派」，无「派出承办人」。`mayDecide` 与派机构写仍在录入侧。派承办人写在承办侧。 | true |
| `nav.clue.center` | 线索中心 | `/clue`；查重页签 `/clue?view=all&clue=:id&tab=duplicate` | 内勤/经办/监督 | `vf-sc-dispatch-*`、`vf-sc-duplicate-*`、`vf-sc-auto-verify-land-success`、`vf-sc-auto-verify-land-duplicate` | 列表行；查重页签「没有疑似重复」或「与 … 疑似重复」加表头「占本线索」 | true |
| `nav.clue.register.legacy` | 旧登记入口 | `/clue/register` → 重定向工作台 | — | — | 勿直接测；应落到 register 壳 | false |

## 案件

| id | 名称 | 路径 | 状态 | 关联 scenario | 选择器 | fragile |
| ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| `nav.case.center` | 案件中心占位 | `/case` | partial（PlannedCenter） | latent 多 | TBD | true |
| `nav.case.investigation` | 调查 | `/case/:caseId/investigation` | implemented 路由 | `vf-sc-latent-investigate` | TBD | true |
| `nav.case.review` | 审理/审核相关 | `/case/:caseId/review` | implemented 路由 | `vf-sc-latent-legal-review` | TBD | true |
| `nav.case.validity` | 效力/决定相关 | `/case/:caseId/validity` | implemented 路由 | `vf-sc-latent-decision` | TBD | true |
| `nav.case.deadline` | 期限 | `/case/:caseId/deadline` | implemented 路由 | — | TBD | true |
| `nav.case.transfer` | 移送 | `/case/:caseId/transfer` | implemented 路由 | — | TBD | true |
| `nav.case.finalize` | 定型/归档 | `/case/:caseId/finalize` | implemented 路由 | `vf-sc-latent-close` | TBD | true |
| `nav.case.conflict` | 案件冲突页 | `/case/:caseId` | implemented | — | TBD | true |

立案呈批链可能嵌在工作台待办或案件流中；实机探索后把精确节点补到 `nav.filing.*`。

## 监督与管理台

| id | 名称 | 路径 | 备注 |
| ---- | ---- | ---- | ---- |
| `nav.supervise` | 监督 | `/supervise` | PlannedCenter 占位多 |
| `nav.admin.home` | 管理台首页 | `/admin` | |
| `nav.admin.org` | 机构树 | `/admin/org-units` | |
| `nav.admin.personnel` | 人员列表 | `/admin/personnel` | |
| `nav.admin.personnel.new` | 新建人员 | `/admin/personnel/new` | |
| `nav.admin.personnel.card` | 人员卡片 | `/admin/personnel/:id` | |
| `nav.admin.locked` | 锁定人员 | `/admin/locked-personnel` | |
| `nav.admin.audit` | 审计 | `/admin/audit` | |
| `nav.admin.roles` | 角色（占位） | `/admin/roles` | PlannedCenter |
| `nav.admin.reference` | 参照数据（占位） | `/admin/reference` | PlannedCenter |

## 快捷键

初版未从代码提取全局快捷键；发现后记入本表「快捷键」列。

## 维护

见 [`maintenance.md`](maintenance.md)。

## UI 探活

- 登录与登记壳：`harness/ui/run-ui-p0.sh`；场景 `vf-sc-verify-loop-ui-login-register`（driver=`ui`）。
- 核查／分派续办：`harness/ui/run-ui-verify-dispatch.sh`；场景 `vf-sc-verify-loop-ui-verify-dispatch`（driver=`ui`）。
  - `CLUE_ID=<id>` 时打开 `/workbench?step=2&clue=` 与 `/workbench?step=3&clue=`，字段级断言 verificationStatus 标签／自动核查文案／data-role／`#dispatch-org`／`#dispatch-main`；并观察 `/workbench` 待办 decide／pool／rerun（E）。
  - `UI_CLICK_WRITE=0` 且不传 `CLUE_ID` 时只验登录；点击写不传 id 即失败；`EXPECT_STATUS=pending_decision|in_pool|org_assigned|handler_assigned` 可收紧面板断言。
  - 证据落 `e2e/results/verify-*`（PNG／webm／trace）；默认 headless，`HEADED=1` 切 headed。
- 全量登记与点击写：`harness/ui/run-ui-full-loop.sh`，场景 `vf-sc-verify-loop-ui-full-register-click-write`。
  - 复用 `intake-hq`，以总队内勤身份登记本人总队线索，不给支队线索额外权限，不新增产品种子账号。
  - 两次 UI 登记同一矿产面。公共项、来源全部可见项、违法类型全部项、附件、标签、两项是非选择均填。未知字段或空控件使旅程失败。
  - 两次保存要求 HTTP 201、零缺件、持久化回读成功。第二条须命中本轮 peer 并处于 `pending_decision`。
  - 正式重复命中使主状态进入 `pending_decision`。土地和矿产均自动核查；本机缺图层时核查会 failed，但本旅程仍须回读到 `pending_decision` 后才能点决定。
  - step2 观察核查状态，不宣称核查成功。step3 实点“已知晓并派出”后实点“派出机构”，派至第一执法支队。
  - 本入口禁止 headed。证据分为 `e2e/results/verify-<run>-register` 与 `e2e/results/verify-<run>-dispatch`。派承办人不在本旅程范围。
- 承办机构内勤派承办人：`harness/ui/run-ui-assign-people.sh`。甲所内勤打开 `/workbench?step=3&clue=`，点 `[data-role=assign-people]`「派出承办人」，回读 `handler_assigned`。查重命中控件在决定步 `[data-role=hit-groups]`；辖区建议在派机构面板 `[data-role=suggestion]` 或 `[data-role=suggestion-empty]`。证据用 `cp` 落到 `e2e/results/verify-assign-people-*`。
- 下一待办按钮：`harness/run-next-todo-buttons.sh`；场景 `vf-sc-next-todo-buttons`。API 核 `mayDecide`／`mayAssignOrg`／`mayAssignPeople`／`mayReassignOrg`。页面只读，不点写。已派到承办机构后，甲所内勤可见「派出承办人」。
- 选择器以上表为准；失败先改本地图再改断言。

- 本机完整附件旅程入口为 `harness/ui/run-ui-full-loop-local.sh`。它临时补验证专属存储运行参数并初始化 `ne-verify-ui` 桶，退出恢复原编排。
- 已发现同名标签复用触发 `clue_tag_library_fkey` 的产品缺陷。本票不修。成功旅程每条使用唯一合成标签，标签复用不属于已通过覆盖。
