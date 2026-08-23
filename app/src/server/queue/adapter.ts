/**
 * 队列适配器。内存队列是唯一形态（单进程内事件驱动）。
 * V2 已放弃 BullMQ/Redis 方案，不再支持外部队列。
 */

export interface QueueAdapter {
  enqueue(jobId: string, payload: unknown): Promise<void>;
  dequeue(): Promise<{ jobId: string; payload: unknown } | null>;
  size(): number;
}

class MemoryQueueAdapter implements QueueAdapter {
  private queue: Array<{ jobId: string; payload: unknown }> = [];
  private listeners = new Set<() => void>();

  async enqueue(jobId: string, payload: unknown): Promise<void> {
    this.queue.push({ jobId, payload });
    for (const cb of this.listeners) cb();
  }

  async dequeue(): Promise<{ jobId: string; payload: unknown } | null> {
    return this.queue.shift() ?? null;
  }

  size(): number {
    return this.queue.length;
  }

  /** 注册监听器，入队时触发（用于 Worker 轮询唤醒）。 */
  onEnqueue(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}

const globalForQueue = globalThis as unknown as {
  __ccQueue?: QueueAdapter;
};

export function getQueue(): QueueAdapter {
  if (globalForQueue.__ccQueue) return globalForQueue.__ccQueue;
  const adapter = new MemoryQueueAdapter();
  globalForQueue.__ccQueue = adapter;
  return adapter;
}

export function getMemoryQueue(): MemoryQueueAdapter | null {
  const q = getQueue();
  if (q instanceof MemoryQueueAdapter) return q;
  return null;
}
