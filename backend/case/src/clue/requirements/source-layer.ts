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
        consequence: '阻断',
        basis: [],
      },
      {
        key: 'clue.patrol_no',
        label: '巡查记录号',
        group: '主动发现',
        required: true,
        timing: '录入时',
        consequence: '阻断',
        condition: '来源选 16 日常巡查时',
        basis: [],
      },
      {
        key: 'clue.campaign_no',
        label: '专项批次号',
        group: '主动发现',
        required: false,
        timing: '核查前补齐',
        consequence: '警告',
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
        basis: [],
      },
      {
        key: 'clue.satellite_plot',
        label: '卫片图斑编号',
        group: '主动发现',
        required: false,
        timing: '只提示',
        consequence: '提示',
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
        consequence: '阻断',
        basis: [],
      },
      {
        key: 'clue.assign_org',
        label: '交办单位',
        group: '上级交办',
        required: true,
        timing: '录入时',
        consequence: '阻断',
        basis: [],
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
        consequence: '阻断',
        basis: [],
      },
      {
        key: 'clue.transfer_org',
        label: '移送单位',
        group: '部门移送',
        required: true,
        timing: '录入时',
        consequence: '阻断',
        basis: [],
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
        consequence: '阻断',
        basis: [],
      },
      {
        key: 'clue.reporter_name',
        label: '反映人姓名',
        group: '群众举报',
        required: false,
        timing: '只提示',
        consequence: '提示',
        basis: [],
      },
      {
        key: 'clue.reporter_contact',
        label: '反映人联系方式',
        group: '群众举报',
        required: false,
        timing: '只提示',
        consequence: '提示',
        basis: [],
      },
      {
        key: 'clue.verifiable_basis',
        label: '可核查的事实基础',
        group: '群众举报',
        required: true,
        timing: '录入时',
        consequence: '阻断',
        basis: [],
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
        consequence: '阻断',
        basis: [],
      },
      {
        key: 'clue.opinion_published_at',
        label: '发布时间',
        group: '舆情监测',
        required: true,
        timing: '录入时',
        consequence: '阻断',
        basis: [],
      },
      {
        key: 'clue.opinion_ref',
        label: '链接或材料',
        group: '舆情监测',
        required: false,
        timing: '核查前补齐',
        consequence: '警告',
        basis: [],
      },
    ],
  },
];
