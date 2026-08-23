/**
 * 导出服务：ZIP 打包、长图拼接、单图导出。
 */
import { prisma } from "@/server/db/client";
import { getStorage, makeObjectKey } from "@/server/storage/adapter";
import os from "node:os";
import path from "node:path";
import * as fs from "node:fs/promises";
import sharp from "sharp";

/** 导出批次中所有成功图为 ZIP */
export async function exportBatchZip(
  batchId: string,
  userId: string,
): Promise<{ exportId: string; objectKey: string }> {
  const batch = await prisma.generationBatch.findUnique({
    where: { id: batchId },
    include: { jobs: { include: { asset: true }, orderBy: { outputIndex: "asc" } } },
  });
  if (!batch) throw new Error("BATCH_NOT_FOUND");
  if (batch.userId !== userId) throw new Error("FORBIDDEN");

  const jobs = batch.jobs.filter((j) => j.status === "succeeded" && j.asset);
  if (jobs.length === 0) throw new Error("NO_ASSETS");

  const record = await prisma.export.create({
    data: { userId, batchId, type: "ZIP", status: "running" },
  });

  try {
    const storage = getStorage();

    // 下载所有图到临时目录
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cc-export-"));
    const files: { filename: string; buffer: Buffer }[] = [];

    for (const job of jobs) {
      const buf = await storage.get(job.asset!.objectKey);
      const ext = job.asset!.mimeType === "image/png" ? "png" : "jpg";
      const filename = `${batch.id.slice(-8)}-${job.outputIndex + 1}.${ext}`;
      files.push({ filename, buffer: buf });
    }

    // 添加 manifest.json
    const manifest = {
      batchId: batch.id,
      exportedAt: new Date().toISOString(),
      totalFiles: files.length,
      files: files.map((f, i) => ({
        filename: f.filename,
        outputIndex: jobs[i].outputIndex,
        outputRole: jobs[i].outputRole,
      })),
    };
    files.push({
      filename: "manifest.json",
      buffer: Buffer.from(JSON.stringify(manifest, null, 2), "utf-8"),
    });

    const zipBuffer = await buildZip(files);

    // 存储 ZIP
    const objectKey = makeObjectKey(userId, "zip");
    await storage.put(objectKey, zipBuffer);

    await prisma.export.update({
      where: { id: record.id },
      data: { status: "succeeded", objectKey },
    });

    // 清理临时目录
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});

    return { exportId: record.id, objectKey };
  } catch (err) {
    await prisma.export.update({
      where: { id: record.id },
      data: { status: "failed", errorMessage: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }
}

/** 拼接批次所有成功图为长图（垂直排列） */
export async function exportBatchLongImage(
  batchId: string,
  userId: string,
): Promise<{ exportId: string; objectKey: string }> {
  const batch = await prisma.generationBatch.findUnique({
    where: { id: batchId },
    include: { jobs: { include: { asset: true }, orderBy: { outputIndex: "asc" } } },
  });
  if (!batch) throw new Error("BATCH_NOT_FOUND");
  if (batch.userId !== userId) throw new Error("FORBIDDEN");

  const jobs = batch.jobs.filter((j) => j.status === "succeeded" && j.asset);
  if (jobs.length === 0) throw new Error("NO_ASSETS");

  const record = await prisma.export.create({
    data: { userId, batchId, type: "LONG_IMAGE", status: "running" },
  });

  try {
    const storage = getStorage();

    // 统一宽度为最大宽度，按比例缩放后垂直拼接
    const images: { buffer: Buffer; width: number; height: number }[] = [];
    let maxWidth = 0;

    for (const job of jobs) {
      const buf = await storage.get(job.asset!.objectKey);
      const meta = await sharp(buf).metadata();
      const width = meta.width ?? 1024;
      const height = meta.height ?? 1024;
      images.push({ buffer: buf, width, height });
      if (width > maxWidth) maxWidth = width;
    }

    // 缩放所有图到统一宽度
    const resized: Buffer[] = [];
    let totalHeight = 0;
    for (const img of images) {
      const scale = maxWidth / img.width;
      const newHeight = Math.round(img.height * scale);
      const r = await sharp(img.buffer).resize({ width: maxWidth, height: newHeight }).png().toBuffer();
      resized.push(r);
      totalHeight += newHeight;
    }

    // 限制长图总高度（防止过大）
    const MAX_HEIGHT = 16384;
    if (totalHeight > MAX_HEIGHT) {
      // 等比缩放
      const scale = MAX_HEIGHT / totalHeight;
      const newWidth = Math.round(maxWidth * scale);
      totalHeight = MAX_HEIGHT;
      maxWidth = newWidth;
      for (let i = 0; i < resized.length; i++) {
        const meta = await sharp(resized[i]).metadata();
        const newH = Math.round((meta.height ?? 0) * scale);
        resized[i] = await sharp(resized[i]).resize({ width: maxWidth, height: newH }).png().toBuffer();
      }
    }

    // 垂直拼接
    const compositeOps: { input: Buffer; top: number; left: number }[] = [];
    let topOffset = 0;
    for (const buf of resized) {
      compositeOps.push({ input: buf, top: topOffset, left: 0 });
      const meta = await sharp(buf).metadata();
      topOffset += meta.height ?? 0;
    }

    // 用 sharp composite 拼接
    let result = sharp({ create: { width: maxWidth, height: totalHeight, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } });
    result = result.composite(compositeOps);
    const finalBuffer = await result.png().toBuffer();

    const objectKey = makeObjectKey(userId, "png");
    await storage.put(objectKey, finalBuffer);

    await prisma.export.update({
      where: { id: record.id },
      data: { status: "succeeded", objectKey },
    });

    return { exportId: record.id, objectKey };
  } catch (err) {
    await prisma.export.update({
      where: { id: record.id },
      data: { status: "failed", errorMessage: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }
}

/** 获取用户导出列表 */
export async function listExports(userId: string) {
  return prisma.export.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

// ---------- ZIP 构造（无外部依赖，Store 模式不压缩） ----------

interface ZipEntry { filename: string; buffer: Buffer; }

async function buildZip(entries: ZipEntry[]): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const centralDir: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.filename, "utf-8");
    const crc = crc32(entry.buffer);
    const size = entry.buffer.length;

    // Local file header
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0, 6); // flags
    localHeader.writeUInt16LE(0, 8); // compression: store
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0, 12); // mod date
    localHeader.writeUInt32LE(crc, 14); // crc32
    localHeader.writeUInt32LE(size, 18); // compressed size
    localHeader.writeUInt32LE(size, 22); // uncompressed size
    localHeader.writeUInt16LE(nameBuf.length, 26); // filename length
    localHeader.writeUInt16LE(0, 28); // extra field length

    const localData = Buffer.concat([localHeader, nameBuf, entry.buffer]);
    chunks.push(localData);

    // Central directory header
    const cdHeader = Buffer.alloc(46);
    cdHeader.writeUInt32LE(0x02014b50, 0); // signature
    cdHeader.writeUInt16LE(20, 4); // version made by
    cdHeader.writeUInt16LE(20, 6); // version needed
    cdHeader.writeUInt16LE(0, 8); // flags
    cdHeader.writeUInt16LE(0, 10); // compression
    cdHeader.writeUInt16LE(0, 12); // mod time
    cdHeader.writeUInt16LE(0, 14); // mod date
    cdHeader.writeUInt32LE(crc, 16); // crc32
    cdHeader.writeUInt32LE(size, 20); // compressed size
    cdHeader.writeUInt32LE(size, 24); // uncompressed size
    cdHeader.writeUInt16LE(nameBuf.length, 28); // filename length
    cdHeader.writeUInt16LE(0, 30); // extra field length
    cdHeader.writeUInt16LE(0, 32); // comment length
    cdHeader.writeUInt16LE(0, 34); // disk number
    cdHeader.writeUInt16LE(0, 36); // internal attrs
    cdHeader.writeUInt32LE(0, 38); // external attrs
    cdHeader.writeUInt32LE(offset, 42); // local header offset
    centralDir.push(Buffer.concat([cdHeader, nameBuf]));

    offset += localData.length;
  }

  const cdData = Buffer.concat(centralDir);
  const cdOffset = offset;

  // End of central directory
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // signature
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with CD
  eocd.writeUInt16LE(entries.length, 8); // entries on disk
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(cdData.length, 12); // CD size
  eocd.writeUInt32LE(cdOffset, 16); // CD offset
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...chunks, cdData, eocd]);
}

// CRC32 table
const CRC_TABLE: number[] = (() => {
  const table = new Array<number>(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
