# #122 截图对照（管理台 P1–P3）

- 规格：Chrome 155 headless，视口宽 1440，整页截图，2026-10-18（UTC+8）。
- 本目录 `<状态>.png` 是实现截图；`compare/<状态>.png` 是对照图，左边为原型 v0.4（`frontend/prototype/admin-console/screens/`），右边为实现，缩到一半大小。
- 做法：用模拟接口按状态返回会话和接口结果，驱动构建后的前端产物截图。人物沿用原型 `assets/shell.js` 里的人员（姓名、工号、机构、角色）。
- 操作码：每个人物的会话清单按「名册 `packages/shield/src/contract/opcode.ts` + 参照种子允许行 `backend/prisma/seed.mjs`」推出，口径同 `listPermittedOpcodes`（名册顺序、只含名册里的码、改变主状态的码不计监督）。**不含任何未入名册的码**。
  - 所以「机构」（要 `org.unit.register`，#123 入名册）、「人员」（要 `personnel.profile.read`，#128 入名册）两个菜单项和入口卡在 P1-multi、P2-forbidden、P3-admin、P3-loading、P3-error 里都没有出现；这是当前名册下的真实画面，差异逐条列在 PR #140「截图对照」。
  - 监督按 #71 允许行持有 `clue.read`，所以 P3-supervise 左导比原型多「线索」一项。
- 2026-10-18 按 PR #140 前端验收意见重截：P1-multi、P1-single、P1-noadmin、P2-forbidden、P3-admin、P3-error、P3-loading、P3-supervise 和 `extra/P1-expiry.png` 换新（「我的待办」照原型恢复、操作码改用真实清单）。其余 7 张用同一提交的产物重截后与原图逐像素一致，未替换。
- 2026-10-18 02:24（UTC+8）按 PR #140 界面验收更正（无权限页左导不高亮任何项）重截：只有 `P2-forbidden` 变化（左导「管理台首页」不再高亮），换新并重做对照图；其余 15 张用同一提交的产物重截后与原图逐像素一致，未替换。
- `extra/P1-expiry.png` 是口令到期横幅（原型没有单独状态），没有对照图。它不在 v0.4 的 78 个状态键里，**不计入 #134 的截图全集核对**；横幅按 #105「截图验收」以单测验收。本目录根下只放 78 个状态键里的文件。
- 逐张差异说明见 PR #140「截图对照」一节。
