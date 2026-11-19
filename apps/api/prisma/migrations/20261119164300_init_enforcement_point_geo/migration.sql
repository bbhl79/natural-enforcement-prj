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

-- CreateTable
CREATE TABLE "EvidenceRecord" (
    "id" TEXT NOT NULL,
    "pointId" INTEGER,
    "bucket" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "bytes" INTEGER,
    "sha256" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvidenceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EnforcementPoint_name_key" ON "EnforcementPoint"("name");

-- CreateIndex
CREATE INDEX "EvidenceRecord_status_idx" ON "EvidenceRecord"("status");

-- AddForeignKey
ALTER TABLE "EvidenceRecord" ADD CONSTRAINT "EvidenceRecord_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "EnforcementPoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddPostGIS: GiST 空间索引（ST_DWithin 半径查询走此索引）
CREATE INDEX "EnforcementPoint_location_idx" ON "EnforcementPoint" USING GIST ("location");
