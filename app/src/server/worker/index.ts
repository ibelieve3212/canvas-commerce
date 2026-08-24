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
import { getCleanupPolicy, planAssetCleanup } from "@/server/settings/cleanup-policy";
import {
  deleteAssetSubtrees,
  deleteUpload,
  deleteConversation,
  deleteExport,
} from "@/server/deletion/service";

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
//
// 所有删除都走 `server/deletion/service.ts` 的统一原语，
// 本模块只负责"选取谁该被清理"，不再自己实现删除机制。

export interface CleanupTickResult {
  expiredAssets: number;
  excessAssets: number;
  expiredUploads: number;
  excessUploads: number;
  failedJobs: number;
  expiredConversations: number;
  expiredExports: number;
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

  // 1-2. 删超期 + 超额 Asset。
  //      规划与管理员预览共用 planAssetCleanup——分开实现必然漂移，
  //      旧代码就是执行时按"取 N 个最老的再各自展开子树"实际删了远超 N 张，
  //      而预览只报 N，管理员在错误预期下按下了确定。
  const allAssets = await prisma.asset.findMany({
    select: { id: true, userId: true, parentAssetId: true, createdAt: true },
  });
  const plan = planAssetCleanup(allAssets, {
    cutoff: itemCutoff,
    maxItemsPerUser: policy.maxItemsPerUser,
  });
  if (plan.doomed.size > 0) {
    await deleteAssetSubtrees([...plan.doomed]);
  }

  // 3. 删超期 Upload（与 Asset 同一保留期）
  const expiredUploads = await prisma.upload.findMany({
    where: { createdAt: { lt: itemCutoff } },
    select: { id: true },
  });
  for (const u of expiredUploads) {
    await deleteUpload(u.id);
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
      await deleteUpload(u.id);
      excessUploads++;
    }
  }

  // 5. 删超期失败/取消 Job（含半成品 Asset）
  //    按所属批次的 createdAt 判断年龄：GenerationJob 没有 createdAt 字段，
  //    且排队中就被取消的 Job 连 startedAt 都是 NULL，用 startedAt 判断会永远漏掉它们。
  const failedJobs = await prisma.generationJob.findMany({
    where: {
      status: { in: ["failed", "canceled"] },
      batch: { createdAt: { lt: jobCutoff } },
    },
    select: { id: true, asset: { select: { id: true } } },
  });
  const failedJobAssetIds = failedJobs
    .map((j) => j.asset?.id)
    .filter((id): id is string => !!id);
  const failedJobNoAsset = failedJobs.filter((j) => !j.asset).map((j) => j.id);
  if (failedJobAssetIds.length > 0) {
    // 半成品 Asset 连同其 Job 一起删（deleteAssetSubtrees 会删 Asset 的 jobId 对应 Job）
    await deleteAssetSubtrees(failedJobAssetIds);
  }
  if (failedJobNoAsset.length > 0) {
    await prisma.generationJob.deleteMany({ where: { id: { in: failedJobNoAsset } } });
  }

  // 6. 删超期聊天会话（含消息 + 贴图文件）
  //    聊天保留期独立于资产（OPT-5 决策：30 天 + 滑动窗口 40 条，不做数量上限）
  const expiredConvos = await prisma.chatConversation.findMany({
    where: { updatedAt: { lt: chatCutoff } },
    select: { id: true },
  });
  for (const c of expiredConvos) {
    await deleteConversation(c.id);
  }

  // 7. 删超期导出文件。导出是一次性临时产物，复用失败产物的短保留期（不新增 env）。
  const expiredExports = await prisma.export.findMany({
    where: { createdAt: { lt: jobCutoff } },
    select: { id: true },
  });
  for (const e of expiredExports) {
    await deleteExport(e.id);
  }

  const result: CleanupTickResult = {
    expiredAssets: plan.expiredCount,
    excessAssets: plan.excessCount,
    expiredUploads: expiredUploads.length,
    excessUploads,
    failedJobs: failedJobs.length,
    expiredConversations: expiredConvos.length,
    expiredExports: expiredExports.length,
  };

  console.log(
    `[worker] 清理 tick 完成: 超期资产 ${result.expiredAssets}, 超额资产 ${result.excessAssets}, ` +
      `超期上传 ${result.expiredUploads}, 超额上传 ${result.excessUploads}, ` +
      `失败 Job ${result.failedJobs}, 超期会话 ${result.expiredConversations}, ` +
      `超期导出 ${result.expiredExports}`,
  );
  return result;
}
