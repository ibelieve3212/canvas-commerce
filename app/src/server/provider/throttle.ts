/**
 * Provider 并发闸门 + 429 自适应退避。
 *
 * 此前这里是"两次请求启动至少间隔 12 秒"的固定限速（5 RPM）。
 * 但上游一张图要跑 45-95 秒，每 12 秒放一个进去，实际会堆积 4-5 个并发请求，
 * 反而更容易触发 429；而串行等待又让 6 张图要跑 6 分钟。
 * 两头不讨好——限速值和上游实际耗时没有任何关系。
 *
 * 改成按并发数控制：同时最多 N 个请求在跑，完成一个才放下一个。
 * 这样自动适配上游速度，快就快跑、慢就自然排队。
 *
 * 429 是唯一的过载信号（用户的上游汇聚了多个渠道、会自动切换，
 * 除非 429 否则可以并发）。收到后临时收窄并发数并退避重试，
 * 连续成功若干次再逐步放开——不需要预先猜一个"安全"的并发数。
 *
 * 进程级单例（globalThis），与 V2 的单进程 Worker 形态一致。
 */

/** 默认并发上限。上游汇聚多渠道可并发，3 个能明显提速又不至于一上来打爆。 */
const DEFAULT_MAX_CONCURRENCY = 3;
/** 触发 429 后收窄到的并发数。1 = 完全串行，给上游喘息。 */
const MIN_CONCURRENCY = 1;
/** 连续这么多次成功后，把并发数放开一格。 */
const RECOVER_AFTER_SUCCESSES = 5;

interface ThrottleState {
  /** 当前允许的并发上限，429 时收窄、持续成功后恢复 */
  limit: number;
  /** 正在跑的请求数 */
  active: number;
  /** 等待放行的队列 */
  waiters: Array<() => void>;
  /** 自上次收窄以来的连续成功次数 */
  consecutiveSuccesses: number;
}

const globalForThrottle = globalThis as unknown as { __ccThrottle?: ThrottleState };

function getState(): ThrottleState {
  if (!globalForThrottle.__ccThrottle) {
    globalForThrottle.__ccThrottle = {
      limit: DEFAULT_MAX_CONCURRENCY,
      active: 0,
      waiters: [],
      consecutiveSuccesses: 0,
    };
  }
  return globalForThrottle.__ccThrottle;
}

/** 重置节流状态（测试用） */
export function resetThrottle(): void {
  globalForThrottle.__ccThrottle = {
    limit: DEFAULT_MAX_CONCURRENCY,
    active: 0,
    waiters: [],
    consecutiveSuccesses: 0,
  };
}

/** 当前并发状态，用于日志与测试断言。 */
export function getThrottleStats(): { limit: number; active: number; waiting: number } {
  const s = getState();
  return { limit: s.limit, active: s.active, waiting: s.waiters.length };
}

/**
 * 获取一个并发名额。名额满时排队等待，直到有请求完成。
 * 必须与 `markProviderRequestComplete` 成对调用，否则名额会泄漏。
 */
export async function throttleProviderRequest(providerName: string): Promise<void> {
  // Mock 即时返回，不占名额
  if (providerName === "mock") return;

  const s = getState();
  if (s.active < s.limit) {
    s.active++;
    return;
  }

  console.log(
    `[throttle] ${providerName}: 并发已满（${s.active}/${s.limit}），排队等待`,
  );
  await new Promise<void>((resolve) => s.waiters.push(resolve));
  s.active++;
}

/**
 * 上报一次 429，但不归还并发名额。
 *
 * 用于"就地退避重试"：调用方还要继续用这个名额重试，
 * 只是想让闸门立刻收窄，别让其它 Job 继续以原并发打过去。
 */
export function notifyRateLimited(): void {
  const s = getState();
  if (s.limit > MIN_CONCURRENCY) {
    s.limit--;
    console.log(`[throttle] 收到 429，并发上限收窄到 ${s.limit}`);
  }
  s.consecutiveSuccesses = 0;
}

/**
 * 归还并发名额。成功或失败都必须调用。
 *
 * @param outcome "ok" 正常完成 | "rate_limited" 上游返回 429
 */
export function markProviderRequestComplete(
  outcome: "ok" | "rate_limited" = "ok",
): void {
  const s = getState();
  // active 可能已被 resetThrottle 清零，别减成负数
  if (s.active > 0) s.active--;

  if (outcome === "rate_limited") {
    notifyRateLimited();
  } else {
    s.consecutiveSuccesses++;
    // 连续成功够多次，试探性放开一格
    if (
      s.limit < DEFAULT_MAX_CONCURRENCY &&
      s.consecutiveSuccesses >= RECOVER_AFTER_SUCCESSES
    ) {
      s.limit++;
      s.consecutiveSuccesses = 0;
      console.log(`[throttle] 连续成功，并发上限恢复到 ${s.limit}`);
    }
  }

  // 放行一个等待者。被唤醒的那个会在 await 之后自增 active，
  // 所以这里放一个就够——它跑完再调本函数，继续接力放下一个。
  if (s.waiters.length > 0 && s.active < s.limit) {
    s.waiters.shift()?.();
  }
}

/**
 * 429 退避等待。指数退避 + 抖动，避免多个 Job 同时重试再次撞满。
 *
 * @param attempt 第几次重试（从 0 开始）
 */
export async function backoffForRateLimit(attempt: number): Promise<void> {
  const base = Math.min(2000 * 2 ** attempt, 30_000);
  // 抖动 ±25%，防止同批 Job 的重试对齐成尖峰
  const jitter = base * (Math.random() * 0.5 - 0.25);
  const wait = Math.round(base + jitter);
  console.log(`[throttle] 429 退避 ${wait}ms（第 ${attempt + 1} 次重试）`);
  await new Promise((resolve) => setTimeout(resolve, wait));
}
