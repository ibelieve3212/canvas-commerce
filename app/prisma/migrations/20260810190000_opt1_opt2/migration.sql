-- DropIndex
DROP INDEX "Composition_assetId_key";

-- DropIndex
DROP INDEX "Composition_assetId_idx";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Composition";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Asset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "jobId" TEXT,
    "parentAssetId" TEXT,
    "sourceUploadId" TEXT,
    "objectKey" TEXT NOT NULL,
    "thumbnailKey" TEXT,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Asset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Asset_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "GenerationJob" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Asset_sourceUploadId_fkey" FOREIGN KEY ("sourceUploadId") REFERENCES "Upload" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Asset_parentAssetId_fkey" FOREIGN KEY ("parentAssetId") REFERENCES "Asset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Asset" ("byteSize", "createdAt", "height", "id", "isFavorite", "jobId", "metadataJson", "mimeType", "objectKey", "sourceUploadId", "thumbnailKey", "userId", "width") SELECT "byteSize", "createdAt", "height", "id", "isFavorite", "jobId", "metadataJson", "mimeType", "objectKey", "sourceUploadId", "thumbnailKey", "userId", "width" FROM "Asset";
DROP TABLE "Asset";
ALTER TABLE "new_Asset" RENAME TO "Asset";
CREATE UNIQUE INDEX "Asset_jobId_key" ON "Asset"("jobId");
CREATE INDEX "Asset_userId_idx" ON "Asset"("userId");
CREATE INDEX "Asset_jobId_idx" ON "Asset"("jobId");
CREATE INDEX "Asset_parentAssetId_idx" ON "Asset"("parentAssetId");
CREATE TABLE "new_GenerationBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "parentBatchId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "inputSnapshotJson" TEXT NOT NULL,
    "templateSnapshotJson" TEXT NOT NULL,
    "requestedCount" INTEGER NOT NULL,
    "succeededCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "canceledCount" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT,
    "aspectRatio" TEXT NOT NULL DEFAULT '1:1',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    CONSTRAINT "GenerationBatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GenerationBatch_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GenerationBatch_parentBatchId_fkey" FOREIGN KEY ("parentBatchId") REFERENCES "GenerationBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_GenerationBatch" ("applicationId", "aspectRatio", "canceledCount", "completedAt", "createdAt", "failedCount", "id", "idempotencyKey", "inputSnapshotJson", "parentBatchId", "requestedCount", "startedAt", "status", "succeededCount", "templateSnapshotJson", "userId") SELECT "applicationId", "aspectRatio", "canceledCount", "completedAt", "createdAt", "failedCount", "id", "idempotencyKey", "inputSnapshotJson", "parentBatchId", "requestedCount", "startedAt", "status", "succeededCount", "templateSnapshotJson", "userId" FROM "GenerationBatch";
DROP TABLE "GenerationBatch";
ALTER TABLE "new_GenerationBatch" RENAME TO "GenerationBatch";
CREATE INDEX "GenerationBatch_userId_idx" ON "GenerationBatch"("userId");
CREATE INDEX "GenerationBatch_applicationId_idx" ON "GenerationBatch"("applicationId");
CREATE INDEX "GenerationBatch_status_idx" ON "GenerationBatch"("status");
CREATE INDEX "GenerationBatch_parentBatchId_idx" ON "GenerationBatch"("parentBatchId");
CREATE UNIQUE INDEX "GenerationBatch_userId_idempotencyKey_key" ON "GenerationBatch"("userId", "idempotencyKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

