/**
 * 小型内存限流器：按 IP + 用户名组合在固定时间窗口内限制请求次数。
 * 单进程内有效，V2 唯一形态（不再支持 Redis 分布式限流）。
 */

const windowMs = 60_000; // 1 分钟
const maxAttempts = 5; // 每分钟最多 5 次

interface RateEntry { count: number; resetAt: number; }
const store = new Map<string, RateEntry>();

// 定期清理过期项
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.resetAt < now) store.delete(key);
  }
}, 60_000).unref?.();

export function checkRateLimit(key: string): { allowed: boolean; remaining: number; resetInMs: number } {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || entry.resetAt < now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxAttempts - 1, resetInMs: windowMs };
  }

  if (entry.count >= maxAttempts) {
    return { allowed: false, remaining: 0, resetInMs: entry.resetAt - now };
  }

  entry.count++;
  return { allowed: true, remaining: maxAttempts - entry.count, resetInMs: entry.resetAt - now };
}

export function resetRateLimit(key: string) {
  store.delete(key);
}
