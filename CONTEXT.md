# 广州市规划和自然资源局监督监管与执法协同系统 · Agent 上下文

## 权威链
- 设计唯一权威＝飞书设计文件夹 https://my.feishu.cn/drive/folder/Q2EFfszJPlCbiNd5Lq2ceeOOnKr
- 执行态＝GitHub Issues（本仓库）；冲突以飞书为准
- 实施工作流＝飞书《Agent 实施工作流约定》（AuzJdFfmRo2OLex0qDTcsXVHnvb）

## 飞书文档索引（token → 内容）
| token | 文档 | 用途 |
|-|-|-|
| BC6GdlshqoCOGWx1ENycorbGnSe | D3 可编码开工包 v0.1.8-r12 | 字段/文书/权限/挂点权威 |
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
4. 指针 version 必须等于已拍板的当前基线。D3 当前基线＝v0.1.8-r12（revision 167，[#1](https://github.com/bbhl79/natural-enforcement-prj/issues/1)，2026-10-03）。附录短表里的 r11 行保留；在 LOCK 回写完成前，以 #1 为准。

## 硬规则（摘要，全文见工作流约定 §2）
1. Grilling 提问前必须检索上表；命中＝权威指针（token＋version＋section＋url）作答；未命中才问人
2. spec 只回链不复制；拍板按 USER LOCK 写回飞书并升版
3. gate.* block 门禁＝服务端断言，禁降级禁前端灰按钮
4. 业务票不动迁移与中央清单；PR 模板见工作流约定 §9.2（仓库副本：`.github/pull_request_template.md`）
5. risk-tier／reasoning-tier 按 §6.1 定级；具体模型映射见环境配置，不进协议；触及拍板、gate.*、契约强制升档；升降档均留痕

## 已拍板（2026-10-03，已回写飞书）
- **LOCK-20261003-01**（[#1](https://github.com/bbhl79/natural-enforcement-prj/issues/1)）：D3 当前基线＝v0.1.8-r12（revision 167）。附录短表 2026-10-02 的 v0.1.8-r11 行被取代，行本身保留。
- **LOCK-20261003-02**（[#2](https://github.com/bbhl79/natural-enforcement-prj/issues/2)）：允许代码与 GitHub Issues 继续托管在 `bbhl79/natural-enforcement-prj`。
- **LOCK-20261003-03**（[#3](https://github.com/bbhl79/natural-enforcement-prj/issues/3)）：本阶段不设硬上限。执行会话和每个 feature 都不卡金额或额度。tier 路由仍按工作流 §6.1。
- **2026-10-03 拍板**：本仓库是 1 人项目。PR owner 是 Lei（`bbhl79`），无法对自己的 PR 点 GitHub Approve。`main`／`dev` 不要求 GitHub approval。人在对话里明确批准后，主 agent 执行 merge。`assertions` 与 `path-guard` 仍是 required check。
- M0a spec [#4](https://github.com/bbhl79/natural-enforcement-prj/issues/4) 状态 IMPLEMENTING。执行票 [#5](https://github.com/bbhl79/natural-enforcement-prj/issues/5)–[#11](https://github.com/bbhl79/natural-enforcement-prj/issues/11)。前沿是 #5。

## worktree
与本仓库平级：`../natural-enforcement-prj-wts/`。命名 `wt-<票号>`，从最新 `dev` 拉出。见工作流约定 §3 Step 6。
