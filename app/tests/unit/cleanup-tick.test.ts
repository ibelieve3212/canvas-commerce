/**
 * @vitest-environment node
 *
 * 清理 tick 的集成验证——补第 2/3 步的缺口。
 *
 * `runCleanupTick` 在第 2、3 步被大幅改动（新增 Export 清理、改失败 Job 条件、
 * 超额删除换成 planAssetCleanup），但此前只测了纯函数，这个集成入口从未执行过。
 * worker 里它是 `.catch(console.error)`，真抛错也只进日志，不会有人发现。
 *
 * 沙箱：dev.db 副本 + 独立 storage 临时目录，不碰真实开发数据。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { runMigrations } from "../../scripts/migrate.mjs";

const REAL_DB = ".data/db/dev.db";
const REAL_STORAGE = ".data/storage";
const hasFixture = fs.existsSync(REAL_DB);

let sandbox: string;
let worker: typeof import("@/server/worker");
let prisma: typeof import("@/server/db/client").prisma;
let setCleanupPolicy: typeof import("@/server/settings/cleanup-policy").setCleanupPolicy;

beforeAll(async () => {
  if (!hasFixture) return;

  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "cc-tick-"));
  const dbPath = path.join(sandbox, "test.db");
  const storagePath = path.join(sandbox, "storage");
  fs.copyFileSync(REAL_DB, dbPath);
  fs.cpSync(REAL_STORAGE, storagePath, { recursive: true });
  runMigrations(dbPath, "prisma/migrations", () => {});

  process.env.DATABASE_URL = `file:${dbPath}`;
  process.env.STORAGE_LOCAL_PATH = storagePath;
  process.env.AUTH_SECRET ||= "test-secret-at-least-16-chars";

  worker = await import("@/server/worker");
  setCleanupPolicy = (await import("@/server/settings/cleanup-policy")).setCleanupPolicy;
  prisma = (await import("@/server/db/client")).prisma;
});

afterAll(async () => {
  await prisma?.$disconnect();
  if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true });
});

/** 把某实体的时间戳推到过去，制造"超期"数据 */
async function ageDays(table: "asset" | "upload" | "export", id: string, days: number) {
  const past = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  await prisma.$executeRawUnsafe(
    `UPDATE "${table === "asset" ? "Asset" : table === "upload" ? "Upload" : "Export"}"
     SET createdAt = ? WHERE id = ?`,
    past,
    id,
  );
}

describe.runIf(hasFixture)("runCleanupTick 集成", () => {
  // 每个用例前把数量上限放到足够大。用例之间共享同一个沙箱库，
  // 而 runCleanupTick 每次都会跑完整流程（超期 + 超额），
  // 不统一基线的话前一个用例设的上限会影响后一个的断言。
  // 想测超额的用例自己再收紧上限。
  beforeEach(async () => {
    await setCleanupPolicy({ retentionDays: 3650, maxItemsPerUser: 100000 });
  });

  it("宽松策略下能跑通且不误删（冒烟）", async () => {
    const before = {
      assets: await prisma.asset.count(),
      uploads: await prisma.upload.count(),
      convos: await prisma.chatConversation.count(),
    };
    expect(before.assets).toBeGreaterThan(0);

    const r = await worker.runCleanupTick();

    expect(r.expiredAssets).toBe(0);
    expect(r.excessAssets).toBe(0);
    expect(await prisma.asset.count()).toBe(before.assets);
    expect(await prisma.upload.count()).toBe(before.uploads);
    expect(await prisma.chatConversation.count()).toBe(before.convos);
    // 新增字段要真的存在（第 2 步加的）
    expect(r).toHaveProperty("expiredExports");
  });

  it("超期资产连同微调子树被删，文件一并落盘删除", async () => {
    // 保留期收到 30 天，好让下面推到 40 天前的资产算超期
    await setCleanupPolicy({ retentionDays: 30, maxItemsPerUser: 100000 });

    // 找一个有微调子图的资产，把父推到 40 天前
    const parent = await prisma.asset.findFirst({
      where: { childAssets: { some: {} } },
      include: { childAssets: { select: { id: true, objectKey: true } } },
    });
    if (!parent) return expect.fail("dev.db 里没有带微调子图的资产，无法验证");

    const childIds = parent.childAssets.map((c) => c.id);
    await ageDays("asset", parent.id, 40);

    const parentFile = path.join(sandbox, "storage", parent.objectKey);
    expect(fs.existsSync(parentFile)).toBe(true);

    const r = await worker.runCleanupTick();

    // 父 + 子全删（子图更新，但父删了留孤立子图无意义）
    expect(r.expiredAssets).toBeGreaterThanOrEqual(1 + childIds.length);
    expect(await prisma.asset.findUnique({ where: { id: parent.id } })).toBeNull();
    expect(await prisma.asset.count({ where: { id: { in: childIds } } })).toBe(0);
    expect(fs.existsSync(parentFile)).toBe(false);
  });

  it("超期导出被清理（第 2 步新增，此前完全没有清理入口）", async () => {
    const exp = await prisma.export.findFirst({ where: { objectKey: { not: null } } });
    if (!exp) return;

    await ageDays("export", exp.id, 30); // 超过 FAILED_JOB_RETENTION_DAYS=7

    const r = await worker.runCleanupTick();

    expect(r.expiredExports).toBeGreaterThanOrEqual(1);
    expect(await prisma.export.findUnique({ where: { id: exp.id } })).toBeNull();
  });

  it("排队中被取消的 Job 能被清掉（startedAt 为 NULL 的漏网场景）", async () => {
    const batch = await prisma.generationBatch.findFirst();
    if (!batch) return;

    // 造一个 canceled 且 startedAt/completedAt 均为 NULL 的 Job——
    // 旧条件 `startedAt < cutoff` 对 NULL 永不成立，这种 Job 会永久堆积
    const job = await prisma.generationJob.create({
      data: {
        batchId: batch.id,
        outputIndex: 9999,
        outputRole: "cleanup-probe",
        status: "canceled",
        promptSnapshotJson: "{}",
      },
    });
    expect(job.startedAt).toBeNull();
    // 批次要够老才会被选中（新条件按所属批次年龄判断）
    await prisma.$executeRawUnsafe(
      `UPDATE "GenerationBatch" SET createdAt = ? WHERE id = ?`,
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      batch.id,
    );

    await worker.runCleanupTick();

    expect(await prisma.generationJob.findUnique({ where: { id: job.id } })).toBeNull();
  });

  it("收紧数量上限时，实删数与预览数一致（预览/执行同源）", async () => {
    const { previewCleanupImpact } = await import("@/server/settings/cleanup-policy");

    // 挑一个持有资产最多的用户，把上限压到远低于其持有量
    const top = await prisma.asset.groupBy({
      by: ["userId"],
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 1,
    });
    if (top.length === 0) return;

    const LIMIT = 10;
    const policy = { retentionDays: 3650, maxItemsPerUser: LIMIT };
    const impact = await previewCleanupImpact(policy);
    expect(impact.assets.willDelete).toBeGreaterThan(0);

    const totalBefore = await prisma.asset.count();
    await setCleanupPolicy(policy);
    const r = await worker.runCleanupTick();

    const actuallyDeleted = totalBefore - (await prisma.asset.count());
    // 这是第 3 步的全部意义：管理员看到的数字就是真实删除量
    expect(actuallyDeleted).toBe(impact.assets.willDelete);
    expect(r.excessAssets).toBe(impact.assets.willDelete);

    // 每个用户都降到上限内
    const after = await prisma.asset.groupBy({ by: ["userId"], _count: { id: true } });
    for (const g of after) expect(g._count.id).toBeLessThanOrEqual(LIMIT);
  });
});
