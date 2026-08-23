-- 删 Upload.deletedAt。
--
-- OPT-2 把删除改成物理删除时只处理了 Asset 和 GenerationBatch，漏了 Upload。
-- 该字段从未被任何代码写入过，唯一的读取点（uploads 去重查询的 `deletedAt: null`）
-- 因此恒为真，属死代码。上传图现已纳入自动清理（与资产共用保留期/数量上限）。
--
-- SQLite 不支持 DROP COLUMN with constraints，按 Prisma 惯例走重建表。
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Upload" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "thumbnailKey" TEXT,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sha256" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Upload_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_Upload" ("byteSize", "createdAt", "height", "id", "mimeType", "objectKey", "originalName", "sha256", "thumbnailKey", "userId", "width")
SELECT "byteSize", "createdAt", "height", "id", "mimeType", "objectKey", "originalName", "sha256", "thumbnailKey", "userId", "width" FROM "Upload";

DROP TABLE "Upload";
ALTER TABLE "new_Upload" RENAME TO "Upload";

CREATE INDEX "Upload_userId_idx" ON "Upload"("userId");
CREATE INDEX "Upload_sha256_idx" ON "Upload"("sha256");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
