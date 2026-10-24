// 参照数据（ADR 0016；#210）。
// 本目录持有参照数据的初值常量：线索来源编码、违法类型编码、依据文件、类型依据、辖区对应。
// 初值常量由 tools/generate-clue-reference-data.mjs 从 docs/research/ 下的定稿底稿生成；
// 种子按同一份常量写库（业务编码 + 版本，只追加）。
//
// 读法：运行期真值在库里（管理台只读，改动走代码评审和发布）。本目录的常量是同一份初值，
// 供需要在落库前后都用同一套编码的模块（如 case 侧按来源大类叠加要件）直接引用，
// 免去在业务代码里直连库。

import {
  DOCUMENTS,
  JURISDICTION_ROWS,
  SOURCE_CODES,
  VIOLATION_TYPES,
  VIOLATION_TYPE_BASIS,
} from './reference-data.generated.ts';

export {
  DOCUMENTS,
  JURISDICTION_ROWS,
  SOURCE_CODES,
  VIOLATION_TYPES,
  VIOLATION_TYPE_BASIS,
};

/** 一条线索来源编码。 */
export interface SourceCodeRow {
  readonly code: string;
  readonly name: string;
  readonly parentCode: string | null;
}

/** 一个违法类型编码。 */
export interface ViolationTypeRow {
  readonly code: string;
  readonly name: string;
  readonly domain: string;
  readonly parentCode: string | null;
  readonly selectable: boolean;
  readonly appendix: string | null;
}

/** 一份依据文件。 */
export interface DocumentRow {
  readonly code: string;
  readonly name: string;
  readonly hierarchyLevel: string;
  readonly validityStatus: string;
  readonly note: string | null;
}

const SOURCE_CODE_BY_CODE = new Map<string, SourceCodeRow>(
  SOURCE_CODES.map((row) => [row.code, row] as readonly [string, SourceCodeRow]),
);
const VIOLATION_TYPE_BY_CODE = new Map<string, ViolationTypeRow>(
  VIOLATION_TYPES.map((row) => [row.code, row] as readonly [string, ViolationTypeRow]),
);
const DOCUMENT_BY_CODE = new Map<string, DocumentRow>(
  DOCUMENTS.map((row) => [row.code, row] as readonly [string, DocumentRow]),
);

/** 按编码取线索来源。取不到返回 null。 */
export function findSourceCode(code: string): SourceCodeRow | null {
  return SOURCE_CODE_BY_CODE.get(code) ?? null;
}

/**
 * 取线索来源所属的大类编码（1／5／22／3／21）。
 * 上级显式存上级编码，沿链上溯到没有上级的那一层就是大类（ADR 0016「上下级与出处」）。
 * 编码不存在返回 null。
 */
export function findSourceGroupCode(code: string): string | null {
  let current = SOURCE_CODE_BY_CODE.get(code);
  if (!current) return null;
  const seen = new Set<string>();
  while (current.parentCode != null) {
    if (seen.has(current.code)) return null;
    seen.add(current.code);
    const parent = SOURCE_CODE_BY_CODE.get(current.parentCode);
    if (!parent) return null;
    current = parent;
  }
  return current.code;
}

/** 按编码取违法类型。取不到返回 null。 */
export function findViolationType(code: string): ViolationTypeRow | null {
  return VIOLATION_TYPE_BY_CODE.get(code) ?? null;
}

/** 按文件编号取依据文件。取不到返回 null。 */
export function findDocument(code: string): DocumentRow | null {
  return DOCUMENT_BY_CODE.get(code) ?? null;
}
