# #220 截图（62 键齐套与差异表）

- 规格：`tools/screenshot.sh`，镜像为 `infra/VERSIONS.md` 钉定的 `mcr.microsoft.com/playwright:v1.64.1-jammy-amd64`，视口 1440×900，整页，等待 6000 毫秒。日期 2026-10-26。
- 全集定义：`docs/screens/keys-207.txt`（#207 协议第 I 节的 62 键）。实有集合是 `docs/screens/<票>/` 顶层 `*.png` 的并集。`compare/`、`extra/` 不计。
- 本目录补齐此前没有的 38 键。另外 24 键已在 `docs/screens/209/`（5）、`docs/screens/217/`（6）、`docs/screens/218/`（13）。并集 62 键，缺键清单空，多出键清单空。
- 驱动进程不入仓。假接口只在截图进程内，不入库，不替代集成测试。十条虚构线索、七个测试身份见下文。

## 复用与新出

复用（19 张，不重出）：

- `docs/screens/217/`：`clue-remind`、`clue-held-supervision`、`clue-held`、`clue-remind-empty`、`clue-remind-resolve`、`clue-dismiss`。
- `docs/screens/218/`：`ws-board-leader`、`ws-board-supervision`、`drawer-flow`、`ws-board-frontline`、`drawer-basic-reporter-masked`、`drawer-basic-reporter-visible`、`drawer-basic-gaps`、`drawer-basic-reporter-entitled`、`clue-assign-readonly`、`drawer-basic-anon`、`clue-all-supervision`、`clue-all`、`clue-all-filtered`。

这 19 张来自线索原型静态页。相对原型画面基本无差。相对实现壳的差，由本目录新图与下表说明。

已在 `docs/screens/209/`、本票不重出：`shell-topbar-admin`、`shell-topbar-noadmin`、`planned-case`、`planned-supervise`、`planned-admin`。这 5 键无原型对照，说明见该目录 README。

本目录新出 38 键：`admin-org-pool-reassign`、`clue-assign`、`clue-assign-people`、`clue-designate-request`、`clue-designated-lock`、`clue-reassign`、`clue-transfer-out`、`conflict-409`、`dialog-compare`、`drawer-check-done`、`drawer-check-exempt`、`drawer-check-failed`、`drawer-check-unavailable`、`drawer-dup-clean`、`drawer-dup-exempt`、`drawer-dup-hit`、`drawer-dup-multiface`、`ws-attach-anon-confirm`、`ws-attach-error`、`ws-existing-context`、`ws-form-blocked`、`ws-form-gap-confirm`、`ws-form-land`、`ws-form-point`、`ws-geo-cross-district`、`ws-geo-draw`、`ws-geo-file`、`ws-geo-file-error`、`ws-geo-multiface`、`ws-geo-redraw`、`ws-step2-dup`、`ws-step2-exempt`、`ws-step2-failed`、`ws-step2-running`、`ws-step3-clean`、`ws-step3-dup-decide`、`ws-step3-not-owner`、`ws-step3-report-must`。

## 无原型对照的 14 键

依据：#209 已标明的 5 个壳层键，加上线索原型 `frontend/prototype/clue-dispatch/index.html` 的 `SHOTS` 没有对应画面的 9 键。历史关联不另开第 63 键，折进 `drawer-dup-hit` 与 `drawer-dup-multiface`。

| 状态键 | 所在目录 | 依据 |
| --- | --- | --- |
| `shell-topbar-admin` | 209 | 原型无实现壳顶栏 |
| `shell-topbar-noadmin` | 209 | 同上 |
| `planned-case` | 209 | 原型无规划中占位 |
| `planned-supervise` | 209 | 同上 |
| `planned-admin` | 209 | 同上 |
| `admin-org-pool-reassign` | 220 | 原型无停用机构池重新指定 |
| `conflict-409` | 220 | 原型无并发冲突横幅 |
| `drawer-check-unavailable` | 220 | 原型无图层「查不成」 |
| `ws-geo-multiface` | 220 | 原型多要素只取第一个，无逐面预览 |
| `drawer-dup-multiface` | 220 | 原型一条线索一个重合度，无逐面表 |
| `clue-reassign` | 220 | 原型只在锁文案提到重新分派，无重新分派表单 |
| `ws-attach-error` | 220 | 原型附件只记文件名，无类型错误态 |
| `ws-attach-anon-confirm` | 220 | 原型只有提示横幅，无确认控件 |
| `clue-designated-lock` | 220 | 原型有报请期间横幅，无指定完成后的驻留锁。本图取实现里的报请期间指定锁 |

## 差异表

| 项 | 实现画面 | 与原型的差 |
| --- | --- | --- |
| 系统内报请指定管辖 | `clue-designate-request`：③分派决定里的「报请指定管辖」面板，理由必填，拟归属机构选填 | 原型把系统内移送写成已管辖移送。实现改为报请指定管辖 |
| 移送新原因 | `clue-transfer-out`：标题「移送（自然资源部门以外机关）」 | 原因改为自然资源部门以外机关，不再写「已管辖移送（系统外）」 |
| 多面线索 | `drawer-dup-multiface`、`ws-geo-multiface`：同一条线索的第 1 面与第 2 面各一行 | 原型多要素只取第一个。实现逐面列出 |
| 鉴权读报告图 | `drawer-check-done`：「下载核查报告」「下载分析图」，链到 `/api/clues/:id/verification/report` 与 `.../analysis` | 不是内嵌示意地图。未登录不能读这两条链 |
| 实名显式查阅 | `drawer-dup-hit`：反映人默认脱敏，按钮「查看实名」 | 218 的基本信息抽屉是原型图。实现默认脱敏，点按钮才取明文并留痕 |
| 真实分页 | `clue-assign`：待分派视图 `size=4`，文案「第 1/3 页（共 10 条）」 | 原型列表无分页 |
| 4326 转换 | 录入页空间位置是 GeoJSON 文件框，`accept` 为 `.geojson` / JSON | 录入页没有 4326 读出，也没有手绘地图。前端源码不出现 4326 / 4490。转换若发生，在服务端 |
| 逐面双方比例 | `dialog-compare`、`drawer-dup-hit`、`ws-step3-dup-decide`：文案「占本线索 x.x%／占对方 y.y%」 | 原型「较小图斑占比」取整已按协议改掉。实现保留 1 位小数，达标一方加粗 |
| 一次性 multipart | `ws-form-land` 页首：「表单与随附材料一次提交」 | 保存一次提交，请求带 `Idempotency-Key` |
| 真实看板计数 | 无 `step` 的 `/workbench` 请求 `GET /api/workbench/card-counts`，数字来自该接口 | `docs/screens/218/` 的三张看板是原型静态页，数字不是这次接口计数。键已在全集，本票不重出 |
| `/clue` 与 `/workbench` 路由 | 列表与抽屉在 `/clue`。录入三环节在 `/workbench?step=` | 原型是单页 `?shot=`。实现拆成这两条路由 |
| 标签 create-on-use | 录入项「标签（一组词，用时创建）」，按逗号拆开 | 无独立标签管理页，无作废按钮 |
| 附件本期不作废 | 录入项「随附材料」只有文件框 | 无作废、无替换 |
| 原型六处修正 | 见下节 | 重钉前基准与当前原型的六处，实现画面按下节落点 |

### 原型六处修正

1. 系统内移送／已管辖移送（系统外）改为报请指定管辖，以及「移送（自然资源部门以外机关）」。见 `clue-designate-request`、`clue-transfer-out`。
2. 「较小图斑占比」取整改为「占本线索 x.x%／占对方 y.y%」。见 `dialog-compare`、`drawer-dup-hit`。
3. 文件框 `.kml/.zip/.shp/.gpkg` 改为只收 GeoJSON。见 `ws-geo-file` 的 `accept`。
4. 附件「照片、视频」改为 JPG/PNG/PDF/Office，不收视频。见 `ws-attach-error` 同一文件框的 `accept`。
5. 看板 `Math.max` 凑数改为真实计数。实现读 `GET /api/workbench/card-counts`。归档的 218 看板图仍是原型页。
6. 有权身份直接明文改为默认脱敏，点「查看实名」才取明文并留痕。见 `drawer-dup-hit`。

## 本目录逐图自查

身份除特别写出外，均为林晓燕 LIN0101，天河区分局，内勤，操作码含 `clue.register`。

像素相同的组：`ws-form-land`＝`ws-geo-file`＝`ws-geo-draw`＝`ws-geo-redraw`；`ws-existing-context`＝`ws-step2-running`；`ws-geo-multiface`＝`drawer-dup-multiface`。实现没有独立的手绘、重绘、多面地图预览，也没有独立的上下文条。这些键各存一张真实组件图，不另造界面。

| 状态键 | 地址 | 画面 | 相对预期的差 |
| --- | --- | --- | --- |
| `ws-form-land` | `/clue/register?sourceCode=102&domain=land` | 土地登记表。来源「卫片执法（102）」，法域「土地」。空间位置文件框。标签「用时创建」 | 文件按钮是 Chromium 英文 “Choose File”。来源与法域由驱动按地址写入下拉 |
| `ws-form-point` | `/clue/register?sourceCode=304&domain=survey` | 测绘登记。说明一条线索只对应一个点位。无土地类型层「占用面积」 | 无地图选点。点位只靠文件框 |
| `ws-form-blocked` | 同上土地地址，提交后 400，规则为公共层三项 | 红条「还有 3 项必填要件没填」。接报日期、反映的情况、空间位置各标「这一项必填」 | 几何格式错误与缺项共用这一句，没有单独的格式句子 |
| `ws-form-gap-confirm` | 土地地址，提交后 400，仅类型层 `occupied_area` | 琥珀条列出类型层缺件，按钮「确认并保存」 | 与阻断红条分开。确认后仍可保存 |
| `ws-geo-file` | 同 `ws-form-land` | 空间位置（GeoJSON）文件框 | 无原型里的地图读文件预览 |
| `ws-geo-draw` | 同 `ws-form-land` | 同上 | 无手绘。无原型对照的独立画布 |
| `ws-geo-redraw` | 同 `ws-form-land` | 同上 | 无重绘 |
| `ws-geo-file-error` | 土地地址，提交后 400，规则 `clue.location` | 空间位置标「这一项必填」 | 格式不合格也走这一句 |
| `ws-geo-multiface` | `/clue?view=all&clue=c-multi&tab=duplicate` | 第 1 面、第 2 面各一行双方比例 | 无地图多面预览。与 `drawer-dup-multiface` 同一画面。无原型对照 |
| `ws-geo-cross-district` | `/workbench?step=3&clue=c-cross` | 辖区建议琥珀条：跨天河与白云，只列占比，不自动取最大区 | 跨区提示在分派的辖区建议，不在录入地图 |
| `ws-attach-error` | 土地地址，提交后 400，规则 `clue.materials` | 随附材料标「这一项必填」。`accept` 为图片、PDF、Office | 无单独的类型错误句子。无原型对照 |
| `ws-attach-anon-confirm` | 土地地址，匿名附件确认下拉为「是」 | 控件「匿名附件已移除反映人身份信息」 | 是下拉，不是弹窗。无原型对照 |
| `ws-step2-running` | `/workbench?step=2&clue=c-running` | 核查中。编号在核查卡 | 无独立上下文条 |
| `ws-existing-context` | 同上一地址 | 同上一张 | 编号在核查卡内，没有原型 `ctx-bar` |
| `ws-step2-failed` | `/workbench?step=2&clue=c-failed` | 未跑成。可重跑。缺图层「永久基本农田」 | ②不展示疑似重复 |
| `ws-step2-dup` | `/workbench?step=2&clue=c-dup` | 核查已完成，可下载报告与分析图 | 疑似重复不在②。重复在③与抽屉 |
| `ws-step2-exempt` | `/workbench?step=2&clue=c-exempt` | 测绘类不设内业核查 | 与抽屉免核查看同一事实，路由在工作台 |
| `ws-step3-clean` | `/workbench?step=3&clue=c-clean` | 「未发现疑似重复，可直接进入分派。」有不派与派出 | 对比是行内区域，不是宽弹窗 |
| `ws-step3-dup-decide` | `/workbench?step=3&clue=c-dup` | 命中比例，须「已知晓并派出」或不派 | 逐面比例在本页 |
| `ws-step3-report-must` | `/workbench?step=3&clue=c-report` | 群众举报只能派 | 无不派 |
| `ws-step3-not-owner` | `/workbench?step=3&clue=c-not-owner` | 「分派决定由录入人完成；当前账号不是该线索的录入人。」 | 非监督的无权决定 |
| `dialog-compare` | ③，`c-dup`，打开对比 | 「图斑对比」。占本线索／占对方。说明可在地图应用按编号调阅 | 不是宽地图弹窗。无原型对照的独立地图 |
| `conflict-409` | ③，`c-clean`，提交不派得到 409 | 「线索状态已被他人变更，请刷新后重试。」 | 无原型对照 |
| `clue-assign` | `/clue?view=assign&size=4` | 待分派相关列表。第 1/3 页，共 10 条 | 线索中心页同时挂不派区与结案提醒。抽屉不在本图 |
| `clue-assign-people` | `/workbench?step=3&clue=c-people` | 已派机构后的主办、协办 | 候选来自接口 |
| `clue-reassign` | `/workbench?step=3&clue=c-reassign` | 「重新分派」。理由必填 | 无原型对照 |
| `clue-designated-lock` | `/workbench?step=3&clue=c-lock` | 琥珀条：报请期间不能分派、重新分派或移送 | 同时有「待分派池的线索由本机构内勤派出」。锁是横幅，派机构表不渲染。无原型对照 |
| `clue-designate-request` | `/workbench?step=3&clue=c-request` | 「报请指定管辖」表单 | 与派机构同页 |
| `clue-transfer-out` | `/workbench?step=3&clue=c-transfer` | 「移送（自然资源部门以外机关）」 | 新原因文案在标题与说明 |
| `drawer-check-failed` | `/clue?view=all&clue=c-failed&tab=verification` | 抽屉在列表、不派、提醒之下。未跑成 | 抽屉是页内卡片，不是右侧滑出。217/218 的滑出是原型 |
| `drawer-check-unavailable` | `/clue?...&clue=c-unavail&tab=verification` | 图层「生态保护红线」状态「查不成」 | 无原型对照 |
| `drawer-check-done` | `/clue?...&clue=c-clean&tab=verification` | 下载核查报告、下载分析图 | 链是鉴权下载，图内不是地图 |
| `drawer-check-exempt` | `/clue?...&clue=c-exempt&tab=verification` | 测绘类与规划类不设内业核查 | 点状免核查 |
| `drawer-dup-hit` | `/clue?...&clue=c-dup&tab=duplicate` | 占本线索／占对方。「查看实名」。历史关联一节 | 历史关联不新开键。反映人脱敏 |
| `drawer-dup-multiface` | `/clue?...&clue=c-multi&tab=duplicate` | 第 1 面 × 对方第 1 面，第 2 面 × 对方第 1 面 | 无原型对照 |
| `drawer-dup-clean` | `/clue?...&clue=c-clean&tab=duplicate` | 未发现疑似重复 | 空命中 |
| `drawer-dup-exempt` | `/clue?...&clue=c-exempt&tab=duplicate` | 「点状线索不做空间重合判定。」 | 点状不做面重合 |
| `admin-org-pool-reassign` | `/admin/org-units`，身份周敏 SJ0001 | 选中已停用的石牌所。池内线索表与「重新指定」 | 无原型对照。操作码含 `clue.pool.reassign` |

界面文案无「捞回」，无票号样式，无区块 A–E。

## 十条虚构线索

| id | 编号 | 用途 |
| --- | --- | --- |
| c-clean | CL-2026-1001 | 无命中，待分派决定 |
| c-report | CL-2026-1002 | 群众举报，只能派 |
| c-pool | CL-2026-1003 | 待分派池；也作重复对方 |
| c-people | CL-2026-1004 | 已派机构，待派承办人 |
| c-reassign | CL-2026-1005 | 重新分派 |
| c-running | CL-2026-1006 | 核查中 |
| c-failed | CL-2026-1007 | 核查未跑成 |
| c-exempt | CL-2026-1008 | 测绘点状，不设核查 |
| c-multi | CL-2026-1009 | 两个面 |
| c-lock | CL-2026-1010 | 报请期间锁定 |

不在列表里、只按地址打开的：c-dup（CL-2026-1011）、c-cross（1012）、c-transfer（1013）、c-request（1014）、c-not-owner（1015）、c-unavail（1016）。

## 七个测试身份

- 林晓燕 LIN0101，内勤，天河区分局。本目录多数图用此身份。
- 周建军 ZJ0201，法制审核。
- 郑国强 ZG0301，监督。只读分派在 218 的 `clue-assign-readonly`。
- 周敏 SJ0001，系统管理。`admin-org-pool-reassign` 与 209 的管理壳。
- 陈志强 CZ0401，经办。
- 王建国 WJ0501，经办。
- 何静 TH0102，经办。209 的无管理壳与规划中占位。

## 出图方法

1. 在钉定的 node 镜像里构建前端产物。产物不入库。
2. 截图进程提供静态产物，未知路径回落入口页。入口页注入中文字体，字体族名与壳样式第二项相同。身份与状态经查询串写成 cookie。
3. 需要点击的状态（提交、对比、不派、停用机构、展开逐面）由入口页里的脚本完成。`tools/screenshot.sh` 本身不点击。
4. 调用 `tools/screenshot.sh <地址> <png> 1440 900 6000`。不改该脚本，不加 `--no-sandbox`。
