/**
 * 批次查询服务：列表、筛选、分页、版本链、资产列表。
 *
 * 删除只做「归属校验 + 委托」——实际删除机制在 `server/deletion/service.ts`
 * 统一实现（详见 `docs/v2/12-DELETION-REFACTOR.md`）。
 */
import { prisma } from "@/server/db/client";
import {
  deleteAssetSubtrees,
  deleteBatchCascade,
} from "@/server/deletion/service";
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

// ── 彻底删除（归属校验 + 委托统一删除层）──

/** 彻底删除批次（含所有 Job、Asset 微调子树、文件）。 */
export async function hardDeleteBatch(batchId: string, userId: string) {
  const batch = await prisma.generationBatch.findUnique({
    where: { id: batchId },
    select: { userId: true },
  });
  if (!batch) throw new Error("BATCH_NOT_FOUND");
  if (batch.userId !== userId) throw new Error("FORBIDDEN");

  await deleteBatchCascade(batchId);
}

/** 彻底删除单张资产（含微调子树）。 */
export async function hardDeleteAsset(assetId: string, userId: string) {
  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    select: { userId: true },
  });
  if (!asset) throw new Error("ASSET_NOT_FOUND");
  if (asset.userId !== userId) throw new Error("FORBIDDEN");

  return deleteAssetSubtrees([assetId]);
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

  // 附上微调后代数量：删除确认弹窗要提示"该图有 N 张微调版本将一并删除"，
  // 而 N 必须在删之前就知道（删完再报数用户已经没法反悔了）
  const descendantCounts = await countDescendants(items.map((a) => a.id));
  const itemsWithCount = items.map((a) => ({
    ...a,
    descendantCount: descendantCounts.get(a.id) ?? 0,
  }));

  return { items: itemsWithCount, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

/**
 * 批量统计每个资产的微调后代数量（含各层子孙，不含自身）。
 * 逐层查，避免对每个资产递归造成 N+1。
 */
export async function countDescendants(rootIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>(rootIds.map((id) => [id, 0]));
  if (rootIds.length === 0) return counts;

  // 每一层的节点都记住它属于哪个根，这样后代数能累加回根上
  let frontier = new Map<string, string>(rootIds.map((id) => [id, id]));
  while (frontier.size > 0) {
    const children = await prisma.asset.findMany({
      where: { parentAssetId: { in: [...frontier.keys()] } },
      select: { id: true, parentAssetId: true },
    });
    if (children.length === 0) break;

    const next = new Map<string, string>();
    for (const c of children) {
      const root = frontier.get(c.parentAssetId!);
      if (!root) continue;
      counts.set(root, (counts.get(root) ?? 0) + 1);
      next.set(c.id, root);
    }
    frontier = next;
  }
  return counts;
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

// ── 管理员存储清理（OPT-2 第四节）──
// 以下函数不校验 userId，调用方必须先确认是 ADMIN。

export interface AdminStorageQuery {
  userId?: string;
  /** 只返回此日期之前创建的资产（含）。用于"7 天前""30 天前"筛选。 */
  createdBefore?: Date;
  page?: number;
  pageSize?: number;
}

/** 管理员视角的资产列表（跨用户）。 */
export async function listAssetsForAdmin(query: AdminStorageQuery) {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 24));
  const skip = (page - 1) * pageSize;

  const where: Prisma.AssetWhereInput = {};
  if (query.userId) where.userId = query.userId;
  if (query.createdBefore) where.createdAt = { lt: query.createdBefore };

  const [items, total] = await Promise.all([
    prisma.asset.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      select: {
        id: true,
        userId: true,
        objectKey: true,
        thumbnailKey: true,
        mimeType: true,
        byteSize: true,
        width: true,
        height: true,
        isFavorite: true,
        createdAt: true,
        job: {
          select: {
            batch: { select: { application: { select: { name: true, slug: true } } } },
          },
        },
      },
    }),
    prisma.asset.count({ where }),
  ]);

  // 附上用户名（一次性查、避免 N+1）
  const userIds = [...new Set(items.map((a) => a.userId))];
  const users =
    userIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, username: true, name: true },
        })
      : [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  const itemsWithUser = items.map((a) => ({
    ...a,
    user: userMap.get(a.userId) ?? { username: "(未知)", name: "(未知)" },
  }));

  return { items: itemsWithUser, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

/** 各用户存储概览（资产数量 + 字节数）。 */
export async function getStorageOverviewForAdmin() {
  const [byUser, totals] = await Promise.all([
    prisma.asset.groupBy({
      by: ["userId"],
      _count: { id: true },
      _sum: { byteSize: true },
    }),
    Promise.all([
      prisma.asset.aggregate({ _count: { id: true }, _sum: { byteSize: true } }),
      prisma.upload.aggregate({ _count: { id: true }, _sum: { byteSize: true } }),
    ]),
  ]);

  const userIds = byUser.map((g) => g.userId);
  const users =
    userIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, username: true, name: true, role: true },
        })
      : [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  return {
    totalAssets: totals[0]._count.id,
    totalAssetBytes: totals[0]._sum.byteSize ?? 0,
    totalUploads: totals[1]._count.id,
    totalUploadBytes: totals[1]._sum.byteSize ?? 0,
    byUser: byUser.map((g) => ({
      userId: g.userId,
      username: userMap.get(g.userId)?.username ?? "(未知)",
      name: userMap.get(g.userId)?.name ?? "(未知)",
      role: userMap.get(g.userId)?.role ?? "USER",
      assetCount: g._count.id,
      assetBytes: g._sum.byteSize ?? 0,
    })),
  };
}

/** 管理员批量删除资产（跨用户，含微调子树 + 文件）。
 *  调用方必须先确认是 ADMIN（本函数不校验归属）。 */
export async function hardDeleteAssetsForAdmin(assetIds: string[]) {
  return deleteAssetSubtrees(assetIds);
}
