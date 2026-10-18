# #134 截图对照与全集收口判定（管理台 P3 上线首日三步引导）

- 规格：Chrome headless（zenika/alpine-chrome 124），经远程调试（CDP）驱动，视口宽 1440，整页截图，2026-10-19（UTC+8）。
- 本目录 `<状态>.png` 是实现截图；`compare/<状态>.png` 是对照图，左边为原型 v0.4（`frontend/prototype/admin-console/screens/`），右边为实现，缩到一半大小。
- 做法：模拟接口按状态返回会话（周敏 SJ0001、广州市规划和自然资源局、系统管理；操作码取实现名册写法）、只有一个根机构的机构树、只有一名人员的名单（执法证未登记）、空被锁人员、今日留痕 2 条，驱动 `dev build` 构建后的前端产物截图；驱动脚本是无依赖的 Node CDP 客户端（不入仓，方法以本 README 为准）。
- 本票出 1 张：P3-firstday（上线首日三步引导）。其余 77 个状态键由 #122–#133 各票出图，全集判定见下节。

## 逐张差异（本票）

| 状态 | 差异 | 原因 |
| --- | --- | --- |
| P3-firstday | 实现没有顶部「样板状态」演示条 | 演示条只用于原型切换状态，不进正式界面（各票同口径） |
| P3-firstday | 管理台留痕 tile 计数文案为「今日 2 条」，原型 firstday 态为「2 条」 | 实现把留痕 tile 统一带「今日 N 条」前缀（原型 admin 态即「今日 46 条」）；登记清理票 #151，原型下次修订时统一 |
| P3-firstday | 壳层观感（主区浅灰底、顶栏与左导形态）随实现壳 | 继承 #122 壳层验收口径，与各票对照图同口径 |
| P3-firstday | 三步引导横幅文案、四个 tile 的标题与说明句、面包屑与页头说明与原型逐字一致 | 无差异 |

## 全集判定（#105「截图验收（loop ⑥c）」收口）

- 口径：`docs/screens/<票>/` 顶层 `*.png` 的文件名并集，与原型 v0.4 状态键（`frontend/prototype/admin-console/screens/*.png`，除改动总览 `overview.png`）完全相等。自动判定只比文件名集合，由结构测试规则 `screenshot-full-set`（`tools/structural-test.sh`）承载，进 `dev lint` 与 CI。画面是否与 v0.4 一致由前端交互设计工程师逐图自查（各票 README 的逐张差异与 PR 允许差异表），Lei Hu 在 gate② 签收。
- 结论：并集 78 个文件名与 78 个状态键完全相等。11 个目录顶层 png 共 82 张，其中 4 个键被后续票重截（P3-admin、P5-district、P6-view、P7-resetConfirm），以较新票的图为准；`compare/`、`extra/` 子目录是对照图与单测验收图（口令到期横幅 P1-expiry、根机构守卫 P6-editRootGuard），不进全集。
- 画面时点：129 的 P6-edit、P6-transfer、P6-selfEdit，130 的六键，133 的 P6-certEdit、P6-certNone、P6-certExpiring、P6-certExpired 共 13 张卡片态图，2026-10-19 由本票按终版代码在原目录重截（PR #156 复核阻塞项：旧图早于危险操作区终版），文件名与逐目录计数不变，以重截后的图为准；差异登记见各票 README。

| 目录 | 票 | 顶层 png 数 | 状态键范围 |
| --- | --- | --- | --- |
| 122 | #122 应用壳、403/404、强制改密 | 15 | P1 六键、P2 四键、P3 的 admin/supervise/loading/error/denied |
| 123 | #123 机构树查看与新建改名 | 8 | P4 的 collapsed/create/denied/error/expanded/loading/onlyroot/rename |
| 124 | #124 机构停用 | 2 | P4-blocked、P4-confirm |
| 126 | #126 留痕查阅与导出 | 11 | P8 十一键（admin/denied/empty/error/exportConfirm/exportDone/loading/login/noanchor/supervise/view） |
| 127 | #127 被锁人员解锁与重设 | 13 | P7 除 resetDenied-reused 外十三键 |
| 128 | #128 人员名单与卡片 | 12 | P5 六键、P6 的 create/createInvalid/denied/error/loading/view |
| 129 | #129 人员编辑与调岗 | 3 | P6-edit、P6-selfEdit、P6-transfer |
| 130 | #130 停用恢复与会话结束 | 6 | P6 的 view/deactivate/restore/restoreNewOrg/endsessions/self |
| 132 | #132 口令历史 | 5 | P2-forcedReused、P6-resetpw、P6-resetpwReused、P7-resetConfirm（重截）、P7-resetDenied-reused |
| 133 | #133 执法证登记 | 6 | P3-admin（重截）、P5-district（重截）、P6 的 certEdit/certExpired/certExpiring/certNone |
| 134 | #134 首日收口 | 1 | P3-firstday |
