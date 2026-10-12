# 研究结论：NestJS 12 认证生态与内网 BFF 会话形态查证

- **关联票**：#66（研究票：NestJS 12 认证生态与内网 BFF 会话形态查证）
- **查证基准日**：2026-10-11
- **查证方式**：npm 官方 registry API（registry.npmjs.org）逐包取证版本号/发布时间/peerDependencies/deprecated 标记；npmmirror 官方 registry（registry.npmmirror.com）同日逐包对照；NestJS 官方文档源文件（github.com/nestjs/docs.nestjs.com）；nestjs/nest 官方 GitHub release notes；connect-redis 官方 README（经 GitHub API 取证）；OWASP Session Management Cheat Sheet；GB/T 22239-2019 标准文本（gov.cn 域名公开 PDF）。二手来源仅用于交叉印证并明确标注。
- **三态标注约定**：每条结论标注 **已查证** / **确认无法获取（附原因）** / **需要联系的具体机构**（转引自 `gov-intranet-tsa.md` 约定）。

> 本文件只做事实查证与来源标注，不做最终选型决策（归后续身份切片票）。仓库上下文：NestJS 12.1.2 定版、当前无 HTTP 层、argon2id 口令验真已自研（CredentialService）、redis 8.10.2 + ioredis 6.0.0 已在库、PostgreSQL 18 为唯一数据库、等保三级基线已定（审计、可插拔、单因子、纯内网）。

---

## 0. 总体结论速览

| # | 问题 | 状态 | 一句话结论 |
|---|---|---|---|
| 1 | 有状态会话：官方/社区方案 vs 自研 | **已查证** | NestJS 官方在 Nest 12 世代推出了第一方认证包 `@nestjs/authentication`（**0.1.0，2026-10-08 发布，查证日仅 3 天**），以服务端会话为默认形态、自带安全会话 Cookie 与同源校验；社区主流仍是 `express-session` + `connect-redis` 链路（均在维护）；自研守卫 + 会话表在本仓库有成熟先例（CredentialService / packages/storage 零依赖自研），三条路线都成立，取舍在「成熟度 vs 可控面」 |
| 2 | 无状态：@nestjs/jwt、passport-jwt | **已查证** | `@nestjs/jwt` **12.0.2**（2026-09-14，活跃维护，内部钉 jsonwebtoken 9.0.3）维护状态良好；**passport-jwt 4.0.1 自 2022-12 起无新版，仓库 2024-02 后无提交、43 个 open issue，维护停滞**；passport 本体 0.7.0（2023-11）。新项目 passport 路线非必要 |
| 3 | Cookie 解析 / CSRF / HttpOnly/SameSite | **已查证** | **NestJS v12.1 起框架内建 CSRF 防护**（`app.enableCsrfProtection()`，零依赖，Sec-Fetch-Site + Origin/Host 同源判定，覆盖全部路由）；`csurf` 已官方 deprecated（归档弃维护）；Cookie 通行配置 = HttpOnly + Secure + SameSite=Lax/Strict + `__Host-` 前缀 + Path=/ + 不设 Domain（OWASP）；纯内网 HTTP 场景 Secure/`__Host-` 无法落地，需 TLS |
| 4 | 会话存储：内存 vs Redis | **已查证** | 内存存储仅适合开发（重启掉线、多实例不共享，`@nestjs/authentication` 在 NODE_ENV=production 下拒启）；生产可选 Redis（已有容器）或 PostgreSQL 会话表；注意 **connect-redis 10 只支持 node-redis（redis>=5），不支持 ioredis**——本仓库已锁 ioredis 6.0.0，走 express-session 链路要么加第二个 Redis 客户端库、要么自研 ioredis store |
| 5 | 国内渠道（npmmirror）可安装性 | **已查证（packument 层）** | 全部 9 个关键包 npmmirror 与 npmjs 官方 latest 逐字一致（版本号对照见 §5），境内渠道可装；未做整树 `pnpm install` 实测（执行时复测） |

**对身份切片的直接含义**：Cookie 载体 + 服务端会话是当前形态下的稳妥默认；CSRF 用框架内建（12.1.2 已自带），无需引入 csurf/csrf-csrf 任何包；passport 生态不建议进新代码；`@nestjs/authentication` 值得持续跟踪至 1.x 再评估切换。

---

## 1. 有状态会话：三条路线对比

### 1.1 官方第一方：`@nestjs/authentication`（全新）—— 已查证

- **包状态**：`@nestjs/authentication` 当前版本 **0.1.0**，首发 0.0.1 于 **2026-09-29**，0.1.0 于 **2026-10-08**（查证基准日仅 3 天前），pre-1.0。peerDependencies：`@nestjs/core ^12.0.0`、`@nestjs/common ^12.0.0` 等——与本仓库 12.1.2 兼容。来源：[npm registry 包页](https://www.npmjs.com/package/@nestjs/authentication)（数据经 registry API 取证，2026-10-11）。
- **形态**：官方文档认证章节已整体重写为该包教程。默认形态为**服务端会话**：`SignInService.signIn()` 建会话并在响应上直接种会话 Cookie（Express/Fastify 均支持，控制器无需 `@Req()`/`@Res()`）；会话 Cookie 名 `__Host-sid`，值为 256-bit 随机令牌，**存储侧只存令牌的 SHA-256**（会话库泄露不可重放）；支持 bearer access token（移动端）、MFA、magic link、OIDC、API key 等可插拔特性，全部状态经「存储契约」落库。来源：[NestJS 官方文档 Authentication 章节](https://docs.nestjs.com/security/authentication)（[源文件](https://github.com/nestjs/docs.nestjs.com/blob/master/content/security/authentication.md)，2026-10-11 取证）。
- **存储契约**：六个契约（sessions / refreshTokens / mfa / magicLinks / oidcStates / emailTokens），应用自写 singleton provider 实现接口注册；教程给 Drizzle/TypeORM 实现，Prisma 有专节说明原子操作的表达；官方附契约测试套件。内存为默认回退但**丢状态、多实例不共享**；`NODE_ENV=production` 下未注册所需契约的存储时**拒绝启动**（`allowInMemoryStorage: true` 可强开，但重启全员掉线）。来源：同上官方文档「Keep sessions and tokens in your database / The store contract / Production checklist」。
- **对本仓库的适配点**：会话存 PostgreSQL 即满足生产校验，与本仓库「唯一数据库 + 审计同库」取向一致；单因子口令场景只需 `sessions` 一个契约，裁剪面小。
- **风险**：pre-1.0 且发布仅数日，API 稳定性无版本化承诺；等保三级生产基线直接采纳偏激进。**结论：列入跟踪，不在本基线采纳。**

### 1.2 社区主流：`express-session` 链路 —— 已查证

| 包 | 版本 | 最新发布 | 维护状态 |
|---|---|---|---|
| express-session | **1.19.0** | 2026-01-22 | 活跃（仓库 2026-10-08 仍有提交） |
| connect-redis | **10.0.0** | 2026-07-24 | 活跃（仓库 2026-09-10 仍有提交） |
| cookie-parser | **1.4.7** | 2024-10-08 | 维护中（Express 官方组织） |

来源：[express-session npm](https://www.npmjs.com/package/express-session)、[connect-redis npm](https://www.npmjs.com/package/connect-redis)、[cookie-parser npm](https://www.npmjs.com/package/cookie-parser)、[expressjs/session](https://github.com/expressjs/session)、[tj/connect-redis](https://github.com/tj/connect-redis)（registry API + GitHub API 取证，2026-10-11）。

要点：
- `express-session` 是 Express 生态事实标准的会话中间件，NestJS 中经 `app.use()` 注册为中间件使用；本身不绑存储，存储由 store 包提供。
- `connect-redis` 10.0.0 的 `engines` 要求 **node >= 22**（本仓库 Node 24 满足），peerDependencies 为 `redis >=5` + `express-session >=1`；README 明示 client 为 **node-redis 实例**（安装命令 `npm install redis connect-redis express-session`），**不支持 ioredis**。本仓库已锁 ioredis 6.0.0（BullMQ 队列用），走此链路意味着并存第二个 Redis 客户端库，或自研 ioredis 版 session store（express-session 的 Store 接口公开、实现量小）。
- 该链路在 NestJS 12 / Node 24 下无兼容障碍（express-session 1.19.0 支持 Express 5，cookie 依赖 0.7.2）。

### 1.3 自研守卫/中间件 + 会话表 —— 已查证（方案成立性）

- 形态：登录路由验真（复用现有 CredentialService argon2id）后签发随机会话令牌，会话行落 PostgreSQL（或 Redis），全局 `AuthGuard` 每请求查会话表校验。本仓库已有同类先例：口令验真 CredentialService 自研、packages/storage 以「零新增第三方依赖」自实现 S3/SigV4 并配结构测试兜底——自研路线符合本仓库工程纪律，且会话表与审计数据同库，等保审计取证路径短。
- 需要自管的安全细节（官方包已内建、自研需自己落实的清单）：令牌只存哈希、Cookie 属性（HttpOnly/Secure/SameSite/`__Host-` 前缀）、会话固定攻击防护（登录后轮换/特权变更轮换）、闲置超时与绝对超时、登录限流。参照 OWASP Session Management Cheat Sheet 逐条落实。来源：[OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)（2026-10-11 取证）。
- 代价：上述安全细节全部自负，评审面大；无社区背书，细节疏漏风险高于前两条。

### 1.4 小结对比

| 维度 | @nestjs/authentication 0.1.0 | express-session 链路 | 自研守卫 + 会话表 |
|---|---|---|---|
| 官方背书 | NestJS 第一方（pre-1.0，3 天新） | Express 官方组织 + 社区 | 无 |
| 安全细节内置 | 全（哈希存证、Cookie 属性、同源校验、轮换、超时、限流钩子） | 部分（Cookie 属性、ID 生成；轮换/超时需配置） | 无（全自负） |
| 存储 | 六契约自实现（PG 教程现成） | Redis（connect-redis，限 node-redis）或自研 store | PG / Redis 任选 |
| 依赖增量 | 1 个第一方包 | express-session + store + （node-redis 或自研） | 0 |
| 维护风险 | API 未稳定（pre-1.0） | 低（均在维护） | 低（代码自有） |
| 等保审计契合 | 状态在库，契合 | 状态在 Redis，审计需另行落库 | 状态在 PG，最契合 |

---

## 2. 无状态：@nestjs/jwt 与 passport-jwt —— 已查证

| 包 | 版本 | 最新发布 | 维护状态 | 备注 |
|---|---|---|---|---|
| @nestjs/jwt | **12.0.2** | 2026-09-14 | **活跃**（仓库 2026-10-10 有提交） | peer @nestjs/common ^8–^12；内部钉 jsonwebtoken **9.0.3**（@types/jsonwebtoken 9.0.10） |
| jsonwebtoken | 9.0.3 | — | 活跃（仓库 2026-06-25 有提交） | @nestjs/jwt 的底层 |
| @nestjs/passport | **12.0.0** | — | 正常发版 | peer passport ^0.5–^0.7 + @nestjs/common ^11/^12 |
| passport | 0.7.0 | 2023-11-27 | 低频维护 | — |
| passport-jwt | **4.0.1** | **2022-12-24** | **停滞**（仓库 2024-02-03 后无提交，43 个 open issue） | 底层 jsonwebtoken ^9.0.0 |

来源：[@nestjs/jwt npm](https://www.npmjs.com/package/@nestjs/jwt)、[passport-jwt npm](https://www.npmjs.com/package/passport-jwt)、[passport npm](https://www.npmjs.com/package/passport)、[@nestjs/passport npm](https://www.npmjs.com/package/@nestjs/passport)、[jsonwebtoken GitHub](https://github.com/auth0/node-jsonwebtoken)、[mikenicholson/passport-jwt GitHub](https://github.com/mikenicholson/passport-jwt)（registry API + GitHub API 取证，2026-10-11）。

要点：
- `@nestjs/jwt` 本身维护良好、与 Nest 12 兼容，若未来需要 bearer token（如对接外部系统）可直接使用；其官方定位是工具模块而非完整认证方案。
- **passport-jwt 维护停滞是结构性的**：NestJS 官方文档的认证章节已不再以 passport 为主线（重写为 `@nestjs/authentication` 教程），passport 路线失去文档与生态风向的牵引。新代码不建议引入 passport 系。
- 无状态 JWT 的另一固有取舍（吊销困难、无服务端会话审计点）与本仓库「等保三级 + 审计」基线存在张力，即使要用也更适合短寿命载体。

---

## 3. Cookie 载体、CSRF 与内网 BFF 通行配置

### 3.1 NestJS 12.1 内建 CSRF 防护 —— 已查证

- v12.1.0（2026-09-23 发布）合入官方 PR [#17836](https://github.com/nestjs/nest/pull/17836)「built-in CSRF protection and security headers」（common/core/platform-fastify）。本仓库定版 12.1.2 **已包含**。来源：[nestjs/nest v12.1.0 release notes](https://github.com/nestjs/nest/releases/tag/v12.1.0)（2026-10-11 取证）。
- 用法：`app.enableCsrfProtection()`，**零额外包、无 token、无 Cookie 改动**，Express/Fastify 行为一致。算法：GET/HEAD/OPTIONS 恒放行；有 `Sec-Fetch-Site` 头时仅放行 `same-origin`/`none`；无该头也无 `Origin` 视为非浏览器放行；否则比对 `Origin` 与 `Host`（大小写不敏感、忽略默认端口）。被拒请求 403。来源：[NestJS 官方文档 CSRF 章节](https://docs.nestjs.com/security/csrf)（2026-10-11 取证）。
- 跨源前端经 `trustedOrigins: ['scheme://host[:port]']` 白名单精确放行；`exclude` 支持路径与方法精确豁免。
- 局限（官方文档明示）：依赖浏览器 Fetch Metadata，**仅送达安全上下文（HTTPS 或 localhost）**；旧浏览器双缺头时 fails open；WebSocket 握手不检查。文档另给 token 方案兜底（Express 用 csrf-csrf、Fastify 用 @fastify/csrf-protection），仅「必须支持很旧浏览器」时需要。
- 同版本另有 PR [#17834](https://github.com/nestjs/nest/pull/17834)「built-in, adapter-agnostic cookies」——框架自带 Cookie 读写能力，读侧解析不再强制依赖 cookie-parser（官方文档级细节随 12.1 文档落地）。

### 3.2 csurf 的废弃状态 —— 已查证

`csurf` 1.11.0（2020-01-19 后未更新）在 npm 上已被官方打上 deprecated：**「This package is archived and no longer maintained.」**（Express 组织归档，指向 expressjs/express discussions）。新项目不应引入。来源：[csurf npm](https://www.npmjs.com/package/csurf)（registry API 取证，2026-10-11）。

### 3.3 Cookie 属性通行配置（OWASP 口径）—— 已查证

OWASP Session Management Cheat Sheet 对会话 Cookie 的明文要求：
- `Secure`：**mandatory**（仅经 TLS 发送，防 MitM 窃取）；`HttpOnly`：**mandatory**（防 XSS 脚本窃取）；
- `SameSite`：会话 Cookie 必须显式设置 `SameSite=Strict`（首选）或 `Lax`；**不得裸用 `SameSite=None`（除非配 Secure）**，且不得依赖浏览器默认值；
- Cookie 名前缀：`__Host-` 要求 Secure + 不设 Domain + Path=/，防子域伪造与 HTTPS 降级，**明确推荐用于会话 ID**；`__Secure-` 仅当需要子域共享时用；
- 示例：`Set-Cookie: __Host-SessionID=<value>; Secure; HttpOnly; SameSite=Strict; Path=/`。

来源：[OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)（2026-10-11 取证）。`@nestjs/authentication` 的默认（`__Host-sid` + HttpOnly + Secure + SameSite=Lax + Path=/）与 OWASP 逐条对齐，仅 SameSite 取的是 Lax 档。

### 3.4 内网 BFF 的落地要点 —— 已查证 + 分析结论

- 本项目前后端同域（nginx 反代或 Vite dev proxy），不存在跨源前端，`trustedOrigins` 可为空；同源 SPA + SameSite=Lax 即可满足常规流量，Strict 更强但会让「从其他内网系统点链接进来」的首个 GET 请求不带会话 Cookie（表现为一进来未登录态，同站点一次交互后恢复）——**通行取 Lax，对外部链接入口敏感的场景再升 Strict**。
- **Secure 与 `__Host-` 前缀在纯 HTTP 内网下无法落地**：浏览器仅在 localhost 视为安全上下文，LAN 裸 HTTP 会拒收 Secure Cookie（NestJS 官方文档亦明示此场景需退 `cookie.secure=false` 且失去 `__Host-` 前缀）。等保三级本身要求通信保密性（TLS），故内网上 TLS（nginx 终结即可）与 Secure Cookie 是同一枚硬币；若早期无 TLS，需显式接受降级并记录风险。
- cookie-parser 仅在「express-session 链路需要自己读 Cookie 头」时是必需品（1.4.7，Express 官方维护）；走 `@nestjs/authentication` 或 Nest 12.1 内建 Cookie 能力时不强制引入。Fastify 路线对应 `@fastify/cookie` 11.1.3。

---

## 4. 会话存储：内存 vs Redis vs PostgreSQL —— 已查证

| 存储 | 事实 | 判定 |
|---|---|---|
| 内存 | 重启/部署全员掉线；多实例不共享；`@nestjs/authentication` 在 production 下拒启（除非显式 allowInMemoryStorage，官方文档原话「every restart or deploy signs everyone out」）；express-session 默认 MemoryStore 官方不推荐生产 | 仅开发 |
| Redis（已有 8.10.2 容器 + ioredis 6.0.0） | express-session 官方 store connect-redis 10 仅支持 node-redis（peer redis>=5、engines node>=22），**与库内 ioredis 并存则双客户端库**，或自研 ioredis store；Redis 存会话无审计语义，等保审计需另行落库 | 可行，依赖面需处理 |
| PostgreSQL 18（已有） | 会话表随应用库走，审计/取证同库；`@nestjs/authentication` 教程形态即 PG store；自研守卫形态天然如此 | 与本仓库基线最契合 |

来源：[connect-redis README](https://github.com/tj/connect-redis)（经 GitHub API 取证，「client: An instance of redis」及 peer 要求）、[express-session README](https://github.com/expressjs/session)、[NestJS 官方文档 store contract 节](https://docs.nestjs.com/security/authentication)（2026-10-11 取证）。

## 5. 国内渠道（npmmirror）可安装性 —— 已查证（packument 层）

2026-10-11 逐包实测：以 `registry.npmmirror.com/<pkg>/latest` 与 `registry.npmjs.org` 官方 latest 逐字对照，**9/9 一致**：

| 包 | npmjs latest | npmmirror latest | 一致 |
|---|---|---|---|
| @nestjs/jwt | 12.0.2 | 12.0.2 | ✓ |
| @nestjs/passport | 12.0.0 | 12.0.0 | ✓ |
| @nestjs/authentication | 0.1.0 | 0.1.0 | ✓ |
| passport | 0.7.0 | 0.7.0 | ✓ |
| passport-jwt | 4.0.1 | 4.0.1 | ✓ |
| express-session | 1.19.0 | 1.19.0 | ✓ |
| cookie-parser | 1.4.7 | 1.4.7 | ✓ |
| connect-redis | 10.0.0 | 10.0.0 | ✓ |
| csrf-csrf | 4.0.3 | 4.0.3 | ✓ |

说明：本次验证止于 registry packument（元数据 + 版本一致性）层，未做整树 `pnpm install` 实测；落地执行时按仓库惯例现场复测（对照 infra/VERSIONS.md 执行纪律 5 的「境内渠道须现场复测」）。

## 6. 边界提示（非本票问题，标注备查）

- GB/T 22239-2019《信息安全技术 网络安全等级保护基本要求》三级身份鉴别条款（8.1.4.1 d）在公开引文中一致表述为「应采用口令、密码技术、生物技术等两种或两种以上组合的鉴别技术对用户进行身份鉴别，且其中一种鉴别技术至少应使用密码技术来实现」——与项目已定「单因子」基线存在字面张力；**该基线决议不在本票范围**，且本票未能从国家标准全文公开系统逐字核对原文（openstd 全文页反爬，未取证），此条仅作边界提示，标准原文见 [GB/T 22239-2019 全文（gov.cn 域名公开 PDF）](http://gxxxzx.gxzf.gov.cn/szjcss/P020230506405491593407.pdf)。如身份切片需要引用该条款，应先完成一手核对。

## 附：来源清单（全部 2026-10-11 访问）

1. [NestJS 官方文档 · Authentication](https://docs.nestjs.com/security/authentication)（[源文件](https://github.com/nestjs/docs.nestjs.com/blob/master/content/security/authentication.md)）
2. [NestJS 官方文档 · CSRF](https://docs.nestjs.com/security/csrf)（[源文件](https://github.com/nestjs/docs.nestjs.com/blob/master/content/security/csrf.md)）
3. [nestjs/nest v12.1.0 release notes](https://github.com/nestjs/nest/releases/tag/v12.1.0)（PR #17836 内建 CSRF、#17834 内建 Cookie）
4. npm registry API：@nestjs/authentication、@nestjs/jwt、@nestjs/passport、passport、passport-jwt、express-session、cookie-parser、connect-redis、csrf-csrf、csurf、jsonwebtoken 各包页
5. GitHub API：nestjs/jwt、expressjs/session、tj/connect-redis、mikenicholson/passport-jwt、auth0/node-jsonwebtoken 仓库活跃度与 README
6. [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
7. [GB/T 22239-2019 全文（gov.cn 公开 PDF）](http://gxxxzx.gxzf.gov.cn/szjcss/P020230506405491593407.pdf)（仅 §6 边界提示，未逐字核对）
8. npmmirror registry（registry.npmmirror.com）逐包 latest 对照
