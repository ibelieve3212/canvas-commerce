/**
 * migrate runner 的判断逻辑单测。
 *
 * migrate 是不可逆操作，且我们用自己写的 runner 替代了 prisma CLI，
 * 所以"哪些该跑、哪些该拒绝"必须能验证，不能只靠跑一次看着对。
 */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
// migrate.mjs 是纯 JS 脚本（运行时镜像里不带 TS），TS 能推导出类型，无需 忽略指令
import { planMigrations, checksumOf } from "../../scripts/migrate.mjs";

/** 造一个 onDisk 条目 */
function mk(name: string, sql: string) {
  const bytes = Buffer.from(sql, "utf8");
  return { name, sqlPath: `prisma/migrations/${name}/migration.sql`, bytes, checksum: checksumOf(bytes) };
}

describe("checksumOf", () => {
  it("与 prisma 一致：sha256(文件原始字节)", () => {
    const sql = 'CREATE TABLE "A" ("id" TEXT);';
    const expected = createHash("sha256").update(Buffer.from(sql, "utf8")).digest("hex");
    expect(checksumOf(Buffer.from(sql, "utf8"))).toBe(expected);
  });

  it("含非 ASCII 时按字节算，不受编码转换影响", () => {
    // 中文注释在 migration.sql 里很常见，若先转成字符串再 hash 会与 prisma 不一致
    const sql = '-- 建用户表\nCREATE TABLE "User" ("id" TEXT);';
    const bytes = Buffer.from(sql, "utf8");
    expect(checksumOf(bytes)).toBe(createHash("sha256").update(bytes).digest("hex"));
  });
});

describe("planMigrations", () => {
  it("空库：全部待应用", () => {
    const onDisk = [mk("001_a", "CREATE TABLE a(id TEXT);"), mk("002_b", "CREATE TABLE b(id TEXT);")];
    const { pending, drift, unknown } = planMigrations(onDisk, []);
    expect(pending.map((m: { name: string }) => m.name)).toEqual(["001_a", "002_b"]);
    expect(drift).toEqual([]);
    expect(unknown).toEqual([]);
  });

  it("已全部应用：无待办（幂等，容器重启不会重跑）", () => {
    const onDisk = [mk("001_a", "CREATE TABLE a(id TEXT);")];
    const applied = [{ migration_name: "001_a", checksum: onDisk[0].checksum }];
    const { pending, drift, unknown } = planMigrations(onDisk, applied);
    expect(pending).toEqual([]);
    expect(drift).toEqual([]);
    expect(unknown).toEqual([]);
  });

  it("增量：只跑新增的那个", () => {
    const a = mk("001_a", "CREATE TABLE a(id TEXT);");
    const b = mk("002_b", "CREATE TABLE b(id TEXT);");
    const applied = [{ migration_name: "001_a", checksum: a.checksum }];
    const { pending } = planMigrations([a, b], applied);
    expect(pending.map((m: { name: string }) => m.name)).toEqual(["002_b"]);
  });

  it("已应用的 migration 文件被改过 → 报 drift，不能静默继续", () => {
    // 数据库里记的是旧内容的 checksum，磁盘上文件已改。
    // 此时数据库实际结构与文件描述的不符，继续跑后面的 migration 会基于错误假设。
    const onDisk = [mk("001_a", "CREATE TABLE a(id TEXT, extra TEXT);")];
    const applied = [{ migration_name: "001_a", checksum: "旧内容的checksum" }];
    const { pending, drift } = planMigrations(onDisk, applied);
    expect(pending).toEqual([]);
    expect(drift).toHaveLength(1);
    expect(drift[0].name).toBe("001_a");
  });

  it("数据库有、磁盘没有 → 报 unknown（镜像被回滚到旧版本）", () => {
    // 迪拜服务器 pull 了旧 tag，但 volume 里的库是新版本建的。
    // 用旧代码操作新库会出错，必须拦住而不是继续启动。
    const a = mk("001_a", "CREATE TABLE a(id TEXT);");
    const applied = [
      { migration_name: "001_a", checksum: a.checksum },
      { migration_name: "002_future", checksum: "x" },
    ];
    const { pending, unknown } = planMigrations([a], applied);
    expect(pending).toEqual([]);
    expect(unknown).toEqual(["002_future"]);
  });

  it("drift 与 pending 可同时存在，但 runner 会因 drift 先中止", () => {
    const a = mk("001_a", "CREATE TABLE a(id TEXT);");
    const b = mk("002_b", "CREATE TABLE b(id TEXT);");
    const applied = [{ migration_name: "001_a", checksum: "变了" }];
    const { pending, drift } = planMigrations([a, b], applied);
    expect(pending.map((m: { name: string }) => m.name)).toEqual(["002_b"]);
    expect(drift).toHaveLength(1);
  });

  it("忽略回滚过的记录由调用方负责：planMigrations 只看传入的已应用列表", () => {
    // runner 的 SQL 已过滤 finished_at IS NULL 和 rolled_back_at NOT NULL，
    // 所以未完成的 migration 会被当作没应用过、重新执行。
    const a = mk("001_a", "CREATE TABLE a(id TEXT);");
    const { pending } = planMigrations([a], []);
    expect(pending).toHaveLength(1);
  });
});
