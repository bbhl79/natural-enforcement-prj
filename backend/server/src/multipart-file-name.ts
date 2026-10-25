/**
 * multipart 上传文件名解码。
 *
 * Content-Disposition 的 filename 参数按 RFC 7578 是「原样字节」，框架（busboy）
 * 默认按 latin1 解出字符串，而浏览器发的是 UTF-8 字节：中文附件名会以乱码入库
 * （如「现场照片.png」变成「ç°åºç§ç.png」），并在材料行与界面上如实显示成乱码。
 *
 * 这里按 latin1 还原字节后以 UTF-8 重解一次。三种情形都要正确：
 *   - 纯 ASCII 名：重解结果与原值相同，不受影响；
 *   - 中文等多字节名（框架解成 latin1）：还原出原文件名；
 *   - 本就含多字节字符（框架已解对）：直接原样返回，不做二次破坏。
 */

/** 已含 U+00FF 之外的字符即视为「框架已正确解码」，除非确为乱码恢复。 */
const HAS_MULTIBYTE = /[^\u0000-ÿ]/;
/** UTF-8 解码失败的替换字符：出现即说明原值本就不是 UTF-8 字节串。 */
const REPLACEMENT = '�';

/**
 * 还原 multipart 上传的文件名。
 * 已是多字节的直接原样返回；否则按 latin1→UTF-8 重解，重解出替换字符则保持原值。
 */
export function decodeMultipartFileName(raw: string): string {
  if (HAS_MULTIBYTE.test(raw)) return raw;
  const decoded = Buffer.from(raw, 'latin1').toString('utf8');
  return decoded.includes(REPLACEMENT) ? raw : decoded;
}