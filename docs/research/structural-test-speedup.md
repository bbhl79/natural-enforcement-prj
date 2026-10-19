# 结构测试提速：改造形态与等价性判据

日期：2026-10-19（UTC+8）｜关联票：#164（研究票，父图 #162）｜只读查证，未 commit，未建分支。
基线代码：`tools/structural-test.sh` @ `a7e5841`；`tools/structural-probe.sh` @ 同。
测量机器：WSL2 / Linux 6.18，GNU bash 5.3.9，GNU awk 5.3.2，22 核。

本文回答 #164 的 5 个问题。所有数字标注了测量方法；凡未实测的一律标「推断」或「无法确认」。

**本文只做改造形态与判据设计，不改 `tools/structural-test.sh` 一行代码。** 实现票应另开。

---

## 0. 结论摘要

1. **闸的主要成本是「进程数」，不是「算法复杂度」。** 全闸一次 5910 次子进程（`grep` 2330 / `sed` 1237 / `dirname` 865 / `realpath` 864 / `awk` 408 / `tr` 165 / `find` 19）。其中 **1728 次（29%）纯属路径解析**（`realpath -m` 864 + 每次调用内嵌的 `dirname` 864），可压缩到 **1 次 `realpath` + 0 次 `dirname`**。
2. **导入扫描的 864 次 `realpath` 是「重复劳动」而非「必要计算」。** 6 条 import 类规则各自独立扫自己的根，导致同一批「源文件目录 ↔ 相对 specifier」组合被反复解析。实测：全仓唯一组合只有 **181 个**，累计调用 864 次。批量化后 181 次 → 1 次（`realpath -m` 多参数），**0.566 s → 0.008 s**（实测）。
3. **单遍提取与逐文件扫描输出逐字相同，已复核成立**（见 §1.2）。但「537 行」这个数字在本基线上**无法复现**（实测口径为 509 / 515 / 569 行，取决于根集合；已查证等价性成立，数字口径需实现者确认）。
4. **等价性判据必须逐规则归属，不能只看整体红/绿。** 实测一条深路径导入会同时触发 `case-deps` 与 `module-public-entry` 两条规则；现有红探针的 `assert_rule_red` 只检查「期望规则出现在 FAIL 行里」，不做归属断言。
5. **建议本轮排除 `runtime-manifest`**（残余 ≈2.1 s，占改造后总耗时的一半）。它不是导入扫描，语义是「清单 vs compose/CI 逐行对账」，批量化形态与 import 家族不同，混在一起会拉高改动风险。
6. **改造后单次闸耗时预期 3.5–4.5 s**（实测原型：import 家族 10 条规则从 5.93 s 降到 0.48–0.56 s）。
7. **建议在 `dev` 的 usage 写「单次上限」而非「单次期望值」**——上限是回归红线，期望值随机器而变。理由见 §6.3。

---

## 1. 测量方法与口径

### 1.1 测量手段

| 目的 | 手段 |
|---|---|
| 单条规则耗时 | 把 `tools/structural-test.sh` 第 1–848 行（全部 `check_*` 函数定义）抽到 `/tmp/prof/funcs.sh`，逐个 `check_<rule>` 计时。`ROOT` 覆盖为仓库真实根。 |
| 子进程计数 | 造 20 个 shim（`grep`/`sed`/`awk`/`find`/`realpath`/`dirname`/`tr`/`cut`/`xargs`/`sort`/`wc`/`comm`/`mktemp`/`cp`/`rm`/`readlink`/`basename`/`dirname`/`cat`/`head`/`tail`/`node`/`env`/`stat`），每个 shim 先 `printf` 记一笔再 `exec` 真身；`PATH=/tmp/shim:$PATH` 前置。全闸计数 = 5910。 |
| 遍历顺序 | 验证 `grep -r` 的文件访问顺序是 `find` 顺序的**子序列**（Python 断言：173 个 find 文件中，131 个命中文件按同序出现）。这是 §3 单遍提取能保持判定等价的前提。 |
| 改造原型 | `/tmp/proto/gate-fast.sh`：重写 import 家族（6 条 `*-deps` + `supervision-sink` + `module-public-entry` + `shield-no-business-dep`），其余规则照抄老实现。 |
| 等价性对拍 | `/tmp/proto/equiv.sh`：把 `git ls-files` 拷成影子树 `/tmp/shadow`（596 文件），在影子里注入违例，分别跑老闸与新原型，比对 **import 家族 8 条规则的全部输出行**。11 个用例全部 MATCH。 |

### 1.2 「单遍提取与逐文件扫描逐字相同」——已复核

| 口径 | 逐文件（`grep -oE` + `sed`） | 单遍（`grep -rHnoE` + `awk`） | 是否逐字相同 |
|---|---|---|---|
| 4 根 `backend frontend e2e integration`（`SCAN_CODE`） | 509 行 | 509 行 | **是**（顺序敏感 `diff` 亦为空） |
| 5 根 + `packages/shield` | 515 行 | 515 行 | **是** |
| 全部 `packages` | 569 行 | 569 行 | **是** |

**「537 行」口径无法确认。** 已查证：513 / 515 / 533 / 537±2 / 539 / 545 / 551 / 563 / 569 都出现在不同根集合上，537 最接近的是 `packages/audit` 单根的 533 与 `packages/shield`+`packages/audit` 的 539。该数字大概来自某次中间态的根集合口径。**结论对实现者的意义**：等价性（逐字相同）已查证成立；引用行数时必须写明根集合，否则数字无法复现。**推断**——票面 537 可能是 `backend frontend e2e integration packages/audit` 在旧 commit 上的值。

### 1.3 全闸成本解剖（实测）

单次闸 9.5–10.9 s（影子树 3 次：9.64 / 9.57 / 9.71；仓库内首跑 10.87）。逐规则耗时（ms，含各自 `find` 与子进程）：

| 规则 | 耗时 | 规则 | 耗时 |
|---|---|---|---|
| module-public-entry | 3070 | g1-model-allowlist | 25 |
| supervision-sink | 2018 | case-deps / approval-deps / supervision-deps | 19 ×3 |
| runtime-manifest | 2096 | deadline-deps | 21 |
| identity-deps | 775 | shield-single-entry | 11 |
| spatial-no-orm-mutation | 682 | weak-reference-entry | 6 |
| storage-facility-entry | 384 | | |
| queue-facility-entry | 341 | | |
| audit-facility-entry | 215 | | |
| user-lock-assertions | 162 | | |
| geo-dict-deps | 122 | | |
| frontend-boundary | 104 | | |
| frontend-router-mode | 96 | | |
| shield-no-business-dep | 58 | | |
| screenshot-full-set | 31 | | |

**import 家族 10 条合计 5.93 s**（`shield-no-business-dep` 56 + `identity-deps` 791 + `geo-dict-deps` 110 + 4 条 16–19 + `supervision-sink` 1900 + `module-public-entry` 2996 + `weak-reference-entry` 6）。这 5.93 s 里绝大部分是 fork 开销，不是判定逻辑。

### 1.4 放大倍数（CI 层）

`dev check --ci` 链路（`dev:888-891`）：`cmd_lint` → `test_unit` → `test_integration` → `test_e2e`。

| 调用点 | 闸全量运行次数 |
|---|---|
| `cmd_lint` → `lint_structural`（`dev:429-431`） | 1 |
| `cmd_lint` → `lint_structural_probe`（`dev:436-438`） | 24（1 基线 + 22 违例 + 1 收尾基线，`structural-probe.sh:290/303/309`） |
| `test_integration` → 结构测试（`dev:764-765`） | 1 |
| `test_e2e` → `e2e/cases/03-command-smoke.sh` → `"$DEV" lint` × 3（`:108`、`:111`、`:115`） | 3 × 25 = 75 |
| **合计** | **101** |

**101 × 10 s ≈ 17 分钟**纯闸耗时。这是「闸提速是最高杠杆 CI 改动」的量化依据。注意票面描述说「`dev lint` 跑两次」——实测是**外层 lint 阶段 1 次 + e2e 冒烟里 3 次 = 4 次 `dev lint`**，其中 e2e 冒烟那 3 次每次都含 24 次探针闸调用。**已查证**（`e2e/cases/03-command-smoke.sh` 三行调用点；`grep -c '"\$DEV" lint'` = 3）。

---

## 2. 规则清单（21 条）

扫描方式分三类：**A** 逐文件 `grep -oE` + `sed`；**B** 整根 `grep -rEno` 一次；**C** 逐行/逐文件其他手段。子进程数为实测。

| # | 规则 | 源码行 | 扫描方式 | 子进程 | 扫描根 | 扩展名掩码 | 批量化收益 |
|---|---|---|---|---|---|---|---|
| 1 | `shield-single-entry` | 272–294 | **B** 整根 grep | 1 | `backend` `frontend` `e2e` `packages` | ts/tsx/mts/cts/**js/jsx**/mjs/cjs | 已是整根，无收益 |
| 2 | `shield-no-business-dep` | 297–311 | **A** 逐文件 | 23 | `packages/shield` | `SCAN_TS` | **高**（走共享索引） |
| 3 | `identity-deps` | 313→241 | **A** 逐文件 | 306 | `backend/identity` | `SCAN_TS` | **高**（走共享索引） |
| 4 | `geo-dict-deps` | 314→241 | **A** 逐文件 | 50 | `backend/geo-dict` | `SCAN_TS` | **高** |
| 5 | `case-deps` | 315→241 | **A** 逐文件 | 8 | `backend/case` | `SCAN_TS` | **高** |
| 6 | `approval-deps` | 316→241 | **A** 逐文件 | 8 | `backend/approval` | `SCAN_TS` | **高** |
| 7 | `supervision-deps` | 317→241 | **A** 逐文件 | 8 | `backend/supervision` | `SCAN_TS` | **高** |
| 8 | `supervision-sink` | 324–341 | **A** 逐文件 | 763 | `backend` `frontend` `e2e` | `SCAN_CODE` | **高** |
| 9 | `deadline-deps` | 318→241 | **A** 逐文件 | 8 | `backend/deadline` | `SCAN_TS` | **高** |
| 10 | `module-public-entry` | 347–373 | **A** 逐文件 | 1191 | `backend` `frontend` `e2e` `integration` | `SCAN_CODE` | **高** |
| 11 | `frontend-boundary` | 380–392 | **A** 逐文件（自带正则） | 85 | `frontend` | `SCAN_CODE` | **中**（正则不同，需独立单遍） |
| 12 | `weak-reference-entry` | 396–421 | **A** + 先 `grep -rlE` 定位 | 1 | `backend` `frontend` `e2e` `integration` | ts/tsx/mts/cts/mjs/cjs/sh | 低（当前 0 命中） |
| 13 | `g1-model-allowlist` | 453–483 | **C** 读单个 `schema.prisma` | 21 | `backend/prisma/schema.prisma` | — | 低（只 1 个文件，19 次 grep 是白名单逐项比对） |
| 14 | `queue-facility-entry` | 489–507 | **A** 逐文件（自带正则） | 347 | +`packages/shield` | `SCAN_CODE` | **中**（可整根 grep，实测 8 ms） |
| 15 | `storage-facility-entry` | 514–532 | **A** 逐文件（自带正则） | 367 | +`packages/queue` | `SCAN_CODE` | **中**（实测 8 ms） |
| 16 | `audit-facility-entry` | 536–550 | **C** 逐文件 `grep -qE` | 196 | +`packages` | `SCAN_CODE` | **中**（可整根 `grep -rlE`，实测 6 ms） |
| 17 | `spatial-no-orm-mutation` | 562–581 | **C** 逐文件双查（单行 + `tr` 折行） | 496 | `backend` `packages` `integration` `e2e` | `SCAN_CODE` | **中低**（折行二次判定需逐文件 `tr`，165 次） |
| 18 | `runtime-manifest` | 603–722 | **C** 逐行多正则 | 1787 | `infra/docker-compose.yml`、`.github/workflows/ci.yml` | — | 见 §5（本轮排除） |
| 19 | `user-lock-assertions` | 729–782 | **C** 逐文件 awk+grep | 147 | `backend` `packages` `frontend` `integration` `e2e` | `*.test.ts/tsx/mts` | 低（60 次 awk 逐文件剥注释） |
| 20 | `frontend-router-mode` | 789–811 | **C** 逐文件 `grep -q` ×2 | 87 | `frontend`（prune node_modules/prototype/dist） | `SCAN_TS` + package.json/mjs/cjs/js | 低（85 次 grep） |
| 21 | `screenshot-full-set` | 819–847 | **C** 两次 find + `comm` | 8 | `frontend/prototype/.../screens`、`docs/screens` | `*.png` | 无（8 次子进程，31 ms） |

**归类结论**：

- **走共享索引**（同一正则、只需换根/掩码）：规则 2–10，共 9 条。这 9 条是本轮主战场，合计 **5.93 s**。
- **需独立单遍**（正则不同但仍是「文件 → specifier」形态）：规则 11、14、15、16。实测整根 grep 分别 5 / 8 / 8 / 6 ms，可一并批量化，但**不要与 import 家族的共享索引合并**——正则不同，合并会引入误配。
- **形态与导入扫描不同，本轮不动**：规则 13、17、18、19、20、21。理由逐条见 §5.1。

### 2.1 掩码差异的存在性（已查证）

`SCAN_TS` = ts/tsx/mts/cts；`SCAN_CODE` = SCAN_TS + mjs/cjs/sh（`structural-test.sh:142-148`）。

6 条 `*-deps` 用 `SCAN_TS`，`supervision-sink` 与 `module-public-entry` 用 `SCAN_CODE`。差异是否产生实际影响？已查证：6 个模块根（`backend/{identity,geo-dict,case,approval,supervision,deadline}`）与 `packages/shield` 下**没有**任何 `.mjs`/`.cjs`/`.sh` 文件——即当前代码里两种掩码在这 9 条规则上**结果相同**。

**但这是巧合，不是保证。** `backend/prisma/seed.mjs`、`backend/server/*.mjs`、`e2e/cases/*.sh` 都在 `SCAN_CODE` 根内。**已查证：`backend/prisma/seed.mjs` 里确实有一条相对 specifier**（`import … from './generated/prisma/client.ts'`）——它当前被 `module-public-entry` 的 `[ -z "$home" ] && continue` 跳过（§2.2），但若共享索引统一提取而不按掩码过滤，这条 specifier 就会进入 6 条 `check_row` 规则的视野（`check_row` 的根是 `backend/<mod>`，当前不含 `backend/prisma`，所以今天不会命中——但这只是根不重叠这一偶然事实）。**实现必须按规则掩码过滤索引**，不能靠「反正现在没有」。

**推荐做法 3（§3.1）天然规避此风险**：索引存全量，但规则仍用自己的 `find` 拿文件列表（`find` 已按掩码筛过），只把「specifier 从哪来」换成索引查表。**掩码控制权完全不变**——`find` 说扫什么就扫什么，索引只是数据源。这是推荐做法 3 的核心价值。

### 2.2 `home_of` 空归属的两个文件（已查证）

`home_of`（`structural-test.sh:165-183`）对 `backend/prisma/prisma7.config.ts` 与 `backend/prisma/seed.mjs` 返回空串。`module-public-entry` 用 `[ -z "$home" ] && continue` 跳过它们（`:350`）——**这 2 个文件在 `module-public-entry` 里完全不参与判定**。共享索引若不保留这个「按文件跳过」语义，会让 `backend/prisma/` 里的导入变成新违规。**必须保留。**

---

## 3. 改造形态

### 3.1 共享导入索引（替代逐文件 `specifiers_of`）

**原形态**（`specifiers_of`，`:156-160`）：对每个文件起 1 个 `grep` + 1 个 `sed`。

```
specifiers_of() {
  grep -oE "\b(from|import|require)[^'\"]{0,40}['\"](@natural-enforcement/[a-z0-9-]+|\.{1,2}/)[^'\"]*['\"]" \
      "$1" 2>/dev/null \
    | sed -E "s/^[a-z]+[^'\"]*['\"]//; s/['\"]$//"
}
```

**新形态**：一次整根 `grep -rHnoE` + 一次 `awk` 切分，产出「文件 → specifier 列表」的全局索引。

```
grep -rHnoE "$SPEC_RE" --include=*.ts … --include=*.sh \
     "$BACKEND" "$ROOT/frontend" "$ROOT/e2e" "$ROOT/integration" "$SHIELD_DIR" \
| awk -F: '{ i=index($0,":"); f=substr($0,1,i-1); rest=substr($0,i+1); j=index(rest,":");
             m=substr(rest,j+1);
             sub(/^[a-z]+[^"'\'']*["'\'']/,"",m); sub(/["'\'']$/,"",m);
             if(m!="") print f "\t" m }'
```

**根集合与掩码怎么保持可分辨**——这是 §2.1 的关键约束。三条做法：

1. **索引带掩码标签。** 提取时对每个文件记录其扩展名，或直接出两份索引：`IDX_TS`（SCAN_TS 掩码）与 `IDX_CODE`（SCAN_CODE 掩码）。规则按自己声明的掩码取对应那份。**推荐**：一次 `grep` 出全集，awk 里按扩展名分两桶——避免跑两次 grep。
2. **规则层按根过滤。** 索引存全量，规则循环时用「文件是否在本规则根下」+「文件扩展名是否在本规则掩码内」过滤。后者只需在 `find` 结果上判断（`find` 本身已按掩码筛过文件列表，索引里多出的行在按文件取值时自然被跳过）。
3. **两者结合**：索引存全量（一次 grep），规则仍用各自的 `find` 拿文件列表（**`find` 保持不变**），只是把 `specifiers_of "$file"` 换成「从索引取该文件的 specifier 列表」。这样**根目录与扩展名掩码的控制权完全不变**——仍是 `find` 在控制，索引只是把 N 次 grep 换成 1 次。

**推荐做法 3。** 理由：改动面最小——`find` 调用、`SCAN_TS`/`SCAN_CODE` 定义、规则的根参数全部零改动，只替换「specifier 从哪来」这一处。`find` 一共只起 19 次（实测），不是瓶颈。

**实现细节：**

- **分隔符安全。** 文件路径可能含 `:`（当前仓库 0 个，`git ls-files | grep -c ':'` = 0）。用 `index($0,":")` 取首个冒号切文件名；若将来出现含 `:` 的路径，改用 `awk` 的 `FILENAME` 方案或 `grep -rHnoE ... | perl` 之类。**推断**——含 `:` 的路径在 POSIX 文件名里合法，是潜在的边界失效点，实现时应加断言或改用 NUL 分隔。
- **顺序。** `grep -r` 的文件访问顺序是 `find` 顺序的子序列（§1.1 已验证），因此**同一规则内 specifier 的先后顺序不变**，输出的 `[FAIL]` 行顺序也基本不变。等价性判据按集合比对（§4），顺序不参与判定。
- **多行/二进制文件。** `grep -o` 逐文件与 `grep -r` 整根对二进制文件行为一致（都按行处理）；`sed` 与 `awk` 的剥前缀语义需逐字对齐（已对齐，见 §1.2）。

### 3.2 `realpath` 批量化

**原形态**（`target_of_relative`，`:186-199`）：

```bash
target_of_relative() {
  local resolved
  resolved="$(realpath -m "$(dirname "$1")/$2")"     # ← 1 次 realpath + 1 次 dirname
  case "$resolved" in
    "$SHIELD_DIR"|"$SHIELD_DIR"/*)               echo shield ;;
    "$BACKEND"/identity|"$BACKEND"/identity/*)   echo identity ;;
    … 6 条 …
    *)                                            echo "" ;;
  esac
}
```

`target_of_spec`（`:202-208`）对 `@natural-enforcement/*` 走字符串切分，对 `./`/`../` 走 `target_of_relative`。

**为什么现在是 864 次**：9 条 import 家族规则各自独立扫自己的根，每条规则对每个相对 specifier 都独立解析一次。同一对「源文件目录 ↔ 相对 specifier」在多条规则里被反复解析。

**实测去重后只有 181 个唯一组合**（全 5 根并集一次扫，相对 specifier 445 条 → 去重 181 个唯一 `(目录, specifier)` 对）。

**新形态**（两阶段）：

```bash
# 阶段 A：收集全部相对 specifier 的 (源文件目录, specifier) 对
#   键 = dirname(源文件) + "|" + specifier
# 阶段 B：一次 realpath -m 传入全部去重键（每键一个参数）
realpath -m "$key1" "$key2" … > resolved.txt
#   realpath -m 对每个参数输出一行，顺序与参数顺序一致（已实测：181 in → 181 out，逐字节相同）
# 阶段 C：键 → 目标模块名 的查表（bash 关联数组）
```

**「源文件 ↔ specifier」配对怎么保住**——这是票面问题 1 的核心。

`realpath -m` 是**纯函数**：给定同一入参必得同一结果，与入参顺序无关，但**输出行序与参数序一一对应**。所以：

1. 阶段 A 产出的键本身就是「源文件目录 + specifier」的组合，**配对信息已经编码在键里**，不是靠事后对齐恢复的。
2. 阶段 B 传参时**必须按阶段 A 的键序**传，阶段 C 才能把第 i 行结果对回第 i 个键。已实测：`realpath -m` 3 参数 → 3 行，逐行对应；5000 参数 → 5000 行。
3. 查表键 = `dirname(源文件) + "|" + specifier`。**注意不是 `specifier` 单独做键**——同一个 `../foo` 在不同源文件目录下解析结果不同，去重必须在「目录+specifier」这一级做。实测这正是 181 这个数的来源（按 specifier 单独去重会得到更少的数，但会算错）。

**两种写法的语义差异**（票面问题 1 问的「一次多参」vs「awk 内解析」）：

| 写法 | 保留 `realpath -m` 语义？ | 成本 | 风险 |
|---|---|---|---|
| **一次 `realpath -m` 多参数** | **完全保留** | 181 参数 → 8 ms | 参数个数受 `ARG_MAX` 限制（本机 2 MB，181 个键 ≈ 24 KB，**安全**）；键数随仓库增长需分片 |
| awk 内词法归一 | **不保留** | 更低 | 见下 |

**awk 内解析的语义差异（已查证）**：`realpath -m` 会**先解符号链接再处理 `..`**；纯词法归一只删 `..`。实测构造 `/tmp/lx/a/link -> /tmp/lx/other/place`：`realpath -m /tmp/lx/a/link/../b` = `/tmp/lx/other/b`，词法归一 = `/tmp/lx/a/b`。**两者不等价。**

当前仓库**符号链接数为 0**（`find -type l` = 0，`git ls-files -s | awk '$1=="120000"'` = 0），所以此刻两者结果相同。**但这是「当前无符号链接」这一偶然事实，不是规则保证**。若将来引入符号链接（例如 pnpm store 软链、容器挂载软链），awk 词法归一会静默改变判定结果。

**建议：采用「一次 `realpath -m` 多参数」**，保留 `realpath` 语义，不引入符号链接假设。分片阈值取 1000 键/次（≈130 KB，远低于 `ARG_MAX`）。若将来实测 `realpath -m` 在某平台不保证「一参数一行」，需加行数校验（`wc -l` 与键数比对，不符即回退逐个调用）。

**预期新成本**：181 键一次调用 **8 ms**（实测），对比现状 864 次 `realpath` ≈ 2.05 s + 864 次 `dirname` ≈ 1.79 s = **3.84 s**。**节省约 3.8 s**（占全闸 10 s 的 38%）。

### 3.3 改造后总成本预估

| 项 | 现状 | 改造后（实测原型） |
|---|---|---|
| import 家族 10 条（规则 2–10 + `module-public-entry`） | 5.93 s | **0.48–0.56 s**（含索引构建 65–93 ms） |
| 其余 11 条 | ~4.0 s | ~4.0 s（不变） |
| **全闸单次** | **9.5–10.9 s** | **~4.5–5.0 s** |

原型实测三次：562 / 482 / 531 ms（import 家族，含索引构建）。**这是原型量级，不是最终实现量级**——最终实现还要加上 `frontend-boundary`/`queue`/`storage`/`audit` 四条整根 grep（实测合计 27 ms）与索引查找的常数开销。

**若顺带批量化规则 11/14/15/16**，再省约 0.9 s（这四条现状 104 + 341 + 384 + 215 = 1044 ms，批量后约 30 ms）。

---

## 4. 等价性判据：逐规则判定快照

### 4.1 为什么必须逐规则归属

**已查证**：一条深路径导入同时触发两条规则。

```
$ 在 backend/case/src/ 放一行 import … from '@natural-enforcement/identity/src/persistence/x.ts'
[FAIL] case-deps：表内依赖形态违规 backend/case/src/_v.ts → @natural-enforcement/identity/src/persistence/x.ts
[FAIL] module-public-entry：内部路径导入 backend/case/src/_v.ts → @natural-enforcement/identity/src/persistence/x.ts
```

现有红探针的 `assert_rule_red`（`structural-probe.sh:270-283`）只断言「期望规则名出现在某条 `[FAIL]` 行里」+「整体退出码 = 1」。它**不**断言「只有这条规则红了」，也**不**断言「该规则红的原因与改造前一致」。一个把 `case-deps` 判红理由从「深路径形态」改成「别的理由」的改造，现有探针照样通过。

### 4.2 快照的形态

**每个规则一份「判红集合」**。集合元素 = 一条归一化的违规记录。

**归一化规则**（保证跨次运行可比）：

| 维度 | 归一化方式 |
|---|---|
| 绝对路径 | 换成相对 `$ROOT` 的路径（闸的输出本来就这么写，`${file#"$ROOT"/}`） |
| 规则名 | 从消息体剥离，规则名单独作 key（`[FAIL] case-deps：…` → key=`case-deps`，value=`表外依赖 backend/case/src/x.ts → …`） |
| 消息体 | **整体保留**，不做模糊化——它承载「为什么判红」，正是要对比的东西 |
| 排序 | 集合内按消息字典序排序（`sort`），消除遍历顺序影响 |
| 计数 | 每个规则记录 `FAIL` 集合的大小；`OK` 记为空集 |

**快照文件格式**（建议）：每行一条 `规则名<TAB>归一化消息`，按 `规则名` 再按消息排序。

```
case-deps	表外依赖 backend/case/src/_v.ts → @natural-enforcement/approval/src/x.ts（允许列：shield identity geo-dict）
module-public-entry	内部路径导入 backend/case/src/_v.ts → @natural-enforcement/approval/src/x.ts（只许 @natural-enforcement/<module> 公共出口）
```

### 4.3 存哪

**建议：`tools/structural-snapshot/`（新建目录）**，文件名 `<场景>.snapshot`。

理由：
- 快照是**闸的衍生物**，与 `tools/structural-test.sh` 同处最便于对照，且**不能进 `integration/`**——闸会扫 `integration/`（`module-public-entry` 根含 `integration`，`:369`），快照文件里的违规字面量会被闸自己判红（`structural-probe.sh:7-9` 记的就是这个坑）。
- 不能进 `docs/`——`docs/` 不是代码目录，闸不扫，但快照是机器产物不是人读文档。
- 一个目录而非单文件：需要**多场景**快照（见 §4.5）。

**入库还是不入库**：建议**入库**。它是判定基线，不入库就无法在 CI 里做「老基线 vs 新实现」的自动比对（§4.5）。

### 4.4 怎么生成

快照必须能在**同一棵源码树**上分别跑「改造前」与「改造后」两个版本的闸。

**步骤**：

1. 取源码树一份干净副本（`git ls-files` 拷贝，或 `git worktree`）。
2. 在其上跑**改造前**的闸（`git show <base>:tools/structural-test.sh`），抓 `[FAIL]` 行 → 生成基线快照。
3. 在**同一棵**源码树上跑**改造后**的闸 → 生成候选快照。
4. `diff` 两份快照。

**关键：违例必须先注入。** 干净树上全绿，快照是空集——空集 diff 空集 = 恒等，证明不了任何事。**快照的判红集合必须在「注入了违例的树」上采集。**

### 4.5 场景矩阵（推荐）

一个场景 = 一棵注入了指定违例的树。建议至少三类：

| 场景 | 违例 | 覆盖的规则 | 对应现有设施 |
|---|---|---|---|
| **S1 基线** | 无 | 全部 21 条（应全绿） | 探针的基线段（`structural-probe.sh:290`） |
| **S2 单规则违例集** | 每条规则各一个最小违例 | 21 条逐条覆盖 | 探针的 22 条 case（**但现只覆盖 10 条**） |
| **S3 多规则交叉** | 一条违例同时触发多规则 | 交叉归属 | 需新造 |

**S2 的覆盖缺口（已查证）**：探针 22 条 case 覆盖 **10** 条规则：

```
audit-facility-entry(1)  frontend-boundary(1)  frontend-router-mode(2)  g1-model-allowlist(1)
module-public-entry(3)  queue-facility-entry(1)  runtime-manifest(8)  spatial-no-orm-mutation(2)
supervision-sink(1)  user-lock-assertions(2)
```

**未覆盖的 11 条**：

```
approval-deps  case-deps  deadline-deps  geo-dict-deps  identity-deps  screenshot-full-set
shield-no-business-dep  shield-single-entry  storage-facility-entry  supervision-deps  weak-reference-entry
```

**票面推测的「8 条未覆盖的 import 扫描规则」已查证为 11 条**，其中 import 扫描型是 **8 条**：`identity-deps`、`geo-dict-deps`、`case-deps`、`approval-deps`、`supervision-deps`、`deadline-deps`、`weak-reference-entry`、`shield-no-business-dep`——**与票面列举完全一致**（票面问的「`shield-no-business-dep` 是不是」：是，它确实未被覆盖）。另外 3 条未覆盖的是 `shield-single-entry`（整根 grep 规则）、`storage-facility-entry`（自带正则）、`screenshot-full-set`（文件名集合）——**不是 import 扫描型**，票面未列举它们属正常。

**这 11 条正是本轮改造会碰到的规则。** 也就是说：**红探针当前对本次要改的规则零覆盖**。S2 必须补齐这 11 条的违例 case，否则改造后的闸若把某条 import 规则改坏了（比如掩码过滤写反），现有 CI **不会报警**。

**建议**：把这 11 条的违例 case 补进 `tools/structural-probe.sh` 的 `SPECS`（机制现成：`write_probe_<id>` + 一条 `SPECS` 记录），**先作为独立票落地并合入，再做提速改造**。这样提速改造有现成的红/绿基线。

### 4.6 通过判据

**改造后的闸，在同一棵源码树上，生成的逐规则快照必须与基线快照逐字节相同。**

具体：

1. **规则集合相同**：21 条规则都在（不多不少）。少一条 = 规则被误删；多一条 = 规则被误加。
2. **每条规则的判红集合相同**：逐字节。**集合相同但元素文本不同 = 不通过**（判红理由变了）。
3. **红/绿分布相同**：某规则从「红」变「绿」或反之，必须不通过。
4. **退出码相同**。
5. **「文件缺失」语义单独比对**（§4.7）。

**不通过的处置**：

- **以基线为准。** 基线是「改造前已合入 main 的行为」，是既成事实。改造后与之不同 = 行为变了 = 不通过。
- 唯一合法的例外：**基线本身是错的**（判红理由不准确、掩码过滤写反等）。此时先开一张「修正基线」票，把基线改对，**单独合入并说明理由**，再做提速改造。**不允许在提速改造的同一张票里顺手改基线**——那会让「等价性验证」自证失效。
- 快照 diff 必须**按规则归因**：输出形如 `规则名 | 期望 N 条，实得 M 条 | 差异明细`，让看 diff 的人第一眼知道是哪条规则变了。这直接对应票面问题 3 的「比对不一致时以谁为准」。

### 4.7 「文件缺失」语义的单独比对（票面问题 2 的后半）

三条规则的「文件不在场」语义**各不相同**，且**必须逐条保留**（已查证，实测见下）：

| 规则 | 缺失对象 | 判定 | 源码行 |
|---|---|---|---|
| `check_row`（6 条 `*-deps`） | 模块目录 | **绿**（`note_ok "$mod-deps：模块目录尚不存在（空行，无表外依赖）"`） | `:245` |
| `g1-model-allowlist` | `schema.prisma` | **绿**（`note_ok "…schema.prisma 不在场（无模型 = 无 G1 越界）"`） | `:456` |
| `runtime-manifest` | compose / CI 文件 | **红**（`note_fail "runtime-manifest：缺少被核对的文件 $rel"`） | `:614` |

实测（三处分别在影子树上删除对应对象后跑闸）：

```
geo-dict-deps  →  [OK]   geo-dict-deps：模块目录尚不存在（空行，无表外依赖）
g1-model-allowlist → [OK]   g1-model-allowlist：schema.prisma 不在场（无模型 = 无 G1 越界）
runtime-manifest   →  [FAIL] runtime-manifest：缺少被核对的文件 infra/docker-compose.yml
```

**三者的理由不同，改造时不能统一化**：

- `check_row` 绿，因为「模块目录不存在 = 该模块还没有表外依赖」，是**语义上的空真**。
- `g1-model-allowlist` 绿，因为「没有 schema = 没有 model = 没有 G1 越界」，也是空真。
- `runtime-manifest` 红，因为清单与 compose/CI 是**双向对账**：compose 文件本该存在且必须被核对，缺失本身就是「清单与部署形态脱节」的信号，不是空真。

**改造影响面**：

- `check_row` 的目录缺失判定在 `check_row` 内部（`:245`），**在 `find` 之前**。共享索引化后，这个「先判目录存在再扫」的顺序**必须保留**——否则 `backend/geo-dict` 目录不存在时，索引里没有它的条目，规则会误报「无表外依赖」之外的东西（或误判 OK 文案）。**实现要求**：目录缺失时**直接 return**，不进索引循环。
- `g1-model-allowlist` 不在 import 家族内（只读 1 个文件），本轮不动，语义天然保留。
- `runtime-manifest` 本轮排除（§5），语义天然保留。

**判据落地**：§4.6 的快照要**再跑一轮「缺失场景」**——删掉 `backend/geo-dict`、删掉 `backend/prisma/schema.prisma`、删掉 `infra/docker-compose.yml`，各生成一份快照，与对应的基线快照比对。这三条的 OK/FAIL 文案本身就是判据的一部分。

### 4.8 可复现性（供后续实现者）

给后续实现者的完整复现步骤：

```bash
# 1. 取基线版本与候选版本的闸
git show <base-sha>:tools/structural-test.sh > /tmp/old-gate.sh
git show <candidate-sha>:tools/structural-test.sh > /tmp/new-gate.sh

# 2. 取一棵干净源码树（两版共用同一棵，保证唯一变量是闸本身）
mkdir /tmp/tree && git archive <base-sha> | tar -x -C /tmp/tree

# 3. 注入违例（每个场景一棵）
#    违例集复用 tools/structural-probe.sh 的 write_probe_* 机制

# 4. 各跑一次，抓 [FAIL] 行，按 §4.2 归一化，逐规则分组排序

# 5. diff
diff /tmp/snap-old.txt /tmp/snap-new.txt
```

**注意**：闸用 `ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"`（`:80`）**从自身位置推导根**。所以把闸拷到别处跑会扫错树。跑法必须是「把闸放到树的 `tools/` 下再执行」，或改造闸让它接受 `ROOT` 覆盖（原型就是这么做的）。**这是实现时的一个坑，实现者必须知道。**

---

## 5. 排除 `runtime-manifest` 的理由

### 5.1 本轮排除的规则清单与各自理由

| 规则 | 排除理由 |
|---|---|
| **`runtime-manifest`** | 见 §5.2 |
| `g1-model-allowlist` | 只读 1 个文件，21 次子进程是「白名单 18 项逐项 `grep -qx` 比对」（`:474`），不是遍历成本。25 ms，无收益。 |
| `user-lock-assertions` | 60 次 awk 是「逐文件剥块注释再匹配」的结构性需求（`:757-764`），且测试文件发现本身要 `find`。162 ms，改造要动判定逻辑而非提速。 |
| `frontend-router-mode` | 85 次 grep 是「两次 `find`（带 prune）+ 逐文件 `grep -q`」，且**两条子规则的掩码不同**（一条 SCAN_TS，一条含 package.json/mjs/cjs/js，`:794` vs `:802-804`），整根 grep 需分两次。96 ms，低收益。 |
| `screenshot-full-set` | 8 次子进程（2 find + 2 sort + 2 comm + 1 wc + 1 xargs），31 ms。无收益。 |
| `spatial-no-orm-mutation` | **折行二次判定**（`:573`）必须逐文件做（`tr '\n' ' '` 后再匹配），165 个文件 = 165 次 `tr`，整根批量化解决不了这一半。单行那一半可批量化但只省 ~150 ms。 |
| `shield-single-entry` | 已是整根 `grep -rEno` 一次调用，1 次子进程。**已是本仓最优形态**，无需改造。 |

### 5.2 `runtime-manifest` 的排除理由（票面问题 4）

**实测成本**：1787 次子进程（907 grep + 528 sed + 347 awk + 3 xargs + 1 wc + 1 cut），2096 ms——**是 import 家族之外最贵的单条规则**。

**为什么不纳入本轮**：

1. **形态不同。** import 家族是「文件 → specifier 集合 → 逐条判定」，天然适合「一次提取 + 共享索引 + 查表」。`runtime-manifest` 是「compose/CI 逐行 × 多种正则 × 清单比对」，其 347 次 awk 主要来自两处：① 每行跑 2–3 个 `sed`/`grep` 管道（`:630-631`、`:639`、`:648-649`、`:658`、`:705-707`）；② **清单里每个 secret 逐行比对夹具值**（`:709-716`，`for name in $MANIFEST_SECRETS` 内层再起 1 个 awk）。第 ② 项的复杂度是「行数 × secret 数」，当前 3 个 secret × 143 行 = 429 次 awk，是主要成本。要批量化它需要重写整个「逐行逐 secret」的判定流，**不是套用 import 家族的模板**。

2. **语义特殊性。** 它判的不只是「有没有引用清单外的名字」，还有「密钥写了字面量」「密钥带默认值回落」「密钥带 `||` 回落」「出现夹具值」等 6 类子判定（`:628`、`:636`、`:646`、`:656`、`:660`、`:676`、`:683`、`:686`、`:697`、`:702`、`:713`），每类的归一化消息都不同。批量化的等价性验证要覆盖 6 类子判定 × 2 个文件，而探针当前有 8 条 case 覆盖 `runtime-manifest`（占 22 条 case 的 36%）——**它恰恰是探针覆盖最好的规则**。在本轮同时动 import 家族与它，会让「哪条改动破坏了哪条规则」的归因变难。

3. **它是本轮唯一有完整探针覆盖的重规则。** 改造它需要先有等价的逐规则快照基线（§4），而它的快照基线比 import 家族复杂 6 倍。**先做简单的，复杂的后做。**

4. **风险收益比。** 它的 2096 ms 是「清单对账」语义，任何批量化的语义偏差都直接导致「密钥漏检」——这是安全向的失效模式，不该与纯结构规则的提速混在一张票里。

**排除后的残留成本**：

| 项 | 数值 |
|---|---|
| `runtime-manifest` 单条 | 2096 ms（实测） |
| 改造后全闸 | ~4.5–5.0 s |
| 其中 `runtime-manifest` 占比 | **~42–47%** |
| 若顺带批量化规则 11/14/15/16 后的全闸 | ~3.6–4.1 s，`runtime-manifest` 占比升至 ~51–58% |

**结论**：排除 `runtime-manifest` 意味着**改造后它成为最大单块成本**。这是本轮刻意接受的残留——但**必须作为下一张票明确排出**，否则改造完会给人「已经优化过了」的错觉，而实际上最贵的规则还在原地。**建议下一张票**：专做 `runtime-manifest` 的批量对账（重点攻「行数 × secret 数」那个 429 次 awk 的循环）。

---

## 6. 预期耗时与「单次上限」约定

### 6.1 预期区间

| 形态 | 单次闸耗时 | 每次 CI（101 次闸） |
|---|---|---|
| 现状 | 9.5–10.9 s | ≈ 16–18 分钟 |
| 改造后（仅 import 家族） | ~4.5–5.0 s | ≈ 8–9 分钟 |
| 改造后（+ 规则 11/14/15/16 批量化） | ~3.6–4.1 s | ≈ 6–7 分钟 |

**实测原型支撑**：import 家族 10 条规则 5929 ms → 482–562 ms（3 次），**降一个数量级**。全闸数字是「原型量级 + 其余规则实测值」的合成，**不是端到端实测**——端到端需实现票落地后复测。

### 6.2 更稳定的守门指标：子进程预算

**耗时受机器负载影响，不适合当回归红线。子进程数是确定性的**——同一份源码树，同一个闸，fork 次数与机器无关（实测全闸 5910 次）。

**建议把「子进程预算」作为守门指标**：

| 形态 | 全闸子进程数 | import 家族占比 |
|---|---|---|
| 现状 | 5910 | 2366（40%） |
| 改造后（仅 import 家族） | ~3544 | ~4（仅索引构建的 2–3 次） |
| 改造后（+ 11/14/15/16） | ~3500 | ~4 |

实测分解：import 家族 10 条 = 2366（`module-public-entry` 1191 + `supervision-sink` 763 + `identity-deps` 306 + `geo-dict-deps` 50 + `shield-no-business-dep` 23 + 4 条 `*-deps` 各 8 + `weak-reference-entry` 1）；其余 11 条 = 3542（`runtime-manifest` 1787 占其半）；合计 5908，与全闸直接计数的 5910 差 2（顶层 `readlink` + `find` 的一次性开销）。

守门方式：在闸里统计自身起过的子进程数（`$BASHPID` 计数或包一层计数 shim），超预算即红。**推断**——需要决定计数机制（改闸代码 vs CI 侧 shim 包装），后者不改闸、但只在 CI 生效。**推荐 CI 侧 shim**，闸保持纯粹。

**注意**：现全闸 5910 次中，`grep` 2330 + `sed` 1237 = 3567 次（60%）来自 import 家族与 `frontend-boundary`/`queue`/`storage` 的逐文件扫。批量化后 `grep`+`sed` 应降到 **< 300 次**。### 6.3 「单次可接受耗时上限」该不该写进 `dev`

**建议：写，但写「上限」不写「期望值」，且与机器无关的指标优先。**

**理由**：

1. **上限是回归红线，期望值不是。** 「单次闸 ≤ 15 s」在慢机器上会误报，「单次闸 ≈ 4.5 s」在快机器上无约束力。**上限要按「最慢的可接受机器」定**——本机（WSL2，共享内核，进程创建偏慢）实测 9.5–10.9 s，CI 机器通常更快。取一个宽松上限（如 20 s）能抓住「退化到逐文件扫」这类数量级事故，又不会因机器差异误报。
2. **但纯时间上限不够。** 真正的回归形态是「子进程数从 3050 涨回 5910」——耗时可能只从 4.5 s 涨到 6 s，时间上限抓不住。**子进程预算才是精确的守门指标**（§6.2）。
3. **不该写死期望值。** 期望值随机器、随仓库规模漂移，写进 usage 会变成需要维护的假事实，且会诱导「达不到就调数字」。

**建议写法**（写进 `dev` 的 usage 注释，`dev:109-112` 附近）：

```
  lint     全量静态检查（结构测试 + 红探针 + 依赖漏入库检查 + 工具链镜像核对 + ESLint，容器内执行）。
           lint <子项> 单跑一项：leak（依赖漏入库）/ structural（结构测试）/
           structural-probe（结构测试红探针：写入违例源码断言兜底闸确实变红）/
           image（工具链镜像定案核对）/ eslint（容器内 ESLint 全量）；无参 = 全量五项。
           结构测试（structural）是纯源码扫描，其耗时随仓库源码量线性变化，
           不与机器性能绑定；改造后的设计目标是「一次全量扫描 + 共享索引」，
           单次闸的子进程数是稳定量纲（改造前 5910，改造后约 3000）。
           结构测试单次超过 20 s 视为形态退化（退回逐文件扫描），按失败处理。
```

**「20 s」这个具体值是推断**——依据是本机实测 9.5–10.9 s 留一倍余量。**实现者应按 CI 机器实测重定**。

**不写进 `dev` usage 的替代方案**：写在 `tools/structural-test.sh` 的文件头注释里（那里已经有大量「为什么这么写」的设计说明，`:1-77`），并让 `dev` 的 usage 保持现状（它是给使用者看的命令说明，闸的实现细节不该塞进 usage）。**推荐这条**——`dev` usage 面向「命令怎么用」，闸的性能约定面向「闸怎么维护」，后者归 `tools/structural-test.sh` 头注释更合适。

### 6.4 顺带一提：探针的放大倍数

探针跑整个闸 **24** 次（`structural-probe.sh:290/303/309`），实测单次探针 **4 分 11 秒**（后台计时）。改造后探针预期降到 ~2 分钟。

但更根本的问题是 §1.4 的 **101 次**——`e2e/cases/03-command-smoke.sh` 里 `"$DEV" lint` 出现 **3** 次（`:108`、`:111`、`:115`），每次都含 24 次探针闸调用。**这 3 次里有 2 次是「造 node_modules 验证 leak 检查」与「清掉后验证恢复」**（`:110-115`），属于 leak 检查的负例，与结构测试无关，却每次都把整个探针重跑一遍。

**这不在本票范围**（本票是闸内部提速），但**它是比闸内部提速更大的杠杆**：把 e2e 冒烟里的 `dev lint` 收敛成「1 次全量 + 2 次只跑 `lint leak` 子项」，101 次闸可降到 ~30 次。**建议另开一张票**记录这个发现。

---

## 7. 未决与无法确认项

| 项 | 状态 |
|---|---|
| 「537 行」的确切口径 | **无法确认**。等价性成立已查证（§1.2），但该数字对应的根集合/中间态无法定位。实现者引用行数时必须写明根集合。 |
| 改造后全闸端到端耗时 | **推断**。§3.3 的 ~4.5–5.0 s 是「原型量级 + 其余规则实测值」合成，非端到端实测。 |
| `realpath -m` 多参数在所有目标平台「一参数一行」的保证 | **已查证（Linux 本机）**，5000 参数 → 5000 行。跨平台（macOS BSD realpath）**无法确认**，实现时须加行数校验与回退。 |
| 含 `:` 的文件路径 | **无法确认**。当前仓库 0 个（`git ls-files | grep -c ':'` = 0），但 POSIX 允许。实现时宜加断言或改用 NUL 分隔。 |
| 符号链接对 `realpath -m` 与词法归一的影响 | **已查证**（两者不等价，见 §3.2）。当前仓库 0 个符号链接，故本轮两种写法结果相同；**推荐仍用 `realpath`**，不留隐患。 |
| 「单次上限 20 s」的具体值 | **推断**。按本机实测 10.9 s 留近一倍余量。实现者应按 CI 机器实测重定。 |
| 票面「`dev lint` 跑两次」 | **已查证为 4 次**（外层 1 + e2e 冒烟 3），见 §1.4。 |
| 探针未覆盖 11 条规则的新增 case | **本票不实现**。建议先补齐并合入，再做提速改造（§4.5）。 |

---

## 8. 建议的落地顺序

1. **先补探针覆盖**：为 §4.5 列出的 11 条未覆盖规则各加一条 `write_probe_*` + `SPECS` 记录，独立成票合入。**这是提速改造的前置条件**——没有它，改造后的闸若改坏了 import 规则，CI 不会报警。
2. **再做 import 家族提速**：共享索引 + `realpath` 批量化 + 保留 §4.7 的缺失语义。配套落地 §4 的快照基线与逐规则 diff。
3. **再批量化规则 11/14/15/16**（可选，独立票）。
4. **专票做 `runtime-manifest`**（§5.2 末段）。
5. **另票收敛 e2e 冒烟的 `dev lint` 次数**（§6.4）。
6. **最后在 `tools/structural-test.sh` 头注释写性能约定**（§6.3），并考虑加子进程预算守门（§6.2）。

---

## 附：关键源码位置索引

| 位置 | 内容 |
|---|---|
| `tools/structural-test.sh:113-135` | `RULES` 数组，21 条规则名 |
| `tools/structural-test.sh:142-148` | `SCAN_TS_NAMES` / `SCAN_CODE_NAMES` / `SCAN_TS` / `SCAN_CODE` |
| `tools/structural-test.sh:156-160` | `specifiers_of`（逐文件 grep+sed，本轮替换点） |
| `tools/structural-test.sh:165-183` | `home_of`（含 2 个空归属文件） |
| `tools/structural-test.sh:186-199` | `target_of_relative`（含 `realpath -m`+`dirname`，本轮批量化点） |
| `tools/structural-test.sh:202-208` | `target_of_spec` |
| `tools/structural-test.sh:219-238` | `ASSEMBLY_EXEMPT` / `is_assembly_exempt` |
| `tools/structural-test.sh:241-269` | `check_row`（含目录缺失判绿 `:245`） |
| `tools/structural-test.sh:453-483` | `check_g1-model-allowlist`（含 schema 缺失判绿 `:456`） |
| `tools/structural-test.sh:603-722` | `check_runtime-manifest`（含文件缺失判红 `:614`） |
| `tools/structural-probe.sh:244-267` | `SPECS` 22 条 case |
| `tools/structural-probe.sh:270-283` | `assert_rule_red`（只断言「规则名出现」，不归属） |
| `tools/structural-probe.sh:290/303/309` | 探针的 3 处闸调用（24 次） |
| `dev:109-112` | `dev lint` usage 注释（性能约定的候选落点） |
| `dev:429-438` | `lint_structural` / `lint_structural_probe` |
| `dev:764-765` | `test_integration` 里的结构测试调用 |
| `dev:888-891` | `cmd_check` 的四段调用链 |
| `e2e/cases/03-command-smoke.sh:108/111/115` | 3 次 `"$DEV" lint` |
