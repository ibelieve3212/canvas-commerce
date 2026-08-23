/**
 * Provider 请求节流器。
 *
 * 确保 Worker 对同一 Provider 的两次 generate 调用之间至少间隔 minIntervalMs。
 * 默认 5 RPM = 12 秒间隔。Mock Provider 不节流（即时返回）。
 *
 * 进程级节流（globalThis 单例），V2 唯一形态——单进程 Worker 无需跨进程节流。
 */

const DEFAULT_MIN_INTERVAL_MS = 12_000; // 5 RPM

/** 上次请求完成的时间戳 */
let lastRequestFinishedAt = 0;

/** 重置节流状态（测试用） */
export function resetThrottle(): void {
  lastRequestFinishedAt = 0;
}

/**
 * 在调 Provider.generate() 之前调用此函数，
 * 如果距离上次请求不足 minInterval，则 sleep 到满足间隔。
 */
export async function throttleProviderRequest(
  providerName: string,
  minIntervalMs: number = DEFAULT_MIN_INTERVAL_MS,
): Promise<void> {
  // Mock 不节流
  if (providerName === "mock") return;

  const now = Date.now();
  const elapsed = now - lastRequestFinishedAt;
  if (elapsed < minIntervalMs) {
    const wait = minIntervalMs - elapsed;
    console.log(
      `[throttle] ${providerName}: 距上次请求 ${elapsed}ms，等待 ${wait}ms 后再调用`,
    );
    await sleep(wait);
  }
}

/**
 * 在 Provider.generate() 完成（成功或失败）后调用，
 * 记录完成时间。
 */
export function markProviderRequestComplete(): void {
  lastRequestFinishedAt = Date.now();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
