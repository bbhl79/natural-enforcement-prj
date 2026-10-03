## 关联
- Ticket：#（issue 号）
- 类型：t-platform / t-contract / t-biz
- 飞书 spec 权威指针：（doc_token＋version＋section＋url，仅 URL 无效）
- 权威依据：（飞书文档名＋版本，如 D3 v0.1.8-r12 §4.5）
- risk-tier／reasoning-tier：定级（§6.1）／实际使用／升级记录

## 验收句（来自 ticket，逐条勾选）
- [ ] （服务端断言；禁前端-only）

## 自检
- [ ] 只改本模块目录；未动 shield 契约（或走契约通道）
- [ ] 未自建迁移文件；schema 变更已在描述列明
- [ ] 未改中央清单（路由/操作码/字典种子/挂点/审计事件）
- [ ] ./dev lint / test / build 本地绿
- [ ] 飞书权威指针版本＝当前基线（合并前主 agent 复核）
