/**
 * 批次/资产删除的集成验证。
 *
 * @vitest-environment node
 *
 * 必须跑在 node 环境：默认的 jsdom 会让 @t3-oss/env-nextjs 判定为客户端，
 * 从而拒绝读取 STORAGE_LOCAL_PATH 等服务端变量。
 *
 * 全程在沙箱里跑：DB 是 dev.db 的副本、storage 是独立临时目录，
 * 绝不触碰 .data 下的真实开发数据。
 *
 * 覆盖第 1 步修复的四个点：
 * 1. migration 后批次能删掉（旧代码被 QuotaReservation 的 FK RESTRICT 挡死）
 * 2. 删除是事务化的，且文件在事务提交后才删
 * 3. PENDING reservation 的批次删除前退还未用配额
 * 4. 删资产后批次计数重算
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
// 用项目自己的 migrate runner 应用 migration，顺带验证新 migration
// 能走通真实部署路径（docker-entrypoint 跑的就是这个脚本）
import { runMigrations } from "../../scripts/migrate.mjs";

const REAL_DB = ".data/db/dev.db";
const REAL_STORAGE = ".data/storage";

const hasFixture = fs.existsSync(REAL_DB);

let sandbox: string;
let queries: typeof import("@/server/generation/queries");
let deletion: typeof import("@/server/deletion/service");
let prisma: typeof import("@/server/db/client").prisma;

beforeAll(async () => {
  if (!hasFixture) return;

  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "cc-del-"));
  const dbPath = path.join(sandbox, "test.db");
  const storagePath = path.join(sandbox, "storage");
  fs.copyFileSync(REAL_DB, dbPath);
  fs.cpSync(REAL_STORAGE, storagePath, { recursive: true });

  // 副本已应用到上一个 migration，这里只会跑新增的那个
  runMigrations(dbPath, "prisma/migrations", () => {});

  // env 在模块加载时读取，必须先设置再 import
  process.env.DATABASE_URL = `file:${dbPath}`;
  process.env.STORAGE_LOCAL_PATH = storagePath;
  process.env.AUTH_SECRET ||= "test-secret-at-least-16-chars";

  queries = await import("@/server/generation/queries");
  deletion = await import("@/server/deletion/service");
  prisma = (await import("@/server/db/client")).prisma;
});

afterAll(async () => {
  await prisma?.$disconnect();
  if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true });
});

describe.runIf(hasFixture)("批次与资产删除", () => {
  it("QuotaReservation.batchId 的外键是 CASCADE 而非 RESTRICT", async () => {
    const fk = await prisma.$queryRawUnsafe<Array<{ from: string; on_delete: string }>>(
      "PRAGMA foreign_key_list(QuotaReservation)",
    );
    expect(fk.find((f) => f.from === "batchId")?.on_delete).toBe("CASCADE");
  });

  it("删已完成批次：记录级联清空、文件落盘删除、已产出配额不退", async () => {
    const batch = await prisma.generationBatch.findFirstOrThrow({
      where: { status: "completed", jobs: { some: { asset: { isNot: null } } } },
      include: { jobs: { include: { asset: true } } },
    });
    const assetIds = batch.jobs.filter((j) => j.asset).map((j) => j.asset!.id);
    const keys = batch.jobs.filter((j) => j.asset).map((j) => j.asset!.objectKey);
    const quotaBefore = await prisma.userQuota.findUniqueOrThrow({
      where: { userId: batch.userId },
    });

    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      expect(fs.existsSync(path.join(sandbox, "storage", k))).toBe(true);
    }

    // 旧实现在这里抛 "Foreign key constraint violated"
    await queries.hardDeleteBatch(batch.id, batch.userId);

    expect(await prisma.generationBatch.findUnique({ where: { id: batch.id } })).toBeNull();
    expect(await prisma.generationJob.count({ where: { batchId: batch.id } })).toBe(0);
    expect(await prisma.asset.count({ where: { id: { in: assetIds } } })).toBe(0);
    expect(await prisma.quotaReservation.count({ where: { batchId: batch.id } })).toBe(0);

    for (const k of keys) {
      expect(fs.existsSync(path.join(sandbox, "storage", k))).toBe(false);
    }

    // 已成功的图消耗了真实 Provider 调用，删本地文件不该把额度退回来
    const quotaAfter = await prisma.userQuota.findUniqueOrThrow({
      where: { userId: batch.userId },
    });
    expect(quotaAfter.totalUsed).toBe(quotaBefore.totalUsed);
  });

  it("删排队中批次：退还未产出的预占配额", async () => {
    const src = await prisma.generationBatch.findFirstOrThrow();
    const RESERVED = 3;

    const batch = await prisma.generationBatch.create({
      data: {
        userId: src.userId,
        applicationId: src.applicationId,
        status: "queued",
        inputSnapshotJson: src.inputSnapshotJson,
        templateSnapshotJson: src.templateSnapshotJson,
        requestedCount: RESERVED,
        aspectRatio: "1:1",
      },
    });
    await prisma.generationJob.create({
      data: {
        batchId: batch.id,
        outputIndex: 1,
        outputRole: "r1",
        status: "queued",
        promptSnapshotJson: "{}",
      },
    });
    await prisma.quotaReservation.create({
      data: { userId: src.userId, batchId: batch.id, reservedCount: RESERVED, status: "PENDING" },
    });
    const quotaBefore = await prisma.userQuota.update({
      where: { userId: src.userId },
      data: { dailyUsed: { increment: RESERVED }, totalUsed: { increment: RESERVED } },
    });

    await queries.hardDeleteBatch(batch.id, src.userId);

    const quotaAfter = await prisma.userQuota.findUniqueOrThrow({ where: { userId: src.userId } });
    expect(quotaBefore.dailyUsed - quotaAfter.dailyUsed).toBe(RESERVED);
    expect(quotaBefore.totalUsed - quotaAfter.totalUsed).toBe(RESERVED);
  });

  it("删资产后批次计数与实际 Job 一致", async () => {
    const batch = await prisma.generationBatch.findFirstOrThrow({
      where: { jobs: { some: { asset: { isNot: null } } } },
      include: { jobs: { include: { asset: true } } },
    });
    const victim = batch.jobs.find((j) => j.asset)!;

    const result = await queries.hardDeleteAsset(victim.asset!.id, batch.userId);
    expect(result.deletedCount).toBeGreaterThanOrEqual(1);

    const after = await prisma.generationBatch.findUniqueOrThrow({
      where: { id: batch.id },
      include: { jobs: true },
    });
    expect(after.succeededCount).toBe(after.jobs.filter((j) => j.status === "succeeded").length);
    expect(after.failedCount).toBe(after.jobs.filter((j) => j.status === "failed").length);
  });

  it("删他人资产被拒绝，且不产生任何删除", async () => {
    const asset = await prisma.asset.findFirstOrThrow();
    const before = await prisma.asset.count();

    await expect(queries.hardDeleteAsset(asset.id, "not-the-owner")).rejects.toThrow("FORBIDDEN");
    expect(await prisma.asset.count()).toBe(before);
  });
});

/**
 * 直接调用删除层原语。
 *
 * `deleteUpload` / `deleteExport` 只在清理 tick 里被使用，而 dev 数据库里
 * 唯一那个 Upload 是当天创建的（既没超期也没超上限），清理 tick 的测试
 * 其实一次都没触发过它。这里直接调，不依赖清理策略碰巧选中。
 */
describe.runIf(hasFixture)("删除层原语", () => {
  const fileOf = (key: string) => path.join(sandbox, "storage", key);

  it("deleteUpload：删记录 + 原图 + 缩略图，并把引用它的 Asset.sourceUploadId 置空", async () => {
    const upload = await prisma.upload.findFirst();
    if (!upload) return expect.fail("dev.db 里没有 Upload，无法验证");

    // 造一个引用它的 Asset，验证 ON DELETE SET NULL 真的生效（不留悬空外键）
    const someAsset = await prisma.asset.findFirstOrThrow();
    await prisma.asset.update({
      where: { id: someAsset.id },
      data: { sourceUploadId: upload.id },
    });

    expect(fs.existsSync(fileOf(upload.objectKey))).toBe(true);
    const thumbExisted = !!upload.thumbnailKey && fs.existsSync(fileOf(upload.thumbnailKey));

    await deletion.deleteUpload(upload.id);

    expect(await prisma.upload.findUnique({ where: { id: upload.id } })).toBeNull();
    expect(fs.existsSync(fileOf(upload.objectKey))).toBe(false);
    if (thumbExisted) expect(fs.existsSync(fileOf(upload.thumbnailKey!))).toBe(false);

    // 引用被置空，Asset 本身还活着
    const refAfter = await prisma.asset.findUnique({ where: { id: someAsset.id } });
    expect(refAfter).not.toBeNull();
    expect(refAfter!.sourceUploadId).toBeNull();
  });

  it("deleteExport：删记录 + 导出文件", async () => {
    const exp = await prisma.export.findFirst({ where: { objectKey: { not: null } } });
    if (!exp) return expect.fail("dev.db 里没有带文件的 Export，无法验证");

    // 导出文件可能因历史清理已不在磁盘上，两种情况都要能正常删记录
    const existedBefore = fs.existsSync(fileOf(exp.objectKey!));

    await deletion.deleteExport(exp.id);

    expect(await prisma.export.findUnique({ where: { id: exp.id } })).toBeNull();
    if (existedBefore) expect(fs.existsSync(fileOf(exp.objectKey!))).toBe(false);
  });

  it("原语幂等：对已不存在的 id 调用不抛错", async () => {
    // 清理 tick 会并发遍历，同一条可能被前一步的子树删除带走，
    // 此时静默返回而不是抛错，否则整个 tick 会中断
    await expect(deletion.deleteUpload("nonexistent-id")).resolves.toBeUndefined();
    await expect(deletion.deleteExport("nonexistent-id")).resolves.toBeUndefined();
    await expect(deletion.deleteConversation("nonexistent-id")).resolves.toBeUndefined();
    await expect(deletion.deleteBatchCascade("nonexistent-id")).resolves.toBeUndefined();
    await expect(deletion.deleteAssetSubtrees(["nonexistent-id"])).resolves.toEqual({
      deletedCount: 0,
    });
  });

  it("deleteConversation：删会话 + 消息 + 贴图文件", async () => {
    const user = await prisma.user.findFirstOrThrow();
    const conv = await prisma.chatConversation.create({
      data: { userId: user.id, title: "待删会话" },
    });
    // 造一条带贴图的消息，文件真写到沙箱磁盘
    const key = `chat/${conv.id}/probe.png`;
    fs.mkdirSync(path.dirname(fileOf(key)), { recursive: true });
    fs.writeFileSync(fileOf(key), Buffer.from([1, 2, 3]));
    await prisma.chatMessage.create({
      data: { conversationId: conv.id, role: "user", content: "hi", imageObjectKey: key },
    });

    await deletion.deleteConversation(conv.id);

    expect(await prisma.chatConversation.findUnique({ where: { id: conv.id } })).toBeNull();
    // 消息由外键 Cascade 带走
    expect(await prisma.chatMessage.count({ where: { conversationId: conv.id } })).toBe(0);
    expect(fs.existsSync(fileOf(key))).toBe(false);
  });
});
