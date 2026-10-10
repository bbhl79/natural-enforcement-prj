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
