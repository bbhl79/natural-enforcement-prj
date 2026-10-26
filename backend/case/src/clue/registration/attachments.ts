// 附件校验（#211；规格 E）。
//
// 口径：
// - 普通附件只收 JPG/JPEG/PNG/PDF/DOC/DOCX/XLS/XLSX；不收视频，不收 ZIP。
// - 单件 ≤20MB、单线索合计 ≤100MB、最多 20 件。
// - 服务端校验真实内容，不只看扩展名：扩展名先过白名单，再按魔数与容器结构核对。
// - GeoJSON 来源文件不占普通附件配额，单独按 ≤20MB 校验。

/** 单件附件上限（字节）。 */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
/** 单线索附件合计上限（字节）。 */
export const MAX_ATTACHMENTS_TOTAL_BYTES = 100 * 1024 * 1024;
/** 单线索附件件数上限。 */
export const MAX_ATTACHMENT_COUNT = 20;
/** 几何来源文件上限（字节）。 */
export const MAX_SPATIAL_SOURCE_BYTES = 20 * 1024 * 1024;

/** 附件的真实内容类别。 */
export type AttachmentKind = 'jpeg' | 'png' | 'pdf' | 'ole2' | 'ooxml';

/** 校验结果。失败时带规则码（进 400 响应的 rules）。 */
export type AttachmentValidation =
  | { readonly ok: true; readonly kind: AttachmentKind; readonly contentType: string }
  | { readonly ok: false; readonly rule: string; readonly message: string; readonly tooLarge?: boolean };

/** 一件待校验的附件。 */
export interface AttachmentCandidate {
  readonly fileName: string;
  readonly byteSize: number;
  readonly content: Uint8Array;
}

const CONTENT_TYPE_BY_KIND: Readonly<Record<AttachmentKind, string>> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  pdf: 'application/pdf',
  ole2: 'application/msword',
  ooxml: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const EXTENSION_BY_KIND: Readonly<Record<AttachmentKind, readonly string[]>> = {
  jpeg: ['jpg', 'jpeg'],
  png: ['png'],
  pdf: ['pdf'],
  ole2: ['doc', 'xls'],
  ooxml: ['docx', 'xlsx'],
};

const OLE2_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

function startsWith(content: Uint8Array, magic: readonly number[]): boolean {
  if (content.length < magic.length) return false;
  for (let index = 0; index < magic.length; index += 1) {
    if (content[index] !== magic[index]) return false;
  }
  return true;
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0 || dot === fileName.length - 1) return '';
  return fileName.slice(dot + 1).toLowerCase();
}

function kindOfExtension(extension: string): AttachmentKind | null {
  for (const [kind, extensions] of Object.entries(EXTENSION_BY_KIND)) {
    if ((extensions as readonly string[]).includes(extension)) return kind as AttachmentKind;
  }
  return null;
}

function contentTypeFor(kind: AttachmentKind, extension: string): string {
  if (kind === 'ole2') {
    return extension === 'xls' ? 'application/vnd.ms-excel' : 'application/msword';
  }
  if (kind === 'ooxml') {
    return extension === 'xlsx'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : CONTENT_TYPE_BY_KIND.ooxml;
  }
  return CONTENT_TYPE_BY_KIND[kind];
}

/** DOCX 与 XLSX 都是 ZIP 容器：光看 PK 头分不出，故再查容器内的部件名。 */
function ooxmlPartOf(content: Uint8Array, extension: string): boolean {
  const buffer = Buffer.from(content.buffer, content.byteOffset, content.byteLength);
  if (extension === 'docx') return buffer.indexOf('word/document.xml') >= 0;
  return buffer.indexOf('xl/workbook.xml') >= 0;
}

/**
 * 校验一件附件：扩展名白名单 + 真实内容核对。
 * 大小超限返回 tooLarge，由调用方决定 413 还是 400。
 */
export function validateAttachment(candidate: AttachmentCandidate): AttachmentValidation {
  if (candidate.byteSize > MAX_ATTACHMENT_BYTES) {
    return {
      ok: false,
      rule: 'attachment-size-exceeded',
      message: `单件附件不得超过 ${MAX_ATTACHMENT_BYTES} 字节`,
      tooLarge: true,
    };
  }
  if (candidate.byteSize === 0) {
    return { ok: false, rule: 'attachment-empty', message: '附件内容为空' };
  }
  const extension = extensionOf(candidate.fileName);
  const kind = kindOfExtension(extension);
  if (kind === null) {
    return {
      ok: false,
      rule: 'attachment-type-not-allowed',
      message: `附件类型不允许：${extension === '' ? '（无扩展名）' : extension}`,
    };
  }
  const content = candidate.content;
  let matched: boolean;
  if (kind === 'jpeg') matched = startsWith(content, [0xff, 0xd8, 0xff]);
  else if (kind === 'png') {
    matched = startsWith(content, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  } else if (kind === 'pdf') {
    matched = content.length >= 4 && content[0] === 0x25 && content[1] === 0x50 && content[2] === 0x44 && content[3] === 0x46;
  } else if (kind === 'ole2') matched = startsWith(content, OLE2_MAGIC);
  else matched = startsWith(content, ZIP_MAGIC) && ooxmlPartOf(content, extension);
  if (!matched) {
    return {
      ok: false,
      rule: 'attachment-content-mismatch',
      message: `附件真实内容与扩展名不符：${candidate.fileName}`,
    };
  }
  return { ok: true, kind, contentType: contentTypeFor(kind, extension) };
}

/**
 * 校验一组附件：件数、合计字节、逐件真实内容。
 * 任一不通过即整单不通过（规格 E：先完整校验，任一不通过即 4xx，存储零写入）。
 */
export function validateAttachmentSet(
  candidates: readonly AttachmentCandidate[],
): { readonly ok: true } | { readonly ok: false; readonly rule: string; readonly message: string; readonly tooLarge?: boolean } {
  if (candidates.length > MAX_ATTACHMENT_COUNT) {
    return {
      ok: false,
      rule: 'attachment-count-exceeded',
      message: `单线索附件不得超过 ${MAX_ATTACHMENT_COUNT} 件`,
    };
  }
  let total = 0;
  for (const candidate of candidates) {
    const result = validateAttachment(candidate);
    if (!result.ok) return result;
    total += candidate.byteSize;
  }
  if (total > MAX_ATTACHMENTS_TOTAL_BYTES) {
    return {
      ok: false,
      rule: 'attachment-total-size-exceeded',
      message: `单线索附件合计不得超过 ${MAX_ATTACHMENTS_TOTAL_BYTES} 字节`,
      tooLarge: true,
    };
  }
  return { ok: true };
}
