/**
 * Worker：从队列取 Job 执行 + 定期自动清理。
 *
 * V2 唯一形态——与 web 同进程，部署不依赖独立 worker 进程。
 * 启动入口是 `src/instrumentation.ts`（dev 和生产都会调 startWorker），
 * 本模块只导出函数，不自己执行。
 *
 * OPT-2: 自动清理 tick（保留期 + 每用户数量上限 + 失败 Job）。
 * OPT-5: 聊天数据清理（超期会话 + 消息 + 贴图文件）。
 *
 * 清理阈值从 `getCleanupPolicy()` 读取（SystemSetting > env），每次 tick 现读，
 * 管理员在设置页改完即时生效，无需重启。
 */
import { getQueue, getMemoryQueue } from "@/server/queue/adapter";
import { processJob } from "@/server/generation/service";
import { env } from "@/lib/env";
import { prisma } from "@/server/db/client";
import { getStorage } from "@/server/storage/adapter";
import { getCleanupPolicy } from "@/server/settings/cleanup-policy";

const CLEANUP_INTERVAL_MS = env.CLEANUP_INTERVAL_HOURS * 60 * 60 * 1000;
/** 启动后延迟这么久跑第一次清理，避开启动时的其他初始化。 */
const CLEANUP_STARTUP_DELAY_MS = 2 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 启动 worker：队列轮询 + 清理 tick。
 * 幂等——重复调用只会启动一次（dev 下 HMR 可能重复触发 instrumentation）。
 */
export function startWorker(): void {
  const g = globalThis as unknown as { __ccWorkerStarted?: boolean };
  if (g.__ccWorkerStarted) return;
  g.__ccWorkerStarted = true;

  console.log(
    `[worker] 启动，provider=${env.GENERATION_PROVIDER}, queue=memory, 清理间隔=${env.CLEANUP_INTERVAL_HOURS}h`,
  );

  let processing = false;
  const poll = async () => {
    if (processing) return;
    processing = true;
    try {
      const queue = getQueue();
      while (true) {
        const item = await queue.dequeue();
        if (!item) break;
        const { jobId } = item as { jobId: string };
        console.log(`[worker] 处理 job: ${jobId}`);
        try {
          await processJob(jobId);
        } catch (err) {
          console.error(`[worker] job ${jobId} 失败:`, err);
        }
      }
    } finally {
      processing = false;
    }
  };

  const memQueue = getMemoryQueue();
  if (memQueue) {
    memQueue.onEnqueue(() => void poll());
  }
  // 定期兜底轮询（防止 onEnqueue 漏触发导致任务卡在 queued）
  setInterval(() => void poll(), 3000);
  void poll();

  // 清理 tick：启动后延迟跑一次，之后按间隔周期跑。
  // 只挂 setInterval 的话，进程每次重启都会把计时器归零，
  // 开发环境几乎不可能活到 6 小时，等于清理从不执行。
  setTimeout(() => void runCleanupTick().catch(console.error), CLEANUP_STARTUP_DELAY_MS);
  setInterval(() => void runCleanupTick().catch(console.error), CLEANUP_INTERVAL_MS);
}

// ── 清理逻辑 ──

/** 递归删 Asset 子树文件 + 记录 + 关联 Job */
async function deleteAssetTreeForCleanup(assetId: string): Promise<void> {
  const children = await prisma.asset.findMany({
    where: { parentAssetId: assetId },
    select: { id: true },
  });
  for (const child of children) {
    await deleteAssetTreeForCleanup(child.id);
  }

  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    select: { objectKey: true, thumbnailKey: true, jobId: true },
  });
  if (!asset) return;

  const storage = getStorage();
  await storage.delete(asset.objectKey).catch(() => {});
  if (asset.thumbnailKey) {
    await storage.delete(asset.thumbnailKey).catch(() => {});
  }
  if (asset.jobId) {
    await prisma.generationJob.delete({ where: { id: asset.jobId } }).catch(() => {});
  }
  await prisma.asset.delete({ where: { id: assetId } }).catch(() => {});
}

/**
 * 删上传图文件 + 记录。
 *
 * Upload 没有微调树也没有关联 Job，所以不需要递归。
 * `Asset.sourceUploadId` 是 `ON DELETE SET NULL`，删了自动置空，不会留悬空外键。
 *
 * 注意：Batch 的 `inputSnapshotJson` 里以 JSON 文本存了 uploadId，无外键约束。
 * 上传图被清理后，微调时找不回原始产品图——`tweak.ts` 已改为明确报错而非静默降级。
 */
async function deleteUploadForCleanup(uploadId: string): Promise<void> {
  const upload = await prisma.upload.findUnique({
    where: { id: uploadId },
    select: { objectKey: true, thumbnailKey: true },
  });
  if (!upload) return;

  const storage = getStorage();
  await storage.delete(upload.objectKey).catch(() => {});
  if (upload.thumbnailKey) {
    await storage.delete(upload.thumbnailKey).catch(() => {});
  }
  await prisma.upload.delete({ where: { id: uploadId } }).catch(() => {});
}

export interface CleanupTickResult {
  expiredAssets: number;
  excessAssets: number;
  expiredUploads: number;
  excessUploads: number;
  failedJobs: number;
  expiredConversations: number;
}

/**
 * 跑一次清理。资产与上传图共用同一对阈值（保留天数 / 每用户上限），各自独立计数。
 * 收藏图不豁免（用户明确决定）。
 */
export async function runCleanupTick(): Promise<CleanupTickResult> {
  const policy = await getCleanupPolicy();
  console.log(
    `[worker] 清理 tick 开始（保留 ${policy.retentionDays} 天 / 每用户上限 ${policy.maxItemsPerUser}）`,
  );

  const now = Date.now();
  const itemCutoff = new Date(now - policy.retentionDays * DAY_MS);
  const chatCutoff = new Date(now - policy.chatRetentionDays * DAY_MS);
  const jobCutoff = new Date(now - policy.failedJobRetentionDays * DAY_MS);
  const storage = getStorage();

  // 1. 删超期 Asset
  const expiredAssets = await prisma.asset.findMany({
    where: { createdAt: { lt: itemCutoff } },
    select: { id: true },
  });
  for (const a of expiredAssets) {
    await deleteAssetTreeForCleanup(a.id);
  }

  // 2. 每用户超额 Asset（从最老删）
  let excessAssets = 0;
  const userAssetCounts = await prisma.asset.groupBy({
    by: ["userId"],
    _count: { id: true },
    having: { id: { _count: { gt: policy.maxItemsPerUser } } },
  });
  for (const uc of userAssetCounts) {
    const excess = uc._count.id - policy.maxItemsPerUser;
    const oldestAssets = await prisma.asset.findMany({
      where: { userId: uc.userId },
      orderBy: { createdAt: "asc" },
      take: excess,
      select: { id: true },
    });
    for (const a of oldestAssets) {
      await deleteAssetTreeForCleanup(a.id);
      excessAssets++;
    }
  }

  // 3. 删超期 Upload（与 Asset 同一保留期）
  const expiredUploads = await prisma.upload.findMany({
    where: { createdAt: { lt: itemCutoff } },
    select: { id: true },
  });
  for (const u of expiredUploads) {
    await deleteUploadForCleanup(u.id);
  }

  // 4. 每用户超额 Upload（与 Asset 同一上限，但各自独立计数）
  let excessUploads = 0;
  const userUploadCounts = await prisma.upload.groupBy({
    by: ["userId"],
    _count: { id: true },
    having: { id: { _count: { gt: policy.maxItemsPerUser } } },
  });
  for (const uc of userUploadCounts) {
    const excess = uc._count.id - policy.maxItemsPerUser;
    const oldestUploads = await prisma.upload.findMany({
      where: { userId: uc.userId },
      orderBy: { createdAt: "asc" },
      take: excess,
      select: { id: true },
    });
    for (const u of oldestUploads) {
      await deleteUploadForCleanup(u.id);
      excessUploads++;
    }
  }

  // 5. 删超期失败 Job（含半成品 Asset）
  const failedJobs = await prisma.generationJob.findMany({
    where: {
      status: { in: ["failed", "canceled"] },
      startedAt: { lt: jobCutoff },
    },
    select: { id: true },
  });
  for (const j of failedJobs) {
    // 查 Job 的关联 Asset（1:1 关系，Asset.jobId 指向 Job）
    const asset = await prisma.asset.findUnique({
      where: { jobId: j.id },
      select: { id: true },
    });
    if (asset?.id) {
      await deleteAssetTreeForCleanup(asset.id);
    } else {
      // 无 Asset，只删 Job
      await prisma.generationJob.delete({ where: { id: j.id } }).catch(() => {});
    }
  }

  // 6. 删超期聊天会话（含消息 + 贴图文件）
  //    聊天保留期独立于资产（OPT-5 决策：30 天 + 滑动窗口 40 条，不做数量上限）
  const expiredConvos = await prisma.chatConversation.findMany({
    where: { updatedAt: { lt: chatCutoff } },
    select: { id: true },
  });
  for (const c of expiredConvos) {
    // 删贴图文件
    const msgWithImages = await prisma.chatMessage.findMany({
      where: { conversationId: c.id, imageObjectKey: { not: null } },
      select: { imageObjectKey: true },
    });
    for (const m of msgWithImages) {
      if (m.imageObjectKey) {
        await storage.delete(m.imageObjectKey).catch(() => {});
      }
    }
    // 删会话（级联删消息）
    await prisma.chatConversation.delete({ where: { id: c.id } }).catch(() => {});
  }

  const result: CleanupTickResult = {
    expiredAssets: expiredAssets.length,
    excessAssets,
    expiredUploads: expiredUploads.length,
    excessUploads,
    failedJobs: failedJobs.length,
    expiredConversations: expiredConvos.length,
  };

  console.log(
    `[worker] 清理 tick 完成: 超期资产 ${result.expiredAssets}, 超额资产 ${result.excessAssets}, ` +
      `超期上传 ${result.expiredUploads}, 超额上传 ${result.excessUploads}, ` +
      `失败 Job ${result.failedJobs}, 超期会话 ${result.expiredConversations}`,
  );
  return result;
}
