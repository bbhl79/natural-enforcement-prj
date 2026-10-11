-- 迁移/种子通道探针表（#49）。
-- 主键 = TEXT 技术主键（#16 §1.1：ULID，应用侧生成，与 0002_identity_org、geo_dict 同形制——
-- 评审必修 C8 就地改正自增 Int，保持迁移链整洁；先例见提交 6f2da16）。
CREATE TABLE "migration_probe" (
    "id" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "migration_probe_pkey" PRIMARY KEY ("id")
);
