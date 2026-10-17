# #127 截图对照（管理台 P7 被锁人员）

- 规格：Chrome headless，视口宽 1440，整页截图，2026-10-18（UTC+8）。
- 本目录 `<状态>.png` 是实现截图；`compare/<状态>.png` 是对照图，左边为原型 v0.4（`frontend/prototype/admin-console/screens/`），右边为实现，缩到一半大小。
- 做法：用模拟接口按状态返回会话、被锁人员列表和解锁、重设的结果，驱动构建后的前端产物，再按原型状态点按钮、填口令截图。人物与行数据沿用原型 `P7-locked-personnel.html` 的 `ROWS` 和 `assets/shell.js` 的人员；操作码用名册里的真实码。
- 操作码：每个人物的会话清单按「名册 `packages/shield/src/contract/opcode.ts` + 参照种子允许行 `backend/prisma/seed.mjs`」推出，口径同 `listPermittedOpcodes`，与 #122 截图一致（见 `docs/screens/122/README.md`）。
  - 合入 #122 的 45aa159 后，「机构」菜单改按 `org.unit.register`（#123 入名册）判定，「人员」要 `personnel.profile.read`（#128 入名册）；两者都不在当前名册里，所以系统管理的左导只有「管理台首页」「被锁人员」「管理台留痕」。
  - 监督按 #71 允许行持有 `clue.read`，所以 `P7-denied.png` 左导比原型多「线索」一项。
  - 2026-10-18 02 时合入 45aa159 后按上述清单重截全部 13 张与对照图，只有左导区域变化。
- P7 共 14 个状态键，本票交付其中 13 张。`P7-resetDenied-reused.png`（重设命中口令历史）留给口令历史票 #132。
- 允许的差异：重设弹窗口令要求末尾少「不能与对方最近 5 次使用过的口令相同」一句（`P7-resetConfirm.png`），由 #132 补上（#127 票「口令历史的规则句留给口令历史票」）。逐张说明见 PR「截图对照」一节。
