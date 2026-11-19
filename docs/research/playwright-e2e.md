# Research：容器内 Playwright 与 e2e 工程实践（票 #6）

- 日期：2026-11-16
- 状态：结论已核验，可供 e2e 原型与 Spec-e2e体系 直接采用
- 面向：AI-Native 团队（1 人类 + 多 agent），WSL2/Linux 一等公民，宿主机只存代码（仅 docker engine + git + bash），一切运行时在容器内；e2e 隔离粒度为"基础设施容器共享，数据级隔离"
- 方法：全部关键结论来自一手来源（playwright.dev 官方文档、microsoft/playwright 仓库与 Dockerfile、MCR 镜像 API、GitHub releases API、docs.github.com、learn.microsoft.com），逐条附来源

---

## 0. 结论先行

1. **版本基线：Playwright v1.65.1（2026-11-13 发布），Node.js 22/24/26，Ubuntu 24.04（noble）。** v1.65 起 Node 20 不再被测试，官方 Docker 镜像内置 Node 26；v1.63 起 Ubuntu 20.04 不再支持。npm 包与镜像必须同版本 pin。
2. **执行器形态：e2e 直接使用官方镜像 `mcr.microsoft.com/playwright:v1.65.1-noble` 作为执行容器**（内置三浏览器 + 全部系统依赖 + 字体 + Node 26），不要自建浏览器依赖；需要项目运行时（pnpm/nest 等）时以官方 Dockerfile 同款方式自建 FROM 该镜像。Alpine/musl 不可用（Firefox/WebKit 需要 glibc）。
3. **容器运行三参数：`--init`（防僵尸进程）+ `--ipc=host`（绕过 64MB /dev/shm，否则 Chromium 崩溃）+ root 运行可信测试（sandbox 自动禁用）**；非 root 与 seccomp 仅在跑不可信站点时需要。
4. **数据策略：测试幂等 + 唯一命名数据优先，重置兜底。** 利用 Playwright 原生隔离（worker 进程独立、每测试独立 BrowserContext、storageState setup project、v1.63 命名测试锁）+ 基础设施侧数据级隔离（每 run 独立 database/schema、bucket 前缀、Redis 键空间），与地图 #1 的隔离不变量逐字对齐。
5. **CI 模式：GitHub Actions 上推荐"devenv 起完整栈（容器内起栈）+ e2e job 用 mcr 官方镜像容器"。** `services:` 只适合无状态中间件，表达不了完整应用栈，也绕过 devenv 唯一入口不变量；仅当 SPEC 明确降级时才用 services 承载 PostGIS/Redis。
6. **Agent 消费失败产物已经是一等公民：** `failures`/`onlyFailures` 报告降噪、JSON 报告机器可解析、trace.zip（DOM 快照+网络+console+源码）本地 Trace Viewer、`@playwright/cli`（agent-cli）提供 `--debug=cli` + `attach` 的暂停式调试与 token 高效命令面，外加官方 MCP server。失败产物链路：**JSON(onlyFailures) 定位 → trace.zip 取证 → agent-cli attach 交互复现 → 修复**。
7. **敏感数据警告：官方明确 trace/报告可能含凭据**，产物只上传可信存储（本仓 artifact 或内部存储），禁止传第三方站点。

---

## 1. 容器运行清单（Linux 容器 / WSL2 无头）

### 1.1 版本与镜像事实（2026-11 时点）

| 事实 | 数值 | 来源 |
|---|---|---|
| 最新稳定版 | v1.65.1（2026-11-13）；v1.65.0（11-05）；v1.64.1（10-14） | [GitHub releases API](https://github.com/microsoft/playwright/releases) |
| Node.js 支持 | 22 / 24 / 26（v1.65 起 Node 20 不再测试） | [官方 release notes](https://playwright.dev/docs/release-notes) |
| 镜像内 Node | Node 26（`NODE_VERSION=26`，Node 25+ 需 `libatomic1`） | [Dockerfile.noble](https://github.com/microsoft/playwright/blob/main/utils/docker/Dockerfile.noble) |
| 官方镜像 | `mcr.microsoft.com/playwright`；标签 `v1.65.1`、`v1.65.1-noble`(24.04)、`-jammy`(22.04)、`-resolute`(26.04)，各有 `-amd64`/`-arm64` 变体（MCR API 实测存在） | [playwright.dev/docs/docker](https://playwright.dev/docs/docker)、MCR tags API |
| 镜像内容 | 三浏览器 + 系统依赖 + 字体；**不含 playwright npm 包**（需自行 `npm i -D @playwright/test`）；仅供测试/开发，禁止用于不可信站点 | [playwright.dev/docs/docker](https://playwright.dev/docs/docker) |
| 不支持 | Alpine/musl（Firefox、WebKit 需 glibc） | [playwright.dev/docs/docker](https://playwright.dev/docs/docker) |
| 浏览器 | v1.65：Chromium 158 / Firefox 159 / WebKit 27.2 | [release notes](https://playwright.dev/docs/release-notes) |
| 浏览器缓存路径 | 镜像内 `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`；自管时可设 `=0`（安装进 node_modules，密闭hermetic） | [Dockerfile.noble](https://github.com/microsoft/playwright/blob/main/utils/docker/Dockerfile.noble)、[playwright.dev/docs/browsers](https://playwright.dev/docs/browsers) |

**清单（直接采用）：**

- [ ] `package.json` 固定 `@playwright/test@1.65.1`（exact，无 `^`）。
- [ ] e2e 执行器镜像 tag 固定 `mcr.microsoft.com/playwright:v1.65.1-noble`；升级 Playwright 时**两者同步改**——版本不匹配时浏览器可执行文件找不到（官方明确警告）。
- [ ] 选 `noble` 基线（Ubuntu 24.04 LTS）；`jammy` 仅为过渡兼容，`resolute`（26.04）过新，均不作默认。
- [ ] 需要项目运行时的执行器镜像自建方式（官方同款）：
  ```dockerfile
  FROM mcr.microsoft.com/playwright:v1.65.1-noble
  # 官方自建参考：FROM node:26-bookworm + RUN npx -y playwright@1.65.1 install --with-deps
  ```

### 1.2 运行参数（无头，Linux 容器）

- [ ] **`--init`**：防 PID=1 僵尸进程（官方推荐）。
- [ ] **`--ipc=host`**：Chromium 共享内存不足会崩溃（官方原话 "can run out of memory and crash"）；替代方案 `--shm-size` 调大或启动参数 `--disable-dev-shm-usage`。
- [ ] **root 运行（可信代码）**：e2e 跑自家应用属可信场景，root 即可，Chromium sandbox 以 root 自动禁用；对不可信站点才需要 `--user pwuser` + seccomp profile（放行 clone/setns/unshare）。
- [ ] 无头为默认；若需 headed（如 codegen 调试），镜像内置 Xvfb，用 `xvfb-run npx playwright test`。
- [ ] 只跑无头可裁剪下载：`npx playwright install --with-deps --only-shell`（仅 headless shell，不装完整 Chromium）。
- [ ] 远程连接容器内浏览器服务器：`npx playwright run-server` + `PW_TEST_CONNECT_WS_ENDPOINT`，或 MCP/agent-cli 守护进程方式；容器访问宿主服务用 `--add-host=hostmachine:host-gateway`（容器内 `localhost` 不指向宿主）。

来源：[playwright.dev/docs/docker](https://playwright.dev/docs/docker)、[playwright.dev/docs/browsers](https://playwright.dev/docs/browsers)、[playwright.dev/docs/ci](https://playwright.dev/docs/ci)

### 1.3 字体与系统依赖

官方镜像已含全套字体与依赖（由 `playwright-core install-deps` 安装），**无需额外处理**。自建镜像/裸机时必须补齐。noble 的字体包清单（一手来源 `nativeDeps.ts`）：

```
fonts-liberation  fonts-noto-color-emoji  fonts-unifont
fonts-ipafont-gothic  fonts-wqy-zenhei  fonts-tlwg-loma-otf  fonts-freefont-ttf
xfonts-cyrillic  xfonts-scalable  libfontconfig1  libfreetype6
```

**清单：**

- [ ] 用官方镜像 → 字体零操作；自建镜像 → 必须执行 `npx playwright install --with-deps`（它会安装上述字体与 libnss3/libatk 等库），不要手抄 apt 列表（随版本漂移）。
- [ ] 视觉回归（`toHaveScreenshot`）对字体极其敏感：本地/CI/镜像字体不一致会产生像素级 diff，唯一解是**本地与 CI 用同一镜像跑 e2e**（本项目不变量"一切在容器内"天然满足）。
- [ ] 中文/emoji 内容渲染依赖 `fonts-wqy-zenhei`、`fonts-noto-color-emoji` 等，官方镜像已含；若自建镜像缺中文字体，截图断言必挂。

来源：[nativeDeps.ts（官方依赖清单）](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/registry/nativeDeps.ts)、[playwright.dev/docs/browsers](https://playwright.dev/docs/browsers)

### 1.4 产物落盘（video / trace / 报告）

| 产物 | 落盘位置 | 写入时机 | 关键配置 |
|---|---|---|---|
| video（webm） | outputDir（默认 `test-results/`）每测试一目录 | **browser context 关闭时**才写盘；context 未 close 则丢失 | `video: 'on' \| 'retain-on-failure' \| 'on-first-retry'`；默认分辨率 = viewport 缩放到 800x800，精确分辨率用 `size` |
| trace.zip | outputDir 每测试一目录 | 测试结束/重试结束 | `trace: 'on-first-retry'`（配 retries，官方推荐 CI 默认）、`'retain-on-failure'`、`'on-all-retries'`；`'on'` 性能代价大，不推荐常态开 |
| 截图/diff | outputDir | 断言时 | 视觉比较 diff 作为附件进 trace/报告 |
| HTML 报告 | `playwright-report/`（自包含文件夹） | 运行结束 | `PLAYWRIGHT_HTML_OUTPUT_DIR`、`open: 'never'` / `PLAYWRIGHT_HTML_OPEN=never` |
| JSON 报告 | `results.json`（或 stdout） | 运行结束 | `PLAYWRIGHT_JSON_OUTPUT_NAME/_FILE/_DIR` |
| JUnit | `results.xml` | 运行结束 | `PLAYWRIGHT_JUNIT_OUTPUT_NAME/_FILE/_DIR` |
| blob 报告 | `blob-report/report-*.zip` | 运行结束 | `PLAYWRIGHT_BLOB_OUTPUT_FILE`，供分片合并 |

**清单：**

- [ ] CI 配置基线：`trace: 'on-first-retry'` + `retries: 1~2` + `video: 'retain-on-failure'`（磁盘换诊断力）。
- [ ] `globalTimeout` 必设（如 60min）：挂死的运行仍能产出报告，而不是被 CI 硬杀后什么都没有；job 级 `timeout-minutes` 要显著大于 globalTimeout。
- [ ] `outputDir`、`playwright-report`、`blob-report` 全部加入 `.gitignore`；CI 以 artifact 上传（`if: ${{ !cancelled() }}` + `retention-days: 30`，官方模板做法）。
- [ ] 产物目录挂载为 volume（devenv 编排时），保证容器销毁后 agent 仍能在宿主工作区拿到产物。

来源：[playwright.dev/docs/videos](https://playwright.dev/docs/videos)、[playwright.dev/docs/trace-viewer](https://playwright.dev/docs/trace-viewer)、[playwright.dev/docs/test-reporters](https://playwright.dev/docs/test-reporters)、[playwright.dev/docs/ci](https://playwright.dev/docs/ci)

### 1.5 WSL2 专项

前提：本项目浏览器从不直接跑在 WSL2 宿主（不变量），以下只涉及 WSL2 作为容器宿主的注意点。

- [ ] **docker engine 装在 WSL2 发行版内（项目白名单形态）**：不要同时装 Docker Desktop——官方警告两者共存会冲突；若用 Docker Desktop 则需 WSL ≥ 2.1.5。
- [ ] 避免 Docker Desktop 的 "Docker VMM" 模式跑本项目：该模式下发行版内**没有 docker socket**（SDK/devenv 无法连接），且只能 bind-mount Windows 路径（`/home/...` 会 Mount denied）——与"宿主机只存代码、WSL2 内执行"的形态冲突。
- [ ] WSL2 VM 默认内存 = Windows 总内存 50%，跑全栈 + 多 worker 浏览器可能吃紧：在 `%UserProfile%\.wslconfig` 设 `memory=`（如 12GB）并 `wsl --shutdown` 生效；可开启 `autoMemoryReclaim=gradual`（Docker 官方建议）回收页缓存。
- [ ] systemd 在发行版内用 `/etc/wsl.conf` 的 `[boot] systemd=true` 启用（docker engine 服务依赖）。
- [ ] `localhostForwarding` 默认 true：容器映射端口可从 Windows 侧 `localhost` 访问，供人类查看 HTML 报告/Trace Viewer。
- [ ] 代码放 WSL2 Linux 文件系统（`/home/...`）而非 `/mnt/c`：跨 9P 文件系统的 I/O 与 inotify 明显劣化（e2e 输出目录大量小文件写入场景敏感）。

来源：[learn.microsoft.com wsl-config](https://learn.microsoft.com/en-us/windows/wsl/wsl-config)、[docs.docker.com/desktop/wsl](https://docs.docker.com/desktop/wsl/)

---

## 2. 数据策略清单（种子 / 重置 / 隔离）

### 2.1 Playwright 原生隔离机制（官方立场）

- 官方第一原则："每个测试彼此完全隔离，独立运行，各持自己的 localStorage、sessionStorage、数据、cookies"。serial 模式**不推荐**，除互依赖步骤外一律隔离。
- 隔离单位：**worker = 独立 OS 进程 + 独立浏览器实例**；每测试再套独立 BrowserContext（cookies/storage 天然隔离）；worker 失败后即销毁重建，防污染。
- 并发内共享服务端状态时的两个官方开关（v1.63+）：命名测试锁 `test('x', { lock: 'user-settings' }, ...)`（同名测试跨 worker 互斥）；`{ lock: '-exclusive-' }`（独占全局）。

**清单：**

- [ ] `fullyParallel` 初期不开（文件级并行即可）；CI `workers: process.env.CI ? 1 : undefined`（官方 CI 建议从 1 起步），本地容器多核后逐步上调并用实测决定。
- [ ] 需要互斥的服务端场景（如地理围栏全量重算）用命名 lock，而不是改成 serial。
- [ ] 唯一数据命名：`testInfo.testId`（数据后缀）、`workerIndex`（每 worker 独立账号）、`testInfo.outputPath()`（每测试独立产物路径）——三个官方 API 就是为数据级隔离准备的。

来源：[playwright.dev/docs/best-practices](https://playwright.dev/docs/best-practices)、[playwright.dev/docs/test-parallel](https://playwright.dev/docs/test-parallel)、[release notes（test locks, v1.63）](https://playwright.dev/docs/release-notes)

### 2.2 认证状态（storageState 模式）

- [ ] `playwright/.auth/` 目录 + `.gitignore`（含 cookies/token，禁止入库）。
- [ ] setup project 产状态：`tests/auth.setup.ts` UI 登录一次 → `page.context().storageState({ path: 'playwright/.auth/user.json' })`；业务 project `dependencies: ['setup']` + `storageState:` 消费。
- [ ] 多角色：每角色一个 setup 产 `admin.json` / `inspector.json`，`test.use({ storageState })` 精确注入。
- [ ] API 登录更快：setup 里 `request.post('/api/login')` → `request.storageState({ path })`，跳过 UI。
- [ ] 测试会改共享服务端状态时：升级为 **per-worker 账号**（官方 moderate 模式）——worker fixture 按 `testInfo.parallelIndex` 生成/复用账号，状态文件放 `test.info().project.outputDir`（每 run 自动清理）。

来源：[playwright.dev/docs/auth](https://playwright.dev/docs/auth)

### 2.3 种子与重置（结合本项目不变量"基础设施共享、数据级隔离"）

官方对数据库的唯一要求是"确保你控制数据"（"make sure you control the data"），具体策略由工程定。结合 NestJS+Prisma+PostGIS / Redis+BullMQ / rustfs 技术栈与不变量，采用**三层模型**：

**层 1 —— Run 级隔离（基础设施容器共享，键空间隔离）：**

- [ ] 每次 e2e run 分配唯一 `RUN_ID`（如 `e2e-$(date +%s)-$RANDOM`），派生：PostGIS 独立 database（`CREATE DATABASE e2e_<run_id>` 由 setup 执行，或 Prisma `migrate deploy` 到该库）；rustfs 独立 bucket（前缀 `e2e-<run_id>/`）；Redis 独立 DB index 或键前缀 `e2e:<run_id>:`；BullMQ 队列名带 run 后缀。
- [ ] 隔离参数通过环境变量注入后端（`DATABASE_URL`、`S3_BUCKET`、`REDIS_KEY_PREFIX`…），Playwright 侧只感知 `baseURL`——数据隔离收敛在 devenv/e2e 编排层，测试代码零耦合。
- [ ] run 结束（无论成败）执行 teardown：drop database、删 bucket、清键前缀；teardown 必须幂等且失败不阻塞报告产出。

**层 2 —— 种子（幂等、声明式、API 优先）：**

- [ ] 种子走**后端 API 或 Prisma seed 脚本**，绝不在 e2e 用 UI 造基础数据；种子脚本幂等（upsert 语义），可重复执行。
- [ ] 执行位置：setup project（Playwright 原生 `dependencies` 顺序保证）或 `globalSetup`；全局种子一次，测试内只造自己需要的数据。
- [ ] 基础种子集入仓版本化（`e2e/seeds/`），随 SPEC 一起评审——agent 诊断时能从种子集复现世界状态。

**层 3 —— 测试级数据（唯一命名，免重置）：**

- [ ] 每测试自造数据且带唯一后缀（`testInfo.testId`），断言只匹配自己的后缀 → 测试天然无序可并行、失败不传染，**消除"重置"需求**。
- [ ] 仅当无法避免共享读集（如地理底图）时：读集由种子提供且测试只读；写路径用唯一实体。
- [ ] 严禁 e2e 触碰任何共享/生产样例数据；外部第三方依赖一律 `page.route` mock（官方立场："Only test what you control"）。

来源：[playwright.dev/docs/best-practices](https://playwright.dev/docs/best-practices)、[playwright.dev/docs/auth](https://playwright.dev/docs/auth)、[playwright.dev/docs/mock](https://playwright.dev/docs/mock)

### 2.4 被测应用编排

- [ ] 用 `webServer` 配置启动被测前端（及后端，若不由 devenv 管）：`command` + `url` + `reuseExistingServer: !process.env.CI` + `stdout: 'pipe'`（CI 排障需要日志）；支持数组编排多服务、`wait`（输出正则）判定就绪。
- [ ] 本项目形态建议：**完整栈（PG/Redis/rustfs/后端/前端）由 devenv 起，Playwright 的 webServer 只负责"栈已在"的 URL 探活或启动 e2e 专属前端构建**——保持"devenv 唯一入口"不变量。

来源：[playwright.dev/docs/test-webserver](https://playwright.dev/docs/test-webserver)

---

## 3. GitHub Actions CI 模式建议

### 3.1 官方给定的两种基础形态

**A. runner 直跑（无容器 job）：**

```yaml
- uses: actions/checkout@v4
- uses: actions/setup-node@v4        # Node 22/24/26
- run: npm ci
- run: npx playwright install --with-deps
- run: npx playwright test
- uses: actions/upload-artifact@v4   # playwright-report/, if: !cancelled(), retention-days: 30
```

**B. job 容器（官方镜像，免装浏览器）：**

```yaml
jobs:
  e2e:
    runs-on: ubuntu-latest
    container:
      image: mcr.microsoft.com/playwright:v1.65.1-noble
      options: --user 1001
```

通用纪律：`workers: 1` 起步；`globalTimeout` 必设且 job `timeout-minutes` > globalTimeout；**不缓存浏览器**（恢复耗时≈下载，且 OS 依赖不可缓存）；PR 预检可用 `npx playwright test --only-changed=origin/$GITHUB_BASE_REF`（需 `fetch-depth: 0`，之后仍全量跑）。

来源：[playwright.dev/docs/ci](https://playwright.dev/docs/ci)

### 3.2 `services:` 的真实语义（GitHub 官方）

- service 容器**每 job 新建、job 结束销毁**；仅 Linux runner 支持；不能在 composite action 内声明。
- job 本身在容器里 → 服务以 **label 为 hostname** 通过 Docker bridge 网络互通，无需端口映射；job 在 runner 上 → 必须 `ports: 5432:5432` 映射后走 `localhost:5432`。
- 支持覆盖 `command`/`entrypoint`、私有仓库 `credentials`。
- **表达力边界：services 只能起"单镜像 + 启动参数"，没有 build、没有多容器依赖网络、没有健康检查语义**（要靠端口/options 自己凑）——承载不了"PostGIS+Redis+rustfs+NestJS 前后端"完整栈。

来源：[docs.github.com 服务容器](https://docs.github.com/en/actions/use-cases-and-examples/using-containerized-services/about-service-containers)

### 3.3 本项目推荐：容器内起栈（devenv 编排）+ e2e job 容器化

决策依据：不变量 2（devenv 唯一入口，人类/agent 禁止直操作 compose）+ e2e 需要"与本地完全同构"的世界。CI 里人类不介入，但 agent 同样不得绕过 devenv，否则本地/CI 两套栈很快漂移。

**推荐拓扑（方案一，首选）：**

```
job(e2e) on ubuntu-latest
 ├─ checkout
 ├─ devenv e2e up --run-id ci-<github.run_id>-<run_attempt>   # devenv 内部 compose：起 PostGIS/Redis/rustfs/应用，数据级隔离参数注入
 ├─ devenv e2e run       # 在 mcr playwright 容器内执行 npx playwright test（同网络，服务名互访）
 ├─ devenv e2e down      # teardown（幂等）
 └─ upload-artifact      # test-results/ + playwright-report/ + blob-report/（!cancelled()）
```

- GHA runner 自带 docker CLI，devenv（bash 封装）可直接运行；"禁止直操作 compose"在 CI 同样成立——compose 细节只在 devenv 内部。
- 每 job 的 run_id 天然给出数据级隔离键；`github.run_attempt` 保证重跑不复用脏数据。

**备选（方案二，SPEC 降级时）：** job 容器 = `mcr.microsoft.com/playwright:v1.65.1-noble`（`options: --user 1001`），基础设施用 `services:` 起 `postgis/postgis` 与 `redis`（label 即 hostname），rustfs/应用由 step 内构建启动——**仅当 devenv 尚未具备 CI 模式时的过渡**；放弃它对完整栈同构的保证。

**分片（套件变大后）：**

```yaml
strategy:
  fail-fast: false
  matrix:
    shard: [1, 2, 3, 4]
# 每个 job: npx playwright test --shard=${{ matrix.shard }}/4
# 本地 config: reporter: process.env.CI ? 'blob' : 'html'
# 汇总 job: npx playwright merge-reports --reporter html ./all-blob-reports
```

- blob 报告内含全部附件（trace、截图 diff），合并无丢失；不同 OS 来源合并需显式 merge config。
- `fail-fast: false` + 失败全收集（agent 诊断需要完整失败集，而不是首个失败）。

来源：[playwright.dev/docs/ci](https://playwright.dev/docs/ci)、[playwright.dev/docs/test-sharding](https://playwright.dev/docs/test-sharding)、[docs.github.com 服务容器](https://docs.github.com/en/actions/use-cases-and-examples/using-containerized-services/about-service-containers)

---

## 4. Agent 消费失败产物的方案

### 4.1 产物即接口（机器可读优先）

| 层 | 产物 | agent 用法 |
|---|---|---|
| 定位层 | **JSON reporter**（`results.json`）+ `onlyFailures: true` | 结构化解析：失败测试清单、错误消息、附件路径（含 trace.zip 路径）；`PLAYWRIGHT_JSON_OUTPUT_NAME` 固定路径。v1.65 起 JSON/JUnit/HTML 均支持 onlyFailures（含 flaky 与被中断的测试） |
| 噪音层 | **`failures` reporter**（v1.65 新增） | 终端实时流式失败输出，配 `quiet` 抑制正常输出——agent 只看失败流 |
| CI 注解层 | **github reporter** | 失败直接成为 PR check annotation（注意：官方不建议与 matrix 分片组合） |
| 取证层 | **trace.zip** | DOM 快照(before/after)、每请求网络日志(`.network`)、console、源码行、aria 快照（v1.63+）；本地查看零上传：`npx playwright show-trace trace.zip`，或托管 `https://trace.playwright.dev/?trace=<URL>`（CORS 注意，纯本地渲染不外传） |
| 人读层 | **HTML 报告**（自包含目录/zip） | `npx playwright show-report [playwright-report.zip]`；`attachmentsBaseURL` 可改附件外链；`PLAYWRIGHT_HTML_OPEN=never` 防 CI 上试图开浏览器 |
| 聚合层 | **blob + merge-reports** | 分片后合并为单一 HTML/JSON；`merge-reports --reporter=html,github ./blob-reports` |

**基线配置（直接采用）：**

```ts
reporter: process.env.CI
  ? [
      ['failures'],
      ['json', { outputFile: 'results.json', onlyFailures: true }],
      ['blob']                                 // 供 merge-reports 聚合
    ]
  : [['list'], ['html', { open: 'on-failure' }]],
```

来源：[playwright.dev/docs/test-reporters](https://playwright.dev/docs/test-reporters)、[playwright.dev/docs/trace-viewer](https://playwright.dev/docs/trace-viewer)、[release notes](https://playwright.dev/docs/release-notes)

### 4.2 交互复现：agent-cli（`@playwright/cli`，v1.59+ "agentic" 路线）

为编码 agent 设计的官方 CLI：`npm install -g @playwright/cli`，命令名 `playwright-cli`；常驻 daemon 省浏览器启动开销；无头默认；输出 token 高效；每个交互命令回显**等价的 Playwright TypeScript 代码**（可直接贴回测试）。

**失败测试的官方 agent 工作流（test-debugging）：**

```bash
# 1) 后台起跑失败测试，暂停点等待 attach，禁止报告自动打开
PLAYWRIGHT_HTML_OPEN=never npx playwright test tests/checkout.spec.ts --debug=cli &
# 输出: Run "playwright-cli attach tw-a3f19c" to attach to this test

# 2) attach 后进入现场
playwright-cli attach tw-a3f19c
playwright-cli tracing-start                       # 边复现边录 trace
playwright-cli pause-at tests/checkout.spec.ts:42  # 跑到可疑行暂停
playwright-cli snapshot            # 可访问性树快照（元素 ref 如 e21，确定性定位）
playwright-cli find "Place Order"  # 大页面里找元素
playwright-cli console error       # 只看错误级 console
playwright-cli requests --filter="/api/"
playwright-cli eval "() => document.title"
playwright-cli screenshot --filename=before-failure.png
playwright-cli tracing-stop        # 产 .playwright-cli/traces/trace-*.trace + *.network + resources/

playwright-cli step-over / resume  # 单步 / 继续
```

维护：trace 占磁盘，`find .playwright-cli/traces -mtime +7 -delete`。

来源：[agent-cli introduction](https://playwright.dev/agent-cli/introduction)、[agent-cli test-debugging](https://playwright.dev/agent-cli/commands/test-debugging)、[agent-cli tracing](https://playwright.dev/agent-cli/commands/tracing)

### 4.3 MCP 通道（浏览器即工具）

官方 MCP server（v1.62 起随包内置 `npx playwright mcp`）：`browser_start_tracing` / `browser_stop_tracing`（需 `--caps=devtools`），trace 落 `traces/` 子目录；`--save-session` 自动记录全部会话；snapshot/console/network 工具族与 agent-cli 同构。适用于把"浏览器观察"嵌入非 Playwright 语境的 agent 会话（如自动探索轨）。

来源：[playwright.dev/mcp/tools/tracing](https://playwright.dev/mcp/tools/tracing)、[release notes](https://playwright.dev/docs/release-notes)

### 4.4 落到本项目的诊断管道（建议写入 SPEC）

1. **e2e run 失败** → devenv 保留产物目录（`test-results/`、`playwright-report/`、`results.json`、容器日志）。
2. **agent 认领失败**：解析 `results.json`（onlyFailures）得到失败测试 + trace.zip 路径 + 错误消息 + 重试史。
3. **取证**：`npx playwright show-trace <trace.zip>` 本地查看；需要交互复现时走 4.2 的 `--debug=cli` + attach 管道（同样在容器内，`PLAYWRIGHT_HTML_OPEN=never`）。
4. **复现/探索双轨衔接**：探索轨发现的缺陷由此管道取 trace 作为 issue 附件；复现轨毕业测试沿用同一诊断接口——产物格式统一，agent 只需学一套。
5. **安全红线**：trace/报告可能含登录凭据等敏感数据，只上载 GitHub artifact / 内部可信存储；`playwright/.auth/` 永不入仓。

来源：[playwright.dev/docs/ci-intro](https://playwright.dev/docs/ci-intro)（报告发布与敏感数据警告）、[playwright.dev/docs/trace-viewer](https://playwright.dev/docs/trace-viewer)

---

## 5. 来源索引

**官方一手来源（playwright.dev / microsoft）：**

1. Playwright Docker：https://playwright.dev/docs/docker
2. Playwright CI（含 GitHub Actions 全模板）：https://playwright.dev/docs/ci
3. CI 入门（报告托管、敏感数据警告）：https://playwright.dev/docs/ci-intro
4. Release Notes（v1.57–v1.65 全量变更）：https://playwright.dev/docs/release-notes
5. GitHub Releases API（版本与日期实测）：https://github.com/microsoft/playwright/releases
6. 浏览器管理（install/--with-deps/--only-shell/PLAYWRIGHT_BROWSERS_PATH）：https://playwright.dev/docs/browsers
7. Trace Viewer：https://playwright.dev/docs/trace-viewer
8. 报告器（failures/onlyFailures/blob/merge/env 变量）：https://playwright.dev/docs/test-reporters
9. 视频录制：https://playwright.dev/docs/videos
10. 并行与隔离（workers、test locks）：https://playwright.dev/docs/test-parallel
11. 认证与 storageState：https://playwright.dev/docs/auth
12. webServer：https://playwright.dev/docs/test-webserver
13. 分片与合并：https://playwright.dev/docs/test-sharding
14. 最佳实践（隔离/控数据/mock 外部）：https://playwright.dev/docs/best-practices
15. 官方镜像 Dockerfile（noble）：https://github.com/microsoft/playwright/blob/main/utils/docker/Dockerfile.noble
16. 官方系统依赖清单（含字体包）：https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/registry/nativeDeps.ts
17. MCR 镜像与标签：https://mcr.microsoft.com/en-us/product/playwright/about （tags 经 `https://mcr.microsoft.com/v2/playwright/tags/list` 实测）
18. agent-cli 总览：https://playwright.dev/agent-cli/introduction
19. agent-cli 测试调试：https://playwright.dev/agent-cli/commands/test-debugging
20. agent-cli tracing：https://playwright.dev/agent-cli/commands/tracing
21. MCP tracing 工具：https://playwright.dev/mcp/tools/tracing

**平台一手来源：**

22. GitHub Actions 服务容器：https://docs.github.com/en/actions/use-cases-and-examples/using-containerized-services/about-service-containers
23. WSL 高级配置（.wslconfig/wsl.conf）：https://learn.microsoft.com/en-us/windows/wsl/wsl-config
24. Docker Desktop WSL2 后端：https://docs.docker.com/desktop/wsl/

**次要参考（社区，仅佐证，不作为结论依据）：**

25. Playwright in Docker 指南（TestDino, 2026）：https://testdino.com/blog/playwright-in-docker
26. 截图本地/CI/容器差异分析（Diffy）：https://diffy.website/blog/playwright-screenshots-ci-docker
