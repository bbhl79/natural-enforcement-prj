# 管理台 HTML 样板 v0.3 · 截图清单（供 ⑥c 验收）

截图规格：Chrome headless（playwright），视口宽 1440，整页截图。全部截图晚于 HTML 最终版生成。每页顶部灰色「样板状态」条只为演示切换，不属于正式界面。

共 72 张。
通用检查（每张都看）：用户可见文本不命中 GLOSSARY 的 _Avoid_ 词（已裁定保留的边界项见 README）；用户可见文本无工程词；无密钥、运行参数、连通状态；P7 无手机号。

## P1 · P1-shell.html

| 截图 | 状态参数 | 要看什么 | 对应条款 | 待 gate① 确认 |
|---|---|---|---|---|
| `screens/P1-multi.png` | `?state=multi` | 左导同时出现「业务办理」「管理台」两区；顶栏姓名·机构·角色（经办、系统管理）；无连通状态、无密钥 | #79 第2问(同壳两区)、第3问(按许可裁剪)；#91 故事55(多角色并集)；#80 | G1、G2、G3 |
| `screens/P1-single.png` | `?state=single` | 只有业务区菜单，无「管理台」一区 | #79 第3问；ADR 0009 | G1、G2、G3 |
| `screens/P1-noadmin.png` | `?state=noadmin` | 内勤：无管理台区，页内说明人话 | #79 第3问；wayfinder §5 P1「没有任何管理权」 | G1、G2、G3 |
| `screens/P1-loading.png` | `?state=loading` | 会话确认中：顶栏无用户、左导骨架，不先渲染菜单 | #91 前端「启动时先等会话查询返回」 | G3 |
| `screens/P1-expired.png` | `?state=expired` | 会话已结束：提示并带「去登录」，回跳原路径（data-route 含 next） | #79 上 #91 约束第2–4条 | G3 |
| `screens/P1-error.png` | `?state=error` | 会话查询失败：可刷新重试，无工程报错 | #91 前端；本样板错误态 | G3 |

## P2 · P2-403-404.html

| 截图 | 状态参数 | 要看什么 | 对应条款 | 待 gate① 确认 |
|---|---|---|---|---|
| `screens/P2-forbidden.png` | `?state=forbidden` | 403：人话说明无权限，给「回到工作台」 | #79 前端守卫；#91 故事58 | G3 |
| `screens/P2-notfound.png` | `?state=notfound` | 404：找不到页面，回工作台 | #79 上 #91 约束第5条(回落 index.html) | G3 |
| `screens/P2-forced.png` | `?state=forced` | 强制改密(首登)时被跳转：PasswordPage 原文案「首次登录必须更换初始口令…」 | #79 上 #91 约束第2、4条；#91 前端 | G3 |
| `screens/P2-forcedExpired.png` | `?state=forcedExpired` | 强制改密(到期)：「口令已超过 90 天…」原文案 | 同上 | G3 |

## P3 · P3-admin-home.html

| 截图 | 状态参数 | 要看什么 | 对应条款 | 待 gate① 确认 |
|---|---|---|---|---|
| `screens/P3-admin.png` | `?state=admin` | 系统管理首屏四入口(机构/人员/被锁人员/管理台留痕)＋执法证需留意；配置类只占位文字；无密钥/运行参数/连通状态 | #79 第2问；#84；#80；#87 | G4、G5、G6、G3 |
| `screens/P3-supervise.png` | `?state=supervise` | 监督只见「管理台留痕」入口，说明不能打开人员名单 | #86；ADR 0007 | G3 |
| `screens/P3-firstday.png` | `?state=firstday` | 条件未齐：上线首日只有根机构和本人，按顺序引导建机构→人员→执法证 | wayfinder D5；#85/#70(无资格不能启动核查) | G4、G7、G3 |
| `screens/P3-loading.png` | `?state=loading` | 四个入口骨架 | 状态覆盖 | G3 |
| `screens/P3-error.png` | `?state=error` | 加载失败可重试 | 状态覆盖 | G3 |
| `screens/P3-denied.png` | `?state=denied` | 经办访问：无权限页 | #79 第3问 | G3 |

## P4 · P4-org-tree.html

| 截图 | 状态参数 | 要看什么 | 对应条款 | 待 gate① 确认 |
|---|---|---|---|---|
| `screens/P4-expanded.png` | `?state=expanded` | 树全部展开；已停用节点灰色删除线＋「已停用」；详情含历史名称；**无拖拽、无移动按钮**，有调整隶属说明 | #81 第4问；wayfinder D3(不移动)；#16 名称版本化 | G8、G10、G3 |
| `screens/P4-collapsed.png` | `?state=collapsed` | 折叠态显示下级数 | #84；wayfinder §5 P4 | G8、G3 |
| `screens/P4-onlyroot.png` | `?state=onlyroot` | 空：只有根机构，引导先建区分局；根机构不能停用 | wayfinder D5 | G12、G3 |
| `screens/P4-create.png` | `?state=create` | 新建下级：上级只读，名称必填 | #81 | G14、G3 |
| `screens/P4-rename.png` | `?state=rename` | 改名弹窗显示历史名称及使用期间 | #81；#16 | G9、G3 |
| `screens/P4-blocked.png` | `?state=blocked` | 停用条件未齐：列出在职人员数、未停用下级，给处理路径 | wayfinder D4 | G11、G3 |
| `screens/P4-confirm.png` | `?state=confirm` | 停用确认：后果逐条列出；已核对前提 | #84 危险操作确认；D4 | G11、G13、G15、G3 |
| `screens/P4-loading.png` | `?state=loading` | 骨架 | 状态覆盖 | G3 |
| `screens/P4-error.png` | `?state=error` | 加载失败 | 状态覆盖 | G3 |
| `screens/P4-denied.png` | `?state=denied` | 监督访问被拒 | #86 | G3 |

## P5 · P5-personnel-list.html

| 截图 | 状态参数 | 要看什么 | 对应条款 | 待 gate① 确认 |
|---|---|---|---|---|
| `screens/P5-district.png` | `?state=district` | 区管理员看本区及下级；含已停用的人(灰)；列不含手机号、证号；角色用七角色名 | #83 第3问；#86；ADR 0009 | G16、G17、G3 |
| `screens/P5-filtered.png` | `?state=filtered` | 按机构/角色/执法证情况筛选 | wayfinder §5 P5 | G16、G17、G3 |
| `screens/P5-empty.png` | `?state=empty` | 筛选无结果：清空筛选/新建人员 | 状态覆盖 | G17、G3 |
| `screens/P5-loading.png` | `?state=loading` | 骨架 | 状态覆盖 | G3 |
| `screens/P5-error.png` | `?state=error` | 加载失败 | 状态覆盖 | G3 |
| `screens/P5-denied.png` | `?state=denied` | 监督：看不到人员名单，引导去管理台留痕 | #86；#83 评论(2026-10-13) | G3 |

## P6 · P6-personnel-card.html

| 截图 | 状态参数 | 要看什么 | 对应条款 | 待 gate① 确认 |
|---|---|---|---|---|
| `screens/P6-view.png` | `?state=view` | 卡片：工号/姓名/手机号(遮挡)/机构/角色/口令；执法证有效；危险操作区四项；打开详情会留痕提示 | #83；#86 | G19、G22、G27、G3 |
| `screens/P6-create.png` | `?state=create` | 新建：工号/姓名/手机号/机构/角色(七选多)/初始口令必填；口令要求清单；执法证可空 | wayfinder 3.4 第1问；#91 口令策略；#70 | G18、G28、G3 |
| `screens/P6-createInvalid.png` | `?state=createInvalid` | 填写有误：顶部汇总＋逐项错误；口令未满足项标红 | #91 故事50 口令策略 | G18、G3 |
| `screens/P6-edit.png` | `?state=edit` | 编辑姓名、手机号、角色；角色下一次操作生效 | wayfinder 3.4 补；#91 故事62 | G3 |
| `screens/P6-transfer.png` | `?state=transfer` | 调岗：目的地不限；数据范围下一次操作生效 | #83；#91 故事61 | G3 |
| `screens/P6-deactivate.png` | `?state=deactivate` | 停用确认：登录下一次操作失效、记录保留、可恢复 | #83；#63 | G20、G3 |
| `screens/P6-restore.png` | `?state=restore` | 已停用人员、所在机构在用：恢复弹窗只设新初始口令，不再顺带选机构（v0.3 改，G21） | D7；spec 5.4④ | G20、G21、G3 |
| `screens/P6-restoreDenied.png` | `?state=restoreDenied` | v0.3 新增：所在机构已停用 → 拒绝恢复，提示「先调岗」；卡片危险操作区有调岗入口 | D7；spec 5.4④；G21 | G21、G3 |
| `screens/P6-resetpw.png` | `?state=resetpw` | 重设初始口令：同时解锁、结束全部会话、下次必须改口令 | #91 管理员动作；故事48–51 | G3 |
| `screens/P6-endsessions.png` | `?state=endsessions` | 结束全部会话(含记住我)，下一次操作结束 | #63；#75 雾区毕业建议 | G22、G3 |
| `screens/P6-self.png` | `?state=self` | 本人卡片：危险操作全部禁用并说明 | #91 故事52(本人被拒) | G23、G3 |
| `screens/P6-certNone.png` | `?state=certNone` | 执法证未登记：可登录不能启动核查/立案/当主办协办 | #70；#85 第5问 | G3 |
| `screens/P6-certExpiring.png` | `?state=certExpiring` | 临期：30 天内到期提醒 | #85；设计假设 | G25、G3 |
| `screens/P6-certExpired.png` | `?state=certExpired` | 已过期：限制说明＋换发后登记新证 | #70；#85 第3问 | G3 |
| `screens/P6-certSuspended.png` | `?state=certSuspended` | 暂扣：证件状态字段 | wayfinder D8(待闸①) | G24、G3 |
| `screens/P6-certEdit.png` | `?state=certEdit` | 登记/变更执法证：证号、有效期、状态；旧值进变更记录；逐条人工 | #85 第2、4问；#77 | G24、G26、G3 |
| `screens/P6-loading.png` | `?state=loading` | 骨架 | 状态覆盖 | G3 |
| `screens/P6-error.png` | `?state=error` | 加载失败 | 状态覆盖 | G3 |
| `screens/P6-denied.png` | `?state=denied` | 监督：不能打开人员详情 | #86 | G3 |

## P7 · P7-locked-personnel.html

| 截图 | 状态参数 | 要看什么 | 对应条款 | 待 gate① 确认 |
|---|---|---|---|---|
| `screens/P7-data.png` | `?state=data` | 列名逐字＝人员标识/工号/姓名/当前机构名/自动解锁时间，**无手机号、无执法证号**；无任职者机构名为空；每行解锁/重设初始口令 | #91 管理员动作；#91 定案评论 2026-10-16 第2条；#84 | G29、G3 |
| `screens/P7-empty.png` | `?state=empty` | 当前没有被锁的人员 | 状态覆盖 | G3 |
| `screens/P7-unlockConfirm.png` | `?state=unlockConfirm` | 解锁确认：只展示五字段内的信息 | #91 故事46 | G31、G3 |
| `screens/P7-resetConfirm.png` | `?state=resetConfirm` | 重设确认：口令要求；同时解锁、结束全部会话、下次改口令 | #91 故事47–51 | G31、G3 |
| `screens/P7-success.png` | `?state=success` | 成功横幅，该行从列表移除 | #91 故事46 | G30、G31、G3 |
| `screens/P7-scopeDenied.png` | `?state=scopeDenied` | 被拒：超出范围(可能刚调岗)，行高亮 | #91 故事53 | G31、G3 |
| `screens/P7-selfDenied.png` | `?state=selfDenied` | 被拒：对自己操作 | #91 故事52 | G31、G3 |
| `screens/P7-loading.png` | `?state=loading` | 骨架 | 状态覆盖 | G3 |
| `screens/P7-error.png` | `?state=error` | 加载失败 | 状态覆盖 | G3 |
| `screens/P7-denied.png` | `?state=denied` | 监督访问被拒 | #83 评论(2026-10-14)：允许行归系统管理 | G3 |

## P8 · P8-admin-audit.html

| 截图 | 状态参数 | 要看什么 | 对应条款 | 待 gate① 确认 |
|---|---|---|---|---|
| `screens/P8-login.png` | `?state=login` | 筛选「认证与会话」(v0.3 由「登录」改名)：登录成功、失败(含未对上人员)、被锁定、结束会话(原因)；只写工号 | #86 决议(认证与授权拒绝)；#91 故事67、68、71、74 | G33、G3 |
| `screens/P8-view.png` | `?state=view` | 筛选「人员查阅」：打开人员详情的记录 | #86 决议(人员查阅留痕) | G33、G3 |
| `screens/P8-admin.png` | `?state=admin` | 市局系统管理：默认列表混排登录、人员查阅、维护类记录；操作类别可选「登录」「人员查阅」；时间/操作人工号/操作/对象/所属机构/结果；含被拒条目；只写工号 | #86；#91 故事69–70 | G33、G3 |
| `screens/P8-supervise.png` | `?state=supervise` | 区监督：只见本区及下级对象的记录；说明无所属机构记录不可见 | #86；#89 | G3 |
| `screens/P8-noanchor.png` | `?state=noanchor` | 「无所属机构」条目，视同市局，仅市局任职可见 | #89；wayfinder 3.8 | G34、G3 |
| `screens/P8-exportConfirm.png` | `?state=exportConfirm` | 导出确认：范围/时间/文件名「管理台留痕_…xlsx」/条数/格式；导出本身记入记录；不含手机号证号 | #86；ADR 0007 | G32、G3 |
| `screens/P8-exportDone.png` | `?state=exportDone` | 导出完成提示 | #86 | G32、G3 |
| `screens/P8-empty.png` | `?state=empty` | 所选时间无记录 | 状态覆盖 | G3 |
| `screens/P8-loading.png` | `?state=loading` | 骨架 | 状态覆盖 | G3 |
| `screens/P8-error.png` | `?state=error` | 加载失败 | 状态覆盖 | G3 |
| `screens/P8-denied.png` | `?state=denied` | 经办访问被拒 | #86 | G3 |
## 无出处界面形态（共 34 处，逐条：待 gate① 确认）

来源：`tmp/loop-review/管理台样板-Researcher.md` ② 节判定为「无出处」的 34 行。v0.2 先保留，不改形态。

| # | 页 | 界面形态 | 涉及截图 | 标记 |
|---|---|---|---|---|
| G1 | P1 | 同一个壳分业务区和管理台两区 | `screens/P1-multi.png`、`screens/P1-single.png`、`screens/P1-noadmin.png` | 待 gate① 确认 |
| G2 | P1 | 菜单按许可裁剪；会话返回许可清单 | `screens/P1-multi.png`、`screens/P1-single.png`、`screens/P1-noadmin.png` | 待 gate① 确认 |
| G3 | P1 | 系统名称（取自 LoginPage.tsx） | 全部截图 | 待 gate① 确认 |
| G4 | P3 | 四个入口（机构、人员、被锁人员、管理台留痕） | `screens/P3-admin.png`、`screens/P3-firstday.png` | 待 gate① 确认 |
| G5 | P3 | 「需要留意的执法证」统计卡 | `screens/P3-admin.png` | 待 gate① 确认 |
| G6 | P3 | 配置类只放文字占位 | `screens/P3-admin.png` | 待 gate① 确认 |
| G7 | P3 | 上线首日三步引导 | `screens/P3-firstday.png` | 待 gate① 确认 |
| G8 | P4 | 树含已停用节点并标明 | `screens/P4-expanded.png`、`screens/P4-collapsed.png` | 待 gate① 确认 |
| G9 | P4 | 历史名称带「使用期间」 | `screens/P4-rename.png` | 待 gate① 确认 |
| G10 | P4 | 不能移动；调整隶属用新建＋调岗＋停用 | `screens/P4-expanded.png` | 待 gate① 确认 |
| G11 | P4 | 停用前提：无在职人员、无未停用下级 | `screens/P4-blocked.png`、`screens/P4-confirm.png` | 待 gate① 确认 |
| G12 | P4 | 根机构不能停用 | `screens/P4-onlyroot.png` | 待 gate① 确认 |
| G13 | P4 | 一期不提供撤销停用 | `screens/P4-confirm.png` | 待 gate① 确认 |
| G14 | P4 | 名称以编制批复为准 | `screens/P4-create.png` | 待 gate① 确认 |
| G15 | P4 | 停用后不能选为承办机构 | `screens/P4-confirm.png` | 待 gate① 确认 |
| G16 | P5 | 列：工号、姓名、当前机构、角色、执法证情况、状态 | `screens/P5-district.png`、`screens/P5-filtered.png` | 待 gate① 确认 |
| G17 | P5 | 按机构、角色、执法证筛选；含已停用 | `screens/P5-district.png`、`screens/P5-filtered.png`、`screens/P5-empty.png` | 待 gate① 确认 |
| G18 | P6 | 工号、姓名、机构、至少一个角色为必填 | `screens/P6-create.png`、`screens/P6-createInvalid.png` | 待 gate① 确认 |
| G19 | P6 | 手机号默认遮挡 | `screens/P6-view.png` | 待 gate① 确认 |
| G20 | P6 | 停用、恢复不审批（D6 未拍板） | `screens/P6-deactivate.png`、`screens/P6-restore.png` | 待 gate① 确认 |
| G21 | P6 | 恢复：只设新初始口令；所在机构已停用则拒绝、提示先调岗（v0.3 按 D7 改；原「恢复时顺带选在用机构」已撤） | `screens/P6-restore.png`、`screens/P6-restoreDenied.png` | 待 gate① 确认 |
| G22 | P6 | 结束全部会话入口放在卡片危险操作区 | `screens/P6-view.png`、`screens/P6-endsessions.png` | 待 gate① 确认 |
| G23 | P6 | 本人不能调岗、结束会话、停用 | `screens/P6-self.png` | 待 gate① 确认 |
| G24 | P6 | 证件状态：有效、暂扣、注销 | `screens/P6-certSuspended.png`、`screens/P6-certEdit.png` | 待 gate① 确认 |
| G25 | P6 | 临期定为 30 天 | `screens/P6-certExpiring.png` | 待 gate① 确认 |
| G26 | P6 | 原证号进变更记录（v0.2 已删除该句，以 #86 为准） | `screens/P6-certEdit.png` | 待 gate① 确认 |
| G27 | P6 | 显示「已改过初始口令（日期）」 | `screens/P6-view.png` | 待 gate① 确认 |
| G28 | P6 | 「请当面或电话告知，不要通过群聊发送」 | `screens/P6-create.png` | 待 gate① 确认 |
| G29 | P7 | 只有手动「刷新」（待定假设 A15） | `screens/P7-data.png` | 待 gate① 确认 |
| G30 | P7 | 成功后该行从列表移除 | `screens/P7-success.png` | 待 gate① 确认 |
| G31 | P7 | 全部操作文案（确认、成功、被拒） | `screens/P7-unlockConfirm.png`、`screens/P7-resetConfirm.png`、`screens/P7-success.png`、`screens/P7-scopeDenied.png`、`screens/P7-selfDenied.png` | 待 gate① 确认 |
| G32 | P8 | 导出格式 .xlsx、文件名「管理台留痕_起止日期.xlsx」 | `screens/P8-exportConfirm.png`、`screens/P8-exportDone.png` | 待 gate① 确认 |
| G33 | P8 | 筛选分类（v0.2 增加两类；v0.3「登录」改名「认证与会话」） | `screens/P8-admin.png`、`screens/P8-login.png`、`screens/P8-view.png` | 待 gate① 确认 |
| G34 | P8 | 「建立首个系统管理人员」一条 | `screens/P8-noanchor.png` | 待 gate① 确认 |
