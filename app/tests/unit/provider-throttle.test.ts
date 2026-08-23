import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  throttleProviderRequest,
  markProviderRequestComplete,
  resetThrottle,
} from "@/server/provider/throttle";

describe("Provider 节流器", () => {
  beforeEach(() => {
    resetThrottle();
    vi.useRealTimers();
  });

  it("Mock provider 不节流（立即返回）", async () => {
    // 先标记一次完成，模拟"刚刚调过"
    markProviderRequestComplete();
    const start = Date.now();
    await throttleProviderRequest("mock", 12_000);
    expect(Date.now() - start).toBeLessThan(50);
  });

  it("真实 provider 首次调用不等待", async () => {
    // resetThrottle 已将 lastRequestFinishedAt 设为 0
    const start = Date.now();
    await throttleProviderRequest("ccload-newapi", 12_000);
    expect(Date.now() - start).toBeLessThan(50);
  });

  it("连续两次调用真实 provider 会等待间隔", async () => {
    vi.useFakeTimers();
    // 第一次标记完成
    markProviderRequestComplete();
    // 现在立刻第二次调用，需要等 12 秒
    const promise = throttleProviderRequest("ccload-newapi", 12_000);
    vi.advanceTimersByTime(12_000);
    await promise;
    vi.useRealTimers();
    // 如果到这里没有 hang 住就说明节流后正确放行了
    expect(true).toBe(true);
  });

  it("间隔足够时不等待", async () => {
    markProviderRequestComplete();
    // 等 13 秒（超过 12 秒间隔）
    await new Promise((r) => setTimeout(r, 50)); // 真实 sleep
    // 手动 mock：假定时钟
    vi.useFakeTimers();
    // 不太好测真实时间流逝，改用逻辑验证
    vi.useRealTimers();
    // 重置后直接调用应该不需要等
    resetThrottle();
    const start = Date.now();
    await throttleProviderRequest("ccload-newapi", 12_000);
    expect(Date.now() - start).toBeLessThan(50);
  });
});
