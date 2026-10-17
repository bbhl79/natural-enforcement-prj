# #126 管理台留痕（P8）截图

- 对照原型：frontend/prototype/admin-console/P8-admin-audit.html（v0.4），原型截图在 frontend/prototype/admin-console/screens/P8-*.png。
- 本目录 `P8-<状态>.png` 是实现截图；`compare/P8-<状态>.png` 左边是原型，右边是实现。
- 11 个状态键与原型一致：admin、login、view、supervise、noanchor、exportConfirm、exportDone、empty、loading、error、denied。
- 截法：
  - 前端 `vite build` 的产物由 box 上的模拟服务托管（工具不入仓，做法同 docs/screens/122）。
  - 会话操作码由仓库名册和参照种子推出（系统管理、监督、经办），不手写。
  - 留痕接口按状态返回原型里的同一批行（R / LG / VW / NA）。动作名和「对象」列按本票服务端 audit-labels.ts 的实际输出。
  - 浏览器 1440×900 整页截图。exportConfirm 点「导出」后截；exportDone 再点「确认导出」后截。导出时浏览器实际下载到的文件名是「管理台留痕_20261016-20261017.xlsx」。

## 允许的差异

| 状态 | 差异 | 原因 |
| --- | --- | --- |
| 全部 | 实现没有顶部「样板状态」演示条 | 演示条只用于原型切换状态（#122 已约定不进正式界面） |
| 系统管理各态 | 左侧菜单只有「管理台首页 / 被锁人员 / 管理台留痕」 | 菜单按真实会话清单裁剪（#122）；机构、人员的码由 #123、#128 授予后才出现 |
| admin、login、view、noanchor、exportConfirm、exportDone | 「共 N 条」写的是实际行数，没有「第 1 页」 | 本票一次列出所选时间内的全部行，不分页（PR「工程决定」）；原型的 73、75 是示意数字 |
| admin、exportConfirm、exportDone | 列表里有「无所属机构」的行时，表格上方同时出「标有『无所属机构』的记录……」说明 | 原型只在 noanchor 态放这条说明；实现只要列表里有这类行就给说明，免得看到标记不知含义 |
| exportConfirm | 「条数」是当前列表的行数（截图里 12 条） | 原型示意 46 条 |
| exportDone | 完成横幅里的条数取服务端实际导出的条数（响应头 X-Item-Count） | 导出时取数与写留痕同一事务，条数以服务端为准 |
| noanchor | 「建立首个系统管理人员」一行的所属机构显示根机构名称，不加「（根机构）」 | 所属机构列一律显示机构名称 |
| 筛选条 | 「结果」下拉有「全部 / 成功 / 失败或被拒绝」三项 | 原型只画了「结果：全部」，没有列出选项 |
