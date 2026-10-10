-- 空间字典空间能力（#54）：法域定几何——土地/矿产=面（Polygon），测绘/规划=点（Point）。
-- 统一坐标口径载体 = EPSG:4490（CGCS2000 地理坐标系）：geom 列经 ST_Transform 落库为 4490；
-- 来源坐标原样保留（source_srid + source_geom），不构成第二种口径。
-- 法域→几何类型映射由 geometry 类型修饰符 + CHECK 约束在库内承载。
CREATE TABLE "geo_dict_land_boundary" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "geom" geometry(Polygon,4490) NOT NULL,
    "source_srid" INTEGER NOT NULL,
    "source_geom" geometry NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "geo_dict_land_boundary_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "geo_dict_land_boundary_domain_check" CHECK ("domain" IN ('land', 'mineral'))
);

CREATE TABLE "geo_dict_survey_point" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "geom" geometry(Point,4490) NOT NULL,
    "source_srid" INTEGER NOT NULL,
    "source_geom" geometry NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "geo_dict_survey_point_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "geo_dict_survey_point_domain_check" CHECK ("domain" IN ('survey', 'planning'))
);
