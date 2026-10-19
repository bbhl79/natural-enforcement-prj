# 研究结论：e2e 03 瘦身后的命令契约覆盖与 E7 表述一致性

- **关联票**：#166（研究票：e2e 03 瘦身后的命令契约覆盖与 E7 表述一致性）
- **所属图**：#162（架构工程子Map · 工程效能（dev check 与 CI 提速））
- **上游口径**：#163 决议评论第 ① 项（e2e 03 里重复的证据调用）——保留第一次全量 `dev lint`，把另两次换成 `dev lint leak`；第 ② 项（`dev test integration`／`dev build` 一律保留）
- **查证基准日**：2026-10-19
- **查证方式**：仓库源码逐行核对（`dev`、`e2e/cases/03-command-smoke.sh`、`tools/`、`.github/workflows/ci.yml`、`infra/docker-compose.yml`、`backend/prisma/schema.prisma`）＋ issue #57／#162／#163 逐条读取；并行拉镜像形态在 `/tmp` 本地原型实测（bash 5.3.9，未入库）
- **三态标注约定**：**已查证**（一手来源）／**推断**（据一手事实的合理推论，未实测）／**无法确认**（附原因）

> 本文件只做查证与方案草拟。改动本身由实施票落地。本人未修改任何源文件，未提交，未建分支（`.cursor/rules/branches.mdc`）。第 4 节的 #57 勘误评论文本只在本文件内起草，**由父会话代发**，本人不代发。

---

## 0. 结论速览

| # | 问题 | 一句话结论 | 落点 |
|---|---|---|---|
| 1 | 03 头部注释怎么改 | **命令面覆盖不变（仍是九命令），变的是 lint 内部的调用构成**：全量 `dev lint` 由 2 次降为 1 次（03:108），`dev lint leak` 子项 2 次（03:111 判红、03:115 转绿）。03 **没有丢失任何一条命令的 CLI 证据**，只是不再在本用例内重复取同一份「全量 lint 全绿」 | §2 |
| 2 | 哪些表述要同步改 | **3 处必改**（`dev` usage 的 `test` 段 dev:113-116、`dev` 的 `test_e2e` 段注释 dev:812-815、03 的 `[说明]` 输出块 03:185-186）；**2 处随并行拉镜像改造改**（`dev:16-17`、`dev:593` 的函数名引用）；**2 处建议改**（`dev` usage 的 `check` 段 dev:121-125、`dev` usage 的 `build` 段 dev:117-120）；**2 处行号引用已失效需顺手订正**（`backend/prisma/schema.prisma:20-21`、`tools/structural-probe.sh:10`） | §3 |
| 3 | #57 要不要补勘误 | **要**。票已关闭，只追加评论不重开、不改票面。勘误只更正「用例内部调用构成」，**E7 结论一字不改** | §4 |
| 4 | e2e 层单独跑还证什么 | **仍证门禁**。`dev test e2e` 单独跑，e2e 层内仍有：全量 `dev lint` 1 次（兜底闸＋红探针＋ESLint＋leak＋image）、`tools/structural-test.sh` 再 1 次（经 `dev test integration`）、类型检查 2 次（`dev test unit` ＋ `dev build` 后端编译门）、前端编译 1 次。**这个事实必须写进 3 个落点**：`dev` usage 的 `test` 段、`dev` 的 `test_e2e` 段注释、03 的 `[说明]` 输出块 | §5 |
| 5 | 并行拉镜像怎么设计 | **一次批次并发 ＋ 状态文件汇总 ＋ 一次非 0 退出**。子进程用 `set +e` ＋ 独立状态文件 ＋ `exit "$rc"`，父进程 `wait "$pid" \|\| true` 后读状态文件逐条汇总。**工具链镜像并入同一批次**（登记核对仍前置） | §6 |
| 6 | 改动会破坏什么 | **不破坏 E7 证据**。发现 **2 处已失效的行号引用**（`schema.prisma:20-21` 指向 03 的 110/137，与现文件对不上；`structural-probe.sh:10` 指向 `dev:360`，实际在 `dev:436`）。无任何代码或测试断言「03 跑两次全量 lint」或「`ensure_infra_images` 串行」 | §7 |

---

## 1. 现状事实（改前 03 的证据分布）

### 1.1 一次 CI run 里全量 lint 跑几遍

链路已查证：`dev check --ci` → `cmd_check`（`dev:846`）→ `cmd_lint`（`dev:888`，**内部函数路径，不经 CLI**）→ `test_unit`（`dev:889`）→ `test_integration`（`dev:890`）→ `test_e2e`（`dev:891`）→ `e2e/cases/*.sh` 按文件名排序逐条执行（`dev:825-835`）→ `03-command-smoke.sh`。

`dev lint` 全量 = 五项顺序执行（`dev:479`、`dev:483`）：`lint_leak` → `lint_structural` → `lint_structural_probe` → `lint_image` → `lint_eslint`。`lint_leak` 检出即 `exit 1`（`dev:420-423`），**后面的四项不再执行**。

| 位置 | 调用 | 五项实际执行 | 完整全量 lint 遍数 |
|---|---|---|---|
| `dev:888` 外层 `cmd_lint` | 全量 | 五项全跑 | 1 |
| `03:108` | 全量 | 五项全跑 | 1 |
| `03:111`（植入 node_modules） | 全量 | **只跑 `lint_leak` 即红** | 0 |
| `03:115`（清除 node_modules 后） | 全量 | 五项全跑 | 1 |

**改前：一次 CI run 的完整全量 lint = 3 遍**（外层 1 ＋ `03:108` 1 ＋ `03:115` 1）；`lint_leak` 共 4 次、`lint_structural`／`lint_structural_probe`／`lint_image`／`lint_eslint` 各 3 次。

**改后：完整全量 lint = 2 遍**（外层 1 ＋ `03:108` 1）；`lint_leak` 共 4 次（不变），其余四项各 2 次。**省下的是一次完整的兜底闸**（≈8–11 秒，父图实测）、**一次红探针**（把兜底闸再跑 24 遍）、**一次工具链镜像核对**，以及**一次容器内 ESLint 全量**（`dev:467-477`：容器内 `pnpm install` ＋ `pnpm run lint`，冷 runner 上是本项最贵的一段）。

**漏入库检查的遍数不变**（改前改后都是 4 次）：改前 `03:111`／`03:115` 走的虽是全量 lint，但都只执行到 leak 一项。

**已查证**：父图 #162「已核实的现状事实」写的是「一次 CI 里全量 lint 被跑 2 次（外层 `dev lint` 阶段 ＋ e2e 03 保留的那次）」——该口径已是**改后**的数（03 保留 1 次），与本节一致。

### 1.2 03 内 lint 两条调用的真实差异

**已查证**：`lint_leak` 是 `dev lint` 全量的第一项（`dev:483`），检出漏入库即 `exit 1`（`dev:420-423`），退出码经 `dev:23-29` 的 `normalize_exit_code` 陷阱归一为 1。因此 `03:111` 那次「植入 node_modules 后 lint 变红」，**实际只走到 leak 一项**就红了，后四项从未执行。

这直接推出两条结论：

1. `03:111` 换成 `dev lint leak` **不损失任何判红证据**：改前改后拿到的都是「非 0 退出 ＋ 同一句人类可读输出」（`dev:420-421` 打印含 `node_modules` 字样，`03:112` 的 `grep -q 'node_modules'` 仍能命中）。**已查证**。
2. `03:115` 换成 `dev lint leak` **不损失「恢复全绿」的语义**：改前那次跑的是五项全量，但「全量五项全绿」这份证据已由 `03:108` 给出；`03:115` 真正独有的信息只有「漏入库清干净后该子项转绿」。**已查证**（对照 `03:108` 与 `03:115` 的断言内容）。

### 1.3 E7 证据的唯一出处

**已查证**：全部 e2e 用例中，只有 `03-command-smoke.sh` 走 `lint`／`test unit`／`test integration`／`build`／`logs`／`exec` 的 CLI 路径。逐个用例核过：`01-from-zero.sh` 只用 `db reset`（`01:16`）、`up`（`01:19`）、`health`（`01:32`）；`02-readwrite-channel.sh` 不用 `dev` CLI；`04-first-login.sh:24`／`05-spa-fallback.sh:20`／`07-day-one.sh:86` 只用 `up`；`06-bootstrap.sh` 走 HTTP 引导接口，不经 `dev` CLI。

**已查证**：外层 `dev check` 调的是内部函数 `cmd_lint`（`dev:888`）、`test_integration`（`dev:890`）、`cmd_build`（`dev:884`／`dev:886`），**不经 CLI 入口**（`dev:926-944` 的 `case` 分派才是 CLI 路径）。

**结论**：保留 `03:108` 的全量 `dev lint` 是必须的——它是 `dev lint` 命令面**唯一**的 CLI 全绿证据。

---

## 2. Q1：03 头部注释怎么改写

### 2.1 改后 03 覆盖什么

| 维度 | 改后状态 | 依据 |
|---|---|---|
| 命令面 | **不变**。仍是九命令：up／down／health／db／lint／test（unit ＋ integration 两层）／build／logs／exec | `03:31-42`、`:44-58`、`:60-105`、`:108`、`:117-164`、`:188-199`、`:201-206`、`:208`、`:223`、`:232-236` |
| `check` 命令 | **仍不内嵌**。`check` 的可执行性仍由外层 `dev check` 总闸全绿覆盖 | `03:5-6`、`03:184-186`、`dev:801`（`test all` 含 e2e 层即本用例自身，递归） |
| lint 命令 | 覆盖**不变**。全量 `dev lint` 的 CLI 全绿证据在 `03:108` | `03:108` |
| 漏入库检查 | 覆盖**收窄到子项**：由「全量 lint 的第一项」改为**显式调 `dev lint leak`** 2 次（判红 ＋ 转绿） | `03:111`、`03:115`、`dev:416-425`、`dev:484` |

### 2.2 改后 03 不再单独提供的

**只有一条**：「同一用例内全量 lint 连续两遍全绿」这份冗余证据。

**没有丢的**（逐条核对）：九命令的 CLI 可执行性；`dev lint` 全量五项的 CLI 全绿；漏入库判红与转绿；`dev test unit`／`dev test integration`／`dev build` 的 CLI 路径；E1／E6／E7 三份证据。

**要写清的一句**（防止后人误读）：**全量 lint 在一次 CI run 里仍跑 2 遍——外层 `cmd_lint` 1 遍（内部函数路径）＋ `03:108` 1 遍（CLI 路径）**。03 瘦身后不是「lint 只跑 1 遍」，而是「lint 全量在 CI 里不再跑 3 遍」。

### 2.3 证据归属表（改后）

下表逐行给出**每份证据的出处**；同一份证据若有两处出处，两处都列出。作用域标注在「范围」列。

| 证据 | 范围 | 改前出处 | 改后出处 |
|---|---|---|---|
| `dev lint` 全量五项经 CLI 全绿 | 03 用例内 | `03:108`、`03:115` | **`03:108`（唯一）** |
| `dev lint` 全量五项（内部函数路径） | 外层 | `dev:888` | `dev:888`（不变） |
| 漏入库判红 | 03 用例内 | `03:111`（全量的第一项） | **`03:111`（`dev lint leak`）** |
| 漏入库清干净后转绿 | 03 用例内 | `03:115`（全量） | **`03:115`（`dev lint leak`）** |
| 兜底闸（结构测试） | 03 用例内 | `03:108`（全量内）＋ `03:208`（`dev test integration`） | 不变，各 1 次 |
| 红探针 | 03 用例内 | `03:108`（全量内） | 不变，1 次 |
| 工具链镜像定案核对 | 03 用例内 | `03:108`（全量内） | 不变，1 次 |
| 容器内 ESLint 全量 | 03 用例内 | `03:108`、`03:115` | `03:108`，1 次 |
| 类型检查（tsc `--noEmit`） | 03 用例内 | `03:201`（`dev test unit`）＋ `03:223`（`dev build` 后端编译门） | 不变 |
| E1／E6／E7 | e2e 层内 | `01`／`02`／`03` | 不变 |

### 2.4 可直接粘贴的替换文本

**位置**：`e2e/cases/03-command-smoke.sh:2-8`（连同 `:1` 的 shebang 一并替换；下文是完整文件头）。

```bash
#!/usr/bin/env bash
# dev 命令行为契约冒烟测试（E7 子集 + E6 前半），#57 切片10 归位为 e2e/cases 用例。
# 只测外部可观察行为：命令退出码与人类可读输出。不测内部实现。
# 覆盖九命令（up/down/health/db/lint/test/build/logs/exec；test 命令内跑 unit 与 integration 两层）。
# 命令面覆盖不因瘦身而变：lint/test integration/build 仍在本用例内经 CLI 各走一遍。
# lint 只取一次全量：全量 dev lint 在本用例内跑 1 次（CLI 唯一全绿证据；
# 外层 dev check 走内部函数 cmd_lint，不经 CLI）。
# 漏入库走子项：dev lint leak 跑 2 次（植入 node_modules 判红、清除后转绿）。
# 兜底闸（结构测试）跑 2 次：全量 dev lint 内 1 次，dev test integration 内 1 次。
# check 不在此内嵌执行——check = lint+test all+build，test all 含 e2e 层即本用例自身（递归），
# 其可执行性由外层 ./dev check（本地/CI 总闸）全绿覆盖。
# 用法：e2e/cases/03-command-smoke.sh            常规冒烟（要求镜像已就绪）
#       SMOKE_MISSING_IMAGE=1 e2e/cases/03-command-smoke.sh   追加镜像缺失路径用例（会删除并恢复本地 redis 镜像）
```

**与现文的逐行差异**（便于评审）：

| 行 | 现文 | 改后 | 理由 |
|---|---|---|---|
| `:4` | `覆盖九命令（up/down/health/db/lint/test unit/test integration/build/logs/exec）；` | `覆盖九命令（up/down/health/db/lint/test/build/logs/exec；test 命令内跑 unit 与 integration 两层）。` | 原句列了 10 个名字却称「九命令」（`test unit` 与 `test integration` 同属 `test` 命令）。改为列 9 个命令名并点明 test 的两层，计数自洽。**最小改动版**可保留原句不动，但计数不自洽会被后人挑 |
| 新增 | — | `命令面覆盖不因瘦身而变：…` | 回答「瘦身后还覆盖什么」 |
| 新增 | — | `lint 只取一次全量：…` ＋ `漏入库走子项：…` ＋ `兜底闸…跑 2 次：…` | 回答「证据现在在哪」 |
| `:5-6` | `check 不在此内嵌执行…` | 逐字保留 | 该事实未变 |

**配套替换**：`03:107` 的小节标题，以及 `:111`／`:115` 两行。

```bash
# ---------- 4. dev lint 全量（CLI 唯一全绿证据）+ dev lint leak 子项红绿对照 ----------
"$DEV" lint >/tmp/smoke-lint.log 2>&1; check "dev lint 全绿" "$?"

mkdir -p "$ROOT/node_modules/.fake" "$ROOT/frontend/node_modules"
"$DEV" lint leak >/tmp/smoke-lint-leak.log 2>&1; rc=$?
[ "$rc" -ne 0 ] && grep -q 'node_modules' /tmp/smoke-lint-leak.log \
  && ok "检出 node_modules 漏入库即失败（非 0 + 人类可读输出）" || bad "lint leak 未检出 node_modules（rc=$rc）"
rm -rf "$ROOT/node_modules" "$ROOT/frontend/node_modules"
"$DEV" lint leak >/dev/null 2>&1; check "清除 node_modules 后 lint leak 恢复全绿" "$?"
```

**逐行差异**：`03:107` 小节标题改写；`03:111` 的 `"$DEV" lint` 改 `"$DEV" lint leak`；`03:113` 的 `bad` 文案加 `leak` 二字（原文「lint 未检出 node_modules」在只跑子项后语义变窄）；`03:115` 的 `"$DEV" lint` 改 `"$DEV" lint leak`，断言描述改「lint 恢复全绿」→「lint leak 恢复全绿」。

**未改**：`03:108`（保留全量 `dev lint`）、`03:112` 的 `grep -q 'node_modules'`（`dev:420` 的失败文案含 `node_modules` 字样，仍命中）、`03:239` 的收尾断言。

**行数影响**：上面的文件头比现文多 2 行（8 行 → 10 行）。**推断**：这会使 `03:110` 之后的行号整体后移 2 行——见 §7.1 的行号引用问题。

---

## 3. Q2：需要同步改的其他表述

### 3.1 必改（3 处）

#### ① `dev:113-116`（usage 的 `test` 段）

**现文**：

```
  test     三层语义（#46）：unit = 纯单元+契约；integration = 结构+需库用例；
           e2e = 从零拉起（E1）+ 读写通道（E6）+ 十命令冒烟（E7）。
           test unit / test integration / test e2e / 裸 test = all（unit+integration+e2e）。
           注意：e2e 层会销毁本项目数据卷做从零拉起（E1 证据），勿在需保留数据时运行。
```

**替换文**：

```
  test     三层语义（#46）：unit = 纯单元+契约；integration = 结构+需库用例；
           e2e = 从零拉起（E1）+ 读写通道（E6）+ 十命令冒烟（E7）。
           test unit / test integration / test e2e / 裸 test = all（unit+integration+e2e）。
           证据分工：命令契约（E7）的 CLI 路径证据只在 e2e 层（03 用例）；外层 check 走内部函数。
           单独跑 test e2e 仍自证门禁：lint 全量 1 次、结构测试 1 次、类型检查与编译门 1 次。
           注意：e2e 层会销毁本项目数据卷做从零拉起（E1 证据），勿在需保留数据时运行。
```

**理由**：usage 是用户跑 `dev test e2e` 前读到的第一处，也是父图 #162「Not yet specified」里问的「证据分工要不要第三个落点」的第一候选。**已查证**：`dev test e2e` 单跑确实仍跑上述门禁（§5）。

#### ② `dev:812-815`（`test_e2e` 段注释）

**现文**：

```
# ---------- dev test e2e 层（#57：从零拉起 E1 + 读写通道 E6 后半 + 命令冒烟 E7） ----------
# 用例目录约定：e2e/cases/*.sh，按文件名排序逐条执行；用例只测外部可观察行为
#（命令退出码 + 人类可读输出），自行经 compose 访问服务（隔离环境变量同 integration 层）。
# 产物目录：默认 e2e/results（gitignore）；带 --run-id 时落 .run/<id>/results（复现同路径）。
```

**替换文**（末两行后追加两行；首行逐字保留）：

```
# ---------- dev test e2e 层（#57：从零拉起 E1 + 读写通道 E6 后半 + 命令冒烟 E7） ----------
# 用例目录约定：e2e/cases/*.sh，按文件名排序逐条执行；用例只测外部可观察行为
#（命令退出码 + 人类可读输出），自行经 compose 访问服务（隔离环境变量同 integration 层）。
# 产物目录：默认 e2e/results（gitignore）；带 --run-id 时落 .run/<id>/results（复现同路径）。
# 证据分工：外层 dev check 走内部函数（cmd_lint/cmd_build），不经 CLI；命令契约（E7）的
# CLI 路径证据唯一出处是本层的 03-command-smoke.sh。
# 单独跑本层仍自证门禁：全量 dev lint 1 次（兜底闸+红探针+ESLint+leak+image）、
# 结构测试 1 次（经 dev test integration）、类型检查与编译门 1 次（经 dev test unit / dev build）。
```

#### ③ `03:185-186`（用例运行时的 `[说明]` 输出块）

**现文**：

```
echo "[说明] dev check 不内嵌执行：check = lint+test all+build，test all 含 e2e 层即本用例（递归）；"
echo "       check 可执行性由外层 ./dev check 总闸全绿覆盖（E1/E7 的总证据）。"
```

**替换文**：

```
echo "[说明] dev check 不内嵌执行：check = lint+test all+build，test all 含 e2e 层即本用例（递归）；"
echo "       check 可执行性由外层 ./dev check 总闸全绿覆盖（E1/E7 的总证据）。"
echo "[说明] 本层自证门禁：全量 dev lint 1 次（兜底闸+红探针+ESLint+leak+image）、"
echo "       结构测试 1 次（经 dev test integration）、类型检查与编译门 1 次（经 dev test unit / dev build）。"
```

**理由**：这一段是 e2e 跑起来时**人眼可见**的落点。CI 日志里执行者不必翻源码就知道「本层仍证门禁」。

### 3.2 随并行拉镜像改造改（2 处，见 §6.4）

#### ④ `dev:14-17`（脚本头注释）

**现文**（节选）：

```
# 同时 build 承担工具链镜像拉取
#（LINT_IMAGE 不是 compose 服务镜像，ensure_infra_images 的 compose config --images
# 遍历覆盖不到，冷环境会死在 require_toolchain_image，CI 加一步 dev build 也救不活）。
```

**替换文**：

```
# 同时 build 承担工具链镜像拉取
#（LINT_IMAGE 不是 compose 服务镜像，compose config --images 遍历覆盖不到，
# 冷环境会死在 require_toolchain_image，CI 加一步 dev build 也救不活）。
# 镜像拉取合并为一次并发批次：工具链镜像与 infra 镜像同批拉取（ensure_images）。
```

#### ⑤ `dev:593`（`build_frontend` 内注释）

**现文**：`# 基础镜像已由 ensure_toolchain_images / ensure_infra_images 按 digest 拉到本地。`

**替换文**：`# 基础镜像已由 ensure_images 按 digest 拉到本地（工具链与 infra 镜像同批并发拉取）。`

### 3.3 建议改（2 处）

#### ⑥ `dev:121-125`（usage 的 `check` 段）

**现文**：

```
  check    一条命令 = build + lint 全量 + test all，本地即 CI 全绿。三项一律跑齐；
           build 前置是因为镜像与产物是 lint/测试层的运行前提（非改集合语义）。
```

**建议在句末追加**：

```
  check    一条命令 = build + lint 全量 + test all，本地即 CI 全绿。三项一律跑齐；
           build 前置是因为镜像与产物是 lint/测试层的运行前提（非改集合语义）。
           check 内部直调 lint/test/build 函数，不经 CLI；CLI 路径证据在 e2e 层的 03 用例。
```

**理由**：`check` 是「一条命令跑 lint 全量」的字面表述，读者容易以为 `check` 验过 `dev lint` CLI。补一句消除歧义。**可选**：不改也不算错，只是留有歧义。

#### ⑦ `dev:117-120`（usage 的 `build` 段）

**现文**：`build    全量构建 = 环境自举：拉取工具链与 infra 镜像（按 infra/VERSIONS.md 钉定引用，已在场即跳过）＋ …`

**建议改为**：`build    全量构建 = 环境自举：并发拉取工具链与 infra 镜像（按 infra/VERSIONS.md 钉定引用，已在场即跳过）＋ …`

**理由**：与 §6 的并发改造对齐。**已查证**：并发不改变「已在场即跳过」与「拉取只发生在 build 语义内」两条语义（`dev:117-120`、`dev:621`）。

### 3.4 不需要改（已查证，列出以免遗漏）

| 位置 | 为什么不需要改 |
|---|---|
| `dev:11`（脚本头「test e2e 层（e2e/cases 约定：从零拉起+读写通道+命令冒烟）」） | 描述的是 e2e 层的用例形态，形态未变 |
| `dev:96`（usage 首行「十命令：#46/#47 定案，切片10 #57 完备」） | 命令面未变 |
| `dev:109-112`（usage 的 `lint` 段，已列 `leak` 子项） | `dev lint leak` 本就是已文档化的 CLI 形态 |
| `dev:802-806`（`cmd_test` 的层分派与未知层提示） | 未涉及 |
| `.github/workflows/ci.yml:36`（步骤名「check（build 自举镜像 → lint 全量 → test all，本地同一命令；E1 在 e2e 层内）」） | 措辞不含遍数，事实未变 |
| `.github/workflows/ci.yml:4-8`（头部注释：检查语义单一来源＝dev 脚本；E1 在 e2e 层内） | 事实未变 |
| `integration/README.md:13`（把 03 当写法参考） | 只引用写法，不引用证据结构 |
| `infra/VERSIONS.md:44`（e2e 层实测形态＝命令冒烟＋读写通道＋从零拉起） | 形态未变 |
| `tools/structural-test.sh:5-7`（兜底闸接入 dev lint） | 接入关系未变 |

---

## 4. Q3：#57 的追加勘误评论

### 4.1 决策

**要补一条勘误评论**。理由三条：

1. **已查证**：#57 的关闭销账评论把 E7 证据记为「`e2e/cases/03-command-smoke.sh`（原 dev-command-smoke.sh 归位扩展）**53 通过 / 0 失败**：九命令逐条冒烟（up/down/health/db/lint/test unit/test integration/build/logs/exec，含红绿对照与幂等/毁数语义）」。改动后，读者按这条记录去数 03 里的 lint 调用会数出 3 次，与改后的实现（1 次全量 ＋ 2 次子项）不符。
2. **E7 结论不变**：九条命令的 CLI 证据一条不少（§2.3）。勘误只更正**用例内部的调用构成**，不更正 E7 结论。
3. **票已关闭**：只追加评论。**不重开、不改票面**。

**不选「不改」的理由**：#57 是 E7 的销账出处，是后代读者查 E7 证据的第一站。销账记录与实现不一致而不留痕，比留一条勘误更危险。

### 4.2 追加评论的正文（**由父会话代发**）

```markdown
## 勘误补充（2026-10-19，追加评论；本票保持关闭，票面不改）

本票关闭销账评论里的 E7 证据表述——「`e2e/cases/03-command-smoke.sh`（原 dev-command-smoke.sh 归位扩展）**53 通过 / 0 失败**：九命令逐条冒烟（up/down/health/db/lint/test unit/test integration/build/logs/exec，含红绿对照与幂等/毁数语义）」——在 **E7 结论上完全不变**。本评论只更正用例内部的调用构成。

变更内容：03 用例内部**一次重复的全量 `dev lint` 调用**被替换为定向子项 `dev lint leak`。
- 保留：第一次全量 `dev lint`（CLI 路径的全量五项全绿证据）。
- 改为 `dev lint leak`：「植入 node_modules 后 lint 变红」那次，与「清除 node_modules 后 lint 恢复全绿」那次。
- 保留：`dev test integration` 与 `dev build` 的 CLI 调用。

为什么 E7 结论不变：
- 九条命令的 CLI 路径一条不少。全量 `dev lint` 的 CLI 全绿证据仍在 03 内，且仍是 `dev lint` 走 CLI 的唯一出处（外层 `dev check` 直调内部函数 `cmd_lint`，不经 CLI）。
- 被替换掉的两次调用取的是同一份证据。`lint_leak` 是全量 lint 的第一项，检出即以非 0 退出，后四项本就不执行；全量五项全绿这份证据已由保留的那次给出。故改动落在「不重复取证」一侧，不降低任何判红条件。
- 断言条数不变（增删的只是命令，不是断言），本票记录的 53 通过 / 0 失败 这一条仍然成立。

本票 E1–E7 销账结论、「兼容性确认仍待确认」的状态与本票的关闭状态均不变。本评论只作记录。
```

### 4.3 需在发出前核对的一点

**推断**：上条评论里「53 通过 / 0 失败」沿用 #57 的历史记录。本次改动不增删断言（只换命令），故该数字应仍成立——但**未实测**（本次为只读研究，未跑 e2e）。若实施票实跑后数字有变，评论里这一句要按实跑结果改写。**发出前请以实跑输出为准**。

---

## 5. Q4：e2e 层单独跑还证什么

### 5.1 `dev test e2e` 单独跑的证据清单

`dev test e2e` → `test_e2e`（`dev:816`）→ 按文件名顺序跑 `e2e/cases/*.sh`（`dev:825-835`）。

| 门禁 | 在 e2e 层的出处 | 触发链路 | 一次 `dev test e2e` 单独跑的遍数 |
|---|---|---|---|
| 兜底闸（结构测试） | `03:208` | `dev test integration` → `dev:765` → `tools/structural-test.sh` | 1 |
| 兜底闸（结构测试） | `03:108` | `dev lint` 全量 → `dev:429` → `tools/structural-test.sh` | 1 |
| 红探针（负例证据） | `03:108` | `dev lint` 全量 → `dev:436` → `tools/structural-probe.sh` | 1 |
| 容器内 ESLint 全量 | `03:108` | `dev lint` 全量 → `dev:467` | 1 |
| 依赖漏入库检查 | `03:108`／`03:111`／`03:115` | `dev lint` 全量内 1 次 ＋ `dev lint leak` 2 次 | 3 |
| 工具链镜像定案核对 | `03:108` | `dev lint` 全量 → `dev:449` | 1 |
| 类型检查（tsc `--noEmit`） | `03:201` | `dev test unit` → `dev:695`（`pnpm test && pnpm run typecheck`） | 1 |
| 后端编译门（全程序类型化） | `03:223` | `dev build` → `dev:614`（`pnpm run typecheck`） | 1 |
| 前端编译门（tsc ＋ vite build） | `03:223` | `dev build` → `dev:591` | 1 |
| 集成层需库用例 | `03:208` | `dev test integration` → `dev:771-792` | 1 |
| E1 从零拉起 | `01-from-zero.sh` | — | 1 |
| E6 读写通道 | `02-readwrite-channel.sh` | — | 1 |
| E7 命令面（九命令 CLI） | `03` | — | 1 |

**结论（已查证）**：`dev test e2e` 单独跑，e2e 层内**仍然跑着全部门禁类检查**（兜底闸、红探针、ESLint、漏入库、类型检查、前后端编译、集成层需库用例）。03 瘦身后减少的是「同层内重复取同一份证据」，**不是「层内不再证门禁」**。

### 5.2 这个事实写在哪里

**落点（3 个必写 ＋ 1 个长期口径）**：

| 落点 | 位置 | 承载什么 | 状态 |
|---|---|---|---|
| A | `dev` usage 的 `test` 段（`dev:113-116`） | 「单独跑 test e2e 仍自证门禁」＋ 证据分工 | §3.1① 已给替换文 |
| B | `dev` 的 `test_e2e` 段注释（`dev:812-815`） | 同上，给读脚本的人看 | §3.1② 已给替换文 |
| C | 03 的 `[说明]` 输出块（`03:185-186`） | 同上，跑起来时人眼可见 | §3.1③ 已给替换文 |
| D | 父图产出的 ADR（`docs/adr/`，下一号） | 长期口径：证据分工表（哪层证什么） | 父图范围 |

**不新增第三类文档落点**。理由（已查证）：

- 仓库**无根 README**（根目录文件清单：`AGENTS.md`、`GLOSSARY.md`、`dev`、`package.json` 等，无 `README.md`）。
- `docs/agents/` 只放智能体流程文档（`issue-tracker.md`、`triage-labels.md`、`domain.md`），不承载工程语义。
- `GLOSSARY.md` 不收工程术语——父图 #162「本图不动 `GLOSSARY.md`（工程口径不属业务词汇）」已定。

**因此对父图「Not yet specified」第 2 问的回答**：**不需要第三个落点**。三个落点（usage、`dev` 注释、03 输出）＋ ADR 已足够；再往 `docs/agents/` 或 README 加一份会制造第二个事实源。

### 5.3 建议的长期口径一句话（供 ADR 引用）

> **证据分工**：命令契约（E7）的 CLI 路径证据只在 e2e 层（`03-command-smoke.sh`），因为外层 `dev check` 直调内部函数、不经 CLI；门禁类检查（兜底闸、红探针、ESLint、漏入库、类型检查、编译门）在两层都跑——e2e 层 1 遍、外层 1 遍，两遍的判红条件相同。

---

## 6. Q5：并行拉镜像的设计

### 6.1 现状（已查证）

| 函数 | 位置 | 行为 |
|---|---|---|
| `ensure_toolchain_images` | `dev:622-630` | 校验 `$LINT_IMAGE` 已在 `infra/VERSIONS.md` 登记（`dev:623` → `dev:441-446`）；在场则跳过；否则 `docker pull`（`dev:628`） |
| `ensure_infra_images` | `dev:634-647` | 遍历 `docker compose config --images`（`dev:646`），跳过两个本地构建镜像（`dev:638-639`）；逐个 `docker image inspect`，缺则逐个 `docker pull`（`dev:644`） |
| 调用点 | `dev:665-666` | `cmd_build` 里**串行**先后调这两个函数 |

**当前失败语义**：`dev` 头部是 `set -euo pipefail`（`dev:19`）。循环体里的 `docker pull` 失败会**直接终止脚本**（该命令不在 `set -e` 的豁免清单里），经 `normalize_exit_code`（`dev:23-29`）归一为退出码 1。**即：首个拉取失败即中止，后续镜像不再拉，只报第一处失败。**

**待拉的镜像（冷环境，5 个）**：`$LINT_IMAGE`（`node:24.21.0-alpine@sha256:ebfe…`，不在 compose 清单内）＋ compose 清单里的 4 个（`infra/docker-compose.yml:11` postgis、`:31` redis、`:42` rustfs、`:54` nginx；`:71`／`:79` 的两个本地镜像被 `dev:638-639` 跳过）。

**依赖关系**：`frontend/Dockerfile` 的两个基础镜像正是工具链镜像与 nginx 镜像（`FROM node:24.21.0-alpine@sha256:ebfe…` / `FROM nginx:1.29.8@sha256:1881…`），`backend/server/Dockerfile` 用工具链镜像；`docker build` 不传 `--pull`，只吃本地镜像。所以**全部镜像必须在 `build_frontend`／`build_server` 之前就位**——这决定了「先并发拉齐，再顺序构建」的序，与今天的序一致。

### 6.2 设计要点（每条一句一事）

1. **采集阶段保持串行**：本地 `docker image inspect` 极快，串行做完，产出「缺失清单」。**已在场即跳过**（`dev:117-120` 的 US13 语义）不变。
2. **拉取阶段并发**：缺失清单里每个镜像起一个后台子进程，各自 `docker pull`。
3. **子进程必须 `set +e`**：否则 `set -e` 会让子进程在写状态文件**之前**退出，失败信息就丢了。
4. **子进程必须以拉取退出码退出**：`wait` 返回的是子 shell 的退出码，子 shell 的最后一条命令若写成 `printf`，`wait` 就会返回 0，失败被吞。
5. **状态文件是权威记录**：每个子进程把自己的退出码写进独立状态文件；父进程读状态文件判定成败。**状态文件缺失＝失败**（子进程被杀的情形）。
6. **父进程等待用 `wait "$pid" || true`**：`set -e` 下 `wait` 的非零会直接终止脚本，聚合就无从谈起。用 `|| true` 把「等待」与「判定」分开。
7. **不用 `wait -n`**：需要 bash 4.3＋；仓库脚本目前未见对 bash 4 以上的依赖（`dev` 用的是数组与 `[[ ]]`，bash 3.2 兼容）。逐个 `wait` 即可，批内并发已经达成。
8. **失败汇总成一次非 0 退出**：逐条打印失败镜像名 ＋ 退出码 ＋ `docker pull` 输出末几行，末尾一行汇总，然后 `exit 1`（**只退一次**；`dev` 的退出码只有 0/1）。
9. **不清理已拉成功的镜像**：失败后本地已到位的镜像保留，下次 `dev build` 跳过（幂等）。
10. **不部分放行**：任一镜像缺失即 `dev build` 失败。与今天的语义等价（今天首个失败即整条 build 失败）。
11. **与今天的差别（如实写明）**：今天「拉 1 个失败就停」，并发版「全部拉完再报全部失败」。诊断信息更全，判红条件不变。

### 6.3 工具链镜像要不要并入同一批次

**结论：并入。**

理由：

1. **语义同类**。工具链镜像与 infra 镜像同为「钉定引用（tag＋digest）＋ 已在场即跳过 ＋ 缺失才拉」，且都只在 `dev build` 语义内拉取（`dev:117-120`、`dev:621`）。
2. **无先后依赖**。工具链镜像不被任何 compose 服务引用（`dev:16-17` 已说明），与 4 个 infra 镜像互不依赖，可同批并发。
3. **省一轮往返**。合并后是 1 轮并发（5 张图），不合并是 2 轮（先 1 张工具链，再 4 张 infra）。
4. **登记核对仍前置**。`require_image_registered "$LINT_IMAGE"`（`dev:623`）必须**在批次启动之前**跑：未登记就失败，且**不发起任何拉取**。这条不能因合并而放松。

**代价**：函数名从两个并成一个，仓库内 3 处引用要改（`dev:16-17`、`dev:593`、`dev:665-666`）。

### 6.4 伪代码（与 `dev` 其余部分风格一致）

**采集＋拉取（建议放在 `dev:618-647` 原两函数的位置，替换之）**：

```bash
# 镜像拉取（dev build 语义内；冷环境自举的唯一入口）。
# 一次批次并发拉齐：工具链镜像 + compose 清单里的 infra 镜像（剔除本地构建镜像）。
# 已在场即跳过（US13）：采集阶段串行 inspect，只对缺失项发起拉取。
# 定案核对先行：工具链镜像未在 infra/VERSIONS.md 登记即失败，且不发起任何拉取。
ensure_images() {
  require_compose_file
  require_image_registered "$LINT_IMAGE"
  local compose_images
  compose_images="$("${COMPOSE[@]}" config --images)" || {
    echo "[FAIL] build：解析 compose 镜像清单失败。" >&2
    exit 1
  }
  local -a missing=() roles=() imgs=() seen=()
  local img role
  # 工具链镜像先行：LINT_IMAGE 不在 compose 清单里（dev 头注释已记）
  imgs+=("$LINT_IMAGE"); roles+=("工具链镜像")
  for img in $compose_images; do
    [ "$img" = "$FRONTEND_IMAGE" ] && continue   # 本地构建镜像，不拉
    [ "$img" = "$SERVER_IMAGE" ] && continue      # 本地构建镜像，不拉
    case " ${seen[*]} " in *" $img "*) continue ;; esac   # 去重：同一镜像不并发拉两次
    seen+=("$img")
    imgs+=("$img"); roles+=("infra 镜像")
  done
  local i
  for i in "${!imgs[@]}"; do
    img="${imgs[$i]}"; role="${roles[$i]}"
    if docker image inspect "$img" >/dev/null 2>&1; then
      echo "build：${role}在场：$img"
    else
      echo "build：${role}缺失，按 infra/VERSIONS.md 钉定引用拉取：$img"
      missing+=("$img")
    fi
  done
  pull_images_concurrent "${missing[@]}"
}

# 并发拉取：缺失镜像同批拉取，失败汇总成一次非 0 退出。
# 失败不吞掉：子进程各自写状态文件，父进程 wait 全部后逐条汇总。
pull_images_concurrent() { # $@ = 缺失的镜像引用
  local -a todo=("$@")
  [ "${#todo[@]}" -eq 0 ] && return 0
  local dir; dir="$(mktemp -d)"
  local -a pids=() names=()
  local i=0 img
  for img in "${todo[@]}"; do
    (
      set +e                                   # 失败不能因 errexit 提前退出，状态必须落盘
      docker pull "$img" >"$dir/$i.log" 2>&1
      rc=$?                                    # pipefail 下取的是 docker pull 的退出码
      printf '%s\n' "$rc" >"$dir/$i.status"
      exit "$rc"                               # wait 拿到的就是这个码
    ) &
    pids+=("$!"); names+=("$img"); i=$((i + 1))
  done
  local pid
  for pid in "${pids[@]}"; do wait "$pid" || true; done
  local -a failed=()
  local st
  for i in "${!names[@]}"; do
    st="$(cat "$dir/$i.status" 2>/dev/null || echo missing)"   # 状态文件缺失＝失败
    if [ "$st" = "0" ]; then
      echo "build：镜像就位：${names[$i]}"
    else
      failed+=("${names[$i]}")
      echo "[FAIL] 镜像拉取失败：${names[$i]}（docker pull 退出码 $st）" >&2
      tail -3 "$dir/$i.log" 2>/dev/null | sed 's/^/  /' >&2
    fi
  done
  rm -rf "$dir"
  if [ "${#failed[@]}" -gt 0 ]; then
    echo "[FAIL] build：${#failed[@]} 个镜像拉取失败（${failed[*]}）。" >&2
    exit 1
  fi
}
```

**调用点（`dev:665-666`）**：

```bash
  ensure_images
```

（原两行 `ensure_toolchain_images` / `ensure_infra_images` 合并为一行。）

### 6.5 输出规范（每行一句一事）

| 情形 | 输出行 | 去向 |
|---|---|---|
| 镜像在场 | `build：工具链镜像在场：<img>` / `build：infra 镜像在场：<img>` | stdout |
| 镜像缺失（拉取前） | `build：<角色>缺失，按 infra/VERSIONS.md 钉定引用拉取：<img>` | stdout |
| 拉取成功 | `build：镜像就位：<img>` | stdout |
| 拉取失败 | `[FAIL] 镜像拉取失败：<img>（docker pull 退出码 <n>）` ＋ `docker pull` 输出末 3 行（每行缩进 2 空格） | stderr |
| 批次收尾（任一失败） | `[FAIL] build：<n> 个镜像拉取失败（<img 列表>）。` ＋ `exit 1` | stderr |

**没有实时进度**：本设计把 `docker pull` 的输出收进日志文件，只在失败时回显末几行。**推断**（未实测 UX）：本地冷启动时用户会看到「缺失」行后的一段静默。**可选替代**：子进程改为 `docker pull "$img" 2>&1 | sed "s/^/[<img>] /" | tee "$dir/$i.log"`（`pipefail` 已继承，`$?` 仍是 `docker pull` 的码），实时可见但多行输出交错。可由实施票按偏好取舍；**判定成败的机制与输出形态无关**。

### 6.6 原型实测结论

在 `/tmp` 用假 `pull` 函数复刻上述结构（bash 5.3.9，**未入库**）：

| 场景 | 结果 |
|---|---|
| 2 个镜像各耗时 2 秒 | 总耗时 **2.01 秒**（并发生效，串行应为 4 秒） |
| 1 个镜像拉取失败（退出码 1） | 输出 `[FAIL] 镜像拉取失败：<img>（docker pull 退出码 1）` ＋ 该镜像的 pull 输出；**整脚本退出码 1**，只退一次 |
| 2 个镜像失败（退出码 1 与 22） | 两条逐条列出 ＋ 末尾汇总一行；整脚本退出码 1 |
| 成功场景 | 逐条 `build：镜像就位：<img>`，退出码 0 |

**已查证**（原型层面）：并发、失败不吞、一次非 0 退出三条性质成立。**未查证**：真实 `docker pull` 在本机的网络行为与耗时。

---

## 7. Q6：改动会破坏什么

### 7.1 破坏面：没有（E7 证据不破）

**已查证**：全仓 grep（`九命令|十命令|E7|03-command-smoke|command-smoke|命令冒烟|命令行为契约`）的命中点只有：`dev`（`:10-11`、`:21`、`:96`、`:114`、`:289`、`:812`）、`03` 自身、`infra/VERSIONS.md:35`／`:44`、`backend/prisma/schema.prisma:21`、`integration/README.md:13`、`docs/adr/0001` 的 E1–E7 语境、`frontend/src/admin/personnel.test.tsx`（URL 编码的「%E7%8E%8B」＝人名，与本主题无关）、`pnpm-lock.yaml`（哈希串，无关）。

**结论**：**没有任何代码、测试或文档断言「03 跑两次全量 lint」**。03 的断言条数不因改命令而变。

### 7.2 需要顺手订正的两处失效行号引用（**已查证**）

#### ① `backend/prisma/schema.prisma:20-21`

**现文**：

```
// 原注释称「首个业务模块（#52）落地后由其后迁移取代」未成立：E1（e2e/cases/01-from-zero.sh:26）
// 与 E7/E6 冒烟（03-command-smoke.sh:110/137）都以 note='seed-probe' 作从零建库的锚点断言，
```

**核对结果**：

- `01-from-zero.sh:26` —— **有效**。该行正是 `SELECT note FROM migration_probe;` 的 seed-probe 断言。
- `03-command-smoke.sh:110` —— **无效**。该行是 `mkdir -p "$ROOT/node_modules/.fake" "$ROOT/frontend/node_modules"`，与 seed-probe 无关。
- `03-command-smoke.sh:137` —— **无效**。该行是 `psql_db -c 'CREATE TABLE IF NOT EXISTS smoke_keep…'`，与 seed-probe 无关。
- 03 里真正的 seed-probe 断言在 **`03:131-132`** 与 **`03:158-159`**。

**影响**：§2.4 建议的文件头比现文多 2 行，这两处行号还会再后移。**建议**：改成不依赖行号的引用（例：`03-command-smoke.sh` 的「5.1 裸 dev db」段与「5.3 reset」段），或按改动后的实际行号更新。**不订正的代价**：后人按 `110/137` 去找锚点会找不到，可能误判 seed-probe 断言不存在。

#### ② `tools/structural-probe.sh:10`

**现文**：`# 接入：dev lint 的 structural-probe 子项（全量五项之一，dev:360），随 dev check → CI 一起跑；`

**核对结果**：`dev:360` 落在 `write_health_snapshot` 的注释里（`dev:359-360`）。`lint_structural_probe` 的实际位置是 **`dev:436-438`**，`cmd_lint` 的分派在 `dev:486`。

**性质**：这不是本次改动造成的，是既有的失效引用。但本次要动 `dev`（并行拉镜像会改 `dev:618-647` 一带的行号），**建议在同一个实施票里顺手订正**，避免二次漂移。

### 7.3 随并行拉镜像改造而必须改的 3 处（已查证）

| 位置 | 现文要点 | 改法 |
|---|---|---|
| `dev:16-17` | 「`ensure_infra_images` 的 compose config --images 遍历覆盖不到」 | 函数名换成 `ensure_images`（§3.2④） |
| `dev:593` | 「基础镜像已由 `ensure_toolchain_images` / `ensure_infra_images` 按 digest 拉到本地」 | 同上（§3.2⑤） |
| `dev:665-666` | `ensure_toolchain_images` ＋ `ensure_infra_images` 两行 | 合并为 `ensure_images` 一行（§6.4） |

**已查证**：全仓再无其他位置引用这两个函数名（grep `ensure_infra_images|ensure_toolchain_images` 只命中 `dev:16-17`、`:593`、`:618`、`:622`、`:634`、`:665`、`:666`）。

### 7.4 逐条核过、确认**不受影响**的项

| 项 | 结论 | 依据 |
|---|---|---|
| `03:239` 收尾断言「仓库无 node_modules 残留」 | 不受影响。`:114` 仍 `rm -rf` 两个目录 | `03:110-115`、`:239` |
| `03:112` 的 `grep -q 'node_modules'` | 不受影响。`lint_leak` 失败文案含该字样 | `dev:420-421` |
| `03:167-182` 的 `SMOKE_MISSING_IMAGE=1` 分支 | 不受影响。该分支的 `docker pull`（`03:178`）与 `dev` 的拉镜像逻辑无关 | `03:178` |
| `dev lint leak` 是已文档化的 CLI 形态 | 不受影响 | `dev:110`、`dev:484` |
| `dev lint` 全量的五项顺序 | 不变。`lint_leak` 仍是第一项 | `dev:483` |
| CI 只有一步 `./dev check --ci` | 不变 | `.github/workflows/ci.yml:36-37` |
| 03 内 `dev test integration`／`dev build` | 保留 | `03:208`、`:223`（父图 #163 第 ② 项） |
| `e2e/results` 产物目录约定 | 不变 | `dev:819-821`、`.gitignore` |
| `dev test e2e` 的用例排序约定 | 不变 | `dev:825-835` |

### 7.5 实施时的两个坑（**推断**，未实测）

1. **状态文件与 `set -e` 的交互**：子 shell 里漏写 `set +e` 就会丢掉失败原因；父 shell 里漏写 `|| true` 就会在第一次失败时直接退出、丢掉其余失败清单。两处都要写。
2. **`local` 与数组**：本仓库的 `dev` 用了大量 `local`（bash 3.2 兼容语法），新函数里 `local -a missing=() roles=() imgs=() seen=()` 在 bash 3.2 下可用（`local -a` 自 bash 2.05b 起支持），但 `${!imgs[@]}` 的间接展开在 bash 3.2 下同样可用。**已查证**（语法层面），**未实测**（未在 bash 3.2 上实跑）。

---

## 8. 未能确认的事项

| 项 | 状态 | 原因 |
|---|---|---|
| 03 改后实跑是否仍为「53 通过 / 0 失败」 | **推断** | 本次只读研究，未跑 e2e。断言条数不变，但数字未实测（§4.3） |
| 03 改后实跑耗时 | **无法确认** | 未跑。父图已定「不需要收益量化」 |
| 并发拉镜像的真实网络收益 | **无法确认** | 宿主网络条件未知；父图已定不需要量化 |
| `bash 3.2` 上的 `local -a` 与 `${!arr[@]}` 实跑 | **推断** | 语法层面已查证，未在 bash 3.2 实跑（§7.5） |
| 父图 ADR 的最终编号 | **无法确认** | 由父会话决定；本文只建议落点，不指定文件名 |
| #57 勘误评论的发出 | 未发出 | 按任务约束，由父会话代发 |

---

## 附：本文引用的文件与位置索引

| 文件 | 关键行 | 内容 |
|---|---|---|
| `dev` | `19`、`23-29` | `set -euo pipefail`；`normalize_exit_code` 陷阱 |
| `dev` | `94-138` | usage 全文（`test` 段 `113-116`、`build` 段 `117-120`、`check` 段 `121-125`、`lint` 段 `109-112`） |
| `dev` | `14-17` | 脚本头：build 前置与工具链镜像拉取的理由 |
| `dev` | `416-425` | `lint_leak`：检出即 `exit 1` |
| `dev` | `429-431`／`436-438`／`449-457`／`467-477` | `lint_structural`／`lint_structural_probe`／`lint_image`／`lint_eslint` |
| `dev` | `479-495` | `cmd_lint`：全量五项顺序（`483`）与子项分派（`484-488`） |
| `dev` | `593` | `build_frontend` 内的镜像来源注释 |
| `dev` | `618-630`／`634-647` | `ensure_toolchain_images`／`ensure_infra_images` |
| `dev` | `649-671` | `cmd_build`（`665-666` 调两函数） |
| `dev` | `682-697` | `test_unit`（`695` 跑 `pnpm test && pnpm run typecheck`） |
| `dev` | `754-797` | `test_integration`（`765` 跑 `tools/structural-test.sh`） |
| `dev` | `812-841` | `test_e2e` 段注释与用例循环（`825-835`） |
| `dev` | `843-893` | `cmd_check`（`884-886` build、`888` `cmd_lint`、`889-891` 三层测试） |
| `dev` | `926-944` | CLI 分派（`case`）——CLI 路径的唯一入口 |
| `e2e/cases/03-command-smoke.sh` | `2-8` | 文件头（本次改写对象） |
| 同上 | `107-115` | lint 段（本次改写对象） |
| 同上 | `131-132`／`158-159` | 真正的 seed-probe 断言 |
| 同上 | `184-186` | `[说明]` 输出块（本次改写对象） |
| 同上 | `201`／`208`／`223`／`239` | `test unit`／`test integration`／`build`／收尾断言 |
| `e2e/cases/01-from-zero.sh` | `26` | 有效的 seed-probe 锚点引用 |
| `tools/structural-probe.sh` | `10` | 失效的 `dev:360` 引用 |
| `tools/structural-test.sh` | `5-7` | 兜底闸接入 dev lint |
| `infra/docker-compose.yml` | `11`、`31`、`42`、`54`、`71`、`79` | 六个镜像引用 |
| `frontend/Dockerfile` | 基础镜像行 | 工具链镜像 ＋ nginx 镜像（`docker build` 不传 `--pull`） |
| `backend/server/Dockerfile` | 基础镜像行 | 工具链镜像 |
| `backend/prisma/schema.prisma` | `20-21` | 失效的 `03:110/137` 引用 |
| `.github/workflows/ci.yml` | `4-8`、`36-37` | CI 单一来源与唯一检查步骤 |
| `integration/README.md` | `13` | 把 03 当写法参考（不受影响） |
| `infra/VERSIONS.md` | `44` | e2e 层形态记录（不受影响） |
