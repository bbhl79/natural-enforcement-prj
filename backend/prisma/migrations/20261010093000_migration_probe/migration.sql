-- CreateTable
CREATE TABLE "migration_probe" (
    "id" SERIAL NOT NULL,
    "note" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "migration_probe_pkey" PRIMARY KEY ("id")
);
