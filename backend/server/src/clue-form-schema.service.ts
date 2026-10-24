// 录入要件表单结构（#210；#207 协议 E 节「录入、标签与文件」）。
//
// 前端经 GET /api/clue/form-schema 按来源、法域、类型获取，响应含声明版本。
// 声明本体在案件聚合模块（ADR 0018：case 常量是唯一要件声明源）；本服务只做三件事：
// 1. 用空间字典模块的参照数据核来源编码、法域与类型编码（名册外的取值一律 400）；
// 2. 把来源编码解析成来源大类（来源层按大类叠加），把类型编码解析成中文名（界面显示正式编码＋中文名）；
// 3. 调案件聚合模块叠加三层，返回叠加后的录入项与声明版本。
//
// 本服务是只读接口，不写业务事实，也不写留痕：读声明不是业务动作。

import { Injectable } from '@nestjs/common';

import {
  CLUE_REQUIREMENT_DECLARATION_VERSION,
  DOMAINS,
  buildFormSchemaItems,
  type Domain,
  type RequirementItem,
} from '@natural-enforcement/case';
import {
  findDocument,
  findSourceCode,
  findSourceGroupCode,
  findViolationType,
} from '@natural-enforcement/geo-dict';

/** 查询参数。来源编码与法域必填，类型编码可空（可多值）。 */
export interface FormSchemaQuery {
  readonly sourceCode?: unknown;
  readonly domain?: unknown;
  readonly types?: unknown;
}

/** 响应里的一项。依据带上文件名（引用处的文件编号与条号来自声明）。 */
export interface FormSchemaItem {
  readonly key: string;
  readonly label: string;
  readonly group: string;
  readonly required: boolean;
  readonly timing: string;
  readonly consequence: string;
  readonly condition?: string;
  readonly basis: readonly { readonly document: string; readonly documentName: string; readonly article: string }[];
  readonly basisNote?: string;
}

/** 响应里的一组（按「呈现」栏名归并）。 */
export interface FormSchemaGroup {
  readonly name: string;
  readonly items: readonly FormSchemaItem[];
}

export interface FormSchemaBody {
  readonly result: 'listed';
  readonly declarationVersion: string;
  readonly source: { readonly code: string; readonly name: string; readonly group: string };
  readonly domain: Domain;
  readonly types: readonly { readonly code: string; readonly name: string }[];
  readonly groups: readonly FormSchemaGroup[];
  readonly items: readonly FormSchemaItem[];
}

export type FormSchemaOutcome =
  | { readonly status: 200; readonly body: FormSchemaBody }
  | { readonly status: 400; readonly body: { readonly result: 'non-compliant'; readonly rules: readonly string[] } };

@Injectable()
export class ClueFormSchemaService {
  schema(query: FormSchemaQuery): FormSchemaOutcome {
    const sourceCode = typeof query.sourceCode === 'string' ? query.sourceCode.trim() : '';
    if (sourceCode === '') return bad(['missing-source-code']);
    const source = findSourceCode(sourceCode);
    if (!source) return bad(['unknown-source-code']);
    const sourceGroupCode = findSourceGroupCode(sourceCode);
    if (sourceGroupCode === null) return bad(['unknown-source-code']);

    const domain = typeof query.domain === 'string' ? query.domain.trim() : '';
    if (domain === '') return bad(['missing-domain']);
    if (!DOMAINS.includes(domain as Domain)) return bad(['unknown-domain']);

    const typeCodes = readTypeCodes(query.types);
    const types: { code: string; name: string }[] = [];
    for (const typeCode of typeCodes) {
      const type = findViolationType(typeCode);
      if (!type || !type.selectable) return bad(['unknown-type-code']);
      types.push({ code: type.code, name: type.name });
    }

    const items = buildFormSchemaItems({ sourceGroupCode, typeCodes });
    const groups = groupBy(items);
    return {
      status: 200,
      body: {
        result: 'listed',
        declarationVersion: CLUE_REQUIREMENT_DECLARATION_VERSION,
        source: { code: source.code, name: source.name, group: sourceGroupName(sourceGroupCode) },
        domain: domain as Domain,
        types,
        groups,
        items: items.map(toItem),
      },
    };
  }
}

/** 把类型参数读成编码数组。接受数组或逗号分隔串。 */
function readTypeCodes(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter((value) => value !== '');
  }
  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value !== '');
  }
  return [];
}

/** 来源大类编码对应的大类名（呈现栏名）。 */
function sourceGroupName(sourceGroupCode: string): string {
  const names: Record<string, string> = {
    '1': '主动发现',
    '5': '上级交办',
    '22': '部门移送',
    '3': '群众举报',
    '21': '舆情监测',
  };
  return names[sourceGroupCode] ?? sourceGroupCode;
}

/** 依据带上门名。声明里只存文件编号与条号（ADR 0019）。 */
function toItem(item: RequirementItem): FormSchemaItem {
  return {
    key: item.key,
    label: item.label,
    group: item.group,
    required: item.required,
    timing: item.timing,
    consequence: item.consequence,
    ...(item.condition === undefined ? {} : { condition: item.condition }),
    basis: item.basis.map((entry) => ({
      document: entry.document,
      documentName: findDocument(entry.document)?.name ?? entry.document,
      article: entry.article,
    })),
    ...(item.basisNote === undefined ? {} : { basisNote: item.basisNote }),
  };
}

/** 按呈现栏名归并，栏名顺序按首次出现。 */
function groupBy(items: readonly RequirementItem[]): FormSchemaGroup[] {
  const groups = new Map<string, FormSchemaItem[]>();
  for (const item of items) {
    const bucket = groups.get(item.group);
    if (bucket) bucket.push(toItem(item));
    else groups.set(item.group, [toItem(item)]);
  }
  return [...groups].map(([name, groupItems]) => ({ name, items: groupItems }));
}

function bad(rules: readonly string[]): FormSchemaOutcome {
  return { status: 400, body: { result: 'non-compliant', rules } };
}
