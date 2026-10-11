# 应用层技术栈版本兼容矩阵（追新基线：TypeScript 7 / Node 24）

> 研究票 [#59](https://github.com/bbhl79/natural-enforcement-prj/issues/59) · 架构工程子 Map · 版本基线决策的**兼容性与渠道验证**
> 关联裁决：版本基线 = 追新（各包非 rc/beta/dev 的 latest stable major）、运行时 = Node 24 LTS
> 性质：**只查证兼容事实与渠道可得性，不做选型决策。** 本票验证「追新 + Node 24」这一已定裁决的工程后果，并暴露其中的不兼容组合与渠道缺口。
> 查证日期：全部条目标注 **2026-10-09**。

---

## 0. 本文档的读法与方法说明

全文分三段，边界严格：

| 段 | 含义 | 标注方式 |
|---|---|---|
| 一 | **已查证的事实** | 每条附一手来源与查证日期；能引原文处引原文 |
| 二 | **判定摘要** | 各包 × TS 7 / Node 24 兼容矩阵；追新基线下建议锁定的具体 major；渠道可得性判定；**红旗清单** |
| 三 | **未能查证与残余风险** | 明确列出缺口；查不到即写「未能查证」，不外推 |

**一手来源口径（优先级从高到低）**：

1. **npm registry package.json** —— `dist-tags`、`engines`、`peerDependencies`。这是各包维护者自己写的硬性区间，**比二手博客更权威**，本票据此定矩阵。来源 `https://registry.npmjs.org/<pkg>`，查证日期 2026-10-09。
2. **各官方 docs / GitHub Release** —— Microsoft TypeScript Blog、Vite、Vitest、Prisma、NestJS、Playwright 官方发布说明与迁移指南。
3. **运行时与镜像源 API** —— `nodejs.org/dist/index.json`、`mcr.microsoft.com/v2/...`、Docker Hub `registry-1.docker.io/v2/...`、`npmmirror.com` 二进制镜像目录。

**「追新」的操作性定义与本票的取舍**：取每个包 npm `dist-tags.latest` 所指的、非 rc/beta/dev/next 的**最高 stable major**。据此：

- Prisma 取 **7.10.0**（npm 上 `latest` 标签当前指向 `8.0.0-rc.22`，是 rc；stable 线是 `prev` 标签 = `7.10.0`）——**8.0.0 依裁决排除**。
- TypeScript 取 **7.0.2**（`latest`）。
- Vite 取 **8.3.4**（`latest`）；Vitest 取 **5.0.3**（`latest`）；Playwright 取 **1.64.0**（`latest`）。
- Node 运行时 = **24**（现行 LTS）。

**⚠️ 本票研究方法上的一处必须声明的前提**：本次查证在一台**可直连境外**的环境上完成（`registry.npmjs.org`、`mcr.microsoft.com`、`registry-1.docker.io`、`cdn.npmmirror.com` 均返回真实 HTTP 码）。因此——

- **可测**：某个境内 mirror / 二进制镜像**是否同步了目标仓库/文件**（功能性「覆盖」判定）。
- **不可测**：mirror 在**广州政务内网/境内出口**下的**端到端可达性、限速、认证要求**。「能拉到 HTTP 200」不等于「境内能拉到」。§2.3、§3 对此单独标注。

---

## 一、已查证的事实

### 1.1 TypeScript 7.0.x 官方定位

- **7.0 是 Go 原生移植版**，非增量小版本。官方公告《Announcing TypeScript 7.0》（Daniel Rosenwasser，**2026-07-08**，Microsoft TypeScript Blog）原文：*"the availability of TypeScript 7, a 10x faster native port of TypeScript … a native port of TypeScript built in Go"*。该移植为**忠实移植（faithful port）**，语义与旧 JS 实现一致。
  来源：<https://devblogs.microsoft.com/typescript/>（列表页确认该文标题、作者、日期，查证 2026-10-09）
  交叉印证（非一手，仅佐证叙事）：<https://www.infoq.cn/article/ciQHX2larGoSlHspZ9VK>
- **npm 现状（一手）**：`typescript` dist-tags —— `latest: 7.0.2`、`rc: 7.0.1-rc`、`beta: 6.0.0-beta`、`next: 7.1.0-dev.20261009.1`。即 7.0 已 GA，且夜间通道回到标准包的 `next`。
- **6.0 是「JS 桥接线」**：官方 7.0 公告明确 **7.0 不附带（编程）编译器 API**；需要程序化访问编译器的工具（**typescript-eslint、ts-loader** 等）**暂时依赖 TypeScript 6**。微软为此发布兼容包 **`@typescript/typescript6`**，npm 实测其 `latest = 6.0.2`，与 `typescript@7.0.2`（含 `tsc`）**并行安装、不冲突**。
  来源：devblogs 7.0 公告（同上）；npm 一手 `registry.npmjs.org/@typescript/typescript6` = 6.0.2（查证 2026-10-09）。
  预览包 `@typescript/native-preview` 仍在（`latest = 7.0.0-dev.20260707.2`）。注：检索结果中出现的 `@typescript/native` 别名在 npm **未查证到独立包**，本票不采用该别名。
- **API 差异（对绿地的意义）**：语义等价 → 业务代码无需改；**但 7.0 无稳定编译器 API**，官方口径是 **7.1 计划带新的（且不同的）API**。在此之前，凡「以编程方式调用 `typescript` 包」的下游工具都要么走 6.0.2、要么等待适配。**这是 1.4 / 2.4 红旗的根源。**
  来源：devblogs 7.0 公告；InfoQ 同上（"微软预计 TypeScript 7.1 将自带一个新的（且不同的）API"）。
- **TS 对 Node 的最低要求（一手）**：`typescript@7.0.2` 的 `engines.node = ">=16.20.0"`；`typescript@6.0.2` 为 `>=14.17`。二者在 Node 24 上均无运行时下限问题。
- **框架支持区间**：**TypeScript 官方 docs 未发布「NestJS/Prisma/Vite/Vitest 各支持到哪个 TS 版本」的对应表**。各框架的 TS 区间由**各自 package.json** 决定，见 §1.2。此项「TS 官方 → 框架」映射记为**未能查证**（§3）。

### 1.2 各包官方 engines / peerDependencies（npm package.json 一手）

以下为 2026-10-09 从 `registry.npmjs.org` 直读的关键字段。**「TS 区间」列指该包 `peerDependencies.typescript`（无此项表示该包不以 peer 约束 TS）。**

| 包 | 实测 stable 版 | `engines.node` | `peerDependencies.typescript` | 关键其它 peer |
|---|---|---|---|---|
| `@nestjs/core` | 12.1.2 | `>= 20` | **未声明** | `@nestjs/common@^12`、`rxjs@^7.1.0`、`reflect-metadata@^0.1.12||^0.2.0` |
| `@nestjs/cli` | 12.0.8 | `>= 20.11` | **未声明** | `ts-loader@^9.5.4`、`fork-ts-checker-webpack-plugin@^9.1.0`、`@swc/core@^1.15.18`、`webpack@^5.105.4` |
| `prisma` | 7.10.0（`prev`；`latest` 指 8.0.0-rc.22） | `^20.19 \|\| ^22.12 \|\| >=24.0` | **`>=5.4.0`**（满足 TS7） | `better-sqlite3@>=9.0.0` |
| `@prisma/client` | 7.10.0 | 同上 | `>=5.4.0` | `prisma@*` |
| `vite` | 8.3.4（`latest`；`previous=6.4.4`；7 线末版 7.3.7） | `^20.19.0 \|\| >=22.12.0` | **未声明** | `@types/node@^20.19.0\|\|>=22.12.0`（optional）、`esbuild`（optional） |
| `@vitejs/plugin-react` | 6.1.2 | — | — | **`vite@^8.0.0`**（与 Vite 8 配对） |
| `vitest` | 5.0.3（`latest`；`V4=4.1.11`、`V3=3.2.7`） | `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0` | **未声明** | **`vite@^6.4.0 \|\| ^7.0.0 \|\| ^8.0.0`**、`@types/node@^22.0.0\|\|>=24.0.0` |
| `tailwindcss` | 4.3.3（`latest`；`v3-lts=3.4.19`） | — | — | — |
| `@tailwindcss/vite` | 4.3.3 | — | — | **`vite@^5.2.0 \|\| ^6 \|\| ^7 \|\| ^8`**（与 Vite 8 配对） |
| `react` | 19.3.0（`latest`） | `>=0.10.0` | — | — |
| `@reduxjs/toolkit` | 2.13.0（`latest`） | — | — | **`react@^16.9 \|\| ^17 \|\| ^18 \|\| ^19`**、`react-redux@^7.2.1\|\|^8.1.3\|\|^9.0.0` |
| `@playwright/test` / `playwright` | 1.64.0（`latest`；`next=1.65.0-alpha-2026-10-09`） | `>=20` | **未声明** | `@playwright/test` → `playwright@1.64.0` |
| `argon2` | 0.45.1（`latest`；`next=1.0.0-alpha.1`） | `>=16.17.0` | — | `node-addon-api@^8.9.0`、`node-gyp-build@^4.8.4`、`@phc/format@^1.0.0` |
| `@types/node` | 26.6.4（`latest`；存在 24.19.1） | — | — | `ts24.1.0` 等标签齐备 |
| **`typescript-eslint`** | 8.71.1（`latest`） | — | **`>=4.8.4 <6.1.0`** ⚠️ | `eslint@^8.57\|\|^9\|\|^10` |
| `pnpm` | 12.10.1（`latest`） | `>=18.*` | — | — |

**由上表得到的三条硬事实**：

1. **框架层对 TS 7 / Node 24 无冲突**：Nest 12、Prisma 7.10、Vite 8、Vitest 5、Playwright 1.64 的 `engines` 全部覆盖 Node 24；除 Prisma 外**均不以 peer 约束 TypeScript**，Prisma 的下限 `>=5.4.0` 被 TS 7 满足。
2. **唯一致命 peer 冲突在 linter**：`typescript-eslint@8.71.1` 的 TS 上限是 **`<6.1.0`**，**拒绝 TypeScript 7**。`@typescript-eslint/parser` 同范围。这是「追新 TS 7」组合里**唯一被 package.json 明文挡下**的边（详见 §2.4 红旗 R1）。
3. **测试/构建链对 Vite 8 的配对成立**：`@vitejs/plugin-react@6 → vite ^8.0.0`、`@tailwindcss/vite@4.3.3 → vite 含 ^8`、`vitest@5 → vite 含 ^8.0.0`。Vite 8 与这三个官方插件/Runner 的 peer 区间均相交。

### 1.3 Node 24 LTS 事实

来源 `https://nodejs.org/dist/index.json`（2026-10-09）：

- **v24.21.0**，`lts: "Krypton"`（24 系列已进入 LTS）；**v22.23.3**，`lts: "Jod"`（维护 LTS）；**v26.11.1**，`lts: false`（当前线，未 LTS）。
- 结论：**Node 24 为现行 LTS**，会话初稿口径成立。§1.2 各包 `engines` 均含 24。

### 1.4 argon2 0.45.1 预编译二进制（Node 24 / linux x64 + arm64）

- **构建方式（一手）**：`argon2@0.45.1` 的 `dependencies` 含 `node-gyp-build@^4.8.4` + `node-addon-api@^8.9.0`，`binary.napi_versions = [8]`，`scripts.install = "… node-gyp-build"`、`scripts.build = "prebuildify --napi …"`。**即 N-API v8 稳定 ABI + `prebuildify` 预编译，非 napi-rs，也非「装时 node-gyp 现编译」。**
- **npm tarball 实测（一手，最可靠）**：`argon2-0.45.1.tgz` 内**随包附带** `prebuilds/`，共 10 个 `.node`，覆盖：
  - `linux-x64`：**glibc + musl**（`argon2.glibc.node`、`argon2.musl.node`）✅
  - `linux-arm64`：**glibc + musl**（`argon2.armv8.glibc/musl.node`）✅
  - 另含 `linux-arm`(armv7 glibc/musl)、`darwin-arm64`、`freebsd-x64/arm64`、`win32-x64`。
- **对「全容器化 + Node 24」的直接含义**：无论基座取 **`node:24-bookworm-slim`（glibc）** 还是 **`node:24-alpine`（musl）**，linux x64 与 arm64 都命中随包预编译产物，**`npm/pnpm install` 无需编译工具链、无需访问 GitHub Releases**。
  来源：`https://registry.npmjs.org/argon2/-/argon2-0.45.1.tgz`（tar 清单）与 package.json，2026-10-09。
- **未查证项**：N-API v8 在 Node 24 的实测加载（本机未 `node -e require('argon2')`）。理论上 N-API 稳定 ABI 向下兼容 Node 24，风险低，但列入 §3。

### 1.5 Vite 7→8、Vitest 3→4→5 的 breaking，与版本配对

**Vite 8**（官方迁移指南 `https://vite.dev/guide/migration` + 官方发布博客，2026-10-09 复核）：

- 核心：**打包器由 Rollup 换为统一的 Rust 版 Rolldown，JS 转换/压缩逐步切到 Oxc**。官方迁移文原文要点：默认 `build.target` 对齐 **「Baseline Widely Available」as of 2026-01-01** 的浏览器基线；依赖预构建交给 Rolldown；转换/压缩能力迁往 Oxc。
- 迁移面（一手归纳）：`optimizeDeps.esbuildOptions`、顶层 `esbuild` 等旧入口自带兼容层，但需逐步迁到 Rolldown/Oxc 对应项；**CommonJS 默认导入、`manualChunks`、自定义（深依赖 Rollup 内部 API 的）插件**是回归重点。配置 API 与插件钩子**刻意保持不变**。
- **Node 要求（一手 package.json）**：`vite@8.3.4` `engines = "^20.19.0 || >=22.12.0"`（覆盖 Node 24）。
- 渐进迁移：官方建议大项目先走 `rolldown-vite` 技术预览包，再升 Vite 8；框架/工具把 Vite 作依赖时需 `overrides`（npm/yarn/bun）或 `pnpm.overrides` 抬版本。

**Vitest**（官方迁移指南 `https://vitest.dev/guide/migration` / 中文镜像 `https://cn.vitest.dev/guide/migration/`，2026-10-09）：

- **4.0**（`V4 = 4.1.11`）：`workspace` 配置**重命名为 `projects`**；浏览器模式（Browser Mode）与视觉回归**转稳定**；V8 覆盖率生成逻辑调整（结果可能变化）。已知边缘问题：**4.x 配 Vite ≤7.1.0 时 `vitest.config.ts` 进入 TS 上下文会报 `ModuleRunnerOptions` 缺 `createImportMeta`**（社区 issue，判为轻微）。
- **5.0**（`latest = 5.0.3`，官方公告发布于 **2026-09**，VoidZero 博客称比 4 快至多 50%）：破坏性项含 **配置文件不再向父目录查找**（子目录跑 `vitest` 需显式 `--config` + `--dir` 限定发现范围）；jsdom/happy-dom 里对 `globalThis`/`window` 的赋值**改为传播到底层 window**；`populateGlobal` 的 `originals` 返回**属性描述符**；覆盖率 pattern 改为**精确匹配相对路径**；移除 `test.sequential`；mock 提升到顶层。
- **配对（一手 package.json）**：`vitest@5.0.3` `engines = "^22.12.0 || ^24.0.0 || >=26.0.0"`（**V5 起放弃 Node 20**；Node 24 命中 `^24.0.0`）；`peerDependencies.vite = "^6.4.0 || ^7.0.0 || ^8.0.0"`。**→ Vitest 5 官方支持 Vite 8（含 `^8.0.0`），且要求 Vite ≥6.4、Node ≥22.12。** 在「Vite 8.3.4 + Vitest 5.0.3 + Node 24」下两者配对成立。
- V4（`4.1.11`）`engines = "^20||^22||>=24"`、`peer vite = "^6||^7||^8"`——若需保留 Node 20 兼容则回落 V4。

**React 19.3 + RTK 2.13**：RTK `peerDependencies.react = "^16.9.0 || ^17.0.0 || ^18 || ^19"`，React `latest = 19.3.0`；**二者无特殊约束，配对成立**（一句话确认，见 §1.2 表）。

### 1.6 Tailwind 4 官方推荐的 Vite 集成

- 官方安装文档（`https://tailwindcss.com/docs/installation/using-vite`，2026-10-09）：推荐 **`npm install tailwindcss @tailwindcss/vite`**，在 `vite.config.ts` 的 `plugins` 注册 `tailwindcss()`。**官方文档不写死 Vite 版本区间**，版本约束以 package.json 为准。
- **一手配对**：`@tailwindcss/vite@4.3.3` `peerDependencies.vite = "^5.2.0 || ^6 || ^7 || ^8"` → **含 Vite 8**，兼容成立。

### 1.7 Playwright 1.64：捆绑内核 + 境内下载通道

**捆绑版本（GitHub Release 一手，`gh api repos/microsoft/playwright/releases/tags/v1.64.0`，2026-10-09）**：

- Chromium **156.0.8078.4** / Mozilla Firefox **157.0** / WebKit **27.2**。
- npm `playwright-core@1.64.0` 的 `browsers.json` 内部 revision（决定下载 URL 与镜像覆盖）：**chromium 1248、chromium-headless-shell 1248、firefox 1555、webkit 2370**。
- `@playwright/test@1.64.0` `engines.node = ">=20"`（覆盖 24）。
- 对照：**1.63.0** 的 revision 为 chromium 1243 / firefox 1543 / webkit 2359（本票据此判镜像「落后程度」）。

**官方境内下载口径（一手，`https://playwright.dev/docs/browsers`，2026-10-09）**：

- 环境变量：`PLAYWRIGHT_DOWNLOAD_HOST`（全局），以及分浏览器 `PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST` / `PLAYWRIGHT_FIREFOX_DOWNLOAD_HOST` / `PLAYWRIGHT_WEBKIT_DOWNLOAD_HOST`。官方文档示例形态：`PLAYWRIGHT_DOWNLOAD_HOST=http://192.0.2.1 npx playwright install`。
- **URL 路径布局（本票实测反推，官方文档正文未直述）**：请求落在 `<HOST>/builds/<browser>/<revision>/<filename>`。用已知老 revision 验证：`…/builds/chromium/1200/chromium-linux.zip` → **HTTP 200**（`cdn.npmmirror.com/binaries/playwright` 前缀）。**故 npmmirror 的正确 host 前缀 = `https://cdn.npmmirror.com/binaries/playwright`**（非 `registry.npmmirror.com/-/binary/...`，后者是 OSS 目录视图、对文件返回 302，不适合直接作 DOWNLOAD_HOST）。

**npmmirror 对 1.64 内核的覆盖（一手实测，2026-10-09，目录 + 文件双探针）**：

| 内核 | 1.64 所需 rev | npmmirror 目录 `/-/binary/playwright/builds/<b>/<rev>/` | 判定 |
|---|---|---|---|
| Firefox | 1555 | **HTTP 200**（含 `firefox-ubuntu-24.04.zip` 等全套） | ✅ 覆盖 |
| WebKit | 2370 | **HTTP 200**（含 `webkit-ubuntu-24.04.zip` 等全套） | ✅ 覆盖 |
| Chromium | **1248** | **HTTP 404**（目录不存在） | ❌ **缺** |

- 更严重：npmmirror 的 **Chromium x64 近期整段缺失**——`chromium/1243/chromium-linux.zip`（1.63）与 `…/1248/…`（1.64）均 **404**；1243/1237 目录**仅存 `*-linux-arm64.zip`**；只有到 `chromium/1200` 才有完整 x64 文件。npmmirror chromium 现有最大 rev = **1243（=1.63）**。
- **判定（§2.3）**：**npmmirror 浏览器镜像当前不足以支撑「linux x64 装 Playwright 1.64 的 Chromium」**（Firefox/WebKit 可，Chromium 不可）。
- **验证方法（可复用）**：`curl -s -o /dev/null -w "%{http_code}" https://cdn.npmmirror.com/binaries/playwright/builds/chromium/<rev>/chromium-linux.zip`，并 `curl -s https://registry.npmmirror.com/-/binary/playwright/builds/chromium/ | python3 -c "import sys,json;print(sorted(int(x['name'].strip('/')) for x in json.load(sys.stdin))[-6:])"` 看最大 rev。

**官方 MCR 镜像 `mcr.microsoft.com/playwright`（一手，`/v2/playwright/tags/list` + manifest，2026-10-09）**：

- **`v1.64.0` 存在**，且为 **multi-arch（linux/amd64 + linux/arm64）**；另有 `v1.64.0-noble`、`v1.64.0-jammy`、`v1.64.0-resolute`（及各自 `-amd64/-arm64` 变体）。`v1.63.0`、`v1.62.1` 亦在。
- 该镜像**自带三内核**，`docker build FROM` / CI 内直接可用，绕开 npmmirror chromium 缺口。MCR 通常比 Docker Hub 更不易被限速，但**境内可达性本机未测**（§3）。

### 1.8 pnpm workspace + Node 24 + Prisma client 生成 / Nest Docker 基座

- **pnpm**：`latest = 12.10.1`，`engines.node = ">=18.*"`（**覆盖 Node 24**）。
- **Prisma 官方《Supported Versions》（一手，`gh api repos/prisma/prisma/contents/docs/Supported Versions.md`，2026-10-09）**：注意该页描述的是 **Prisma 8** 的硬性下限——**Runtime：Node.js 最低 24**（Bun 1.2 / Deno 2.0 尽力支持）；**TypeScript 最低 5.9**（TS 为 optional peer；装了就需 ≥5.9）；**Prisma 8 为 ESM-only，不支持 CommonJS**；并支持 **npm / pnpm / yarn / bun**。**本项目锁 7.10（stable）**，其一手约束以 package.json 为准（`engines >=24.0` 覆盖、`peer TS >=5.4.0`）。Prisma 7 的 pnpm/Node 支持口径与 v8 页一致方向（pnpm 一等公民、workspace 生成 client 为官方推荐路径），但 **Prisma 7 单独的一页 docs 正文本票未取得**（§3）。
- **NestJS 官方 Docker 部署 docs（一手，`gh api repos/nestjs/docs.nestjs.com/.../content/deployment.md`，2026-10-09）**：官方示例 Dockerfile 基座为 **`FROM node:24`**（Debian 全量镜像，非 slim）；其 Hint 原文：**"NestJS v12 requires Node.js 20.19 or later, or 22.12 or later on the 22.x line"**，并指向官方 Docker Hub `_/node` 镜像。**官方示例未直接用 slim 基座**；slim/alpine 需自行改 `FROM`。
  佐证一手镜像 tag 可得（Docker Hub `registry-1.docker.io`，带匿名 token 探 manifest，2026-10-09）：**`library/node:24`、`library/node:24-bookworm-slim`、`library/node:24-alpine` 均 HTTP 200**。
- **NestJS v12.0.0 GitHub Release（一手，`gh api repos/nestjs/nest/releases/tags/v12.0.0`）**：*"v12 requires Node.js v20.19+ or v22.12+ … the 21.x line is not supported. The latest active LTS is recommended."* 全部核心包改发 **ESM**（借 `require(esm)` 兼容既有 CJS）；ESM 项目默认测试器为 **Vitest**（与 §1.5 呼应）。**Nest 12 不以 peer 约束 TypeScript**（§1.2 表），对 TS 版本无 package.json 级冲突。

### 1.9 境内 registry mirror 对 Docker Hub 的覆盖现状 + 自查方法

**现状（2026-10-09，本环境实测 + 社区聚合列表佐证）**：

- 本票**在一台可直连境外的机器上测**，因此下面判的是「mirror **是否代理/覆盖了目标仓库**」（功能可用性），**不是**「广州政务内网能否访问」——后者须现场复测（§3 R-渠道）。
- **本票逐一实测可用（覆盖 `library/node:24` 与 `postgis/postgis:17-3.5`，manifest HTTP 200）**：
  - `https://docker.m.daocloud.io` —— DaoCloud 官方公开加速，**两者均 200**，支持命名空间仓库（非仅官方库）。
  - `https://docker.1ms.run` —— **两者均 200**，支持命名空间仓库。
- **实测不可用/受限（同上两个仓库）**：
  - `https://docker.xuanyuan.me` —— 匿名 manifest **403**（需按其文档配置，或限流）。
  - `https://hub.rat.dev` —— `/v2/` 与 manifest 均 **302**，属**导流/文档站**，非可直接填 `registry-mirrors` 的 registry 端点。
- **社区聚合口径（二手，仅作「还有哪些候选」的线索，非可用性结论）**：腾讯云开发者社区《2026 最新可用 Docker 国内镜像源加速列表》（**更新 2026-10-04**）列 `hub.rat.dev`、`docker.wanpeng.top`、`doublezonline.cloud`、`dockerpull.com`、`dockerproxy.cn`、`docker.m.daocloud.io`、AtomHub(`atomhub.openatom.cn`，仅基础镜像) 等，并标注多个「测试不可用」。该文本身强调**列表高变动、须每次自测**。
  来源：<https://cloud.tencent.com/developer/article/2485043>

**「如何自查一个 mirror 是否覆盖 `library/node` / `postgis/postgis`」——可复现操作法（本票据此得 §1.9 结论）**：

1. 取该 mirror 的 `/v2/` 挑战头，拿到 token 的 realm/service/scope：
   ```bash
   curl -s -D - -o /dev/null https://<MIRROR>/v2/library/node/manifests/24 \
     -H 'Accept: application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json'
   # 从 www-authenticate 解析 realm/service/scope
   ```
2. 用 scope `repository:library/node:pull`（或 `postgis/postgis:pull`）向 realm 换匿名 token：
   ```bash
   TOK=$(curl -s "<realm>?service=<service>&scope=repository:<REPO>:pull" | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))")
   ```
3. 带 token 探 manifest，看返回码：
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" \
     -H "Authorization: Bearer $TOK" \
     -H 'Accept: application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.docker.distribution.manifest.v2+json' \
     https://<MIRROR>/v2/<REPO>/manifests/<TAG>
   ```
   - **200**：该 mirror 覆盖此仓库/tag；**404**：未同步；**401/403**：需认证或被限（匿名不可用）；**000**：网络不可达。
4. **注意官方库前缀**：`library/node`（官方镜像在 `/v2` API 里要带 `library/` 前缀，pull 时可省）；命名空间镜像如 `postgis/postgis` 直接用 `postgis/postgis`。**只代理 `library/` 的 mirror 覆盖不到 `postgis/postgis`**——这正是「自查覆盖」要分别测两类仓库的原因。
5. Docker Hub 官方端点参照：`https://auth.docker.io/token?service=registry.docker.io&scope=repository:<REPO>:pull` 换 token 后打 `https://registry-1.docker.io/v2/<REPO>/manifests/<TAG>`。本票 `postgis/postgis:17-3.5`、`library/node:24(-bookworm-slim/-alpine)` 经此法确认在 Docker Hub 存在。

---

## 二、判定摘要

### 2.1 兼容矩阵：各包 × TypeScript 7.0.2 × Node 24

图例：✅ 官方 package.json/Release 明文支持 · 🟡 无 peer 约束，理论兼容、需运行验证 · ⛔ 被 package.json 区间拒绝

| 组件（追新锁版） | TS 7.0.2 | Node 24 | 依据 |
|---|---|---|---|
| `@nestjs/core` 12.1.2 / `@nestjs/cli` 12.0.8 | 🟡（不 peer 约束 TS；但 CLI 依赖 `ts-loader`/`fork-ts-checker` 走编译器 API） | ✅ `>=20` / `>=20.11` | §1.2 / §1.8 |
| `prisma` 7.10.0 / `@prisma/client` 7.10.0 | ✅ `peer TS >=5.4.0`（7∈区间） | ✅ `^20.19\|^22.12\|>=24.0` | §1.2 |
| `vite` 8.3.4 / `@vitejs/plugin-react` 6.1.2 | 🟡（不约束 TS） | ✅ `^20.19.0\|>=22.12.0` | §1.2 / §1.5 |
| `vitest` 5.0.3 | 🟡（不约束 TS） | ✅ `^22.12\|^24\|>=26`（**弃 Node 20**） | §1.2 / §1.5 |
| `tailwindcss` 4.3.3 / `@tailwindcss/vite` 4.3.3 | 🟡 | ✅（Vite 8 已含） | §1.6 |
| `react` 19.3.0 / `@reduxjs/toolkit` 2.13.0 | ✅（`^19`） | ✅ `>=0.10` | §1.2 / §1.5 |
| `@playwright/test` 1.64.0 | 🟡 | ✅ `>=20` | §1.2 / §1.7 |
| `argon2` 0.45.1 | 🟡（N-API v8，与 TS 无关） | ✅ `>=16.17`；**linux x64+arm64 glibc/musl 预编译随包** | §1.4 |
| `pnpm` 12.10.1 | ✅ | ✅ `>=18.*` | §1.8 |
| **`typescript-eslint` 8.71.1** | **⛔ `peer TS >=4.8.4 <6.1.0`** | ✅ | §1.2 / §2.4 R1 |

**净判定**：**除 `typescript-eslint` 外，追新的后端/前端/测试/DB/包管理器全部在「TS 7.0.2 + Node 24」的官方区间内成立。**

### 2.2 追新基线下建议锁定的具体 major（非 rc/beta/dev）

| 槽位 | 锁定 | 排除项 |
|---|---|---|
| Node | **24（Krypton LTS）** | 22 作维护 LTS 备选；26 非 LTS |
| TypeScript | **7.0.2**（编译 `tsc`）+ **`@typescript/typescript6` 6.0.2**（供需编译器 API 的工具，直到 7.1 出新 API） | `next 7.1.0-dev`（dev） |
| NestJS | **12.1.2**（core/cli 走 12 线） | 11 |
| Prisma | **7.10.0** | **8.0.0-rc.22（rc，按裁决排除）** |
| Vite | **8.3.4** | 6.4.4（`previous`）；7.3.7（7 线末） |
| Vitest | **5.0.3** | 4.1.11（若须保 Node 20 则回落 V4）；3.2.7 |
| Tailwind | **4.3.3** | v3-lts 3.4.19 |
| React / RTK | **19.3.0 / 2.13.0** | — |
| Playwright | **1.64.0** | 1.62.1（初稿值，上调） |
| argon2 | **0.45.1** | 1.0.0-alpha（alpha） |
| pnpm | **12.10.1** | — |

> 相对会话初稿的**上调项**：TS 6.0.2→7.0.2、Vite 7→8、Vitest 3→5、Playwright 1.62.1→1.64；**维持**：NestJS 12、Prisma 7.10、React 19、RTK、Tailwind 4、argon2；**新增基座**：Node 24、pnpm 12。

### 2.3 渠道可得性判定

| 渠道 | 判定 | 依据 |
|---|---|---|
| npm 包（各 stable） | ✅ 可得（`registry.npmjs.org` 直读；境内可用 npmmirror npm registry） | §1.1–§1.8 均取到一手 dist-tags |
| argon2 二进制 | ✅ **随 npm tarball 附带 linux x64/arm64 glibc+musl**，容器 install 不联网编译 | §1.4 |
| Playwright Chromium x64（1.64，rev 1248） | ❌ **npmmirror 浏览器镜像缺**（连 1.63 的 x64 也缺，最新仅 arm64） | §1.7 |
| Playwright Firefox/WebKit（1.64） | ✅ npmmirror 覆盖（1555/2370 全套 200） | §1.7 |
| Playwright **官方 MCR `playwright:v1.64.0`** | ✅ **存在、multi-arch**；自带三内核，是 1.64 落地主推荐 | §1.7 |
| Docker Hub `library/node:24(-slim/-alpine)` | ✅ 官方存在；**DaoCloud(`docker.m.daocloud.io`)/`docker.1ms.run` 覆盖** | §1.8 / §1.9 |
| `postgis/postgis:17-3.5` | ✅ 官方存在；上述两 mirror 覆盖 | §1.9 |
| 境内 mirror 端到端可达性 | ❓ **本机不可测**（本环境可直连境外） | §0 / §3 |

### 2.4 红旗清单（「追新组合不兼容」与渠道缺口）

- **R1（硬不兼容，最高优先）— TypeScript 7 与 typescript-eslint**。`typescript-eslint@8.71.1` peer 上限 **`<6.1.0`**，**拒绝 TS 7**；且官方口径 **TS 7.0 不带编译器 API（7.1 才出新 API）**，typescript-eslint/ts-loader 类工具**必须依赖 TS 6**。绿地若采纯 `typescript@7.0.2`，则类型感知 lint、`nest build` 的 webpack/ts-loader 路径、`fork-ts-checker` 类型检查均可能失败。**缓解（三选一，属决策票）**：① 双包并行：`typescript@7.0.2` 供 `tsc`，`@typescript/typescript6@6.0.2` 供 API 型工具；② 暂锁 **TS 6.0.2**，待 7.1 及 typescript-eslint 适配再升；③ lint 改用 **Oxlint / tsgo lint**（VoidZero 称 tsgo lint 已稳定），放弃 typescript-eslint 类型规则。
- **R2（渠道）— Playwright 1.64 的 Chromium x64 无法经 npmmirror 取得**。境内 npm 安装路径下 `npx playwright install chromium` 会因 `…/builds/chromium/1248/chromium-linux.zip` 缺失而失败。**缓解**：`docker build FROM mcr.microsoft.com/playwright:v1.64.0`（自带内核），或自建/改用覆盖 Chromium 的 `PLAYWRIGHT_DOWNLOAD_HOST` 源，或离线缓存内核。
- **R3（次级）— Vitest 5 弃 Node 20**。V5 `engines >=22.12 || ^24`。绿地基座为 Node 24 不受影响；但**任何仍钉 Node 20 的 CI/镜像会直接不满足 V5**，须统一到 24。
- **R4（次级）— Prisma 8 的 ESM-only 下限**。官方《Supported Versions》对 **Prisma 8** 要求 **Node ≥24、TS ≥5.9、ESM-only**。本票锁 **7.10** 规避了该激进下限；一旦后续把 Prisma 也追到 8.0 stable，须同步满足 TS ≥5.9（R1 的 TS 6.0.2 桥接仍 ≥5.9，兼容）且应用转 ESM。
- **R5（工具链细节）— Nest `12.0.0` 的 peer 曾误指 `@nestjs/common@^11`**（一手 dist-tags：12.0.0 的 peer 是 `^11.0.0`，12.0.1 起修正为 `^12.0.0`）。锁定 **≥12.0.1（本票取 12.1.2）**即无此错位。

---

## 三、未能查证与残余风险

| # | 缺口 | 影响 | 建议查证途径 |
|---|---|---|---|
| 1 | **TypeScript 官方 docs 的「框架支持区间」映射**（NestJS/Prisma/Vite/Vitest 各自被 TS 官方声明支持到哪个版本） | 低——已由**各包自身 package.json peer**（更权威）替代 | devblogs.microsoft.com/typescript 无此表；以 §1.2 为准即可 |
| 2 | **TS 7.0 原生 `tsc` 与 typescript-eslint / ts-loader / fork-ts-checker 的实测兼容**（是否须回 6.0.2、有无官方适配时间表） | **高（R1 核心）** | TypeScript 7.1 公告 + typescript-eslint 仓库 issue/roadmap；实测 `tsc`+`eslint` |
| 3 | **Prisma 7 单独一页官方 docs 正文**（本票取得的是 Prisma 8 版《Supported Versions》） | 中——7.10 约束已由 package.json 覆盖 | prisma.io/docs 7.x 版；Prisma 7 release notes |
| 4 | **argon2@0.45.1 预编译在 Node 24 的运行时加载实测**（本机未 `require('argon2')`） | 低（N-API v8 稳定 ABI） | 目标容器内 `node -e "require('argon2').hash('x','y')"` |
| 5 | **Playwright 官方文档对下载 URL 路径布局的原文**（本票用已知 rev 反推 `<host>/builds/<browser>/<rev>/<file>`） | 低——反推已被 200 验证 | playwright.dev/docs/browsers 深链；`playwright-core` 源码 registry.ts |
| 6 | **MCR `playwright` 镜像 tag 的确切命名规则**（`v1.64.0` 已确认存在；`v1.64-noble` 等无 OS-flavor 简写） | 中——影响 `FROM` 写法 | `mcr.microsoft.com/v2/playwright/tags/list` 现查（已据以确认 v1.64.0 全套变体存在） |
| 7 | **各境内 Docker mirror / npmmirror 在「广州政务内网出口」的端到端可达、限速、认证** | **高（渠道决定性）** | **必须在目标内网现场复测** §1.9 的自查脚本 |
| 8 | **`docker.xuanyuan.me` / `hub.rat.dev` 的正确使用方式**（本机匿名 403/302） | 中 | 各站官方文档；本机结论仅「匿名直连不可用」 |
| 9 | **NestJS 是否另有官方 slim/alpine 基座口径**（deployment.md 示例用全量 `node:24`） | 低——`node:24-bookworm-slim`/`-alpine` 已在 Docker Hub 确认存在 | docs.nestjs.com/deployment；官方 `_/node` 镜像页 |
| 10 | **TypeScript 7.1 新 API 的实际落地时间与形态**（决定 R1 是否可长期靠 7.x 收敛） | 中 | devblogs.microsoft.com/typescript 未来公告 |

**残余风险综述**：绿地若严格执行「追新 = latest stable major」，**唯一在 package.json 层被硬拒的组合是 TypeScript 7 + typescript-eslint**（R1），必须以并行 TS6 / 暂缓 TS7 / 换 linter 三者之一显式处置，不能假定「装得上」。渠道层**唯一确定缺口是 Playwright 1.64 的 Chromium x64 无法经 npmmirror 取得**（R2），应以官方 MCR `playwright:v1.64.0` 为主通道。其余包在 Node 24 下官方区间全部成立。**所有境内 mirror 的最终可用性判定，本机不可得，须现场复测**（研究环境可直连境外，只能证「mirror 是否覆盖仓库」，不能证「内网能否访问」）。
