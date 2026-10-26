# #209 截图（五总入口壳与综合查询）

- 规格：Chrome headless（Windows 侧 Chrome 156.0.8078.47，`--headless=new`），视口宽 1440，整页截图，2026-10-25（UTC+8）。
- 本目录顶层 `<状态键>.png` 是实现截图，文件名取自 #207 协议第 I 节的 62 键全集。本票出其中 5 键。
- 做法：把前端构建产物（`dev build` 的前端产物）用本地静态服务发出去，另用一个只绑回环地址的假接口服务按演示身份返回会话，其余接口返回空集；再用 headless Chrome 逐张出图。假接口只在本机回环上跑，不落真实数据。
- 驱动脚本不入仓，方法以本 README 为准。

## 本票出图（5 键）

| 状态键 | 地址 | 演示身份 | 操作码 | 画面内容 |
| --- | --- | --- | --- | --- |
| `shell-topbar-admin` | `/workbench` | 周敏 SJ0001，广州市规划和自然资源局，系统管理 | `org.tree.read`、`org.unit.register`、`personnel.profile.read`、`personnel.locked.read`、`audit.admin.read` | 顶栏五个一级入口齐全（统一工作台｜线索中心｜案件中心｜统筹督导｜系统管理），「系统管理」在位并高亮；顶栏右侧是综合查询搜索框（人人可用，不占一级） |
| `shell-topbar-noadmin` | `/workbench` | 何静 TH0102，天河区分局，经办 | `clue.read`、`case.read`、`org.tree.read` | 顶栏只有四个一级入口，**「系统管理」不渲染**（无权限者看不到，页面内也不作任何说明）；其余布局与上一张一致 |
| `planned-case` | `/case` | 何静 TH0102，经办 | 同上 | 案件中心二级为「现场核查与立案呈批」「案件查办与审理」，两项都带「规划中」标记；主区显示「现场核查与立案呈批」的规划中占位说明，并列出本级另一个规划中模块的入口 |
| `planned-supervise` | `/supervise` | 何静 TH0102，经办 | 同上 | 统筹督导二级为「执法监督与卷宗评查」，带「规划中」标记；主区显示该模块的规划中占位说明 |
| `planned-admin` | `/admin/roles` | 周敏 SJ0001，系统管理 | 同 `shell-topbar-admin` | 系统管理二级为「管理台首页／机构／人员／被锁人员／管理台留痕」与两个规划中占位（「角色与权限」「参照数据与配置类对象」）；主区显示「角色与权限」的规划中占位说明 |

## 逐张差异与说明

- 五张都不是原型 v0.4 已有画面。#207 协议第 I 节把 `shell-topbar-*` 与 `planned-*` 列为新增的 14 键之一组，原型目录无对照图，差异表记「无原型对照」。
- 顶栏一级五入口的键位与顺序按 #207 导航锁固定；「系统管理」按会话操作码出现，判定口径见 `frontend/src/shell/menu.ts` 的 `ADMIN_HOME_OPCODES`（`org.tree.read` 不算管理码，见 #105:178）。
- 侧栏二级随一级切换，各项都带「规划中」标记表示本期不办理真实业务；「案件查办与审理」等占位不与线索环节混淆。
- 主区 100% 全宽，无常驻右侧调试／走查栏（#207 交互锁）。
- 综合查询在顶栏右侧，任何演示身份可用，不占一级入口；提交后带关键词进入 `/clue`。
- 界面文案无票号样式、无「区块 A–E」类工程符号、无「捞回」。

## 复现步骤

1. 构建前端产物：`./dev build`（产物在容器内，前端构建目录按 dev 脚本约定）。
2. 起本地静态服务（发前端产物，未知路径回落入口页），另起一个只绑回环地址的假接口服务：按演示身份返回 `/api/auth/session`（`result=authenticated` 加 `name`／`code`／`orgName`／`roles`／`opcodes`），其余接口返回空集。身份用 cookie 传递，入口页按 `?as=<身份>` 下发。
3. 用 headless Chrome（视口 1440×900，整页截图）逐个访问上表地址，文件名取状态键。
4. 截图驱动不入仓；方法见本 README 与 `docs/screens/122/README.md`。

## 演示身份与操作码清单

- 周敏 SJ0001（系统管理）：`org.tree.read`、`org.unit.register`、`personnel.profile.read`、`personnel.locked.read`、`audit.admin.read`。
- 何静 TH0102（经办）：`clue.read`、`case.read`、`org.tree.read`。
- 操作码名取自名册 `packages/shield/src/contract/opcode.ts`；本票未引入名册外的码。

## 与全集比对的关系

#207 协议第 I 节的 62 键全集由 #220「全集收尾」统一做文件名集合自动比对与差异表闭环。本票只负责这 5 键出图与其余各票的接口契约，不预判全集比对结论。
