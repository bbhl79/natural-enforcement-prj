// 用途：按街道（镇）编码读取辖区对应（街道编码 → 机构）的最新有效版，是 geo_dict_jurisdiction 表的运行期读取入口。
// 调用方：backend/server/src/persistence.module.ts 把它装配为令牌 JURISDICTION_LOOKUP 的实现；
//   令牌由 backend/server/src/clue-suggestion.service.ts（辖区建议）注入使用。
// 边界：只读，不做授权。表只追加，写入由种子 backend/prisma/seed.mjs 执行，本文件不写表。
// 依据：ADR 0016（docs/adr/0016-参照数据随种子只追加写入.md）；#214。
// 待确认：下文原注释称 case 侧（分派编排）经公共出口调用，grep 只找到 backend/server 内的调用，来源 backend/server/src/persistence.module.ts。
// 辖区对应的运行期读取（#214；规格 C 节「辖区建议」）。
//
// 辖区对应只存「街道编码 → 机构」，随种子只追加写入（ADR 0016）。运行期真值在库里：
// 同一街道编码可有多版，取最新一版；最新一版标 inactive 即整个编码停用，旧版 active 行不回溯。
// 本模块是 geo_dict_jurisdiction 表的读写归属方；case 侧（分派编排）经公共出口调用。

import type { SqlClient } from '../spatial/sql-client.ts';

/** 一条辖区对应（街道编码 → 机构）。 */
export interface JurisdictionRow {
  /** 街道（镇）编码。 */
  readonly code: string;
  readonly name: string;
  /** 归属机构编码（org_unit.code 弱引用，展示快照为 orgName）。 */
  readonly orgCode: string;
  readonly orgName: string;
}

/**
 * 按街道编码取最新有效版辖区对应。编码集合为空返回空数组。
 * 最新一版标 inactive 的编码不出现（整编码停用）。
 */
export async function listActiveJurisdictionRows(
  db: SqlClient,
  streetCodes: readonly string[],
): Promise<JurisdictionRow[]> {
  if (streetCodes.length === 0) return [];
  const payload = JSON.stringify([...new Set(streetCodes)]);
  // 别名加双引号：Postgres 否则会把 camelCase 别名折成小写，调用方按 interface 取名读取。
  const rows = await db.$queryRaw<
    Array<{ code: string; name: string; orgCode: string; orgName: string }>
  >`
    SELECT code, name, org_code AS "orgCode", org_name AS "orgName"
    FROM (
      SELECT DISTINCT ON (code) code, name, org_code, org_name, status
      FROM geo_dict_jurisdiction
      WHERE code IN (SELECT jsonb_array_elements_text(${payload}::jsonb))
      ORDER BY code, version DESC
    ) latest
    WHERE status = 'active'
    ORDER BY code
  `;
  return rows;
}
