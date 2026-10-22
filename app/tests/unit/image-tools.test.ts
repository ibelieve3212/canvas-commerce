/**
 * @vitest-environment node
 *
 * 图片处理工具（IMAGE_TOOL / per_image）：
 * 1. 三个内置应用定义能过契约 zod 校验，且挂到 IMAGE 分类
 * 2. nearestAspectRatio / isAspectRatio 的映射与守卫
 * 3. createBatch 的 per_image 语义：
 *    - 任务数被强制为上传图数（客户端传的 requestedCount 无效）
 *    - 越界（0 张 / 超 max）拒绝
 *    - 每个任务快照记录自己的 sourceUploadId 与比例
 *    - 白底图用用户选的比例；精修/变清晰跟随原图宽高
 * 4. processJob 只加载任务绑定的那张源图（坏图不会拖垮好图）
 * 5. 应用滑条（精修力度、买家秀真实度、海报构图随机）：levels 档位
 *    映射（applySliderLevels）把数值翻译成给模型的明确指令短语，
 *    裸数字对模型是猜谜
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { runMigrations } from "../../scripts/migrate.mjs";
import { createSandbox, hasFixture, forceMockProvider } from "../fixtures/sandbox";

import { ApplicationSchema, isAspectRatio, nearestAspectRatio, type FormSchema } from "@/contracts/application";
import { validateFormValues, applySliderLevels, applyCopyPriority, composePrompt } from "@/contracts/generation";
import { whiteBackgroundApp } from "@/server/applications/apps/white-background";
import { imageRetouchApp } from "@/server/applications/apps/image-retouch";
import { imageClarityApp } from "@/server/applications/apps/image-clarity";
import { buyerShowApp } from "@/server/applications/apps/buyer-show";
import { posterApp } from "@/server/applications/apps/poster";
import { builtinApplications } from "@/server/applications/seed";

/* ---------- 纯函数：契约与定义（不依赖数据库） ---------- */

describe("图片处理工具：应用定义与契约", () => {
  const tools = [whiteBackgroundApp, imageRetouchApp, imageClarityApp];

  it("三个应用都能过 ApplicationSchema 严格校验", () => {
    for (const app of tools) {
      expect(() => ApplicationSchema.parse(app)).not.toThrow();
    }
  });

  it("kind=IMAGE_TOOL、category=IMAGE、per_image 上限 8，且已注册进内置应用", () => {
    for (const app of tools) {
      expect(app.kind).toBe("IMAGE_TOOL");
      expect(app.category).toBe("IMAGE");
      expect(app.outputConfig).toEqual({ mode: "per_image", max: 8 });
      expect(builtinApplications.some((a) => a.id === app.id)).toBe(true);
    }
  });

  it("图字段：必填、1-8 张；三个工具 prompt 都不吃 output_directive（避免 variant 语义污染）", () => {
    for (const app of tools) {
      const imageFields = app.formSchema.filter((f) => f.type === "image");
      expect(imageFields).toHaveLength(1);
      expect(imageFields[0].required).toBe(true);
      expect(imageFields[0].min).toBe(1);
      expect(imageFields[0].max).toBe(8);
      expect(app.promptTemplate).not.toContain("{{output_directive}}");
    }
  });

  it("白底图有输出比例单选（默认 1:1），精修/变清晰没有比例字段（跟随原图）", () => {
    const aspectField = whiteBackgroundApp.formSchema.find((f) => f.key === "aspect");
    expect(aspectField?.type).toBe("radio");
    const values = aspectField?.type === "radio" ? aspectField.options.map((o) => o.value) : [];
    expect(values).toEqual(["1:1", "4:5", "3:4"]);

    for (const app of [imageRetouchApp, imageClarityApp]) {
      expect(app.formSchema.some((f) => f.key === "aspect")).toBe(false);
    }
  });

  it("表单校验：空图被拒，8 张内通过", () => {
    const schema = imageRetouchApp.formSchema;
    expect(validateFormValues(schema, { source: [] }).ok).toBe(false);
    expect(
      validateFormValues(schema, {
        source: Array.from({ length: 8 }, (_, i) => ({ uploadId: `u${i}` })),
      }).ok,
    ).toBe(true);
  });

  it("滑条越界被拒（reflection=150），范围内通过", () => {
    const source = [{ uploadId: "u1" }];
    const rejected = validateFormValues(imageRetouchApp.formSchema, {
      source,
      reflection: 150,
    });
    expect(rejected.ok).toBe(false);
    expect(rejected.errors.reflection).toContain("0-100");
    expect(
      validateFormValues(imageRetouchApp.formSchema, { source, reflection: 50 }).ok,
    ).toBe(true);
  });

  it("精修有三个力度滑条（反光/光影/质感），各 5 档且带端点提示", () => {
    const sliders = imageRetouchApp.formSchema.filter((f) => f.type === "slider");
    expect(sliders.map((f) => f.key)).toEqual(["reflection", "relight", "texture"]);
    for (const field of sliders) {
      if (field.type !== "slider") continue;
      expect(field.levels).toHaveLength(5);
      expect(field.hintLow).toBeTruthy();
      expect(field.hintHigh).toBeTruthy();
    }
  });

  it("applySliderLevels：数值映射成最近档位的指令短语", () => {
    const out = applySliderLevels(imageRetouchApp.formSchema, {
      reflection: 30,
      relight: 50,
      texture: 90,
    });
    // 30 → 25 档；50 → 50 档；90 → 100 档
    expect(out.reflection).toContain("杂物倒影");
    expect(out.relight).toContain("体积感");
    expect(out.texture).toContain("广告级");
  });

  it("applySliderLevels：缺省回落 defaultValue 档位，越界收敛到最近档", () => {
    const out = applySliderLevels(imageRetouchApp.formSchema, { reflection: 150 });
    expect(out.reflection).toContain("理想影棚");
    expect(out.relight).toContain("体积感");
    expect(out.texture).toContain("材质");
  });

  it("applySliderLevels：未声明 levels 的滑条裸数字透传（机制向后兼容）", () => {
    const schema: FormSchema = [
      { type: "slider", key: "s", label: "无档位滑条", required: false, min: 0, max: 100, step: 1, unit: "", defaultValue: 45 },
    ];
    const out = applySliderLevels(schema, { s: 45, keep: "原样" });
    expect(out.s).toBe(45);
    expect(out.keep).toBe("原样");
  });

  it("存量滑条接入档位：买家秀真实度、海报构图不再是裸数字", () => {
    const b = applySliderLevels(buyerShowApp.formSchema, { realism: 45 });
    expect(b.realism).toContain("自然生活感"); // 45 → 最近 50 档
    const p = applySliderLevels(posterApp.formSchema, { layout_random: 30 });
    expect(p.layout_random).toContain("稳妥"); // 30 → 最近 25 档
    // prompt 里不再出现裸数字槽位残留
    const prompt = composePrompt(
      buyerShowApp.promptTemplate,
      applySliderLevels(buyerShowApp.formSchema, { realism: 50 }),
    );
    expect(prompt).toContain("自然生活感");
    expect(prompt).not.toMatch(/真实感：\d/);
  });

  it("默认值组装出的完整 prompt：含人影清理指令，无残留占位符", () => {
    const values = applySliderLevels(imageRetouchApp.formSchema, applyCopyPriority({}));
    const prompt = composePrompt(imageRetouchApp.promptTemplate, values);
    expect(prompt).toContain("人影");
    expect(prompt).toContain("磨砂、拉丝等表面工艺是商品的设计特征");
    expect(prompt).toContain("构图、商品、场景与原图保持一致");
    expect(prompt).not.toContain("{{");
  });

  it("nearestAspectRatio：按对数距离映射到最近支持比例", () => {
    expect(nearestAspectRatio(1000, 1000)).toBe("1:1");
    expect(nearestAspectRatio(1080, 1920)).toBe("9:16");
    expect(nearestAspectRatio(1920, 1080)).toBe("16:9");
    expect(nearestAspectRatio(800, 1000)).toBe("4:5");
    expect(nearestAspectRatio(750, 1000)).toBe("3:4");
    expect(nearestAspectRatio(300, 400)).toBe("3:4");
    // 缺尺寸（旧数据 null）回落 1:1，不抛错
    expect(nearestAspectRatio(null, null)).toBe("1:1");
    expect(nearestAspectRatio(undefined, undefined)).toBe("1:1");
  });

  it("isAspectRatio 只放行五个合法比例", () => {
    expect(isAspectRatio("4:5")).toBe(true);
    expect(isAspectRatio("2:3")).toBe(false);
    expect(isAspectRatio(undefined)).toBe(false);
    expect(isAspectRatio(1)).toBe(false);
  });
});

/* ---------- 沙箱库：createBatch / processJob ---------- */

let sandbox: string;
let sbStorage: string;
let prisma: typeof import("@/server/db/client").prisma;
let service: typeof import("@/server/generation/service");

/** 1×1 PNG（mock provider 不看内容，只要求能从存储读出字节） */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

async function mkUpload(
  userId: string,
  id: string,
  opts: { width: number; height: number; broken?: boolean },
) {
  const objectKey = `uploads/${id}.png`;
  await prisma.upload.create({
    data: {
      id,
      userId,
      objectKey,
      originalName: `${id}.png`,
      mimeType: "image/png",
      byteSize: TINY_PNG.length,
      width: opts.width,
      height: opts.height,
      sha256: "0".repeat(64),
    },
  });
  if (!opts.broken) {
    const fp = path.join(sbStorage, objectKey);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, TINY_PNG);
  }
}

beforeAll(async () => {
  if (!hasFixture) return;
  const sb = createSandbox("cc-tools-", false);
  sandbox = sb.root;
  sbStorage = sb.storagePath;
  runMigrations(sb.dbPath, "prisma/migrations", () => {});

  process.env.DATABASE_URL = `file:${sb.dbPath}`;
  process.env.STORAGE_LOCAL_PATH = sb.storagePath;
  process.env.AUTH_SECRET ||= "test-secret-at-least-16-chars";
  process.env.GENERATION_PROVIDER = "mock";

  prisma = (await import("@/server/db/client")).prisma;
  // 沙箱库是从 dev.db 拷的，里面存着真实生图渠道配置，
  // 不清掉 processJob 会真的去打外部 API（见 forceMockProvider）
  await forceMockProvider(prisma);
  service = await import("@/server/generation/service");

  // 沙箱库是从 dev.db 拷的，可能还没种过三个工具应用。
  // GenerationBatch.applicationId 有 FK，不补种会直接炸外键。
  // 这里只补工具应用（与 prisma/seed.ts 同构，勿扩散范围）。
  for (const app of [whiteBackgroundApp, imageRetouchApp, imageClarityApp]) {
    await prisma.application.upsert({
      where: { id: app.id },
      update: {},
      create: {
        id: app.id,
        slug: app.slug,
        name: app.name,
        description: app.description,
        kind: app.kind,
        visibility: app.visibility,
        category: app.category,
        emojiIcon: app.emojiIcon ?? null,
        tagline: app.tagline,
        tagsJson: JSON.stringify(app.tags),
        outputConfigJson: JSON.stringify(app.outputConfig),
        outputRolesJson: JSON.stringify(app.outputRoles),
        formSchemaJson: JSON.stringify(app.formSchema),
        promptTemplate: app.promptTemplate,
        defaultAspectRatio: app.defaultAspectRatio,
        templateVersion: app.templateVersion,
        isPublished: app.isPublished,
      },
    });
  }
});

afterAll(async () => {
  await prisma?.$disconnect();
  if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true });
});

describe.runIf(hasFixture)("图片处理工具：createBatch per_image 语义", () => {
  let userId: string;

  beforeAll(async () => {
    const u = await prisma.user.findFirstOrThrow();
    userId = u.id;
  });

  it("任务数强制为上传图数；每任务快照记录自己的源图与比例（白底图用用户选的比例）", async () => {
    await mkUpload(userId, "up_tool_1", { width: 1000, height: 1000 });
    await mkUpload(userId, "up_tool_2", { width: 750, height: 1000 });
    const referenceImages = [
      { uploadId: "up_tool_1", role: "product" as const },
      { uploadId: "up_tool_2", role: "product" as const },
    ];

    // 客户端乱传 requestedCount=5、aspectRatio=16:9，服务端应以图数与表单比例为准
    const { batchId } = await service.createBatch({
      userId,
      applicationId: whiteBackgroundApp.id,
      formValues: {
        source: referenceImages.map((r) => ({ uploadId: r.uploadId })),
        aspect: "4:5",
      },
      referenceImages,
      aspectRatio: "16:9",
      requestedCount: 5,
    });

    const batch = await prisma.generationBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch.requestedCount).toBe(2);
    expect(batch.aspectRatio).toBe("4:5");

    const jobs = await prisma.generationJob.findMany({
      where: { batchId },
      orderBy: { outputIndex: "asc" },
    });
    expect(jobs).toHaveLength(2);
    expect(jobs.map((j) => j.outputRole)).toEqual(["image_1", "image_2"]);

    const snapshots = jobs.map((j) =>
      JSON.parse(j.promptSnapshotJson) as {
        sourceUploadId?: string;
        aspectRatio?: string;
        outputIndex: number;
      },
    );
    // 任务 i 只绑第 i 张图；比例统一用用户选的 4:5
    expect(snapshots[0].sourceUploadId).toBe("up_tool_1");
    expect(snapshots[1].sourceUploadId).toBe("up_tool_2");
    expect(snapshots.map((s) => s.aspectRatio)).toEqual(["4:5", "4:5"]);

    // 模板快照里的角色标题是「第 N 张」
    const template = JSON.parse(batch.templateSnapshotJson) as {
      outputRoles: { title: string }[];
    };
    expect(template.outputRoles.map((r) => r.title)).toEqual(["第 1 张", "第 2 张"]);
  });

  it("精修/变清晰：比例逐张跟随原图（16:9 竖横混传各得其所）", async () => {
    await mkUpload(userId, "up_retouch_1", { width: 1080, height: 1920 });
    await mkUpload(userId, "up_retouch_2", { width: 1920, height: 1080 });
    const referenceImages = [
      { uploadId: "up_retouch_1", role: "product" as const },
      { uploadId: "up_retouch_2", role: "product" as const },
    ];

    const { batchId } = await service.createBatch({
      userId,
      applicationId: imageRetouchApp.id,
      formValues: { source: referenceImages.map((r) => ({ uploadId: r.uploadId })) },
      referenceImages,
      aspectRatio: "1:1",
      requestedCount: 1,
    });

    const batch = await prisma.generationBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch.requestedCount).toBe(2);
    expect(batch.aspectRatio).toBe("9:16"); // 批次比例取第 1 张

    const jobs = await prisma.generationJob.findMany({
      where: { batchId },
      orderBy: { outputIndex: "asc" },
    });
    const aspects = jobs.map(
      (j) => (JSON.parse(j.promptSnapshotJson) as { aspectRatio?: string }).aspectRatio,
    );
    expect(aspects).toEqual(["9:16", "16:9"]);
  });

  it("越界拒绝：0 张 / 超 8 张", async () => {
    // 0 张先撞表单必填校验（image 字段 required），同样是 VALIDATION_FAILED；
    // createBatch 里的 per_image 计数下限是防御层，不重复断言具体文案
    await expect(
      service.createBatch({
        userId,
        applicationId: imageRetouchApp.id,
        formValues: { source: [] },
        referenceImages: [],
        aspectRatio: "1:1",
        requestedCount: 1,
      }),
    ).rejects.toThrow(/VALIDATION_FAILED/);

    // 两层都会拦：表单层先报（字段文案），服务层 per_image 强制计数是第二道防线。
    // 这里只断言拒绝本身，不绑定某一层的文案。
    const many = Array.from({ length: 9 }, (_, i) => ({
      uploadId: `up_nope_${i}`,
      role: "product" as const,
    }));
    await expect(
      service.createBatch({
        userId,
        applicationId: imageRetouchApp.id,
        formValues: { source: many.map((r) => ({ uploadId: r.uploadId })) },
        referenceImages: many,
        aspectRatio: "1:1",
        requestedCount: 9,
      }),
    ).rejects.toThrow(/VALIDATION_FAILED/);
  });

  it("processJob 只加载任务绑定的那张源图：好图成功、坏图失败，互不拖累", async () => {
    // 图 1 文件存在；图 2 只建 Upload 记录、不落文件
    await mkUpload(userId, "up_bind_1", { width: 1000, height: 1000 });
    await mkUpload(userId, "up_bind_2", { width: 1000, height: 1000, broken: true });
    const referenceImages = [
      { uploadId: "up_bind_1", role: "product" as const },
      { uploadId: "up_bind_2", role: "product" as const },
    ];

    const { batchId } = await service.createBatch({
      userId,
      applicationId: imageClarityApp.id,
      formValues: { source: referenceImages.map((r) => ({ uploadId: r.uploadId })) },
      referenceImages,
      aspectRatio: "1:1",
      requestedCount: 2,
    });
    const jobs = await prisma.generationJob.findMany({
      where: { batchId },
      orderBy: { outputIndex: "asc" },
    });

    await service.processJob(jobs[0].id);
    await service.processJob(jobs[1].id);

    const final = await prisma.generationJob.findMany({
      where: { batchId },
      orderBy: { outputIndex: "asc" },
      select: { id: true, outputIndex: true, status: true, errorMessage: true },
    });
    // 绑定好图的任务成功（不受第 2 张坏图影响）；绑定坏图的任务失败
    expect(final[0].status).toBe("succeeded");
    const asset = await prisma.asset.findFirst({ where: { jobId: final[0].id } });
    expect(asset).not.toBeNull();
    expect(final[1].status).toBe("failed");
  });
});
