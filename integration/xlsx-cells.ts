// 集成测试用的 .xlsx 读取（#126）：按 ZIP 中央目录找到第一张工作表，逐行取出单元格文字。
// 不复用 server 的写出代码，独立按格式解析，避免「自己写、自己读」掩盖错误。
import { inflateRawSync } from 'node:zlib';

function entries(file: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let end = file.length - 22;
  while (end >= 0 && file.readUInt32LE(end) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error('不是 ZIP：找不到中央目录结尾');
  const count = file.readUInt16LE(end + 10);
  let at = file.readUInt32LE(end + 16);
  for (let i = 0; i < count; i += 1) {
    if (file.readUInt32LE(at) !== 0x02014b50) throw new Error('中央目录项损坏');
    const method = file.readUInt16LE(at + 10);
    const size = file.readUInt32LE(at + 20);
    const nameLength = file.readUInt16LE(at + 28);
    const extraLength = file.readUInt16LE(at + 30);
    const commentLength = file.readUInt16LE(at + 32);
    const local = file.readUInt32LE(at + 42);
    const name = file.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    const dataAt = local + 30 + file.readUInt16LE(local + 26) + file.readUInt16LE(local + 28);
    const raw = file.subarray(dataAt, dataAt + size);
    out.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));
    at += 46 + nameLength + extraLength + commentLength;
  }
  return out;
}

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** 第一张工作表的全部行（含表头），以及这张表的原始 XML（用于整表扫描）。 */
export function readXlsxSheet(file: Buffer): { rows: string[][]; xml: string; parts: string[] } {
  const parts = entries(file);
  const contentTypes = parts.get('[Content_Types].xml')?.toString('utf8') ?? '';
  if (!contentTypes.includes('spreadsheetml.sheet.main+xml')) throw new Error('不是 xlsx：缺工作簿内容类型');
  const sheetName = [...parts.keys()].find((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  if (!sheetName) throw new Error('xlsx 里没有工作表');
  const xml = (parts.get(sheetName) as Buffer).toString('utf8');
  const rows = [...xml.matchAll(/<row\b[^>]*>(.*?)<\/row>/gs)].map((match) =>
    [...(match[1] as string).matchAll(/<c\b[^>]*>(.*?)<\/c>/gs)].map((cell) =>
      unescapeXml([...(cell[1] as string).matchAll(/<t\b[^>]*>(.*?)<\/t>/gs)].map((t) => t[1]).join('')),
    ),
  );
  return { rows, xml, parts: [...parts.keys()] };
}
