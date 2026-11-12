// 用途：计算线索登记请求的幂等摘要与单个文件的内容摘要。
// 调用方：backend/server/src/clue-registration.service.ts（登记幂等判定）、backend/server/src/clue-disposition.service.ts 与 backend/server/src/case-transfer.service.ts（附件摘要），经包名 @natural-enforcement/case 导入。
// 边界：纯函数，不写库、不写留痕；幂等键与摘要落库、同 key 异报文的 409 判定由调用方执行。
// 依据：#211。
// 幂等摘要（#211；规格 E「上传方式」）。
//
// 客户端每次登记生成 Idempotency-Key；服务端把幂等键与请求摘要存在 Clue 的两个列上
// （唯一约束，不新增表）。同 key 同报文返回首次结果；同 key 异报文返回 409 already-exists。
//
// 摘要口径：把表单取值与文件摘要规范化后取 sha256。列表按字典序排序，
// 键序不同不影响摘要；取值原样参与（空白也是报文的一部分）。

import { createHash } from 'node:crypto';

import type { ClueFormValues } from './types.ts';

/** 一件文件参与摘要的口径。 */
export interface DigestFile {
  /** 文件项类别。 */
  readonly kind: 'attachment' | 'spatial-source';
  /** 原始文件名。 */
  readonly fileName: string;
  /** 文件内容摘要（sha256 十六进制）。 */
  readonly digest: string;
}

/** 参与摘要的登记请求。 */
export interface RequestDigestInput {
  readonly sourceCode: string;
  readonly domain: string;
  /** 初步涉嫌违法类型（可空可多选）。 */
  readonly typeCodes: readonly string[];
  /** 标签。 */
  readonly tags: readonly string[];
  /** 当事人不明。 */
  readonly subjectUnknown: boolean;
  /** 要件取值。 */
  readonly values: ClueFormValues;
  /** 文件。 */
  readonly files: readonly DigestFile[];
}

/** 文件内容摘要（sha256 十六进制）。 */
export function contentDigest(content: Uint8Array): string {
  return createHash('sha256')
    .update(Buffer.from(content.buffer, content.byteOffset, content.byteLength))
    .digest('hex');
}

/** 计算请求摘要。同 key 同报文得同值；报文有任何差别即不同值。 */
// 纯函数，不写库；幂等键与摘要落库、同 key 异报文的 409 判定由调用方负责。
export function requestDigest(input: RequestDigestInput): string {
  const parts: string[] = [];
  parts.push(`source=${input.sourceCode}`);
  parts.push(`domain=${input.domain}`);
  parts.push(`subjectUnknown=${input.subjectUnknown ? '1' : '0'}`);
  for (const code of [...input.typeCodes].sort()) parts.push(`type=${code}`);
  for (const tag of [...input.tags].sort()) parts.push(`tag=${tag}`);
  for (const key of Object.keys(input.values).sort()) {
    parts.push(`value=${key}\u0000${input.values[key] ?? ''}`);
  }
  const files = [...input.files]
    .map((file) => `${file.kind}\u0000${file.fileName}\u0000${file.digest}`)
    .sort();
  for (const file of files) parts.push(`file=${file}`);
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}
