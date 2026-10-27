// 来源层录入要件（ADR 0018；#24 决议第六节「来源要件（按来源大类，共 5 组）」）。
// 五组分别对应线索来源编码表的五个大类：1 主动发现、5 上级交办、22 部门移送、3 群众举报、21 舆情监测。
// 组的键是大类编码；组名（大类名）同时是这一组的「呈现」栏名（#199 决议第四节）。
// #24 决议没有给来源层要件的依据，依据栏留空；后续补依据时按同一份声明改，不另起一份。
//
// 三条口径（#24 决议第六节说明）：
// 1. 群众举报组的「举报方式」不另设要件：301 举报、302 投诉、305 电话举报这些编码本身已经表达了。
// 2. 卫片是手段，不是来源类别：卫片批次与图斑编号挂在主动发现组，填了任一即视为卫片发现。
// 3. 来源层与类型层叠加：一条土地类、上级交办的线索，要件＝公共 8 项＋交办 2 项＋土地类型要件。

import type { RequirementItem } from './types.ts';

/** 来源层的一组要件。key 是线索来源编码表的大类编码。 */
export interface SourceLayerGroup {
  /** 大类编码（1／5／22／3／21）。 */
  readonly sourceGroupCode: string;
  /** 大类名，同时是这一组的呈现栏名。 */
  readonly group: string;
  readonly items: readonly RequirementItem[];
}

export const SOURCE_LAYER_GROUPS: readonly SourceLayerGroup[] = [
  {
    sourceGroupCode: '1',
    group: '主动发现',
    items: [
      {
        key: 'clue.finder',
        label: '发现人',
        group: '主动发现',
        required: true,
        timing: '录入时',
        consequence: '警告',
        authority: 'internal',
        basis: [],
        basisNote:
          '未查到直接规定须记录发现人。部分依据：自然资源执法监督规定（2020年修正）第十六条「市、县自然资源主管部门应当建立执法巡查、抽查制度，组织开展巡查、抽查活动」；第十三条「市、县自然资源主管部门可以根据工作需要，聘任信息员、协管员，收集自然资源违法行为信息」；规程 2.4 要求呈批表载明案件来源。不升层级。',
      },
      {
        key: 'clue.patrol_no',
        label: '巡查记录号',
        group: '主动发现',
        required: true,
        timing: '录入时',
        consequence: '警告',
        authority: 'internal',
        condition: '来源选 16 日常巡查时',
        basis: [],
        basisNote:
          '未查到直接规定巡查记录编号。部分依据：自然资源执法监督规定（2020年修正）第十六条「市、县自然资源主管部门应当建立执法巡查、抽查制度，组织开展巡查、抽查活动」，只要求建立巡查制度，未规定记录编号。不升层级。',
      },
      {
        key: 'clue.campaign_no',
        label: '专项批次号',
        group: '主动发现',
        required: false,
        timing: '核查前补齐',
        consequence: '警告',
        authority: 'internal',
        condition: '来源选 13 专项排查及其三级时',
        basis: [],
      },
      {
        key: 'clue.satellite_batch',
        label: '卫片批次',
        group: '主动发现',
        required: false,
        timing: '只提示',
        consequence: '提示',
        authority: 'system',
        basis: [],
      },
      {
        key: 'clue.satellite_plot',
        label: '卫片图斑编号',
        group: '主动发现',
        required: false,
        timing: '只提示',
        consequence: '提示',
        authority: 'system',
        basis: [],
      },
    ],
  },
  {
    sourceGroupCode: '5',
    group: '上级交办',
    items: [
      {
        key: 'clue.assign_doc_no',
        label: '交办文号',
        group: '上级交办',
        required: true,
        timing: '录入时',
        consequence: '警告',
        authority: 'internal',
        basis: [],
        basisNote:
          '未查到直接规定交办文号。部分依据：自然资源执法监督规定（2020年修正）第十九条「对上级自然资源主管部门交办的自然资源违法案件……可以发出督办通知，责令限期办理」；信访工作条例第二十三条第一款「应当转送、交办有权处理的机关、单位」；规程 2.4 要求呈批表载明案件来源。不升层级。',
      },
      {
        key: 'clue.assign_org',
        label: '交办单位',
        group: '上级交办',
        required: true,
        timing: '录入时',
        consequence: '警告',
        authority: 'internal',
        basis: [],
        basisNote:
          '未查到直接规定交办单位字段。部分依据：自然资源执法监督规定（2020年修正）第十九条「对上级自然资源主管部门交办的自然资源违法案件……可以发出督办通知，责令限期办理」；信访工作条例第二十三条第一款「应当转送、交办有权处理的机关、单位」；规程 2.4 要求呈批表载明案件来源。不升层级。',
      },
    ],
  },
  {
    sourceGroupCode: '22',
    group: '部门移送',
    items: [
      {
        key: 'clue.transfer_doc_no',
        label: '移送函编号',
        group: '部门移送',
        required: true,
        timing: '录入时',
        consequence: '警告',
        authority: 'internal',
        basis: [],
        basisNote:
          '未查到直接规定移送函编号。部分依据：规程 2.1.4 要求填报《案件管辖移送书》；15.6「自然资源主管部门应当根据立案查处工作实际，建立并规范本辖区违法案件法律文书的编号规则」；自然资源行政处罚办法第十一条规定移送。不升层级。',
      },
      {
        key: 'clue.transfer_org',
        label: '移送单位',
        group: '部门移送',
        required: true,
        timing: '录入时',
        consequence: '警告',
        authority: 'internal',
        basis: [],
        basisNote:
          '未查到直接规定移送单位字段。部分依据：规程 2.1.4 要求填报《案件管辖移送书》；2.4 要求呈批表载明案件来源；自然资源行政处罚办法第十一条规定移送。不升层级。',
      },
    ],
  },
  {
    sourceGroupCode: '3',
    group: '群众举报',
    items: [
      {
        key: 'clue.reporter_anonymous',
        label: '是否匿名',
        group: '群众举报',
        required: true,
        timing: '录入时',
        consequence: '警告',
        authority: 'system',
        basis: [],
        basisNote:
          '未查到直接规定须录入「是否匿名」。部分依据：自然资源执法监督规定（2020年修正）第六条「任何单位和个人发现自然资源违法行为，有权向县级以上自然资源主管部门举报」；信访工作条例第十九条第一款「信访人一般应当采用书面形式提出信访事项，并载明其姓名（名称）、住址和请求、事实、理由」；12336 办法附件2 第三条「提倡实名举报」（该办法有效期已届满，未核延续）。不升层级。',
      },
      {
        key: 'clue.reporter_name',
        label: '反映人姓名',
        group: '群众举报',
        required: false,
        timing: '只提示',
        consequence: '提示',
        authority: 'normative',
        basis: [],
      },
      {
        key: 'clue.reporter_contact',
        label: '反映人联系方式',
        group: '群众举报',
        required: false,
        timing: '只提示',
        consequence: '提示',
        authority: 'internal',
        basis: [],
      },
      {
        key: 'clue.verifiable_basis',
        label: '可核查的事实基础',
        group: '群众举报',
        required: true,
        timing: '录入时',
        consequence: '警告',
        authority: 'internal',
        basis: [],
        basisNote:
          '部分依据：12336 办法第十二条第（五）项「对举报材料缺少违法行为发生地、主要违法事实描述不够清晰完整，需要举报人做进一步补充后才能判定的……告知举报人补充」（该办法有效期已届满，未核延续）；规程 2.2.1「核查的主要内容：……涉嫌违法的基本事实」；信访工作条例第十九条第二款。不升层级。',
      },
    ],
  },
  {
    sourceGroupCode: '21',
    group: '舆情监测',
    items: [
      {
        key: 'clue.opinion_source',
        label: '舆情来源',
        group: '舆情监测',
        required: true,
        timing: '录入时',
        consequence: '警告',
        authority: 'internal',
        basis: [],
        basisNote: '未查到官方依据。规程 2.4 只要求呈批表载明案件来源。不升层级。',
      },
      {
        key: 'clue.opinion_published_at',
        label: '发布时间',
        group: '舆情监测',
        required: true,
        timing: '录入时',
        consequence: '警告',
        authority: 'system',
        basis: [],
        basisNote: '未查到官方依据。该字段用于排序与时效判断，更接近系统自设。不升层级。',
      },
      {
        key: 'clue.opinion_ref',
        label: '链接或材料',
        group: '舆情监测',
        required: false,
        timing: '核查前补齐',
        consequence: '警告',
        authority: 'internal',
        basis: [],
      },
    ],
  },
];
