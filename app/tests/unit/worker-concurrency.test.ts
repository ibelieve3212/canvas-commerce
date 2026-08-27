/**
 * @vitest-environment node
 *
 * worker 轮询的并发行为。
 *
 * 用户实测：生成 3 张主图，界面上只有 1 个"生成中"、2 个"排队中"，
 * 即上一轮加的并发闸门完全没生效。这里直接验证 worker 的取 job 循环
 * 是否真的同时喂多个进去——只读代码看不出来，必须跑。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// worker 会 import env，缺 AUTH_SECRET 会在模块加载期直接抛
process.env.AUTH_SECRET ||= "test-secret-at-least-16-chars";

/** 记录每个 job 的开始/结束时刻，用于判断是否重叠 */
const timeline: Array<{ id: string; at: number; ev: "start" | "end" }> = [];
let now = 0;

const processJobMock = vi.fn(async (jobId: string) => {
  timeline.push({ id: jobId, at: now, ev: "start" });
  // 模拟上游耗时。要足够长，否则第一个 job 在测试来得及入队后续 job 之前
  // 就跑完了，"后续入队是否干等"这件事根本没被测到。
  await new Promise((r) => setTimeout(r, 200));
  timeline.push({ id: jobId, at: now, ev: "end" });
});

vi.mock("@/server/generation/service", () => ({
  processJob: (id: string) => processJobMock(id),
  recomputeBatchStatus: vi.fn(),
}));

// worker 还会起清理 tick，这里不关心，全部打桩
vi.mock("@/server/settings/cleanup-policy", () => ({
  getCleanupPolicy: vi.fn(async () => ({
    retentionDays: 3650,
    maxItemsPerUser: 100000,
    chatRetentionDays: 30,
    failedJobRetentionDays: 7,
    source: { retentionDays: "env", maxItemsPerUser: "env" },
  })),
  planAssetCleanup: vi.fn(() => ({ doomed: new Set(), expiredCount: 0, excessCount: 0 })),
}));
vi.mock("@/server/deletion/service", () => ({
  deleteAssetSubtrees: vi.fn(),
  deleteUpload: vi.fn(),
  deleteConversation: vi.fn(),
  deleteExport: vi.fn(),
}));
vi.mock("@/server/db/client", () => ({
  prisma: {
    asset: { findMany: vi.fn(async () => []) },
    upload: { findMany: vi.fn(async () => []), groupBy: vi.fn(async () => []) },
    generationJob: { findMany: vi.fn(async () => []), deleteMany: vi.fn() },
    chatConversation: { findMany: vi.fn(async () => []) },
    export: { findMany: vi.fn(async () => []) },
  },
}));

beforeEach(() => {
  timeline.length = 0;
  now = 0;
  processJobMock.mockClear();
  // 清掉 worker 的启动标志与队列单例，让每个用例独立
  const g = globalThis as unknown as Record<string, unknown>;
  delete g.__ccWorkerStarted;
  delete g.__ccQueue;
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("worker 并发取 job", () => {
  it("3 个 job 会同时开始，而不是一个跑完才取下一个", async () => {
    const { getQueue } = await import("@/server/queue/adapter");
    const { startWorker } = await import("@/server/worker");

    const queue = getQueue();
    await queue.enqueue("job-1", {});
    await queue.enqueue("job-2", {});
    await queue.enqueue("job-3", {});

    startWorker();

    // 等所有 job 跑完
    await vi.waitFor(
      () => {
        expect(timeline.filter((t) => t.ev === "end")).toHaveLength(3);
      },
      { timeout: 3000 },
    );

    // 关键断言：第 3 个 job 的 start 必须早于第 1 个 job 的 end。
    // 串行时顺序是 start1,end1,start2,end2,...；并发时是 start1,start2,start3,...
    const firstEnd = timeline.findIndex((t) => t.ev === "end");
    const startsBeforeFirstEnd = timeline
      .slice(0, firstEnd)
      .filter((t) => t.ev === "start").length;

    expect(
      startsBeforeFirstEnd,
      `只有 ${startsBeforeFirstEnd} 个 job 在第一个完成前启动，说明仍是串行`,
    ).toBe(3);
  });

  it("轮询开始后陆续入队的 job 不必等前一个跑完（回归：实测晚 34 秒）", async () => {
    const { getQueue } = await import("@/server/queue/adapter");
    const { startWorker } = await import("@/server/worker");

    const queue = getQueue();
    // 先入队 1 个并启动 worker，让 poll 进入循环、processing = true
    await queue.enqueue("job-1", {});
    startWorker();

    // 等 job-1 真的开跑
    await vi.waitFor(() => {
      expect(timeline.filter((t) => t.ev === "start")).toHaveLength(1);
    }, { timeout: 1000 });

    // 此刻再入队两个。onEnqueue 会触发 poll，但 processing 已是 true 会被
    // 入口守卫挡掉——若循环在队列取空时就退出，这两个只能等 3 秒兜底轮询。
    // 实测正是如此：job1 单独跑，job2/job3 晚 34 秒（job1 的生成耗时）才开始。
    await queue.enqueue("job-2", {});
    await queue.enqueue("job-3", {});

    await vi.waitFor(() => {
      expect(timeline.filter((t) => t.ev === "end")).toHaveLength(3);
    }, { timeout: 3000 });

    // job-2/job-3 必须在 job-1 结束之前就启动
    const firstEnd = timeline.findIndex((t) => t.ev === "end");
    const startedBeforeFirstEnd = timeline
      .slice(0, firstEnd)
      .filter((t) => t.ev === "start").length;
    expect(
      startedBeforeFirstEnd,
      `只有 ${startedBeforeFirstEnd} 个 job 在第一个完成前启动，后续入队的仍在干等`,
    ).toBe(3);
  });

  it("同时喂进去的数量不超过 WORKER_CONCURRENCY", async () => {
    const { getQueue } = await import("@/server/queue/adapter");
    const { startWorker } = await import("@/server/worker");

    const queue = getQueue();
    for (let i = 0; i < 20; i++) await queue.enqueue(`job-${i}`, {});

    startWorker();

    await vi.waitFor(
      () => {
        expect(timeline.filter((t) => t.ev === "end")).toHaveLength(20);
      },
      { timeout: 5000 },
    );

    // 扫时间线求最大同时在跑数
    let running = 0;
    let peak = 0;
    for (const t of timeline) {
      running += t.ev === "start" ? 1 : -1;
      peak = Math.max(peak, running);
    }
    expect(peak).toBeGreaterThan(1); // 确实并发了
    expect(peak).toBeLessThanOrEqual(6); // 但没有一次性全塞进来
  });
});
