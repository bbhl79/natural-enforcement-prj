-- 迁移历史第一条必须是 CREATE EXTENSION postgis（infra/VERSIONS.md 执行纪律 1）：
-- shadow database 识别 geometry 类型的前提（Prisma 维护者官方口径 prisma/prisma#7455）。
CREATE EXTENSION IF NOT EXISTS postgis;
