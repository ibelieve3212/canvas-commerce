/**
 * Batch/Job 服务：批次创建、幂等、状态聚合、重试。
 */
import { prisma } from "@/server/db/client";
import { getQueue } from "@/server/queue/adapter";
import { getProviderForUser } from "@/server/provider";
import { getStorage, makeObjectKey } from "@/server/storage/adapter";
import { generateThumbnail } from "@/server/storage/thumbnail";
import { ProviderError } from "@/server/provider/types";
import type { ProviderReferenceImage, ImageGenerationProvider, ProviderImageRequest, ProviderImageResult } from "@/server/provider/types";
import {
  throttleProviderRequest,
  markProviderRequestComplete,
  notifyRateLimited,
  backoffForRateLimit,
  getThrottleStats,
} from "@/server/provider/throttle";
import { env } from "@/lib/env";
import { composePrompt, validateFormValues, applyCopyPriority, buildOutputDirective, buildPointDirective } from "@/contracts/generation";
import type { Application } from "@/contracts/application";
import type { FormValues } from "@/contracts/generation";
import { getApplicationById } from "@/server/applications/seed";

export function resolveApplication(applicationId: string): Application | undefined {
  return getApplicationById(applicationId);
}

// ---------- 配额 ----------

export async function getOrCreateQuota(userId: string) {
  const today = new Date().toISOString().slice(0, 10);
  let quota = await prisma.userQuota.findUnique({ where: { userId } });
  if (!quota) {
    quota = await prisma.userQuota.create({
      data: {
        userId,
        dailyLimit: env.QUOTA_DAILY_DEFAULT,
        totalQuota: env.QUOTA_TOTAL_DEFAULT,
        maxConcurrency: env.QUOTA_MAX_CONCURRENCY_DEFAULT,
        dailyDate: today,
      },
    });
  }
  // 跨天重置
  if (quota.dailyDate !== today) {
    quota = await prisma.userQuota.update({
      where: { userId },
      data: { dailyUsed: 0, dailyDate: today },
    });
  }
  return quota;
}

// ---------- 批次创建 ----------

export interface CreateBatchInput {
  userId: string;
  applicationId: string;
  formValues: FormValues;
  referenceImages: { uploadId: string; role: "product" | "style" | "person" | "brand" }[];
  aspectRatio: "1:1" | "4:5" | "3:4" | "16:9" | "9:16";
  requestedCount: number;
  idempotencyKey?: string;
  parentBatchId?: string;
}

export async function createBatch(
  input: CreateBatchInput,
): Promise<{ batchId: string; isExisting: boolean }> {
  const app = resolveApplication(input.applicationId);
  if (!app) throw new Error("APPLICATION_NOT_FOUND");

  // 幂等检查
  if (input.idempotencyKey) {
    const existing = await prisma.generationBatch.findFirst({
      where: { userId: input.userId, idempotencyKey: input.idempotencyKey },
    });
    if (existing) return { batchId: existing.id, isExisting: true };
  }

  // 校验表单
  const validation = validateFormValues(app.formSchema, input.formValues);
  if (!validation.ok) {
    throw new Error("VALIDATION_FAILED:" + JSON.stringify(validation.errors));
  }

  // 配额预检
  const quota = await getOrCreateQuota(input.userId);
  if (
    quota.dailyLimit - quota.dailyUsed < input.requestedCount ||
    quota.totalQuota - quota.totalUsed < input.requestedCount
  ) {
    throw new Error("QUOTA_EXCEEDED");
  }

  const roles = computeOutputRoles(app, input.requestedCount);
  // OPT-1: 文案优先级包装 — 注入 copy_directive 后再走 composePrompt
  const valuesWithCopy = applyCopyPriority(input.formValues);

  const inputSnapshot = {
    applicationId: input.applicationId,
    formValues: input.formValues,
    referenceImages: input.referenceImages.map(r => ({
      uploadId: r.uploadId,
      role: r.role,
    })),
    aspectRatio: input.aspectRatio,
    requestedCount: input.requestedCount,
    promptTemplate: app.promptTemplate,
    templateVersion: app.templateVersion,
    createdAt: new Date().toISOString(),
  };
  const templateSnapshot = {
    outputRoles: roles,
    promptTemplate: app.promptTemplate,
    templateVersion: app.templateVersion,
  };

  const batch = await prisma.$transaction(async (tx) => {
    const q = await tx.userQuota.findUnique({ where: { userId: input.userId } });
    if (!q) throw new Error("QUOTA_NOT_FOUND");
    if (
      q.dailyLimit - q.dailyUsed < input.requestedCount ||
      q.totalQuota - q.totalUsed < input.requestedCount
    ) {
      throw new Error("QUOTA_EXCEEDED");
    }

    const b = await tx.generationBatch.create({
      data: {
        userId: input.userId,
        applicationId: input.applicationId,
        parentBatchId: input.parentBatchId,
        status: "queued",
        inputSnapshotJson: JSON.stringify(inputSnapshot),
        templateSnapshotJson: JSON.stringify(templateSnapshot),
        requestedCount: input.requestedCount,
        aspectRatio: input.aspectRatio,
        idempotencyKey: input.idempotencyKey,
      },
    });

    for (const role of roles) {
      // prompt 必须逐张算：composePrompt 要吃 output_directive（本张定位）
      // 和 point_directive（海报轮转到的那条卖点）。此前它在循环外只算一次，
      // N 个 Job 拿到逐字相同的字符串，outputRole 从未进过 prompt——
      // 于是详情页 6 张全做成首屏、主图 5 张全做成吸睛图。
      const perOutputValues = {
        ...valuesWithCopy,
        output_directive: buildOutputDirective(role, roles.length),
        point_directive: buildPointDirective(valuesWithCopy, role, roles.length),
      };
      const prompt = composePrompt(
        app.promptTemplate,
        perOutputValues,
        input.referenceImages,
      );

      await tx.generationJob.create({
        data: {
          batchId: b.id,
          outputIndex: role.outputIndex,
          outputRole: role.outputRole,
          status: "queued",
          provider: env.GENERATION_PROVIDER,
          attempt: 0,
          promptSnapshotJson: JSON.stringify({
            prompt,
            outputRole: role.outputRole,
            outputIndex: role.outputIndex,
            templateVersion: app.templateVersion,
          }),
        },
      });
    }

    await tx.userQuota.update({
      where: { userId: input.userId },
      data: {
        dailyUsed: { increment: input.requestedCount },
        totalUsed: { increment: input.requestedCount },
      },
    });

    await tx.quotaReservation.create({
      data: {
        userId: input.userId,
        batchId: b.id,
        reservedCount: input.requestedCount,
        status: "PENDING",
      },
    });

    return b;
  });

  // 入队
  const jobs = await prisma.generationJob.findMany({
    where: { batchId: batch.id },
    orderBy: { outputIndex: "asc" },
  });
  const queue = getQueue();
  for (const job of jobs) {
    await queue.enqueue(job.id, { batchId: batch.id, jobId: job.id });
  }

  return { batchId: batch.id, isExisting: false };
}

function computeOutputRoles(
  app: Application,
  count: number,
): Array<{ outputIndex: number; outputRole: string; title: string; description: string }> {
  if (app.outputRoles.length > 0) {
    return app.outputRoles.slice(0, count).map((r) => ({ ...r, description: r.description ?? "" }));
  }
  // 未声明 outputRoles 的应用（海报、买家秀）：海报按卖点轮转，
  // role 名用 point_ 前缀让 buildPointDirective 认领；买家秀无卖点概念，
  // 靠 buildOutputDirective 的通用差异化约束避免多张雷同。
  const isPoster = app.kind === "POSTER";
  return Array.from({ length: count }, (_, i) => ({
    outputIndex: i + 1,
    outputRole: isPoster ? `point_${i + 1}` : `variant_${i + 1}`,
    title: isPoster ? `卖点海报 ${i + 1}` : `${app.name} ${i + 1}`,
    description: isPoster
      ? "围绕分配到的单个卖点做画面主体"
      : "与同组其它张在构图、机位、光线上明显区分开",
  }));
}

// ---------- 状态聚合 ----------

export async function recomputeBatchStatus(batchId: string): Promise<void> {
  const jobs = await prisma.generationJob.findMany({ where: { batchId } });

  // Job 被删光（用户删了批次里最后一张图）。此时不能直接 return——
  // 那会让批次停留在删除前的旧计数，任务页显示"1/1 成功"却一张图都打不开。
  if (jobs.length === 0) {
    await prisma.generationBatch.updateMany({
      where: { id: batchId },
      data: { succeededCount: 0, failedCount: 0, canceledCount: 0 },
    });
    return;
  }

  const succeeded = jobs.filter((j) => j.status === "succeeded").length;
  const failed = jobs.filter((j) => j.status === "failed").length;
  const canceled = jobs.filter((j) => j.status === "canceled").length;
  const running = jobs.filter((j) => j.status === "running").length;

  let status: "queued" | "running" | "partial" | "completed" | "failed" | "canceled";
  if (canceled === jobs.length) status = "canceled";
  else if (succeeded === jobs.length) status = "completed";
  else if (succeeded + failed + canceled === jobs.length) status = "partial";
  else if (failed === jobs.length - canceled && succeeded === 0) status = "failed";
  else if (running > 0 || succeeded > 0 || failed > 0) status = "running";
  else status = "queued";

  const update: Record<string, unknown> = {
    succeededCount: succeeded,
    failedCount: failed,
    canceledCount: canceled,
    status,
  };
  if (["completed", "failed", "partial", "canceled"].includes(status)) {
    update.completedAt = new Date();
  }

  await prisma.generationBatch.update({ where: { id: batchId }, data: update });

  if (["completed", "failed", "partial", "canceled"].includes(status)) {
    await settleQuota(batchId, succeeded);
  }
}

async function settleQuota(batchId: string, succeededCount: number): Promise<void> {
  const reservation = await prisma.quotaReservation.findUnique({ where: { batchId } });
  if (!reservation || reservation.status !== "PENDING") return;

  const toRelease = reservation.reservedCount - succeededCount;
  if (toRelease > 0) {
    await prisma.userQuota.update({
      where: { userId: reservation.userId },
      data: {
        dailyUsed: { decrement: toRelease },
        totalUsed: { decrement: toRelease },
      },
    });
  }

  await prisma.quotaReservation.update({
    where: { id: reservation.id },
    data: { settledCount: succeededCount, status: "SETTLED", settledAt: new Date() },
  });
}

// ---------- Job 处理 ----------

/** 429 在同一个并发名额内退避重试的次数。超过则交给 Job 层的重试。 */
const RATE_LIMIT_RETRIES = 3;

/**
 * 调 Provider，遇到 429 就地退避重试。
 *
 * 为什么在这里重试而不是丢回队列：429 是瞬时过载，退避几秒通常就好了。
 * 丢回队列意味着重新排队、重新占名额，而且 Job 层只允许重试 2 次
 * （那 2 次是留给真正的失败的）。就地重试还能保住已经拿到的并发名额，
 * 不至于退回去跟其它 Job 抢。
 *
 * 每次 429 都会 markProviderRequestComplete("rate_limited") 让闸门收窄，
 * 所以重试的同时并发数也在下降，双管齐下。
 */
async function generateWithRateLimitRetry(
  provider: ImageGenerationProvider,
  request: ProviderImageRequest,
): Promise<ProviderImageResult> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await provider.generate(request);
    } catch (err) {
      const isRateLimited =
        err instanceof ProviderError && err.code === "RATE_LIMITED" && err.retryable;
      if (!isRateLimited || attempt >= RATE_LIMIT_RETRIES) throw err;

      // 通知闸门收窄并发，但名额不归还——下面还要接着用
      const s = getThrottleStats();
      console.log(
        `[worker] 429，退避重试（当前并发上限 ${s.limit}，在跑 ${s.active}）`,
      );
      notifyRateLimited();
      await backoffForRateLimit(attempt);
    }
  }
}

export async function processJob(jobId: string): Promise<void> {
  const job = await prisma.generationJob.findUnique({
    where: { id: jobId },
    include: { batch: true },
  });
  if (!job) return;
  if (job.status === "succeeded" || job.status === "canceled") return;

  if (job.batch.status === "canceled") {
    await prisma.generationJob.update({ where: { id: jobId }, data: { status: "canceled" } });
    await recomputeBatchStatus(job.batchId);
    return;
  }

  // 原子抢占：只有 queued 状态才能变为 running，避免重复处理
  const claimed = await prisma.generationJob.updateMany({
    where: { id: jobId, status: "queued" },
    data: { status: "running", startedAt: new Date(), attempt: { increment: 1 } },
  });
  if (claimed.count === 0) return; // 已被其他 Worker 抢占
  await recomputeBatchStatus(job.batchId);

  const promptData = JSON.parse(job.promptSnapshotJson) as {
    prompt: string;
    outputRole: string;
    outputIndex: number;
  };

  // 从 inputSnapshot 读 referenceImages，查 Upload 表拿图片数据
  const inputSnapshot = JSON.parse(job.batch.inputSnapshotJson) as {
    referenceImages?: { uploadId: string; role: "product" | "style" | "person" | "brand" }[];
  };
  const refImages = inputSnapshot.referenceImages ?? [];

  // 批量查 Upload 记录并加载图片二进制
  const providerRefImages: ProviderReferenceImage[] = [];
  if (refImages.length > 0) {
    const uploads = await prisma.upload.findMany({
      where: { id: { in: refImages.map(r => r.uploadId) }, userId: job.batch.userId },
      select: { id: true, objectKey: true, mimeType: true },
    });
    const storage = getStorage();
    for (const ref of refImages) {
      const upload = uploads.find(u => u.id === ref.uploadId);
      if (!upload) continue;
      const buffer = await storage.get(upload.objectKey);
      providerRefImages.push({
        buffer,
        mimeType: upload.mimeType,
        role: ref.role,
        uploadId: ref.uploadId,
      });
    }
  }

  const provider = await getProviderForUser(job.batch.userId);
  try {
    // 并发闸门：名额满时排队，完成一个才放下一个
    await throttleProviderRequest(provider.name);

    const result = await generateWithRateLimitRetry(provider, {
      prompt: promptData.prompt,
      aspectRatio: job.batch.aspectRatio as "1:1" | "4:5" | "3:4" | "16:9" | "9:16",
      outputFormat: "png",
      referenceImages: providerRefImages,
      metadata: { batchId: job.batchId, jobId: job.id, outputRole: job.outputRole },
    });

    markProviderRequestComplete("ok");

    const objectKey = makeObjectKey(job.batch.userId, "png");
    const storage = getStorage();
    await storage.put(objectKey, result.imageBuffer);

    // 生成缩略图
    const thumbnailKey = await generateThumbnail(
      job.batch.userId,
      objectKey,
      result.imageBuffer,
      result.mimeType,
    );

    // 调 Provider 期间用户可能已经删掉了整个批次（Job 被外键 Cascade 带走）。
    // 此时若照常写库，asset.create 会外键违约、随后的 job.update 抛 P2025，
    // 日志刷一片错误堆栈，而刚落盘的图片文件永远没人回收。
    // 删除是用户的明确意图，这里安静地清掉产物即可，不该报错。
    const stillAlive = await prisma.generationJob.findUnique({
      where: { id: jobId },
      select: { id: true },
    });
    if (!stillAlive) {
      console.log(`[worker] job ${jobId} 在生成期间已被删除，丢弃产物`);
      await storage.delete(objectKey).catch(() => {});
      if (thumbnailKey) await storage.delete(thumbnailKey).catch(() => {});
      return;
    }

    await prisma.asset.create({
      data: {
        userId: job.batch.userId,
        jobId: job.id,
        objectKey,
        thumbnailKey,
        mimeType: result.mimeType,
        byteSize: result.imageBuffer.length,
        width: result.width,
        height: result.height,
        metadataJson: JSON.stringify({
          revisedPrompt: result.revisedPrompt,
          providerRequestId: result.providerRequestId,
          usage: result.usage,
          provider: provider.name,
        }),
      },
    });

    await prisma.generationJob.updateMany({
      where: { id: jobId },
      data: {
        status: "succeeded",
        completedAt: new Date(),
        providerRequestId: result.providerRequestId ?? null,
      },
    });
  } catch (err) {
    const code = err instanceof ProviderError ? err.code : "UNKNOWN";
    const message = err instanceof Error ? err.message : String(err);
    const retryable = err instanceof ProviderError ? err.retryable : false;

    // 归还并发名额。429 要如实上报，让闸门收窄并发——
    // 这是上游过载的唯一信号，报成 ok 会让它继续以同样的并发打过去。
    markProviderRequestComplete(code === "RATE_LIMITED" ? "rate_limited" : "ok");

    // 用 updateMany：Job 可能在生成期间已被删除（用户删了批次）。
    // update 会抛 P2025 冲出 catch，把一次正常的用户操作变成 worker 错误。
    const marked = await prisma.generationJob.updateMany({
      where: { id: jobId },
      data: { status: "failed", completedAt: new Date(), errorCode: code, errorMessage: message },
    });
    if (marked.count === 0) {
      console.log(`[worker] job ${jobId} 在生成期间已被删除，跳过失败标记`);
      return;
    }

    if (retryable && job.attempt < 2) {
      await prisma.generationJob.updateMany({ where: { id: jobId }, data: { status: "queued" } });
      const queue = getQueue();
      await queue.enqueue(jobId, { batchId: job.batchId, jobId });
    }
  }

  await recomputeBatchStatus(job.batchId);
}

// ---------- 重试 ----------

export async function retryJob(jobId: string, userId: string): Promise<void> {
  const job = await prisma.generationJob.findUnique({
    where: { id: jobId },
    include: { batch: true },
  });
  if (!job) throw new Error("JOB_NOT_FOUND");
  if (job.batch.userId !== userId) throw new Error("FORBIDDEN");
  if (job.status !== "failed") throw new Error("JOB_NOT_FAILED");

  await prisma.generationJob.update({
    where: { id: jobId },
    data: { status: "queued", errorCode: null, errorMessage: null },
  });

  const queue = getQueue();
  await queue.enqueue(jobId, { batchId: job.batchId, jobId });
}

// ---------- 取消 ----------

export async function cancelBatch(batchId: string, userId: string): Promise<void> {
  const batch = await prisma.generationBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new Error("BATCH_NOT_FOUND");
  if (batch.userId !== userId) throw new Error("FORBIDDEN");

  await prisma.generationBatch.update({ where: { id: batchId }, data: { status: "canceled", completedAt: new Date() } });
  await prisma.generationJob.updateMany({
    where: { batchId, status: { in: ["queued", "running"] } },
    data: { status: "canceled" },
  });
  await recomputeBatchStatus(batchId);
}

// ---------- 查询 ----------

export async function getBatchWithJobs(batchId: string, userId: string) {
  const batch = await prisma.generationBatch.findUnique({
    where: { id: batchId },
    include: {
      jobs: {
        orderBy: { outputIndex: "asc" },
        include: {
          asset: {
            include: {
              childAssets: {
                orderBy: { createdAt: "asc" },
                include: { childAssets: { orderBy: { createdAt: "asc" } } },
              },
            },
          },
        },
      },
      application: true,
    },
  });
  if (!batch) return null;
  if (batch.userId !== userId) return null;
  return batch;
}
