// 线索登记领域规则的单元测试（#211）。
// 测的是公共出口上的行为：缺件判定、几何解析、附件真实内容校验、幂等摘要。
// 断言的期望值来自规格（ADR 0018 与 #211 协议 B、E 节），不是从实现反推的。

import { describe, expect, it } from 'vitest';

import {
  ALLOWED_INPUT_SRID,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_COUNT,
  assessGaps,
  buildFormSchemaItems,
  contentDigest,
  parseSpatialSource,
  requestDigest,
  validateAttachment,
  validateAttachmentSet,
  type RequirementItem,
} from '../src/index.ts';

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff, 0xe0];
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46];

function bytes(prefix: readonly number[], rest = 32): Uint8Array {
  const out = new Uint8Array(prefix.length + rest);
  out.set(prefix, 0);
  return out;
}

/** 一个带指定部件名的 ZIP 容器（DOCX/XLSX 都是 ZIP，部件名才是分辨依据）。 */
function zipWith(partName: string): Uint8Array {
  const out = new Uint8Array(64);
  out.set([0x50, 0x4b, 0x03, 0x04], 0);
  out.set(new TextEncoder().encode(partName), 8);
  return out;
}

describe('缺件判定（ADR 0018 三层叠加）', () => {
  it('公共层与来源层的阻断项缺失进阻断集合', () => {
    const items = buildFormSchemaItems({ sourceGroupCode: '1', typeCodes: [] });
    const result = assessGaps({
      items,
      values: {},
      sourceCode: '1',
      subjectUnknown: false,
      fileSatisfiedKeys: ['clue.source', 'clue.domain', 'clue.location'],
    });
    expect(result.blocking.map((gap) => gap.key)).toEqual([
      'clue.received_at',
      'clue.narrative',
      'clue.finder',
    ]);
  });

  it('条件项只在条件成立时才算缺件：日常巡查要巡查记录号', () => {
    const items = buildFormSchemaItems({ sourceGroupCode: '1', typeCodes: [] });
    const base = {
      items,
      values: {},
      subjectUnknown: false,
      fileSatisfiedKeys: ['clue.source', 'clue.domain', 'clue.location'],
    };
    const patrol = assessGaps({ ...base, sourceCode: '16' });
    expect(patrol.blocking.map((gap) => gap.key)).toContain('clue.patrol_no');
    const discovery = assessGaps({ ...base, sourceCode: '1' });
    expect(discovery.blocking.map((gap) => gap.key)).not.toContain('clue.patrol_no');
  });

  it('类型层缺件不阻断登记，只落常驻缺件清单', () => {
    const items = buildFormSchemaItems({
      sourceGroupCode: '1',
      typeCodes: ['land_approve_without_authority'],
    });
    const result = assessGaps({
      items,
      values: {},
      sourceCode: '1',
      subjectUnknown: false,
      fileSatisfiedKeys: ['clue.source', 'clue.domain', 'clue.location'],
    });
    expect(result.blocking.map((gap) => gap.key)).not.toContain('type.land_approve_without_authority.approval_act_type');
    expect(result.typeGaps.map((gap) => gap.key)).toEqual([
      'type.land_approve_without_authority.approval_authority',
      'type.land_approve_without_authority.approval_act_type',
    ]);
  });

  it('时机为「核查前补齐」的类型项不进登记期缺件清单', () => {
    const items = buildFormSchemaItems({
      sourceGroupCode: '1',
      typeCodes: ['land_approve_without_authority'],
    });
    const result = assessGaps({
      items,
      values: {},
      sourceCode: '1',
      subjectUnknown: false,
      fileSatisfiedKeys: ['clue.source', 'clue.domain', 'clue.location'],
    });
    expect(result.typeGaps.map((gap) => gap.key)).not.toContain(
      'type.land_approve_without_authority.land_area',
    );
  });

  it('填了的要件不算缺件', () => {
    const items = buildFormSchemaItems({ sourceGroupCode: '1', typeCodes: [] });
    const result = assessGaps({
      items,
      values: { 'clue.received_at': '2026-10-25', 'clue.narrative': '现场发现', 'clue.finder': '张三' },
      sourceCode: '1',
      subjectUnknown: false,
      fileSatisfiedKeys: ['clue.source', 'clue.domain', 'clue.location'],
    });
    expect(result.blocking).toEqual([]);
  });

  it('当事人不明时主体名称一栏不算缺件', () => {
    const items: RequirementItem[] = [
      {
        key: 'type.land_demo.subject_name',
        label: '违法主体名称（取值：名称｜无法确定）',
        group: '违法主体',
        required: true,
        timing: '录入时',
        consequence: '阻断',
        basis: [],
      },
    ];
    const known = assessGaps({ items, values: {}, sourceCode: '1', subjectUnknown: false });
    expect(known.typeGaps.map((gap) => gap.key)).toEqual(['type.land_demo.subject_name']);
    const unknown = assessGaps({ items, values: {}, sourceCode: '1', subjectUnknown: true });
    expect(unknown.typeGaps).toEqual([]);
  });

  it('条件表外的条件取成立这一保守方向：要件仍算必填、缺件仍进清单', () => {
    const items: RequirementItem[] = [
      {
        key: 'type.mineral_demo.explore_license_no',
        label: '勘查许可证号',
        group: '许可资质与审批',
        required: true,
        timing: '录入时',
        consequence: '阻断',
        condition: '本行为主体是探矿权人',
        basis: [],
      },
    ];
    const result = assessGaps({ items, values: {}, sourceCode: '1', subjectUnknown: false });
    expect(result.typeGaps.map((gap) => gap.key)).toEqual(['type.mineral_demo.explore_license_no']);
  });

  it('位置由几何来源文件满足时不算缺件', () => {
    const items = buildFormSchemaItems({ sourceGroupCode: '1', typeCodes: [] });
    const result = assessGaps({
      items,
      values: { 'clue.received_at': '2026-10-25', 'clue.narrative': '现场发现', 'clue.finder': '张三' },
      sourceCode: '1',
      subjectUnknown: false,
      fileSatisfiedKeys: ['clue.source', 'clue.domain'],
    });
    expect(result.blocking.map((gap) => gap.key)).toEqual(['clue.location']);
  });
});

describe('几何解析（土地/矿产＝面，测绘/规划＝点）', () => {
  const polygon = {
    type: 'Polygon',
    coordinates: [[[113.0, 23.0], [113.1, 23.0], [113.1, 23.1], [113.0, 23.0]]],
  };

  it('面域接受单个面，产出一个面部件', () => {
    const outcome = parseSpatialSource({
      text: JSON.stringify({ type: 'Feature', geometry: polygon, properties: {} }),
      domain: 'land',
      srid: ALLOWED_INPUT_SRID,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.kind).toBe('face');
    expect(outcome.parts).toHaveLength(1);
  });

  it('面域的多面合并为同一条线索的多个面部件', () => {
    const outcome = parseSpatialSource({
      text: JSON.stringify({
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', geometry: polygon, properties: {} },
          {
            type: 'Feature',
            geometry: { type: 'MultiPolygon', coordinates: [[polygon.coordinates, polygon.coordinates]] },
            properties: {},
          },
        ],
      }),
      domain: 'mineral',
      srid: ALLOWED_INPUT_SRID,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.parts).toHaveLength(2);
    expect(outcome.parts.map((part) => part.partIndex)).toEqual([0, 1]);
  });

  it('面域收到点状几何即拒绝', () => {
    const outcome = parseSpatialSource({
      text: JSON.stringify({ type: 'Point', coordinates: [113, 23] }),
      domain: 'land',
      srid: ALLOWED_INPUT_SRID,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.rule).toBe('spatial-geometry-type-rejected');
  });

  it('点域只接受一个点位：多点拒绝', () => {
    const outcome = parseSpatialSource({
      text: JSON.stringify({
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', geometry: { type: 'Point', coordinates: [113, 23] }, properties: {} },
          { type: 'Feature', geometry: { type: 'Point', coordinates: [114, 24] }, properties: {} },
        ],
      }),
      domain: 'survey',
      srid: ALLOWED_INPUT_SRID,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.rule).toBe('spatial-geometry-type-rejected');
  });

  it('点域收到面状几何即拒绝', () => {
    const outcome = parseSpatialSource({
      text: JSON.stringify(polygon),
      domain: 'planning',
      srid: ALLOWED_INPUT_SRID,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.rule).toBe('spatial-geometry-type-rejected');
  });

  it('除 EPSG:4326 外的坐标系一律拒绝', () => {
    const outcome = parseSpatialSource({
      text: JSON.stringify(polygon),
      domain: 'land',
      srid: 4490,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.rule).toBe('spatial-srid-rejected');
  });

  it('不是合法 JSON 即拒绝', () => {
    const outcome = parseSpatialSource({ text: 'not json', domain: 'land', srid: ALLOWED_INPUT_SRID });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.rule).toBe('spatial-source-unparsable');
  });

  it('文件里声明的坐标系不是 4326 即拒绝', () => {
    const outcome = parseSpatialSource({
      text: JSON.stringify({
        type: 'Feature',
        geometry: polygon,
        properties: {},
        crs: { type: 'name', properties: { name: 'EPSG:4490' } },
      }),
      domain: 'land',
      srid: ALLOWED_INPUT_SRID,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.rule).toBe('spatial-srid-rejected');
  });
});

describe('附件校验（真实内容，不只看扩展名）', () => {
  it('PNG 魔数对得上即通过', () => {
    const result = validateAttachment({
      fileName: '现场照片.png',
      byteSize: PNG_MAGIC.length + 8,
      content: bytes(PNG_MAGIC),
    });
    expect(result.ok).toBe(true);
  });

  it('JPEG 魔数对得上即通过', () => {
    const result = validateAttachment({
      fileName: '现场照片.jpg',
      byteSize: JPEG_MAGIC.length + 8,
      content: bytes(JPEG_MAGIC),
    });
    expect(result.ok).toBe(true);
  });

  it('扩展名是 PNG 但内容不是图片即拒绝', () => {
    const result = validateAttachment({
      fileName: '假照片.png',
      byteSize: 16,
      content: new TextEncoder().encode('this is not an image'),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rule).toBe('attachment-content-mismatch');
  });

  it('视频与 ZIP 不收', () => {
    for (const fileName of ['现场视频.mp4', '打包.zip', '录像.mov']) {
      const result = validateAttachment({ fileName, byteSize: 16, content: bytes([0x00]) });
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.rule).toBe('attachment-type-not-allowed');
    }
  });

  it('DOCX 与 XLSX 按容器内的部件名分辨', () => {
    const docx = validateAttachment({
      fileName: '审批表.docx',
      byteSize: 64,
      content: zipWith('word/document.xml'),
    });
    expect(docx.ok).toBe(true);
    const xlsx = validateAttachment({
      fileName: '台账.xlsx',
      byteSize: 64,
      content: zipWith('xl/workbook.xml'),
    });
    expect(xlsx.ok).toBe(true);
    const plainZip = validateAttachment({
      fileName: '审批表.docx',
      byteSize: 64,
      content: zipWith('readme.txt'),
    });
    expect(plainZip.ok).toBe(false);
    if (plainZip.ok) return;
    expect(plainZip.rule).toBe('attachment-content-mismatch');
  });

  it('单件超 20MB 即拒', () => {
    const result = validateAttachment({
      fileName: '大件.pdf',
      byteSize: MAX_ATTACHMENT_BYTES + 1,
      content: bytes(PDF_MAGIC),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rule).toBe('attachment-size-exceeded');
    expect(result.tooLarge).toBe(true);
  });

  it('最多 20 件，超出即拒', () => {
    const one = { fileName: '现场照片.png', byteSize: 40, content: bytes(PNG_MAGIC) };
    const tooMany = validateAttachmentSet(Array.from({ length: MAX_ATTACHMENT_COUNT + 1 }, () => one));
    expect(tooMany.ok).toBe(false);
    if (tooMany.ok) return;
    expect(tooMany.rule).toBe('attachment-count-exceeded');
  });

  it('合计超 100MB 即拒', () => {
    const big = {
      fileName: '大件.png',
      byteSize: 20 * 1024 * 1024,
      content: bytes(PNG_MAGIC),
    };
    const result = validateAttachmentSet(Array.from({ length: 6 }, () => big));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rule).toBe('attachment-total-size-exceeded');
  });
});

describe('幂等摘要', () => {
  const base = {
    sourceCode: '1',
    domain: 'land',
    typeCodes: ['land_approve_without_authority'],
    tags: ['耕地', '夜间'],
    subjectUnknown: false,
    values: { 'clue.narrative': '现场发现', 'clue.finder': '张三' },
    files: [{ kind: 'attachment' as const, fileName: '照片.png', digest: 'a'.repeat(64) }],
  };

  it('同一报文得同一摘要', () => {
    expect(requestDigest(base)).toBe(requestDigest({ ...base }));
  });

  it('键序不同仍得同一摘要', () => {
    const reordered = { ...base, values: { 'clue.finder': '张三', 'clue.narrative': '现场发现' } };
    expect(requestDigest(reordered)).toBe(requestDigest(base));
  });

  it('取值不同即不同摘要', () => {
    expect(requestDigest({ ...base, values: { ...base.values, 'clue.narrative': '另一次' } })).not.toBe(
      requestDigest(base),
    );
  });

  it('文件不同即不同摘要', () => {
    expect(
      requestDigest({
        ...base,
        files: [{ kind: 'attachment', fileName: '照片.png', digest: 'b'.repeat(64) }],
      }),
    ).not.toBe(requestDigest(base));
  });

  it('内容摘要按字节算，同内容同值', () => {
    const content = new TextEncoder().encode('abc');
    expect(contentDigest(content)).toBe(contentDigest(new TextEncoder().encode('abc')));
    expect(contentDigest(content)).not.toBe(contentDigest(new TextEncoder().encode('abd')));
  });
});
