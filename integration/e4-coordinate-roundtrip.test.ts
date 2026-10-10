// E4 坐标口径验收用例（#47 E4 / #54）：CGCS2000（EPSG:4490）↔ 来源坐标往返可复现
// + 多几何部件（面/点）存取验证。integration 层 Vitest 需库用例：DATABASE_URL 由
// dev test integration harness 注入；用例自清理（只删自建行，绝不删数据卷）。
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../backend/prisma/generated/prisma/client.ts';
import {
  CGCS2000_SRID,
  cgcs2000ToSource,
  deleteLandBoundaryById,
  deleteSurveyPointById,
  findLandBoundaryById,
  findSurveyPointById,
  insertLandBoundary,
  insertSurveyPoint,
  sourceToCgcs2000,
  type SqlClient,
} from '@natural-enforcement/geo-dict';

// 来源坐标系：EPSG:4547 = CGCS2000 / 3-degree Gauss-Kruger CM 114E（投影坐标，
// 与 4490 地理坐标非恒等变换，可真实检验 ST_Transform 往返）。
const SOURCE_SRID = 4547;
// 往返保真断言精度：ST_AsText 输出 6 位小数（微米级）；正逆投影往返的 ~1e-9 米级
// 浮差远小于该精度，可复现性断言（两次循环逐字节一致）用默认 15 位全精度。
const FIDELITY_DIGITS = 6;
// 以下 WKT 常量按 PostGIS ST_AsText 规范形（坐标分隔无空格）书写：WKT 文本格式是
// 显示层细节（ST_AsText 归一化），「来源坐标原样保留」断言的是坐标值与坐标系代码。

const LAND_SOURCE_WKT =
  'POLYGON((499900 2999900,500100 2999900,500100 3000100,499900 3000100,499900 2999900))';
const MINERAL_SOURCE_WKT =
  'POLYGON((500200 3000200,500300 3000200,500300 3000300,500200 3000300,500200 3000200))';
const SURVEY_SOURCE_WKT = 'POINT(500050 3000050)';
const PLANNING_SOURCE_WKT = 'POINT(500250 3000250)';

let prisma: PrismaClient;
let db: SqlClient;
const landIds: string[] = [];
const pointIds: string[] = [];

// #16 §1.1 技术主键形制：26 位大写 Crockford Base32（shield ULID 契约）
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

beforeAll(() => {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL 未注入（须由 dev test integration harness 提供）');
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  prisma = new PrismaClient({ adapter });
  db = prisma;
});

afterAll(async () => {
  for (const id of landIds) await deleteLandBoundaryById(db, id);
  for (const id of pointIds) await deleteSurveyPointById(db, id);
  await prisma.$disconnect();
});

describe('E4 多几何部件存取（法域定几何）', () => {
  it('土地/矿产法域几何=面：写入（来源坐标→CGCS2000 落库）后读回', async () => {
    for (const [name, domain, sourceWkt] of [
      ['e4-land-boundary', 'land', LAND_SOURCE_WKT],
      ['e4-mineral-boundary', 'mineral', MINERAL_SOURCE_WKT],
    ] as const) {
      const id = await insertLandBoundary(db, { name, domain, sourceWkt, sourceSrid: SOURCE_SRID });
      landIds.push(id);
      const row = await findLandBoundaryById(db, id);
      expect(row).not.toBeNull();
      // 主键形制（#16 §1.1）：geo-dict 实体与 identity 同走 ULID 技术主键契约
      expect(id).toMatch(ULID_PATTERN);
      expect(row?.id).toBe(id);
      expect(row?.geometryType).toBe('ST_Polygon');
      expect(row?.cgcs2000Srid).toBe(CGCS2000_SRID);
      expect(row?.sourceSrid).toBe(SOURCE_SRID);
      // 来源坐标原样保留（口径 = CGCS2000 + 来源坐标保留）
      expect(row?.sourceWkt).toBe(sourceWkt);
    }
  });

  it('测绘/规划法域几何=点：写入后读回', async () => {
    for (const [name, domain, sourceWkt] of [
      ['e4-survey-point', 'survey', SURVEY_SOURCE_WKT],
      ['e4-planning-point', 'planning', PLANNING_SOURCE_WKT],
    ] as const) {
      const id = await insertSurveyPoint(db, { name, domain, sourceWkt, sourceSrid: SOURCE_SRID });
      pointIds.push(id);
      const row = await findSurveyPointById(db, id);
      expect(row).not.toBeNull();
      // 主键形制（#16 §1.1）：ULID 技术主键
      expect(id).toMatch(ULID_PATTERN);
      expect(row?.id).toBe(id);
      expect(row?.geometryType).toBe('ST_Point');
      expect(row?.cgcs2000Srid).toBe(CGCS2000_SRID);
      expect(row?.sourceSrid).toBe(SOURCE_SRID);
      expect(row?.sourceWkt).toBe(sourceWkt);
    }
  });
});

describe('E4 坐标往返（来源→CGCS2000→来源）', () => {
  it('同一输入恒定输出：两轮独立往返逐字节一致', async () => {
    for (const sourceWkt of [LAND_SOURCE_WKT, SURVEY_SOURCE_WKT]) {
      const first = {
        cgcs2000: await sourceToCgcs2000(db, sourceWkt, SOURCE_SRID),
        back: await cgcs2000ToSource(
          db,
          await sourceToCgcs2000(db, sourceWkt, SOURCE_SRID),
          SOURCE_SRID,
        ),
      };
      const second = {
        cgcs2000: await sourceToCgcs2000(db, sourceWkt, SOURCE_SRID),
        back: await cgcs2000ToSource(
          db,
          await sourceToCgcs2000(db, sourceWkt, SOURCE_SRID),
          SOURCE_SRID,
        ),
      };
      expect(second.cgcs2000).toBe(first.cgcs2000);
      expect(second.back).toBe(first.back);
    }
  });

  it('往返保真：6 位小数精度下还原来源坐标（面与点）', async () => {
    for (const sourceWkt of [LAND_SOURCE_WKT, MINERAL_SOURCE_WKT, SURVEY_SOURCE_WKT, PLANNING_SOURCE_WKT]) {
      const cgcs2000Wkt = await sourceToCgcs2000(db, sourceWkt, SOURCE_SRID);
      const roundTripped = await cgcs2000ToSource(db, cgcs2000Wkt, SOURCE_SRID, FIDELITY_DIGITS);
      expect(roundTripped).toBe(sourceWkt);
    }
  });

  it('落库几何往返：库内 CGCS2000 坐标转回来源坐标系与来源坐标一致', async () => {
    const land = await findLandBoundaryById(db, landIds[0]);
    const point = await findSurveyPointById(db, pointIds[0]);
    expect(
      await cgcs2000ToSource(db, land!.cgcs2000Wkt, land!.sourceSrid, FIDELITY_DIGITS),
    ).toBe(land!.sourceWkt);
    expect(
      await cgcs2000ToSource(db, point!.cgcs2000Wkt, point!.sourceSrid, FIDELITY_DIGITS),
    ).toBe(point!.sourceWkt);
  });
});
