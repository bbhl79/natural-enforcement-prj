# 广州市规划和自然资源局监督监管与执法协同系统 · Agent 上下文

## 权威链
- 设计唯一权威＝飞书设计文件夹 https://my.feishu.cn/drive/folder/Q2EFfszJPlCbiNd5Lq2ceeOOnKr
- 执行态＝GitHub Issues（本仓库）；冲突以飞书为准
- 实施工作流＝飞书《Agent 实施工作流约定》（AuzJdFfmRo2OLex0qDTcsXVHnvb）

## 飞书文档索引（token → 内容）
| token | 文档 | 用途 |
|-|-|-|
| BC6GdlshqoCOGWx1ENycorbGnSe | D3 可编码开工包 v0.1.9 | 字段/文书/权限/挂点权威 |
| MUcYdpn68oEKAvxQQxFcLdBTnSg | 查处段 v0.1.4-r12 | M3a/M3b 业务基线 |
| HxRBdU96fo7Y7yxeDggcgnsen8c | 线索段 v0.1.5 | M1 业务基线 |
| GO7jd1PT5oig5QxM65pcQH0kn8b | 立案段 v0.1.4 | M2 业务基线 |
| NucodgCpUobkMsxC6jLcvwyQnYg | 平台横切 v0.1.2 | 权限/卷宗/字典/审计/副驾驶 |
| OtlRdhezKoxOxSxR3T1cdy1AnGx | 附录（法规引用＋版本基线表） | 版本登记处 |
| GO1SdsqW0otXIbxNxwScC8DXnsc | M0a 断言表 A01–A13 | 工程门 |
| AegldNoYDoshn9xOPbGcWaZinPg | 工程必齐清单 | 进编码前检查 |
| DJgSdS5V1ocFkaxapkGcj7x3nTf | 交付路线图 v0.3.2 | 里程碑切分 |
| N8Bkdr2UdolKvOxbbsacSQAtnNf | PRD v0.4 | 总稿 |
| （余见设计文件夹，按标题检索补齐本表） | | |

## 提问前必检
1. 先按上表检索飞书（`lark-cli docs +fetch`，只读）。
2. 命中：用权威指针四元组作答（doc_token＋version＋section＋url）。仅有 URL 无效。
3. 未命中：才开 Grilling／decision 票问人。禁止用聊天口头结论代替票。
4. 指针 version 必须等于已拍板的当前基线。D3 当前基线＝v0.1.9（revision 175，LOCK-20261003-04，2026-10-03）。该锁取代 LOCK-20261003-01；r12 行（revision 167）与 r11 行都保留，不再作为当前基线。附录当前基线＝v0.1.7（revision 54，LOCK-20261003-05）。

## 硬规则（摘要，全文见工作流约定 §2）
1. Grilling 提问前必须检索上表；命中＝权威指针（token＋version＋section＋url）作答；未命中才问人
2. spec 只回链不复制；拍板按 USER LOCK 写回飞书并升版
3. gate.* block 门禁＝服务端断言，禁降级禁前端灰按钮
4. 业务票不动迁移与中央清单；PR 模板见工作流约定 §9.2（仓库副本：`.github/pull_request_template.md`）
5. risk-tier／reasoning-tier 按 §6.1 定级；具体模型映射见环境配置，不进协议；触及拍板、gate.*、契约强制升档；升降档均留痕

## 已拍板（2026-10-03，已回写飞书）
- **LOCK-20261003-01**（[#1](https://github.com/bbhl79/natural-enforcement-prj/issues/1)）：D3 当前基线＝v0.1.8-r12（revision 167）。附录短表 2026-10-02 的 v0.1.8-r11 行被取代，行本身保留。本锁已被 LOCK-20261003-04 取代，行本身保留。
- **LOCK-20261003-04**（2026-10-03，对话确认）：D3 当前基线＝v0.1.9（revision 175）。取代 LOCK-20261003-01；r12 行保留。附录 `OtlRdhezKoxOxSxR3T1cdy1AnGx` 升 v0.1.6（revision 51）。
- **LOCK-20261003-05**（2026-10-03，对话确认，[#21](https://github.com/bbhl79/natural-enforcement-prj/issues/21)）：M0b 范围与边界。本锁取代把下列旧句读成「M0b 必做」的解释；旧句不改字、不删除。① 范围＝MS-M0b ①（`NgvYdU5qEouV4mx3jkWcY77LnTg` v0.1）。工作流 §7 第 2 循环「字典种子＋五条样张＋迁移 0001」是子集，不是范围上限；不得据此砍掉权限种子、唯一入卷、副驾驶通道、GIS 跳过留痕、监督禁写、shield 可编译形态；该循环出口「M0b＝D3∧M0a 合闸」仍是进门条件。② 五条＝同一条渲染入卷链上的五个服务端断言，不绑定具体省范本 templateId：红头页保真进 PDF；骑缝章位保真进 PDF；入卷元数据带 templateId＋templateVersion；错 templateId 混用被拒；前端自产 PDF 冒充已套打被拒。「至少 1 份」是这五条里的下限，不是替代品。法定文书样张留在后续段。③ GIS 只做适配边界＋失败则跳过并强制留痕；正式库表名／endpoint／密钥保持开放，不进退出断言，不做「套合成功」的假绿灯。④ 档案保管年限继续留在 D3 §9，不挡 M0b；§11 事件类型照清单落；不新增「保管年数」列，也不设默认年数。⑤ 迁移 0001 仅 `org`／`user`／`role`／`user_role`／`role_opcode`；§7 主实体不进 0001；卷宗表另开迁移。附录 `OtlRdhezKoxOxSxR3T1cdy1AnGx` 升 v0.1.7（revision 54），取代 04 的 v0.1.6（revision 51）行。指针：`OtlRdhezKoxOxSxR3T1cdy1AnGx`｜v0.1.7｜§2｜https://my.feishu.cn/docx/OtlRdhezKoxOxSxR3T1cdy1AnGx#doxcn2iqLre9xDOw2rtNB2yldof
- **LOCK-20261003-02**（[#2](https://github.com/bbhl79/natural-enforcement-prj/issues/2)）：允许代码与 GitHub Issues 继续托管在 `bbhl79/natural-enforcement-prj`。
- **LOCK-20261003-03**（[#3](https://github.com/bbhl79/natural-enforcement-prj/issues/3)）：本阶段不设硬上限。执行会话和每个 feature 都不卡金额或额度。tier 路由仍按工作流 §6.1。
- **2026-10-03 拍板**：本仓库是 1 人项目。PR owner 是 Lei（`bbhl79`），无法对自己的 PR 点 GitHub Approve。`main`／`dev` 不要求 GitHub approval。人在对话里明确批准后，主 agent 执行 merge。`assertions` 与 `path-guard` 仍是 required check。
- M0a spec [#4](https://github.com/bbhl79/natural-enforcement-prj/issues/4) 状态 IMPLEMENTING。执行票 [#5](https://github.com/bbhl79/natural-enforcement-prj/issues/5)–[#11](https://github.com/bbhl79/natural-enforcement-prj/issues/11)。前沿是 #5。

## worktree
与本仓库平级：`../natural-enforcement-prj-wts/`。命名 `wt-<票号>`，从最新 `dev` 拉出。见工作流约定 §3 Step 6。
