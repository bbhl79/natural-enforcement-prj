// 用途：定义统一坐标口径的 SRID 常量 CGCS2000_SRID（EPSG:4490），供几何入库与坐标换算引用。
// 调用方：backend/geo-dict/src/spatial 下的 coordinate-reference.ts、land-boundary.ts、survey-point.ts；
//   外部经公共出口引用，例如 integration/e4-coordinate-roundtrip.test.ts。
// 统一坐标口径常量（#54）：CGCS2000 地理坐标系 EPSG:4490，全系统唯一坐标口径载体
//（来源坐标仅作原样保留的第二字段，不构成第二种口径）。
export const CGCS2000_SRID = 4490;
