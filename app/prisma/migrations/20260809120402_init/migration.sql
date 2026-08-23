/*
  Warnings:

  - A unique constraint covering the columns `[assetId]` on the table `Composition` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Upload" ADD COLUMN "thumbnailKey" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN "providerApiKey" TEXT;
ALTER TABLE "User" ADD COLUMN "providerBaseUrl" TEXT;
ALTER TABLE "User" ADD COLUMN "providerModel" TEXT;

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Composition_assetId_key" ON "Composition"("assetId");
