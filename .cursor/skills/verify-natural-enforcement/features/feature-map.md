# Feature Map（初版）

来源：[`frontend/src/router.tsx`](../../../../frontend/src/router.tsx) 路由契约 + 页面入口。
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
| `nav.workbench.register` | 线索登记壳 | `/workbench/register` | 内勤等有登记权 | `vf-sc-register-*`、`vf-sc-verify-loop-ui-login-register` | `#clue-source`（线索来源*）；`#clue-domain`（法域*）；`button[type=submit].btn-primary`「保存」；动态要件 `htmlFor=clue-<key>`；确认 `button[data-role=confirm-save]` | true |
| `nav.workbench.verify.step2` | 内业核查续办 | `/workbench?step=2&clue=:id`；可选 `/clue?tab=verification&clue=:id` | 经办/内勤 | `vf-sc-verify-loop-ui-verify-dispatch` | `.card` 含「内业核查」；状态标签「已完成／没跑成／核查进行中／不设内业核查」；错误卡「内业核查没有加载出来」不算通过 | false |
| `nav.workbench.dispatch.step3` | 分派决定续办 | `/workbench?step=3&clue=:id` | 经办/内勤/监督 | `vf-sc-verify-loop-ui-verify-dispatch` | `[data-role=decide-panel]`、`[data-role=decide-hold]`、`[data-role=decide-dispatch]`、`[data-role=assign-org-panel]`、`[data-role=assign-org]`、`[data-role=assign-people-panel]`、`[data-role=assign-people]`、`[data-role=assign-readonly]`、`[data-role=assigned]`、`#dispatch-org`、`#dispatch-main`；无权限兜底文案「待分派池的线索由本机构内勤派出」／「分派决定由录入人完成」；`UI_CLICK_WRITE` 尽量点 decide-dispatch／assign-org／assign-people（禁用则记 skipped） | true |
| `nav.clue.center` | 线索中心 | `/clue` | 内勤/经办/监督 | `vf-sc-dispatch-*`、`vf-sc-duplicate-*` | 列表行、分派/决定操作 | true |
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
  - 不传 `CLUE_ID` 只验登录；`EXPECT_STATUS=pending_decision|in_pool|org_assigned|handler_assigned` 可收紧面板断言。
  - 证据落 `.run/verify-*`（PNG／webm／trace）；默认 headless，`HEADED=1` 切 headed。
- 缩范围：UI 全量登记提交尚未跑；线索由 API 造数后经 `CLUE_ID` 带入。
- 选择器以上表为准；失败先改本地图再改断言。
