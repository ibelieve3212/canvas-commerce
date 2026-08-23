/**
 * 纯 SQL migrate runner —— 替代 `prisma migrate deploy`。
 *
 * 为什么不用 prisma CLI：它自身 42M，还拖着 @prisma/dev(19M)、
 * @prisma/studio-core(43M)、mysql2、postgres 驱动，合计 100M+。
 * 对一个目标 150M 的镜像来说，迁移工具比应用本身还大。
 *
 * 可行的前提（已实测）：本项目当前 6 个 migration 全是纯 DDL
 * （PRAGMA + CREATE TABLE + CREATE INDEX + ALTER TABLE RENAME COLUMN），
 * 没有 Prisma 特有语法；
 * `_prisma_migrations.checksum` 就是 sha256(migration.sql 原始字节)。
 *
 * ⚠️ 约束：新增 migration 必须是纯 SQL，能被 better-sqlite3 直接执行。
 * 若将来用到 Prisma 的 --create-only 手写脚本或非 SQL 步骤，这里要同步维护。
 *
 * 与 prisma migrate deploy 的行为对齐点：
 * - 表结构、字段名、checksum 算法完全一致，两者可交替使用
 * - 只前进、不回滚；已应用的跳过
 * - 检测到已应用记录的 checksum 与文件不符则中止（文件被改过 = 数据库状态不可信）
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";

/** Prisma 的迁移记录表，字段与 prisma migrate deploy 生成的完全一致。 */
const MIGRATIONS_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id"                    TEXT PRIMARY KEY NOT NULL,
    "checksum"              TEXT NOT NULL,
    "finished_at"           DATETIME,
    "migration_name"        TEXT NOT NULL,
    "logs"                  TEXT,
    "rolled_back_at"        DATETIME,
    "started_at"            DATETIME NOT NULL DEFAULT current_timestamp,
    "applied_steps_count"   INTEGER UNSIGNED NOT NULL DEFAULT 0
)`;

/** Prisma 用 sha256(文件原始字节) 作 checksum，必须按字节算，不能先转字符串。 */
export function checksumOf(sqlBytes) {
  return createHash("sha256").update(sqlBytes).digest("hex");
}

/**
 * 读取 migrations 目录，按目录名升序返回。
 * Prisma 的目录名以时间戳开头，字典序即时间序。
 */
export function listMigrations(migrationsDir) {
  if (!fs.existsSync(migrationsDir)) return [];
  return fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .map((name) => {
      const sqlPath = path.join(migrationsDir, name, "migration.sql");
      if (!fs.existsSync(sqlPath)) return null;
      const bytes = fs.readFileSync(sqlPath);
      return { name, sqlPath, bytes, checksum: checksumOf(bytes) };
    })
    .filter(Boolean);
}

/**
 * 比对磁盘上的 migration 与数据库已应用记录，得出待执行清单。
 * 抽成纯函数是为了能单测——migrate 是不可逆操作，判断逻辑必须可验证。
 */
export function planMigrations(onDisk, applied) {
  const appliedByName = new Map(applied.map((r) => [r.migration_name, r]));
  const pending = [];
  const drift = [];

  for (const m of onDisk) {
    const rec = appliedByName.get(m.name);
    if (!rec) {
      pending.push(m);
      continue;
    }
    // 已应用但文件内容变了 → 数据库实际结构与文件不符，不能假装没事继续
    if (rec.checksum !== m.checksum) {
      drift.push({ name: m.name, expected: rec.checksum, actual: m.checksum });
    }
  }

  // 数据库里有、磁盘上没有 → 大概率是镜像回滚到了旧版本，继续跑会用旧代码操作新库
  const onDiskNames = new Set(onDisk.map((m) => m.name));
  const unknown = applied
    .map((r) => r.migration_name)
    .filter((n) => !onDiskNames.has(n));

  return { pending, drift, unknown };
}

export function runMigrations(dbPath, migrationsDir, log = console.log) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  try {
    // WAL 提升并发读性能，与应用运行时保持一致
    db.pragma("journal_mode = WAL");
    db.exec(MIGRATIONS_TABLE_DDL);

    const onDisk = listMigrations(migrationsDir);
    if (onDisk.length === 0) {
      throw new Error(`未找到任何 migration：${migrationsDir}`);
    }

    const applied = db
      .prepare(
        `SELECT migration_name, checksum FROM "_prisma_migrations"
         WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
      )
      .all();

    const { pending, drift, unknown } = planMigrations(onDisk, applied);

    if (drift.length > 0) {
      throw new Error(
        `migration 文件在应用后被修改，数据库结构不可信，已中止：\n` +
          drift.map((d) => `  - ${d.name}`).join("\n") +
          `\n不要修改已应用的 migration。需要改结构请新建一个 migration。`,
      );
    }

    if (unknown.length > 0) {
      throw new Error(
        `数据库里存在本次镜像不认识的 migration，已中止：\n` +
          unknown.map((n) => `  - ${n}`).join("\n") +
          `\n通常意味着镜像被回滚到了更旧的版本。用旧代码操作新库会出错。`,
      );
    }

    if (pending.length === 0) {
      log(`[migrate] 已是最新（${applied.length} 个 migration 均已应用）`);
      return { applied: 0, total: onDisk.length };
    }

    log(`[migrate] 待应用 ${pending.length} 个：`);

    for (const m of pending) {
      log(`[migrate]   ${m.name}`);
      const started = new Date().toISOString();
      const id = randomUUID();

      // 单个 migration 内的多条语句作为一个事务，失败则整体回滚，
      // 不留半应用状态。注意 migration.sql 里的 PRAGMA foreign_keys
      // 在事务中无效（SQLite 限制），但 Prisma 生成的重建表流程
      // 用的是 defer_foreign_keys，事务内可用。
      const sql = m.bytes.toString("utf8");
      try {
        db.exec("BEGIN");
        db.exec(sql);
        db.prepare(
          `INSERT INTO "_prisma_migrations"
             (id, checksum, finished_at, migration_name, logs, rolled_back_at,
              started_at, applied_steps_count)
           VALUES (?, ?, ?, ?, NULL, NULL, ?, 1)`,
        ).run(id, m.checksum, new Date().toISOString(), m.name, started);
        db.exec("COMMIT");
      } catch (err) {
        try {
          db.exec("ROLLBACK");
        } catch {
          // ROLLBACK 本身失败（如连接已断）时保留原始错误
        }
        throw new Error(`migration ${m.name} 执行失败：${err.message}`);
      }
    }

    log(`[migrate] 完成，共应用 ${pending.length} 个`);
    return { applied: pending.length, total: onDisk.length };
  } finally {
    db.close();
  }
}

/** 数据库是否已有用户 —— entrypoint 用它判断要不要 seed。 */
export function countUsers(dbPath) {
  if (!fs.existsSync(dbPath)) return 0;
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM "User"`).get();
    return row?.n ?? 0;
  } catch {
    // 表还不存在 → 视为空库
    return 0;
  } finally {
    db.close();
  }
}

// 作为脚本直接运行时才执行（被单测 import 时不执行）。
// argv[1] 可能是相对路径，import.meta.url 总是绝对 file:// URL，需先归一化。
const invokedDirectly =
  process.argv[1] !== undefined &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (invokedDirectly) {
  const dbPath = (process.env.DATABASE_URL || "file:.data/db/dev.db").replace(/^file:/, "");
  const migrationsDir = process.env.MIGRATIONS_DIR || "prisma/migrations";
  try {
    runMigrations(dbPath, migrationsDir);
  } catch (err) {
    console.error(`[migrate] 失败：${err.message}`);
    process.exit(1);
  }
}
