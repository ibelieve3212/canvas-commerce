/**
 * 用真实 dev.db 造沙箱 fixture 的公共入口。
 *
 * 必须连 `-wal` 一起拷。SQLite 开了 WAL 后新写入先进 -wal，
 * 只 copyFileSync 主库拿到的是上一次 checkpoint 时的旧快照——
 * 实测差了 25 条 Asset：库里说有 324 条、storage 里只剩 299 个文件
 * （清理 tick 删掉的那批已落 WAL、文件也真删了，但主库还没合并）。
 * 于是"记录在、文件不在"，断言 fs.existsSync 为 true 的用例直接失败，
 * 而失败原因与被测代码毫无关系。
 *
 * -shm 不用拷：它是共享内存索引，SQLite 会按 -wal 重建。
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const REAL_DB = ".data/db/dev.db";
export const REAL_STORAGE = ".data/storage";

export const hasFixture = fs.existsSync(REAL_DB);

export interface Sandbox {
  root: string;
  dbPath: string;
  storagePath: string;
}

/**
 * 拷一份 dev.db（含 WAL）到临时目录。
 *
 * @param copyStorage true 则连 storage 一起拷（需要断言文件存在的用例）；
 *                    false 只建空目录（只用库、不碰文件的用例，省掉几百个文件的拷贝）
 */
export function createSandbox(prefix: string, copyStorage = true): Sandbox {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const dbPath = path.join(root, "test.db");
  const storagePath = path.join(root, "storage");

  fs.copyFileSync(REAL_DB, dbPath);
  const wal = `${REAL_DB}-wal`;
  if (fs.existsSync(wal)) fs.copyFileSync(wal, `${dbPath}-wal`);

  if (copyStorage) fs.cpSync(REAL_STORAGE, storagePath, { recursive: true });
  else fs.mkdirSync(storagePath, { recursive: true });

  return { root, dbPath, storagePath };
}
