/**
 * 对象存储适配器。本地文件系统是唯一形态（V2 已放弃 S3 方案）。
 * 键：{userId}/{uuid}.{ext}
 */
import { env } from "@/lib/env";
import { promises as fs } from "node:fs";
import path from "node:path";

export interface StorageAdapter {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /** 返回短时访问 URL。local 模式返回 /api/storage/{key} 路由。 */
  getSignedUrl(key: string, expiresInSec?: number): Promise<string>;
  exists(key: string): Promise<boolean>;
}

class LocalStorageAdapter implements StorageAdapter {
  constructor(private basePath: string) {}

  private resolve(key: string): string {
    // 防止路径遍历
    const safe = key.replace(/\.\./g, "").replace(/^\/+/, "");
    return path.join(this.basePath, safe);
  }

  async put(key: string, data: Buffer): Promise<void> {
    const fp = this.resolve(key);
    await fs.mkdir(path.dirname(fp), { recursive: true });
    await fs.writeFile(fp, data);
  }

  async get(key: string): Promise<Buffer> {
    const fp = this.resolve(key);
    return fs.readFile(fp);
  }

  async delete(key: string): Promise<void> {
    const fp = this.resolve(key);
    await fs.unlink(fp).catch(() => {});
  }

  async getSignedUrl(key: string): Promise<string> {
    // local 模式直接通过内部路由访问
    return `/api/storage/${encodeURIComponent(key)}`;
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }
}

let _instance: StorageAdapter | null = null;

export function getStorage(): StorageAdapter {
  if (_instance) return _instance;
  _instance = new LocalStorageAdapter(env.STORAGE_LOCAL_PATH);
  return _instance;
}

/**
 * 生成存储对象键。OPT-3 精简后：{userId}/{uuid}.{ext}（2 层）。
 * 砍掉了 users/ 前缀、category 分类、yyyy/mm 时间分片。
 * 老数据不迁移——按数据库存的 key 读写，新老共存。
 */
export function makeObjectKey(
  userId: string,
  ext: string,
): string {
  const uuid = crypto.randomUUID();
  return `${userId}/${uuid}.${ext}`;
}
