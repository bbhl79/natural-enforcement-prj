# #123 截图对照（管理台 P4 机构树）

- 规格：Chrome headless，视口宽 1440，整页截图，2026-10-18（UTC+8）。
- 本目录 `<状态>.png` 是实现截图；`compare/<状态>.png` 是对照图，左边为原型 v0.4（`frontend/prototype/admin-console/screens/`），右边为实现，缩到一半大小。
- 做法：用模拟接口按状态返回会话和机构树，驱动构建后的前端产物截图；新建、改名、折叠由脚本点击页面得到。机构与人员沿用原型 P4 的数据；操作码用名册里的真实码。
- 2026-10-18 02:33（UTC+8）按 PR #142 界面验收（issuecomment-6238407313）重截全部 8 张及对照图：
  - 会话操作码改由「名册 `packages/shield/src/contract/opcode.ts` + 参照种子允许行 `backend/prisma/seed.mjs`」推出，口径同 `listPermittedOpcodes` 和 `docs/screens/122/README.md`，不含未入名册的码。所以左导不再有「人员」（`personnel.profile.read` 由 #128 入名册）；P4-denied 里监督按 #71 允许行持有 `clue.read`，左导多出「线索」（原型滞后，以 #71 为准）。
  - 已合入 #122 的无权限页修正：P4-denied 左导不高亮任何项。
  - P4-create、P4-rename 打开弹窗时焦点在名称输入框（Copilot 意见 4 的焦点管理），输入框显示浏览器的焦点框。
- 停用相关的 `P4-blocked`、`P4-confirm` 留给停用票（#124），本目录不出。
- 逐张差异说明见本票 PR「截图对照」一节。
