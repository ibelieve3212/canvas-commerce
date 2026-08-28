/**
 * @vitest-environment node
 *
 * 三个 job 并发时的状态时间线。
 *
 * 用户实测：生成 3 张主图，日志显示三个 job 几乎同时进入 processJob，
 * 但界面上是"生成中/排队中/排队中"、完成 0/3。
 * 日志和界面对不上，这里用真实的 processJob + 沙箱库把状态变化打出来。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import { runMigrations } from "../../scripts/migrate.mjs";
import { createSandbox, hasFixture } from "../fixtures/sandbox";

let sandbox: string;
let prisma: typeof import("@/server/db/client").prisma;
let service: typeof import("@/server/generation/service");

beforeAll(async () => {
  if (!hasFixture) return;
  const sb = createSandbox("cc-conc-", false);
  sandbox = sb.root;
  runMigrations(sb.dbPath, "prisma/migrations", () => {});

  process.env.DATABASE_URL = `file:${sb.dbPath}`;
  process.env.STORAGE_LOCAL_PATH = sb.storagePath;
  process.env.AUTH_SECRET ||= "test-secret-at-least-16-chars";
  process.env.GENERATION_PROVIDER = "mock";

  prisma = (await import("@/server/db/client")).prisma;
  service = await import("@/server/generation/service");
});

afterAll(async () => {
  await prisma?.$disconnect();
  if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true });
});

describe.runIf(hasFixture)("3 个 job 并发处理", () => {
  it("三个 job 同时 processJob 时，状态应同时变 running 而不是排队", async () => {
    const src = await prisma.generationBatch.findFirstOrThrow();
    const batch = await prisma.generationBatch.create({
      data: {
        userId: src.userId,
        applicationId: src.applicationId,
        status: "queued",
        inputSnapshotJson: JSON.stringify({ referenceImages: [] }),
        templateSnapshotJson: "{}",
        requestedCount: 3,
        aspectRatio: "1:1",
      },
    });
    const jobIds: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const j = await prisma.generationJob.create({
        data: {
          batchId: batch.id,
          outputIndex: i,
          outputRole: `r${i}`,
          status: "queued",
          promptSnapshotJson: JSON.stringify({ prompt: "t", outputRole: `r${i}`, outputIndex: i }),
        },
      });
      jobIds.push(j.id);
    }

    // 复刻 worker 的并发调用：同时启动，不 await 单个
    const runs = jobIds.map((id) => service.processJob(id));

    // 等一小会，看是否三个都进了 running
    await new Promise((r) => setTimeout(r, 300));
    const mid = await prisma.generationJob.findMany({
      where: { batchId: batch.id },
      select: { outputIndex: true, status: true },
      orderBy: { outputIndex: "asc" },
    });
    const runningCount = mid.filter((j) => j.status === "running").length;
    const stillQueued = mid.filter((j) => j.status === "queued").length;
    console.log("300ms 时状态:", JSON.stringify(mid));

    await Promise.all(runs);

    const final = await prisma.generationJob.findMany({
      where: { batchId: batch.id },
      select: { outputIndex: true, status: true },
      orderBy: { outputIndex: "asc" },
    });
    console.log("最终状态:", JSON.stringify(final));

    // 三个都应该跑完
    expect(final.filter((j) => j.status === "succeeded")).toHaveLength(3);

    // 关键：中途不该有 job 还卡在 queued——那说明它们其实是串行的
    expect(
      stillQueued,
      `有 ${stillQueued} 个 job 仍是 queued（running=${runningCount}），说明没有真正并发`,
    ).toBe(0);
  });
});
