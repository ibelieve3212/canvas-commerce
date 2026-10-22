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
import { composePrompt, validateFormValues, applyCopyPriority, applySliderLevels, buildOutputDirective, buildPointDirective, buildSellingPointsContext } from "@/contracts/generation";
import { isAspectRatio, nearestAspectRatio } from "@/contracts/application";
import type { Application, FormField } from "@/contracts/application";
import type { FormValues } from "@/contracts/generation";
import { getApplicationById } from "@/server/applications/seed";

export function resolveApplication(applicationId: string): Application | undefined {
  return getApplicationById(applicationId);
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

  // ---- per_image 工具（白底图/一键精修/AI 变清晰）----
  // 任务数由上传图数决定：一张图一个任务，客户端传的 requestedCount 不参与。
  // 每个任务还要定自己的比例：白底图读用户选的比例字段；
  // 精修/变清晰没有比例字段，跟随原图宽高映射到最近的支持比例（各张独立）。
  const perImageConfig = app.outputConfig?.mode === "per_image" ? app.outputConfig : null;
  let requestedCount = input.requestedCount;
  let perJobAspectRatios: string[] | null = null;
  if (perImageConfig) {
    requestedCount = input.referenceImages.length;
    if (requestedCount < 1) {
      throw new Error("VALIDATION_FAILED:" + JSON.stringify({ source: "至少上传 1 张图片" }));
    }
    if (requestedCount > perImageConfig.max) {
      throw new Error("VALIDATION_FAILED:" + JSON.stringify({ source: `单次最多处理 ${perImageConfig.max} 张图片` }));
    }
    const aspectField = app.formSchema.find(
      (f): f is Extract<FormField, { type: "radio" | "select" }> => f.type === "radio" || f.type === "select",
    );
    const chosen = aspectField ? input.formValues[aspectField.key] : undefined;
    const fixed = isAspectRatio(chosen) ? chosen : null;
    if (fixed) {
      perJobAspectRatios = input.referenceImages.map(() => fixed);
    } else {
      const uploads = await prisma.upload.findMany({
        where: { id: { in: input.referenceImages.map(r => r.uploadId) }, userId: input.userId },
        select: { id: true, width: true, height: true },
      });
      perJobAspectRatios = input.referenceImages.map((r) => {
        const u = uploads.find((x) => x.id === r.uploadId);
        return nearestAspectRatio(u?.width, u?.height);
      });
    }
  }
  const batchAspectRatio = (perJobAspectRatios?.[0] ?? input.aspectRatio) as CreateBatchInput["aspectRatio"];

  // ---- 通用：任务角色 + prompt 逐张指令 ----
  // roles 模式（主图）：用户勾选了要生成哪几种输出类型，按勾选结果生成。
  // 老批次的 formValues 里没有 roles（空数组），这时沿用“取前 N 个”的数量规则。
  const selectedRoles = Array.isArray(input.formValues.roles)
    ? (input.formValues.roles as string[]).filter((r) => typeof r === "string")
    : [];
  const roles = computeOutputRoles(app, requestedCount, selectedRoles);
  // OPT-1: 文案优先级包装 — 注入 copy_directive 后再走 composePrompt
  // 滑条档位：声明了 levels 的滑条在此把数值换成指令短语（详见 applySliderLevels）
  const withCopy = applySliderLevels(app.formSchema, applyCopyPriority(input.formValues));
  // 传了参考人物图时，要明确要求照着它长，否则模型只把它当氛围参考
  const hasPersonRef = input.referenceImages.some((r) => r.role === "person");

  // ---- 主图「带卖点文字」开关（QQ1000 include_main_selling_points 口径） ----
  // 详细语义见 buildSellingPointsContext
  const spCtx = buildSellingPointsContext(input.formValues);
  // 用模板是否声明占位符来门控（与前端 usesCopyDirective 同一手法）：
  // 只有主图模板吃这两段指令，不要让这堆逻辑影响其它应用
  const usesSellingPointsDirective = app.promptTemplate.includes("{{selling_points_directive}}");
  const valuesWithCopy = usesSellingPointsDirective && spCtx.copy_directive_override
    ? { ...withCopy, copy_directive: spCtx.copy_directive_override }
    : withCopy;

  const inputSnapshot = {
    applicationId: input.applicationId,
    formValues: input.formValues,
    referenceImages: input.referenceImages.map(r => ({
      uploadId: r.uploadId,
      role: r.role,
    })),
    aspectRatio: batchAspectRatio,
    requestedCount: requestedCount,
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
    const b = await tx.generationBatch.create({
      data: {
        userId: input.userId,
        applicationId: input.applicationId,
        parentBatchId: input.parentBatchId,
        status: "queued",
        inputSnapshotJson: JSON.stringify(inputSnapshot),
        templateSnapshotJson: JSON.stringify(templateSnapshot),
        requestedCount: requestedCount,
        aspectRatio: batchAspectRatio,
        idempotencyKey: input.idempotencyKey,
      },
    });

    for (const role of roles) {
      // 任务序号（0 起）：per_image 工具用它把任务 i 绑到上传的第 i 张图
      const jobIndex = role.outputIndex - 1;
      // prompt 必须逐张算：composePrompt 要吃 output_directive（本张定位）
      // 和 point_directive（海报轮转到的那条卖点）。此前它在循环外只算一次，
      // N 个 Job 拿到逐字相同的字符串，outputRole 从未进过 prompt——
      // 于是详情页 6 张全做成首屏、主图 5 张全做成吸睛图。
      const perOutputValues = {
        ...valuesWithCopy,
        output_directive: buildOutputDirective(role, roles.length, {
          hasPersonRef,
          // 同组角色清单只给详情页用（画面骨架避让）；
          // 主图按 QQ1000 口径走轻量路径，不看 siblings
          siblings: roles,
        }),
        point_directive: buildPointDirective(valuesWithCopy, role, roles.length),
        // 主图「带卖点文字」开关 → 上游 include_main_selling_points 口径
        selling_points_directive: spCtx.selling_points_directive,
      };
      const prompt = composePrompt(
        app.promptTemplate,
        perOutputValues,
        input.referenceImages,
      );

      // per_image 工具：快照里记上本任务专属的源图与比例，
      // processJob 据此只加载这一张图、用这个比例出图，按张重试也只重试这张
      const sourceUploadId = perImageConfig
        ? input.referenceImages[jobIndex]?.uploadId
        : undefined;
      const jobAspectRatio = perJobAspectRatios?.[jobIndex];

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
            ...(sourceUploadId ? { sourceUploadId } : {}),
            ...(jobAspectRatio ? { aspectRatio: jobAspectRatio } : {}),
          }),
        },
      });
    }

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
  selectedRoles: string[] = [],
): Array<{ outputIndex: number; outputRole: string; title: string; description: string; shot: string }> {
  if (app.outputRoles.length > 0) {
    // 勾选了类型就按勾选（支持任意组合），没勾就按数量取前 N 个（老批次行为）
    const picked =
      selectedRoles.length > 0
        ? app.outputRoles.filter((r) => selectedRoles.includes(r.outputRole))
        : app.outputRoles.slice(0, count);
    return picked.map((r) => ({
      ...r,
      description: r.description ?? "",
      shot: r.shot ?? "",
    }));
  }
  // 图片处理工具：任务与上传图一一对应，角色名用 image_ 前缀。
  // 不能落入 variant_ 兕底——那会触发 buildOutputDirective 的"人物一致、只变机位"
  // 语义，与"每张独立处理"的诉求相反。
  if (app.kind === "IMAGE_TOOL") {
    return Array.from({ length: count }, (_, i) => ({
      outputIndex: i + 1,
      outputRole: `image_${i + 1}`,
      title: `第 ${i + 1} 张`,
      description: "",
      shot: "",
    }));
  }
  // 未声明 outputRoles 的应用（海报、买家秀）：海报按卖点轮转，
  // role 名用 point_ 前缀让 buildPointDirective 认领；买家秀用 variant_ 前缀，
  // 由 buildOutputDirective 套用"人物一致、只变机位"的约束——
  // 它与海报的"内容要有区分"诉求相反，不能共用一套兜底。
  const isPoster = app.kind === "POSTER";
  return Array.from({ length: count }, (_, i) => ({
    outputIndex: i + 1,
    outputRole: isPoster ? `point_${i + 1}` : `variant_${i + 1}`,
    title: isPoster ? `卖点海报 ${i + 1}` : `${app.name} ${i + 1}`,
    description: isPoster ? "围绕分配到的单个卖点做画面主体" : "",
    shot: "",
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
    /** per_image 工具任务绑定的源图（服务端写入）：有它就只加载这一张图 */
    sourceUploadId?: string;
    /** per_image 工具任务的比例（跟随原图/用户选择）：缺省回落批次比例 */
    aspectRatio?: string;
  };

  // 从 inputSnapshot 读 referenceImages，查 Upload 表拿图片数据。
  // per_image 工具：任务快照里记了 sourceUploadId，只取绑定的那一张；
  // 其余应用维持批次级语义（N 输出共享全部素材）。
  const inputSnapshot = JSON.parse(job.batch.inputSnapshotJson) as {
    referenceImages?: { uploadId: string; role: "product" | "style" | "person" | "brand" }[];
  };
  const refImages = promptData.sourceUploadId
    ? (inputSnapshot.referenceImages ?? []).filter((r) => r.uploadId === promptData.sourceUploadId)
    : (inputSnapshot.referenceImages ?? []);

  // 批量查 Upload 记录并加载图片二进制。
  // 放进下面的 try：文件缺失（storage.get ENOENT）曾是裸抛，
  // 任务会永久卡在 running——现在统一走 failed 语义，
  // per_image 工具还能保证一张坏图只拖垮它自己的任务。
  const provider = await getProviderForUser(job.batch.userId);
  try {
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

    // 打印实际解析出的 provider：worker 启动日志里的 GENERATION_PROVIDER
    // 是个不参与决策的 env，曾误导排查。真正用哪个渠道只有这里知道，
    // 而且它还决定要不要走并发闸门（mock 直接放行、不占名额）。
    console.log(`[worker] job ${jobId} 使用 provider=${provider.name}`);
    // 并发闸门：名额满时排队，完成一个才放下一个
    await throttleProviderRequest(provider.name);

    // 比例：per_image 工具任务有自己的比例（各张可能不同）；
    // 其余应用快照无此字段，回落到批次比例——行为不变
    const jobAspectRatio = isAspectRatio(promptData.aspectRatio)
      ? promptData.aspectRatio
      : (job.batch.aspectRatio as "1:1" | "4:5" | "3:4" | "16:9" | "9:16");

    const result = await generateWithRateLimitRetry(provider, {
      prompt: promptData.prompt,
      aspectRatio: jobAspectRatio,
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
