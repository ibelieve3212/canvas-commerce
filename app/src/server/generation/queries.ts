/**
 * 批次查询服务：列表、筛选、分页、取消、彻底删除。
 *
 * OPT-2: 软删除 → 物理删除（删文件 + 删记录 + 递归删子节点）。
 * 所有查询去掉 deletedAt: null 过滤（记录删除即不存在）。
 */
import { prisma } from "@/server/db/client";
import { getStorage } from "@/server/storage/adapter";
import type { Prisma } from "@prisma/client";

export interface BatchListQuery {
  status?: string;
  applicationId?: string;
  page?: number;
  pageSize?: number;
}

export async function listBatches(
  userId: string,
  query: BatchListQuery,
) {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, query.pageSize ?? 12));
  const skip = (page - 1) * pageSize;

  const where: Prisma.GenerationBatchWhereInput = {
    userId,
  };
  if (query.status && query.status !== "all") {
    where.status = query.status as Prisma.EnumBatchStatusFilter;
  }
  if (query.applicationId && query.applicationId !== "all") {
    where.applicationId = query.applicationId;
  }

  const [items, total] = await Promise.all([
    prisma.generationBatch.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      include: {
        application: { select: { id: true, name: true, slug: true, emojiIcon: true } },
        jobs: {
          orderBy: { outputIndex: "asc" },
          select: {
            id: true,
            outputIndex: true,
            outputRole: true,
            status: true,
            errorCode: true,
            errorMessage: true,
            asset: { select: { id: true, objectKey: true, thumbnailKey: true, width: true, height: true } },
          },
        },
        childBatches: { select: { id: true, createdAt: true, status: true } },
      },
    }),
    prisma.generationBatch.count({ where }),
  ]);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

// ── 物理删除辅助 ──

/** 递归删除 Asset 子树：先删所有子节点，再删自身文件和记录 */
async function deleteAssetTree(assetId: string): Promise<void> {
  // 查子节点
  const children = await prisma.asset.findMany({
    where: { parentAssetId: assetId },
    select: { id: true },
  });
  for (const child of children) {
    await deleteAssetTree(child.id);
  }

  // 删自身
  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    select: { objectKey: true, thumbnailKey: true, jobId: true },
  });
  if (!asset) return;

  // 删文件
  const storage = getStorage();
  await storage.delete(asset.objectKey).catch(() => {});
  if (asset.thumbnailKey) {
    await storage.delete(asset.thumbnailKey).catch(() => {});
  }

  // 删 Job（1:1 关系，Asset 删时 Job 留空壳无意义）
  if (asset.jobId) {
    await prisma.generationJob.delete({ where: { id: asset.jobId } }).catch(() => {});
  }

  // 删 Asset 记录
  await prisma.asset.delete({ where: { id: assetId } }).catch(() => {});
}

/** 彻底删除批次：Batch → Jobs → Assets（含微调子树）→ 文件全删 */
export async function hardDeleteBatch(batchId: string, userId: string) {
  const batch = await prisma.generationBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new Error("BATCH_NOT_FOUND");
  if (batch.userId !== userId) throw new Error("FORBIDDEN");

  // 查所有 Job 下的根 Asset（parentAssetId = null）
  const jobs = await prisma.generationJob.findMany({
    where: { batchId },
    select: { id: true, asset: { select: { id: true } } },
  });

  // 递归删每个 Asset 子树
  for (const job of jobs) {
    if (job.asset?.id) {
      await deleteAssetTree(job.asset.id);
    }
  }

  // 删 Batch（Jobs 会被 Cascade 删掉）
  await prisma.generationBatch.delete({ where: { id: batchId } });
}

/** 彻底删除单张资产（含微调子节点） */
export async function hardDeleteAsset(assetId: string, userId: string) {
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw new Error("ASSET_NOT_FOUND");
  if (asset.userId !== userId) throw new Error("FORBIDDEN");

  // 统计子节点数量（含递归）
  async function countDescendants(id: string): Promise<number> {
    const children = await prisma.asset.findMany({
      where: { parentAssetId: id },
      select: { id: true },
    });
    let total = children.length;
    for (const child of children) {
      total += await countDescendants(child.id);
    }
    return total;
  }
  const childCount = await countDescendants(assetId);

  // 递归删子树
  await deleteAssetTree(assetId);

  return { deletedCount: childCount + 1 };
}

/** 获取版本链（parent + siblings） */
export async function getVersionChain(batchId: string, userId: string) {
  const batch = await prisma.generationBatch.findUnique({
    where: { id: batchId },
    include: {
      parentBatch: {
        select: {
          id: true,
          createdAt: true,
          status: true,
          requestedCount: true,
          succeededCount: true,
          jobs: {
            orderBy: { outputIndex: "asc" },
            select: {
              id: true,
              outputIndex: true,
              outputRole: true,
              status: true,
              asset: { select: { id: true, objectKey: true, thumbnailKey: true } },
            },
          },
        },
      },
      childBatches: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          createdAt: true,
          status: true,
          requestedCount: true,
          succeededCount: true,
          jobs: {
            orderBy: { outputIndex: "asc" },
            select: {
              id: true,
              outputIndex: true,
              outputRole: true,
              status: true,
              asset: { select: { id: true, objectKey: true, thumbnailKey: true } },
            },
          },
        },
      },
    },
  });

  if (!batch) throw new Error("BATCH_NOT_FOUND");
  if (batch.userId !== userId) throw new Error("FORBIDDEN");

  return batch;
}

/** 获取资产列表（用户所有成功图片，含微调结果） */
export async function listAssets(
  userId: string,
  query: { batchId?: string; favoriteOnly?: boolean; page?: number; pageSize?: number },
) {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 24));
  const skip = (page - 1) * pageSize;

  const where: Prisma.AssetWhereInput = {
    userId,
  };
  if (query.batchId) {
    where.job = { batchId: query.batchId };
  }
  if (query.favoriteOnly) {
    where.isFavorite = true;
  }

  const [items, total] = await Promise.all([
    prisma.asset.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      include: {
        job: {
          select: {
            id: true,
            batchId: true,
            outputIndex: true,
            outputRole: true,
            batch: { select: { applicationId: true, application: { select: { name: true, slug: true } } } },
          },
        },
      },
    }),
    prisma.asset.count({ where }),
  ]);

  return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

/** 切换资产收藏 */
export async function toggleAssetFavorite(assetId: string, userId: string) {
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw new Error("ASSET_NOT_FOUND");
  if (asset.userId !== userId) throw new Error("FORBIDDEN");

  const updated = await prisma.asset.update({
    where: { id: assetId },
    data: { isFavorite: !asset.isFavorite },
  });
  return { isFavorite: updated.isFavorite };
}
