import { describe, it, expect, beforeEach } from "vitest";
import {
  throttleProviderRequest,
  markProviderRequestComplete,
  notifyRateLimited,
  getThrottleStats,
  resetThrottle,
} from "@/server/provider/throttle";

/**
 * Provider 并发闸门。
 *
 * 原本这里是"两次请求至少间隔 12 秒"的固定 RPM 限速，但上游一张图要跑
 * 45-95 秒，每 12 秒放一个进去反而堆积出 4-5 个并发、触发 429；
 * 串行等待又让 6 张图跑 6 分钟。限速值和上游实际耗时毫无关系。
 * 改成按并发数控制 + 429 自适应收窄。
 */
describe("Provider 并发闸门", () => {
  beforeEach(() => {
    resetThrottle();
  });

  it("Mock provider 不占名额", async () => {
    await throttleProviderRequest("mock");
    expect(getThrottleStats().active).toBe(0);
  });

  it("并发上限内的请求立即放行", async () => {
    const start = Date.now();
    await throttleProviderRequest("ccload-newapi");
    await throttleProviderRequest("ccload-newapi");
    await throttleProviderRequest("ccload-newapi");
    expect(Date.now() - start).toBeLessThan(50);
    expect(getThrottleStats().active).toBe(3);
  });

  it("超出上限的请求排队，直到有名额归还才放行", async () => {
    // 占满默认的 3 个名额
    for (let i = 0; i < 3; i++) await throttleProviderRequest("ccload-newapi");
    expect(getThrottleStats().active).toBe(3);

    let released = false;
    const queued = throttleProviderRequest("ccload-newapi").then(() => {
      released = true;
    });

    // 让出事件循环，确认它确实在等而不是已经放行
    await Promise.resolve();
    expect(released).toBe(false);
    expect(getThrottleStats().waiting).toBe(1);

    markProviderRequestComplete("ok");
    await queued;
    expect(released).toBe(true);
    expect(getThrottleStats().active).toBe(3);
  });

  it("归还名额后 active 递减", async () => {
    await throttleProviderRequest("ccload-newapi");
    await throttleProviderRequest("ccload-newapi");
    expect(getThrottleStats().active).toBe(2);
    markProviderRequestComplete("ok");
    expect(getThrottleStats().active).toBe(1);
  });

  it("收到 429 时收窄并发上限", async () => {
    expect(getThrottleStats().limit).toBe(3);
    await throttleProviderRequest("ccload-newapi");
    markProviderRequestComplete("rate_limited");
    expect(getThrottleStats().limit).toBe(2);
  });

  it("并发上限不会收窄到 0（至少保留 1 个，否则彻底卡死）", async () => {
    for (let i = 0; i < 10; i++) notifyRateLimited();
    expect(getThrottleStats().limit).toBe(1);
  });

  it("notifyRateLimited 收窄上限但不归还名额（就地重试要继续用）", async () => {
    await throttleProviderRequest("ccload-newapi");
    expect(getThrottleStats().active).toBe(1);
    notifyRateLimited();
    expect(getThrottleStats().limit).toBe(2);
    // 名额还在自己手里
    expect(getThrottleStats().active).toBe(1);
  });

  it("连续成功后逐步恢复并发上限", async () => {
    notifyRateLimited();
    expect(getThrottleStats().limit).toBe(2);

    // 连续 5 次成功才放开一格
    for (let i = 0; i < 4; i++) {
      await throttleProviderRequest("ccload-newapi");
      markProviderRequestComplete("ok");
    }
    expect(getThrottleStats().limit).toBe(2);

    await throttleProviderRequest("ccload-newapi");
    markProviderRequestComplete("ok");
    expect(getThrottleStats().limit).toBe(3);
  });

  it("恢复不会超过默认上限", async () => {
    for (let i = 0; i < 20; i++) {
      await throttleProviderRequest("ccload-newapi");
      markProviderRequestComplete("ok");
    }
    expect(getThrottleStats().limit).toBe(3);
  });

  it("429 会重置成功计数，不让它跨过限流累积", async () => {
    notifyRateLimited(); // limit 3 → 2
    for (let i = 0; i < 4; i++) {
      await throttleProviderRequest("ccload-newapi");
      markProviderRequestComplete("ok");
    }
    // 差一次就恢复，此时来个 429
    await throttleProviderRequest("ccload-newapi");
    markProviderRequestComplete("rate_limited"); // limit 2 → 1，计数清零
    expect(getThrottleStats().limit).toBe(1);

    // 再来 4 次成功不该恢复（计数已清零，需要满 5 次）
    for (let i = 0; i < 4; i++) {
      await throttleProviderRequest("ccload-newapi");
      markProviderRequestComplete("ok");
    }
    expect(getThrottleStats().limit).toBe(1);
  });

  it("收窄后排队的请求按新上限放行，不会一次放太多", async () => {
    // 唤醒一个等待者要走两跳微任务：waiter 的 await 恢复、再到 .then()
    const tick = async () => { await Promise.resolve(); await Promise.resolve(); };

    // 占满 3 个
    for (let i = 0; i < 3; i++) await throttleProviderRequest("ccload-newapi");

    let releasedCount = 0;
    const queued = [
      throttleProviderRequest("ccload-newapi").then(() => { releasedCount++; }),
      throttleProviderRequest("ccload-newapi").then(() => { releasedCount++; }),
    ];
    await tick();
    expect(getThrottleStats().waiting).toBe(2);

    // 一个 429 归还：active 3→2，limit 3→2，此时 active 不小于 limit，不放行
    markProviderRequestComplete("rate_limited");
    await tick();
    expect(releasedCount).toBe(0);

    // 再归还一个：active 2→1 < limit 2，放行一个
    markProviderRequestComplete("ok");
    await tick();
    expect(releasedCount).toBe(1);

    // 收尾，避免未 settle 的 promise 泄漏到别的用例
    markProviderRequestComplete("ok");
    markProviderRequestComplete("ok");
    await Promise.all(queued);
  });
});
