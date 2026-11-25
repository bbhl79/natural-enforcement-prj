-- AddPostGIS: 扩展必须最先（列类型依赖它；shadow database 会完整重放本历史）
CREATE EXTENSION IF NOT EXISTS postgis;

-- CreateTable
CREATE TABLE "EnforcementPoint" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "location" geography(Point,4326),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnforcementPoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EnforcementPoint_name_key" ON "EnforcementPoint"("name");

-- AddPostGIS: GiST 空间索引（ST_DWithin 半径查询走此索引）
CREATE INDEX "EnforcementPoint_location_idx" ON "EnforcementPoint" USING GIST ("location");
