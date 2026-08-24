/**
 * 统一删除层 —— 项目里所有物理删除的唯一实现。
 *
 * 背景：删除逻辑原本在 `generation/queries.ts`、`worker/index.ts`、
 * `api/chat/conversations/[id]` 三处各写一份，资产子树删除逐行重复。
 * 本模块把删除机制收敛成一组幂等原语，上述调用方全部改调这里。
 * 详见 `docs/v2/12-DELETION-REFACTOR.md`。
 *
 * 铁律：删除分三段，顺序不能颠倒。
 *   ① 查出要删的全部东西（不删）
 *   ② 事务内只删数据库记录
 *   ③ 事务提交后才删磁盘文件
 * 文件删除不可逆——先删文件再删记录一旦回滚，就留下"记录在图 404"的坏数据；
 * 反过来最坏只留孤儿文件，靠对账回收。
 *
 * 本层不校验资源归属。归属校验属于调用场景（API 层按 userId 校验、
 * 清理 tick 与管理员批量删不校验），由调用方负责。
 */
import { prisma } from "@/server/db/client";
import { getStorage } from "@/server/storage/adapter";
import { recomputeBatchStatus } from "@/server/generation/service";
import type { Prisma } from "@prisma/client";

/** Asset 子树的一个节点：删记录要 id，删文件要两个 key，删 Job 要 jobId。 */
interface AssetNode {
  id: string;
  objectKey: string;
  thumbnailKey: string | null;
  jobId: string | null;
}

/** 收集单个 Asset 的子树（自身 + 所有微调后代），逐层查，不做任何删除。 */
async function collectAssetSubtree(assetId: string): Promise<AssetNode[]> {
  const root = await prisma.asset.findUnique({
    where: { id: assetId },
    select: { id: true, objectKey: true, thumbnailKey: true, jobId: true },
  });
  if (!root) return [];

  const nodes: AssetNode[] = [root];
  let frontier = [root.id];
  while (frontier.length > 0) {
    const children = await prisma.asset.findMany({
      where: { parentAssetId: { in: frontier } },
      select: { id: true, objectKey: true, thumbnailKey: true, jobId: true },
    });
    if (children.length === 0) break;
    nodes.push(...children);
    frontier = children.map((c) => c.id);
  }
  return nodes;
}

/**
 * 收集多个根 Asset 的子树并按 id 去重。
 * 传入列表可能同时含父与子（管理员多选、清理批量），去重避免重复删除与重复计数。
 */
async function collectSubtreesDedup(rootIds: string[]): Promise<AssetNode[]> {
  const nodes: AssetNode[] = [];
  const seen = new Set<string>();
  for (const id of rootIds) {
    for (const node of await collectAssetSubtree(id)) {
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      nodes.push(node);
    }
  }
  return nodes;
}

/** 事务内删 Asset 子树的记录与各自的 Job。文件不在这里删。 */
async function deleteAssetRecords(
  tx: Prisma.TransactionClient,
  nodes: AssetNode[],
): Promise<void> {
  if (nodes.length === 0) return;
  const jobIds = nodes.map((n) => n.jobId).filter((id): id is string => id !== null);
  // 先删 Asset 再删 Job：Asset.jobId 是 SET NULL，反过来会先把 jobId 置空
  await tx.asset.deleteMany({ where: { id: { in: nodes.map((n) => n.id) } } });
  if (jobIds.length > 0) {
    await tx.generationJob.deleteMany({ where: { id: { in: jobIds } } });
  }
}

/**
 * 删磁盘文件。只在事务提交后调用。
 *
 * 单个文件删失败只记日志不抛错：记录已经删掉了，此时抛错会让调用方
 * 以为整个删除失败并重试，而重试对已消失的记录无意义。残留文件是孤儿，
 * 靠对账回收，比"记录还在但图打不开"轻得多。
 */
async function deleteAssetFiles(nodes: AssetNode[]): Promise<void> {
  const storage = getStorage();
  for (const n of nodes) {
    await storage.delete(n.objectKey).catch((err: unknown) => {
      console.error(`[delete] 文件删除失败 key=${n.objectKey}:`, err);
    });
    if (n.thumbnailKey) {
      await storage.delete(n.thumbnailKey).catch((err: unknown) => {
        console.error(`[delete] 缩略图删除失败 key=${n.thumbnailKey}:`, err);
      });
    }
  }
}

/** 查出这批 Asset 归属的批次。必须在删 Job 之前调用，删完就查不到了。 */
async function resolveBatchIds(nodes: AssetNode[]): Promise<string[]> {
  const jobIds = nodes.map((n) => n.jobId).filter((id): id is string => id !== null);
  if (jobIds.length === 0) return [];
  const jobs = await prisma.generationJob.findMany({
    where: { id: { in: jobIds } },
    select: { batchId: true },
  });
  return [...new Set(jobs.map((j) => j.batchId))];
}

/**
 * 结算未完成的配额预占。
 *
 * createBatch 按 requestedCount 预扣配额，靠 settleQuota 在批次跑完时退还未用部分。
 * 批次删除后 reservation 被外键 Cascade 带走，settleQuota 再没有机会执行，
 * 所以删除前必须在同一事务里补上——否则删掉一个排队中的批次会永久吞掉用户配额。
 *
 * 只退还未产出的部分：已成功的图消耗了真实的 Provider 调用，
 * 删本地文件不会把它退回来（否则删了重生成就能无限刷额度）。
 */
async function releasePendingReservation(
  tx: Prisma.TransactionClient,
  batchId: string,
  succeededCount: number,
): Promise<void> {
  const reservation = await tx.quotaReservation.findUnique({ where: { batchId } });
  if (!reservation || reservation.status !== "PENDING") return;

  const toRelease = reservation.reservedCount - succeededCount;
  if (toRelease > 0) {
    await tx.userQuota.update({
      where: { userId: reservation.userId },
      data: {
        dailyUsed: { decrement: toRelease },
        totalUsed: { decrement: toRelease },
      },
    });
  }
}

// ── 导出的删除原语 ──

/**
 * 删除若干 Asset（含各自的微调子树）。
 * 用于：用户删单张、管理员批量删、清理 tick 删超期/超额资产。
 *
 * 删完自动重算受影响批次的状态——Job 没了批次计数必须跟着变，
 * 否则任务页永远显示删除前的旧数字。
 */
export async function deleteAssetSubtrees(
  assetIds: string[],
): Promise<{ deletedCount: number }> {
  const nodes = await collectSubtreesDedup(assetIds);
  if (nodes.length === 0) return { deletedCount: 0 };

  const batchIds = await resolveBatchIds(nodes);
  await prisma.$transaction((tx) => deleteAssetRecords(tx, nodes));
  await deleteAssetFiles(nodes);

  for (const batchId of batchIds) {
    await recomputeBatchStatus(batchId);
  }
  return { deletedCount: nodes.length };
}

/**
 * 彻底删除批次：配额结算 → 事务内删记录 → 事务提交后删文件。
 * 幂等：批次已不存在时静默返回。归属校验由调用方负责。
 *
 * Job 与 QuotaReservation 由外键 Cascade 带走；Asset 必须显式删——
 * Asset.jobId 是 SET NULL，光删批次只会把 Asset 变成无主孤儿。
 */
export async function deleteBatchCascade(batchId: string): Promise<void> {
  const batch = await prisma.generationBatch.findUnique({
    where: { id: batchId },
    select: { succeededCount: true },
  });
  if (!batch) return;

  const jobs = await prisma.generationJob.findMany({
    where: { batchId },
    select: { asset: { select: { id: true } } },
  });
  const nodes = await collectSubtreesDedup(
    jobs.map((j) => j.asset?.id).filter((id): id is string => !!id),
  );

  await prisma.$transaction(async (tx) => {
    await releasePendingReservation(tx, batchId, batch.succeededCount);
    await deleteAssetRecords(tx, nodes);
    await tx.generationBatch.delete({ where: { id: batchId } });
  });

  await deleteAssetFiles(nodes);
}

/**
 * 删上传图（原始素材）。
 * Upload 没有微调树也没有关联 Job，不需要递归。
 * Asset.sourceUploadId 是 ON DELETE SET NULL，删了自动置空，不留悬空外键。
 */
export async function deleteUpload(uploadId: string): Promise<void> {
  const upload = await prisma.upload.findUnique({
    where: { id: uploadId },
    select: { objectKey: true, thumbnailKey: true },
  });
  if (!upload) return;

  await prisma.upload.delete({ where: { id: uploadId } });

  const storage = getStorage();
  await storage.delete(upload.objectKey).catch((err: unknown) => {
    console.error(`[delete] 上传图删除失败 key=${upload.objectKey}:`, err);
  });
  if (upload.thumbnailKey) {
    await storage.delete(upload.thumbnailKey).catch((err: unknown) => {
      console.error(`[delete] 上传图缩略图删除失败 key=${upload.thumbnailKey}:`, err);
    });
  }
}

/**
 * 删会话（含消息 + 贴图文件）。消息由外键 Cascade 带走，贴图文件手动删。
 * 幂等：会话已不存在时静默返回——清理 tick 遍历期间可能已被并发删除，
 * 抛错会中断整个 tick。
 */
export async function deleteConversation(conversationId: string): Promise<void> {
  const conv = await prisma.chatConversation.findUnique({
    where: { id: conversationId },
    select: { id: true },
  });
  if (!conv) return;

  const messages = await prisma.chatMessage.findMany({
    where: { conversationId, imageObjectKey: { not: null } },
    select: { imageObjectKey: true },
  });
  const keys = messages
    .map((m) => m.imageObjectKey)
    .filter((k): k is string => k !== null);

  await prisma.chatConversation.delete({ where: { id: conversationId } });

  const storage = getStorage();
  for (const key of keys) {
    await storage.delete(key).catch((err: unknown) => {
      console.error(`[delete] 会话贴图删除失败 key=${key}:`, err);
    });
  }
}

/** 删导出记录 + 文件。导出是一次性临时产物，用完即弃。 */
export async function deleteExport(exportId: string): Promise<void> {
  const exp = await prisma.export.findUnique({
    where: { id: exportId },
    select: { objectKey: true },
  });
  if (!exp) return;

  await prisma.export.delete({ where: { id: exportId } });

  if (exp.objectKey) {
    const storage = getStorage();
    await storage.delete(exp.objectKey).catch((err: unknown) => {
      console.error(`[delete] 导出文件删除失败 key=${exp.objectKey}:`, err);
    });
  }
}
