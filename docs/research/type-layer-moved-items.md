# 类型层移出项清单（交案件阶段材料清单）

来源：#203，按 #192 乙案与 #199 决议。类型层只收录入时可当场给出的项。下列项原在类型层，按原所在栏 `认定结论`、`认定与检验结论`、`现场勘验与证据材料`、`金额与裁量` 整栏移出。它们交 #27 承接，作为案件阶段材料清单的候选。

「依据」列保留草案原文，未转成文件编号。#27 采用时再转换。矿产草案无这四栏，不在本清单。

## 土地（规程附录 A），共 85 项

### land_approve_wrong_use（1 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.land_approve_wrong_use.plan_map_ref | 规划图件的图幅号与版本 | 类型层·现场勘验与证据材料 | 选填 | 核查前补齐 | 提示 | 规程 3.2.3.1(4)【业】 |

### land_approve_illegal_procedure（2 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.land_approve_illegal_procedure.land_actual_control | 土地是否被征地者实际控制（批准行为类型含土地征收时填写） | 类型层·现场勘验与证据材料 | 选填 | 核查前补齐 | 提示 | 规程 附录 A 一（六）2【业】；规程 3.2.3.1(6)【业】 |
| type.land_approve_illegal_procedure.site_leveling_construction | 平整场地、动工建设情况（批准行为类型含土地征收时填写） | 类型层·现场勘验与证据材料 | 选填 | 核查前补齐 | 提示 | 规程 附录 A 一（六）2【业】；规程 3.2.3.1(5)(6)【业】 |

### land_illegal_supply（4 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.land_illegal_supply.bid_auction_records | 招拍挂过程材料：出让公告、竞买人或投标人名单、成交确认书、中标或竞得通知书、结果公布材料（供地方式为招拍挂时填写） | 类型层·现场勘验与证据材料 | 选填 | 核查前补齐 | 提示 | 《招标拍卖挂牌出让国有建设用地使用权规定》第 6、22 条【业】；规程 3.2.3.1(7)【业】 |
| type.land_illegal_supply.actual_price | 实际出让价或划拨地价 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 《违反土地管理规定行为处分办法》第 8 条【业】；《国务院关于深化改革严格土地管理的决定》一 (四)【业】；《城市房地产管理法》第 13 条第 3 款【法】 |
| type.land_illegal_supply.price_basis | 地价依据（基准地价、评估报告、协议出让最低价计算依据） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 《协议出让国有土地使用权规定》（国土资源部令第 21 号）【业】；《城市房地产管理法》第 13 条第 3 款【法】 |
| type.land_illegal_supply.land_pay_receipt | 出让金缴纳凭证、减免或变相减免情况 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 《违反土地管理规定行为处分办法》第 9 条第 (三) 项【业】；规程 3.2.3.1(7)【业】 |

### land_occupy_without_approval（6 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.land_occupy_without_approval.land_class | 占用地类（农用地／建设用地／未利用地） | 类型层·认定结论 | 必填 | 核查前补齐 | 阻断 | 规程 4.2.2【业】；附录 A 二（五）1、2【业】 |
| type.land_occupy_without_approval.plan_conformity | 是否符合土地利用总体规划的认定结论 | 类型层·认定结论 | 必填 | 核查前补齐 | 阻断 | 规程 4.2.3【业】；附录 A 二（五）3、4【业】；《土地管理法》第 77 条【法】 |
| type.land_occupy_without_approval.permanent_farmland | 是否占用永久基本农田（或者原基本农田） | 类型层·认定结论 | 必填 | 核查前补齐 | 警告 | 规程 4.2.4【业】；规程 3.2.3.1(4)【业】 |
| type.land_occupy_without_approval.structures | 地上新建建筑物和其他设施情况 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 《土地管理法》第 77 条【法】；附录 A 二（五）1、2【业】；规程 3.2.3.1(6)【业】 |
| type.land_occupy_without_approval.project_approval | 项目立项、规划、环评、建设审批材料 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.1(8)【业】；规程 4.4.2.2(1)【业】 |
| type.land_occupy_without_approval.crime_identification | 破坏耕地等农用地涉嫌犯罪的认定意见、鉴定意见 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.1(9)【业】；规程 3.2.4.7【业】 |

### land_occupy_exceed_approved（6 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.land_occupy_exceed_approved.land_class | 占用地类（农用地／建设用地／未利用地） | 类型层·认定结论 | 必填 | 核查前补齐 | 阻断 | 规程 4.2.2【业】；附录 A 二（五）1、2【业】 |
| type.land_occupy_exceed_approved.plan_conformity | 是否符合土地利用总体规划的认定结论 | 类型层·认定结论 | 必填 | 核查前补齐 | 阻断 | 规程 4.2.3【业】；附录 A 二（五）3、4【业】；《土地管理法》第 77 条【法】 |
| type.land_occupy_exceed_approved.permanent_farmland | 是否占用永久基本农田（或者原基本农田） | 类型层·认定结论 | 必填 | 核查前补齐 | 警告 | 规程 4.2.4【业】；规程 3.2.3.1(4)【业】 |
| type.land_occupy_exceed_approved.structures | 地上新建建筑物和其他设施情况 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 《土地管理法》第 77 条【法】；附录 A 二（五）1、2【业】；规程 3.2.3.1(6)【业】 |
| type.land_occupy_exceed_approved.project_approval | 项目立项、规划、环评、建设审批材料 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.1(8)【业】 |
| type.land_occupy_exceed_approved.crime_identification | 破坏耕地等农用地涉嫌犯罪的认定意见、鉴定意见 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.1(9)【业】；规程 3.2.4.7【业】 |

### land_occupy_refuse_return（3 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.land_occupy_refuse_return.land_class | 占用地类（农用地／建设用地／未利用地） | 类型层·认定结论 | 必填 | 核查前补齐 | 阻断 | 规程 4.2.2【业】；附录 A 二（五）1、2【业】 |
| type.land_occupy_refuse_return.plan_conformity | 是否符合土地利用总体规划的认定结论 | 类型层·认定结论 | 必填 | 核查前补齐 | 阻断 | 规程 4.2.3【业】；附录 A 二（五）3、4【业】；《土地管理法》第 77 条【法】 |
| type.land_occupy_refuse_return.structures | 地上新建建筑物和其他设施情况 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 《土地管理法》第 77 条【法】；附录 A 二（五）1、2【业】；规程 3.2.3.1(6)【业】 |

### land_transfer_illegal（4 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.land_transfer_illegal.illegal_income | 违法所得认定材料 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.1(10)「违法所得认定材料」【业】；规程 4.2.8.1【业】；《土地管理法实施条例》第 54 条【法】 |
| type.land_transfer_illegal.transfer_area | 转让涉及土地面积 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 阻断 | 附录 A 三（五）1(3) 非法转让其他土地二十亩以上为「情节严重」【业】 |
| type.land_transfer_illegal.plan_conformity | 是否符合土地利用总体规划的认定结论 | 类型层·认定结论 | 必填 | 核查前补齐 | 阻断 | 《土地管理法》第 74 条【法】；规程 4.2.3【业】 |
| type.land_transfer_illegal.structures | 非法转让的土地上新建的建筑物和其他设施情况 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 《土地管理法》第 74 条【法】；附录 A 三（六）2【业】；规程 3.2.3.1(6)【业】 |

### land_transfer_allocated_unapproved（6 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.land_transfer_allocated_unapproved.allocation_conditions | 划拨土地使用权转让的四项条件核对（土地使用者为公司、企业、其他经济组织和个人；领有国有土地使用证；具有地上建筑物、其他附着物合法的产权证明；补交土地使用权出让金或者以转让、出租、抵押所获效益抵交出让金） | 类型层·认定结论 | 必填 | 核查前补齐 | 阻断 | 《城镇国有土地使用权出让和转让暂行条例》第 45 条【法】 |
| type.land_transfer_allocated_unapproved.premium_payment | 土地使用权出让金缴纳情况 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 《城市房地产管理法》第 67 条「责令缴纳土地使用权出让金」【法】；《城镇国有土地使用权出让和转让暂行条例》第 45 条第 4 项【法】 |
| type.land_transfer_allocated_unapproved.illegal_income | 违法所得认定材料 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.1(10)【业】；规程 4.2.8.1【业】；《土地管理法实施条例》第 54 条【法】 |
| type.land_transfer_allocated_unapproved.transfer_area | 转让涉及土地面积 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 阻断 | 附录 A 三（五）1(3)【业】 |
| type.land_transfer_allocated_unapproved.plan_conformity | 是否符合土地利用总体规划的认定结论 | 类型层·认定结论 | 必填 | 核查前补齐 | 阻断 | 《土地管理法》第 74 条【法】；规程 4.2.3【业】 |
| type.land_transfer_allocated_unapproved.structures | 地上建筑物和其他附着物情况及产权证明 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 《城镇国有土地使用权出让和转让暂行条例》第 45 条第 3 项【法】；附录 A 三（六）2【业】 |

### land_transfer_granted_unqualified（8 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.land_transfer_granted_unqualified.premium_paid | 按出让合同约定是否已支付全部土地使用权出让金，并取得土地使用权证书 | 类型层·认定结论 | 必填 | 核查前补齐 | 阻断 | 《城市房地产管理法》第 39 条第 1 款第 1 项【法】 |
| type.land_transfer_granted_unqualified.investment_condition | 投资开发条件核对（属于房屋建设工程的完成开发投资总额的 25% 以上；属于成片开发土地的形成工业用地或者其他建设用地条件） | 类型层·认定结论 | 必填 | 核查前补齐 | 阻断 | 《城市房地产管理法》第 39 条第 1 款第 2 项【法】；《城镇国有土地使用权出让和转让暂行条例》第 19 条第 2 款【法】 |
| type.land_transfer_granted_unqualified.house_cert | 转让时房屋已经建成的，持有房屋所有权证书（房屋尚未建成的填「不适用」） | 类型层·认定结论 | 必填 | 核查前补齐 | 阻断 | 《城市房地产管理法》第 39 条第 2 款【法】 |
| type.land_transfer_granted_unqualified.prohibited_circumstances | 其他不得转让情形（司法机关和行政机关依法裁定、决定查封或者以其他形式限制房地产权利；依法收回土地使用权；共有房地产未经其他共有人书面同意；权属有争议；未依法登记领取权属证书） | 类型层·认定结论 | 必填 | 核查前补齐 | 阻断 | 《城市房地产管理法》第 38 条【法】 |
| type.land_transfer_granted_unqualified.illegal_income | 违法所得认定材料 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.1(10)【业】；规程 4.2.8.1【业】；《土地管理法实施条例》第 54 条【法】 |
| type.land_transfer_granted_unqualified.transfer_area | 转让涉及土地面积 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 阻断 | 附录 A 三（五）1(3)【业】 |
| type.land_transfer_granted_unqualified.plan_conformity | 是否符合土地利用总体规划的认定结论 | 类型层·认定结论 | 必填 | 核查前补齐 | 阻断 | 《土地管理法》第 74 条【法】；规程 4.2.3【业】 |
| type.land_transfer_granted_unqualified.structures | 地上新建的建筑物和其他设施情况 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 《土地管理法》第 74 条【法】；附录 A 三（六）2【业】；规程 3.2.3.1(6)【业】 |

### land_transfer_collective（5 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.land_transfer_collective.is_operational_collective_land | 是否为集体经营性建设用地（经依法登记，且土地利用总体规划、城乡规划确定为工业、商业等经营性用途） | 类型层·认定结论 | 必填 | 核查前补齐 | 阻断 | 《土地管理法》第 63 条第 1 款【法】；《土地管理法》第 82 条第 1 款【法】 |
| type.land_transfer_collective.contract_validity_terms | 规划条件、产业准入和生态环境保护要求是否依法纳入书面合同（未依法纳入的，合同无效） | 类型层·认定结论 | 必填 | 核查前补齐 | 阻断 | 《土地管理法实施条例》第 41 条【法】 |
| type.land_transfer_collective.illegal_income | 违法所得认定材料 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.1(10)【业】；规程 4.2.8.1【业】；《土地管理法实施条例》第 60 条【法】 |
| type.land_transfer_collective.transfer_area | 转让、出租涉及土地面积 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 阻断 | 附录 A 三（五）1(3)【业】 |
| type.land_transfer_collective.structures | 地上新建的建筑物和其他设施情况 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 《土地管理法》第 82 条【法】；附录 A 三（六）2【业】；规程 3.2.3.1(6)【业】 |

### land_farmland_general（6 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.land_farmland_general.evidence_list | 证据材料清单（3.2.3.1 适用项：（2）（3）（4）（5）（6）（7）（8）（9）（12）） | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.1【业】 |
| type.land_farmland_general.site_survey | 现场勘验材料（现场勘验笔录、勘测定界图、勘测报告） | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.1（5）、3.2.4.6【业】 |
| type.land_farmland_general.current_land_class | 涉案地块现状地类与是否占用永久基本农田的认定（套合比对结果） | 类型层·认定结论 | 必填 | 核查前补齐 | 阻断 | 规程 4.2.2、4.2.4【业】 |
| type.land_farmland_general.damage_degree_opinion | 耕地破坏程度认定意见或鉴定意见 | 类型层·认定结论 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.4.7【业】 |
| type.land_farmland_general.planting_condition_damage | 破坏种植条件的事实结论 | 类型层·认定结论 | 必填 | 核查前补齐 | 阻断 | 《土地管理法》第 75 条【法】；《基本农田保护条例》第 17 条【法】 |
| type.land_farmland_general.reclamation_fee_std | 耕地开垦费标准（罚款计算基数） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 《土地管理法实施条例》第 55 条【法】；《广东省非农业建设补充耕地管理办法》（广东省人民政府令第 146 号）第 10 条【业】 |

### land_farmland_permanent（6 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.land_farmland_permanent.evidence_list | 证据材料清单（3.2.3.1 适用项：（2）（3）（4）（5）（6）（7）（8）（9）（12）） | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.1【业】 |
| type.land_farmland_permanent.site_survey | 现场勘验材料（现场勘验笔录、勘测定界图、勘测报告） | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.1（5）、3.2.4.6【业】 |
| type.land_farmland_permanent.permanent_farmland_determination | 占用永久基本农田（或原基本农田）的认定结论与套合比对结果 | 类型层·认定结论 | 必填 | 核查前补齐 | 阻断 | 规程 4.2.4【业】 |
| type.land_farmland_permanent.damage_degree_opinion | 耕地破坏程度认定意见或鉴定意见 | 类型层·认定结论 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.4.7【业】 |
| type.land_farmland_permanent.planting_condition_damage | 毁坏种植条件的事实结论 | 类型层·认定结论 | 必填 | 核查前补齐 | 阻断 | 《基本农田保护条例》第 33 条【法】；《土地管理法》第 75 条【法】 |
| type.land_farmland_permanent.reclamation_fee_std | 耕地开垦费标准（含占用基本农田加收、占用永久基本农田按当地最高标准两倍口径） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 《土地管理法实施条例》第 55 条【法】；《广东省非农业建设补充耕地管理办法》（广东省人民政府令第 146 号）第 10 条【业】；粤发〔2017〕21 号【业】 |

### land_reclaim_state_land_refuse（2 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.land_reclaim_state_land_refuse.evidence_list | 证据材料清单（3.2.3.1 适用项：（2）（3）（4）（5）（6）（7）（8）（12）） | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.1【业】 |
| type.land_reclaim_state_land_refuse.refusal_fact | 当事人拒不交出土地的事实（询问笔录、现场勘验笔录、违法地块现状材料） | 类型层·认定结论 | 必填 | 核查前补齐 | 阻断 | 《土地管理法》第 81 条【法】；规程 3.2.3.1（2）（5）（6）【业】 |

### land_temporary_land_refuse（3 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.land_temporary_land_refuse.occupancy_status | 期满后仍实际占用、拒不归还的事实（现场勘验材料、违法地块现状材料、询问笔录） | 类型层·认定结论 | 必填 | 核查前补齐 | 阻断 | 《土地管理法》第 81 条【法】；规程 3.2.3.1（2）（5）（6）【业】 |
| type.land_temporary_land_refuse.evidence_list | 证据材料清单（3.2.3.1 适用项：（2）（3）（4）（5）（6）（7）（8）（12）） | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.1【业】 |
| type.land_temporary_land_refuse.cultivated_condition | 是否占用耕地、是否涉及恢复种植条件 | 类型层·认定结论 | 选填 | 核查前补齐 | 提示 | 《土地管理法实施条例》第 20 条第 3 款【法】 |

### land_use_mismatch（1 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.land_use_mismatch.evidence_list | 证据材料清单（3.2.3.1 适用项：（2）（3）（4）（5）（6）（7）（8）（12）） | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.1【业】 |

### land_temporary_permanent_structure（3 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.land_temporary_permanent_structure.structure_fact | 在临时使用的土地上修建永久性建筑物的事实（现场勘验材料、勘测定界图、勘测报告、违法地块现状材料、询问笔录） | 类型层·认定结论 | 必填 | 核查前补齐 | 阻断 | 《土地管理法》第 57 条第 2 款【法】；实施条例第 52 条【法】；规程 3.2.3.1（2）（5）（6）【业】 |
| type.land_temporary_permanent_structure.reclamation_fee_base | 土地复垦费核定金额（罚款计算基数：按占用面积处土地复垦费 5 倍以上 10 倍以下） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 《土地管理法实施条例》第 52 条【法】；《土地复垦条例》第 18 条【法】 |
| type.land_temporary_permanent_structure.evidence_list | 证据材料清单（3.2.3.1 适用项：（2）（3）（4）（5）（6）（7）（8）（12）） | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.1【业】 |

### land_temporary_reclaim_default（3 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.land_temporary_reclaim_default.reclamation_status | 复垦或恢复种植条件的完成情况（现场勘验材料、违法地块现状材料、恢复种植条件的现状与检测材料） | 类型层·认定结论 | 必填 | 核查前补齐 | 阻断 | 《土地管理法实施条例》第 20 条第 3 款、第 56 条第 2 款【法】 |
| type.land_temporary_reclaim_default.evidence_list | 证据材料清单（3.2.3.1 适用项：（2）（3）（4）（5）（6）（7）（8）（12）） | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.1【业】 |
| type.land_temporary_reclaim_default.reclamation_fee_base | 土地复垦费核定金额（罚款计算基数：土地复垦费 2 倍以上 5 倍以下） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 《土地管理法实施条例》第 56 条第 1 款【法】；《土地复垦条例》第 18 条【法】 |

### land_pre_plan_rebuild（4 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.land_pre_plan_rebuild.building_evidence | 建筑物、构筑物系「土地利用总体规划制定前已建」的证明材料（建设时间、竣工与使用情况材料） | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 《土地管理法》第 65 条【法】 |
| type.land_pre_plan_rebuild.planning_use | 土地利用总体规划确定的土地用途（套合比对结果） | 类型层·认定结论 | 必填 | 核查前补齐 | 阻断 | 《土地管理法》第 65 条【法】；规程 4.2.3【业】 |
| type.land_pre_plan_rebuild.rebuild_fact | 重建、扩建的事实（现场勘验材料、违法地块现状材料、询问笔录） | 类型层·认定结论 | 必填 | 核查前补齐 | 阻断 | 《土地管理法》第 65 条【法】；《土地管理法实施条例》第 53 条【法】 |
| type.land_pre_plan_rebuild.evidence_list | 证据材料清单（3.2.3.1 适用项：（2）（3）（4）（5）（6）（8）（12）） | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.1【业】 |

### land_forbidden_reclamation（3 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.land_forbidden_reclamation.zone_determination | 是否位于国土空间规划确定的禁止开垦范围内的认定（套合比对结果） | 类型层·认定结论 | 必填 | 核查前补齐 | 阻断 | 《土地管理法实施条例》第 9 条第 1 款【法】；《土地管理法》第 40 条第 1 款【法】；《广东省土地管理条例》第 19 条【业】 |
| type.land_forbidden_reclamation.development_activity | 土地开发活动的事实（现场勘验材料、违法地块现状材料、询问笔录） | 类型层·认定结论 | 必填 | 核查前补齐 | 阻断 | 《土地管理法实施条例》第 9 条第 1 款【法】；规程 3.2.3.1（2）（5）（6）【业】 |
| type.land_forbidden_reclamation.evidence_list | 证据材料清单（3.2.3.1 适用项：（2）（3）（4）（5）（6）（8）（12）） | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.1【业】 |

### land_reclaim_obligation（5 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.land_reclaim_obligation.damage_fact | 因挖损、塌陷、压占等造成土地破坏的事实（现场勘验材料、违法地块现状材料、询问笔录） | 类型层·认定结论 | 必填 | 核查前补齐 | 阻断 | 《土地管理法》第 43 条【法】；规程 3.2.3.1（2）（5）（6）【业】 |
| type.land_reclaim_obligation.non_performance | 拒不履行或者复垦不符合要求的事实（整改情况、验收结论、代为复垦记录） | 类型层·认定结论 | 必填 | 核查前补齐 | 阻断 | 《土地管理法》第 76 条【法】 |
| type.land_reclaim_obligation.reclamation_status | 复垦完成情况与土地现状（现场勘验材料、违法地块现状材料） | 类型层·认定结论 | 必填 | 核查前补齐 | 阻断 | 《土地管理法》第 43 条【法】；《土地管理法实施条例》第 56 条【法】 |
| type.land_reclaim_obligation.evidence_list | 证据材料清单（3.2.3.1 适用项：（2）（3）（4）（5）（6）（8）（12）） | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.1【业】 |
| type.land_reclaim_obligation.reclamation_fee_base | 土地复垦费核定金额（罚款计算基数：土地复垦费 2 倍以上 5 倍以下） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 《土地管理法实施条例》第 56 条第 1 款【法】；《土地复垦条例》第 18 条【法】 |

### land_permanent_farmland_nonfarm（4 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.land_permanent_farmland_nonfarm.permanent_farmland_determination | 是否占用永久基本农田的认定结论与套合比对结果 | 类型层·认定结论 | 必填 | 核查前补齐 | 阻断 | 《土地管理法》第 37 条第 3 款【法】；规程 4.2.4【业】 |
| type.land_permanent_farmland_nonfarm.planting_condition_damage | 是否破坏种植条件的事实结论 | 类型层·认定结论 | 必填 | 核查前补齐 | 阻断 | 《土地管理法实施条例》第 51 条第 2 款【法】；《土地管理法》第 75 条【法】 |
| type.land_permanent_farmland_nonfarm.evidence_list | 证据材料清单（3.2.3.1 适用项：（2）（3）（4）（5）（6）（7）（8）（12）） | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.1【业】 |
| type.land_permanent_farmland_nonfarm.reclamation_fee_std | 耕地开垦费标准（罚款计算基数：占用面积处耕地开垦费 2 倍以上 5 倍以下；占用永久基本农田按当地最高标准两倍口径） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 《土地管理法实施条例》第 51 条【法】；《广东省非农业建设补充耕地管理办法》（广东省人民政府令第 146 号）第 10 条【业】；粤发〔2017〕21 号【业】 |

## 测绘（规程附录 C），共 285 项

### survey_datum_coord_system_unapproved（7 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.survey_datum_coord_system_unapproved.application_materials | 申请书、论证报告、技术方案以及与国家统一平面坐标系统的联系方式材料 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 《广东省测绘条例》第 7 条第 3 款【业】；规程 3.2.3.3(7)(11)【业】 |
| type.survey_datum_coord_system_unapproved.data_standard_conformity | 采用的基础地理信息数据是否符合国家标准的结论（标准号与版本） | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 阻断 | 《测绘法》第 24 条【法】；《广东省测绘条例》第 10 条【业】；规程 3.2.3.3(10)【业】 |
| type.survey_datum_coord_system_unapproved.recognition_opinion | 测绘违法认定意见或者鉴定意见 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.4.7、4.4.2.2(3)【业】 |
| type.survey_datum_coord_system_unapproved.system_data_materials | 坐标系统或者地理信息系统的数据、图件与电子数据 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.3(7)【业】 |
| type.survey_datum_coord_system_unapproved.site_survey_materials | 现场勘验材料（现场勘验笔录、照片、相关数据、视听资料） | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.3(4)、3.2.4.6【业】 |
| type.survey_datum_coord_system_unapproved.secrecy_level_determination | 涉案坐标系统数据或者基础地理信息数据是否属于国家秘密以及密级鉴定结论 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 警告 | 《保守国家秘密法》（2024 修订）第 57 条【法】；规程附录 C 一（五）【业】 |
| type.survey_datum_coord_system_unapproved.fine_tier_fact | 裁量分档事实（责令改正期限届满后的改正时点：限期内改正／届满后 1 个月内改正／届满后 1 个月以上改正或者拒不改正） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 《测绘法》第 52 条【法】；粤自然资规字〔2022〕2 号附件 3 序号 1（基本编码 440212071000）【业】；规程 15.5【业】 |

### survey_gnss_station_no_filing（4 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.survey_gnss_station_no_filing.site_survey_materials | 现场勘验材料（现场勘验笔录、照片、相关数据、视听资料） | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(4)、3.2.4.6【业】；部令第 19 号第 18 条第 1 款【业】 |
| type.survey_gnss_station_no_filing.station_facilities | 基准站相关设施、设备、工具与数据中心材料 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.3(8)【业】 |
| type.survey_gnss_station_no_filing.recognition_opinion | 测绘违法认定意见或者鉴定意见 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.4.7、4.4.2.2(3)【业】 |
| type.survey_gnss_station_no_filing.secrecy_level_determination | 备案信息或者基准站观测数据是否属于国家秘密以及密级鉴定结论 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 警告 | 部令第 19 号第 10 条第 2 款、第 15 条【业】；《保守国家秘密法》（2024 修订）第 57 条【法】 |

### survey_gnss_station_substandard（9 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.survey_gnss_station_substandard.pre_construction_assessment | 建设前对观测环境、地质构造、安全防护等条件的评估材料 | 类型层·现场勘验与证据材料 | 选填 | 核查前补齐 | 提示 | 部令第 19 号第 7 条第 2 款【业】 |
| type.survey_gnss_station_substandard.site_survey_materials | 现场勘验材料（现场勘验笔录、照片、相关数据、视听资料） | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(4)、3.2.4.6【业】；部令第 19 号第 18 条第 1 款【业】 |
| type.survey_gnss_station_substandard.station_facilities | 基准站相关设施、设备、工具与原材料 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.3(8)【业】；《测绘法》第 49 条第（二）项、第 54 条【法】 |
| type.survey_gnss_station_substandard.calibration_test_records | 卫星导航信号观测设备校准记录，以及定位精度与可用性等服务性能测试记录 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 阻断 | 部令第 19 号第 12 条第 2 款【业】；规程 3.2.3.3(10)【业】 |
| type.survey_gnss_station_substandard.inspection_report | 检验或者检测报告、审查意见、专家结论 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(10)【业】；粤自然资规字〔2021〕5 号第 9 条【业】 |
| type.survey_gnss_station_substandard.recognition_opinion | 测绘违法认定意见或者鉴定意见 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.4.7、4.4.2.2(3)【业】 |
| type.survey_gnss_station_substandard.secrecy_level_determination | 基准站观测数据与基准站坐标是否属于国家秘密以及密级鉴定结论 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 警告 | 部令第 19 号第 15 条【业】；《保守国家秘密法》（2024 修订）第 57 条【法】 |
| type.survey_gnss_station_substandard.illegal_income | 违法所得与测绘成果（没收对象） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 《测绘法》第 54 条【法】；《自然资源行政处罚办法》（部令第 12 号）第 14 条【业】 |
| type.survey_gnss_station_substandard.service_scope_fact | 裁量分档事实（已建设未投入运行维护／仅向内部运行维护未向社会提供服务／已建设并向社会提供运行维护服务） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 粤自然资规字〔2022〕2 号附件 3 序号 3（基本编码 440212073000）【业】 |

### survey_basic_project_nonstandard_datum（9 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.survey_basic_project_nonstandard_datum.project_contract | 基础测绘项目合同或者协议性文件 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.3(5)【业】 |
| type.survey_basic_project_nonstandard_datum.transaction_records | 相关交易凭据、账簿、登记台账及其他有关文件材料 | 类型层·现场勘验与证据材料 | 选填 | 核查前补齐 | 提示 | 规程 3.2.3.3(6)【业】 |
| type.survey_basic_project_nonstandard_datum.survey_records_materials | 测绘资料、成果、图件与电子数据 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(7)【业】 |
| type.survey_basic_project_nonstandard_datum.equipment_materials | 测绘相关设施、设备、工具、原材料 | 类型层·现场勘验与证据材料 | 选填 | 核查前补齐 | 提示 | 规程 3.2.3.3(8)【业】 |
| type.survey_basic_project_nonstandard_datum.site_survey_materials | 现场勘验材料（现场勘验笔录、照片、相关数据、视听资料） | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.3(4)、3.2.4.6【业】 |
| type.survey_basic_project_nonstandard_datum.standard_conformity_opinion | 是否执行国家规定的测绘技术规范和标准的检验或者检测结论 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(10)【业】；《基础测绘条例》第 17 条第 1 款【法】 |
| type.survey_basic_project_nonstandard_datum.recognition_opinion | 测绘违法认定意见或者鉴定意见 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.4.7、4.4.2.2(3)【业】 |
| type.survey_basic_project_nonstandard_datum.secrecy_level_determination | 涉案基础测绘成果是否属于国家秘密以及密级鉴定结论 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 警告 | 《基础测绘条例》第 16 条第 2 款【法】；《保守国家秘密法》（2024 修订）第 57 条【法】 |
| type.survey_basic_project_nonstandard_datum.fine_tier_fact | 裁量分档事实（责令改正期限届满后 1 个月内改正／届满后 1 个月以上改正或者拒不改正） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 《基础测绘条例》第 31 条【法】；粤自然资规字〔2022〕2 号附件 3 测绘地理信息类「实施基础测绘项目，不使用全国统一的测绘基准和测绘系统或者不执行国家规定的测绘技术规范和标准」项（基本编码 44021200Y000）【业】；规程 15.5【业】 |

### survey_qualification_none（10 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.survey_qualification_none.project_contract | 测绘项目合同、协议或者人员用工合同 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(5)【业】；《测绘法》第 55 条第 1 款【法】 |
| type.survey_qualification_none.transaction_records | 相关交易凭据、账簿、登记台账 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.3(6)【业】 |
| type.survey_qualification_none.survey_outputs | 测绘资料、成果、图件与电子数据（没收对象） | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(7)【业】；《测绘法》第 55 条第 1 款【法】 |
| type.survey_qualification_none.survey_equipment | 测绘相关设施、设备、工具、原材料（情节严重时没收测绘工具的对象） | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.3(8)【业】；《测绘法》第 49 条第（二）项、第 55 条第 1 款【法】 |
| type.survey_qualification_none.site_survey_materials | 现场勘验材料（现场勘验笔录、照片、相关数据、视听资料） | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.3(4)、3.2.4.6【业】 |
| type.survey_qualification_none.target_qualification_grade | 该测绘活动依法应当取得的资质等级（甲级／乙级）与作业限制范围 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 阻断 | 《测绘资质管理办法》第一条、第二条、第三条【业】；《测绘资质分类分级标准》第一条【业】；粤自然资规字〔2022〕2 号附件 3 序号 4（基本编码 440212074000）【业】 |
| type.survey_qualification_none.recognition_opinion | 测绘违法认定意见或者鉴定意见 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.4.7、4.4.2.2(3)【业】 |
| type.survey_qualification_none.agreed_remuneration | 测绘约定报酬金额及其合同依据（罚款基数） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 阻断 | 《测绘法》第 55 条第 1 款【法】；《基础测绘条例》第 29 条【法】；规程 3.2.3.3(5)(6)【业】；粤自然资规字〔2022〕2 号附件 3 序号 4【业】 |
| type.survey_qualification_none.illegal_income | 违法所得（没收对象） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 《测绘法》第 55 条第 1 款【法】；《自然资源行政处罚办法》（部令第 12 号）第 14 条【业】 |
| type.survey_qualification_none.severity_fact | 情节严重的事实（决定并处没收测绘工具） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 《测绘法》第 55 条第 1 款【法】 |

### survey_qualification_fraud（9 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.survey_qualification_fraud.falsified_materials | 弄虚作假、伪造、欺骗的证明材料（虚假的法人资格材料、专业技术人员身份与职称与社会保险材料、技术装备所有权材料、测绘业绩材料） | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(9)【业】；《测绘资质分类分级标准》第二条【业】；《测绘资质管理办法》第五条、第二十二条【业】 |
| type.survey_qualification_fraud.condition_nonconformity | 申请时实际不符合的资质条件项（法人资格／专业技术人员／技术装备和设施／技术和质量保证体系与安全保障措施与信息安全保密管理制度与测绘成果和资料档案管理制度） | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 阻断 | 《测绘法》第 27 条第 2 款【法】；《测绘资质管理办法》第五条、第二十三条【业】 |
| type.survey_qualification_fraud.project_contract | 测绘项目合同、协议或者人员用工合同 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(5)【业】 |
| type.survey_qualification_fraud.survey_outputs | 测绘资料、成果、图件与电子数据（没收对象） | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.3(7)【业】；《测绘法》第 55 条第 2 款【法】 |
| type.survey_qualification_fraud.survey_equipment | 测绘相关设施、设备、工具、原材料 | 类型层·现场勘验与证据材料 | 选填 | 核查前补齐 | 提示 | 规程 3.2.3.3(8)【业】 |
| type.survey_qualification_fraud.recognition_opinion | 测绘违法认定意见或者鉴定意见 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.4.7【业】 |
| type.survey_qualification_fraud.agreed_remuneration | 测绘约定报酬金额及其合同依据（罚款基数） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 阻断 | 《测绘法》第 55 条第 2 款【法】；粤自然资规字〔2022〕2 号附件 3 序号 5【业】 |
| type.survey_qualification_fraud.illegal_income | 违法所得（没收对象） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 《测绘法》第 55 条第 2 款【法】；处罚办法第 14 条【业】 |
| type.survey_qualification_fraud.severity_fact | 情节严重的事实（决定并处没收测绘工具） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 《测绘法》第 55 条第 2 款【法】 |

### survey_qualification_exceed_scope（10 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.survey_qualification_exceed_scope.project_contract | 测绘项目合同、协议或者人员用工合同 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(5)【业】 |
| type.survey_qualification_exceed_scope.transaction_records | 相关交易凭据、账簿、登记台账，以及测绘项目清单报送记录 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.3(6)【业】；《测绘资质管理办法》第十九条【业】 |
| type.survey_qualification_exceed_scope.survey_outputs | 测绘资料、成果、图件与电子数据（没收对象） | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(7)【业】；《测绘法》第 56 条【法】 |
| type.survey_qualification_exceed_scope.site_survey_materials | 现场勘验材料（现场勘验笔录、照片、相关数据、视听资料） | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.3(4)、3.2.4.6【业】 |
| type.survey_qualification_exceed_scope.exceed_conclusion | 超越资质等级许可范围的认定结论（超出专业类别／超出乙级作业限制范围） | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 阻断 | 《测绘法》第 29 条第 1 款、第 56 条第（一）项【法】；《测绘资质分类分级标准》第一条【业】 |
| type.survey_qualification_exceed_scope.recognition_opinion | 测绘违法认定意见或者鉴定意见 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.4.7【业】 |
| type.survey_qualification_exceed_scope.agreed_remuneration | 测绘约定报酬金额及其合同依据（罚款基数） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 阻断 | 《测绘法》第 56 条【法】；粤自然资规字〔2022〕2 号附件 3 序号 6（基本编码 440212076000）【业】 |
| type.survey_qualification_exceed_scope.remuneration_tier | 裁量分档事实（测绘项目约定报酬是否在 50 万元以上） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 粤自然资规字〔2022〕2 号附件 3 序号 6【业】 |
| type.survey_qualification_exceed_scope.illegal_income | 违法所得（没收对象） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 《测绘法》第 56 条【法】；处罚办法第 14 条【业】 |
| type.survey_qualification_exceed_scope.severity_fact | 情节严重的事实（决定吊销测绘资质证书） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 《测绘法》第 56 条【法】 |

### survey_qualification_borrow_name（9 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.survey_qualification_borrow_name.impersonation_materials | 弄虚作假、伪造、冒用、以其他人名义执业的材料 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(9)【业】 |
| type.survey_qualification_borrow_name.project_contract | 以名义单位名义签订的测绘项目合同、协议或者人员用工合同 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(5)【业】 |
| type.survey_qualification_borrow_name.actual_performer_evidence | 实际组织实施测绘活动的单位、人员、设备与作业记录 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(4)(8)【业】 |
| type.survey_qualification_borrow_name.survey_outputs | 测绘资料、成果、图件与电子数据（没收对象） | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(7)【业】；《测绘法》第 56 条【法】 |
| type.survey_qualification_borrow_name.recognition_opinion | 测绘违法认定意见或者鉴定意见 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.4.7【业】 |
| type.survey_qualification_borrow_name.agreed_remuneration | 测绘约定报酬金额及其合同依据（罚款基数） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 阻断 | 《测绘法》第 56 条【法】；粤自然资规字〔2022〕2 号附件 3 序号 6、序号 7（基本编码 440212076000）【业】 |
| type.survey_qualification_borrow_name.remuneration_tier | 裁量分档事实（测绘项目约定报酬是否在 50 万元以上） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 粤自然资规字〔2022〕2 号附件 3 序号 7「按照序号 6 的裁量基准执行」【业】 |
| type.survey_qualification_borrow_name.illegal_income | 违法所得（没收对象） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 《测绘法》第 56 条【法】；处罚办法第 14 条【业】 |
| type.survey_qualification_borrow_name.severity_fact | 情节严重的事实（决定吊销测绘资质证书） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 《测绘法》第 56 条【法】 |

### survey_qualification_lend_name（9 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.survey_qualification_lend_name.impersonation_materials | 弄虚作假、伪造、冒用、以其他人名义执业的材料 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(9)【业】 |
| type.survey_qualification_lend_name.project_contract | 以本单位名义签订的测绘项目合同、协议或者人员用工合同 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(5)【业】 |
| type.survey_qualification_lend_name.actual_performer_evidence | 实际组织实施测绘活动的单位、人员、设备与作业记录 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(4)(8)【业】 |
| type.survey_qualification_lend_name.survey_outputs | 测绘资料、成果、图件与电子数据（没收对象） | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(7)【业】；《测绘法》第 56 条【法】 |
| type.survey_qualification_lend_name.recognition_opinion | 测绘违法认定意见或者鉴定意见 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.4.7【业】 |
| type.survey_qualification_lend_name.agreed_remuneration | 测绘约定报酬金额及其合同依据（罚款基数） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 阻断 | 《测绘法》第 56 条【法】；粤自然资规字〔2022〕2 号附件 3 序号 6、序号 8（基本编码 440212076000）【业】 |
| type.survey_qualification_lend_name.remuneration_tier | 裁量分档事实（测绘项目约定报酬是否在 50 万元以上） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 粤自然资规字〔2022〕2 号附件 3 序号 8「按照序号 6 的裁量基准执行」【业】 |
| type.survey_qualification_lend_name.illegal_income | 违法所得（没收对象） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 《测绘法》第 56 条【法】；处罚办法第 14 条【业】 |
| type.survey_qualification_lend_name.severity_fact | 情节严重的事实（决定吊销测绘资质证书） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 《测绘法》第 56 条【法】 |

### survey_tender_unqualified_bidder（9 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.survey_tender_unqualified_bidder.tender_documents | 招标公告、投标邀请书、招标文件、评标报告、中标通知书 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(5)(6)(11)【业】；《招标投标法》第 18 条、第 19 条【法】 |
| type.survey_tender_unqualified_bidder.project_contract | 测绘项目合同 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.3(5)【业】 |
| type.survey_tender_unqualified_bidder.site_survey_materials | 现场勘验材料（现场勘验笔录、照片、相关数据、视听资料） | 类型层·现场勘验与证据材料 | 选填 | 核查前补齐 | 提示 | 规程 3.2.3.3(4)【业】 |
| type.survey_tender_unqualified_bidder.bid_price | 中标单位的投标报价与中标金额 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 阻断 | 《测绘法》第 29 条第 2 款【法】；规程 3.2.3.3(6)【业】 |
| type.survey_tender_unqualified_bidder.survey_cost | 测绘成本的构成与测算依据 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 阻断 | 《测绘法》第 29 条第 2 款、第 57 条【法】 |
| type.survey_tender_unqualified_bidder.below_cost_conclusion | 中标价是否低于测绘成本的认定结论 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 阻断 | 《测绘法》第 57 条【法】；规程 3.2.3.3(10)【业】 |
| type.survey_tender_unqualified_bidder.recognition_opinion | 测绘违法认定意见或者鉴定意见 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.4.7【业】 |
| type.survey_tender_unqualified_bidder.agreed_remuneration | 测绘约定报酬金额及其合同依据（罚款基数） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 阻断 | 《测绘法》第 57 条【法】；粤自然资规字〔2022〕2 号附件 3 序号 9（基本编码 440212077000）【业】 |
| type.survey_tender_unqualified_bidder.implementation_status | 裁量分档事实（测绘项目是否已经组织实施） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 粤自然资规字〔2022〕2 号附件 3 序号 9【业】 |

### survey_tender_project_transfer（8 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.survey_tender_project_transfer.transfer_contract | 转让或者分包合同、协议及款项支付凭据 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(5)(6)【业】 |
| type.survey_tender_project_transfer.actual_performer_evidence | 实际组织实施测绘活动的单位、人员、设备与作业记录 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(4)(8)(9)【业】 |
| type.survey_tender_project_transfer.survey_outputs | 测绘资料、成果、图件与电子数据 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.3(7)【业】 |
| type.survey_tender_project_transfer.recognition_opinion | 测绘违法认定意见或者鉴定意见 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.4.7【业】 |
| type.survey_tender_project_transfer.agreed_remuneration | 测绘约定报酬金额及其合同依据（罚款基数） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 阻断 | 《测绘法》第 58 条【法】；粤自然资规字〔2022〕2 号附件 3 序号 10（基本编码 440212078000）【业】 |
| type.survey_tender_project_transfer.remuneration_tier | 裁量分档事实（测绘项目约定报酬是否在 50 万元以上） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 粤自然资规字〔2022〕2 号附件 3 序号 10【业】 |
| type.survey_tender_project_transfer.illegal_income | 违法所得（没收对象） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 《测绘法》第 58 条【法】；处罚办法第 14 条【业】 |
| type.survey_tender_project_transfer.severity_fact | 情节严重的事实（决定吊销测绘资质证书） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 《测绘法》第 58 条【法】 |

### survey_practitioner_unqualified（11 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.survey_practitioner_unqualified.employment_evidence | 该人员与所在单位的聘用或者劳动关系材料、社会保险缴纳记录 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(5)【业】 |
| type.survey_practitioner_unqualified.signature_evidence | 该人员在测绘成果、技术设计书、检验报告上的签字与执业印章使用记录 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(9)【业】 |
| type.survey_practitioner_unqualified.project_contract | 测绘项目合同、协议或者人员用工合同 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.3(5)【业】 |
| type.survey_practitioner_unqualified.survey_outputs | 测绘资料、成果、图件与电子数据（没收对象） | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(7)【业】；《测绘法》第 59 条【法】 |
| type.survey_practitioner_unqualified.survey_equipment | 测绘相关设施、设备、工具、原材料（情节严重时没收测绘工具的对象） | 类型层·现场勘验与证据材料 | 选填 | 核查前补齐 | 提示 | 规程 3.2.3.3(8)【业】；《测绘法》第 59 条【法】 |
| type.survey_practitioner_unqualified.site_survey_materials | 现场勘验材料（现场勘验笔录、照片、相关数据、视听资料） | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.3(4)、3.2.4.6【业】 |
| type.survey_practitioner_unqualified.recognition_opinion | 测绘违法认定意见或者鉴定意见 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.4.7【业】 |
| type.survey_practitioner_unqualified.illegal_income | 违法所得（对所在单位罚款的基数） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 阻断 | 《测绘法》第 59 条【法】；处罚办法第 14 条【业】 |
| type.survey_practitioner_unqualified.illegal_income_tier | 裁量分档事实（违法所得是否在 50 万元以上） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 粤自然资规字〔2022〕2 号附件 3 序号 11（基本编码 440212079000）【业】 |
| type.survey_practitioner_unqualified.severity_fact | 情节严重的事实（决定没收测绘工具） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 《测绘法》第 59 条【法】 |
| type.survey_practitioner_unqualified.loss_and_compensation | 造成损失的事实与依法承担赔偿责任的情况 | 类型层·金额与裁量 | 选填 | 核查前补齐 | 提示 | 《测绘法》第 59 条【法】 |

### survey_quality_unqualified（10 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.survey_quality_unqualified.quality_inspection_report | 测绘成果质量检验报告或者检查验收结论（含质量等级评定） | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(10)【业】；GB/T 24356【业】；粤条例第 35 条第 2 款、第 3 款【业】 |
| type.survey_quality_unqualified.inspection_agency | 承担质量检验的机构名称与检验能力证明 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 警告 | 质量办法第 9 条【业】；规程 3.2.3.3(10)【业】 |
| type.survey_quality_unqualified.identification_opinion | 市（地）级以上自然资源主管部门出具的测绘违法认定意见，或者受委托机构出具的鉴定意见 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 警告 | 规程 3.2.4.7【业】；规程 4.4.2.2(3)「认定意见、鉴定意见」【业】 |
| type.survey_quality_unqualified.inquiry_record | 询问笔录 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.3(2)【业】 |
| type.survey_quality_unqualified.site_survey | 现场勘验材料（现场勘验笔录、照片、相关数据、视听资料） | 类型层·现场勘验与证据材料 | 选填 | 核查前补齐 | 提示 | 规程 3.2.3.3(4)【业】；规程 3.1.1(2)【业】 |
| type.survey_quality_unqualified.instruments_calibration | 涉案测绘设施设备、工具与仪器检定证书 | 类型层·现场勘验与证据材料 | 选填 | 核查前补齐 | 提示 | 规程 3.2.3.3(8)【业】；粤条例第 26 条【业】 |
| type.survey_quality_unqualified.remeasure_result | 补测或者重测后的质量检验结论 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 阻断 | 粤裁量序号 14【业】；GB/T 24356【业】 |
| type.survey_quality_unqualified.fine_base | 罚款裁量档次（按补测重测后是否合格分档） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 粤裁量序号 14【业】；粤条例第 44 条【业】 |
| type.survey_quality_unqualified.illegal_income | 违法所得金额 | 类型层·金额与裁量 | 选填 | 核查前补齐 | 提示 | 粤条例第 44 条「有违法所得的，还应当没收违法所得」【业】；粤裁量序号 14【业】 |
| type.survey_quality_unqualified.loss_amount | 给用户造成的损失金额 | 类型层·金额与裁量 | 选填 | 核查前补齐 | 提示 | 测绘法第 63 条末句【法】；基础测绘条例第 33 条末句【法】 |

### survey_result_not_submitted（3 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.survey_result_not_submitted.inquiry_record | 询问笔录 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.3(2)【业】 |
| type.survey_result_not_submitted.remeasure_cost | 重测所需费用（义务人类别为出资人时的罚款基数） | 类型层·金额与裁量 | 选填 | 核查前补齐 | 提示 | 测绘法第 60 条【法】；粤裁量序号 12【业】 |
| type.survey_result_not_submitted.fine_base | 罚款裁量档次 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 粤裁量序号 12【业】 |

### survey_key_geo_data_unauthorized_release（6 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.survey_key_geo_data_unauthorized_release.evidence_materials | 发布载体的原件、截图、视听资料与电子数据 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(4)(7)【业】 |
| type.survey_key_geo_data_unauthorized_release.inquiry_record | 询问笔录 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.3(2)【业】 |
| type.survey_key_geo_data_unauthorized_release.approval_status | 该数据是否已经国务院批准并授权公布（已批准并授权公布／未经国务院批准） | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 阻断 | 测绘法第 37 条【法】；成果条例第 22 条、第 24 条、第 25 条第 1 款【法】；粤裁量序号 13【业】 |
| type.survey_key_geo_data_unauthorized_release.publish_announcement | 国务院或者国务院授权的部门已公布该数据的公告（有则填公告名称、文号与公布日期） | 类型层·认定与检验结论 | 选填 | 核查前补齐 | 提示 | 成果条例第 25 条第 1 款【法】；2025 通知第五项【业】 |
| type.survey_key_geo_data_unauthorized_release.identification_opinion | 市（地）级以上自然资源主管部门出具的测绘违法认定意见，或者受委托机构出具的鉴定意见 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 警告 | 规程 3.2.4.7【业】 |
| type.survey_key_geo_data_unauthorized_release.fine_base | 罚款裁量档次 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 粤裁量序号 13【业】 |

### survey_secret_geo_info_no_register（7 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.survey_secret_geo_info_no_register.secret_scope_basis | 该事项属于国家秘密的定密依据（保密事项范围的具体条目） | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 阻断 | 保密法第 13 条、第 15 条【法】；95 号文第 2 条、第 3 条【业】 |
| type.survey_secret_geo_info_no_register.secret_appraisal | 国家秘密鉴定书（是否属于国家秘密、属于何种密级） | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 阻断 | 保密法第 53 条【法】；鉴定规定第 5 条、第 6 条、第 22 条【业】 |
| type.survey_secret_geo_info_no_register.identification_opinion | 市（地）级以上自然资源主管部门出具的测绘违法认定意见，或者受委托机构出具的鉴定意见 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 警告 | 规程 3.2.4.7【业】 |
| type.survey_secret_geo_info_no_register.site_survey | 现场勘验材料（现场勘验笔录、照片、相关数据、视听资料） | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.3(4)【业】；测绘法第 49 条第 1 款【法】 |
| type.survey_secret_geo_info_no_register.seizure_materials | 查封、扣押的涉密载体清单与处理决定 | 类型层·现场勘验与证据材料 | 选填 | 核查前补齐 | 提示 | 测绘法第 49 条第 1 款第 (二) 项【法】；规程 3.2.5【业】；规程附录 E 第 8 项、第 9 项【业】 |
| type.survey_secret_geo_info_no_register.inquiry_record | 询问笔录 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.3(2)【业】 |
| type.survey_secret_geo_info_no_register.fine_base | 罚款裁量档次（按是否泄露及泄露密级分档） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 粤裁量序号 20【业】 |

### survey_secret_geo_info_illegal_handling（9 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.survey_secret_geo_info_illegal_handling.secret_appraisal | 国家秘密鉴定书（是否属于国家秘密、属于何种密级） | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 阻断 | 保密法第 53 条【法】；鉴定规定第 5 条、第 22 条【业】 |
| type.survey_secret_geo_info_illegal_handling.identification_opinion | 市（地）级以上自然资源主管部门出具的测绘违法认定意见，或者受委托机构出具的鉴定意见 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 警告 | 规程 3.2.4.7【业】 |
| type.survey_secret_geo_info_illegal_handling.site_survey | 现场勘验材料（现场勘验笔录、照片、相关数据、视听资料） | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.3(4)【业】；测绘法第 49 条第 1 款【法】 |
| type.survey_secret_geo_info_illegal_handling.transaction_records | 相关交易凭据、账簿、登记台账 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.3(6)【业】；测绘法第 49 条第 1 款第 (一) 项【法】 |
| type.survey_secret_geo_info_illegal_handling.fraud_materials | 弄虚作假、伪造、欺骗、冒用的材料 | 类型层·现场勘验与证据材料 | 选填 | 核查前补齐 | 提示 | 规程 3.2.3.3(9)【业】 |
| type.survey_secret_geo_info_illegal_handling.inquiry_record | 询问笔录 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.3(2)【业】 |
| type.survey_secret_geo_info_illegal_handling.illegal_income | 违法所得金额 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 测绘法第 65 条第 2 款「可以并处违法所得二倍以下的罚款」【法】 |
| type.survey_secret_geo_info_illegal_handling.fine_base | 罚款裁量档次（违法所得倍数） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 粤裁量序号 21【业】 |
| type.survey_secret_geo_info_illegal_handling.loss_amount | 造成损失的金额 | 类型层·金额与裁量 | 选填 | 核查前补齐 | 提示 | 测绘法第 65 条第 2 款「造成损失的，依法承担赔偿责任」【法】 |

### survey_custodian_damage_loss（6 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.survey_custodian_damage_loss.site_survey | 现场勘验材料（现场勘验笔录、照片、相关数据、视听资料） | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(4)【业】；规程 3.1.1(2)【业】 |
| type.survey_custodian_damage_loss.ledger_records | 成果接收、整理、统计、保管的登记台账与交接记录 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.3(6)【业】；穗府令 190 号第 23 条【业】 |
| type.survey_custodian_damage_loss.inquiry_record | 询问笔录 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.3(2)【业】 |
| type.survey_custodian_damage_loss.identification_opinion | 市（地）级以上自然资源主管部门出具的测绘违法认定意见，或者受委托机构出具的鉴定意见 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 警告 | 规程 3.2.4.7【业】 |
| type.survey_custodian_damage_loss.loss_amount | 造成的损失金额 | 类型层·金额与裁量 | 选填 | 核查前补齐 | 提示 | 成果条例第 28 条「造成损失的，依法承担赔偿责任」【法】 |
| type.survey_custodian_damage_loss.illegal_income | 违法所得（有则填，无则填「无」） | 类型层·金额与裁量 | 选填 | 核查前补齐 | 提示 | 成果条例第 28 条「有违法所得的，没收违法所得」【法】 |

### survey_custodian_unauthorized_transfer（7 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.survey_custodian_unauthorized_transfer.transfer_contract | 转让协议、合同或者协议性文件 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(5)【业】 |
| type.survey_custodian_unauthorized_transfer.transaction_records | 交易凭据、账簿、登记台账 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.3(6)【业】；测绘法第 49 条第 1 款第 (一) 项【法】 |
| type.survey_custodian_unauthorized_transfer.inquiry_record | 询问笔录 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.3(2)【业】 |
| type.survey_custodian_unauthorized_transfer.secret_appraisal | 国家秘密鉴定书（被转让成果属于国家秘密时填写） | 类型层·认定与检验结论 | 选填 | 核查前补齐 | 提示 | 保密法第 53 条【法】；鉴定规定第 5 条、第 22 条【业】 |
| type.survey_custodian_unauthorized_transfer.identification_opinion | 市（地）级以上自然资源主管部门出具的测绘违法认定意见，或者受委托机构出具的鉴定意见 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 警告 | 规程 3.2.4.7【业】 |
| type.survey_custodian_unauthorized_transfer.illegal_income | 违法所得金额 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 成果条例第 28 条「有违法所得的，没收违法所得」【法】 |
| type.survey_custodian_unauthorized_transfer.loss_amount | 造成的损失金额 | 类型层·金额与裁量 | 选填 | 核查前补齐 | 提示 | 成果条例第 28 条「造成损失的，依法承担赔偿责任」【法】 |

### survey_custodian_refuse_provide（6 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.survey_custodian_refuse_provide.public_service_finding | 是否属于政府决策、国防建设、公共服务或者公共利益需要的认定 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 阻断 | 测绘法第 36 条第 1 款、第 2 款后段【法】；成果条例第 19 条【法】；穗府令 190 号第 24 条【业】 |
| type.survey_custodian_refuse_provide.catalogue_publish | 保管单位或者主管部门是否已依法编制并公布测绘成果目录 | 类型层·认定与检验结论 | 选填 | 核查前补齐 | 提示 | 测绘法第 33 条第 3 款【法】；成果条例第 26 条第 (三) 项【法】 |
| type.survey_custodian_refuse_provide.identification_opinion | 市（地）级以上自然资源主管部门出具的测绘违法认定意见 | 类型层·认定与检验结论 | 选填 | 核查前补齐 | 提示 | 规程 3.2.4.7【业】 |
| type.survey_custodian_refuse_provide.ledger_records | 成果提供的登记台账与交接记录 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.3(6)【业】；穗府令 190 号第 23 条【业】 |
| type.survey_custodian_refuse_provide.inquiry_record | 询问笔录 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.3(2)【业】 |
| type.survey_custodian_refuse_provide.illegal_income | 违法所得（有则填，无则填「无」） | 类型层·金额与裁量 | 选填 | 核查前补齐 | 提示 | 成果条例第 28 条「有违法所得的，没收违法所得」【法】 |

### survey_key_geo_data_unpublished_use（6 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.survey_key_geo_data_unpublished_use.evidence_materials | 使用载体的原件、截图、视听资料与电子数据 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(4)(7)【业】 |
| type.survey_key_geo_data_unpublished_use.inquiry_record | 询问笔录 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.3(2)【业】 |
| type.survey_key_geo_data_unpublished_use.not_published_finding | 该数据未经依法公布的事实认定（比对国务院或者国务院授权部门的公告） | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 阻断 | 成果条例第 25 条第 1 款、第 2 款【法】；2025 通知第五项【业】 |
| type.survey_key_geo_data_unpublished_use.publish_announcement | 已依法公布该数据的公告（有则填公告名称、文号与公布日期） | 类型层·认定与检验结论 | 选填 | 核查前补齐 | 提示 | 成果条例第 25 条第 1 款【法】 |
| type.survey_key_geo_data_unpublished_use.identification_opinion | 市（地）级以上自然资源主管部门出具的测绘违法认定意见 | 类型层·认定与检验结论 | 选填 | 核查前补齐 | 提示 | 规程 3.2.4.7【业】 |
| type.survey_key_geo_data_unpublished_use.fine_base | 罚款裁量档次（按违法次数分档） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 粤裁量序号 28【业】 |

### survey_map_review_missing（8 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.survey_map_review_missing.map_sample | 涉案地图样图或者样品 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(7)【业】；《地图审核管理规定》第 10 条第 1 款第 (二) 项【业】 |
| type.survey_map_review_missing.site_inspection | 现场勘验笔录、照片、视听资料 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.3(4)、3.1.1(2)【业】 |
| type.survey_map_review_missing.seizure_record | 查封、扣押的地图、附着地图图形的产品及设备、工具、原材料清单 | 类型层·现场勘验与证据材料 | 选填 | 核查前补齐 | 提示 | 规程 3.1.1(7)、3.3【业】；《地图管理条例》第 43 条第 (三) 项【法】 |
| type.survey_map_review_missing.content_review_opinion | 地图内容是否符合国家有关标准和规定的审查意见或者认定意见 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.3(10)、3.2.4.7【业】；《地图审核管理规定》第 18 条、第 23 条第 1 款【业】 |
| type.survey_map_review_missing.content_error_grade | 地图内容表示的错误程度（没有错误／一般性错误／较大错误） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 粤自然资规字〔2022〕2 号附件 1-3 测绘地理信息类序号 29【业】 |
| type.survey_map_review_missing.political_or_secret | 地图内容表示是否存在政治性问题或者泄露国家秘密 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 粤自然资规字〔2022〕2 号附件 1-3 序号 29【业】；《地图管理条例》第 8 条第 (一)(二)(三) 项【法】 |
| type.survey_map_review_missing.map_copies_count | 违法地图图件数量 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 规程 4.4.2.2(3)「地图违法图件数量」【业】 |
| type.survey_map_review_missing.illegal_income | 违法所得金额 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 《地图管理条例》第 49 条【法】；规程 3.2.3.3(6)【业】 |

### survey_map_exempt_nonconforming（9 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.survey_map_exempt_nonconforming.confidentiality_proof | 保密技术处理证明文件（利用涉及国家秘密的测绘成果编制地图时填写） | 类型层·现场勘验与证据材料 | 选填 | 核查前补齐 | 提示 | 《地图管理条例》第 13 条、第 16 条第 3 款【法】；《地图审核管理规定》第 11 条第 1 款【业】 |
| type.survey_map_exempt_nonconforming.map_sample | 涉案地图样图或者样品 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(7)【业】 |
| type.survey_map_exempt_nonconforming.site_inspection | 现场勘验笔录、照片、视听资料 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.3(4)、3.1.1(2)【业】 |
| type.survey_map_exempt_nonconforming.content_review_opinion | 地图内容是否符合国家有关标准和规定的审查意见或者认定意见 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(10)、3.2.4.7【业】；《地图审核管理规定》第 18 条【业】 |
| type.survey_map_exempt_nonconforming.secrecy_determination | 地图所载内容是否属于国家秘密的认定 | 类型层·认定与检验结论 | 选填 | 核查前补齐 | 提示 | 《地图管理条例》第 8 条第 2 款第 (三) 项【法】；《保守国家秘密法》（2024 修订）第 13 条、第 15 条【法】 |
| type.survey_map_exempt_nonconforming.content_error_grade | 地图内容表示的错误程度（一般性错误／较大错误） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 粤自然资规字〔2022〕2 号附件 1-3 序号 30【业】 |
| type.survey_map_exempt_nonconforming.political_or_secret | 地图内容表示是否存在政治性问题或者泄露国家秘密 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 粤自然资规字〔2022〕2 号附件 1-3 序号 30【业】；《地图管理条例》第 8 条第 2 款【法】 |
| type.survey_map_exempt_nonconforming.map_copies_count | 违法地图图件数量 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 规程 4.4.2.2(3)【业】 |
| type.survey_map_exempt_nonconforming.illegal_income | 违法所得金额 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 《地图管理条例》第 50 条【法】；规程 3.2.3.3(6)【业】 |

### survey_map_review_unmodified_public（8 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.survey_map_review_unmodified_public.reviewed_version | 送审的地图样图或者样品 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(7)【业】；《地图审核管理规定》第 10 条第 1 款第 (二) 项【业】 |
| type.survey_map_review_unmodified_public.published_version | 实际向社会公开的地图版本 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(7)【业】；《地图管理条例》第 43 条第 (一)(二) 项【法】 |
| type.survey_map_review_unmodified_public.site_inspection | 现场勘验笔录、照片、视听资料 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.3(4)、3.1.1(2)【业】 |
| type.survey_map_review_unmodified_public.comparison_opinion | 公开版本与审核要求的比对结论 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(10)、3.2.4.7【业】 |
| type.survey_map_review_unmodified_public.content_error_grade | 地图内容表示的错误程度（一般性错误／较大错误） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 粤自然资规字〔2022〕2 号附件 1-3 序号 31【业】 |
| type.survey_map_review_unmodified_public.political_or_secret | 地图内容表示是否存在政治性问题或者泄露国家秘密 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 粤自然资规字〔2022〕2 号附件 1-3 序号 31【业】；《地图管理条例》第 8 条第 2 款【法】 |
| type.survey_map_review_unmodified_public.map_copies_count | 违法地图图件数量 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 规程 4.4.2.2(3)【业】 |
| type.survey_map_review_unmodified_public.illegal_income | 违法所得金额 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 《地图管理条例》第 51 条【法】；规程 3.2.3.3(6)【业】 |

### survey_map_approval_fraud（8 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.survey_map_approval_fraud.submitted_materials | 当事人提交的全部送审材料（地图审核申请表、地图样图或者样品、测绘资质证书、保密技术处理证明） | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 《地图审核管理规定》第 10 条第 1 款、第 11 条、第 12 条【业】；规程 3.2.3.3(3)(9)【业】 |
| type.survey_map_approval_fraud.falsity_detail | 弄虚作假或者伪造的具体内容、部位与手段 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(9)【业】；《地图审核管理规定》第 12 条「对申请材料的真实性负责」【业】 |
| type.survey_map_approval_fraud.announcement_record | 核发机关网站或者新闻媒体上公告的地图名称、批准文件与审图号记录 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 《地图管理条例》第 21 条第 2 款【法】；《地图审核管理规定》第 25 条【业】 |
| type.survey_map_approval_fraud.seizure_record | 查封、扣押与没收的地图、附着地图图形的产品及设备、工具、原材料清单 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.1.1(7)、3.3【业】；《地图管理条例》第 43 条第 (三) 项、第 52 条【法】 |
| type.survey_map_approval_fraud.authenticity_opinion | 批准文件与审图号真伪的认定意见或者鉴定意见 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(10)、3.2.4.7【业】 |
| type.survey_map_approval_fraud.content_error_grade | 地图内容表示是否存在政治性问题或者泄露国家秘密 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 粤自然资规字〔2022〕2 号附件 1-3 序号 32【业】；《地图管理条例》第 8 条第 2 款【法】 |
| type.survey_map_approval_fraud.map_copies_count | 违法地图图件数量 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 规程 4.4.2.2(3)【业】 |
| type.survey_map_approval_fraud.illegal_income | 违法所得金额 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 《地图管理条例》第 52 条【法】；规程 3.2.3.3(6)【业】 |

### survey_map_review_no_label（3 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.survey_map_review_no_label.evidence_photo | 涉案地图或者附着地图图形产品的实物照片、出版物版权页照片、互联网地图页面截屏 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(4)(7)【业】 |
| type.survey_map_review_no_label.site_inspection | 现场勘验笔录、照片、视听资料 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.3(4)、3.1.1(2)【业】 |
| type.survey_map_review_no_label.political_or_secret | 地图内容表示是否存在政治性问题或者泄露国家秘密 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 粤自然资规字〔2022〕2 号附件 1-3 序号 33【业】；《地图管理条例》第 8 条第 2 款【法】 |

### survey_internet_map_service_unapproved（8 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.survey_internet_map_service_unapproved.webpage_evidence | 涉案互联网地图页面的网址、截屏、访问时间、新增标注记录与后台日志 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(4)(7)【业】；《地图管理条例》第 43 条第 (一)(二) 项【法】 |
| type.survey_internet_map_service_unapproved.safety_reviewer | 地图安全审校人员配备情况与内部安全审校核查制度 | 类型层·现场勘验与证据材料 | 选填 | 核查前补齐 | 提示 | 《地图审核管理规定》第 31 条【业】 |
| type.survey_internet_map_service_unapproved.site_inspection | 现场勘验笔录、照片、视听资料 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.3(4)、3.1.1(2)【业】 |
| type.survey_internet_map_service_unapproved.seizure_record | 查封、扣押的设备及电子数据清单 | 类型层·现场勘验与证据材料 | 选填 | 核查前补齐 | 提示 | 规程 3.1.1(7)、3.3【业】 |
| type.survey_internet_map_service_unapproved.content_review_opinion | 涉案地图内容是否符合国家有关标准和规定的审查意见或者认定意见 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(10)、3.2.4.7【业】 |
| type.survey_internet_map_service_unapproved.content_error_grade | 地图内容表示的错误程度（没有错误／一般性错误／较大错误） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 粤自然资规字〔2022〕2 号附件 1-3 序号 34【业】 |
| type.survey_internet_map_service_unapproved.political_or_secret | 地图内容表示是否存在政治性问题或者泄露国家秘密 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 粤自然资规字〔2022〕2 号附件 1-3 序号 34【业】；《地图管理条例》第 8 条第 2 款【法】 |
| type.survey_internet_map_service_unapproved.illegal_income | 违法所得金额 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 《地图管理条例》第 54 条【法】；规程 3.2.3.3(6)【业】 |

### survey_internet_map_upload_prohibited（5 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.survey_internet_map_upload_prohibited.webpage_evidence | 上传标注页面的网址、截屏、访问时间、页面留存记录 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(4)(7)【业】 |
| type.survey_internet_map_upload_prohibited.upload_identity | 上传者的账号、注册信息、登录 IP 地址与上传日志 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(7)「电子数据等材料」【业】 |
| type.survey_internet_map_upload_prohibited.content_review_opinion | 上传标注内容是否属不得表示内容的审查意见或者认定意见 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(10)、3.2.4.7【业】 |
| type.survey_internet_map_upload_prohibited.secrecy_determination | 上传标注内容是否属于国家秘密的认定 | 类型层·认定与检验结论 | 选填 | 核查前补齐 | 提示 | 《地图管理条例》第 8 条第 2 款第 (三) 项【法】；《保守国家秘密法》（2024 修订）第 13 条、第 15 条【法】 |
| type.survey_internet_map_upload_prohibited.political_or_secret | 上传标注内容是否存在政治性问题或者泄露国家秘密 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 粤自然资规字〔2022〕2 号附件 1-3 序号 35【业】；《地图管理条例》第 8 条第 2 款【法】 |

### survey_map_public_inconsistent（5 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.survey_map_public_inconsistent.approved_version | 审核通过的地图样图或者样品 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(7)【业】；《地图审核管理规定》第 10 条第 1 款第 (二) 项【业】 |
| type.survey_map_public_inconsistent.public_version | 最终向社会公开的地图版本或者互联网地图服务页面截屏 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(4)(7)【业】 |
| type.survey_map_public_inconsistent.filing_record | 每六个月新增标注内容及核查校对情况的备案记录（互联网地图服务情形时填写） | 类型层·现场勘验与证据材料 | 选填 | 核查前补齐 | 提示 | 《地图审核管理规定》第 28 条第 2 款【业】 |
| type.survey_map_public_inconsistent.comparison_opinion | 最终公开版本与审核通过版本在内容及表现形式上的比对结论 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(10)、3.2.4.7【业】 |
| type.survey_map_public_inconsistent.political_or_secret | 不一致处是否存在政治性问题或者泄露国家秘密 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 粤自然资规字〔2022〕2 号附件 1-3 序号 36【业】；《地图管理条例》第 8 条第 2 款【法】 |

### survey_marker_damage_move（6 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.survey_marker_damage_move.scene_inspection | 现场勘验笔录（附勘测图）、现场照片、视听资料 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(4)【业】；规程 3.2.4.6【业】；规程 3.1.1(2)【业】 |
| type.survey_marker_damage_move.marker_record | 标志点之记、标志建成时的现状照片、历次检查与维修记录 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.3(7)【业】；标志条例第 13 条、第 18 条【法】 |
| type.survey_marker_damage_move.custodian_report | 保管单位或者保管人的报告、制止、检举材料，以及乡级人民政府的转报材料 | 类型层·现场勘验与证据材料 | 选填 | 核查前补齐 | 提示 | 标志条例第 13 条、第 14 条【法】 |
| type.survey_marker_damage_move.damage_degree | 标志使用效能受损程度（未失去使用效能／失去部分使用效能且经维修可恢复／完全丧失使用效能且无法恢复） | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 阻断 | 广东裁量基准序号 15【业】；规程 3.2.3.3(10)【业】 |
| type.survey_marker_damage_move.recognition_opinion | 市（地）级以上自然资源主管部门出具的测绘违法认定意见，或者受委托机构出具的鉴定意见 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 警告 | 规程 3.2.4.7【业】 |
| type.survey_marker_damage_move.rebuild_cost | 标志维修费用或者重建费用的核算金额与核算依据 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 测绘法第 64 条【法】；标志条例第 20 条、第 21 条、第 23 条【法】 |

### survey_marker_land_occupy（6 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.survey_marker_land_occupy.scene_inspection | 现场勘验笔录（附勘测图）、现场照片、视听资料 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(4)【业】；规程 3.2.4.6【业】 |
| type.survey_marker_land_occupy.boundary_overlay | 标志占地范围与实际占用范围的套合比对图件 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(4)(7)【业】；规程 3.2.4.6【业】 |
| type.survey_marker_land_occupy.land_use_basis | 占用人对涉案土地主张的使用依据（承包合同、权属证书、审批文件） | 类型层·现场勘验与证据材料 | 选填 | 只提示 | 提示 | 规程 3.2.3.3(5)【业】 |
| type.survey_marker_land_occupy.damage_degree | 侵占对标志使用效能的影响程度 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 阻断 | 广东裁量基准序号 16（按序号 15 执行）【业】；规程 3.2.3.3(10)【业】 |
| type.survey_marker_land_occupy.recognition_opinion | 市（地）级以上自然资源主管部门出具的认定意见，或者受委托机构出具的鉴定意见 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 警告 | 规程 3.2.4.7【业】 |
| type.survey_marker_land_occupy.restore_cost | 恢复原状费用或者标志维修、重建费用的核算金额与核算依据 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 测绘法第 64 条【法】；标志条例第 20 条、第 21 条、第 23 条【法】 |

### survey_marker_safety_zone（6 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.survey_marker_safety_zone.scene_inspection | 现场勘验笔录（附勘测图）、现场照片、视听资料 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(4)【业】；规程 3.2.4.6【业】 |
| type.survey_marker_safety_zone.distance_measurement | 距离与范围的测量数据、勘测图与测量方法说明 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(4)【业】；规程 3.2.4.6【业】 |
| type.survey_marker_safety_zone.project_approval | 活动所属建设项目的立项、规划许可或者施工许可文件 | 类型层·现场勘验与证据材料 | 选填 | 核查前补齐 | 提示 | 规程 3.2.3.3(3)(5)【业】 |
| type.survey_marker_safety_zone.damage_degree | 标志使用效能受损程度 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 阻断 | 广东裁量基准序号 17（按序号 15 执行）【业】；规程 3.2.3.3(10)【业】 |
| type.survey_marker_safety_zone.recognition_opinion | 市（地）级以上自然资源主管部门出具的认定意见，或者受委托机构出具的鉴定意见 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 警告 | 规程 3.2.4.7【业】 |
| type.survey_marker_safety_zone.restore_cost | 恢复原状费用或者标志维修、重建费用的核算金额 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 测绘法第 64 条【法】；标志条例第 20 条、第 21 条、第 23 条【法】 |

### survey_marker_relocate（6 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.survey_marker_relocate.scene_inspection | 现场勘验笔录（附勘测图）、现场照片、视听资料 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(4)【业】；规程 3.2.4.6【业】 |
| type.survey_marker_relocate.construction_contract | 工程施工合同、施工方案与标志处置方案 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.3(5)【业】 |
| type.survey_marker_relocate.loss_of_function | 标志失去使用效能的事实与程度认定 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 阻断 | 测绘法第 64 条第（四）项【法】；广东裁量基准序号 18【业】；规程 3.2.3.3(10)【业】 |
| type.survey_marker_relocate.recognition_opinion | 市（地）级以上自然资源主管部门出具的认定意见，或者受委托机构出具的鉴定意见 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 警告 | 规程 3.2.4.7【业】 |
| type.survey_marker_relocate.relocation_fee_amount | 应当支付的迁建费用金额与实际支付凭据 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 阻断 | 测绘法第 43 条、第 64 条第（四）项【法】；标志条例第 20 条【法】；规程 3.2.3.3(6)【业】 |
| type.survey_marker_relocate.relocation_fee_basis | 迁建费用的核算依据与核算过程 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 标志条例第 20 条【法】；无全国统一收费标准，待定 |

### survey_marker_misuse（7 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.survey_marker_misuse.scene_inspection | 现场勘验笔录（附勘测图）、现场照片、视听资料 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(4)【业】；规程 3.2.4.6【业】 |
| type.survey_marker_misuse.equipment_tools | 使用标志时的仪器、设备与工具 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.3(8)【业】；规程 3.1.1(7)【业】 |
| type.survey_marker_misuse.custodian_check_record | 保管人员查验标志使用后完好状况的记录 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 测绘法第 44 条第 2 款【法】；标志条例第 16 条【法】 |
| type.survey_marker_misuse.causation | 违反操作规程与标志毁损之间的因果关系认定 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 阻断 | 测绘法第 64 条第（五）项【法】；规程 3.2.3.3(10)【业】；规程 3.2.4.7【业】 |
| type.survey_marker_misuse.damage_degree | 标志使用效能受损程度 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 阻断 | 广东裁量基准序号 19（按序号 15 执行）【业】 |
| type.survey_marker_misuse.recognition_opinion | 市（地）级以上自然资源主管部门出具的认定意见，或者受委托机构出具的鉴定意见 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 警告 | 规程 3.2.4.7【业】 |
| type.survey_marker_misuse.repair_cost | 标志维修费用或者重建费用的核算金额与核算依据 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 测绘法第 64 条【法】；标志条例第 20 条、第 21 条、第 23 条【法】 |

### survey_marker_obstruct（6 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.survey_marker_obstruct.scene_inspection | 现场勘验笔录（附勘测图）、现场照片、视听资料 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(4)【业】；规程 3.2.4.6【业】 |
| type.survey_marker_obstruct.witness_evidence | 建设单位人员的陈述、证人证言与询问笔录 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(2)【业】；规程 3.2.4.3、3.2.4.5【业】 |
| type.survey_marker_obstruct.land_right_claim | 干扰方对涉案土地或者建筑物主张的权利及其依据 | 类型层·现场勘验与证据材料 | 选填 | 只提示 | 提示 | 标志条例第 11 条【法】；规程 3.2.3.3(5)【业】 |
| type.survey_marker_obstruct.recognition_opinion | 市（地）级以上自然资源主管部门出具的认定意见 | 类型层·认定与检验结论 | 选填 | 只提示 | 提示 | 规程 3.2.4.7【业】 |
| type.survey_marker_obstruct.fine_grade_basis | 责令改正期限届满后的改正时间（1 个月内改正／1 个月以上改正或者拒不改正） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 广东裁量基准序号 23【业】 |
| type.survey_marker_obstruct.loss_compensation | 造成损失的金额与赔偿主张 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 标志条例第 23 条【法】 |

### survey_marker_unlicensed（6 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.survey_marker_unlicensed.scene_inspection | 现场勘验笔录（附勘测图）、现场照片、视听资料 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(4)【业】；规程 3.2.4.6【业】 |
| type.survey_marker_unlicensed.supervision_record | 主管部门监督与保管单位查询的现场记录、通知书与送达回证 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 标志条例第 16 条【法】；规程 3.2.3.3(4)【业】 |
| type.survey_marker_unlicensed.equipment_tools | 使用标志时的仪器、设备与工具 | 类型层·现场勘验与证据材料 | 选填 | 核查前补齐 | 提示 | 规程 3.2.3.3(8)【业】；规程 3.1.1(7)【业】 |
| type.survey_marker_unlicensed.recognition_opinion | 市（地）级以上自然资源主管部门出具的认定意见 | 类型层·认定与检验结论 | 选填 | 只提示 | 提示 | 规程 3.2.4.7【业】 |
| type.survey_marker_unlicensed.fine_grade_basis | 责令改正期限届满后的改正时间（1 个月内改正／1 个月以上改正或者拒不改正） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 广东裁量基准序号 24（按序号 23 执行）【业】 |
| type.survey_marker_unlicensed.loss_compensation | 造成损失的金额与赔偿主张 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 标志条例第 23 条【法】 |

### survey_foreign_survey_unapproved（7 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.survey_foreign_survey_unapproved.scene_inspection | 现场勘验笔录、现场照片、相关数据、视听资料 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(4)【业】；规程 3.2.4.6【业】；规程 3.1.1(2)【业】 |
| type.survey_foreign_survey_unapproved.instruments_tools | 使用的测绘仪器、软件、设备的清单与实物 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 测绘法第 51 条【法】；来华测绘办法第 11 条第（六）项【业】；规程 3.2.3.3(8)【业】；规程 3.1.1(7)【业】 |
| type.survey_foreign_survey_unapproved.contract_docs | 中外双方就测绘活动签订的合同、协议或者用工文件 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.3(5)【业】 |
| type.survey_foreign_survey_unapproved.secrecy_appraisal | 涉案测绘成果是否属于国家秘密及其密级的鉴定结论 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 阻断 | 保密法第 28 条、第 57 条【法】；测绘法第 34 条第 2 款、第 47 条【法】；保密范围规定第 2 条【业】；境外窃密解释第 7 条【法】；规程 3.2.3.3(10)【业】 |
| type.survey_foreign_survey_unapproved.recognition_opinion | 市（地）级以上自然资源主管部门出具的测绘违法认定意见，或者受委托机构出具的鉴定意见 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 警告 | 规程 3.2.4.7【业】 |
| type.survey_foreign_survey_unapproved.severity_grading | 是否属情节严重，以及认定所依据的事实 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 阻断 | 测绘法第 51 条【法】；无规范性文件分档标准，待定 |
| type.survey_foreign_survey_unapproved.illegal_gains | 违法所得金额与计算凭据 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 测绘法第 51 条【法】；规程 3.2.3.3(6)【业】 |

### survey_foreign_survey_fraud（5 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.survey_foreign_survey_fraud.fraud_evidence | 被伪造或者虚假的材料原件、真伪鉴定意见、出具机关的核查回复 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(9)(10)【业】 |
| type.survey_foreign_survey_fraud.scene_inspection | 现场勘验笔录、现场照片、相关数据、视听资料 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(4)【业】；规程 3.2.4.6【业】 |
| type.survey_foreign_survey_fraud.instruments_tools | 使用的测绘仪器、软件、设备的清单与实物 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 来华测绘办法第 11 条第（六）项【业】；规程 3.2.3.3(8)【业】 |
| type.survey_foreign_survey_fraud.secrecy_appraisal | 涉案测绘成果是否属于国家秘密及其密级的鉴定结论 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 阻断 | 保密法第 28 条、第 57 条【法】；保密范围规定第 2 条【业】；境外窃密解释第 7 条【法】 |
| type.survey_foreign_survey_fraud.fine_basis | 三万元以下罚款的裁量情节与违法所得 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 来华测绘办法第 18 条【业】；规程 3.2.3.3(6)【业】 |

### survey_foreign_survey_exceed（7 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.survey_foreign_survey_exceed.scene_inspection | 现场勘验笔录、现场照片、相关数据、视听资料 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(4)【业】；规程 3.2.4.6【业】 |
| type.survey_foreign_survey_exceed.instruments_tools | 使用的测绘仪器、软件、设备的清单与实物 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 来华测绘办法第 11 条第（六）项【业】；规程 3.2.3.3(8)【业】 |
| type.survey_foreign_survey_exceed.comparison_analysis | 批准内容与实际活动的比对分析材料 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(7)(10)【业】 |
| type.survey_foreign_survey_exceed.supervision_record | 县级以上地方人民政府自然资源主管部门按来华测绘办法第 16 条开展检查的记录 | 类型层·现场勘验与证据材料 | 选填 | 核查前补齐 | 提示 | 来华测绘办法第 16 条【业】 |
| type.survey_foreign_survey_exceed.secrecy_appraisal | 超出部分形成的成果是否属于国家秘密及其密级的鉴定结论 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 阻断 | 保密法第 28 条、第 57 条【法】；保密范围规定第 2 条【业】；境外窃密解释第 7 条【法】 |
| type.survey_foreign_survey_exceed.recognition_opinion | 市（地）级以上自然资源主管部门出具的测绘违法认定意见 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 警告 | 规程 3.2.4.7【业】 |
| type.survey_foreign_survey_exceed.fine_basis | 三万元以下罚款的裁量情节与违法所得 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 来华测绘办法第 18 条【业】；规程 3.2.3.3(6)【业】 |

### survey_foreign_survey_export（5 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.survey_foreign_survey_export.export_evidence | 海关查获材料、出境记录、传输日志、邮件或者网络传输取证 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.3(4)【业】；规程 3.2.4.2【业】 |
| type.survey_foreign_survey_export.results_seized | 被查获或者被扣押的成果与载体清单 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.1.1(7)【业】；规程 3.2.5【业】；反间谍法第 62 条、第 63 条【法】 |
| type.survey_foreign_survey_export.secrecy_appraisal | 出境成果是否属于国家秘密及其密级的鉴定结论 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 阻断 | 保密法第 28 条、第 57 条【法】；保密范围规定第 2 条【业】；境外窃密解释第 7 条【法】；规程 3.2.3.3(10)【业】 |
| type.survey_foreign_survey_export.recognition_opinion | 市（地）级以上自然资源主管部门出具的测绘违法认定意见 | 类型层·认定与检验结论 | 必填 | 核查前补齐 | 警告 | 规程 3.2.4.7【业】 |
| type.survey_foreign_survey_export.fine_basis | 三万元以下罚款的裁量情节与违法所得 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 来华测绘办法第 19 条【业】；保密法第 57 条【法】 |

## 国土空间规划（规程附录 D），共 63 项

### planning_build_without_permit（7 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.planning_build_without_permit.site_survey | 现场勘验材料与违法项目现状材料（现场勘验笔录、勘测定界图、勘测报告、现场照片、视听资料、设计文本、施工图纸、竣工测量报告；含规资部门协助勘验测量的情况） | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.4(5)(6)【业】；规程 3.1.1(2)【业】；《城乡规划法》第 53 条第 1 款第（二）项「根据需要进入现场进行勘测」【法】；《广州市违法建设查处条例》第 24 条第 3 款【业】 |
| type.planning_build_without_permit.correctable_finding | 改正措施与拆除可能性认定（尚可采取改正措施消除对规划实施的影响／无法采取改正措施消除影响／无法改正且不能拆除），及其认定依据与专家论证情况 | 类型层·认定结论 | 必填 | 核查前补齐 | 阻断 | 《城乡规划法》第 64 条【法】；规程 4.2.6【业】；建法〔2012〕99 号第三条、第四条、第七条、第八条、第九条【业】；《广东省城乡规划条例》第 80 条第 2 款（7 项情形）【业】；《广州市违法建设查处条例》第 20 条第 1、2、3 款【业】；法释〔2026〕10 号第 5 条【法】 |
| type.planning_build_without_permit.qualification_opinion_q1 | 规划定性意见·是否应当办理规划许可 | 类型层·认定结论 | 必填 | 核查前补齐 | 警告 | 《广州市违法建设查处条例》第 24 条第 1 款【业】；穗府办函〔2024〕84 号一（三）【业】；规程 3.2.3.4(8)【业】 |
| type.planning_build_without_permit.qualification_opinion_q2 | 规划定性意见·是否符合规划许可 | 类型层·认定结论 | 必填 | 核查前补齐 | 警告 | 《广州市违法建设查处条例》第 24 条第 1 款【业】；穗府办函〔2024〕84 号一（三）【业】；规程 3.2.3.4(8)【业】 |
| type.planning_build_without_permit.qualification_opinion_q3 | 规划定性意见·是否可采取改正措施消除对规划实施影响 | 类型层·认定结论 | 必填 | 核查前补齐 | 警告 | 《广州市违法建设查处条例》第 24 条第 1 款、第 4 款【业】；穗府办函〔2024〕84 号一（三）【业】；规程 3.2.3.4(8)、4.2.6【业】 |
| type.planning_build_without_permit.project_cost | 建设工程造价（罚款基数）及其确定方式（竣工结算价／已完工部分施工合同价／造价咨询机构评估／广州市房屋建筑工程参考造价／市政工程按施工合同或施工结算书） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 阻断 | 《城乡规划法》第 64 条【法】；规程 4.2.7【业】；规程 3.2.3.4(9)【业】；建法〔2012〕99 号第十二条【业，原文未逐字核到，见待定项 8】；《广东省城乡规划条例》第 80 条第 4 款【业】；《广州市违法建设查处条例》第 27 条第 2 款【业】 |
| type.planning_build_without_permit.illegal_income | 违法收入认定（出售所得价款／房地产评估机构评估／销售平均单价或市场评估单价×违法建设面积／当地相当等级房屋价格评估／违法建设工程总造价） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 《城乡规划法》第 64 条「没收实物或者违法收入」【法】；规程 4.2.8.4【业】；规程 3.2.3.4(10)【业】；《广东省城乡规划条例》第 80 条第 4 款【业】；《广州市违法建设查处条例》第 27 条第 2 款【业】 |

### planning_temporary_build（2 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.planning_temporary_build.site_survey | 现场勘验材料与违法项目现状材料（现场勘验笔录、勘测定界图、勘测报告、现场照片、视听资料、设计文本、施工图纸、竣工测量报告） | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.4(5)(6)【业】；规程 3.1.1(2)【业】；《城乡规划法》第 53 条第 1 款第（二）项【法】 |
| type.planning_temporary_build.temp_project_cost | 临时建设工程造价（罚款基数）及其确定方式 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 阻断 | 《城乡规划法》第 66 条「可以并处临时建设工程造价一倍以下的罚款」【法】；规程 4.2.7【业】；规程 3.2.3.4(9)【业】 |

### planning_completion_data_unreported（1 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.planning_completion_data_unreported.total_floor_area | 建设工程总建筑面积（裁量分档键） | 类型层·金额与裁量 | 必填 | 核查前补齐 | 阻断 | 粤自然资规字〔2022〕2 号附件 4《实施基准—城乡规划类》第 7 项（500 平方米以下／500 平方米以上 2000 平方米以下／2000 平方米以上三档）【业】；同办法第 23 条（应收集能支持裁量结果档次的证据）、第 27 条（「以下」包括本数、「以上」不包括本数）【业】 |

### planning_heritage_approval_duty（2 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.planning_heritage_approval_duty.planning_finding | 规划审批部门关于项目规划情况的认定意见 | 类型层·认定结论 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.4(8)【业】 |
| type.planning_heritage_approval_duty.site_survey | 现场勘验材料与违法项目现状材料 | 类型层·现场勘验与证据材料 | 选填 | 核查前补齐 | 提示 | 规程 3.2.3.4(5)(6)【业】；规程 3.1.1(2)【业】 |

### planning_heritage_prohibited_activity（7 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.planning_heritage_prohibited_activity.site_survey | 现场勘验材料（现场勘验笔录、勘测定界图、勘测报告） | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.4(5)【业】；规程 3.1.1(2)【业】 |
| type.planning_heritage_prohibited_activity.scene_material | 违法项目现状材料（现场照片、视听资料、设计文本、施工图纸、竣工测量报告） | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.4(6)【业】 |
| type.planning_heritage_prohibited_activity.inquiry_record | 询问笔录 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.4(2)【业】；规程 3.1.1(2)【业】 |
| type.planning_heritage_prohibited_activity.layout_damage_finding | 对传统格局、历史风貌破坏情况的认定意见（禁止活动情形为第（一）项时填写） | 类型层·认定结论 | 必填 | 核查前补齐 | 阻断 | 条例第 24 条第（一）项、第 41 条第（一）项「开山、采石、开矿等破坏传统格局和历史风貌的」【法】；规程 3.2.3.4(8)【业】 |
| type.planning_heritage_prohibited_activity.serious_consequence | 是否造成严重后果 | 类型层·认定结论 | 必填 | 核查前补齐 | 阻断 | 条例第 41 条「造成严重后果的，对单位并处……对个人并处……」【法】 |
| type.planning_heritage_prohibited_activity.illegal_income | 违法所得认定材料 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 条例第 41 条「有违法所得的，没收违法所得」【法】；《行政处罚法》第 28 条第 2 款「违法所得是指实施违法行为所取得的款项」【法】；规程 3.2.3.4(10)【业】 |
| type.planning_heritage_prohibited_activity.substitute_cost | 代履行所需费用 | 类型层·金额与裁量 | 选填 | 只提示 | 提示 | 条例第 41 条「所需费用由违法者承担」【法】 |

### planning_heritage_building_deface（3 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.planning_heritage_building_deface.deface_evidence | 刻划、涂污部位的现场照片、视听资料 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.4(6)【业】；规程 3.1.1(2)【业】 |
| type.planning_heritage_building_deface.site_survey | 现场勘验笔录 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.4(5)【业】；规程 3.1.1(2)【业】 |
| type.planning_heritage_building_deface.cultural_relic_overlap | 涉案历史建筑是否同时属于文物 | 类型层·认定结论 | 选填 | 核查前补齐 | 提示 | 条例第 46 条「对历史文化名城、名镇、名村中的文物造成损毁的，依照文物保护法律、法规的规定给予处罚；构成犯罪的，依法追究刑事责任」【法】 |

### planning_heritage_destructive_impact（7 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.planning_heritage_destructive_impact.site_survey | 现场勘验材料（现场勘验笔录、勘测定界图、勘测报告） | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.4(5)【业】；规程 3.1.1(2)【业】 |
| type.planning_heritage_destructive_impact.scene_material | 违法项目现状材料（现场照片、视听资料、设计文本、施工图纸、竣工测量报告） | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.4(6)【业】 |
| type.planning_heritage_destructive_impact.inquiry_record | 询问笔录 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.4(2)【业】；规程 3.1.1(2)【业】 |
| type.planning_heritage_destructive_impact.destructive_impact_finding | 破坏性影响认定意见（对传统格局、历史风貌或者历史建筑构成破坏性影响的认定） | 类型层·认定结论 | 必填 | 核查前补齐 | 阻断 | 条例第 43 条第 2 款「在活动过程中对传统格局、历史风貌或者历史建筑构成破坏性影响的」【法】；条例第 23 条（保护范围内建设活动不得构成破坏性影响；本轮只取到要点摘录）【法】；规程 3.2.3.4(8)【业】 |
| type.planning_heritage_destructive_impact.serious_consequence | 是否造成严重后果 | 类型层·认定结论 | 必填 | 核查前补齐 | 阻断 | 条例第 43 条第 1 款「造成严重后果的，对单位并处……对个人并处……」（第 2 款依照第 1 款规定予以处罚）【法】 |
| type.planning_heritage_destructive_impact.illegal_income | 违法所得认定材料 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 条例第 43 条第 1 款「有违法所得的，没收违法所得」【法】；《行政处罚法》第 28 条第 2 款【法】；规程 3.2.3.4(10)【业】 |
| type.planning_heritage_destructive_impact.substitute_cost | 代履行所需费用 | 类型层·金额与裁量 | 选填 | 只提示 | 提示 | 条例第 43 条第 1 款「所需费用由违法者承担」【法】 |

### planning_heritage_building_damage（9 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.planning_heritage_building_damage.building_status_before | 受损、迁移或者拆除前的历史建筑原状资料（测绘图、照片、历史影像） | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 条例第 44 条「限期恢复原状或者采取其他补救措施」【法】；规程 3.2.3.4(6)【业】 |
| type.planning_heritage_building_damage.site_survey | 现场勘验材料（现场勘验笔录、勘测定界图、勘测报告） | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.4(5)【业】；规程 3.1.1(2)【业】 |
| type.planning_heritage_building_damage.scene_material | 违法项目现状材料（现场照片、视听资料、设计文本、施工图纸、竣工测量报告） | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.4(6)【业】 |
| type.planning_heritage_building_damage.inquiry_record | 询问笔录 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.4(2)【业】；规程 3.1.1(2)【业】 |
| type.planning_heritage_building_damage.serious_consequence | 是否造成严重后果 | 类型层·认定结论 | 必填 | 核查前补齐 | 阻断 | 条例第 44 条「造成严重后果的，对单位并处……对个人并处……」【法】 |
| type.planning_heritage_building_damage.damage_finding | 历史建筑损坏程度的认定意见 | 类型层·认定结论 | 必填 | 核查前补齐 | 警告 | **无直接依据**（规程 3.2.4.7 只规定耕地破坏程度、矿产品价值、测绘地理信息违法行为认定三类，未含规划类；规程 3.2.3.4(8) 只写「项目规划情况的认定意见」），待定 |
| type.planning_heritage_building_damage.cultural_relic_overlap | 涉案历史建筑是否同时属于文物 | 类型层·认定结论 | 选填 | 核查前补齐 | 提示 | 条例第 46 条【法】 |
| type.planning_heritage_building_damage.illegal_income | 违法所得认定材料 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 条例第 44 条「有违法所得的，没收违法所得」【法】；《行政处罚法》第 28 条第 2 款【法】；规程 3.2.3.4(10)【业】 |
| type.planning_heritage_building_damage.substitute_cost | 代履行所需费用 | 类型层·金额与裁量 | 选填 | 只提示 | 提示 | 条例第 44 条「所需费用由违法者承担」【法】 |

### planning_heritage_signboard（2 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.planning_heritage_signboard.signboard_evidence | 标志牌现状的现场照片、视听资料 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 规程 3.2.3.4(6)【业】；规程 3.1.1(2)【业】 |
| type.planning_heritage_signboard.site_survey | 现场勘验笔录 | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 规程 3.2.3.4(5)【业】；规程 3.1.1(2)【业】 |

### planning_compiler_beyond_qualification（6 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.planning_compiler_beyond_qualification.archive_materials | 规划编制成果档案材料（现状调研资料、有关部门意见、历次审查会议纪要、公众意见及论证意见、规划委员会审议意见和批准文件、规划成果） | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 警告 | 广州条例第 29 条【业】；规程 3.2.3.4(12)【业】 |
| type.planning_compiler_beyond_qualification.beyond_scope_conclusion | 承担的业务是否超出资质等级规定范围的比对结论 | 类型层·认定结论 | 必填 | 核查前补齐 | 阻断 | 《办法》第 2 条第 2 款【业】；《城乡规划法》第 62 条第 1 款第（一）项【法】 |
| type.planning_compiler_beyond_qualification.standard_violation | 违反的国家有关标准、规范清单及具体条款 | 类型层·认定结论 | 必填 | 核查前补齐 | 阻断 | 《城乡规划法》第 24 条第 3 款「编制城乡规划必须遵守国家有关标准」、第 62 条第 1 款第（二）项【法】；《办法》第 18 条第 1 款【业】 |
| type.planning_compiler_beyond_qualification.mandatory_content | 不符合的内容是否属强制性内容（《城乡规划法》第 17 条第 2 款所列内容；上级国土空间规划的强制性内容） | 类型层·认定结论 | 必填 | 核查前补齐 | 阻断 | 省裁量基准附件 4 第 3 项分档键及备注「强制性内容指《城乡规划法》第十七条所规定的强制性内容」【业】；《办法》第 18 条第 1 款【业】 |
| type.planning_compiler_beyond_qualification.contract_amount | 项目合同金额 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 《办法》第 27 条第 1 款「处以项目合同金额 1 倍以上 2 倍以下的罚款」【业】 |
| type.planning_compiler_beyond_qualification.compilation_fee | 合同约定的规划编制费 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 《城乡规划法》第 62 条第 1 款「处合同约定的规划编制费一倍以上二倍以下的罚款」【法】；省裁量基准附件 4 第 2 项、第 3 项分档键【业】 |

### planning_compiler_without_qualification（3 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.planning_compiler_without_qualification.contract_amount | 项目合同金额 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 《办法》第 27 条第 2 款「依照前款规定处以罚款」、第 27 条第 1 款【业】 |
| type.planning_compiler_without_qualification.compilation_fee | 合同约定的规划编制费 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 《城乡规划法》第 62 条第 2 款「依照前款规定处以罚款」、第 62 条第 1 款【法】；省裁量基准附件 4 第 4 项分档键【业】 |
| type.planning_compiler_without_qualification.transition_claim | 是否主张《办法》第 31 条过渡期（该过渡期已于 2025-12-31 届满，2026 年起该抗辩不成立） | 类型层·认定结论 | 必填 | 核查前补齐 | 警告 | 《办法》第 31 条【业】 |

### planning_compiler_fraud_practice（3 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.planning_compiler_fraud_practice.contract_amount | 项目合同金额 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 《办法》第 27 条第 2 款、第 27 条第 1 款【业】 |
| type.planning_compiler_fraud_practice.compilation_fee | 合同约定的规划编制费 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 《城乡规划法》第 62 条第 3 款「依照本条第一款规定处以罚款」、第 62 条第 1 款【法】；省裁量基准附件 4 第 5 项分档键【业】 |
| type.planning_compiler_fraud_practice.concurrence_judgment | 与「以欺骗、贿赂等不正当手段取得资质证书」是否属同一违法行为的竞合判断 | 类型层·认定结论 | 必填 | 核查前补齐 | 警告 | 规程 15.4【业】；《办法》第 25 条第 2 款、第 27 条第 2 款【业】 |

### planning_compiler_condition_lapsed（2 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.planning_compiler_condition_lapsed.qualify_condition_lapse | 不再符合的资质条件项（法人资格；经相关行业协会注册的规划师数量；相关专业技术人员数量；技术装备；技术、质量、财务管理制度） | 类型层·认定结论 | 必填 | 核查前补齐 | 阻断 | 《城乡规划法》第 24 条第 2 款第（一）至（五）项【法】；《办法》第 29 条【业】 |
| type.planning_compiler_condition_lapsed.exemption_conditions | 免处罚情形四项合取（违法行为轻微；积极配合查处工作；及时改正并符合相应的资质条件；没有造成危害后果） | 类型层·认定结论 | 选填 | 核查前补齐 | 提示 | 省裁量基准附件 5 免处罚清单第 31 项【业】；规程 4.3.1【业】 |

### planning_compiler_false_application（1 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.planning_compiler_false_application.exit_nature | 出口性质判断（本项处理中哪部分属行政处罚、哪部分属行政许可程序行为） | 类型层·认定结论 | 必填 | 核查前补齐 | 阻断 | 《办法》第 25 条第 1 款【业】；规程 8.1 自然资源行政处罚的种类【业】 |

### planning_compiler_improper_obtain（3 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.planning_compiler_improper_obtain.contract_amount | 项目合同金额（涉及《办法》第 27 条第 2 款罚款时填写） | 类型层·金额与裁量 | 选填 | 核查前补齐 | 提示 | 《办法》第 27 条第 2 款、第 27 条第 1 款【业】 |
| type.planning_compiler_improper_obtain.fine_amount | 10 万元罚款的告知、决定与缴纳情况 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 《办法》第 25 条第 2 款「并处 10 万元罚款」【业】；规程 8.1(2)、10.6(1)【业】 |
| type.planning_compiler_improper_obtain.concurrence_judgment | 与「以欺骗手段取得资质证书承揽城乡规划编制工作」是否属同一违法行为的竞合判断 | 类型层·认定结论 | 必填 | 核查前补齐 | 警告 | 规程 15.4【业】；《城乡规划法》第 62 条第 3 款【法】；《办法》第 25 条第 2 款、第 27 条第 2 款【业】 |

### planning_compiler_certificate_transfer（3 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.planning_compiler_certificate_transfer.transfer_consideration | 倒卖、出租、出借的对价与收取情况 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 《办法》第 26 条「倒卖、出租、出借」【业】 |
| type.planning_compiler_certificate_transfer.transfer_evidence | 非法转让的证据材料（涂改的证书原件或者扫描件；出租、出借协议；以转让方名义签订的承揽合同；编制成果扉页注明的牵头单位与实际编制单位不一致的比对材料） | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 《办法》第 26 条【业】；《办法》第 18 条第 2 款（成果扉页注明牵头单位资质等级和证书编号）【业】；规程 3.2.3.4(7)【业】 |
| type.planning_compiler_certificate_transfer.fine_amount | 10 万元罚款的告知、决定与缴纳情况 | 类型层·金额与裁量 | 必填 | 核查前补齐 | 警告 | 《办法》第 26 条「并处 10 万元罚款」【业】；规程 8.1(2)、10.6(1)【业】 |

### planning_compiler_credit_record（2 项）

| 原要件键 | 项 | 原栏 | 原必填性 | 原必填时机 | 原缺件后果 | 依据（原文） |
|---|---|---|---|---|---|---|
| type.planning_compiler_credit_record.system_record | 管理信息系统的记录与查询结果（未更新的字段、系统记载的最后更新时间、查询时间与查询人） | 类型层·现场勘验与证据材料 | 必填 | 核查前补齐 | 阻断 | 《办法》第 4 条（管理信息系统）、第 19 条第 2 款【业】；规程 3.2.3.4(12)【业】 |
| type.planning_compiler_credit_record.fine_amount | 1000 元以上 1 万元以下罚款的告知、决定与缴纳情况 | 类型层·金额与裁量 | 选填 | 核查前补齐 | 提示 | 《办法》第 28 条「可以处」【业】；规程 8.1(2)、10.6(1)【业】 |
