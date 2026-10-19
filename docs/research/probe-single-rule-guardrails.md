# 红探针单规则化：护栏形态与规则覆盖缺口

日期：2026-10-19（UTC+8）｜作者：Researcher｜只读查证，未 commit，未建分支，未改任何源文件。
问题：给兜底闸加 `--rule` 过滤后，红探针的证据形态怎么改，才不丢「整闸变红」与「接线完整性」。
范围：`tools/structural-test.sh`（兜底闸）、`tools/structural-probe.sh`（红探针）、`dev`（唯一开发入口）、`e2e/cases/03-command-smoke.sh`、`.github/workflows/ci.yml`。
基线仓库：`a7e5841`（工作树干净，`git status --porcelain` 空输出）。

**标注约定**：**已查证** = 本次在本仓库源码或实测中直接取得；**推断** = 由已查证事实推导、未直接实测；**无法确认** = 需要本仓库之外的信息或本次未做。
**测量环境**：宿主 Linux，bash 5.3.9。为不触碰本仓库，全部计时在 `/tmp/ne-probe-copy`（工作树副本）上实测；副本与本仓库同一 commit 内容。

---

## 1. 结论

| # | 问题 | 一句话结论 | 依据 |
|---|---|---|---|
| 1 | 探针解剖 | 探针 = 首尾两次全量基线 + 22 次「写违例→跑全闸→还原→断言」；断言是**两条**：退出码必须为 1，且输出里必须出现目标规则的 `[FAIL]` 行 | `tools/structural-probe.sh:285-323`、`:270-283` |
| 2 | 探针还原 | 三件套：`CREATED` 临时文件直接删、`MODIFIED`/`SAVED` 逐字节备份还原并 `cmp -s` 校验、`trap cleanup EXIT` 兜底 | `tools/structural-probe.sh:18-64` |
| 3 | 护栏 ① 整闸变红 | 单规则跑只证明「这条规则自己能红」。整闸变红要靠**静态断言闸的聚合语义 + 一次带违例的全量运行**补回，两者合计 < 0.2 s + 10.2 s | §3.1 |
| 4 | 护栏 ② 数组内过滤 | 过滤必须落在 `for rule in "${RULES[@]}"` 循环体内；未知规则名**必须报错退出**，否则会静默跑 0 条规则并打印「全部规则通过」——此行为已实测 | §3.2 |
| 5 | 护栏 ③ 接线完整性 | 三处集合必须逐字相等：RULES 数组 ↔ `check_` 函数集 ↔ 探针目标规则集；当前探针只覆盖 10/21 | §3.3 |
| 6 | 成本 | 现状单次探针 256.5 s（实测）；单规则化后 33 条用例 + 3 次整闸变红 = 85.2 s（实测），**覆盖规则反而从 10 条升到 21 条** | §4 |
| 7 | 覆盖缺口 | 未覆盖的是 **11 条**（票面写 8 条），其中 8 条确为 import 类，另有 3 条非 import 类；11 条各有一条**只命中自身**的违例，本次全部实测通过 | §5 |
| 8 | 弱化与反论 | 过滤后弱化的是「整闸退出码聚合」这一条；反过来，单规则跑的退出码 1 **只能**来自目标规则，逐条断言比今天**更强** | §6 |
| 9 | 票面三处订正 | ①未覆盖是 11 条不是 8 条；②「违例被别的规则掩盖」在当前实现下不成立（闸不早退）；③一次 CI 探针实跑 **3** 次不是 2 次 | §7 |
| 10 | dev 命令面 | `--rule` 不必暴露到 `dev`。闸与探针是 `tools/` 内部机制；ADR 0004「不新增第 11 个 dev 命令」与父图「不增删 dev 命令面」都不必被动 | §3.4 |

---

## 2. 探针解剖（问题 1）

### 2.1 它怎么跑闸

`tools/structural-probe.sh` 是纯源码扫描脚本，宿主侧执行，无容器、无网络依赖（文件头 `:1-12`）。它调用兜底闸**恰好三处**：

```bash
# tools/structural-probe.sh:290   —— 0. 基线（干净源码必须全绿）
  out="$("$STRUCTURAL" 2>&1)"; got=$?

# tools/structural-probe.sh:303   —— 1. 逐条探针（写违例 → 跑闸 → 还原 → 判定）
    out="$("$STRUCTURAL" 2>&1)"; got=$?
    cleanup
    assert_rule_red "$label" "$rule" "$out" "$got"

# tools/structural-probe.sh:309   —— 2. 收尾基线（全部还原后必须回到全绿）
  out="$("$STRUCTURAL" 2>&1)"; got=$?
```

`STRUCTURAL="$ROOT/tools/structural-test.sh"`（`:16`）。因此**闸的调用点只有这一处变量**，`--rule` 必须且只需从 `:303` 注入；`:290` 与 `:309` 是全量基线，**不得**带过滤器。

`:300-306` 的循环形态是「写违例 → 跑闸 → **先还原再判定**」，注释明写「还原先于判定，互不污染」。这个次序必须保持：还原在前，判定在后。

### 2.2 两条断言（逐字引用，`tools/structural-probe.sh:270-283`）

```bash
assert_rule_red() {
  local label="$1" rule="$2" out="$3" rc="$4"
  if [ "$rc" -ne 1 ]; then
    report_bad "$label：违例未被判红（结构测试退出码 = $rc，期望 1）→ 该规则恒绿，兜底无效"
    echo "$out" | grep -E '^\[(OK|FAIL)\]' | sed 's/^/    /' >&2
    return
  fi
  if ! grep -qE "^\[FAIL\] ${rule}[：:]" <<< "$out"; then
    report_bad "$label：结构测试判红了，但没命中期望规则 $rule（实际判红项见下）"
    grep -E '^\[FAIL\]' <<< "$out" | sed 's/^/    /' >&2
    return
  fi
  report_ok "$label：$rule 确实把整体判成红"
}
```

断言一：`rc == 1`（`probe:272`）。断言二：整段输出里存在 `^\[FAIL\] <目标规则名>：`（`probe:277`）。

### 2.3 违例怎么写、怎么还原

三类写入机制（`probe:23-46`）：

| 机制 | 落点 | 备份 | 还原方式 |
|---|---|---|---|
| `tmp_write`（`:23-28`） | 写新文件，`mkdir -p` + `printf` | 无（文件是新建的） | `cleanup` 里 `rm -f`（`:50`），登记在 `CREATED`（`:18`） |
| `inplace_append`（`:30-37`） | 追加内容行到既有文件 | `cp -a` 到 `mktemp` 文件，登记 `MODIFIED`+`SAVED`（`:34-35`） | `cp -a "$backup" "$path"`（`:54`） |
| `inplace_delete`（`:39-46`） | 删掉一整行 | 同上 | 同上 |

`cleanup`（`:48-63`）是幂等的：删临时文件 → 逐个把备份拷回 → 用 `cmp -s` **逐字节校验**，不一致就记一次失败（`:55-58`）。`trap cleanup EXIT`（`:64`）保证任何退出路径都还原。

`inplace_delete` 有个实现细节值得记一笔（`:45`）：`grep -vxF -- "$line" "$backup" > "$path" || true`——`>` 会先把目标文件截断，若该行**不存在**，`grep` 返回 1 被 `|| true` 吞掉，结果是文件被清空。备份已存所以能还原，但探针此时量到的是「被清空的文件」而不是预期的违例。新增用例若要用 `inplace_delete`，必须先确认目标行逐字存在。

### 2.4 `--rule` 必须在哪儿落地

兜底闸的派发点是**唯一**的：

```bash
# tools/structural-test.sh:850-852
for rule in "${RULES[@]}"; do
  "check_$rule"
done
```

`RULES` 数组在 `tools/structural-test.sh:113-135`（21 条）。闸的其余结构：

- `set -uo pipefail`（`:78`）——**没有 `-e`**，规则函数返回非零不会中断脚本。
- `FAIL=0` 初始化（`:136`）；`note_fail()` 写全局 `FAIL=1`（`:139`）。
- 末尾 `exit "$FAIL"`（`:859`），前面有「全部规则通过」/「存在失败规则」两分支（`:854-858`）。

因此 `--rule` 的接线契约是**一处过滤 + 一处校验**：

1. 过滤**只能在 `:850-852` 这个循环体内**做（`[ -n "$RULE_FILTER" ] && [ "$rule" != "$RULE_FILTER" ] && continue`）。
2. `--rule <名>` 的取值必须**先对 `RULES` 数组做成员校验**，不在数组里就报错退出。
3. 循环体外的任何按名派发（绕过 `RULES`）都不许做——理由见 §3.2。

---

## 3. 三条护栏（问题 2、3、4）

### 3.1 护栏 ① 整闸变红

**要保住的不变量**：工作树里存在一条违例时，**整闸**（21 条规则全跑）必须退出码为红，并且失败规则在输出里被点名。

单规则化之后，这条不变量**不再被逐条用例证明**（单规则跑只证明「这一条规则自己能红」）。补法是两层，缺一不可：

**静态层（每次探针跑，毫秒级）**——直接核读闸的聚合语义源码，四个条件合起来即「任一规则判红 ⇒ 整闸退出码 1，且失败规则名出现在 `[FAIL]` 行」，且对全部 21 条规则**统一成立**：

1. 派发循环形态是 `for rule in "${RULES[@]}"; do` + `  "check_$rule"` + `done`（`structural-test.sh:850-852`）。
2. 循环体内**没有** `break` / `exit`（否则第一条失败就早退，后续规则永远不跑，探针会误判规则是死的）。
3. `note_fail()` 写的是**全局** `FAIL=1`（`:139`），不是局部变量。
4. 脚本末尾是 `exit "$FAIL"`（`:859`）。

**动态层（一次全量）**——带一条违例跑**全量闸**，断言三件事：退出码 == 1、输出含目标规则的 `[FAIL]` 行、收尾行是「结构测试：存在失败规则」。

**动态层该跑几次？** 这是成本与强度的取舍：

| 方案 | 动态层次数 | 每次探针总耗时 | 说明 |
|---|---|---|---|
| 不做动态层 | 0 | ≈ 55 s | 弱化未补回。不采纳。 |
| 1 条代表用例 | 1 | ≈ 65 s | 静态层已证明聚合语义对所有规则统一成立，动态层只需证明静态读法没错。**推荐。** |
| 每条规则各 1 次 | 21 | ≈ 268 s | 比现状 256.5 s 还慢。否决。 |
| 3 条分族用例 | 3 | **≈ 85 s（实测）** | import 形态类 + 形态/入口类 + 清单/契约类各一条。**折中推荐。** |

本票的实测数据取「3 条」方案（§4）。

**与逐条用例的关系**：护栏 ① 是**独立于**逐条用例的一层。它不复用逐条用例的违例文件（同一时刻只能有一个违例在场），但可以**复用同一批 `write_probe_*` 函数**——本次实测的 3 条整闸变红用例就复用了既有的 `write_probe_module-public-entry`、`write_probe_compose-literal-secret`、`write_probe_g1-model-allowlist`。

**「整闸不误红」的一侧**由首尾两次全量基线承担（`probe:289-297` 与 `:308-315`）：干净树 ⇒ 退出码 0。这两条在单规则化后**必须保留全量**，不能过滤。

### 3.2 护栏 ② 规则数组内过滤 + 未知规则名报错

**契约（三条，缺一不可）**：

1. 过滤落在 `for rule in "${RULES[@]}"` 循环体内（`structural-test.sh:850-852`）。
2. `--rule <名>` 先对 `RULES` 校验；**不在数组里 ⇒ 立刻 `[FAIL] 未知规则名` + 非 0 退出**。
3. 过滤后仍走同一个 `exit "$FAIL"`（`:859`），`FAIL` 初值 0（`:136`）。

**为什么第 2 条不能省——两种失败模式都已实测**：

*失败模式 A：过滤在循环内，但未知名不报错。* 实测 `ONLY_RULE=no-such-rule` 的闸输出：

```
结构测试（#51 全量七模块依赖矩阵……）
结构测试：全部规则通过。
rc=0
```

**没有一条规则跑，却打印「全部规则通过」并退出 0**。这是一次**静默通过**。探针的 `rc == 1` 断言能兜住它（会报「违例未被判红」），但闸本身在撒谎，诊断信息也会误导（人看到的是「闸说全绿」，不是「规则名写错了」）。

*失败模式 B：按名在 `RULES` 数组之外派发（闸的注释 `:8-9` 写明「新增一个 `check_<规则名>()` 函数，并将其名追加到 `RULES` 数组即可」——这条约定正是为防这个）。* 实测：往闸里塞一个 `check_probe-unwired()` 函数但**不**加进 `RULES`：

| 运行方式 | 结果 |
|---|---|
| 全量闸 | 该函数**一次都没跑**（grep 命中数 = 0）⇒ 它是**死规则**（恒绿死规则） |
| `--rule` 在 `RULES` 之外按名派发 | `check_probe-unwired` 被调用，输出 `[FAIL] probe-unwired：……`，退出码 1 |

后者是**危险方向**：探针的 `rc == 1` 与 `[FAIL] <目标规则>：` 两条断言**全部通过**，探针会为一个**在真实闸里从不执行的死规则**出具「活规则」证明。这正是本探针存在的目的所反对的东西（`probe:2-5`：兜底闸只出示「全绿」，无法区分「规则通过」与「规则根本没在扫」）。

**所以「接线完整性」（护栏 ③）与「数组内过滤」（护栏 ②）是同一条命脉**：③ 保证 `RULES` 与函数集、探针集三者一致，② 保证过滤不能绕过 `RULES`。

**今天若某规则不在 `RULES` 里会怎样？** 它**不会被执行**——闸的派发完全由 `RULES` 驱动（`:850-852`），没有第二条入口。探针今天会怎么发现？探针写违例后跑全闸，若目标规则不在 `RULES`，其 `[FAIL]` 行永远不会出现 ⇒ `assert_rule_red` 的第二条断言失败 ⇒ 探针报「结构测试判红了，但没命中期望规则」并整体非 0 退出。**今天这条路径是通的**（实测：把 `shield-no-business-dep` 从 `RULES` 删掉后，对应用例报「结构测试判红了，但没命中期望规则 shield-no-business-dep」，实际判红项是 `[FAIL] 未知规则名：shield-no-business-dep（不在 RULES 数组内）」）。

**单规则化后这条路径是否还通？** 通，而且更强：加了未知名校验后，`--rule <被删掉的规则>` 会命中「未知规则名」分支 ⇒ 退出码 1，但输出是 `[FAIL] 未知规则名：…` 而**不是** `[FAIL] <规则名>：` ⇒ 探针的 grep 断言失败 ⇒ 报「没命中期望规则」⇒ **大声失败**。护栏 ③ 同时也会报「存在 `check_` 函数但未接入 `RULES` 数组（死规则）」。**双锁。**（本次实测：删掉 `shield-no-business-dep` 后，探针在逐条用例层与接线完整性层**同时**报红，整体退出码 1。）

### 3.3 护栏 ③ 接线完整性

要断言「闸里每条规则都真的被跑到、真的被测过」。三处集合，逐字相等：

| 集合 | 来源 | 断言 |
|---|---|---|
| **规则集** | `RULES` 数组（`structural-test.sh:113-135`） | 基准 |
| **函数集** | 闸源码里 `^check_<名>` 的全部定义 | 规则集 ⊆ 函数集（无悬空规则名）；函数集 ⊆ 规则集 ∪ 已声明 helper（无「写了但从未接线」的死规则） |
| **探针覆盖集** | `SPECS` 每条的目标规则（`probe:244-267`） | 探针覆盖集 == 规则集（**每条规则至少一条违例用例**） |

**实现要点**：

- **单一事实源**。探针要读规则集，不该去 `sed` 解析闸源码（格式一变就脆）。给闸加一个只读模式最省事：
  `if [ "${1:-}" = "--list-rules" ]; then for r in "${RULES[@]}"; do echo "$r"; done; exit 0; fi`
  （本次实测可用，`--list-rules` 输出 21 行。）同理可加 `--list-helpers` 输出已声明的 helper 名。
- **helper 必须显式声明**。当前闸里 `check_row`（`:241`）是 6 条 deps 规则共用的辅助函数，**不在** `RULES` 里。护栏 ③ 要能区分「helper」与「死规则」，办法是在闸里显式声明 `HELPERS=(row)`，护栏断言 `函数集 == 规则集 ∪ HELPERS`。**不做这件事，护栏 ③ 就会把 `check_row` 误报成死规则。**
- **护栏 ③ 的三条断言本次全部做了负例测试，确认能真的报红**：

| 负例 | 护栏 ③ 的反应（实测） |
|---|---|
| 从 `RULES` 删掉 `shield-no-business-dep`（函数仍在） | 「存在 `check_` 函数但未接入 `RULES` 数组（死规则…）：shield-no-business-dep」 |
| 新增一个 `check_orphan-rule()` 但不加进 `RULES` | 同上，点名 `orphan-rule` |
| 从 `SPECS` 删掉 `g1-model-allowlist` 那条 | 「这些规则没有违例用例（新增规则必须同时补一条探针用例）：g1-model-allowlist」 |

### 3.4 `--rule` 要不要暴露到 `dev lint structural`

**结论：不必暴露，且建议不暴露。**

- ADR 0004《单一 HTTP 进程与同域入口》定案句：「不新增第 11 个 `dev` 命令，不引入 Playwright。CI 仍只调用 `./dev check`」（`docs/adr/0004-单一HTTP进程与同域入口.md`，「Consequences」段）。
- 父图 #162 的约束继承：「本图**不增删 dev 命令面**、不增删 CI 步骤、不改触发策略」。
- `dev lint` 的子项面是**冻结**的五个：`leak` / `structural` / `structural-probe` / `image` / `eslint`（`dev:479-495`，帮助文本 `dev:109-112`）。给 `structural` 挂一个 `--rule` 参数，虽不新增命令，但**确实扩了 `dev` 的对外参数面**，需要单独的定案依据。
- `--rule` 的全部用途都在**探针内部**：`probe:303` 用它跑单规则。外部没有第二个消费者。

因此建议：`--rule` 只存在于 `tools/structural-test.sh` 与 `tools/structural-probe.sh` 两个 `tools/` 内部脚本里；`dev:430`（`lint_structural`）与 `dev:437`（`lint_structural_probe`）**保持不带参数**。这样 `dev` 命令面零变动，ADR 0004 与父图约束都不被触动。

若将来确实要在 `dev lint structural --rule <名>` 暴露（例如供人工单查一条规则），那是一次独立的命令面变更，需要按仓库惯例走定案票，且不得成为本图的一部分。

---

## 4. 成本结构（问题 5）

### 4.1 实测数据

全部在 `/tmp/ne-probe-copy`（本仓库工作树副本，commit `a7e5841` 同内容）实测，bash 5.3.9。

| 测量项 | 命令 | 耗时 | 备注 |
|---|---|---|---|
| 全闸一次（干净树） | `./tools/structural-test.sh` | **10.19 s** | 与父图「≈8–11 s」一致 |
| **现状探针**（22 用例 + 2 基线 = 24 次全闸） | `./tools/structural-probe.sh` | **256.5 s**（4m16s） | 22/22 用例通过，退出码 0 |
| 21 条规则各跑一次（单规则） | 逐条 `ONLY_RULE` | 合计 **11.03 s** | 最贵三条：`module-public-entry` 3.54 s、`supervision-sink` 2.14 s、`runtime-manifest` 2.05 s |
| 22 条现有用例改单规则 | 逐条 `ONLY_RULE` | 合计 **33.27 s** | 按用例目标规则计（`runtime-manifest` 8 次占 16.4 s） |
| 11 条新增用例（覆盖未覆盖规则）改单规则 | 逐条 `ONLY_RULE` | 合计 **1.60 s** | 最贵两条：`identity-deps` 0.86 s、`storage-facility-entry` 0.39 s |
| **单规则化探针**（33 用例 + 2 全量基线） | 改造后探针 | **54.7 s** | 33/33 通过，退出码 0；**覆盖 21/21 条规则** |
| **单规则化 + 护栏 ①**（再 +3 次带违例全量 + 静态断言） | 改造后探针 | **85.2 s** | 39 项全通过，退出码 0 |

关键量：**33 条用例的单规则跑只比 22 条多花 1.6 s**。因为新覆盖的 11 条规则恰好是 import 扫描类（每条 0.01–0.86 s），而最贵的三条规则（`module-public-entry` / `supervision-sink` / `runtime-manifest`）本来就已被覆盖。

**成本结构的本质**：全闸 10.2 s 里，八成以上来自 3 条重规则（`module-public-entry` 3.54 s + `supervision-sink` 2.14 s + `runtime-manifest` 2.05 s = 7.73 s，占 76%）。单规则化并不是「把 24 次全闸换成 22 次单规则」这么简单——**单规则的总成本 ≈ 全闸的成本**（11.03 s vs 10.19 s），省下来的是**重复扫描的次数**，不是单次扫描的代价。

### 4.2 一次 CI 里到底跑几遍探针

`dev` 的调用链（已查证）：

- `cmd_check` → `cmd_lint`（`dev:888`）→ `cmd_lint all`（`dev:483`）→ `lint_structural_probe`（`dev:436-438`）→ `tools/structural-probe.sh`。**第 1 次。**
- `cmd_check` → `test_e2e`（`dev:891`）→ 逐个跑 `e2e/cases/*.sh`（`dev:825-835`）→ `03-command-smoke.sh` 里 **3 次** `"$DEV" lint`：
  - `:108` 全绿那次 → 探针跑。**第 2 次。**
  - `:111` 植入 `node_modules` 那次 → `cmd_lint all` 的**第一项**就是 `lint_leak`（`dev:483`），`lint_leak` 发现漏入库即 `exit 1`（`dev:422`）⇒ **探针根本没跑到**（本次实测该次 `find` 耗时 0.009 s，与父图「0.04 秒」同量级）。
  - `:115` 清除 `node_modules` 后恢复全绿那次 → 探针跑。**第 3 次。**
- 其余 e2e 用例（`01`/`04`/`05`/`06`/`07`）**都不调 `dev lint`**（已 grep 全量确认，只调 `db reset`/`up`/`health`）。

**结论：一次 CI 里探针实跑 3 次。** 父图 #162 写的「全量 lint 被跑 2 次」低估了一次：lint 入口被调 **3** 次，其中 1 次在 leak 项即返回；探针入口被调 **3** 次。CI 仍然只有一步（`.github/workflows/ci.yml:37`：`./dev check --ci --run-id …`）。

### 4.3 改造前后对比

| 口径 | 现状 | 单规则化（33 用例 + 3 次整闸变红） | 倍数 |
|---|---|---|---|
| 单次探针的闸运行次数 | 24 次全闸 | 33 次单规则 + 2 次全量基线 + 3 次带违例全量 = 38 次 | 次数 ↑，单次成本 ↓ |
| 单次探针墙钟 | **256.5 s** | **85.2 s** | **3.0×** |
| 一次 CI 的探针总墙钟（3 次） | **769.5 s** ≈ 12.8 min | **255.6 s** ≈ 4.3 min | **3.0×** |
| 一次 CI 的闸总墙钟（3 次探针 + 3 次 `dev lint structural`） | 769.5 + 30.6 ≈ **800 s** | 255.6 + 30.6 ≈ **286 s** | 2.8× |
| 探针覆盖的规则数 | **10 / 21** | **21 / 21** | ↑ |
| 探针用例数 | 22 | 33 | ↑ |

「探针占 lint 阶段多少」：**推断**。lint 全量 = leak（~0.1 s）+ structural（10.2 s）+ probe（256.5 s）+ image（~0.1 s）+ eslint（容器内，**未实测**）。若 ESLint 需 20–60 s，探针占 lint 墙钟约 **78%–89%**，与票面「~90%」相符。单规则化后该占比降到约 **55%–74%**（ESLint 未变，是新的分母大头）。

---

## 5. 覆盖缺口：11 条未覆盖规则各该写什么违例（问题 6）

### 5.1 覆盖现状（已查证）

`RULES` 21 条（`structural-test.sh:113-135`）。探针 `SPECS` 22 条（`probe:244-267`），目标规则分布：

| 目标规则 | 用例数 |
|---|---|
| `runtime-manifest` | 8 |
| `module-public-entry` | 3 |
| `user-lock-assertions` | 2 |
| `spatial-no-orm-mutation` | 2 |
| `frontend-router-mode` | 2 |
| `supervision-sink` / `queue-facility-entry` / `g1-model-allowlist` / `frontend-boundary` / `audit-facility-entry` | 各 1 |

**覆盖 10 条。未覆盖 11 条**：

```
approval-deps          case-deps              deadline-deps
geo-dict-deps          identity-deps          supervision-deps
shield-no-business-dep shield-single-entry    storage-facility-entry
weak-reference-entry   screenshot-full-set
```

票面写「未覆盖的 8 条恰是 import 类」——**8 条确实是 import 类**（上列前 8 条），但**另有 3 条不是**：`shield-single-entry`（grep 形态）、`storage-facility-entry`（SDK 形态）、`screenshot-full-set`（文件名集合比对）。**未覆盖总数是 11 条。**

### 5.2 风格参照

- **`spatial-no-orm-mutation` 参照**（`probe:79-88`、`:122-130`）：`tmp_write` 一个新文件到被扫目录内，内容写成「换行链式 ORM 写」／「装配层 ORM 写」，靠**代码形态**命中。
- **`module-public-entry` 参照**（`probe:98-103`、`:147-153`）：`tmp_write` 一个新 `.ts` 到 `backend/case/src/`，内容是**跨模块深路径导入**；`exempt-tightness` 变体用 `inplace_append` 追加到 `integration/` 的既有文件，证明「豁免不放行整层」。

### 5.3 11 条违例设计（全部已实测：只命中目标规则，退出码 1）

| 目标规则 | 落点文件 | 违例内容（形态） | 命中机制 | 同规则集内是否连带命中 |
|---|---|---|---|---|
| `shield-single-entry` | `packages/queue/src/_structural-probe.ts`（新建） | `import { probe } from '@natural-enforcement/shield/src/internal.ts';` | `structural-test.sh:272-294` 扫 `backend/frontend/e2e/packages`，命中 `'@natural-enforcement/shield/[^'"]*'`，且该路径不在 `:280-281` 的白名单里 | **否**（`packages/` 不在 `module-public-entry` 的 find 范围 `:369`；`check_row` 只扫 `backend/<mod>`） |
| `shield-no-business-dep` | `packages/shield/src/_structural-probe.ts`（新建） | `import { probe } from '@natural-enforcement/identity';` | `:297-311` 扫 `packages/shield`，`target_of_spec` 得 `identity ≠ shield` | **否**（`packages/` 不被 `module-public-entry` / `check_row` 扫；`queue-facility-entry` 豁免 `$SHIELD_DIR/*` `:493`） |
| `identity-deps` | `backend/identity/src/_structural-probe.ts`（新建） | `import { probe } from '@natural-enforcement/case';` | `check_row`（`:241-269`），允许列 `shield audit`，`case` 表外 | **否**（根导入 `@natural-enforcement/case` 只有一段，不匹配 `@natural-enforcement/*/*`，`module-public-entry` 不命中 `:358`） |
| `geo-dict-deps` | `backend/geo-dict/src/_structural-probe.ts` | `import { probe } from '@natural-enforcement/identity';` | 同上，允许列 `shield` | **否** |
| `case-deps` | `backend/case/src/_structural-probe.ts` | `import { probe } from '@natural-enforcement/approval';` | 同上，允许列 `shield identity geo-dict` | **否** |
| `approval-deps` | `backend/approval/src/_structural-probe.ts` | `import { probe } from '@natural-enforcement/deadline';` | 同上，允许列 `shield identity case` | **否** |
| `supervision-deps` | `backend/supervision/src/_structural-probe.ts` | `import { probe } from '@natural-enforcement/approval';` | 同上，允许列 `shield identity case` | **否**（**目标刻意避开 `supervision`**：任何模块 import `supervision` 都会连带触发 `supervision-sink` `:324-341`） |
| `deadline-deps` | `backend/deadline/src/_structural-probe.ts` | `import { probe } from '@natural-enforcement/identity';` | 同上，允许列 `shield case approval geo-dict` | **否** |
| `weak-reference-entry` | `backend/case/src/_structural-probe.ts` | `export const probe = requireCrossDomainReference;`（注释标明「出现跨域弱引用入口名但未从 shield 导入」） | `:396-421` 用 `grep -rlE 'requireCrossDomainReference'` 找出文件；该文件无 `@natural-enforcement/shield` 导入 ⇒ `imported=0` ⇒ 判红 | **否**（`specifiers_of`（`:156-160`）只提取 `@natural-enforcement/*` 与相对路径，空文件无 specifier ⇒ `check_row` / `module-public-entry` 均不命中） |
| `storage-facility-entry` | `backend/case/src/_structural-probe.ts` | `import { S3Client } from '@aws-sdk/client-s3';` | `:514-532`，`@aws-sdk/*` 只许在 `packages/storage` | **否**（`@aws-sdk/…` 不是 `@natural-enforcement/*` 也不是相对路径 ⇒ `target_of_spec` 返回空 ⇒ `check_row` / `module-public-entry` 均不命中） |
| `screenshot-full-set` | `docs/screens/_structural-probe/probe-extra.png`（新建） | 任意内容的 `.png`（规则只比**文件名**，不比画面） | `:819-847`，`have` 取 `docs/screens` 深度 2 的 `*.png` 文件名并集；`probe-extra.png` 不在 `want`（原型 v0.4 状态键）里 ⇒ 报「全集多出 v0.4 之外的文件名」 | **否**（`docs/` 不在任何代码规则的扫描范围内） |

**实测结果（11/11 全部通过）**：

| 目标规则 | 全闸跑的 `[FAIL]` 行数 / 退出码 | 单规则跑（`--rule`）的 `[FAIL]` 行数 / 退出码 | 实际命中的规则 |
|---|---|---|---|
| `shield-single-entry` | 1 / 1 | 1 / 1 | 仅 `shield-single-entry` |
| `shield-no-business-dep` | 1 / 1 | 1 / 1 | 仅 `shield-no-business-dep` |
| `identity-deps` | 1 / 1 | 1 / 1 | 仅 `identity-deps` |
| `geo-dict-deps` | 1 / 1 | 1 / 1 | 仅 `geo-dict-deps` |
| `case-deps` | 1 / 1 | 1 / 1 | 仅 `case-deps` |
| `approval-deps` | 1 / 1 | 1 / 1 | 仅 `approval-deps` |
| `supervision-deps` | 1 / 1 | 1 / 1 | 仅 `supervision-deps` |
| `deadline-deps` | 1 / 1 | 1 / 1 | 仅 `deadline-deps` |
| `weak-reference-entry` | 1 / 1 | 1 / 1 | 仅 `weak-reference-entry` |
| `storage-facility-entry` | 1 / 1 | 1 / 1 | 仅 `storage-facility-entry` |
| `screenshot-full-set` | 1 / 1 | 1 / 1 | 仅 `screenshot-full-set` |

**设计原则**：每条违例**只**触发目标规则。全闸跑与单规则跑的结果一致（都是 1 条 `[FAIL]`），说明这些违例没有连带效应。

### 5.4 掩盖风险的处理原则

**规则**：一条新违例的「目标规则」必须能被**单独证明**。落地办法有两条，建议同时用：

1. **构造期**：照 §5.3 的表逐条核对「该落点文件会被哪些规则扫到」——`check_row` 只扫 `backend/<mod>`、`module-public-entry` 扫 `backend/frontend/e2e/integration`、`shield-single-entry` 扫 `backend/frontend/e2e/packages`、形态类规则各自有独立扫描范围。避开 `supervision` 作为 import 目标（否则连带 `supervision-sink`）、避开 `packages/storage`（否则豁免 `storage-facility-entry`）、避开 `packages/queue` 的队列 SDK（否则连带 `queue-facility-entry`）。
2. **验证期**：新用例在**全闸**下跑一次，断言「`[FAIL]` 行数 == 1 且规则名 == 目标规则」。这一条断言是**新增的**，今天的 `assert_rule_red` 只要求「目标规则的 `[FAIL]` 行存在」，**允许同时有别的规则命中**——实测现状 22 条用例里有 2 条会连带：
   - `module-public-entry` 那条（`probe:98-103`）同时命中 **`case-deps`**（`backend/case` 引入 `identity` 的深路径，既是「表内依赖形态违规」`:257`，又是「内部路径导入」`:359`）；
   - `ci-literal-secret` 那条（`probe:170-177`）命中 **`runtime-manifest` 两次**（同一规则两个违例点）。

   这两条今天**不算缺陷**（探针只要求目标规则被点名），但单规则化后，**「目标规则单独命中」变成可断言的强性质**，应当顺手收严。

---

## 6. 过滤后哪些语义变弱、怎么补（问题 7）

### 6.1 变弱的语义

| 弱化项 | 今天 | 单规则化后 | 补偿 |
|---|---|---|---|
| **W1 整闸退出码的聚合性** | 每条用例都跑全闸，因此「有违例 ⇒ 整闸退出码 1」被**重复证明 22 次** | 逐条用例只跑单规则，不再证明聚合性 | 护栏 ①：静态断言聚合语义（§3.1，4 个条件）+ 3 次带违例的全量运行 |
| **W2 多规则同时命中时的可观测性** | 全闸输出里能看到「这条违例连带触发了哪些别的规则」 | 单规则输出里只有目标规则 | 这不是要保的语义，是**噪音**。真要看连带，退回 W1 的全量运行即可 |
| **W3 探针顺带发现「别的规则也是死的」** | 某条违例意外让另一条死规则变红时，全闸输出会显示出来（虽然探针不判它） | 单规则跑看不到 | 护栏 ③ 的「函数集 == 规则集 ∪ HELPERS」**直接**发现死规则，比顺带发现更强 |
| **W4 首尾基线的「全量」属性** | 已是全量 | 必须保持全量（**不得**过滤） | 实现约束：`probe:290` 与 `:309` 不带 `--rule`；护栏 ③ 可再断言这两处的调用形态 |
| **W5 闸退出码来源的唯一性** | 退出码 1 可能由**任何**规则产生 | 退出码 1 **只可能**由目标规则产生 | 无需补偿，这是**增强**（见 §6.2） |

**W1 的精确表述**：今天「整闸变红」这个不变量其实是**隐式**成立的——22 条用例每条都跑全闸，任何一条违例都会让全闸退出码为 1。探针虽然**没有单独断言**它，但每次都在事实上重新证明它。改成单规则后，这个事实性证明消失了：逐条用例跑的是 `--rule X`，即使全闸坏了（比如 `exit "$FAIL"` 被误改成 `exit 0`），逐条用例**也照样全绿**。**这是单规则化引入的唯一真实盲区**，也是护栏 ① 必须存在的原因。

### 6.2 反论：单规则化在哪些地方比今天更强

**更强之处 1（最实在）：退出码的唯一性。**

今天的 `assert_rule_red` 两条断言里，**第一条（`rc == 1`）其实是冗余的**——因为闸不早退（`set -uo pipefail` 无 `-e`；`structural-test.sh:850-852` 循环体内无 `break`/`exit`），全闸会把**所有**失败规则都跑完并逐条打印 `[FAIL]`。所以「目标规则的 `[FAIL]` 行出现」⇒「至少一条规则失败」⇒「退出码 1」。反之不成立：退出码 1 可能来自别的规则。

- **今天**：`rc == 1` 不能区分「目标规则红了」和「别的规则红了」。真正起判别作用的是第二条 grep 断言。**若目标规则是死的，但违例意外触发了别的规则，grep 会失败 ⇒ 探针仍能报红。** 所以今天**没有**票面所说的「掩盖」。
- **单规则化后**：`--rule X` 的运行里**只有** X 一条规则会跑，所以 `rc == 1` **只可能**来自 X。此时「退出码 1」这条断言从冗余变成**唯一且充分的**判别依据，grep 变成复核。
- **净效果**：单规则化后，**每条用例都证明了「目标规则自己能独立把闸判红」**；今天只证明了「目标规则在别的规则也失败的情况下仍被点名」。前者是更强的性质。

**更强之处 2：故障定位。** 今天一条违例连带命中 2 条规则时，输出里两条 `[FAIL]` 混在一起，读者要自己分辨「哪个是预期、哪个是意外」。单规则化后输出只有一条。

**更强之处 3：覆盖广度。** 33 条用例覆盖 21/21 条规则，代价是 **+1.6 s/次**。这是「加覆盖还更快」的组合。

**不强之处（诚实列出）**：
- 「整闸退出码聚合」这一条**确实变弱**（W1）。补偿是护栏 ①，代价是 3 × 10.2 s。
- 「一条违例在真实全闸里的完整表现」不再被逐条观察。这**不是**要保的性质——它恰恰是造成「掩盖」误判的来源。

### 6.3 覆盖缺口的补齐与护栏 ③ 的关系

补齐 11 条用例不是可选的装饰，而是**护栏 ③ 的前提**：护栏 ③ 断言「探针覆盖集 == 规则集」，今天这两集合差 11 条 ⇒ 护栏 ③ 一上线就红。所以顺序是：**先补 11 条违例（+1.6 s/次）→ 再开护栏 ③**。

---

## 7. 对票面背景的三处订正

| 票面原文 | 核实结果 | 依据 |
|---|---|---|
| 「22 条违例用例只覆盖 21 条规则中的 10 条」 | **成立** | `probe:244-267` × `structural-test.sh:113-135` |
| 「未覆盖的 8 条恰是 import 类」 | **数量不对**。未覆盖 **11** 条：其中 8 条确为 import 类（`identity-deps`/`geo-dict-deps`/`case-deps`/`approval-deps`/`supervision-deps`/`deadline-deps`/`weak-reference-entry`/`shield-no-business-dep`），另有 3 条非 import 类：**`shield-single-entry`、`storage-facility-entry`、`screenshot-full-set`** | 集合差运算，已查证 |
| 「今天一条违例可能先被别的规则命中而掩盖目标规则」 | **不成立**。闸不早退（无 `set -e`、循环内无 `break`/`exit`），探针对**整段输出** grep 目标规则名。实测 22/22 条用例的目标规则 `[FAIL]` 行都在输出里。真实存在的现象是「连带命中」（2/22 条），不是「掩盖」 | `structural-test.sh:78`、`:850-859`；`probe:277`；实测表见 §5.4 |
| （父图 #162）「一次 CI 里全量 lint 被跑 2 次」 | **少算一次**。`dev lint` 入口被调 **3** 次（外层 `dev:888` + e2e 03 的 `:108`/`:111`/`:115`），其中 `:111` 那次在 `lint_leak`（`dev:422`）就 `exit 1`，探针不参与。故**探针**实跑 **3** 次 | `dev:483`、`:888`、`:416-425`；`e2e/cases/03-command-smoke.sh:108,111,115`；全量 grep 确认其余 e2e 用例不调 lint |
| 「探针每次把兜底闸跑 24 遍」 | **成立**（1 基线 + 22 违例 + 1 收尾） | `probe:290,303,309` |

---

## 8. 实施清单（供规格书取用）

按依赖顺序，每项独立可回退：

1. **闸加 `--rule`（数组内过滤 + 未知名报错）**：`tools/structural-test.sh` 加参数解析与 `RULES` 成员校验；过滤落在 `:850-852` 循环体内。**同时**加 `--list-rules` / `--list-helpers` 只读模式。
2. **闸声明 `HELPERS`**：把 `check_row`（`:241`）登记进 `HELPERS`，供护栏 ③ 区分 helper 与死规则。
3. **探针改单规则跑**：只改 `probe:303` 一行，改为 `"$STRUCTURAL" --rule "$rule"`；`:290` 与 `:309` 保持全量。
4. **补 11 条违例用例**：按 §5.3 表逐条落地，全部为 `tmp_write` 新建文件（不动既有文件，避开 `inplace_delete` 的截断陷阱）。
5. **上护栏 ①**：静态四条件断言 + 3 条分族用例的整闸变红运行。
6. **上护栏 ③**：三集合逐字相等断言（规则集 / 函数集 / 探针覆盖集）。
7. **收严逐条断言（可选）**：新用例额外断言「全闸下 `[FAIL]` 行数 == 1」。
8. **`dev` 命令面不动**：`dev:430` 与 `dev:437` 不传参数。

**回退方式**：第 3 步是唯一改变探针行为的一步，回退只需把 `probe:303` 改回不带 `--rule`（闸的 `--rule` 与 `--list-rules` 可以留着，不影响现有调用）。第 1–2 步对现有调用**完全向后兼容**（不带参数时行为与今天逐字相同）。

**验收证据**：改造后探针 39 项全通过、退出码 0、单次 85.2 s（对比 256.5 s）；覆盖规则 21/21；本文 §3.3 的三条护栏 ③ 负例各能报红；本文 §5.3 的 11 条新用例在全闸下各自只命中 1 条规则。

---

## 9. 未查证与不确定项

- **ESLint 的实际耗时**：**未实测**（需容器内 `pnpm install`，AGENTS.md 规定依赖只准装在容器内）。§4.3 中 lint 阶段的占比因此标为**推断**。
- **CI runner 的真实墙钟**：本地宿主机与 GitHub `ubuntu-latest` 的 CPU/IO 差异未知，§4.1 的绝对秒数不可直接搬到 CI；**相对倍数（3.0×）是结构性结论**（单规则总成本 ≈ 全闸成本，省的是重复次数），与机器无关。
- **`screenshot-full-set` 违例的 `.png` 内容**：规则只比文件名（`:825-826` 的 `-printf '%f\n'`），不校验 PNG 格式与画面。若后续收严该规则，此违例需同步改为真 PNG。
- **护栏 ① 动态层取 3 条还是 1 条**：本文给了两档实测（85.2 s / ≈65 s），最终取几属定案取舍，本文不代拍。
- **`dev lint structural --rule` 是否对外暴露**：§3.4 给了「不暴露」的建议与依据；若决定暴露，属命令面变更，需另走定案票。
