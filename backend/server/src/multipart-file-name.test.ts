import { describe, expect, it } from 'vitest';

import { decodeMultipartFileName } from './multipart-file-name.ts';

/** 复现框架按 latin1 解 UTF-8 字节的结果（浏览器发的就是 UTF-8 字节）。 */
function asFrameworkDecodes(name: string): string {
  return Buffer.from(name, 'utf8').toString('latin1');
}

describe('multipart 上传文件名解码', () => {
  it('中文名：还原框架按 latin1 解出的乱码', () => {
    for (const name of ['现场照片.png', '移送函.pdf', '粤自然移〔2026〕1 号.docx']) {
      expect(decodeMultipartFileName(asFrameworkDecodes(name))).toBe(name);
    }
  });

  it('纯 ASCII 名：原样返回', () => {
    expect(decodeMultipartFileName('area.geojson')).toBe('area.geojson');
    expect(decodeMultipartFileName('evidence-01.PNG')).toBe('evidence-01.PNG');
  });

  it('已是多字节字符（框架已解对）：不做二次解码', () => {
    expect(decodeMultipartFileName('现场照片.png')).toBe('现场照片.png');
  });

  it('真实单字节名：重解会出替换字符，保持原值', () => {
    expect(decodeMultipartFileName('café.png')).toBe('café.png');
  });
});