-- QuotaReservation.batchId 的外键从 RESTRICT 改为 CASCADE。
--
-- 原状态下删除任何批次都会失败：createBatch 给每个批次必建一条 reservation，
-- RESTRICT 把批次永久钉死。而 hardDeleteBatch 是「先删资产和磁盘文件、最后删批次」，
-- 且没有事务包裹，所以失败时文件已经删掉、批次记录还在，
-- 留下一条"N/N 成功"但图全打不开的僵尸批次，且用户无法自愈。
--
-- 配额语义由 hardDeleteBatch 在删除前显式结算（PENDING reservation 先退还未用额度），
-- 不依赖这条外键做保护——RESTRICT 从来没有起到保护作用，只是让删除彻底不可用。
--
-- SQLite 不支持 ALTER 约束，按 Prisma 惯例重建表。
-- 注意：migrate runner 在事务内执行本文件，PRAGMA foreign_keys 在事务中无效，
-- 靠 defer_foreign_keys 保证重建期间的外键检查推迟到提交时。
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_QuotaReservation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "reservedCount" INTEGER NOT NULL,
    "settledCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" DATETIME,
    CONSTRAINT "QuotaReservation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuotaReservation_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "GenerationBatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_QuotaReservation" ("batchId", "createdAt", "id", "reservedCount", "settledAt", "settledCount", "status", "userId")
SELECT "batchId", "createdAt", "id", "reservedCount", "settledAt", "settledCount", "status", "userId" FROM "QuotaReservation";

DROP TABLE "QuotaReservation";
ALTER TABLE "new_QuotaReservation" RENAME TO "QuotaReservation";

CREATE UNIQUE INDEX "QuotaReservation_batchId_key" ON "QuotaReservation"("batchId");
CREATE INDEX "QuotaReservation_userId_idx" ON "QuotaReservation"("userId");
CREATE INDEX "QuotaReservation_status_idx" ON "QuotaReservation"("status");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
