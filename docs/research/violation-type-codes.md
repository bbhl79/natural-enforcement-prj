# 违法类型编码表（定稿）

来源：#203，按 [ADR 0020](../adr/0020-违法类型编码的命名与版本.md) 命名。本表是 #181–#184 四份草案回改的共用对照。

规则摘要：编码取 `<法域短码>_<行为直述>`，短码为 land、mineral、survey、planning。字符集为小写字母、数字、下划线。要件键为 `type.<类型编码>.<字段>`。附录序号只作出处属性，不进编码。

## 一、违法类型编码（94 行）

90 个附录具体违法行为加 4 个「附录外其他」。上级大类编码见第二节。

| 编码 | 名称 | 法域 | 上级大类编码 | 附录序号出处 |
|---|---|---|---|---|
| land_approve_without_authority | 无权批准征收、使用土地的单位或者个人非法批准占用土地，超越批准权限非法批准占用土地 | land | land_cat_approve | 附录 A 一（一） |
| land_approve_wrong_use | 不按照土地利用总体规划确定的用途批准用地 | land | land_cat_approve | 附录 A 一（二） |
| land_approve_illegal_procedure | 违反法律规定的程序批准征收、使用土地 | land | land_cat_approve | 附录 A 一（三） |
| land_illegal_supply | 违法违规供地 | land | land_cat_approve | 附录 A 一（四） |
| land_occupy_without_approval | 未经批准或者采取欺骗手段骗取批准，违法占用土地 | land | land_cat_occupy | 附录 A 二（一） |
| land_occupy_exceed_approved | 超过批准的数量或标准占用土地 | land | land_cat_occupy | 附录 A 二（二） |
| land_occupy_refuse_return | 依法收回非法批准、使用的土地，有关当事人拒不归还 | land | land_cat_occupy | 附录 A 二（三） |
| land_transfer_illegal | 买卖或者以其他形式非法转让土地 | land | land_cat_transfer | 附录 A 三（一） |
| land_transfer_allocated_unapproved | 未经批准，违法转让以划拨方式取得的国有土地使用权 | land | land_cat_transfer | 附录 A 三（二） |
| land_transfer_granted_unqualified | 不符合法律规定的条件，违法转让以出让方式取得的国有土地使用权 | land | land_cat_transfer | 附录 A 三（三） |
| land_transfer_collective | 擅自将农民集体所有的土地通过出让、转让使用权或者出租等方式用于非农业建设，或者违法将集体经营性建设用地通过出让、出租等方式交由单位或者个人使用 | land | land_cat_transfer | 附录 A 三（四） |
| land_farmland_general | 破坏一般耕地行为 | land | land_cat_farmland | 附录 A 四（一） |
| land_farmland_permanent | 破坏永久基本农田行为 | land | land_cat_farmland | 附录 A 四（二） |
| land_reclaim_state_land_refuse | 依法收回国有土地使用权、当事人拒不交出土地 | land | land_cat_misc | 附录 A 五（一） |
| land_temporary_land_refuse | 临时使用土地期满，拒不归还 | land | land_cat_misc | 附录 A 五（二） |
| land_use_mismatch | 不按照批准的用途使用国有土地 | land | land_cat_misc | 附录 A 五（三） |
| land_temporary_permanent_structure | 在临时使用的土地上修建永久性建筑物 | land | land_cat_misc | 附录 A 五（四） |
| land_temporary_reclaim_default | 临时用地期满之日起一年内未完成复垦或者未恢复种植条件 | land | land_cat_misc | 附录 A 五（五） |
| land_pre_plan_rebuild | 在土地利用总体规划制定前已建的不符合土地利用总体规划确定的用途的建筑物、构筑物，重建、扩建 | land | land_cat_misc | 附录 A 五（六） |
| land_forbidden_reclamation | 在国土空间规划确定的禁止开垦的范围内从事土地开发活动 | land | land_cat_misc | 附录 A 五（七） |
| land_reclaim_obligation | 拒不履行土地复垦义务 | land | land_cat_misc | 附录 A 五（八） |
| land_permanent_farmland_nonfarm | 非法占用永久基本农田发展林果业或者挖塘养鱼 | land | land_cat_misc | 附录 A 五（九） |
| land_other | 附录外其他 | land | — | — （#194，不在附录内） |
| mineral_explore_without_license_or_overstep | 无证勘查和越界勘查 | mineral | mineral_cat_explore | 附录 B 一（一） |
| mineral_explore_rolling_or_trial | 擅自进行滚动勘探开发、边探边采或者试采 | mineral | mineral_cat_explore | 附录 B 一（二） |
| mineral_mine_without_license | 无证采矿 | mineral | mineral_cat_mine | 附录 B 二（一） |
| mineral_mine_overstep | 越界采矿 | mineral | mineral_cat_mine | 附录 B 二（二） |
| mineral_mine_destructive | 破坏性采矿 | mineral | mineral_cat_mine | 附录 B 二（三） |
| mineral_transfer_resource | 买卖、出租或者以其他形式转让矿产资源 | mineral | mineral_cat_transfer | 附录 B 三（一） |
| mineral_transfer_rights_resale | 将探矿权、采矿权倒卖牟利 | mineral | mineral_cat_transfer | 附录 B 三（二） |
| mineral_transfer_rights_unapproved | 未经批准，擅自转让探矿权、采矿权 | mineral | mineral_cat_transfer | 附录 B 三（三） |
| mineral_transfer_mining_by_contract | 以承包等方式擅自转让采矿权 | mineral | mineral_cat_transfer | 附录 B 三（四） |
| mineral_approve_explore_license | 违法审批发放勘查许可证 | mineral | mineral_cat_approve | 附录 B 四（一） |
| mineral_approve_mining_license | 违法审批发放采矿许可证 | mineral | mineral_cat_approve | 附录 B 四（二） |
| mineral_other | 附录外其他 | mineral | — | — （#194，不在附录内） |
| survey_datum_coord_system_unapproved | 未经批准擅自建立相对独立的平面坐标系统，或者采用不符合国家标准的基础地理信息数据建立地理信息系统 | survey | survey_cat_datum | 附录 C 一（一） |
| survey_gnss_station_no_filing | 卫星导航定位基准站建设单位未报备案 | survey | survey_cat_datum | 附录 C 一（二） |
| survey_gnss_station_substandard | 卫星导航定位基准站的建设和运行维护不符合国家标准、要求 | survey | survey_cat_datum | 附录 C 一（三） |
| survey_basic_project_nonstandard_datum | 实施基础测绘项目，不使用全国统一的测绘基准和测绘系统或者不执行国家规定的测绘技术规范和标准 | survey | survey_cat_datum | 附录 C 一（四） |
| survey_qualification_none | 未取得测绘资质证书，擅自从事测绘活动 | survey | survey_cat_qualification | 附录 C 二（一） |
| survey_qualification_fraud | 以欺骗手段取得测绘资质证书从事测绘活动 | survey | survey_cat_qualification | 附录 C 二（二） |
| survey_qualification_exceed_scope | 测绘单位超越资质等级许可的范围从事测绘活动 | survey | survey_cat_qualification | 附录 C 二（三） |
| survey_qualification_borrow_name | 测绘单位以其他测绘单位的名义从事测绘活动 | survey | survey_cat_qualification | 附录 C 二（四） |
| survey_qualification_lend_name | 测绘单位允许其他单位以本单位的名义从事测绘活动 | survey | survey_cat_qualification | 附录 C 二（五） |
| survey_tender_unqualified_bidder | 测绘项目的招标单位让不具有相应资质等级的测绘单位中标，或者让测绘单位低于测绘成本中标 | survey | survey_cat_qualification | 附录 C 二（六） |
| survey_tender_project_transfer | 中标的测绘单位向他人转让测绘项目 | survey | survey_cat_qualification | 附录 C 二（七） |
| survey_practitioner_unqualified | 未取得测绘执业资格，擅自从事测绘活动 | survey | survey_cat_qualification | 附录 C 二（八） |
| survey_quality_unqualified | 测绘单位测绘成果质量不合格 | survey | survey_cat_quality | 附录 C 三（一） |
| survey_result_not_submitted | 不汇交测绘成果资料的，测绘项目出资人逾期不汇交的，承担国家投资的测绘项目的单位逾期不汇交的，自暂扣测绘资质证书之日起六个月内仍不汇交 | survey | survey_cat_result | 附录 C 四（一） |
| survey_key_geo_data_unauthorized_release | 擅自发布中华人民共和国领域和中华人民共和国管辖的其他海域的重要地理信息数据 | survey | survey_cat_result | 附录 C 四（二） |
| survey_secret_geo_info_no_register | 地理信息生产、保管、利用单位未对属于国家秘密的地理信息的获取、持有、提供、利用情况进行登记、长期保存的，泄露国家秘密 | survey | survey_cat_result | 附录 C 四（三） |
| survey_secret_geo_info_illegal_handling | 违法获取、持有、提供、利用属于国家秘密的地理信息 | survey | survey_cat_result | 附录 C 四（四） |
| survey_custodian_damage_loss | 测绘成果保管单位未按照测绘成果资料的保管制度管理测绘成果资料，造成测绘成果资料损毁、散失 | survey | survey_cat_result | 附录 C 四（五） |
| survey_custodian_unauthorized_transfer | 测绘成果保管单位擅自转让汇交的测绘成果资料 | survey | survey_cat_result | 附录 C 四（六） |
| survey_custodian_refuse_provide | 测绘成果保管单位未依法向测绘成果的使用人提供测绘成果资料 | survey | survey_cat_result | 附录 C 四（七） |
| survey_key_geo_data_unpublished_use | 在对社会公众有影响的活动中使用未经依法公布的重要地理信息数据 | survey | survey_cat_result | 附录 C 四（八） |
| survey_map_review_missing | 应当送审而未送审地图或者附着地图图形产品 | survey | survey_cat_map | 附录 C 五（一） |
| survey_map_exempt_nonconforming | 不需要送审的地图不符合国家有关标准和规定 | survey | survey_cat_map | 附录 C 五（二） |
| survey_map_review_unmodified_public | 经审核不符合国家有关标准和规定的地图未按照审核要求修改即向社会公开 | survey | survey_cat_map | 附录 C 五（三） |
| survey_map_approval_fraud | 弄虚作假、伪造申请材料骗取地图审核批准文件，或者伪造、冒用地图审核批准文件和审图号 | survey | survey_cat_map | 附录 C 五（四） |
| survey_map_review_no_label | 未在地图的适当位置显著标注审图号，或者未按照有关规定送交样本 | survey | survey_cat_map | 附录 C 五（五） |
| survey_internet_map_service_unapproved | 互联网地图服务单位使用未经依法审核批准的地图提供服务，或者未对互联网地图新增内容进行核查校对 | survey | survey_cat_map | 附录 C 五（六） |
| survey_internet_map_upload_prohibited | 通过互联网上传标注了含有按照国家有关规定在地图上不得表示的内容 | survey | survey_cat_map | 附录 C 五（七） |
| survey_map_public_inconsistent | 最终向社会公开的地图与审核通过的地图内容及表现形式不一致，或者互联网地图服务审图号有效期届满未重新送审 | survey | survey_cat_map | 附录 C 五（八） |
| survey_marker_damage_move | 损毁、擅自移动永久性测量标志或者正在使用中的临时性测量标志 | survey | survey_cat_marker | 附录 C 六（一） |
| survey_marker_land_occupy | 侵占永久性测量标志用地 | survey | survey_cat_marker | 附录 C 六（二） |
| survey_marker_safety_zone | 在永久性测量标志安全控制范围内从事危害测量标志安全和使用效能的活动 | survey | survey_cat_marker | 附录 C 六（三） |
| survey_marker_relocate | 擅自拆迁永久性测量标志或者使永久性测量标志失去使用效能，或者拒绝支付迁建费用 | survey | survey_cat_marker | 附录 C 六（四） |
| survey_marker_misuse | 违反操作规程使用永久性测量标志，造成永久性测量标志毁损 | survey | survey_cat_marker | 附录 C 六（五） |
| survey_marker_obstruct | 干扰或者阻挠测量标志建设单位依法使用土地或者在建筑物上建设永久性测量标志 | survey | survey_cat_marker | 附录 C 六（六） |
| survey_marker_unlicensed | 无证使用永久性测量标志并且拒绝县级以上人民政府管理测绘工作的部门监督和负责保管测量标志的单位和人员查询 | survey | survey_cat_marker | 附录 C 六（七） |
| survey_foreign_survey_unapproved | 外国的组织或者个人未经批准，或者未与中华人民共和国有关部门、单位合作，擅自从事测绘活动 | survey | survey_cat_misc | 附录 C 七（一） |
| survey_foreign_survey_fraud | 外国的组织或者个人来华测绘以伪造证明文件、提供虚假材料等手段，骗取一次性测绘批准文件 | survey | survey_cat_misc | 附录 C 七（二） |
| survey_foreign_survey_exceed | 外国的组织或者个人来华测绘超出一次性测绘批准文件的内容从事测绘活动 | survey | survey_cat_misc | 附录 C 七（三） |
| survey_foreign_survey_export | 外国的组织或者个人来华测绘未经依法批准将测绘成果携带或者传输出境 | survey | survey_cat_misc | 附录 C 七（四） |
| survey_other | 附录外其他 | survey | — | — （#194，不在附录内） |
| planning_build_without_permit | 未取得建设工程规划许可证或者未按照建设工程规划许可证的规定进行建设 | planning | planning_cat_build | 附录 D 一（一） |
| planning_temporary_build | 违法临时建设 | planning | planning_cat_build | 附录 D 一（二） |
| planning_completion_data_unreported | 建设单位未在建设工程竣工验收后六个月内向城乡规划主管部门报送有关竣工验收资料 | planning | planning_cat_build | 附录 D 一（三） |
| planning_heritage_approval_duty | 未按照保护规划的要求或者未按照法定程序履行新建、扩建审批职责 | planning | planning_cat_heritage | 附录 D 二（一） |
| planning_heritage_prohibited_activity | 在历史文化名城、名镇、名村保护范围内进行相关违法活动 | planning | planning_cat_heritage | 附录 D 二（二） |
| planning_heritage_building_deface | 在历史建筑上刻划、涂污 | planning | planning_cat_heritage | 附录 D 二（三） |
| planning_heritage_destructive_impact | 在活动过程中对传统格局、历史风貌或者历史建筑构成破坏性影响 | planning | planning_cat_heritage | 附录 D 二（四） |
| planning_heritage_building_damage | 损坏或者擅自迁移、拆除历史建筑 | planning | planning_cat_heritage | 附录 D 二（五） |
| planning_heritage_signboard | 擅自设置、移动、涂改或者损毁历史文化街区、名镇、名村标志牌 | planning | planning_cat_heritage | 附录 D 二（六） |
| planning_compiler_beyond_qualification | 超越资质等级许可的范围承揽城乡规划编制工作、违反国家有关标准、规范编制城乡规划 | planning | planning_cat_compiler | 附录 D 三（一） |
| planning_compiler_without_qualification | 未依法取得资质证书承揽城乡规划编制工作 | planning | planning_cat_compiler | 附录 D 三（二） |
| planning_compiler_fraud_practice | 以欺骗手段取得资质证书承揽城乡规划编制工作 | planning | planning_cat_compiler | 附录 D 三（三） |
| planning_compiler_condition_lapsed | 城乡规划编制单位取得资质证书后，不再符合相应的资质条件 | planning | planning_cat_compiler | 附录 D 三（四） |
| planning_compiler_false_application | 隐瞒有关情况或者提供虚假材料申请城乡规划编制单位资质证书 | planning | planning_cat_compiler | 附录 D 三（五） |
| planning_compiler_improper_obtain | 以欺骗、贿赂等不正当手段取得城乡规划编制单位资质证书 | planning | planning_cat_compiler | 附录 D 三（六） |
| planning_compiler_certificate_transfer | 涂改、倒卖、出租、出借或者以其他形式非法转让城乡规划编制单位资质证书 | planning | planning_cat_compiler | 附录 D 三（七） |
| planning_compiler_credit_record | 未按照规定及时更新全国城乡规划（国土空间规划）编制单位管理信息系统相关信息 | planning | planning_cat_compiler | 附录 D 三（八） |
| planning_other | 附录外其他 | planning | — | — （#194，不在附录内） |

## 二、大类编码（19 行，录入时不可选的分组行）

大类码不进要件键。

| 编码 | 名称 | 法域 | 附录序号出处 |
|---|---|---|---|
| land_cat_approve | 违法批地类 | land | 附录 A 一 |
| land_cat_occupy | 违法占地类 | land | 附录 A 二 |
| land_cat_transfer | 违法转让类 | land | 附录 A 三 |
| land_cat_farmland | 破坏农用地类 | land | 附录 A 四 |
| land_cat_misc | 其他类 | land | 附录 A 五 |
| mineral_cat_explore | 违法勘查类 | mineral | 附录 B 一 |
| mineral_cat_mine | 违法开采类 | mineral | 附录 B 二 |
| mineral_cat_transfer | 违法转让类 | mineral | 附录 B 三 |
| mineral_cat_approve | 违法审批发证类 | mineral | 附录 B 四 |
| survey_cat_datum | 测绘基准类 | survey | 附录 C 一 |
| survey_cat_qualification | 测绘资质资格类 | survey | 附录 C 二 |
| survey_cat_quality | 测绘质量类 | survey | 附录 C 三 |
| survey_cat_result | 测绘成果类 | survey | 附录 C 四 |
| survey_cat_map | 地图管理类 | survey | 附录 C 五 |
| survey_cat_marker | 测量标志类 | survey | 附录 C 六 |
| survey_cat_misc | 其它类 | survey | 附录 C 七 |
| planning_cat_build | 违法建设类 | planning | 附录 D 一 |
| planning_cat_heritage | 历史文化名城名镇名村保护类 | planning | 附录 D 二 |
| planning_cat_compiler | 违法编制规划类 | planning | 附录 D 三 |

## 三、与旧草案短名的对照

旧短名取自 #181、#183、#184 草案。矿产旧稿原无类型编码，键用矿产专用前缀。

| 旧短名 | 新编码 |
|---|---|


其余旧短名已带法域短码，编码不变。
