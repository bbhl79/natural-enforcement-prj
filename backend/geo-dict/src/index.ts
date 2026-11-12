// 用途：空间字典模块的唯一公共出口，汇总坐标口径常量、面/点几何存取、参照数据初值与查找函数、辖区对应读取、GeoDictModule。
// 调用方：经包名 @natural-enforcement/geo-dict 引用的有：backend/server/src 下的 app.module.ts、persistence.module.ts 与
//   clue-registration、clue-closure、clue-dispatch、clue-duplicate、clue-form-schema、clue-suggestion、case-filing 各服务文件；
//   backend/case/src/clue/dispatch/planning-guidance.ts；backend/case/test 下 comparison-rules、requirement-authority、
//   requirement-basis 三个测试；integration/e4-coordinate-roundtrip.test.ts。integration/clue-form-schema.test.ts 按相对路径引本文件。
// 边界：本文件只做再导出，不含逻辑；不依赖任何业务模块。
//   种子通道 backend/prisma/seed.mjs 不经本文件，直引 backend/geo-dict/src/reference-data/index.ts。
// 依据：ADR 0016（docs/adr/0016-参照数据随种子只追加写入.md）；依赖矩阵 backend/README.md。
// 空间字典模块公共出口（#47/#51 定案：跨模块消费只许经本文件；内部路径导入由结构测试
// module-public-entry 拦截）。#54 空间能力：统一坐标口径（CGCS2000/EPSG:4490 + 来源坐标
// 保留）与法域定几何存取（土地/矿产=面，测绘/规划=点）。
export { CGCS2000_SRID } from './spatial/constants.ts';
export { sourceToCgcs2000, cgcs2000ToSource } from './spatial/coordinate-reference.ts';
export type { SqlClient } from './spatial/sql-client.ts';
export {
  insertLandBoundary,
  findLandBoundaryById,
  deleteLandBoundaryById,
} from './spatial/land-boundary.ts';
export type { LandBoundaryDomain, LandBoundaryInput, LandBoundaryRow } from './spatial/land-boundary.ts';
export {
  insertSurveyPoint,
  findSurveyPointById,
  deleteSurveyPointById,
} from './spatial/survey-point.ts';
export type { SurveyPointDomain, SurveyPointInput, SurveyPointRow } from './spatial/survey-point.ts';
// 参照数据（ADR 0016；#210）：来源编码、违法类型编码、依据文件、类型依据、辖区对应的初值常量。
export {
  DISPATCH_GUIDANCE,
  DOCUMENTS,
  JURISDICTION_ROWS,
  SOURCE_CODES,
  VIOLATION_TYPES,
  VIOLATION_TYPE_BASIS,
  findDocument,
  findSourceCode,
  findSourceGroupCode,
  findViolationType,
} from './reference-data/index.ts';
export type { DocumentRow, SourceCodeRow, ViolationTypeRow } from './reference-data/index.ts';
// 辖区对应的运行期读取（#214 辖区建议）：街道编码 → 机构，只追加表取最新有效版。
export { listActiveJurisdictionRows } from './reference-data/jurisdiction-lookup.ts';
export type { JurisdictionRow } from './reference-data/jurisdiction-lookup.ts';
export { GeoDictModule } from './geo-dict.module.ts';
