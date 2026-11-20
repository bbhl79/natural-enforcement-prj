# PROTOTYPE #12 事实与坑清单（前端与脚手架纵切）

> 纵切二「前端与脚手架」。分支：`prototype/foundation-slice-2`（基于 `prototype/foundation-slice-1`，throwaway，不合入 dev）。
> 本文件是 #12 决议评论的原始素材与两份 SPEC（Spec-工程基座 / Spec-e2e体系）的直接输入。
> 除注明外，全部为 2026-11-20 容器内实测结论。前置事实见 `devenv/NOTES.md`（#11）。

## 0. 验证结果总览（2026-11-20/21 容器内实测）

| 票面要求 | 验证证据 |
|---|---|
| React+Vite+RTK Query+AntD+Tailwind 前端接通后端真实数据 | apps/web 完整实现（React 19.3.1 / Vite 8.3.8 / RTK Query 2.15 / antd 6.7.1 / Tailwind 4.3.5 / react-leaflet 5）；RTK Query 手写消费 @ne/contracts（#9 决议：路由常量 + 推断类型 + `transformResponse` zod 运行时校验） |
| 含地理特性展示 | Leaflet 地图：/nearby（PostGIS ST_DWithin + ST_Distance）红点标记 + 查询半径圈 + 距离表；经 web 源 curl 实测返回真实按距离排序数据（天安门 0m 起） |
| 前端可达（无宿主端口不变量） | `devenv web` 发布唯一端口（compose profile 隔离）；宿主 curl localhost:5173 → 200 HTML；/health、/enforcement-points/nearby、400 校验均经 preview proxy → api:3000 走通；证据上传 pending→ready（sha256 回写）+ content 回读字节一致（BullMQ/rustfs 链路经 web 源全通） |
| lint/typecheck/test 全链容器内跑通 | 基线（纯 web 并入后）：lint 0 错 / typecheck 全过 / 33 用例全绿（contracts 6 + api 16 + web 11，web = jsdom+RTL 组件测试 + 契约消费校验 + 纯函数） |
| 脚手架生成器初版（app/package/Nest 模块/前端页面） | `devenv gen` 四 kind 全实测生成成功；容器内生成器 + 宿主锚点 stdin tar / 生成物 stdout tar 双向通道；nest-module/page 自动注册（app.module.ts / App.tsx 补丁）；app/package 自动补 workspace.Dockerfile manifest COPY + lockgen |
| 生成物开箱即过质量门 | 四 kind 齐生成后：lint 0 错 / typecheck 全过（含 demo-pkg、demo-worker）/ **37 用例全绿**（+ping 模块 spec、StatsPage spec、demo-pkg、demo-worker 各 1）；幂等保护实测：重复 gen 被拒（"目标已存在"，无部分写入；退出码经 bash 管道归一为 2，SPEC 时统一枚举） |
| 产出事实沉淀 | 本文档（NOTES-slice2.md）+ COMMANDS.md 扩充（web/gen 命令） |

验证后演示生成物已回滚（分支只留原型本体：web 应用 + 生成器 + 命令面）；演示轮次的全部绿证据见上表。

## 1. 前端栈版本矩阵落地（npm registry 2026-11-20 实查）

| 项 | registry latest | 采用 | 备注 |
|---|---|---|---|
| react / react-dom | 19.3.1 | 同左 | React 19 世代 |
| vite | 8.3.8 | 同左 | **v8 已转 rolldown（无 esbuild 依赖）**，原生模块全走 napi 预构建 |
| @vitejs/plugin-react | 6.3.0 | 同左 | |
| antd | 6.7.1 | 同左 | v6；peer react ≥18 |
| @ant-design/icons | 6.3.4 | 同左 | 需显式安装（antd 不内捆绑） |
| @reduxjs/toolkit / react-redux | 2.15.0 / 9.3.1 | 同左 | RTK Query 手写消费契约（#9 决议，不做 codegen） |
| tailwindcss / @tailwindcss/vite | 4.3.5 | 同左 | v4 CSS-first；Vite 插件免 PostCSS 配置 |
| react-leaflet / leaflet | 5.0.0 / 1.9.4 | 同左 | react-leaflet v5 面向 React 19 |
| jsdom | 31.0.1 | 同左 | vitest 5 环境 |
| @testing-library/react | 16.3.3 | 同左 | peer 需显式加 @testing-library/dom ^10 |
| @testing-library/jest-dom | 8.0.0 | 同左 | `@testing-library/jest-dom/vitest` 子路径直供 vitest |
| eslint-plugin-react-hooks | 7.1.1 | 同左 | flat config 下手工挂载（见 §3） |

**供应链事实（对 SPEC 有直接价值）**：前端栈零新增 `allowBuilds`——vite 8 无 esbuild（rolldown/lightningcss/@tailwindcss/oxide 全走 napi 预构建 optional deps，不带 postinstall）。对比后端（prisma/msgpackr 两个原生构建审批），前端依赖面在 pnpm 12 构建脚本审批下天然干净。

**pnpm 12 新发现：包内 AI 指令审批（agent skills）**：安装时警告 `Agent skills awaiting approval: @reduxjs/toolkit. Run "pnpm approve" to review them`——pnpm 已把"包携带 AI-agent 技能/指令"纳入审批面（与 allowBuilds 平行的第三层供应链控制）。当前仅告警不阻断；SPEC 需决策审批策略（AI-native 仓库对"依赖向 agent 注入指令"应默认拒绝）。

## 2. 架构决策：无 bind 架构下的前端形态

- **零宿主端口不变量保持**：`devenv up` 不启动 web（compose profile `web` 隔离）；web 是唯一显式端口例外——浏览器在宿主机，无法走容器内网，`devenv web [--port N]` 人类 opt-in。
- **浏览器只触一个源**：web 服务跑 `vite preview`（供镜像烘焙产物），api 调用（/enforcement-points、/evidence、/health）经 preview **proxy 转发到 `http://api:3000` 容器内网**——api 本身仍零端口暴露。
- **无 HMR（硬事实）**：代码烘焙进镜像、无 bind mount → 容器内无文件变更事件，vite dev server 的 HMR 无从触发。前端改动反馈环 = 重新 `devenv web`（ensure_fresh_workspace 层缓存秒级重建）→ 浏览器刷新。SPEC 决策点：是否接受该反馈环（agent 主导开发的场景可接受；若人类高频改前端需 bind 例外或 docker cp 同步环）。
- **presigned URL 在浏览器不可达**：/evidence/:id/url 返回容器内网地址（http://rustfs:9000/...），浏览器侧无法打开——前端下载走同源代理 /evidence/:id/content。SPEC 需在契约层明确"presigned URL 仅服务间可用"。
- 地图瓦片由浏览器自行拉取 OSM（瓦片不可达时标记仍渲染，仅无底图）——容器网络零参与。

## 3. 工程化事实（lint / typecheck / test 全链）

- **TSConfig 分层**：新增 `@ne/tsconfig/web.json`（moduleResolution bundler + jsx react-jsx + dom lib）——浏览器包与 Node 包（node.json/nodenext）分层是刚需，不是可选项。`.js` 后缀导入（`./x.js` → `x.ts(x)`）在 bundler 解析与 vite/rolldown 下均成立，与全仓 nodenext 风格统一。
- **Tailwind 4 × antd 6 共存**：Tailwind 只引 `theme.css` + `utilities.css`（**跳过 preflight**）——preflight 的元素级 reset 与 antd 组件样式互踩（按钮背景、边框消失类问题）。
- **antd 6 + jsdom**：jsdom 无 `matchMedia`，antd 响应式观察者（Table/Grid 经 useBreakpoint）挂载即调用——测试 setup 必须 mock（含 legacy `addListener`），否则组件测试全线 TypeError。
- **eslint-plugin-react-hooks v7 flat config**：`configs` 预设键不稳定，手工 `plugins: {'react-hooks': ...}` + 显式两条规则最确定。纯 .mjs 工具脚本需补 `languageOptions.globals`（process 等）——根配置无 node 全局。
- **RTL（@testing-library/react 16）+ vitest 5**：不开 `globals: true` 时**自动 cleanup 不生效**——组件测试显式 `afterEach(cleanup)`；jest-dom 走 `@testing-library/jest-dom/vitest` 子路径。
- **@nestjs/common 12.6.0 的 SchemaObject 类型收紧**：`z.toJSONSchema()` 返回值不再直接可赋 `@ApiBody({schema})`（12.5.1 可以）——占位处需显式 `as SchemaObject` 断言（根因是依赖漂移，见 §5.8）。
- **契约消费方式（#9 决议落地验证）**：web 手写 RTK Query，路由常量 + 推断类型来自 `@ne/contracts`，响应经契约 zod schema `transformResponse` 运行时校验——传输层失配在前端即刻暴露（fail fast）。发现缺口：契约包缺 create 响应 schema（POST /enforcement-points 返回 {id} 目前只有 TS 类型无运行时校验）。
- **unicode 文件名临时契约**：浏览器 fetch 的 header 同样受 Latin-1 限制——上传时 `x-original-name: encodeURIComponent(name)`，展示时 `decodeURIComponent`。规范化路径（RFC 8187）仍是 SPEC 决策点（#11 遗留）。

## 4. 脚手架生成器（devenv gen）

- **形态**：`devenv/gen/gen.mjs`（零第三方依赖，容器内 node 运行）+ 四 kind：`app` / `package` / `nest-module` / `page`。
- **文件双向通道（无 bind 架构的关键设计）**：
  - 出：生成器 stdout = tar 流，devenv 侧 `tar -x -C $REPO_ROOT` 解包（比 migrate:create 的留名容器 + docker cp 免容器生命周期管理）；
  - 入：宿主锚点文件（`devenv/workspace.Dockerfile`、`apps/api/src/app.module.ts`、`apps/web/src/App.tsx`）经 **stdin tar** 进容器解包到 `/tmp/host-state`——补丁以**宿主当前内容为基准**。实测 `compose run --rm -T` 的 stdin 管道可用（-T 禁 tty 是前提）。
- **幂等保护**：目标已存在（镜像烘焙件 ∪ 宿主锚点 tar）→ 退出 4；已注入过的补丁（锚点内容命中）→ 退出 4；全有或全无（先全部校验再写盘）。
- **注册机制**：nest-module 正则锚点补 `app.module.ts`（import 区末尾 + imports 数组头）；page 用 `// @gen:page-import` / `// @gen:page-item` 标记行注入 `App.tsx`；app/package 用 `# @gen:pkg-copy` 标记行补 **`workspace.Dockerfile` 两靶的 manifest COPY 清单**（见下）。标记插入必须**按整行**处理（字符串替换会把插入点砸进注释行内部，产出畸形 Dockerfile 指令——实测踩坑）。
- **无 bind 烘焙架构的隐藏耦合（重要发现）**：workspace.Dockerfile 的 lockgen/deps 靶按**显式清单** COPY 各包 package.json——新包不进清单 → lockfile 解析不到该包（静默！lockgen 照常成功，lockfile 里就是没有它）→ 后续 deps 靶 `--frozen-lockfile` 直接断。生成器必须同时补 COPY 行（两靶各一）。
- **--no-refresh 批量模式**：连续生成时跳过镜像刷新（免每 gen 一次重建）；安全性依赖"补丁基准=宿主锚点 tar"。**镜像烘焙的生成器自身可能滞后于宿主**（实测踩坑：--no-refresh 跑到旧版生成器）——SPEC 决策点：生成器是否需要独立于 workspace 镜像的装载通道（如挂载单文件 / 生成器自带版本自检）。
- **app/package 类生成的完整闭环成本**：gen（秒级）→ lockgen 重生成 lockfile（分钟级，`--lockfile-only` 不拉包）→ `devenv build`（**deps 层全量重装**——慢网 40 分钟级；见 §5.9）→ 质量门。生成→过门的真实成本全在依赖层重建。
- **lockgen 残留容器坑**：regen 中途异常退出会留下持锁容器（`docker create` 后未 rm）→ 下次 `rmi` 报 "image is in use" 连锁失败——regen 前置清理（ancestor 过滤强删）已固化进 devenv。
- **v1 边界**：nest-module 生成物不自动加契约 schema（真实模块应同步 @ne/contracts，记录为 SPEC 待议）；模板内容与 slice-1 手写包逐字对齐是"开箱即过质量门"的关键（两处实测修正：app 模板必须带 `@types/node`——node.json 基线 `types:["node"]` 显式加载；模板拼装产物必须 JSON.parse 自检——双逗号曾产出畸形 package.json 且静默污染 lockgen 下游）。

## 5. SPEC 输入清单（决策点汇总）

1. web 端口例外策略：固定默认端口 vs 按 worktree 哈希分配（多 agent 并发各开 web 时冲突）。
2. 前端反馈环定案：无 HMR 的重建+刷新是否为基线；bind 例外 / docker cp 同步环是否值得引入。
3. presigned URL 的契约定位（服务间专用 vs 浏览器可达需网关）。
4. 契约包补齐 create 响应 schema；响应校验（transformResponse zod parse）是否定为 web 侧强制规范。
5. unicode 文件名传输契约（与 #11 遗留项合并决策）。
6. 脚手架 nest-module 是否联动契约包生成（schema + 路由常量）。
7. eslint React 规则面（react-hooks 已启用；react/jsx-key 等是否引入 eslint-plugin-react）。
8. **catalog 版本域策略（本票实测踩坑）**：`^12.5.1` 的 @nestjs/common 在 lockgen 全量重解析时静默漂到 12.6.0（schema 类型收紧 → api 编译断）——lockfile 一直是隐式版本锁，任何 lockgen 重跑都会把 caret 范围重解析到当天 latest。zod 精确 pin 则纹丝不动。建议 SPEC 定「catalog 一律精确 pin（=npm 镜像 tag+digest 双层锁的 npm 对应物）」或「caret + lockgen 仅在专用命令下允许」。另：`devenv gen` 的自动 lockgen 是本机制的常态触发源，需随此决策一并定案。
9. **新增 workspace 包的依赖层重建成本**：无 bind 烘焙架构下，包集合（任何 package.json/lockfile/workspace.Dockerfile 变更）变化 → deps 层缓存全失效 → `pnpm install --frozen-lockfile` 全量重下（慢网实测 ~40 分钟；层内 pnpm store 无跨构建复用）。SPEC 决策点：pnpm store 命名卷挂载 / compose run 内跑 install（免镜像层）/ BuildKit cache mount（需 buildx，本机无）——「脚手架生成物开箱即过门」的用户体验取决于此。
10. **生成器自装载通道**：gen.mjs 烘焙在 workspace 镜像内 → 生成器自身更新滞后于宿主（--no-refresh 批量场景实测踩坑）。SPEC 决策点：stdin tar 顺带传 gen.mjs 自检版本 / 独立小镜像。
