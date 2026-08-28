/**
 * 微调 Service（OPT-1）。
 *
 * 流程：轮次检查 → 找回产品图 → 拼 prompt（生成图作 image + 产品图作 image[] +
 * 微调描述）→ 调 provider edits → 存新 Asset（parentAssetId 指向原图）。
 */
import { prisma } from "@/server/db/client";
import { getStorage, makeObjectKey } from "@/server/storage/adapter";
import { generateThumbnail } from "@/server/storage/thumbnail";
import { getProviderForUser } from "@/server/provider";
import type { ProviderReferenceImage } from "@/server/provider/types";

const MAX_TWEAK_DEPTH = 3;

/**
 * 从被微调的 Asset 沿 parentAssetId 向上追溯到根节点，深度 = 微调轮次。
 * 超过 MAX_TWEAK_DEPTH 则拒绝。
 */
async function getTweakDepth(assetId: string): Promise<number> {
  let depth = 0;
  let currentId: string = assetId;
  while (currentId) {
    const row: { parentAssetId: string | null } | null = await prisma.asset.findUnique({
      where: { id: currentId },
      select: { parentAssetId: true },
    });
    if (!row) break;
    if (row.parentAssetId) {
      depth++;
      currentId = row.parentAssetId;
    } else {
      break;
    }
  }
  return depth;
}

/**
 * 从 Asset 追溯到根 Asset → Job → inputSnapshot → 找回 product 参考图。
 *
 * 返回 `missing` 计数：快照里记了 uploadId 但 Upload 记录已不在（被自动清理）。
 * `inputSnapshotJson` 里的 uploadId 是 JSON 文本，无外键约束，所以上传图被清理后
 * 这里会查不到。旧实现是静默跳过——照样出图，但已不参考
 * 原始商品图，用户看不出为什么效果变差。现在交由调用方明确报错。
 */
async function findProductImages(
  assetId: string,
): Promise<{ images: { objectKey: string; mimeType: string }[]; missing: number }> {
  let rootAssetId = assetId;
  let currentId: string = assetId;
  while (currentId) {
    const row: { id: string; parentAssetId: string | null } | null = await prisma.asset.findUnique({
      where: { id: currentId },
      select: { id: true, parentAssetId: true },
    });
    if (!row) break;
    if (row.parentAssetId) {
      rootAssetId = row.parentAssetId;
      currentId = row.parentAssetId;
    } else {
      rootAssetId = row.id;
      currentId = "";
    }
  }

  // 根 Asset → Job → Batch → inputSnapshot
  const rootAsset = await prisma.asset.findUnique({
    where: { id: rootAssetId },
    select: { jobId: true },
  });
  if (!rootAsset?.jobId) return { images: [], missing: 0 };

  const job = await prisma.generationJob.findUnique({
    where: { id: rootAsset.jobId },
    select: { batchId: true },
  });
  if (!job?.batchId) return { images: [], missing: 0 };

  const batch = await prisma.generationBatch.findUnique({
    where: { id: job.batchId },
    select: { inputSnapshotJson: true, userId: true },
  });
  if (!batch) return { images: [], missing: 0 };

  const snapshot = JSON.parse(batch.inputSnapshotJson) as {
    referenceImages?: { uploadId: string; role: string }[];
  };
  const productRefs = (snapshot.referenceImages ?? []).filter(r => r.role === "product");

  const uploads = await prisma.upload.findMany({
    where: { id: { in: productRefs.map(r => r.uploadId) } },
    select: { objectKey: true, mimeType: true },
  });

  return { images: uploads, missing: productRefs.length - uploads.length };
}

export interface TweakResult {
  assetId: string;
  imageUrl: string;
}

export async function tweakAsset(
  assetId: string,
  userId: string,
  description: string,
): Promise<TweakResult> {
  // 1. 查原图
  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    select: { id: true, userId: true, objectKey: true, mimeType: true, jobId: true },
  });
  if (!asset) throw new Error("ASSET_NOT_FOUND");
  if (asset.userId !== userId) throw new Error("FORBIDDEN");

  // 2. 轮次检查
  const depth = await getTweakDepth(assetId);
  if (depth >= MAX_TWEAK_DEPTH) {
    throw new Error("TWEAK_LIMIT_EXCEEDED");
  }

  // 3. 读原图二进制
  const storage = getStorage();
  const originalBuffer = await storage.get(asset.objectKey);

  // 4. 找回产品图（最多 4 张，作为 image[]）
  //    参考图被自动清理掉时必须报错：静默降级会让用户拿到一张
  //    没参考原商品图的结果，而且无法得知原因。
  const { images: productImages, missing: missingRefs } = await findProductImages(assetId);
  if (missingRefs > 0) {
    throw new Error("REFERENCE_IMAGE_MISSING");
  }
  const providerRefImages: ProviderReferenceImage[] = [];

  // 生成图作为 image（主图）
  providerRefImages.push({
    buffer: originalBuffer,
    mimeType: asset.mimeType,
    role: "product", // 主图占 product 位置
    uploadId: undefined,
  });

  // 产品图作为 image[]（额外参考），最多 4 张
  for (let i = 0; i < Math.min(productImages.length, 4); i++) {
    const p = productImages[i];
    // 记录在但文件不在（异常状态），同样不能静默降级
    const buf = await storage.get(p.objectKey).catch(() => null);
    if (!buf) {
      throw new Error("REFERENCE_IMAGE_MISSING");
    }
    providerRefImages.push({
      buffer: buf,
      mimeType: p.mimeType,
      role: "style", // 参考图占 style 位置
      uploadId: undefined,
    });
  }

  // 5. 拼 prompt
  const prompt = `基于当前图片进行微调。用户的需求是：${description}。请保留原图的整体风格和布局，只做局部调整。`;

  // 6. 调 Provider
  const provider = await getProviderForUser(userId);
  const result = await provider.generate({
    prompt,
    aspectRatio: "1:1", // 微调固定 1:1，因为原图就是这个比例
    outputFormat: "png",
    referenceImages: providerRefImages,
    metadata: { batchId: "", jobId: "", outputRole: "tweak" },
  });

  // 7. 存新 Asset
  const objectKey = makeObjectKey(userId, "png");
  await storage.put(objectKey, result.imageBuffer);

  const thumbnailKey = await generateThumbnail(userId, objectKey, result.imageBuffer, result.mimeType);

  const newAsset = await prisma.asset.create({
    data: {
      userId,
      jobId: null, // 微调不创建 Job
      parentAssetId: assetId, // 指向被微调的图
      objectKey,
      thumbnailKey,
      mimeType: result.mimeType,
      byteSize: result.imageBuffer.length,
      width: result.width,
      height: result.height,
      metadataJson: JSON.stringify({
        revisedPrompt: result.revisedPrompt,
        provider: provider.name,
        tweakDescription: description,
        tweakDepth: depth + 1,
      }),
    },
  });

  return {
    assetId: newAsset.id,
    imageUrl: `/api/storage/${encodeURIComponent(objectKey)}`,
  };
}
